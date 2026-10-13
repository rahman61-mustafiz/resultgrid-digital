-- Fix for 20261008100000_lifecycle_archive_delete_rules.sql.
--
-- private.enforce_new_project() and private.assert_project_accepts_work()
-- take row locks (SELECT ... FOR SHARE) on client_businesses / projects.
-- A row lock needs UPDATE privilege on the table, and `authenticated` has
-- none on either (all project writes and client status changes go
-- through SECURITY DEFINER RPCs). As trigger functions they ran with the
-- caller's privileges, so a direct insert by the Owner -- creating a
-- project, a share link, a creative, a target -- failed with "permission
-- denied". They now run as their owner; they only read the parent rows and
-- raise, and are not callable directly (trigger functions).

alter function private.enforce_new_project() security definer;
alter function private.assert_project_accepts_work() security definer;
