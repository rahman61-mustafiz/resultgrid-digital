-- Fixes two integrity gaps in the PIN-protected share-link flow found in
-- review:
--
-- 1. The "verified" cookie was a static value ("1") checked only for
--    presence. Since the cookie name itself is derived from the token
--    (which is public -- it's in the URL), anyone with the link could set
--    `rg_share_<token>=1` themselves (curl, a browser devtools call, a
--    proxy) and skip the PIN entirely; httpOnly only stops the page's own
--    JS from doing this, not an external client crafting the request. The
--    fix is a server-issued random session nonce: the cookie holds the
--    raw nonce, the DB holds only its hash (so leaking the DB doesn't leak
--    live sessions), and access requires both.
-- 2. There was no limit on PIN attempts -- a 6-digit numeric PIN is only
--    1,000,000 combinations, trivially brute-forced by an unthrottled
--    script once someone has the token. Add a failure counter and a
--    temporary lockout.

alter table public.client_share_links
  add column session_nonce_hash text,
  add column session_nonce_expires_at timestamptz,
  add column failed_pin_attempts integer not null default 0,
  add column locked_until timestamptz;
