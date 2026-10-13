-- Priority #9 review fixes (REVIEW_PRIORITY9_2026-10-09.md).
--
-- 1. An attachment can only be recorded from a server-verified upload.
--    prepare_evidence_upload now records a pending upload (evidence_uploads)
--    and generates its object path. Only the server (service role) can
--    record the verification result -- the SHA-256, size and content type
--    of the bytes it downloaded and checked, plus the storage object's id
--    and version -- through record_evidence_upload_verification.
--    add_evidence_attachment now takes the upload id, not caller-supplied
--    file metadata: it records exactly what the server verified, refuses an
--    upload that isn't verified or isn't the caller's, re-checks that the
--    stored object is still the one verified, and returns the existing item
--    on a replay (idempotent).
-- 2. Nothing the app does can delete a file an evidence row refers to.
--    discard_evidence_upload only discards an upload that is still
--    pending/verified and whose path no evidence row uses; file deletion
--    goes through a durable queue (storage_cleanup_queue) that skips any
--    path still referenced.
-- 3. File deletion is durable and observable. A deleted evidence row, or a
--    pending upload removed with its project, queues its file in the same
--    transaction (triggers, so direct RPC calls are covered too). The app
--    processes the queue after each operation and on demand; failures are
--    kept with the error and retried. Uploads left pending for 24 hours
--    expire and are queued.
-- 4. Archiving or restoring an export needs a nonblank reason.

-- ---------------------------------------------------------------------
-- 1. Pending uploads
-- ---------------------------------------------------------------------

create table public.evidence_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 300),
  content_type text not null,
  declared_size_bytes bigint not null check (declared_size_bytes between 1 and 26214400),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VERIFIED', 'RECORDED', 'DISCARDED', 'EXPIRED')),
  verified_sha256 text check (verified_sha256 ~ '^[0-9a-f]{64}$'),
  verified_size_bytes bigint check (verified_size_bytes between 1 and 26214400),
  verified_object_id uuid,
  verified_object_version text,
  verified_at timestamptz,
  evidence_item_id uuid,
  resolved_at timestamptz,
  resolution_reason text,
  constraint evidence_uploads_verified check (
    status in ('PENDING', 'DISCARDED', 'EXPIRED')
    or (verified_sha256 is not null and verified_size_bytes is not null
        and verified_object_id is not null and verified_at is not null)
  ),
  constraint evidence_uploads_recorded check ((status = 'RECORDED') = (evidence_item_id is not null))
);

create index evidence_uploads_open_idx on public.evidence_uploads (created_at) where status in ('PENDING', 'VERIFIED');

alter table public.evidence_uploads enable row level security;

-- The uploader reads their own uploads (the app checks ownership with the
-- caller's session before acting on one). Nobody writes them directly.
create policy evidence_uploads_select_own
  on public.evidence_uploads
  for select
  to authenticated
  using (created_by = (select auth.uid()) and private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.evidence_uploads
  from public, anon, authenticated, service_role;
grant select on public.evidence_uploads to authenticated, service_role;

create or replace function private.evidence_content_type(p_filename text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case lower(substring(p_filename from '\.([A-Za-z0-9]+)$'))
    when 'pdf' then 'application/pdf'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'csv' then 'text/csv'
    when 'png' then 'image/png'
    when 'jpg' then 'image/jpeg'
    when 'jpeg' then 'image/jpeg'
    when 'webp' then 'image/webp'
    when 'mp4' then 'video/mp4'
  end
$$;

create or replace function private.evidence_extension(p_content_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_content_type
    when 'application/pdf' then 'pdf'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'text/csv' then 'csv'
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    when 'video/mp4' then 'mp4'
  end
$$;

-- ---------------------------------------------------------------------
-- 2. Durable file-deletion queue
-- ---------------------------------------------------------------------

create table public.storage_cleanup_queue (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  -- No foreign keys: the record must outlive the project it came from.
  project_id uuid,
  bucket_id text not null default 'evidence',
  storage_path text not null,
  reason text not null,
  enqueued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  completed_at timestamptz,
  outcome text check (outcome in ('DELETED', 'SKIPPED_REFERENCED')),
  constraint storage_cleanup_queue_outcome check ((completed_at is null) = (outcome is null))
);

create index storage_cleanup_queue_open_idx on public.storage_cleanup_queue (enqueued_at) where completed_at is null;
create index storage_cleanup_queue_project_idx on public.storage_cleanup_queue (project_id) where completed_at is null;

alter table public.storage_cleanup_queue enable row level security;

create policy storage_cleanup_queue_select
  on public.storage_cleanup_queue
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.storage_cleanup_queue
  from public, anon, authenticated, service_role;
grant select on public.storage_cleanup_queue to authenticated, service_role;

create or replace function private.enqueue_storage_cleanup(
  p_workspace_id uuid, p_project_id uuid, p_path text, p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.storage_cleanup_queue (workspace_id, project_id, storage_path, reason)
  values (p_workspace_id, p_project_id, p_path, p_reason);
$$;

revoke execute on function private.enqueue_storage_cleanup(uuid, uuid, text, text) from public, anon, authenticated, service_role;

-- A deleted evidence row's file is queued in the same transaction, however
-- the row was deleted (remove_evidence_item, project deletion cascade).
create or replace function private.queue_deleted_evidence_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.storage_path is not null then
    perform private.enqueue_storage_cleanup(old.workspace_id, old.project_id, old.storage_path, 'evidence deleted');
  end if;
  return null;
end;
$$;

create trigger evidence_items_queue_file_deletion
  after delete on public.evidence_items
  for each row execute function private.queue_deleted_evidence_file();

-- A pending upload removed with its project.
create or replace function private.queue_deleted_upload_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('PENDING', 'VERIFIED') then
    perform private.enqueue_storage_cleanup(old.workspace_id, old.project_id, old.storage_path, 'pending upload deleted');
  end if;
  return null;
end;
$$;

create trigger evidence_uploads_queue_file_deletion
  after delete on public.evidence_uploads
  for each row execute function private.queue_deleted_upload_file();

-- Is this object still needed? By any evidence row (removed ones included),
-- or by an upload that may still be recorded.
create or replace function private.storage_path_in_use(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.evidence_items e where e.storage_path = p_path)
      or exists (select 1 from public.evidence_uploads u where u.storage_path = p_path and u.status in ('PENDING', 'VERIFIED'))
$$;

revoke execute on function private.storage_path_in_use(text) from public, anon, authenticated, service_role;

-- Service role only (the app's server). Expires uploads left open for 24
-- hours, settles queue items whose path is in use again (never deleted),
-- and hands out the next items to delete.
create or replace function public.claim_storage_cleanup(p_limit integer default 50)
returns table (id bigint, bucket_id text, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_upload record;
begin
  for v_upload in
    update public.evidence_uploads u
      set status = 'EXPIRED', resolved_at = now(), resolution_reason = 'not finished within 24 hours'
      where u.status in ('PENDING', 'VERIFIED') and u.created_at < now() - interval '24 hours'
      returning u.workspace_id, u.project_id, u.storage_path
  loop
    perform private.enqueue_storage_cleanup(v_upload.workspace_id, v_upload.project_id, v_upload.storage_path, 'upload expired');
  end loop;

  update public.storage_cleanup_queue q
    set completed_at = now(), outcome = 'SKIPPED_REFERENCED'
    where q.completed_at is null and private.storage_path_in_use(q.storage_path);

  return query
  with next_items as (
    select q.id from public.storage_cleanup_queue q
    where q.completed_at is null
    order by q.enqueued_at, q.id
    limit greatest(1, least(p_limit, 500))
    for update skip locked
  )
  update public.storage_cleanup_queue q
    set attempts = q.attempts + 1, last_attempt_at = now()
    from next_items
    where q.id = next_items.id
    returning q.id, q.bucket_id, q.storage_path;
end;
$$;

revoke execute on function public.claim_storage_cleanup(integer) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer) to service_role;

create or replace function public.complete_storage_cleanup(p_id bigint, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_error is null then
    update public.storage_cleanup_queue
      set completed_at = now(), outcome = 'DELETED', last_error = null
      where id = p_id and completed_at is null;
  else
    update public.storage_cleanup_queue
      set last_error = left(p_error, 1000)
      where id = p_id and completed_at is null;
  end if;
end;
$$;

revoke execute on function public.complete_storage_cleanup(bigint, text) from public, anon, authenticated;
grant execute on function public.complete_storage_cleanup(bigint, text) to service_role;

-- ---------------------------------------------------------------------
-- 3. Upload RPCs
-- ---------------------------------------------------------------------

drop function public.prepare_evidence_upload(uuid);

-- Owner, project open for work, allowed type and size. Records the pending
-- upload and returns its id and the object path (generated here, not by
-- the caller). The server then issues the signed upload URL for that path.
create or replace function public.prepare_evidence_upload(
  p_project_id uuid,
  p_original_filename text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_client_status text;
  v_content_type text := private.evidence_content_type(p_original_filename);
  v_upload public.evidence_uploads;
begin
  select * into v_project from public.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'project % not found', p_project_id;
  end if;
  if not private.is_workspace_owner(v_project.workspace_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_project.lifecycle_status = 'ARCHIVED' then
    raise exception 'this project is archived and read-only: restore it first';
  end if;
  select status into v_client_status from public.client_businesses where id = v_project.client_business_id;
  if v_client_status <> 'ACTIVE' then
    raise exception 'this project''s client/business is archived and read-only: restore the client first';
  end if;
  if v_content_type is null then
    raise exception 'this file type is not allowed';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400 then
    raise exception 'files must be between 1 byte and 25 MB: store larger files in Drive and add the link';
  end if;

  insert into public.evidence_uploads (
    id, workspace_id, project_id, storage_path, original_filename, content_type, declared_size_bytes, created_by
  )
  select u, v_project.workspace_id, p_project_id,
         v_project.workspace_id::text || '/' || p_project_id::text || '/' || u::text || '.' || private.evidence_extension(v_content_type),
         btrim(p_original_filename), v_content_type, p_size_bytes, auth.uid()
  from (select gen_random_uuid() as u) g
  returning * into v_upload;

  return jsonb_build_object(
    'upload_id', v_upload.id,
    'storage_path', v_upload.storage_path,
    'content_type', v_upload.content_type
  );
end;
$$;

revoke execute on function public.prepare_evidence_upload(uuid, text, bigint) from public, anon, service_role;
grant execute on function public.prepare_evidence_upload(uuid, text, bigint) to authenticated;

-- Service role only: the server's result for bytes it downloaded and
-- checked. Bound to the stored object as it is now (id and version), which
-- must still match the size and type checked.
create or replace function public.record_evidence_upload_verification(
  p_upload_id uuid,
  p_project_id uuid,
  p_sha256 text,
  p_size_bytes bigint,
  p_content_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.evidence_uploads;
  v_object record;
begin
  select * into v_upload from public.evidence_uploads where id = p_upload_id for update;
  if v_upload.id is null or v_upload.project_id <> p_project_id then
    raise exception 'unknown upload';
  end if;
  if v_upload.status <> 'PENDING' then
    raise exception 'this upload is %', lower(v_upload.status);
  end if;
  if p_content_type is distinct from v_upload.content_type then
    raise exception 'the checked type does not match the upload';
  end if;

  select o.id, o.version, (o.metadata ->> 'size')::bigint as size, o.metadata ->> 'mimetype' as mimetype
    into v_object
  from storage.objects o
  where o.bucket_id = 'evidence' and o.name = v_upload.storage_path;
  if v_object.id is null then
    raise exception 'the uploaded file was not found';
  end if;
  if v_object.size is distinct from p_size_bytes or v_object.mimetype is distinct from v_upload.content_type then
    raise exception 'the uploaded file does not match what was checked';
  end if;

  update public.evidence_uploads
    set status = 'VERIFIED',
        verified_sha256 = p_sha256,
        verified_size_bytes = p_size_bytes,
        verified_object_id = v_object.id,
        verified_object_version = v_object.version,
        verified_at = now()
    where id = p_upload_id;
end;
$$;

revoke execute on function public.record_evidence_upload_verification(uuid, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.record_evidence_upload_verification(uuid, uuid, text, bigint, text) to service_role;

-- Service role only: gives up on an upload that failed its checks and
-- queues its file. Never touches a recorded upload or a path any evidence
-- row uses.
create or replace function public.discard_evidence_upload(p_upload_id uuid, p_project_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.evidence_uploads;
begin
  select * into v_upload from public.evidence_uploads where id = p_upload_id for update;
  if v_upload.id is null or v_upload.project_id <> p_project_id then
    raise exception 'unknown upload';
  end if;
  if v_upload.status not in ('PENDING', 'VERIFIED') then
    raise exception 'this upload is % and cannot be discarded', lower(v_upload.status);
  end if;
  if exists (select 1 from public.evidence_items e where e.storage_path = v_upload.storage_path) then
    raise exception 'this file belongs to an evidence item and is kept';
  end if;

  update public.evidence_uploads
    set status = 'DISCARDED', resolved_at = now(), resolution_reason = left(coalesce(p_reason, 'discarded'), 500)
    where id = p_upload_id;
  perform private.enqueue_storage_cleanup(v_upload.workspace_id, v_upload.project_id, v_upload.storage_path, 'upload discarded');
end;
$$;

revoke execute on function public.discard_evidence_upload(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.discard_evidence_upload(uuid, uuid, text) to service_role;

drop function public.add_evidence_attachment(uuid, text, text, text, text, bigint, text, text, date, text);

-- Records a verified upload as evidence. File details come only from the
-- server's verification. Replaying a recorded upload returns its item.
create or replace function public.add_evidence_attachment(
  p_project_id uuid,
  p_upload_id uuid,
  p_category text,
  p_verification_status text default null,
  p_evidence_date date default null,
  p_notes text default null
)
returns public.evidence_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_upload public.evidence_uploads;
  v_object record;
  v_item public.evidence_items;
begin
  select workspace_id, readiness_status into v_workspace_id, v_from_status
  from public.projects
  where id = p_project_id
  for update;

  if v_workspace_id is null then
    raise exception 'project % not found', p_project_id;
  end if;
  if not private.is_workspace_owner(v_workspace_id) then
    raise exception 'not authorized';
  end if;

  select * into v_upload from public.evidence_uploads
  where id = p_upload_id and project_id = p_project_id and created_by = auth.uid()
  for update;
  if v_upload.id is null then
    raise exception 'unknown upload';
  end if;
  if v_upload.status = 'RECORDED' then
    select * into v_item from public.evidence_items where id = v_upload.evidence_item_id;
    return v_item;
  end if;
  if v_upload.status <> 'VERIFIED' then
    raise exception 'this file has not passed the server''s checks';
  end if;

  -- The stored object must still be the one that was checked.
  select o.id, o.version, (o.metadata ->> 'size')::bigint as size, o.metadata ->> 'mimetype' as mimetype
    into v_object
  from storage.objects o
  where o.bucket_id = 'evidence' and o.name = v_upload.storage_path;
  if v_object.id is distinct from v_upload.verified_object_id
     or v_object.version is distinct from v_upload.verified_object_version
     or v_object.size is distinct from v_upload.verified_size_bytes
     or v_object.mimetype is distinct from v_upload.content_type then
    raise exception 'the uploaded file changed after it was checked';
  end if;

  insert into public.evidence_items (
    workspace_id, project_id, category, original_filename, storage_path, content_type,
    size_bytes, sha256, verification_status, evidence_date, notes, created_by
  ) values (
    v_workspace_id, p_project_id, p_category, v_upload.original_filename, v_upload.storage_path, v_upload.content_type,
    v_upload.verified_size_bytes, v_upload.verified_sha256, coalesce(p_verification_status, 'UNVERIFIED'),
    p_evidence_date, p_notes, auth.uid()
  )
  returning * into v_item;

  update public.evidence_uploads
    set status = 'RECORDED', evidence_item_id = v_item.id, resolved_at = now()
    where id = p_upload_id;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Evidence file added after approval.', auth.uid()
    );
  end if;

  return v_item;
end;
$$;

revoke execute on function public.add_evidence_attachment(uuid, uuid, text, text, date, text) from public, anon, service_role;
grant execute on function public.add_evidence_attachment(uuid, uuid, text, text, date, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Export archive/restore needs a reason
-- ---------------------------------------------------------------------

create or replace function public.set_export_archived(p_export_id uuid, p_archived boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.project_exports;
  v_current text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_export from public.project_exports where id = p_export_id;
  if v_export.id is null then
    raise exception 'export % not found', p_export_id;
  end if;
  if not private.is_workspace_owner(v_export.workspace_id) then
    raise exception 'not authorized';
  end if;
  if v_reason is null then
    raise exception 'give a reason for % this export', case when p_archived then 'archiving' else 'restoring' end;
  end if;
  -- Serialize archive/restore of one export.
  perform 1 from public.projects where id = v_export.project_id for update;

  select e.event_type into v_current
  from public.project_export_archive_events e
  where e.export_id = p_export_id
  order by e.seq desc limit 1;

  if p_archived and v_current = 'ARCHIVED' then
    raise exception 'this export is already archived';
  end if;
  if not p_archived and v_current is distinct from 'ARCHIVED' then
    raise exception 'this export is not archived';
  end if;

  insert into public.project_export_archive_events (workspace_id, export_id, event_type, reason, actor_id)
  values (
    v_export.workspace_id, p_export_id,
    case when p_archived then 'ARCHIVED' else 'RESTORED' end,
    v_reason, auth.uid()
  );
end;
$$;

-- Every new event carries a reason (events before this migration keep theirs).
alter table public.project_export_archive_events
  add constraint project_export_archive_events_reason check (nullif(btrim(reason), '') is not null) not valid;
