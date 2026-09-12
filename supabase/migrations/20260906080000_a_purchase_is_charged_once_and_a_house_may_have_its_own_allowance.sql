-- A purchase is charged once, and a house may have its own allowance
-- (ADR 0121 addendum; founder answers to questions 7-9, 2026-09-05).
--
-- WHAT THE FOUNDER DECIDED, AND WHAT EACH ANSWER COSTS IN SCHEMA
-- --------------------------------------------------------------
-- Q2, verbatim in intent: *"Wire it to the card on file, sealed."*
--   `POST /communications/text-credits/purchase` charges the house's Stripe
--   instrument BEFORE the credit is written; a refused charge writes nothing and
--   says why. Rejected: leave it unwired.
--
--   Two things follow, and they are the two constraints below.
--
--   (a) **A purchase must name the payment it was charged on.** Until today a
--       purchase could be recorded with `payment_ref` NULL, which was honest
--       when nothing charged and becomes a hole the moment something does:
--       credits appearing with no payment behind them is the exact shape of a
--       balance nobody can audit. `house_message_credits_purchase_is_paid`
--       makes it impossible.
--
--   (b) **A seal buys at most one purchase.** The seal is single-use, so a
--       replayed request cannot reach the charge — but a crash BETWEEN the
--       charge and the write can, and the retry that follows would charge
--       again. Stripe's idempotency key (derived from the seal id) stops the
--       second charge at the provider; this unique index stops the second ROW
--       at the database. Two independent enforcements, because the failure they
--       prevent is a house charged twice and neither of us noticing.
--
-- Q3, verbatim in intent: *"One house first, deliberately, then watch."*
--   The founder sets an allowance on ONE named house and the meter runs there
--   before any plan-wide number.
--
--   `plan_message_allowances` cannot express that. It is keyed on `plan_code`,
--   which maps to `restaurants.subscription_tier`, and that column carries
--   `DEFAULT 'pilot'` on every house that never chose it — so a number written
--   there would land on the whole fleet at once, which is the opposite of what
--   was decided. `house_message_allowances` is the per-house row, it takes
--   precedence over the plan row, and the readout says WHICH of the two it
--   used so a reader is never guessing.
--
-- ADDITIVE. One new table, one new unique index, two new CHECK constraints on
-- an existing table, no column dropped, no constraint relaxed. Idempotent.
-- No explicit BEGIN/COMMIT — the Supabase CLI wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. One house's own allowance.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_message_allowances (
  -- The PRIMARY KEY, not a surrogate id with a unique index beside it: one
  -- house has one allowance, and making that structural means "which of this
  -- house's three allowance rows applies" is a question nobody can ask.
  restaurant_id UUID PRIMARY KEY
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- NULLABLE, and NULL is not zero — the same rule `plan_message_allowances`
  -- carries. A row here with a NULL allowance is a deliberate record that this
  -- house was looked at and no number was set, which is a different fact from
  -- there being no row.
  monthly_allowance INTEGER
    CHECK (monthly_allowance IS NULL OR monthly_allowance >= 0),

  -- WHY, WHO AND WHEN. `stated_source` is the founder's reason in his own
  -- words; `set_by` is the person, when there is a user row for them; `set_via`
  -- says which door it came through and has NO DEFAULT, because "we do not know
  -- how this number got here" must fail the insert rather than read as one of
  -- the two answers.
  stated_source TEXT NOT NULL,
  set_via TEXT NOT NULL CHECK (set_via IN ('founder_script', 'admin_route')),
  set_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A NUMBER CARRIES ITS PROVENANCE. Same twenty-character floor as the plan
  -- table, and the same reason: the thing being prevented is an allowance
  -- seeded by somebody in a hurry and then read by a house as an entitlement it
  -- was granted.
  CONSTRAINT house_message_allowances_number_has_provenance CHECK (
    monthly_allowance IS NULL OR length(btrim(stated_source)) >= 20
  )
);

COMMENT ON TABLE public.house_message_allowances IS
  'ONE house''s message allowance, overriding its plan''s (ADR 0121 addendum, founder question 8: "one house first, deliberately, then watch"). It exists because plan_message_allowances is keyed on plan_code and restaurants.subscription_tier defaults to ''pilot'' on houses that never chose it — a number written there lands on the whole fleet. The readout names which of the two rows it used. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_message_allowances.set_via IS
  'founder_script — scripts/set_house_message_allowance.py, run by the founder with --apply --i-have-the-founders-word. admin_route — a service-key route, if one is ever built. NO DEFAULT: an allowance whose origin was not stated must fail rather than inherit one.';

ALTER TABLE public.house_message_allowances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_message_allowances_service_role
  ON public.house_message_allowances;
CREATE POLICY house_message_allowances_service_role
  ON public.house_message_allowances
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_message_allowances FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A purchase names its payment, and a seal buys at most one.
-- ---------------------------------------------------------------------------

-- The unique index is PARTIAL on `entry_kind = 'purchase'` because only a
-- purchase carries a seal at all (the debit/residual CHECKs forbid it
-- elsewhere), and a plain UNIQUE on `seal_id` would therefore be a unique
-- index over a column that is NULL on every other row — which permits any
-- number of them and reads, to somebody skimming, like a constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_house_message_credits_purchase_seal
  ON public.house_message_credits (seal_id)
  WHERE entry_kind = 'purchase' AND seal_id IS NOT NULL;

DO $$
BEGIN
  -- Guarded rather than unconditional: re-running the file must not fail, and
  -- ADD CONSTRAINT has no IF NOT EXISTS.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.house_message_credits'::regclass
      AND conname = 'house_message_credits_purchase_is_paid'
  ) THEN
    -- NOT VALID is deliberate and is NOT laziness. Any purchase row written
    -- before today was written when nothing could charge, so it is honestly
    -- payment-less; failing this migration over it would say those rows are
    -- wrong when what changed is the rule. NOT VALID binds every future write
    -- and leaves the history readable, which is the same shape the ledger uses
    -- everywhere else: correct forward, never rewritten backward.
    ALTER TABLE public.house_message_credits
      ADD CONSTRAINT house_message_credits_purchase_is_paid
      CHECK (entry_kind <> 'purchase' OR payment_ref IS NOT NULL)
      NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.house_message_credits.payment_ref IS
  'The provider''s own reference for the payment behind this entry — a Stripe PaymentIntent id (pi_...) on a purchase. REQUIRED on a purchase since 2026-09-06 (house_message_credits_purchase_is_paid): the founder''s answer to question 7 wired the purchase route to the card on file, and credits appearing with no payment behind them is a balance nobody can audit.';

-- ---------------------------------------------------------------------------
-- 3. Assertions.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  has_rls BOOLEAN;
  client_grants INT;
  probe_restaurant UUID;
  probe_seal UUID := gen_random_uuid();
  rejected BOOLEAN;
BEGIN
  IF to_regclass('public.house_message_allowances') IS NULL THEN
    RAISE EXCEPTION 'house_message_allowances did not apply';
  END IF;

  SELECT relrowsecurity INTO has_rls
  FROM pg_class WHERE oid = 'public.house_message_allowances'::regclass;
  IF NOT has_rls THEN
    RAISE EXCEPTION 'RLS is not enabled on public.house_message_allowances';
  END IF;

  SELECT count(*) INTO client_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'house_message_allowances'
    AND grantee IN ('anon', 'authenticated');
  IF client_grants > 0 THEN
    RAISE EXCEPTION
      'anon/authenticated still hold % grants on house_message_allowances', client_grants;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'house_message_allowances'
      AND column_name = 'set_via' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'house_message_allowances.set_via must have no default: an allowance whose origin was not stated must fail';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'house_message_allowances'
      AND column_name = 'monthly_allowance' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'house_message_allowances.monthly_allowance must stay nullable: NULL is "not stated" and there is no other way to say it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.house_message_credits'::regclass
      AND conname = 'house_message_credits_purchase_is_paid'
  ) THEN
    RAISE EXCEPTION 'house_message_credits_purchase_is_paid was not added';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'uq_house_message_credits_purchase_seal'
  ) THEN
    RAISE EXCEPTION 'uq_house_message_credits_purchase_seal was not created';
  END IF;

  -- PROVE all three bite, rather than asserting they exist.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_restaurant IS NOT NULL THEN
    -- (a) an allowance with a placeholder source
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_allowances
        (restaurant_id, monthly_allowance, stated_source, set_via, set_by)
      VALUES (probe_restaurant, 200, 'guess', 'founder_script', NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_allowances WHERE restaurant_id = probe_restaurant;
      RAISE EXCEPTION
        'house_message_allowances accepted a number with a five-character source — the provenance CHECK is not biting';
    END IF;

    -- (b) a purchase with no payment behind it
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_credits
        (restaurant_id, entry_kind, amount_minor, currency, provider_cost_minor,
         platform_fee_minor, fee_basis, meter_id, seal_id, payment_ref, detail, recorded_by)
      VALUES (probe_restaurant, 'purchase', 5000, 'USD', NULL,
              NULL, NULL, NULL, probe_seal, NULL, 'migration probe, must be refused', NULL);
    EXCEPTION WHEN check_violation THEN rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.house_message_credits
        WHERE detail = 'migration probe, must be refused';
      RAISE EXCEPTION
        'house_message_credits accepted a purchase with no payment_ref — the paid CHECK is not biting';
    END IF;

    -- (c) two purchases on one seal
    INSERT INTO public.house_message_credits
      (restaurant_id, entry_kind, amount_minor, currency, provider_cost_minor,
       platform_fee_minor, fee_basis, meter_id, seal_id, payment_ref, detail, recorded_by)
    VALUES (probe_restaurant, 'purchase', 5000, 'USD', NULL,
            NULL, NULL, NULL, probe_seal, 'pi_probe', 'migration probe, first', NULL);

    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_message_credits
        (restaurant_id, entry_kind, amount_minor, currency, provider_cost_minor,
         platform_fee_minor, fee_basis, meter_id, seal_id, payment_ref, detail, recorded_by)
      VALUES (probe_restaurant, 'purchase', 5000, 'USD', NULL,
              NULL, NULL, NULL, probe_seal, 'pi_probe_2', 'migration probe, second', NULL);
    EXCEPTION WHEN unique_violation THEN rejected := TRUE;
    END;
    DELETE FROM public.house_message_credits WHERE seal_id = probe_seal;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'house_message_credits accepted two purchases on one seal — the unique index is not biting, and a retry after a crash would charge the house twice';
    END IF;
  END IF;
  -- On a fresh CI database `restaurants` is empty and the three probes above do
  -- not run. Stated rather than hidden.
END $$;
