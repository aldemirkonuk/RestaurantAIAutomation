-- A password reset or change signs out every other session of that person.
--
-- ADR 0225; the founder, 2026-09-25 (round 4, item 17): "Password
-- reset/change signs out every other session."
--
-- The gateway mints its own JWTs (apps/api-gateway/src/auth/auth.service.ts
-- generateTokens): a 15-minute access token and a 7-day refresh token, both
-- stateless, and nothing recorded which tokens a person held. This column is
-- the one piece of state that makes them revocable: every token carries the
-- version it was minted under (claim `sv`), and the HTTP guard, the refresh
-- route and the websocket handshake refuse a token below the person's current
-- version. Setting a password writes the new hash and `session_version + 1`
-- in one compare-and-set update, so the password and the end of the old
-- sessions cannot come apart. See apps/api-gateway/src/auth/session-version.ts.
--
-- Existing rows start at 0, the version every token minted before this
-- shipped reads as, so nobody is signed out by the deploy itself.

alter table public.users
  add column if not exists session_version integer not null default 0;

alter table public.users
  drop constraint if exists users_session_version_not_negative;
alter table public.users
  add constraint users_session_version_not_negative check (session_version >= 0);

comment on column public.users.session_version is
  'ADR 0225: bumped by one, in the same update as password_hash, on every password reset or change. '
  'Tokens carry the version they were minted under (JWT claim sv); a token below this value belongs '
  'to a signed-out session and is refused by the gateway (HTTP, refresh, websocket).';
