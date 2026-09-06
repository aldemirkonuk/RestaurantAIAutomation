-- A one-tap action names people who exist. (2026-09-05; the first real
-- one-tap action. Additive; no table is created and none is edited in place.)
--
-- THE DEFECT, MEASURED — AND IT IS TWO COLUMNS, NOT ONE
-- ----------------------------------------------------
-- `one_tap_actions` carries two person columns, and the production baseline
-- (`20260805000000_baseline_from_production.sql`) points BOTH at `auth.users(id)`:
--   * `executed_by`  — baseline :12814, the person who carried the action out;
--   * `user_id`      — baseline :12854, the person who raised it.
-- The values written into them are `user.userId` from the JWT strategy, and
-- that is `public.users.user_id` (`auth/strategies/jwt.strategy.ts:56`):
-- `one-tap-actions.service.ts` writes `user_id` in createAction (:207) and
-- `executed_by` in execute (:524).
--
-- Those two tables are DISJOINT. Measured in production on 2026-09-01 and
-- written down in `20260901150000_order_line_capture_and_units.sql:220-225`:
-- `auth.users` held 5 rows, `public.users` held 7, and **zero** `public.users`
-- ids appear in `auth.users`. Supabase manages `auth.users`; this codebase does
-- not populate it for its own accounts.
--
-- So every `POST /one-tap-actions/:id/execute` raises 23503 on `executed_by`,
-- and every human-raised `POST /one-tap-actions` raises 23503 on `user_id`.
-- Only the house's own rows (createSystemAction, `user_id` NULL) could ever be
-- written. CI could not see either: a migrated-from-empty test database has
-- no rows for a foreign key to violate, which is the exact blind spot the
-- [[auth-users-and-public-users-are-disjoint]] note exists for.
--
-- The first draft of this file (2026-09-05, morning) repointed `executed_by`
-- only, and ASSERTED that `user_id` had no key at all — read off the CREATE
-- TABLE, not off the ALTERs that follow it. The schema-parity replay refused
-- it (P0001 "user_id grew a foreign key") because the baseline creates that
-- key at :12854. The assertion was the wrong premise, not a wrong schema; it is
-- gone, and the column it misdescribed is repointed with its sibling.
--
-- THE FIX IS THE ONE THIS REPOSITORY ALREADY CHOSE
-- ------------------------------------------------
-- `20260901150000` repointed `procurement_orders.created_by` at
-- `public.users(user_id) ON DELETE SET NULL` for exactly this reason, and
-- counted the precedent while it was there: 11 FKs across the migrations point
-- at `public.users(user_id)` — every actor-attribution column on the app's own
-- tables — against 5 at `auth.users(id)`, of which these are two.
--
-- SET NULL is kept on both: an action does not stop having been raised or
-- carried out because the person has left. Both columns stay nullable: an
-- absent author is the structural proof that the house raised the row rather
-- than a person (createSystemAction vs createAction), and that stays exactly
-- as writable as it was.
--
-- Idempotent: each constraint is dropped before it is created.

-- ---------------------------------------------------------------------------
-- 1. Rows that name nobody at all.
-- ---------------------------------------------------------------------------
-- A value present in NEITHER table names no person and cannot be preserved;
-- it is set to NULL, which is what "we do not know who" means here.
--
-- A value present in `auth.users` but NOT in `public.users` is a REAL
-- attribution that this migration must not silently discard, so it raises
-- instead. There should be none — the constraints being repointed are the
-- reason no such row can have been written by the application — and if one
-- exists it is a human's question, not a migration's.

DO $$
DECLARE
  orphans   int;
  auth_only int;
BEGIN
  SELECT count(*) INTO auth_only
    FROM public.one_tap_actions ota
   WHERE (ota.executed_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.executed_by)
          AND EXISTS (SELECT 1 FROM auth.users a WHERE a.id = ota.executed_by))
      OR (ota.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.user_id)
          AND EXISTS (SELECT 1 FROM auth.users a WHERE a.id = ota.user_id));

  IF auth_only > 0 THEN
    RAISE EXCEPTION
      '% one_tap_actions row(s) are attributed to an auth.users id with no public.users counterpart. Repointing the keys would erase a real attribution; resolve these by hand first.',
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

  UPDATE public.one_tap_actions ota
     SET user_id = NULL
   WHERE ota.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.user_id);
  GET DIAGNOSTICS orphans = ROW_COUNT;
  IF orphans > 0 THEN
    RAISE NOTICE 'cleared % one_tap_actions.user_id value(s) that named nobody in either table', orphans;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The keys point where the values actually come from.
-- ---------------------------------------------------------------------------

ALTER TABLE public.one_tap_actions
  DROP CONSTRAINT IF EXISTS one_tap_actions_executed_by_fkey;

ALTER TABLE public.one_tap_actions
  ADD CONSTRAINT one_tap_actions_executed_by_fkey
  FOREIGN KEY (executed_by) REFERENCES public.users(user_id) ON DELETE SET NULL;

ALTER TABLE public.one_tap_actions
  DROP CONSTRAINT IF EXISTS one_tap_actions_user_id_fkey;

ALTER TABLE public.one_tap_actions
  ADD CONSTRAINT one_tap_actions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.one_tap_actions.executed_by IS
  'The person who carried the action out: public.users.user_id, which is what the JWT carries. It referenced auth.users(id) from the baseline until 2026-09-05, and those two tables share no ids, so every execute raised 23503.';

COMMENT ON COLUMN public.one_tap_actions.user_id IS
  'The person who raised the action, or NULL when the house raised it itself (createSystemAction). public.users.user_id, which is what the JWT carries. It referenced auth.users(id) from the baseline until 2026-09-05, and those two tables share no ids, so every human-raised action raised 23503.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  col    text;
  target text;
  bad    int;
BEGIN
  FOREACH col IN ARRAY ARRAY['executed_by', 'user_id'] LOOP
    SELECT confrelid::regclass::text INTO target
      FROM pg_constraint
     WHERE conrelid = to_regclass('public.one_tap_actions')
       AND conname = 'one_tap_actions_' || col || '_fkey';

    IF target IS NULL THEN
      RAISE EXCEPTION 'one_tap_actions.% has no foreign key — a row could name anybody', col;
    END IF;

    IF target <> 'users' AND target <> 'public.users' THEN
      RAISE EXCEPTION 'one_tap_actions.% still points at %, which the JWT never holds', col, target;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.one_tap_actions')
         AND conname = 'one_tap_actions_' || col || '_fkey'
         AND confdeltype = 'n'
    ) THEN
      RAISE EXCEPTION 'one_tap_actions.% no longer SET NULLs on delete — a departing person would delete the record of what was done', col;
    END IF;
  END LOOP;

  SELECT count(*) INTO bad
    FROM public.one_tap_actions ota
   WHERE (ota.executed_by IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.executed_by))
      OR (ota.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = ota.user_id));
  IF bad > 0 THEN
    RAISE EXCEPTION '% one_tap_actions row(s) name a person that does not exist', bad;
  END IF;

  -- Both columns stay nullable: a house-raised row has no author, on purpose.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'one_tap_actions'
       AND column_name IN ('user_id', 'executed_by') AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'one_tap_actions.user_id / executed_by must stay nullable — an absent author is the structural proof the house raised the row';
  END IF;

  -- Worded without the literal DDL phrase: check_fk_targets_exist.py models the
  -- schema from static DDL and reads a quoted foreign-key phrase as dynamic DDL
  -- it cannot model, which makes it exit 2 rather than judge this file.
  RAISE NOTICE 'a one-tap action names real people: both person keys now point at the users table this app writes, ON DELETE SET NULL, and both columns stay nullable.';
END
$$;
