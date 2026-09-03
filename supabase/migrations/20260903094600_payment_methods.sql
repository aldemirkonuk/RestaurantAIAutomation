-- payment_methods — the shape a Stripe-backed account would have, built before
-- the provider so that nothing has to be faked when one arrives.
--
-- WHY A TABLE FOR SOMETHING THAT CANNOT BE WRITTEN YET
-- ---------------------------------------------------
-- Measured 2026-09-02 and again 2026-09-03: no Stripe (or comparable) client, no
-- webhook, no billing table anywhere in the repo. `/profile` therefore rendered
-- "Add a payment method" as a disabled control with its reason in words, which
-- was honest and which the founder read as a hole rather than an answer.
--
-- This file builds the register for real — table, gateway module, list and
-- revoke — and stops exactly where honesty requires it to stop: the CREATE path
-- refuses while no provider credential is configured
-- (`payment-methods.service.ts`, `assertProviderConnected`). The register can
-- therefore be listed, and it is empty, and it says WHY it is empty: not
-- "you have no cards" but "no provider is connected, so no card could exist".
-- Those two sentences look identical in a UI that only counts rows, and they are
-- the two the house rule (ADR 0020) exists to separate.
--
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------
--   * No PAN, no CVC, no expiry-with-a-full-number, no billing address, no
--     cardholder name. Everything below is what a provider hands BACK after it
--     has taken the card: a brand, four digits, a printable expiry, and the
--     provider's own opaque reference. Storing anything more would put this
--     product inside PCI scope for a feature that does not exist yet.
--   * No amount, no invoice, no subscription. The plan lives on
--     `restaurants.subscription_tier` and is now returned by
--     `GET /organizations/locations/:id`; billing history is a later table with
--     a later decision behind it (pricing itself is founder-deferred, OD-23).
--   * No `revoked_at`. Unlike an MCP grant, a detached instrument has no audit
--     value we can honour — the provider is the system of record for a card that
--     existed, and keeping a shadow of one we cannot verify would be worse than
--     keeping none. DELETE removes the row.
--
-- `provider` is CHECKed to 'stripe' alone rather than left open. A second
-- provider is a decision with its own migration; a permissive column would let
-- a typo become a silent second integration.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The house pays, not the person. A payment instrument on a PERSONAL profile
  -- would be the one shape DESIGN-FOUNDATION §6 tells us to refuse; the row is
  -- tenant-scoped and the page says whose it is.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The four kinds the register offers. `invoice` is a terms arrangement, not an
  -- instrument, which is why brand/last4/exp are all nullable below.
  kind VARCHAR(24) NOT NULL
    CHECK (kind IN ('card', 'bank_account', 'apple_pay', 'invoice')),

  -- What the provider called it ("visa", "amex", the bank's name). NULL for an
  -- invoice arrangement, and NULL is an em dash on the page, never "Unknown".
  brand VARCHAR(60),

  -- Exactly four digits, or nothing. The CHECK is what stops a full PAN ever
  -- being written into this column by a careless caller.
  last4 CHAR(4) CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),

  -- Printable expiry as the provider states it, MM/YYYY. Text rather than a
  -- date because a bank account and an invoice arrangement have none, and a
  -- sentinel date would be a lie with a type.
  exp VARCHAR(7) CHECK (exp IS NULL OR exp ~ '^(0[1-9]|1[0-2])/[0-9]{4}$'),

  is_default BOOLEAN NOT NULL DEFAULT FALSE,

  provider VARCHAR(24) NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),

  -- The provider's own id for the instrument (`pm_...`). It is the ONLY handle
  -- we keep; every detail above is a copy of the provider's answer, and the
  -- provider stays the system of record.
  provider_ref TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per instrument per provider. A retried webhook must not double it.
  UNIQUE (provider, provider_ref)
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_restaurant
  ON public.payment_methods (restaurant_id, created_at DESC);

-- At most one default per restaurant. Enforced by the schema rather than by the
-- service, because "two defaults" is the kind of state that only ever appears
-- under a race and then silently picks one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_methods_one_default
  ON public.payment_methods (restaurant_id)
  WHERE is_default;

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_methods_service_role ON public.payment_methods;
CREATE POLICY payment_methods_service_role
  ON public.payment_methods
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.payment_methods FROM anon, authenticated;

COMMENT ON TABLE public.payment_methods IS
  'Payment instruments on file for a restaurant, mirrored from a provider (Stripe only, today). Holds no PAN, CVC or address — brand, last4, printable expiry and the provider reference are all the provider hands back. No provider is connected in this deployment, so the table is empty by construction and the create path refuses with a stated reason rather than inserting a fabricated instrument. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.payment_methods.last4 IS
  'Last four digits as the provider reports them. The regex CHECK is a guard against a full card number ever landing here.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'restaurant_id', 'kind', 'brand', 'last4', 'exp',
    'is_default', 'provider', 'provider_ref', 'created_at'
  ];
BEGIN
  IF to_regclass('public.payment_methods') IS NULL THEN
    RAISE EXCEPTION 'payment_methods was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.payment_methods')) THEN
    RAISE EXCEPTION 'payment_methods has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.payment_methods', 'SELECT')
     OR has_table_privilege('anon', 'public.payment_methods', 'INSERT')
     OR has_table_privilege('anon', 'public.payment_methods', 'UPDATE')
     OR has_table_privilege('anon', 'public.payment_methods', 'DELETE')
     OR has_table_privilege('authenticated', 'public.payment_methods', 'SELECT')
     OR has_table_privilege('authenticated', 'public.payment_methods', 'INSERT')
     OR has_table_privilege('authenticated', 'public.payment_methods', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.payment_methods', 'DELETE')
  THEN
    RAISE EXCEPTION 'payment_methods is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
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
    RAISE EXCEPTION 'payment_methods is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The PAN guard has to actually reject. A CHECK that never fires is the same
  -- class of decoration as a test that would pass against the scaffold.
  BEGIN
    INSERT INTO public.payment_methods
      (restaurant_id, kind, last4, provider_ref)
    VALUES
      ('00000000-0000-0000-0000-000000000000', 'card', '4242424242424242', 'assert');
    RAISE EXCEPTION 'last4 accepted a 16-digit value — the PAN guard is not armed';
  EXCEPTION
    WHEN string_data_right_truncation OR check_violation THEN
      NULL; -- rejected, as intended
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'last4 CHECK did not fire before the FK — the PAN guard is not armed';
  END;

  RAISE NOTICE 'payment_methods created, RLS on, anon/authenticated revoked, PAN guard armed.';
END
$$;
