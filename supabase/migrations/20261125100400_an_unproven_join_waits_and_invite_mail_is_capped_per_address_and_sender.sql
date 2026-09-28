-- ADR 0229 forks 11 and 13, the founder 2026-09-28 (round 15).
--
-- Fork 13, item 82, verbatim label: "Hold until accepted (Recommended)". A
-- house membership granted by an invite join before the joiner's address was
-- proved (a join from the minter's copied link, or an existing account that
-- is still unverified) is written HELD: `is_active = false` and `held_since`
-- set. Every gateway read that admits someone to a house requires
-- `is_active` (the four gateway reads that do not are "is there already a
-- row?" checks, which should see a held row), and the joiner's
-- `users.restaurant_id` is left NULL so the legacy users-row fallback admits
-- nothing either; so a held row grants nothing. (The baseline's older client
-- policies join `auth.uid()` to this table without `is_active`; `auth.uid()`
-- is an `auth.users` id, disjoint from `public.users`, so they match no
-- gateway account, held or not.) It becomes an ordinary
-- active membership only when the person, with a verified session, accepts it
-- (`AuthService.acceptHeldMembership`). Rows are never deleted for this.
--
-- held_since: when the held row was written; NULL for every other row. A row
--   is never both held and active (the check below). Accepting sets it NULL
--   and `is_active` true in one compare-and-set. Inserting a row that is
--   already inactive fires neither `user_restaurant_access_end_is_remembered`
--   nor `..._deactivation_is_remembered` (20260926120000: both need
--   `old.is_active`), so a held row never reads as a removal.
--
-- Fork 11, item 83, verbatim label: "Per address + per sender". Invite mails
-- stay capped at 20 per house per 24 h, and are now also capped per target
-- address across all houses (3 per 24 h) and per minting person (50 per 24 h).
-- The gateway counts `organization_invites` rows with `emailed_at` in the
-- window by `target_email` and by `invited_by`; the two partial indexes below
-- serve those counts the way `organization_invites_house_emailed_at_idx`
-- (the fork 9 migration, an_invite_is_mailed_with_a_secret_only_the_mail_carries)
-- serves the per-house one. No column is added for fork 11.
--
-- Additive: one nullable column, one check that every existing row satisfies
-- (all hold NULL), two indexes. Written and read only by the gateway
-- (service_role): user_restaurant_access has SELECT-only client policies, and
-- client grants on organization_invites were revoked by
-- 20260825210000_od72_revoke_client_grants.sql.

alter table public.user_restaurant_access
  add column if not exists held_since timestamptz;

alter table public.user_restaurant_access
  drop constraint if exists user_restaurant_access_held_is_never_active;
alter table public.user_restaurant_access
  add constraint user_restaurant_access_held_is_never_active
  check (held_since is null or not is_active);

comment on column public.user_restaurant_access.held_since is
  'When an invite join granted this membership before the joiner''s address '
  'was proved (ADR 0229 fork 13). While set, the row is inactive and grants '
  'nothing; the proven person accepting it clears it. NULL = not held.';

create index if not exists organization_invites_address_emailed_at_idx
  on public.organization_invites (target_email, emailed_at)
  where emailed_at is not null;

create index if not exists organization_invites_sender_emailed_at_idx
  on public.organization_invites (invited_by, emailed_at)
  where emailed_at is not null;
