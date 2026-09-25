-- A person who leaves a house loses their calendar link there, for good
-- (ADR 0111, review trail 2026-09-21, round 6t).
--
-- The founder, 2026-09-21, verbatim: "Yes, revoke on leaving (Recommended)".
-- Every door that ends a membership (MembersService.removeMember,
-- TeamService.deleteMember, AuthService.leaveRestaurant,
-- AuthService.deleteAccount) now stops that person's live link in the house,
-- with a system_audit_log row, before its first membership write; and the feed
-- stops a live link whose person has no role in the house any more (a
-- membership that ended outside those doors). A returning person connects
-- again: an old address never serves again.
--
-- Migration 20260925180300 allowed only two revoke reasons. This file adds the
-- third, 'left_house', so those stops can be written and told apart from a
-- person stopping their own link or an owner/manager stopping someone's.
--
-- It supersedes that file's note "What it deliberately does NOT do: revoke a
-- link when a person leaves": the feed still re-reads membership on every
-- request, AND leaving now ends the row.
--
-- Additive: widens one CHECK, drops nothing, rewrites no row. Idempotent: the
-- constraint is dropped if present and re-added under the same name, so a
-- second run leaves the same constraint.

BEGIN;

-- The inline CHECK of 20260925180300 takes Postgres's default name
-- <table>_<column>_check.
ALTER TABLE public.calendar_feed_links
  DROP CONSTRAINT IF EXISTS calendar_feed_links_revoke_reason_check;

ALTER TABLE public.calendar_feed_links
  ADD CONSTRAINT calendar_feed_links_revoke_reason_check CHECK (
    revoke_reason IS NULL
    OR revoke_reason IN ('revoked_by_self', 'revoked_by_manager', 'left_house')
  );

COMMENT ON TABLE public.calendar_feed_links IS
  'Personal calendar (iCal) links: one live row per person per house (ADR 0111, 2026-09-21). token_hash is SHA-256 hex of the secret; the secret is shown once and not stored. What the feed serves is decided at read time from the person''s CURRENT role in the house, and a person who leaves the house has their link stopped for good (revoke_reason left_house, audited), so an old address never serves again. RLS on, service_role only.';

COMMIT;
