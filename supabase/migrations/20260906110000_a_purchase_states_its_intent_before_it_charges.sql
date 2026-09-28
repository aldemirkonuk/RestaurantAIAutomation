-- A purchase states its intent before it charges (ADR 0121 addendum; founder,
-- 2026-09-05 batch 57: *"Close it now with the intent row."*)
--
-- THE WINDOW THIS CLOSES, AND WHY IT EXISTED
-- ------------------------------------------
-- `POST /communications/text-credits/purchase` charged the card and then wrote
-- the credit. Between those two steps there was nothing on disk: if the process
-- died there, the money had moved and no row in this database knew it. The
-- route reported `charged: true, recorded: false` and asked a person to
-- reconcile from a sentence — which is a report, not a mechanism.
--
-- The fix is the oldest one there is: WRITE THE INTENT FIRST. A row exists
-- before the provider is touched, so every later state of the world is
-- reachable from something durable:
--
--   intended            the row is written and NOTHING has been sent. If the
--                       process dies here, no charge exists.
--   charge_may_exist    the row is written and the provider HAS been asked, or
--                       is about to be. Whether money moved is unknown. This is
--                       the state the old window left no trace of, and it is set
--                       BEFORE the call rather than after it — a state set after
--                       the call cannot describe a crash during the call.
--   settled             the charge succeeded, the PaymentIntent id is on the
--                       row, and the credit entry it produced is named.
--   voided              proven that no charge will land: the provider refused,
--                       or a reconcile searched and found nothing after the
--                       search index had had time to catch up.
--
-- NO DEFAULT ON `state`. An insert that omits it must fail; a default of
-- `intended` would let a forgotten field read as "nothing was sent", which is
-- the one wrong answer that loses money silently.
--
-- ONE INTENT PER SEAL. The seal is single-use, so a second intent on the same
-- seal is either a replay or a bug, and both must fail rather than produce two
-- rows a reconcile would have to choose between.
--
-- WHAT THIS FILE DOES NOT DO. It does not make the purchase atomic. PostgREST
-- gives this codebase no multi-statement transaction, and the honest shape is
-- therefore a durable intent plus a reconcile, not a claim of atomicity. The
-- reconcile is `PurchaseIntentReconciler` and
-- `scripts/reconcile_message_credit_purchases.py`.
--
-- ADDITIVE. One new table. No column added to an existing one, no constraint
-- relaxed. Idempotent. No explicit BEGIN/COMMIT — the CLI wraps each file.

CREATE TABLE IF NOT EXISTS public.house_message_purchase_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The seal that authorised this purchase, and the handle the reconcile uses:
  -- `chargeCardOnFile` stamps it into the PaymentIntent's metadata, so a search
  -- by this id is what answers "did the money move" when nothing else can.
  -- UNIQUE because the seal is single-use.
  seal_id UUID NOT NULL,

  -- What was intended, recorded BEFORE the provider is asked, so a reconcile
  -- can tell whether the charge it finds is the charge that was meant.
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),

  -- NO DEFAULT. See the header.
  state TEXT NOT NULL CHECK (state IN (
    'intended',
    'charge_may_exist',
    'settled',
    'voided'
  )),

  intended_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  intended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- When the provider was first asked. NULL while the state is `intended`, and
  -- it is what the reconcile ages against: an empty search on a row asked about
  -- ten seconds ago proves nothing, because Stripe's search index runs behind.
  charge_attempted_at TIMESTAMPTZ,

  -- Filled on settle.
  payment_ref TEXT,
  credit_entry_id UUID
    REFERENCES public.house_message_credits(id) ON DELETE SET NULL,
  settled_at TIMESTAMPTZ,

  -- Filled on void.
  voided_at TIMESTAMPTZ,
  void_reason TEXT,

  -- Every reconcile leaves a mark, whether or not it changed the row. A
  -- reconcile that found nothing to do and wrote nothing is indistinguishable
  -- from a reconcile that never ran, which is the shape this repo calls
  -- absence-reported-as-health.
  reconciled_at TIMESTAMPTZ,
  reconcile_detail TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A SETTLED INTENT NAMES THE PAYMENT AND THE CREDIT IT PRODUCED. Without both
  -- halves, "settled" would be a word rather than a link, and a reconcile could
  -- not tell a settled row from one somebody marked settled.
  CONSTRAINT house_message_purchase_intents_settled_is_complete CHECK (
    state <> 'settled'
    OR (payment_ref IS NOT NULL AND credit_entry_id IS NOT NULL AND settled_at IS NOT NULL)
  ),

  -- A VOIDED INTENT SAYS WHEN AND WHY. "Voided" with no reason is a row nobody
  -- can audit, and voiding is the operation that throws away the claim that a
  -- charge might exist.
  CONSTRAINT house_message_purchase_intents_voided_is_explained CHECK (
    state <> 'voided'
    OR (voided_at IS NOT NULL AND length(btrim(coalesce(void_reason, ''))) >= 10)
  ),

  -- A ROW THAT SAYS A CHARGE MAY EXIST MUST SAY WHEN IT WAS ASKED FOR. That
  -- timestamp is the only thing standing between a slow search index and a
  -- reconcile that voids a real charge.
  CONSTRAINT house_message_purchase_intents_may_exist_has_time CHECK (
    state <> 'charge_may_exist' OR charge_attempted_at IS NOT NULL
  ),

  -- AN `intended` ROW HAS ASKED NOTHING. If it carried a payment reference or an
  -- attempt time, the state would be lying about what has already happened.
  CONSTRAINT house_message_purchase_intents_intended_is_untouched CHECK (
    state <> 'intended'
    OR (charge_attempted_at IS NULL AND payment_ref IS NULL AND credit_entry_id IS NULL)
  )
);

COMMENT ON TABLE public.house_message_purchase_intents IS
  'What a house MEANT to buy, written before the provider is asked (ADR 0121 addendum; founder 2026-09-05: "Close it now with the intent row"). It closes the window where a charge could succeed and the credit fail with nothing on disk to say so. state=''charge_may_exist'' is set BEFORE the provider call, because a state set after it cannot describe a crash during it. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_message_purchase_intents.state IS
  'intended — written, nothing sent. charge_may_exist — the provider has been asked or is about to be; whether money moved is UNKNOWN. settled — charge succeeded, payment and credit both named. voided — proven no charge will land. NO DEFAULT: an omitted state would read as "nothing was sent", the one wrong answer that loses money silently.';
COMMENT ON COLUMN public.house_message_purchase_intents.charge_attempted_at IS
  'When the provider was first asked. The reconcile ages an empty search against it: Stripe''s search index runs behind, so an empty result on a young row proves nothing and must never be read as "no charge exists".';

CREATE UNIQUE INDEX IF NOT EXISTS uq_house_message_purchase_intents_seal
  ON public.house_message_purchase_intents (seal_id);

-- The reconcile's own query: everything not yet resolved, oldest first.
CREATE INDEX IF NOT EXISTS idx_house_message_purchase_intents_open
  ON public.house_message_purchase_intents (restaurant_id, intended_at)
  WHERE state IN ('intended', 'charge_may_exist');

ALTER TABLE public.house_message_purchase_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_message_purchase_intents_service_role
  ON public.house_message_purchase_intents;
CREATE POLICY house_message_purchase_intents_service_role
  ON public.house_message_purchase_intents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_message_purchase_intents FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  has_rls BOOLEAN;
  client_grants INT;
  probe_restaurant UUID;
  probe_seal UUID := gen_random_uuid();
  rejected BOOLEAN;
BEGIN
  IF to_regclass('public.house_message_purchase_intents') IS NULL THEN
    RAISE EXCEPTION 'house_message_purchase_intents did not apply';
  END IF;

  SELECT relrowsecurity INTO has_rls
  FROM pg_class WHERE oid = 'public.house_message_purchase_intents'::regclass;
  IF NOT has_rls THEN
    RAISE EXCEPTION 'RLS is not enabled on public.house_message_purchase_intents';
  END IF;

  SELECT count(*) INTO client_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'house_message_purchase_intents'
    AND grantee IN ('anon', 'authenticated');
  IF client_grants > 0 THEN
    RAISE EXCEPTION
      'anon/authenticated still hold % grants on house_message_purchase_intents',
      client_grants;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'house_message_purchase_intents'
      AND column_name = 'state' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'house_message_purchase_intents.state must have no default: an omitted state would read as "nothing was sent"';
  END IF;

  -- `credit_entry_id` must be ON DELETE SET NULL, not CASCADE: deleting a credit
  -- entry must not delete the record that a charge happened.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public.house_message_purchase_intents'::regclass
      AND c.contype = 'f'
      AND a.attname = 'credit_entry_id'
      AND c.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION
      'house_message_purchase_intents.credit_entry_id is not ON DELETE SET NULL — deleting a credit would erase the record that money moved';
  END IF;

  -- PROVE the four state constraints bite.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_restaurant IS NOT NULL THEN
    -- (a) settled with no payment or credit
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_purchase_intents
        (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
         charge_attempted_at, payment_ref, credit_entry_id, settled_at,
         voided_at, void_reason, reconciled_at, reconcile_detail)
      VALUES (probe_restaurant, probe_seal, 5000, 'USD', 'settled', NULL,
              NOW(), NULL, NULL, NOW(), NULL, NULL, NULL, NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_purchase_intents WHERE seal_id = probe_seal;
      RAISE EXCEPTION 'a settled intent with no payment and no credit was accepted';
    END IF;

    -- (b) voided with no reason
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_purchase_intents
        (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
         charge_attempted_at, payment_ref, credit_entry_id, settled_at,
         voided_at, void_reason, reconciled_at, reconcile_detail)
      VALUES (probe_restaurant, probe_seal, 5000, 'USD', 'voided', NULL,
              NOW(), NULL, NULL, NULL, NOW(), 'no', NULL, NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_purchase_intents WHERE seal_id = probe_seal;
      RAISE EXCEPTION 'a voided intent with a two-character reason was accepted';
    END IF;

    -- (c) charge_may_exist with no attempt time
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_purchase_intents
        (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
         charge_attempted_at, payment_ref, credit_entry_id, settled_at,
         voided_at, void_reason, reconciled_at, reconcile_detail)
      VALUES (probe_restaurant, probe_seal, 5000, 'USD', 'charge_may_exist', NULL,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_purchase_intents WHERE seal_id = probe_seal;
      RAISE EXCEPTION 'an intent claiming a charge may exist, with no attempt time, was accepted';
    END IF;

    -- (d) `intended` carrying an attempt time
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_purchase_intents
        (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
         charge_attempted_at, payment_ref, credit_entry_id, settled_at,
         voided_at, void_reason, reconciled_at, reconcile_detail)
      VALUES (probe_restaurant, probe_seal, 5000, 'USD', 'intended', NULL,
              NOW(), NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_purchase_intents WHERE seal_id = probe_seal;
      RAISE EXCEPTION 'an "intended" intent carrying an attempt time was accepted';
    END IF;

    -- (e) two intents on one seal
    INSERT INTO public.house_message_purchase_intents
      (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
       charge_attempted_at, payment_ref, credit_entry_id, settled_at,
       voided_at, void_reason, reconciled_at, reconcile_detail)
    VALUES (probe_restaurant, probe_seal, 5000, 'USD', 'intended', NULL,
            NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_purchase_intents
        (restaurant_id, seal_id, amount_minor, currency, state, intended_by,
         charge_attempted_at, payment_ref, credit_entry_id, settled_at,
         voided_at, void_reason, reconciled_at, reconcile_detail)
      VALUES (probe_restaurant, probe_seal, 7000, 'USD', 'intended', NULL,
              NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
    EXCEPTION WHEN unique_violation THEN rejected := TRUE;
    END;
    DELETE FROM public.house_message_purchase_intents WHERE seal_id = probe_seal;
    IF NOT rejected THEN
      RAISE EXCEPTION 'two intents on one seal were accepted — a reconcile would have to choose between them';
    END IF;
  END IF;
  -- On a fresh CI database `restaurants` is empty and the probes above do not
  -- run. Stated rather than hidden.
END $$;
