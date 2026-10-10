-- F-899 — the role tapped on get-started step 01 is kept with the house.
--
-- WHAT WAS WRONG. ADR 0213 row 9 makes "role (one tap, none preselected)" an
-- optional field on step 01 (You). The chips were drawn and the tap was kept
-- in sessionStorage('mudavym:arrival-role') only: no request carried it and
-- nothing read it back, so the field asked a question and dropped the answer.
--
-- WHAT THIS MIGRATION DOES. One nullable column on the membership row that
-- already says who this person is in this house:
--
--   user_restaurant_access.job_role  text NULL
--     CHECK (job_role IN ('owner','general_manager','beverage_lead','chef'))
--
--   * It is what they DO here, not what they MAY do: access stays `role`
--     (owner / manager / staff), and nothing reads job_role for a right.
--   * NULL is "did not say" (none preselected, row 9), and every row that
--     exists today stays NULL. No backfill: nobody's answer was ever kept.
--   * Per house, on the row a removal deletes, so it never outlives the
--     membership. Written once, by `AuthService.createFirstHouse` from the
--     validated `jobRole` of POST /auth/register/house (CreateFirstHouseDto,
--     JOB_ROLES — the same four as this CHECK).
--
-- LOCKED DOWN. No client writes it: user_restaurant_access has RLS on with
-- SELECT policies only, and anon/authenticated hold no write grant on it
-- (OD-72). The assertion below re-checks that on the live catalogue, since a
-- self-claimed role a client could write would be the first column here that
-- a member sets about themself.
--
-- Additive and idempotent: one nullable column, no default, no table rewrite,
-- no row written or deleted.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

SET local statement_timeout = '120s';

ALTER TABLE public.user_restaurant_access
  ADD COLUMN IF NOT EXISTS job_role TEXT;

ALTER TABLE public.user_restaurant_access
  DROP CONSTRAINT IF EXISTS user_restaurant_access_job_role_check;
ALTER TABLE public.user_restaurant_access
  ADD CONSTRAINT user_restaurant_access_job_role_check
  CHECK (job_role IS NULL OR job_role IN ('owner', 'general_manager', 'beverage_lead', 'chef'));

COMMENT ON COLUMN public.user_restaurant_access.job_role IS
  'The role this person said they hold in this house, one tap on get-started step 01 (ADR 0213 row 9: optional, none preselected; F-899). What they do, not what they may do: access is `role`. NULL = did not say. Written by the gateway on house opening only.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_restaurant_access'
       AND column_name = 'job_role'
       AND is_nullable = 'YES'
       AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'user_restaurant_access.job_role is missing, not nullable, or defaulted';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_restaurant_access'::regclass
       AND conname = 'user_restaurant_access_job_role_check'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'user_restaurant_access.job_role has no CHECK';
  END IF;
  IF (SELECT count(*) FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'user_restaurant_access'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')) > 0
     OR (SELECT count(*) FROM information_schema.column_privileges
       WHERE table_schema = 'public' AND table_name = 'user_restaurant_access'
         AND column_name = 'job_role'
         AND grantee IN ('anon', 'authenticated')
         AND privilege_type IN ('INSERT', 'UPDATE')) > 0 THEN
    RAISE EXCEPTION 'anon/authenticated may write user_restaurant_access.job_role';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.user_restaurant_access'::regclass) THEN
    RAISE EXCEPTION 'user_restaurant_access has row level security off';
  END IF;
  RAISE NOTICE 'user_restaurant_access.job_role is in place: nullable, checked, written by the gateway only.';
END
$$;
