-- private.forbid_mutation() was written with a message hardcoded to
-- "security_events rows are immutable", then reused as-is for
-- project_exports' immutability trigger, producing a misleading error
-- there. Make the message name the actual table.

create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable: % is not permitted', tg_table_name, tg_op;
end;
$$;
