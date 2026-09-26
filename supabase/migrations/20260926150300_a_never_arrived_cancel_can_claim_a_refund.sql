-- A never-arrived cancel can claim a refund (ADR 0207, round 5).
--
-- THE FOUNDER, 2026-09-22, round 6z, on question 20 (a never-arrived order
-- the house already paid for): "Add the box (Recommended)" — on the
-- never-arrived cancel, a box "We paid for this, we are owed {total}" opens
-- a credit claim with the order's vendor and currency, so the Credits line
-- chases it.
--
-- WHY A NEW REASON, NOT AN EXISTING ONE. `procurement_credits_reason_check`
-- already admits seven values; none of them is this fact. `never_ordered`
-- means the OPPOSITE thing (a vendor billed for something the house never
-- placed) and reusing it here would make a claim lie about what happened.
-- `other` would work but throws away exactly the distinction the founder's
-- box exists to draw: a house's own record of "we paid, it never came" reads
-- differently from every other claim reason on the Credits line, and
-- `vendor-scorecard.copy.ts`'s `entry.claim()` already renders any reason by
-- replacing its underscores with spaces, so `never_arrived` reads as
-- "never arrived" with no new copy needed.
--
-- WHY A PARTIAL UNIQUE INDEX. `openNeverArrivedCreditClaim`
-- (procurement.service.ts) already checks for an existing open claim before
-- inserting, but that check and the insert are two round trips — the same
-- shape `uq_pc_line_reason` exists to close for the invoice-match writer.
-- This index closes the same race for the order-level writer: at most one
-- non-written-off `never_arrived` claim per order, ever, enforced by the
-- database rather than trusted to the service's own read-then-write.
--
-- Additive and idempotent: the CHECK widen is read-and-append (never a
-- hand-typed list — the same shape 20260926150200 used for the seal kind),
-- and the index is CREATE ... IF NOT EXISTS. No row is written, moved or
-- deleted; no RLS change (procurement_credits' existing policies are
-- untouched).

SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Widen procurement_credits_reason_check by reading it first.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  reasons TEXT[];
  wanted TEXT := 'never_arrived';
  rebuilt TEXT;
  written TEXT[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.procurement_credits'::regclass
    AND conname = 'procurement_credits_reason_check';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'procurement_credits_reason_check is absent: this migration extends a constraint that must already exist (the baseline)';
  END IF;

  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO reasons
  FROM regexp_matches(existing_def, '''((?:[^'']|'''')+)''', 'g') AS m;

  IF reasons IS NULL OR array_length(reasons, 1) < 7 THEN
    RAISE EXCEPTION
      'could not read the admitted credit reasons out of "%" — refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(reasons) THEN
    -- already extended; re-running this file changes nothing further below
    NULL;
  ELSE
    reasons := reasons || wanted;

    SELECT string_agg(quote_literal(r), ', ' ORDER BY r)
    INTO rebuilt
    FROM unnest(reasons) AS r;

    EXECUTE 'ALTER TABLE public.procurement_credits '
         || 'DROP CONSTRAINT procurement_credits_reason_check';
    EXECUTE 'ALTER TABLE public.procurement_credits '
         || 'ADD CONSTRAINT procurement_credits_reason_check '
         || format('CHECK ((reason)::text IN (%s))', rebuilt);

    SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO written
    FROM pg_constraint c,
         LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
    WHERE c.conrelid = 'public.procurement_credits'::regclass
      AND c.conname = 'procurement_credits_reason_check';

    IF written IS NULL OR NOT (written @> reasons AND reasons @> written) THEN
      RAISE EXCEPTION
        'rebuilding the credit reason CHECK did not keep exactly the reasons it read plus %: read %, wrote %',
        wanted, reasons, written;
    END IF;
  END IF;
END
$$;

COMMENT ON COLUMN public.procurement_credits.reason IS
  'Why this claim was opened. never_arrived joined 2026-09-22 (ADR 0207 round 5, founder: "Add the box (Recommended)") — a claim opened from the never-arrived cancel''s own box, for an order the house says it already paid for. Distinct from never_ordered, which means the reverse (billed for something never placed).';

-- ---------------------------------------------------------------------------
-- 2. At most one open never_arrived claim per order.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_pc_order_never_arrived
  ON public.procurement_credits (order_id, reason)
  WHERE (reason = 'never_arrived' AND order_id IS NOT NULL AND state <> 'written_off');

COMMENT ON INDEX public.uq_pc_order_never_arrived IS
  'At most one non-written-off never_arrived claim per order (ADR 0207 round 5) — the database''s half of the race `openNeverArrivedCreditClaim`''s own read-then-write already guards; a written_off claim may be re-opened by a fresh one, the same forgiveness uq_pc_line_reason gives the invoice-match writer.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted TEXT[];
  probe_house UUID;
  probe_inventory UUID;
  probe_provider UUID;
  probe_order UUID;
  probe_claim_1 UUID;
  rejected BOOLEAN;
BEGIN
  SELECT array_agg(replace(m[1], '''''', '''')) INTO admitted
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
  WHERE c.conrelid = 'public.procurement_credits'::regclass
    AND c.conname = 'procurement_credits_reason_check';
  IF NOT ('never_arrived' = ANY(admitted)) THEN
    RAISE EXCEPTION 'the credit reason CHECK does not admit never_arrived';
  END IF;
  IF NOT ('overbilled_vs_ship' = ANY(admitted) AND 'other' = ANY(admitted) AND 'never_ordered' = ANY(admitted)) THEN
    RAISE EXCEPTION 'rebuilding the credit reason CHECK dropped an existing reason';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'procurement_credits'
       AND indexname = 'uq_pc_order_never_arrived'
  ) THEN
    RAISE EXCEPTION 'uq_pc_order_never_arrived was not created';
  END IF;

  -- procurement_credits.order_id carries a real FK to procurement_orders (ON
  -- DELETE SET NULL) — a synthetic uuid would 23503 here, so the probe needs
  -- a real order row, which needs a real inventory row and a real provider
  -- (the same three-row requirement 20260926150100's own self-test names;
  -- skipped, never a hard failure, on a database that starts empty — the
  -- PGlite full-corpus build, never a real deployment target).
  SELECT id INTO probe_house FROM public.restaurants LIMIT 1;
  IF probe_house IS NOT NULL THEN
    SELECT id INTO probe_inventory FROM public.restaurant_inventory
     WHERE restaurant_id = probe_house LIMIT 1;
    SELECT id INTO probe_provider FROM public.providers
     WHERE restaurant_id = probe_house LIMIT 1;
  END IF;
  IF probe_house IS NOT NULL AND probe_inventory IS NOT NULL AND probe_provider IS NOT NULL THEN
    INSERT INTO public.procurement_orders (
      id, order_number, restaurant_id, inventory_id, provider_id,
      quantity, bottles_total, final_price, total_cost,
      status, cancel_reason_code, cancelled_from_status, cancelled_at
    ) VALUES (
      gen_random_uuid(), 'ADR-0207-R5-MIGRATION-PROBE', probe_house, probe_inventory, probe_provider,
      1, 1, 100, 100.00,
      'CANCELLED', 'never_arrived', 'CONFIRMED', now()
    ) RETURNING id INTO probe_order;

    -- The honest half: a never_arrived claim is admitted.
    INSERT INTO public.procurement_credits (
      restaurant_id, provider_id, order_id, reason, summary,
      currency, claimed_amount, state, opened_by
    ) VALUES (
      probe_house, probe_provider, probe_order, 'never_arrived',
      'ADR-0207-R5-MIGRATION-PROBE', 'USD', 100.00, 'open', NULL
    ) RETURNING id INTO probe_claim_1;

    -- Refusal: an unknown reason is still refused (the rewritten CHECK still
    -- validates; it did not become a tautology).
    rejected := FALSE;
    BEGIN
      INSERT INTO public.procurement_credits (
        restaurant_id, provider_id, order_id, reason, claimed_amount, state
      ) VALUES (
        probe_house, probe_provider, probe_order, 'vendor_was_rude', 1.00, 'open'
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.procurement_credits WHERE order_id = probe_order;
      DELETE FROM public.procurement_orders WHERE id = probe_order;
      RAISE EXCEPTION 'an unknown credit reason was admitted — the rewritten CHECK does not validate';
    END IF;

    -- Refusal: a second open never_arrived claim on the SAME order.
    rejected := FALSE;
    BEGIN
      INSERT INTO public.procurement_credits (
        restaurant_id, provider_id, order_id, reason, claimed_amount, state
      ) VALUES (
        probe_house, probe_provider, probe_order, 'never_arrived', 100.00, 'open'
      );
    EXCEPTION WHEN unique_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      DELETE FROM public.procurement_credits WHERE order_id = probe_order;
      DELETE FROM public.procurement_orders WHERE id = probe_order;
      RAISE EXCEPTION 'a second open never_arrived claim on the same order was admitted — uq_pc_order_never_arrived does not hold';
    END IF;

    DELETE FROM public.procurement_credits WHERE order_id = probe_order;
    DELETE FROM public.procurement_orders WHERE id = probe_order;
    IF EXISTS (SELECT 1 FROM public.procurement_credits WHERE order_id = probe_order)
       OR EXISTS (SELECT 1 FROM public.procurement_orders WHERE id = probe_order) THEN
      RAISE EXCEPTION 'migration probe rows were left behind';
    END IF;
  END IF;
END
$$;
