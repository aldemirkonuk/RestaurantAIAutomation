-- Confirming an invoice's currency is the same logged act as changing it.
--
-- THE FOUNDER, 2026-09-06, batch 64, verbatim:
--   "do option 1 recomemneded, stock proceeds refuse the price at receving, and
--    let them approve if otherwise"
--
-- ---------------------------------------------------------------------------
-- WHAT "APPROVE IF OTHERWISE" NEEDS THAT THE LOG COULD NOT HOLD
-- ---------------------------------------------------------------------------
-- `20260906160000_a_house_restates_an_invoices_currency_in_writing.sql` built
-- the restatement log for rule 3, and closed it against no-op rows:
--
--   CONSTRAINT pdcc_currency_actually_changed CHECK (
--     previous_currency IS NULL OR previous_currency <> new_currency
--   )
--
-- That was right for the act it was built for. It is wrong for the act the
-- founder added a batch later. Receiving now REFUSES a keyed-in unit price for
-- a document whose money is held or refused, and the act that clears the hold
-- is a manager saying which currency is right -- INCLUDING when the right one is
-- the one the file would already have taken. A manager who looks at a held
-- invoice, sees that the model misread a glyph, and says "no, USD is correct"
-- has made a decision, and under the CHECK above that decision was a 409 with
-- nothing recorded. The hold could then only be cleared by naming a currency
-- the manager did not believe in.
--
-- So the log gains the distinction rather than losing the constraint:
--
--   * `change_kind = 'restated'`   -- the currency moved. previous <> new, or
--                                    previous was NOT RECORDED.
--   * `change_kind = 'confirmed'`  -- the currency did not move and a person
--                                    said it is right anyway. previous = new.
--
-- A confirmation is NOT a weaker row. It carries the same author, the same
-- role, the same moment and the same `money_refiled` payload, because it does
-- the same thing to the document: it ends the hold and prices the paper. The
-- only difference is that the code either side of it is the same, and the row
-- says so in a word rather than leaving a reader to infer it from two equal
-- columns.
--
-- ---------------------------------------------------------------------------
-- WHY `change_kind` IS NULLABLE AND NOT DEFAULTED
-- ---------------------------------------------------------------------------
-- Every row this product will ever write states it -- the gateway sets it on
-- both paths. NULL is reserved for rows written before this column existed, and
-- there are none: 20260906160000 is unreleased and writes only its own probe
-- row, which it deletes. A NOT NULL with a DEFAULT would be the cheaper spelling
-- and it would also make "this row predates the distinction" impossible to say,
-- which is the [[absence-reported-as-health]] shape in an audit table. NULL here
-- reads as "not stated", and the CHECK below still refuses the one combination
-- that would be a lie: a row calling itself a confirmation whose two codes
-- differ.
--
-- ADDITIVE. One column, two CHECKs replacing one, two comments. No table
-- created, no column dropped, no data written, no RLS change (the table's own
-- RLS, revokes and append-only trigger from 20260906160000 are untouched and
-- are re-asserted at the bottom of this file rather than assumed).
SET local statement_timeout = '120s';

ALTER TABLE public.procurement_document_currency_changes
  ADD COLUMN IF NOT EXISTS change_kind CHARACTER VARYING(20);

COMMENT ON COLUMN public.procurement_document_currency_changes.change_kind IS
  'restated (the currency moved) or confirmed (a person said the currency the document already had is right, which ends a hold without changing a code). NULL only for a row written before this column existed. A confirmation is a full decision with the same author, role, moment and money_refiled as a restatement - founder, 2026-09-06 batch 64: "let them approve if otherwise".';

DO $$
BEGIN
  -- Replace the no-op guard rather than dropping it. The behaviour it protected
  -- -- a sticky button writing a log of identical rows -- is still refused; what
  -- changes is that an identical pair is now legible as a deliberate
  -- confirmation when, and only when, the row says it is one.
  ALTER TABLE public.procurement_document_currency_changes
    DROP CONSTRAINT IF EXISTS pdcc_currency_actually_changed;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdcc_change_kind_is_known'
       AND conrelid = to_regclass('public.procurement_document_currency_changes')
  ) THEN
    ALTER TABLE public.procurement_document_currency_changes
      ADD CONSTRAINT pdcc_change_kind_is_known
      CHECK (change_kind IS NULL
             OR change_kind IN ('restated', 'confirmed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pdcc_kind_matches_the_codes'
       AND conrelid = to_regclass('public.procurement_document_currency_changes')
  ) THEN
    -- Both halves of the old guard survive, each attached to the kind it
    -- belongs to:
    --   * a RESTATEMENT whose two codes are equal is the no-op row the original
    --     CHECK refused, and it is still refused.
    --   * a CONFIRMATION whose two codes DIFFER is a row that calls itself one
    --     thing and records another, which is worse than the no-op it replaced.
    --   * a row that states no kind falls back to the original rule exactly.
    ALTER TABLE public.procurement_document_currency_changes
      ADD CONSTRAINT pdcc_kind_matches_the_codes
    --
    -- `previous_currency IS NOT NULL AND previous_currency = new_currency`
    -- rather than the equality alone. MEASURED on PGlite: a bare `=` against a
    -- NULL previous evaluates to NULL, and a CHECK that evaluates to NULL
    -- PASSES -- so a row calling itself a confirmation of a document that had NO
    -- currency would have been admitted, which is the one case that is
    -- unambiguously a restatement (NOT RECORDED -> a code is a change).
      CHECK (
        CASE change_kind
          WHEN 'confirmed' THEN previous_currency IS NOT NULL
                                AND previous_currency = new_currency
          WHEN 'restated'  THEN previous_currency IS NULL
                                OR previous_currency <> new_currency
          ELSE previous_currency IS NULL
               OR previous_currency <> new_currency
        END
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls BOOLEAN;
  grants BIGINT;
  probe_doc UUID;
  probe_house UUID;
  probe_row UUID;
  admitted BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'procurement_document_currency_changes'
       AND column_name = 'change_kind'
  ) THEN
    RAISE EXCEPTION 'change_kind was not added';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'procurement_document_currency_changes'
       AND column_name = 'change_kind'
       AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'change_kind carries a DEFAULT; a defaulted kind would label a row nobody classified';
  END IF;

  -- The table this file alters must still be the locked-down one it inherited.
  -- Re-asserted rather than assumed: an ALTER that silently landed on an open
  -- table is exactly the thing a later reader would take on trust.
  SELECT relrowsecurity INTO rls
    FROM pg_class
   WHERE oid = 'public.procurement_document_currency_changes'::regclass;
  IF NOT rls THEN
    RAISE EXCEPTION 'procurement_document_currency_changes lost RLS';
  END IF;
  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'procurement_document_currency_changes'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION
      'anon/authenticated hold % grant(s) on procurement_document_currency_changes', grants;
  END IF;

  SELECT id, restaurant_id INTO probe_doc, probe_house
    FROM public.procurement_documents LIMIT 1;

  IF probe_doc IS NOT NULL THEN
    -- 1. A CONFIRMATION of an identical pair is now admitted. This is the whole
    --    point of the file and it is proven by writing one, not by reading the
    --    constraint definition back.
    INSERT INTO public.procurement_document_currency_changes
      (document_id, restaurant_id, previous_currency, new_currency,
       change_kind, changed_by_label, changed_by_role, reason)
    VALUES
      (probe_doc, probe_house, 'XTS', 'XTS', 'confirmed',
       'migration probe', 'migration', 'confirmation proof; deleted below')
    RETURNING id INTO probe_row;

    -- 2. A CONFIRMATION whose codes differ is refused.
    BEGIN
      INSERT INTO public.procurement_document_currency_changes
        (document_id, restaurant_id, previous_currency, new_currency,
         change_kind, changed_by_label, changed_by_role)
      VALUES
        (probe_doc, probe_house, 'XTS', 'XXX', 'confirmed',
         'migration probe', 'migration');
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      RAISE EXCEPTION
        'a row calling itself a confirmation recorded two different currencies';
    END IF;

    -- 3. A RESTATEMENT that restates nothing is still refused, which is the
    --    guarantee 20260906160000 made and this file must not have dropped.
    BEGIN
      INSERT INTO public.procurement_document_currency_changes
        (document_id, restaurant_id, previous_currency, new_currency,
         change_kind, changed_by_label, changed_by_role)
      VALUES
        (probe_doc, probe_house, 'XTS', 'XTS', 'restated',
         'migration probe', 'migration');
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      RAISE EXCEPTION
        'a no-op restatement was admitted; the guard 20260906160000 set was lost';
    END IF;

    -- 4. An unknown kind is refused.
    BEGIN
      INSERT INTO public.procurement_document_currency_changes
        (document_id, restaurant_id, previous_currency, new_currency,
         change_kind, changed_by_label, changed_by_role)
      VALUES
        (probe_doc, probe_house, NULL, 'XTS', 'approved',
         'migration probe', 'migration');
      admitted := TRUE;
    EXCEPTION WHEN check_violation THEN
      admitted := FALSE;
    END;
    IF admitted THEN
      RAISE EXCEPTION 'change_kind admitted a value nothing writes';
    END IF;

    -- The probe row leaves nothing behind. The append-only trigger refuses
    -- DELETE, so it is disabled for this statement and restored immediately --
    -- inside the migration's own transaction, so no other session ever sees the
    -- table without its trigger.
    ALTER TABLE public.procurement_document_currency_changes
      DISABLE TRIGGER trg_pdcc_append_only;
    DELETE FROM public.procurement_document_currency_changes WHERE id = probe_row;
    ALTER TABLE public.procurement_document_currency_changes
      ENABLE TRIGGER trg_pdcc_append_only;
  END IF;
END
$$;
