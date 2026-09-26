-- An owner may let a manager see and set pay on /team. ADR 0215.
--
-- THE FOUNDER, 2026-09-25 (round 4, item 19), asked "Team pay/hours (#440)
-- returned three questions. First: what does turning a manager 'on/off'
-- mean?", picked, verbatim:
--
--   "Pay visibility only (Recommended)" -- "The switch decides whether that
--   manager can see and edit pay; their other rights are unchanged."
--
-- Until now the rule was a role alone (ADR 0215, 2026-09-21, "Owner only"):
-- `seesMoney(role)` was `role === "owner"`. The switch is per manager, per
-- house, and it lives on the membership row that already decides that
-- person's role here, so it goes when the membership goes (a removal deletes
-- the row) and it never outlives the house.
--
-- `team_pay_access` is read by the gateway only for a caller whose role here
-- is `manager`: an owner sees pay regardless, and staff never do, whatever
-- the column says. Default `false`: every manager today stays as the
-- 2026-09-21 pick left them until an owner switches them on. Only an owner
-- writes it (`TeamService.setPayAccess`, `PATCH
-- /restaurants/:rid/team/members/:memberId/pay-access`), and every change is a
-- `team_pay_access_changed` row in `system_audit_log`, with the manager told.
-- No client can write it directly: `user_restaurant_access` has RLS on with
-- SELECT policies only, and anon/authenticated hold no grant on it (OD-72).
--
-- Additive and idempotent: one column added with a constant default (no
-- table rewrite), no row written or deleted.

SET local statement_timeout = '120s';

ALTER TABLE public.user_restaurant_access
  ADD COLUMN IF NOT EXISTS team_pay_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_restaurant_access.team_pay_access IS
  'Whether this MANAGER may see and set pay on /team: wages, shift cost and labour totals (ADR 0215, founder 2026-09-25 round 4 item 19, "Pay visibility only": "The switch decides whether that manager can see and edit pay; their other rights are unchanged"). Read only when role = manager; an owner always sees pay and staff never do. Written only by an owner through the gateway, audited as team_pay_access_changed.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_restaurant_access'
       AND column_name = 'team_pay_access'
       AND is_nullable = 'NO'
       AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'user_restaurant_access.team_pay_access is missing, nullable, or not defaulted to false';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'user_restaurant_access'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) > 0 THEN
    RAISE EXCEPTION 'anon/authenticated may write user_restaurant_access, so a manager could switch their own pay on';
  END IF;
  RAISE NOTICE 'user_restaurant_access.team_pay_access is in place, false for every manager until an owner switches it on.';
END
$$;
