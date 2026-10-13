-- Priority #9: evidence file attachments, evidence retention, and export
-- archiving (BUILD_READINESS_QUESTIONNAIRE.md F06, H07-H09, J01, J03, J05).
--
-- 1. Attachments. Evidence is a link OR a file in the private `evidence`
--    Storage bucket (never both). Allowed: PDF, DOCX, XLSX, CSV, PNG,
--    JPG/JPEG, WEBP, MP4, up to 25 MB -- the bucket itself enforces the
--    size and declared type. The browser uploads straight to Storage with a
--    one-time signed URL; the app then downloads the object, checks the
--    detected content type against the extension and records it through
--    add_evidence_attachment, which re-checks the stored object (bucket,
--    path under this workspace/project, size, type) in SQL. Larger files
--    stay Drive links.
-- 2. Which evidence each export contains is recorded at export time
--    (project_export_evidence, written by a trigger inside the export
--    transaction, which holds the project lock the fingerprint was
--    verified under).
-- 3. Retention. Evidence that is part of any export is never hard-deleted:
--    remove_evidence_item marks it removed (with a reason) and keeps it,
--    file included; it then drops out of new exports. Evidence in no
--    export is deleted (the app then deletes its file). A removed item is
--    immutable. delete_evidence_item, which hard-deleted anything, is gone.
-- 4. Export archiving (H09: approved exports may be archived, never
--    hard-deleted): append-only project_export_archive_events; the latest
--    event decides. Archived exports stay downloadable.

-- ---------------------------------------------------------------------
-- 1. Storage bucket
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence', 'evidence', false, 26214400,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies for this bucket: authenticated/anon can't
-- list, read, write or delete its objects directly. Uploads use one-time
-- signed upload URLs and reads use short-lived signed URLs, both issued by
-- the server after its own checks.

-- ---------------------------------------------------------------------
-- 2. evidence_items: attachment and removal columns
-- ---------------------------------------------------------------------

alter table public.evidence_items alter column external_url drop not null;
alter table public.evidence_items
  add column storage_path text unique,
  add column content_type text,
  add column size_bytes bigint,
  add column sha256 text,
  add column removed_at timestamptz,
  add column removed_by uuid,
  add column removal_reason text,
  add constraint evidence_items_link_or_file check (
    (external_url is not null) <> (storage_path is not null)
  ),
  add constraint evidence_items_file_metadata check (
    storage_path is null
    or (content_type is not null and size_bytes between 1 and 26214400 and sha256 ~ '^[0-9a-f]{64}$')
  ),
  add constraint evidence_items_removal check (
    (removed_at is null and removed_by is null and removal_reason is null)
    or (removed_at is not null and nullif(btrim(removal_reason), '') is not null)
  );

-- ---------------------------------------------------------------------
-- 3. Which evidence went into which export
-- ---------------------------------------------------------------------

create table public.project_export_evidence (
  export_id uuid not null references public.project_exports (id) on delete cascade,
  -- No foreign key: the record of what an export contained must not depend
  -- on the evidence row (which is retained anyway, see below).
  evidence_item_id uuid not null,
  primary key (export_id, evidence_item_id)
);

create index project_export_evidence_item_idx on public.project_export_evidence (evidence_item_id);

alter table public.project_export_evidence enable row level security;

create policy project_export_evidence_select
  on public.project_export_evidence
  for select
  to authenticated
  using (exists (
    select 1 from public.project_exports x
    where x.id = export_id and private.can_access_workspace(x.workspace_id)
  ));

revoke insert, update, delete, truncate on public.project_export_evidence
  from public, anon, authenticated, service_role;
grant select on public.project_export_evidence to authenticated;

create trigger project_export_evidence_forbid_update
  before update on public.project_export_evidence
  for each row execute function private.forbid_mutation();
create trigger project_export_evidence_forbid_delete
  before delete on public.project_export_evidence
  for each row execute function private.forbid_mutation();
create trigger project_export_evidence_forbid_truncate
  before truncate on public.project_export_evidence
  for each statement execute function private.forbid_mutation();

-- Runs inside approve_and_export_project / record_project_export, after
-- they have locked the project and verified the fingerprint, so the set
-- recorded here is exactly the evidence the stored files were built from.
create or replace function private.record_export_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_export_evidence (export_id, evidence_item_id)
  select new.id, e.id
  from public.evidence_items e
  where e.project_id = new.project_id and e.removed_at is null;
  return null;
end;
$$;

create trigger project_exports_record_evidence
  after insert on public.project_exports
  for each row execute function private.record_export_evidence();

-- Exports already on record: evidence that existed (and was not removed --
-- nothing was, before this migration) when each export was created.
insert into public.project_export_evidence (export_id, evidence_item_id)
select x.id, e.id
from public.project_exports x
join public.evidence_items e on e.project_id = x.project_id and e.created_at <= x.generated_at
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. Retention guards on evidence_items
-- ---------------------------------------------------------------------

create or replace function private.guard_evidence_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.project_export_evidence x where x.evidence_item_id = old.id) then
      raise exception 'this evidence is part of an export and is kept: remove it instead (it stays on record)';
    end if;
    return old;
  end if;

  if old.removed_at is not null then
    raise exception 'removed evidence is kept as history and cannot be changed';
  end if;
  if new.project_id is distinct from old.project_id
     or new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256
     or new.size_bytes is distinct from old.size_bytes
     or new.content_type is distinct from old.content_type then
    raise exception 'an evidence file cannot be replaced: add a new item instead';
  end if;
  return new;
end;
$$;

create trigger evidence_items_guard_change
  before update or delete on public.evidence_items
  for each row execute function private.guard_evidence_item_change();

-- ---------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------

-- Checks before an upload URL is issued: Owner, project open for work.
-- Returns the workspace id the object path must start with.
create or replace function public.prepare_evidence_upload(p_project_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_project public.projects;
  v_client_status text;
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
  return v_project.workspace_id;
end;
$$;

revoke execute on function public.prepare_evidence_upload(uuid) from public, anon, service_role;
grant execute on function public.prepare_evidence_upload(uuid) to authenticated;

create or replace function public.add_evidence_attachment(
  p_project_id uuid,
  p_category text,
  p_storage_path text,
  p_original_filename text,
  p_content_type text,
  p_size_bytes bigint,
  p_sha256 text,
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
  v_object_size bigint;
  v_object_type text;
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

  -- The stored object itself, not the app's word for it.
  if p_storage_path not like v_workspace_id::text || '/' || p_project_id::text || '/%' then
    raise exception 'the file is not stored under this project';
  end if;
  select (o.metadata ->> 'size')::bigint, o.metadata ->> 'mimetype'
    into v_object_size, v_object_type
  from storage.objects o
  where o.bucket_id = 'evidence' and o.name = p_storage_path;
  if not found then
    raise exception 'the uploaded file was not found';
  end if;
  if v_object_size is distinct from p_size_bytes or v_object_type is distinct from p_content_type then
    raise exception 'the uploaded file does not match what was checked';
  end if;

  insert into public.evidence_items (
    workspace_id, project_id, category, original_filename, storage_path, content_type,
    size_bytes, sha256, verification_status, evidence_date, notes, created_by
  ) values (
    v_workspace_id, p_project_id, p_category, p_original_filename, p_storage_path, p_content_type,
    p_size_bytes, p_sha256, coalesce(p_verification_status, 'UNVERIFIED'), p_evidence_date, p_notes, auth.uid()
  )
  returning * into v_item;

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

revoke execute on function public.add_evidence_attachment(uuid, text, text, text, text, bigint, text, text, date, text)
  from public, anon, service_role;
grant execute on function public.add_evidence_attachment(uuid, text, text, text, text, bigint, text, text, date, text)
  to authenticated;

drop function public.delete_evidence_item(uuid, uuid);

-- Removes evidence from the project's current evidence. Kept (marked
-- removed, file retained) when it is part of any export; deleted otherwise.
-- Returns the outcome and, for a deleted file, its storage path so the app
-- can delete the object.
create or replace function public.remove_evidence_item(
  p_item_id uuid,
  p_project_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_from_status text;
  v_item public.evidence_items;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_outcome text;
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
  if v_reason is null then
    raise exception 'give a reason for removing this evidence';
  end if;

  select * into v_item from public.evidence_items
  where id = p_item_id and project_id = p_project_id
  for update;
  if v_item.id is null then
    raise exception 'evidence item % not found on project %', p_item_id, p_project_id;
  end if;
  if v_item.removed_at is not null then
    raise exception 'this evidence was already removed';
  end if;

  if exists (select 1 from public.project_export_evidence x where x.evidence_item_id = p_item_id) then
    update public.evidence_items
      set removed_at = now(), removed_by = auth.uid(), removal_reason = v_reason
      where id = p_item_id;
    v_outcome := 'RETAINED';
  else
    delete from public.evidence_items where id = p_item_id;
    v_outcome := 'DELETED';
  end if;

  if v_from_status = 'APPROVED' then
    update public.projects set readiness_status = 'READY_FOR_REVIEW' where id = p_project_id;
    insert into public.project_approval_events (
      workspace_id, project_id, event_type, from_status, to_status, reason, actor_id
    ) values (
      v_workspace_id, p_project_id, 'INVALIDATED', 'APPROVED', 'READY_FOR_REVIEW',
      'Evidence item removed after approval: ' || v_reason, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'storage_path', case when v_outcome = 'DELETED' then v_item.storage_path end
  );
end;
$$;

revoke execute on function public.remove_evidence_item(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.remove_evidence_item(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Export inputs: current (not removed) evidence, with file details
-- ---------------------------------------------------------------------

create or replace function private.project_export_inputs(p_project_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id,
      'project_name', p.project_name,
      'project_type', p.project_type,
      'custom_type_label', p.custom_type_label,
      'default_currency', p.default_currency,
      'export_language', p.export_language
    ),
    'client', jsonb_build_object(
      'display_name', cb.display_name,
      'record_type', cb.record_type,
      'country', cb.country
    ),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'question_key', a.question_key,
        'status', a.status,
        'value', a.value
      ) order by a.question_key)
      from public.project_answers a
      where a.project_id = p.id
    ), '[]'::jsonb),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', e.category,
        'original_filename', e.original_filename,
        'external_url', e.external_url,
        'verification_status', e.verification_status,
        'evidence_date', e.evidence_date,
        'attachment', case when e.storage_path is null then null else jsonb_build_object(
          'content_type', e.content_type,
          'size_bytes', e.size_bytes,
          'sha256', e.sha256
        ) end
      ) order by e.created_at, e.id)
      from public.evidence_items e
      where e.project_id = p.id and e.removed_at is null
    ), '[]'::jsonb)
  )
  from public.projects p
  join public.client_businesses cb on cb.id = p.client_business_id
  where p.id = p_project_id
$$;

-- ---------------------------------------------------------------------
-- 7. Export archiving (append-only events)
-- ---------------------------------------------------------------------

create table public.project_export_archive_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  export_id uuid not null references public.project_exports (id) on delete cascade,
  event_type text not null check (event_type in ('ARCHIVED', 'RESTORED')),
  reason text,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create index project_export_archive_events_export_idx on public.project_export_archive_events (export_id, seq desc);

alter table public.project_export_archive_events enable row level security;

create policy project_export_archive_events_select
  on public.project_export_archive_events
  for select
  to authenticated
  using (private.can_access_workspace(workspace_id));

revoke insert, update, delete, truncate on public.project_export_archive_events
  from public, anon, authenticated, service_role;
grant select on public.project_export_archive_events to authenticated;

create trigger project_export_archive_events_forbid_update
  before update on public.project_export_archive_events
  for each row execute function private.forbid_mutation();
create trigger project_export_archive_events_forbid_delete
  before delete on public.project_export_archive_events
  for each row execute function private.forbid_mutation();
create trigger project_export_archive_events_forbid_truncate
  before truncate on public.project_export_archive_events
  for each statement execute function private.forbid_mutation();

create or replace function public.set_export_archived(p_export_id uuid, p_archived boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.project_exports;
  v_current text;
begin
  select * into v_export from public.project_exports where id = p_export_id;
  if v_export.id is null then
    raise exception 'export % not found', p_export_id;
  end if;
  if not private.is_workspace_owner(v_export.workspace_id) then
    raise exception 'not authorized';
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
    nullif(btrim(coalesce(p_reason, '')), ''), auth.uid()
  );
end;
$$;

revoke execute on function public.set_export_archived(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.set_export_archived(uuid, boolean, text) to authenticated;
