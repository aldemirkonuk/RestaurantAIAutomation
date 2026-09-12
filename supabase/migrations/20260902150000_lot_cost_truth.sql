-- COST TRUTH ON A LOT — a correction can correct, and an unverified price
-- stops wearing the word "invoice". See ADR 0078.
--
-- Three defects, all in the same six lines of arithmetic:
--
--  D1  `apply_stock_movement` inferred provenance from the mere PRESENCE of a
--      price (20260805130000_extend_apply_stock_movement.sql:66-69):
--
--          COALESCE(p_cost_provenance,
--                   CASE WHEN p_unit_cost IS NOT NULL
--                        THEN 'invoice' ELSE 'estimated' END)
--
--      So any caller supplying a number without saying what KIND of number it
--      was got `'invoice'` for free. `procurement.service.ts` markDelivered
--      does exactly that with the purchase order's OWN QUOTED PRICE — the lot
--      was stamped invoice-verified before anyone had seen a piece of paper,
--      and `inventory_lot_rollup.has_invoice_cost` then reported it to
--      analytics as a measurement. Verified live on production 2026-09-02: the
--      inference is present in the deployed function.
--
--  D2  A correction could not correct. A positive delta INSERTs a lot; a
--      negative delta DELETEs lots FIFO. Nothing anywhere restated an existing
--      lot's `unit_cost`. When a verified invoice arrived after an estimated
--      receipt, a negative correction only deleted lots and the real price
--      landed on a ledger row that no valuation reads; a positive one created
--      a SECOND lot at invoice cost beside the estimated original, and
--      `inventory_lot_rollup.wac` blended the guess with the correction
--      permanently — then `inventory-cost.ts` labelled the blend
--      "invoiced lot WAC". FIFO deletion also discarded `cost_provenance`,
--      `vintage` and `source_order_id`, so pouring the first bottle erased the
--      provenance of the rest.
--
--  D3  `applyReceiptAdjustment` passed `p_source: 'receiving'`.
--      `inventory_transaction_source` is exactly
--      (pos, manual, order, mobile_count, reconciliation, system, import, api)
--      — read from production 2026-09-02. The cast
--      `p_source::inventory_transaction_source` raised on every call, so EVERY
--      receipt-verification stock correction 422'd. Fixed in the service, not
--      here; the enum is not extended, because 'order' already means exactly
--      "sourced from a procurement order" and `receiving.service.ts:205-212`
--      already made that call for the door path.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename. Applying it manually is the only way to
-- produce a version mismatch.

BEGIN;

-- ===========================================================================
-- 1. Provenance is stated, never inferred
-- ===========================================================================
--
-- HOW EVERY EXISTING CALLER KEEPS WORKING
--
-- The parameter LIST is byte-identical to the 17-argument signature currently
-- deployed (verified against pg_proc on production 2026-09-02: exactly one
-- overload, pronargs = 17). `CREATE OR REPLACE FUNCTION` therefore replaces
-- the body in place — it does not create a second overload, and it preserves
-- the ACL (=X/postgres, anon, authenticated, service_role), so no GRANT needs
-- restoring. Every call site invokes this RPC with named arguments, which
-- PostgREST resolves by name, so nothing needs to change at any call site that
-- is not already changing.
--
-- The only behavioural change is the RAISE below. Every caller was enumerated
-- before writing it:
--
--   PASSES A PRICE (must now state provenance)
--     apps/api-gateway/src/inventory/inventory.service.ts:775, 861, 1143
--         already passes p_cost_provenance explicitly — unaffected.
--     apps/api-gateway/src/procurement/procurement.service.ts:1451, 1656
--         markDelivered and applyReceiptAdjustment — FIXED in this PR.
--     apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts:107
--         `p_unit_cost: dto.unitCost || null`. `unitCost` is an optional field
--         on CreateTransactionDto that NO client in this repo sets (grepped
--         apps/web/src and apps/mobile/src: zero occurrences), and production
--         `inventory_transactions` holds 4 rows, sources manual + order only.
--         So no in-repo path reaches the RAISE. That file is being reworked
--         concurrently; the guard allow-lists it BY NAME rather than pretending
--         the gap does not exist.
--
--   PASSES NO PRICE (unaffected — nothing crosses into a lot)
--     apps/api-gateway/src/toast/toast.service.ts:542, 563
--     apps/api-gateway/src/pos-hub/pos-hub.service.ts:782
--     apps/api-gateway/src/procurement/procurement.service.ts:1433
--     apps/api-gateway/src/procurement/receiving.service.ts:201
--     apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts:497
--     services/agent-orchestrator/core/database.py:984
--     supabase/migrations/20260805131000_...sql:47  (set_stock_live wrapper)
--
-- WHY THE RAISE IS SCOPED TO p_delta > 0
--
-- The rule being enforced is "a price crossing into a LOT must state its
-- provenance". Only a positive delta creates a lot. On a negative delta
-- `p_unit_cost` lands on the ledger row and can never become a provenance
-- claim, so raising there would break callers to no purpose.

CREATE OR REPLACE FUNCTION public.apply_stock_movement(
    p_inventory_id uuid,
    p_stock_state text,
    p_delta integer,
    p_transaction_type text,
    p_source text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_unit_cost numeric DEFAULT NULL::numeric,
    p_location_id uuid DEFAULT NULL::uuid,
    p_order_id uuid DEFAULT NULL::uuid,
    p_idempotency_key text DEFAULT NULL::text,
    p_cost_provenance text DEFAULT NULL::text,
    p_reference_type text DEFAULT NULL::text,
    p_reference_id uuid DEFAULT NULL::uuid,
    p_pos_transaction_id text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_metadata jsonb DEFAULT NULL::jsonb
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

  -- THE FIX FOR D1. A price with nothing said about it used to become
  -- 'invoice'. It now becomes an error. Silence can no longer manufacture an
  -- audit assertion, and the caller is told exactly what to add.
  IF p_delta > 0 AND p_unit_cost IS NOT NULL AND p_cost_provenance IS NULL THEN
    RAISE EXCEPTION
      'apply_stock_movement: p_unit_cost was given without p_cost_provenance. '
      'A price that becomes a lot must say what kind of price it is: '
      '''invoice'' (a document was read), ''manual'' (a person typed it), '
      '''estimated'' (nobody has verified it) or ''sample'' (it was free). '
      'This used to default to ''invoice'', which stamped unverified prices as '
      'invoice-verified. See ADR 0078.'
      USING ERRCODE = '22023';
  END IF;

  -- No inference. A lot with no price is 'estimated' — the column's own schema
  -- default, and the only honest label for a quantity nobody has costed.
  v_provenance := COALESCE(p_cost_provenance, 'estimated');

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id);
  ELSE
    v_remaining := -p_delta;
    FOR v_lot IN SELECT id, qty FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        DELETE FROM inventory_lots WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now(),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, depletes/creates lots FIFO, writes the ledger row, and is '
  'idempotent on p_idempotency_key. Extended 2026-08-05 with reference_type, '
  'reference_id, pos_transaction_id, notes and metadata. Changed 2026-09-02 '
  '(ADR 0078): cost provenance is never inferred. A p_unit_cost that would '
  'create a lot must be accompanied by p_cost_provenance or the call raises; '
  'it previously defaulted to ''invoice'', which stamped quoted purchase-order '
  'prices as invoice-verified. Use revalue_lot to CORRECT a lot''s cost — this '
  'function only ever creates or consumes quantity.';

-- ===========================================================================
-- 2. The prior cost survives the correction
-- ===========================================================================
--
-- ADR 0059's rule, applied to money. There, confirming a machine-proposed
-- pairing wrote `match_confidence = 1` over the model's own score, destroying
-- the training pair at the exact instant it was created. Here the estimate and
-- the verified price would share `inventory_lots.unit_cost`, so verifying a
-- receipt would erase the estimate at the exact instant it became evidence
-- that the estimate was wrong. That pair — "what we expected to pay" against
-- "what the invoice actually said", per vendor, per wine, per delivery — is
-- the entire training signal for predicting a vendor's real landed cost, and
-- it is unreconstructable once overwritten.
--
-- A dedicated append-only table rather than `previous_unit_cost` columns on
-- the lot: two columns lose the first correction as soon as a second one
-- happens, and cannot carry the actor, the reason or the order without four
-- more columns.
--
-- lot_id is ON DELETE SET NULL, NOT CASCADE. FIFO consumption DELETEs lots, so
-- CASCADE would destroy the revaluation history of exactly the bottles that
-- sold — which is the half of the record that proves the correction mattered.
-- inventory_id and restaurant_id are denormalised so the row stays meaningful
-- and stays tenant-scoped after its lot is gone.
--
-- performed_by references public.users(user_id). NOT auth.users: the two
-- tables are disjoint (zero shared ids), the JWT carries public.users.user_id,
-- and an FK to auth.users 23503s on every write while CI stays green because a
-- fresh database has no rows to violate.

CREATE TABLE IF NOT EXISTS public.inventory_lot_revaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    inventory_id uuid NOT NULL,
    lot_id uuid REFERENCES public.inventory_lots(id) ON DELETE SET NULL,
    source_order_id uuid,
    qty_at_revaluation integer NOT NULL,
    prior_unit_cost numeric,
    prior_cost_provenance character varying(12),
    new_unit_cost numeric NOT NULL,
    new_cost_provenance character varying(12) NOT NULL,
    performed_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
    reason text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT inventory_lot_revaluations_new_provenance_check
      CHECK (new_cost_provenance::text = ANY (ARRAY['invoice','estimated','manual','sample']::text[]))
);

CREATE INDEX IF NOT EXISTS idx_lot_revaluations_inventory
  ON public.inventory_lot_revaluations (inventory_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lot_revaluations_order
  ON public.inventory_lot_revaluations (source_order_id)
  WHERE source_order_id IS NOT NULL;

-- Mirrors inventory_lots exactly: RLS on, no policies, so only the service
-- role (which bypasses RLS) can read or write. Verified on production
-- 2026-09-02 — inventory_lots has relrowsecurity = true and zero policies.
ALTER TABLE public.inventory_lot_revaluations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.inventory_lot_revaluations IS
  'Append-only history of lot cost corrections (ADR 0078). One row per lot per '
  'revaluation, holding the price BEFORE the correction as well as after, so a '
  'verified invoice never destroys the estimate it corrects — the (estimated, '
  'verified) pair is the training signal for what a vendor really charges. '
  'lot_id is SET NULL on lot deletion so the record outlives the bottles.';

-- ===========================================================================
-- 3. revalue_lot — a correction that corrects
-- ===========================================================================
--
-- WHICH LOTS A CORRECTION TARGETS
--
-- The lots THIS delivery created, identified by `source_order_id`. Not "the
-- FIFO-oldest lot", and not "every lot for this wine". A restaurant can have
-- several deliveries of the same wine on the shelf; restating the oldest lot
-- with this invoice's price would apply one delivery's paperwork to a
-- different delivery's bottles — the same class of error as the blended WAC
-- this migration exists to remove. Because a delivery's lots all came from one
-- invoice at one price, "which of the matching lots" has no answer to get
-- wrong: all of them are revalued, and the question dissolves.
--
-- p_source_order_id is REQUIRED. A correction that cannot say which delivery
-- it corrects is refused rather than guessed at.
--
-- BOTTLES ALREADY POURED ARE NOT RESTATED. Lots consumed before the invoice
-- arrived are gone; their bottles were sold against the estimate and
-- retroactively restating closed COGS is a separate decision about historical
-- margin, not a receipt correction. So this revalues what is still on hand and
-- REPORTS THE COVERAGE — lots_matched and bottles_revalued come back in the
-- receipt, so a caller can see that a correction reached nothing instead of
-- assuming it reached everything. A system that reports absence as health is
-- the fault this codebase keeps finding; a function that returned void here
-- would be another instance of it.
--
-- NO LEDGER ROW IS WRITTEN, deliberately. `inventory_transactions` is a
-- QUANTITY ledger: `quantity_change` is its subject, `apply_stock_movement`
-- returns NULL early on a zero delta, and every consumer (the transaction
-- summary matview, drift arithmetic, movement counts) sums it. A revaluation
-- moves money and no bottles, so a zero-quantity row there would have to be
-- filtered by every one of those consumers forever, and would need a
-- 'revaluation' value added to the live inventory_transaction_type enum —
-- a change that reaches every switch on that type in the codebase. The audit
-- record belongs in inventory_lot_revaluations, which is built for it and
-- carries the before-value a ledger row could not.

CREATE OR REPLACE FUNCTION public.revalue_lot(
    p_inventory_id uuid,
    p_source_order_id uuid,
    p_unit_cost numeric,
    p_cost_provenance text,
    p_performed_by uuid DEFAULT NULL::uuid,
    p_reason text DEFAULT NULL::text,
    p_stock_state text DEFAULT 'live'::text
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid;
  v_lot record;
  v_lots_matched int := 0;
  v_bottles_matched int := 0;
  v_lots_revalued int := 0;
  v_bottles_revalued int := 0;
BEGIN
  IF p_cost_provenance IS NULL
     OR p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'revalue_lot: p_cost_provenance must be one of invoice, estimated, manual, sample (got %)', p_cost_provenance
      USING ERRCODE = '22023';
  END IF;

  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'revalue_lot: p_unit_cost is required — a revaluation to "unknown" would destroy a recorded price'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_order_id IS NULL THEN
    RAISE EXCEPTION 'revalue_lot: p_source_order_id is required. A correction must name the delivery it corrects; guessing which lot to restate is the defect this function exists to remove.'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  -- Same row lock apply_stock_movement takes, so a concurrent movement and a
  -- revaluation of the same wine serialise instead of interleaving.
  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, qty, unit_cost, cost_provenance
      FROM inventory_lots
     WHERE inventory_id   = p_inventory_id
       AND source_order_id = p_source_order_id
       AND stock_state    = p_stock_state
       AND qty > 0
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    v_lots_matched    := v_lots_matched + 1;
    v_bottles_matched := v_bottles_matched + v_lot.qty;

    -- Idempotent: verifyReceipt can be retried from an offline outbox, and a
    -- lot already carrying this exact price and provenance is not a correction.
    -- Skipping it also keeps the history free of no-op rows.
    CONTINUE WHEN v_lot.unit_cost IS NOT DISTINCT FROM p_unit_cost
              AND v_lot.cost_provenance IS NOT DISTINCT FROM p_cost_provenance;

    INSERT INTO inventory_lot_revaluations
      (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
       prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
       performed_by, reason)
    VALUES
      (v_restaurant, p_inventory_id, v_lot.id, p_source_order_id, v_lot.qty,
       v_lot.unit_cost, v_lot.cost_provenance, p_unit_cost, p_cost_provenance,
       p_performed_by, p_reason);

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_revalued    := v_lots_revalued + 1;
    v_bottles_revalued := v_bottles_revalued + v_lot.qty;
  END LOOP;

  -- The receipt. `lots_matched = 0` is a real and reportable answer: the
  -- delivery's bottles have all been poured, so there is nothing left to
  -- correct. The caller is told, rather than left to assume it worked.
  RETURN jsonb_build_object(
    'inventory_id',      p_inventory_id,
    'source_order_id',   p_source_order_id,
    'stock_state',       p_stock_state,
    'lots_matched',      v_lots_matched,
    'bottles_matched',   v_bottles_matched,
    'lots_revalued',     v_lots_revalued,
    'bottles_revalued',  v_bottles_revalued,
    'unit_cost',         p_unit_cost,
    'cost_provenance',   p_cost_provenance
  );
END;
$$;

COMMENT ON FUNCTION public.revalue_lot IS
  'Restate the cost of the lots a delivery created, without creating a rival '
  'lot or moving a bottle (ADR 0078). Targets lots by source_order_id — a '
  'correction must name the delivery it corrects. Writes the prior cost to '
  'inventory_lot_revaluations before overwriting it, writes NO '
  'inventory_transactions row (money moved, quantity did not), and is '
  'idempotent. Returns a jsonb receipt whose lots_matched / bottles_revalued '
  'let the caller see that a correction reached nothing rather than assume it '
  'reached everything.';

GRANT EXECUTE ON FUNCTION public.revalue_lot(uuid, uuid, numeric, text, uuid, text, text)
  TO anon, authenticated, service_role;

-- ===========================================================================
-- 4. One endpoint, one WAC
-- ===========================================================================
--
-- `inventory_lot_rollup.wac` excluded cost_provenance='sample';
-- `inventory_location_breakdown.wac` did not. Both are returned by the same
-- inventory endpoint (inventory.service.ts reads the rollup at :143 and the
-- breakdown at :163), so a wine with one free sample bottle reported two
-- different average costs for the same stock in one response — and only the
-- location one was dragged toward zero by a bottle that was free on purpose.
--
-- Production 2026-09-02 has 0 rows where the two currently disagree (2 lots
-- total, no sample lots), so this is a latent divergence being closed before
-- it produces a wrong number, not a repair of existing data.

CREATE OR REPLACE VIEW public.inventory_location_breakdown AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    location_id,
    stock_state,
    sum(qty) AS qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0)
            THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text)))
                        / (sum(qty) FILTER (WHERE ((unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id, location_id, stock_state;

COMMENT ON VIEW public.inventory_location_breakdown IS
  'Per-location lot rollup. wac excludes cost_provenance=''sample'' so it '
  'agrees with inventory_lot_rollup.wac, which always did (ADR 0078) — free '
  'bottles are stock but are not evidence of what stock costs.';

-- ===========================================================================
-- 5. Per-row cost COMPLETENESS, not just coverage
-- ===========================================================================
--
-- `has_invoice_cost` is `bool_or(cost_provenance = 'invoice')` over live lots,
-- while `wac` averages only lots with a non-null unit_cost. One invoiced bottle
-- among twenty-one therefore makes `resolveUnitCost` return the WAC and label
-- the whole row "invoiced lot WAC (inventory_lot_rollup.wac)" — a claim about
-- twenty-one bottles supported by one. The view could report per-row coverage
-- but not per-row COMPLETENESS, so nothing downstream could tell the two apart.
--
-- Three columns appended (CREATE OR REPLACE VIEW can only add at the end, and
-- sample_qty was last, so the existing column order is untouched and every
-- existing `.select("inventory_id, live_qty, wac, has_invoice_cost")` keeps
-- working unchanged):
--
--   wac_qty      live bottles the wac actually averages
--   invoice_qty  live bottles whose lot is invoice-provenanced
--   unpriced_qty live, non-sample bottles with no recorded cost at all

CREATE OR REPLACE VIEW public.inventory_lot_rollup AS
 SELECT inventory_id,
    restaurant_id,
    master_wine_id,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS live_qty,
    COALESCE(sum(qty) FILTER (WHERE ((stock_state)::text = 'shadow'::text)), (0)::bigint) AS shadow_qty,
        CASE
            WHEN (COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) > 0) THEN round((sum(((qty)::numeric * unit_cost)) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))) / (sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))))::numeric), 2)
            ELSE NULL::numeric
        END AS wac,
    bool_or(((cost_provenance)::text = 'invoice'::text)) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS has_invoice_cost,
    count(*) FILTER (WHERE ((stock_state)::text = 'live'::text)) AS live_lot_count,
    count(DISTINCT location_id) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (location_id IS NOT NULL))) AS live_location_count,
    COALESCE(sum(open_bottle_ml) FILTER (WHERE ((stock_state)::text = 'live'::text)), (0)::bigint) AS open_ml,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'sample'::text))), (0)::bigint) AS sample_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NOT NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS wac_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND ((cost_provenance)::text = 'invoice'::text))), (0)::bigint) AS invoice_qty,
    COALESCE(sum(qty) FILTER (WHERE (((stock_state)::text = 'live'::text) AND (unit_cost IS NULL) AND ((cost_provenance)::text <> 'sample'::text))), (0)::bigint) AS unpriced_qty
   FROM public.inventory_lots
  GROUP BY inventory_id, restaurant_id, master_wine_id;

COMMENT ON VIEW public.inventory_lot_rollup IS
  'Per-inventory lot rollup. wac excludes sample lots. wac_qty / invoice_qty / '
  'unpriced_qty added 2026-09-02 (ADR 0078) so a consumer can tell per-row '
  'COVERAGE (has_invoice_cost: at least one invoiced bottle) from per-row '
  'COMPLETENESS (wac_qty = live_qty: the average covers every bottle it is '
  'quoted for).';

COMMIT;
