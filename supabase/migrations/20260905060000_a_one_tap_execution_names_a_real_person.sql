-- A one-tap execution names a person who exists. (2026-09-05; the first real
-- one-tap action. Additive; no table is created and none is edited in place.)
--
-- THE DEFECT, MEASURED
-- --------------------
-- `one_tap_actions.executed_by` has carried a foreign key to `auth.users(id)`
-- since the production baseline (`20260805000000_baseline_from_production.sql`
-- :12814). The value written into it is `user.userId` from the JWT strategy,
-- and that is `public.users.user_id` (`auth/strategies/jwt.strategy.ts:56`).
--
-- Those two tables are DISJOINT. Measured in production on 2026-09-01 and
-- written down in `20260901150000_order_line_capture_and_units.sql:220-225`:
-- `auth.users` held 5 rows, `public.users` held 7, and **zero** `public.users`
-- ids appear in `auth.users`. Supabase manages `auth.users`; this codebase does
-- not populate it for its own accounts.
--
-- So every `POST /one-tap-actions/:id/execute` raises 23503 on the foreign key.
-- The dashboard rail's die has never been able to complete an action against
-- production, and CI could not see it: a migrated-from-empty test database has
-- no rows for a foreign key to violate, which is the exact blind spot the
-- [[auth-users-and-public-users-are-disjoint]] note exists for.
--
-- THE FIX IS THE ONE THIS REPOSITORY ALREADY CHOSE
-- ------------------------------------------------
-- `20260901150000` repointed `procurement_orders.created_by` at
-- `public.users(user_id) ON DELETE SET NULL` for exactly this reason, and
-- counted the precedent while it was there: 11 FKs across the migrations point
-- at `public.users(user_id)` — every actor-attribution column on the app's own
-- tables — against 5 at `auth.users(id)`, of which this is one.
--
-- SET NULL is kept: an action does not stop having been carried out because the
-- person who carried it out has left.
--
-- `one_tap_actions.user_id` (the AUTHOR) is deliberately untouched. It carries
-- no foreign key at all, and it is load-bearing precisely as it is: an absent
-- author is the structural proof that the house raised the row rather than a
-- person (`one-tap-actions.service.ts` createSystemAction vs createAction).
-- Constraining a column that already holds data is a different change with a
-- different risk, and it is not this one.
--
-- Idempotent: the constraint is dropped before it is created.

-- ---------------------------------------------------------------------------
-- 1. Rows that name nobody at all.
-- ---------------------------------------------------------------------------
-- A value present in NEITHER table names no person and cannot be preserved;
-- it is set to NULL, which is what "we do not know who" means here.
--
-- A value present in `auth.users` but NOT in `public.users` is a REAL
-- attribution that this migration must not silently discard, so it raises
-- instead. There should be none — the constraint being repointed is the reason
-- no such row can have been written by the application — and if one exists it
-- is a human's question, not a migration's.

DO $$
DECLARE
  orphans int;
  auth_only int;
BEGIN
  SELECT count(*) INTO auth_only
    FROM public.one_tap_actions ota
   WHERE ota.executed_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.executed_by)
     AND EXISTS (SELECT 1 FROM auth.users a WHERE a.id = ota.executed_by);

  IF auth_only > 0 THEN
    RAISE EXCEPTION
      '% one_tap_actions row(s) are attributed to an auth.users id with no public.users counterpart. Repointing the key would erase a real attribution; resolve these by hand first.',
      auth_only;
  END IF;

  UPDATE public.one_tap_actions ota
     SET executed_by = NULL
   WHERE ota.executed_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.executed_by);
  GET DIAGNOSTICS orphans = ROW_COUNT;

  IF orphans > 0 THEN
    RAISE NOTICE 'cleared % one_tap_actions.executed_by value(s) that named nobody in either table', orphans;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The key points where the value actually comes from.
-- ---------------------------------------------------------------------------

ALTER TABLE public.one_tap_actions
  DROP CONSTRAINT IF EXISTS one_tap_actions_executed_by_fkey;

ALTER TABLE public.one_tap_actions
  ADD CONSTRAINT one_tap_actions_executed_by_fkey
  FOREIGN KEY (executed_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.one_tap_actions.executed_by IS
  'The person who carried the action out: public.users.user_id, which is what the JWT carries. It referenced auth.users(id) from the baseline until 2026-09-05, and those two tables share no ids, so every execute raised 23503.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  target text;
  bad    int;
BEGIN
  SELECT confrelid::regclass::text INTO target
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.one_tap_actions')
     AND conname = 'one_tap_actions_executed_by_fkey';

  IF target IS NULL THEN
    RAISE EXCEPTION 'one_tap_actions.executed_by has no foreign key — an execution could name anybody';
  END IF;

  IF target <> 'users' AND target <> 'public.users' THEN
    RAISE EXCEPTION 'one_tap_actions.executed_by still points at %, which the JWT never holds', target;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.one_tap_actions')
       AND conname = 'one_tap_actions_executed_by_fkey'
       AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'one_tap_actions.executed_by no longer SET NULLs on delete — a departing manager would delete the record of what they did';
  END IF;

  SELECT count(*) INTO bad
    FROM public.one_tap_actions ota
   WHERE ota.executed_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.executed_by);
  IF bad > 0 THEN
    RAISE EXCEPTION '% one_tap_actions row(s) name an executor that does not exist', bad;
  END IF;

  -- The author column stays as it was, on purpose. An assertion so a later
  -- pass cannot "tidy" it without noticing that an absent author is the proof
  -- the house raised the row.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.one_tap_actions')
       AND conname = 'one_tap_actions_user_id_fkey'
  ) THEN
    RAISE EXCEPTION 'one_tap_actions.user_id grew a foreign key — an absent author is the structural proof the house raised the row and must stay writable as NULL';
  END IF;

  -- Worded without the literal DDL phrase: check_fk_targets_exist.py models the
  -- schema from static DDL and reads a quoted foreign-key phrase as dynamic DDL
  -- it cannot model, which makes it exit 2 rather than judge this file.
  RAISE NOTICE 'a one-tap execution names a real person: the executor key now points at the users table this app writes, ON DELETE SET NULL, and the author column is untouched.';
END
$$;
