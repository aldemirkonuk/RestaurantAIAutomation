-- ADR 0229 fork 9, the founder 2026-09-27, item 77, verbatim label: "Email
-- invite + (c) interim (Recommended)". The address an invite names
-- (`target_email`, 20261125100200) is only the word of whoever minted it, so
-- a match alone proves nothing about the joiner's mailbox. The gateway now
-- mails the invite to that address with a second secret that exists only in
-- that mail, and a join verifies only when it carries the secret AND the
-- address matches. The minter's copied link still joins, unverified.
--
-- email_secret_hash: SHA-256 (hex) of that secret; NULL when the invite named
--   no address, was never mailed, or its mail was refused by the house's
--   allowance. NULL never verifies anyone, so every invite minted before this
--   verifies nobody (item 77's "(c) interim", inherent).
-- emailed_at: when the invite's mail was claimed against its house's
--   allowance (item 77: "rate-limit invite emails per house"); NULL when not.
--   The gateway counts a house's non-NULL rows in the last day, after writing
--   its own, before it sends.
--
-- Additive and nullable. Written and read only by the gateway (service_role);
-- client grants on this table were revoked by
-- 20260825210000_od72_revoke_client_grants.sql.

alter table public.organization_invites
  add column if not exists email_secret_hash text,
  add column if not exists emailed_at timestamptz;

alter table public.organization_invites
  drop constraint if exists organization_invites_email_secret_hash_shape;
alter table public.organization_invites
  add constraint organization_invites_email_secret_hash_shape
  check (email_secret_hash is null or email_secret_hash ~ '^[0-9a-f]{64}$');

create index if not exists organization_invites_house_emailed_at_idx
  on public.organization_invites (restaurant_id, emailed_at)
  where emailed_at is not null;

comment on column public.organization_invites.email_secret_hash is
  'SHA-256 (hex) of the secret mailed only to target_email; a join verifies '
  'only with that secret and that address (ADR 0229 fork 9). NULL = none.';
comment on column public.organization_invites.emailed_at is
  'When this invite''s mail was claimed against its house''s daily allowance '
  '(ADR 0229 fork 9); NULL = not mailed.';
