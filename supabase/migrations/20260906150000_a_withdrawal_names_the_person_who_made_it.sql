-- A withdrawal names the person who made it, in words (ADR 0126 §7; the
-- founder, 2026-09-06, batch 61 Q1: "Add withdrawn_by_name now").
--
-- WHY THIS COLUMN EXISTS
-- ----------------------
-- `20260905240000_a_manager_states_what_a_code_means.sql` gave a STATEMENT two
-- author columns — `declared_by` (the account, an FK a reader follows) and
-- `declared_by_name` (the name AS IT WAS on the day, an attestation a rename
-- next year must not rewrite). It gave a WITHDRAWAL only the first: `withdrawn_by`
-- is an account id and nothing else. So the register could say WHEN a statement
-- was withdrawn and WHY, but not BY WHOM in words, and the panel said exactly
-- that rather than printing a uuid as if it were a person.
--
-- A withdrawal is the same kind of act as the statement it ends: someone stood
-- behind it, and a year later the question is who. There is no reason for the
-- two acts to be recorded to different standards, and one asymmetric pair of
-- columns is how a register quietly becomes unanswerable.
--
-- WHAT THIS DELIBERATELY IS NOT
-- -----------------------------
--  * NOT a join to `public.users.name`. The same reason `declared_by_name` is
--    stored: a person renamed next year did not make a different withdrawal,
--    and a deleted account would erase the answer entirely. The FK stays for
--    the reader who wants the live account; this column is the attestation.
--  * NOT nullable-when-withdrawn. A withdrawal with an account id and no name
--    is the state this migration exists to remove, so the CHECK below makes the
--    name present EXACTLY when `withdrawn_at` is — the same "all or none" shape
--    `distributor_price_code_mappings_withdrawal_is_whole` already enforces
--    over the other three columns.
--  * NOT backfilled. There is no name to backfill WITH. Inventing one, or
--    writing 'unknown' into an attestation column, would be this product
--    signing a person's act for them. Instead the assertion below REFUSES to
--    run if any withdrawn row lacks a name, and says how many — a migration
--    that stops is recoverable; a fabricated signature is not.
--
-- The additive shape is on purpose: the existing `_withdrawal_is_whole`
-- constraint is left exactly as it is rather than dropped and rewritten to
-- mention a fourth column. Dropping a live CHECK to widen it opens a window in
-- which the old rule is not enforced, and the two constraints together say the
-- same thing the one would have.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The name
-- ---------------------------------------------------------------------------

ALTER TABLE public.distributor_price_code_mappings
  ADD COLUMN IF NOT EXISTS withdrawn_by_name TEXT;

COMMENT ON COLUMN public.distributor_price_code_mappings.withdrawn_by_name IS
  'The name of the person who withdrew this statement, AS IT WAS on the day they withdrew it. Stored rather than joined, for the same reason declared_by_name is: an attestation is not rewritten by a rename, and it survives the account being deleted. Present exactly when withdrawn_at is (ADR 0126 §7).';

-- ---------------------------------------------------------------------------
-- 2. Present exactly when the withdrawal is
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  unnamed BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'distributor_price_code_mappings'
       AND column_name = 'withdrawn_by_name'
  ) THEN
    RAISE EXCEPTION
      'distributor_price_code_mappings.withdrawn_by_name is missing; a withdrawal would still name an account and no person';
  END IF;

  -- Nothing is invented. If a withdrawal already exists with no name, this
  -- migration STOPS and says how many, because the alternative is writing a
  -- signature nobody gave.
  SELECT count(*) INTO unnamed
    FROM public.distributor_price_code_mappings
   WHERE withdrawn_at IS NOT NULL
     AND btrim(coalesce(withdrawn_by_name, '')) = '';
  IF unnamed > 0 THEN
    RAISE EXCEPTION
      '% withdrawn mapping(s) carry no withdrawn_by_name. There is no name to backfill with and none will be invented: name them from the account in withdrawn_by, by hand, and re-run.', unnamed;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'distributor_price_code_mappings_withdrawer_is_named'
       AND conrelid = to_regclass('public.distributor_price_code_mappings')
  ) THEN
    ALTER TABLE public.distributor_price_code_mappings
      ADD CONSTRAINT distributor_price_code_mappings_withdrawer_is_named CHECK (
        (withdrawn_at IS NULL AND withdrawn_by_name IS NULL)
        OR (withdrawn_at IS NOT NULL
            AND btrim(coalesce(withdrawn_by_name, '')) <> '')
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Assertions — the CHECK is exercised, not merely written
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  probe_user UUID;
  probe_restaurant UUID;
  probe_id UUID;
  admitted_unnamed BOOLEAN;
  admitted_blank BOOLEAN;
  admitted_name_without_withdrawal BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'distributor_price_code_mappings_withdrawer_is_named'
       AND conrelid = to_regclass('public.distributor_price_code_mappings')
  ) THEN
    RAISE EXCEPTION
      'the withdrawer-is-named CHECK was not created; a withdrawal could still be filed under an account id alone';
  END IF;

  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;

  IF probe_user IS NULL OR probe_restaurant IS NULL THEN
    RAISE NOTICE
      'no user or restaurant row exists here, so the CHECK was created but not exercised. It is exercised by the PGlite probe and by the jest suite against the same predicate.';
  ELSE
    INSERT INTO public.distributor_price_code_mappings
      (restaurant_id, distributor_key, code_field, price_code, price_basis,
       evidence, declared_by, declared_by_name)
    VALUES (probe_restaurant, 'probe-withdrawal', 'edi_832_ctp02', 'PRBW',
            'probe basis', 'probe evidence', probe_user, 'Probe Manager')
    RETURNING id INTO probe_id;

    -- (a) A whole withdrawal with no name is refused.
    BEGIN
      UPDATE public.distributor_price_code_mappings
         SET withdrawn_at = NOW(),
             withdrawn_by = probe_user,
             withdrawn_reason = 'probe'
       WHERE id = probe_id;
      admitted_unnamed := true;
    EXCEPTION WHEN check_violation THEN
      admitted_unnamed := false;
    END;
    IF admitted_unnamed THEN
      RAISE EXCEPTION
        'a withdrawal was admitted with an account id and no name; the register would say when and why but not by whom';
    END IF;

    -- (b) A blank name is refused too, so the column cannot be satisfied with
    --     whitespace and read as a signature.
    BEGIN
      UPDATE public.distributor_price_code_mappings
         SET withdrawn_at = NOW(),
             withdrawn_by = probe_user,
             withdrawn_reason = 'probe',
             withdrawn_by_name = '   '
       WHERE id = probe_id;
      admitted_blank := true;
    EXCEPTION WHEN check_violation THEN
      admitted_blank := false;
    END;
    IF admitted_blank THEN
      RAISE EXCEPTION
        'a withdrawal was admitted with a blank withdrawn_by_name; whitespace is not a person';
    END IF;

    -- (c) A name with no withdrawal is refused: the column says a withdrawal
    --     happened, and a live statement did not have one.
    BEGIN
      UPDATE public.distributor_price_code_mappings
         SET withdrawn_by_name = 'Probe Manager'
       WHERE id = probe_id;
      admitted_name_without_withdrawal := true;
    EXCEPTION WHEN check_violation THEN
      admitted_name_without_withdrawal := false;
    END;
    IF admitted_name_without_withdrawal THEN
      RAISE EXCEPTION
        'a live mapping was admitted carrying a withdrawer''s name; the name would claim a withdrawal that never happened';
    END IF;

    -- (d) A whole, named withdrawal is accepted.
    UPDATE public.distributor_price_code_mappings
       SET withdrawn_at = NOW(),
           withdrawn_by = probe_user,
           withdrawn_reason = 'probe',
           withdrawn_by_name = 'Probe Manager'
     WHERE id = probe_id;

    IF NOT EXISTS (
      SELECT 1 FROM public.distributor_price_code_mappings
       WHERE id = probe_id AND withdrawn_by_name = 'Probe Manager'
    ) THEN
      RAISE EXCEPTION
        'a named withdrawal was not written; the register would still hold no person for it';
    END IF;

    DELETE FROM public.distributor_price_code_mappings WHERE id = probe_id;
  END IF;

  RAISE NOTICE
    'distributor_price_code_mappings.withdrawn_by_name added (present exactly when withdrawn_at is, blank refused, no backfill and none invented).';
END
$$;
