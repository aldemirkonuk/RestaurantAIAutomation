-- `user_restaurant_access.role` is one of three known roles, and an omitted
-- role is the least privileged one.
--
-- WHY THIS EXISTS
-- ---------------
-- The column is declared `character varying(50) DEFAULT 'manager'` with no
-- constraint at all (baseline `20260805000000_baseline_from_production.sql:5814`).
-- Two things follow, and both were live:
--
-- 1. ANY 50-CHARACTER STRING IS A ROLE. `'Staff'`, `'server'`, `'MANAGER'` —
--    nothing rejects them. Every reader compares exactly:
--    `TeamService.assertAccess` does `role === "owner"` / `role === "staff"`,
--    and `RecipientResolverService.getUserIdsForRoles` does
--    `.in("role", roles)`. So a single mis-cased write does not raise, does not
--    log, and does not deny the user anything visible — it silences their
--    notifications permanently, and nothing in the system can tell that from a
--    user who simply has nothing to be notified about.
--    ([[absence-reported-as-health]].)
--
-- 2. AN OMITTED ROLE IS A MANAGER. A future insert that forgets the column
--    creates a manager of the restaurant. That is privilege by omission, the
--    same shape as `users.role DEFAULT 'manager'` (which ADR 0088 stops
--    `assertAccess` from trusting on the read side).
--
-- MEASURED BEFORE WRITING, ON PRODUCTION `exzueerziesmczwlhomd`, 2026-09-02
-- --------------------------------------------------------------------------
--   user_restaurant_access                     11 rows
--     role = 'owner'                            8
--     role = 'manager'                          3
--     role NULL or outside the three            0   <- the CHECK passes today
--   organization_invites                        2 rows, both role = 'manager',
--                                               0 with a NULL role
--   every one of the 4 code sites that INSERTs into user_restaurant_access
--   passes `role` explicitly (auth.service.ts:719 'owner', :1177 and :1335
--   invite.role, members.service.ts:336 the validated DTO role) — so changing
--   the DEFAULT changes the behaviour of no existing writer.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does not add NOT NULL. A NULL role already fails CLOSED everywhere it is
-- read (`assertAccess` throws on a falsy role; `.in("role", …)` never matches
-- NULL), so NOT NULL would buy no safety and would add a new 500 path for an
-- invite whose own role column is null. The 0-row measurement above says that
-- does not happen today; the point is that making it an error is not this
-- migration's job.
--
-- It does not touch `users.role`, which has the same `DEFAULT 'manager'`
-- problem. That column is read by paths outside /team; ADR 0088 fixes the /team
-- read instead of changing a column the whole application shares.

ALTER TABLE public.user_restaurant_access
    ALTER COLUMN role SET DEFAULT 'staff';

-- NOT VALID first, then VALIDATE: the validation pass takes only a SHARE UPDATE
-- EXCLUSIVE lock instead of blocking writes for the length of a full scan. The
-- table has 11 rows today, so this is form rather than necessity — but the form
-- is what makes the same statement safe on the table this becomes.
ALTER TABLE public.user_restaurant_access
    DROP CONSTRAINT IF EXISTS user_restaurant_access_role_known;

ALTER TABLE public.user_restaurant_access
    ADD CONSTRAINT user_restaurant_access_role_known
    CHECK (role IN ('owner', 'manager', 'staff'))
    NOT VALID;

ALTER TABLE public.user_restaurant_access
    VALIDATE CONSTRAINT user_restaurant_access_role_known;

COMMENT ON CONSTRAINT user_restaurant_access_role_known
    ON public.user_restaurant_access IS
    'ADR 0088. Every reader compares this column exactly (=== / IN), so a '
    'mis-cased or invented value denies silently rather than raising. '
    'Verified against production 2026-09-02: only owner and manager exist.';
