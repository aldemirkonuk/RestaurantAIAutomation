-- billing_stripe_provider — the two tables a real payment provider needs, plus
-- the three columns that let a cached instrument say how stale it is.
--
-- WHY, AND WHAT CHANGED SINCE 20260903094600
-- ------------------------------------------
-- `20260903094600_payment_methods.sql` built the register and stopped at the
-- credential: `POST /payment-methods` refused with 503 while STRIPE_SECRET_KEY
-- was unset. The gap it filed (profile.md §9 G10) claimed "everything except the
-- credential is built", and that claim was wrong — measured 2026-09-03, nothing
-- in the repo spoke to Stripe at all, so the required `provider_ref` was a field
-- no caller in this product could ever fill and setting the env var would have
-- turned the honest refusal into an operator-typed fabrication. ADR 0110 records
-- the whole measurement.
--
-- This migration adds what a provider path actually needs:
--
--   1. `billing_customers`  — the restaurant's identity AT the provider. One
--      customer per restaurant per provider, and `livemode` recorded, because a
--      customer minted under a test key must never be reused under a live one.
--   2. `billing_webhook_events` — delivery receipts. The PRIMARY KEY is the
--      provider's own event id, so "process this event exactly once" is enforced
--      by the schema and not by a code path that can be raced by two dynos.
--      `outcome` is NOT NULL: an event we chose to ignore is RECORDED as ignored
--      with its reason, never dropped. A webhook table that only holds the
--      events we liked reports absence as health.
--   3. Three columns on `payment_methods` — `provider_type`, `synced_at`,
--      `livemode` — plus one widened CHECK.
--
-- WHY `kind` GAINS 'other'
-- ------------------------
-- The register offers four kinds; Stripe has roughly thirty payment-method
-- types. Mapping an unknown type onto `card` because `card` is the closest is a
-- quiet lie about an instrument that will be charged. So an unmapped type is
-- filed as `other` and `provider_type` carries the provider's own word for it,
-- which the page prints verbatim. The register stops pretending its vocabulary
-- is the world's.
--
-- WHY `synced_at`
-- ---------------
-- Every column on `payment_methods` except `provider_ref` is a COPY of the
-- provider's answer. Without a timestamp the page can only say "Visa ••••4242",
-- which asserts a present tense it cannot support — the card may have been
-- removed at the provider an hour ago. `synced_at` lets the row say *when* we
-- last agreed with Stripe, and lets the page distinguish "confirmed just now"
-- from "never confirmed since it was written".
--
-- WHAT IS STILL DELIBERATELY NOT HERE
-- -----------------------------------
--   * No PAN, CVC, cardholder name or billing address. Unchanged from the
--     original migration, and now structural rather than aspirational: the card
--     is collected by Stripe Elements on Stripe's own origin, so those values
--     never reach this application at all (ADR 0110, option 2.3).
--   * No amount, invoice, subscription, charge or payment-intent table. Pricing
--     is OD-23 and open. The build stops at "a card on file".
--   * No provider secret in any column. The keys are environment variables read
--     by the gateway; nothing here stores or returns one.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The restaurant's identity at the provider
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  provider VARCHAR(24) NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe')),

  -- The provider's own id (`cus_...`). Opaque, and the only handle we keep.
  provider_customer_id TEXT NOT NULL,

  -- FALSE for a customer created against a test key, TRUE for a live one.
  -- Recorded rather than inferred: reusing a test customer under a live key
  -- produces a SetupIntent that silently belongs to nobody.
  livemode BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One customer per restaurant per provider per mode. The mode is part of the
  -- key on purpose: a house that tests and then goes live needs two, and
  -- without the mode the second insert would collide with the first.
  UNIQUE (restaurant_id, provider, livemode),
  UNIQUE (provider, provider_customer_id)
);

-- ---------------------------------------------------------------------------
-- 2. Delivery receipts — idempotency enforced by the primary key
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  provider VARCHAR(24) NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe')),

  -- The provider's event id (`evt_...`). Stripe retries a delivery until it is
  -- acknowledged, and a retry must not re-apply the effect.
  event_id TEXT NOT NULL,

  event_type TEXT NOT NULL,

  livemode BOOLEAN NOT NULL,

  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Did this event change anything here?
  handled BOOLEAN NOT NULL,

  -- WHY, in words, always. 'ignored: event type not handled',
  -- 'ignored: no restaurant is linked to that customer', 'detached pm_123'.
  -- NOT NULL so an event can never be filed without saying what became of it.
  outcome TEXT NOT NULL,

  -- Null when the event named a customer we do not know, which is itself a
  -- fact worth keeping rather than a reason to drop the row.
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,

  PRIMARY KEY (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_received
  ON public.billing_webhook_events (provider, received_at DESC);

-- ---------------------------------------------------------------------------
-- 3. What a cached instrument must be able to say about itself
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_methods
  ADD COLUMN IF NOT EXISTS provider_type TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS livemode BOOLEAN;

-- `kind` gains 'other'. The constraint created inline by the original migration
-- is named `payment_methods_kind_check` by Postgres; dropped by that name and
-- re-added explicitly so the name is ours from here on.
ALTER TABLE public.payment_methods
  DROP CONSTRAINT IF EXISTS payment_methods_kind_check;
ALTER TABLE public.payment_methods
  ADD CONSTRAINT payment_methods_kind_check
  CHECK (kind IN ('card', 'bank_account', 'apple_pay', 'invoice', 'other'));

COMMENT ON COLUMN public.payment_methods.provider_type IS
  'The provider''s own type string, verbatim (Stripe: card, us_bank_account, link, …). Kept because our four `kind` values do not span the provider''s vocabulary; an instrument we have no word for is filed kind=other and the page prints this.';

COMMENT ON COLUMN public.payment_methods.synced_at IS
  'When this row was last confirmed against the provider. Every column here except provider_ref is a cached copy of the provider''s answer; without this the page would assert a present tense it cannot support. NULL means never confirmed since it was written.';

COMMENT ON COLUMN public.payment_methods.livemode IS
  'Whether the provider reported this instrument under a live key. NULL for a row written before the provider path existed. A test instrument must never be presented as chargeable.';

-- ---------------------------------------------------------------------------
-- 4. Lock both new tables down in the SAME migration that creates them
--    (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.billing_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_customers_service_role ON public.billing_customers;
CREATE POLICY billing_customers_service_role
  ON public.billing_customers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.billing_customers FROM anon, authenticated;

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS billing_webhook_events_service_role ON public.billing_webhook_events;
CREATE POLICY billing_webhook_events_service_role
  ON public.billing_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.billing_webhook_events FROM anon, authenticated;

COMMENT ON TABLE public.billing_customers IS
  'A restaurant''s identity at a payment provider (Stripe only, today). Holds an opaque customer id and the key mode it was created under — never a secret, never an instrument. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON TABLE public.billing_webhook_events IS
  'Provider webhook deliveries, keyed by the provider''s own event id so a retry cannot re-apply an effect. `outcome` is NOT NULL: an event we ignored is recorded as ignored with its reason, because a table holding only the events we acted on would report absence as health. RLS on, service_role only, anon/authenticated revoked.';

-- ---------------------------------------------------------------------------
-- 5. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  t           text;
  required_pm text[] := ARRAY['provider_type', 'synced_at', 'livemode'];
  new_tables  text[] := ARRAY['billing_customers', 'billing_webhook_events'];
BEGIN
  ------------------------------------------------------------------ tables
  FOREACH t IN ARRAY new_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;

    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION '% is still reachable by anon/authenticated', t;
    END IF;
  END LOOP;

  ------------------------------------------------------- the new pm columns
  FOREACH c IN ARRAY required_pm LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_methods'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'payment_methods is missing columns the provider path writes: %', absent_cols;
  END IF;

  -- `synced_at` must be NULLABLE. A NOT NULL default of now() would make every
  -- row claim it had just been confirmed against the provider, which is the
  -- absence-as-health inversion written into a column default.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'payment_methods'
         AND column_name = 'synced_at') <> 'YES' THEN
    RAISE EXCEPTION 'payment_methods.synced_at is NOT NULL — every row would claim a confirmation that never happened';
  END IF;

  ------------------------------------------------------- the widened CHECK
  -- It must now ACCEPT 'other' and still REJECT a value outside the set. A
  -- CHECK that was widened to permissiveness is not a CHECK.
  BEGIN
    INSERT INTO public.payment_methods (restaurant_id, kind, provider_ref)
    VALUES ('00000000-0000-0000-0000-000000000000', 'other', 'assert-other');
    RAISE EXCEPTION 'the FK did not fire — this assertion cannot tell us whether kind=other was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN
      NULL; -- reached the FK, so the CHECK accepted 'other'. Correct.
    WHEN check_violation THEN
      RAISE EXCEPTION 'kind=other was rejected — the CHECK was not widened';
  END;

  BEGIN
    INSERT INTO public.payment_methods (restaurant_id, kind, provider_ref)
    VALUES ('00000000-0000-0000-0000-000000000000', 'cheque', 'assert-bad-kind');
    RAISE EXCEPTION 'kind accepted an unlisted value — the CHECK is now permissive';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- rejected, as intended
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the kind CHECK did not fire before the FK — it is no longer armed';
  END;

  -- And the PAN guard from 20260903094600 must still be armed after the ALTER.
  BEGIN
    INSERT INTO public.payment_methods (restaurant_id, kind, last4, provider_ref)
    VALUES ('00000000-0000-0000-0000-000000000000', 'card', '4242424242424242', 'assert-pan');
    RAISE EXCEPTION 'last4 accepted a 16-digit value — the PAN guard is no longer armed';
  EXCEPTION
    WHEN string_data_right_truncation OR check_violation THEN
      NULL; -- rejected, as intended
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'the last4 CHECK did not fire before the FK — the PAN guard is not armed';
  END;

  ------------------------------------------------- idempotency is structural
  -- The whole point of billing_webhook_events is that a redelivered event
  -- cannot be applied twice. Prove the key rejects the duplicate rather than
  -- trusting that a PRIMARY KEY clause was typed correctly.
  INSERT INTO public.billing_webhook_events
    (provider, event_id, event_type, livemode, handled, outcome)
  VALUES
    ('stripe', 'evt_migration_assertion', 'assert', FALSE, FALSE, 'assertion row');

  BEGIN
    INSERT INTO public.billing_webhook_events
      (provider, event_id, event_type, livemode, handled, outcome)
    VALUES
      ('stripe', 'evt_migration_assertion', 'assert', FALSE, FALSE, 'assertion row');
    RAISE EXCEPTION 'a duplicate webhook event id was accepted — redelivery would double-apply';
  EXCEPTION
    WHEN unique_violation THEN
      NULL; -- rejected, as intended
  END;

  DELETE FROM public.billing_webhook_events
   WHERE event_id = 'evt_migration_assertion';

  RAISE NOTICE 'billing_customers + billing_webhook_events created, RLS on, anon/authenticated revoked; payment_methods gained provider_type/synced_at/livemode; kind accepts other and still rejects the unlisted; PAN guard and webhook idempotency both proven to fire.';
END
$$;
