-- A cancellation says whose failure it was (ADR 0207, round 4).
--
-- THE FOUNDER, 2026-09-22, round 6y, on whether Cancel is enough for a
-- never-arrived order: "if. cancelde make sure the all analytcis be
-- configured toward that, canel is enough or not?" (verbatim, typos kept).
-- The research answer (ADR 0207 §C0): not as built, and still the right act.
-- Cancelling a never-arrived order erases the vendor's failure today — every
-- analytic drops a cancelled order, so a vendor that never delivered scores
-- exactly like a vendor that was never asked. This migration is the one new
-- column that fixes it: WHY an order was cancelled, in three categories a
-- reader (and the analytics read) can act on differently.
--
-- THE THREE CATEGORIES
--   never_arrived       placed, confirmed, never delivered — the vendor's
--                        failure. Counts late in the on-time figure, like a
--                        confirmed-overdue order (procurement/overdue-order.ts).
--                        Allowed only from CONFIRMED or IN_TRANSIT, and only
--                        past the order's deadline when it has one (the
--                        house's clock, delivery-deadline.ts) — a house
--                        cannot punish a vendor for an order not yet due.
--   vendor_cannot_supply the vendor said it cannot fill the order (out of
--                        stock, discontinued). Listed, not counted, in
--                        on-time; counted in analytics' fill counts. Allowed
--                        from NEGOTIATING, APPROVED, CONFIRMED or IN_TRANSIT.
--   house_decision       the house's own choice — not needed, entered in
--                        error, a better price found. Never counts against
--                        the vendor. Allowed from any cancellable state.
--
-- A column, not a table: CANCELLED is terminal in order-transitions.ts
-- ([CANCELLED]: []), so an order is cancelled exactly once and the code is
-- written in the SAME UPDATE as the status, atomically, on every write path
-- (the gateway's sealed cancelOrder, the receiving-page in-place cancel on an
-- overdue order, and the procurement agent's out-of-stock cancel).
--
-- NOT required at the database on every CANCELLED row: legacy rows and the
-- agent's earlier code path would fail a NOT NULL retroactively, and this
-- migration writes no row. It is required in the gateway (CANCEL_NEEDS_A_CATEGORY,
-- 400) for every NEW cancellation. The CHECK below is the floor that still
-- holds absolutely: a code is never present on a non-CANCELLED row, and a
-- code, when present, is always one of the three named here.
--
-- Additive and idempotent: ADD COLUMN IF NOT EXISTS throughout; no row is
-- written, moved or deleted; no RLS change (procurement_orders' existing
-- policies govern the new columns the same as every other column on the
-- table — nothing here widens or narrows who can read or write a row).

SET local statement_timeout = '120s';

-- Three single-column statements, not one multi-column ALTER TABLE: analytics/
-- order-schema-drift.spec.ts's migration parser (the 42703 regression guard)
-- matches "ALTER TABLE ... ADD COLUMN" as one literal run and only catches the
-- FIRST column of a comma-separated list — a gap in that guard, not in this
-- migration (flagged separately, out of this lane). This shape is also what
-- most of this table's own history already uses.
ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS cancel_reason_code TEXT;
ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS cancelled_from_status TEXT;
ALTER TABLE public.procurement_orders
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

COMMENT ON COLUMN public.procurement_orders.cancel_reason_code IS
  'Whose failure a cancellation was (ADR 0207 round 4): never_arrived (the vendor''s — counts late), vendor_cannot_supply (the vendor said so — listed, not counted), house_decision (the house''s own choice — never counted). NULL on every non-CANCELLED row, and on a CANCELLED row written before this column existed ("cancelled before a reason was kept").';
COMMENT ON COLUMN public.procurement_orders.cancelled_from_status IS
  'The status this order held the instant its cancellation was written — read once, before the write, so a cancel out of PENDING/APPROVAL_NEEDED (never placed with the vendor) is distinguishable from one out of CONFIRMED/IN_TRANSIT (a vendor event) in every reader, without re-deriving it from the audit log.';
COMMENT ON COLUMN public.procurement_orders.cancelled_at IS
  'When the cancellation was written. Distinct from updated_at (which every write touches) so a reader can date the act itself without assuming updated_at was not touched again afterward.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_orders_cancel_reason_code_known'
       AND conrelid = to_regclass('public.procurement_orders')
  ) THEN
    ALTER TABLE public.procurement_orders
      ADD CONSTRAINT procurement_orders_cancel_reason_code_known
      CHECK (
        cancel_reason_code IS NULL
        OR cancel_reason_code IN ('never_arrived', 'vendor_cannot_supply', 'house_decision')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'procurement_orders_cancel_reason_code_only_when_cancelled'
       AND conrelid = to_regclass('public.procurement_orders')
  ) THEN
    ALTER TABLE public.procurement_orders
      ADD CONSTRAINT procurement_orders_cancel_reason_code_only_when_cancelled
      CHECK (cancel_reason_code IS NULL OR status = 'CANCELLED');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  probe_house UUID;
  probe_inventory UUID;
  probe_provider UUID;
  probe_order UUID;
  rejected BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_orders'
       AND column_name = 'cancel_reason_code'
  ) THEN
    RAISE EXCEPTION 'cancel_reason_code was not added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_orders'
       AND column_name = 'cancelled_from_status'
  ) THEN
    RAISE EXCEPTION 'cancelled_from_status was not added';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'procurement_orders'
       AND column_name = 'cancelled_at'
  ) THEN
    RAISE EXCEPTION 'cancelled_at was not added';
  END IF;

  SELECT id INTO probe_house FROM public.restaurants LIMIT 1;
  -- procurement_orders also requires order_number, inventory_id, provider_id,
  -- quantity, bottles_total, final_price and total_cost (all NOT NULL, two of
  -- them FKs) — found only here, verifying against a database that already
  -- holds a restaurant row (every real deployment target; the PGlite
  -- full-corpus build starts empty and never exercised this). Without a real
  -- inventory row and a real provider for the probe house, this self-test
  -- cannot construct a legal row to probe FROM, so it is skipped exactly like
  -- the "no restaurant yet" case already was — never a hard failure of the
  -- migration itself.
  IF probe_house IS NOT NULL THEN
    SELECT id INTO probe_inventory FROM public.restaurant_inventory
     WHERE restaurant_id = probe_house LIMIT 1;
    SELECT id INTO probe_provider FROM public.providers
     WHERE restaurant_id = probe_house LIMIT 1;
  END IF;
  IF probe_house IS NOT NULL AND probe_inventory IS NOT NULL AND probe_provider IS NOT NULL THEN
    -- The honest half: a CANCELLED row naming a real category is admitted.
    INSERT INTO public.procurement_orders (
      id, order_number, restaurant_id, inventory_id, provider_id,
      quantity, bottles_total, final_price, total_cost,
      status, cancel_reason_code, cancelled_from_status, cancelled_at
    ) VALUES (
      gen_random_uuid(), 'ADR-0207-MIGRATION-PROBE-1', probe_house, probe_inventory, probe_provider,
      1, 1, 0, 0,
      'CANCELLED', 'never_arrived', 'CONFIRMED', now()
    ) RETURNING id INTO probe_order;
    DELETE FROM public.procurement_orders WHERE id = probe_order;

    -- Refusal 1: an unknown category.
    rejected := FALSE;
    BEGIN
      INSERT INTO public.procurement_orders (
        id, order_number, restaurant_id, inventory_id, provider_id,
        quantity, bottles_total, final_price, total_cost,
        status, cancel_reason_code
      ) VALUES (
        gen_random_uuid(), 'ADR-0207-MIGRATION-PROBE-2', probe_house, probe_inventory, probe_provider,
        1, 1, 0, 0,
        'CANCELLED', 'vendor_was_rude'
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'a CANCELLED order was accepted with an unknown cancel_reason_code — procurement_orders_cancel_reason_code_known is not biting';
    END IF;

    -- Refusal 2: a code on a row that is not CANCELLED.
    rejected := FALSE;
    BEGIN
      INSERT INTO public.procurement_orders (
        id, order_number, restaurant_id, inventory_id, provider_id,
        quantity, bottles_total, final_price, total_cost,
        status, cancel_reason_code
      ) VALUES (
        gen_random_uuid(), 'ADR-0207-MIGRATION-PROBE-3', probe_house, probe_inventory, probe_provider,
        1, 1, 0, 0,
        'PENDING', 'house_decision'
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'a non-CANCELLED order was accepted carrying a cancel_reason_code — procurement_orders_cancel_reason_code_only_when_cancelled is not biting';
    END IF;
  END IF;
END
$$;
