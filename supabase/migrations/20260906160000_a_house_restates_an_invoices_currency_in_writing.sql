-- A house restates an invoice's currency, in writing — founder 2026-09-06
-- (batch 63): "take the houses own currency, but AI needs to or otherwise house
-- delibaretly chnage it to other currency if the invoice is other than their
-- default".
--
-- ---------------------------------------------------------------------------
-- WHAT THIS TABLE IS FOR
-- ---------------------------------------------------------------------------
-- The founder's third rule. `procurement_documents.currency` holds what an
-- invoice's money is filed under RIGHT NOW; a manager may change it, and the
-- change has to leave a record that outlives the row it changed. Without one,
-- the only surviving evidence of a re-denomination is the new value, and
-- "this invoice was always in EUR" and "somebody restated it as EUR last
-- Tuesday" become the same sentence.
--
-- The shape is the one `beverage_identity_decisions`
-- (`20260906030000_a_confirmation_is_a_logged_decision.sql`) already uses for
-- the same job: append-only, who three ways, and what the person was looking at
-- when they decided.
--
-- ---------------------------------------------------------------------------
-- WHY `previous_currency` IS NULLABLE AND `new_currency` IS NOT
-- ---------------------------------------------------------------------------
-- NOT RECORDED is the commonest prior state this table will see, and it is the
-- one the change exists to fix. Rule 1 of the same decision refuses an invoice's
-- money outright when neither the document nor the house states a currency, and
-- rule 2 holds it when the model saw a different one — both leave
-- `procurement_documents.currency` NULL. So the previous value is genuinely
-- absent on the majority of rows, and a NOT NULL column would force a writer to
-- invent `'USD'` for it, which is the exact defect this whole decision removes
-- (ADR 0117 Q25; `20260905120000_a_house_names_its_money.sql`).
--
-- `new_currency` is NOT NULL because there is no such thing as changing an
-- invoice's currency TO nothing. Clearing one back to unrecorded is a different
-- act, and it is not built: nothing in the founder's decision asks for it, and a
-- column that accepts NULL on both sides would make "restated as EUR" and
-- "unset" indistinguishable in the log.
--
-- ---------------------------------------------------------------------------
-- WHY THE MONEY THAT MOVED IS STORED HERE
-- ---------------------------------------------------------------------------
-- `money_refiled` is what the re-filing actually wrote: the header figures and
-- the line count that came back off `procurement_documents.extracted`, plus the
-- figures that were there before. It is stored on the LOG rather than derived
-- later because the derivation would need the document as it was at that
-- moment, and the document is the thing that changed.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE DOES NOT DO
-- ---------------------------------------------------------------------------
--   * It writes no data. Not one INSERT or UPDATE. No existing document's
--     currency is corrected here: three production houses are known to carry a
--     wrong `restaurants.currency` and correcting rows is a script a person runs
--     (`scripts/correct_restaurant_currency.py`), never a migration that rides a
--     merge.
--   * It adds no seal. `scripts/check_money_routes_are_sealed.py` scopes the
--     seal to `payment-methods`, `billing` and `communications/text/credits` —
--     the routes that change what the HOUSE IS CHARGED. No procurement route is
--     sealed today, and sealing one route in an unsealed module would leave the
--     other twelve doors on the same page open while looking like a policy.
--     The gate here is role plus this log.
--
-- ADDITIVE. One table, two indexes, one append-only trigger, RLS on,
-- anon/authenticated revoked. No table altered, no column dropped, no data
-- written. No explicit BEGIN/COMMIT: the Supabase CLI wraps each file in a
-- transaction.
SET local statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.procurement_document_currency_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  document_id UUID NOT NULL
    REFERENCES public.procurement_documents(id) ON DELETE CASCADE,

  -- The one deliberate copy from the document. The log is read PER HOUSE, and a
  -- filter on a PostgREST embed is not a filter on the outer rows.
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE RESTRICT,

  -- NULL means the document's money was NOT RECORDED before this change, which
  -- is what rules 1 and 2 leave behind. It never means USD.
  previous_currency CHARACTER VARYING(3)
    CHECK (previous_currency IS NULL OR previous_currency ~ '^[A-Z]{3}$'),

  new_currency CHARACTER VARYING(3) NOT NULL
    CHECK (new_currency ~ '^[A-Z]{3}$'),

  -- WHO, three ways, because one of them decays.
  --
  -- `changed_by` references `public.users(user_id)`. NOT `auth.users`: the two
  -- tables are DISJOINT in this database and share zero ids, so an actor FK to
  -- `auth.users` 23503s on every write and no CI check can catch it, because a
  -- fresh database has no rows to violate.
  changed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The name as it was. Stored rather than joined because `changed_by` is
  -- ON DELETE SET NULL, and a foreign key that forgets is not an audit trail.
  changed_by_label CHARACTER VARYING(200) NOT NULL
    CHECK (btrim(changed_by_label) <> ''),
  -- The role as it was. A restatement by an owner and one by a manager are
  -- different facts, and a person's role changes.
  changed_by_role CHARACTER VARYING(20) NOT NULL
    CHECK (btrim(changed_by_role) <> ''),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The document's status at the moment of the change, so a restatement of a
  -- verified document is legible as one.
  document_status CHARACTER VARYING(30),

  -- What the re-filing wrote, and what was there before it. See the header.
  money_refiled JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Why, in the person's own words. Optional: a manager correcting an obvious
  -- misreading should not have to write an essay, and a required field people
  -- fill with "." records nothing.
  reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A change that changes nothing is not a change. Without this a page with a
  -- sticky button writes a log of identical rows, and the log stops being
  -- readable as a history.
  CONSTRAINT pdcc_currency_actually_changed CHECK (
    previous_currency IS NULL OR previous_currency <> new_currency
  )
);

-- "What happened to this document", in order.
CREATE INDEX IF NOT EXISTS idx_pdcc_document
  ON public.procurement_document_currency_changes (document_id, changed_at DESC);

-- The per-house read: this house's restatements, newest first.
CREATE INDEX IF NOT EXISTS idx_pdcc_house
  ON public.procurement_document_currency_changes (restaurant_id, changed_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.pdcc_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'procurement_document_currency_changes is append-only: % is not permitted. Changing a currency back is a NEW row, not an edit to the row that recorded the first change.',
    TG_OP;
END
$function$;

COMMENT ON FUNCTION public.pdcc_append_only() IS
  'Refuses UPDATE and DELETE on the invoice-currency log. An audit trail the application can rewrite records what the application currently believes, which is what procurement_documents.currency already is.';

DROP TRIGGER IF EXISTS trg_pdcc_append_only
  ON public.procurement_document_currency_changes;
CREATE TRIGGER trg_pdcc_append_only
  BEFORE UPDATE OR DELETE ON public.procurement_document_currency_changes
  FOR EACH ROW EXECUTE FUNCTION public.pdcc_append_only();

-- ---------------------------------------------------------------------------
-- Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.procurement_document_currency_changes
  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pdcc_service_role
  ON public.procurement_document_currency_changes;
CREATE POLICY pdcc_service_role
  ON public.procurement_document_currency_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.procurement_document_currency_changes
  FROM anon, authenticated;

COMMENT ON TABLE public.procurement_document_currency_changes IS
  'Append-only log of every deliberate restatement of an invoice''s currency (founder 2026-09-06: the house may deliberately change it when the invoice is other than their default). One row per change, naming who (id, name and role AS THEY WERE), when, the previous value and the new one, the document''s status at the time, and what the re-filing moved. procurement_documents.currency holds the CURRENT answer; this holds the history, which is the only thing that can tell a restated invoice from one that always said so.';
COMMENT ON COLUMN public.procurement_document_currency_changes.previous_currency IS
  'What the document was filed under before, or NULL for NOT RECORDED — the state rules 1 and 2 of the same decision leave behind when neither the paper nor the house states a currency, or when the model saw a different one. NULL never means USD.';
COMMENT ON COLUMN public.procurement_document_currency_changes.money_refiled IS
  'What the re-filing actually wrote: the header figures and line count taken back off procurement_documents.extracted, beside the figures that were there before. Stored on the log rather than derived later, because the derivation would need the document as it was at that moment and the document is what changed.';
COMMENT ON COLUMN public.procurement_document_currency_changes.changed_by IS
  'public.users.user_id — the id the JWT carries. NOT auth.users: the two tables are disjoint in this database and an actor FK to auth.users fails on every write.';

-- ---------------------------------------------------------------------------
-- In-file assertions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls BOOLEAN;
  grants BIGINT;
  probe_doc UUID;
  probe_house UUID;
  probe_row UUID;
  refused BOOLEAN := FALSE;
BEGIN
  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = 'public.procurement_document_currency_changes'::regclass;
  IF NOT rls THEN
    RAISE EXCEPTION 'procurement_document_currency_changes was created without RLS. A log of who changed money is not a table to leave open.';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'procurement_document_currency_changes'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'anon/authenticated still hold % grant(s) on procurement_document_currency_changes.', grants;
  END IF;

  -- Prove the append-only trigger against a REAL update rather than trusting
  -- that creating a trigger means it fires. A guard nobody exercised is a guard
  -- nobody has seen work.
  SELECT id, restaurant_id INTO probe_doc, probe_house
    FROM public.procurement_documents LIMIT 1;
  IF probe_doc IS NOT NULL THEN
    INSERT INTO public.procurement_document_currency_changes
      (document_id, restaurant_id, previous_currency, new_currency,
       changed_by_label, changed_by_role, reason)
    VALUES
      (probe_doc, probe_house, NULL, 'XTS',
       'migration probe', 'migration', 'append-only proof; deleted below')
    RETURNING id INTO probe_row;

    BEGIN
      UPDATE public.procurement_document_currency_changes
         SET new_currency = 'XTT' WHERE id = probe_row;
    EXCEPTION WHEN others THEN
      refused := TRUE;
    END;

    IF NOT refused THEN
      RAISE EXCEPTION 'The append-only trigger did not refuse an UPDATE. The log can be rewritten, which makes it a cache of the current belief rather than a history.';
    END IF;

    -- Remove the probe. DELETE is refused by the same trigger, so it is
    -- disabled for exactly this statement and re-enabled immediately.
    ALTER TABLE public.procurement_document_currency_changes
      DISABLE TRIGGER trg_pdcc_append_only;
    DELETE FROM public.procurement_document_currency_changes WHERE id = probe_row;
    ALTER TABLE public.procurement_document_currency_changes
      ENABLE TRIGGER trg_pdcc_append_only;
  ELSE
    RAISE NOTICE 'No procurement_documents row exists, so the append-only trigger was created but NOT exercised. It is proved on any database that holds one.';
  END IF;

  RAISE NOTICE 'procurement_document_currency_changes created, RLS on, anon/authenticated revoked, 0 rows written.';
END $$;
