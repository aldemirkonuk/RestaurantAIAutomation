-- ADR 0229 fork 7, the founder 2026-09-27, item 72, verbatim label: "Bind
-- invite to address (Recommended)". An invitation verifies the account it
-- creates only when the address typed at the join is the address the invite
-- was made for; with no address, or another one, the account starts
-- unverified and the person proves the address once through /verify-email.
--
-- Until now the address typed when minting an invite (`InviteDto.targetEmail`)
-- was written only to the pending `team_members` row, never to the invite, so
-- `AuthService.joinViaInvite` had nothing to compare the joiner's address with
-- and verified whatever was typed.
--
-- Additive and nullable: an invite minted with no address, and every invite
-- minted before this, carries NULL and never verifies anyone. Written and read
-- only by the gateway (service_role); client grants on this table were revoked
-- by 20260825210000_od72_revoke_client_grants.sql. Stored trimmed and
-- lower-cased by the gateway (`normalizeEmail`).

alter table public.organization_invites
  add column if not exists target_email text;

comment on column public.organization_invites.target_email is
  'The address this invite was made for, trimmed and lower-cased; NULL = none. '
  'A join with exactly this address creates a verified account (ADR 0229 fork 7).';
