-- Keeps archived_at consistent with lifecycle_status automatically. Without
-- this, application code editing lifecycle_status through a generic update
-- form would have to guess whether this is a fresh transition into
-- ARCHIVED (set archived_at = now()) or an unrelated edit to an already-
-- archived row (must NOT bump archived_at again). The database already
-- owns the invariant via projects_archived_consistency; let it also own
-- keeping the value correct, rather than trusting every caller to get it
-- right.

create or replace function private.set_project_archived_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.lifecycle_status = 'ARCHIVED' and (tg_op = 'INSERT' or old.lifecycle_status <> 'ARCHIVED') then
    new.archived_at = now();
  elsif new.lifecycle_status <> 'ARCHIVED' then
    new.archived_at = null;
  end if;
  return new;
end;
$$;

create trigger projects_set_archived_at
  before insert or update on public.projects
  for each row
  execute function private.set_project_archived_at();
