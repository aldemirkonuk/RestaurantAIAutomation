-- a_sale_settles_its_cost (QA round 15 finding 2): a bottle sold before its
-- delivery was VERIFIED kept its provisional or missing cost forever, because
-- finalise_delivery_cost skipped lots sold to 0 and nothing wrote what a
-- provisional draw owes (draws are append-only; ADR 0103).
--
-- The session's call under the 2026-11-07 /goal: provisional, then settled,
-- append-only. Rejected: restamping draws, editing cost_total, settling draws
-- taken at final cost. 1. draws widen to numeric(14,6) (as PR #909 widens
-- lots); 2. inventory_lot_draw_settlements; 3. finalise_delivery_cost, the
-- 20260906233000 body plus sold-out provisional lots and settlements, same
-- signature and receipt keys; 4. inventory_transaction_settled_cost.
-- Older rows: scripts/jobs/settle-provisional-draws.sql (founder, dry run).

BEGIN;

-- 1. a draw carries six places, like a landed cost

ALTER TABLE public.inventory_lot_draws ALTER COLUMN unit_cost TYPE numeric(14,6);

-- 2. the settlements

CREATE TABLE IF NOT EXISTS public.inventory_lot_draw_settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    seq bigint GENERATED ALWAYS AS IDENTITY,
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    draw_id uuid NOT NULL REFERENCES public.inventory_lot_draws(id) ON DELETE CASCADE,
    lot_id uuid NOT NULL REFERENCES public.inventory_lots(id) ON DELETE CASCADE,
    txn_id uuid NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
    inventory_id uuid NOT NULL,
    revaluation_id uuid NOT NULL REFERENCES public.inventory_lot_revaluations(id) ON DELETE CASCADE,
    qty integer NOT NULL CHECK (qty > 0),
    prior_unit_cost numeric(14,6) NULL,
    settled_unit_cost numeric(14,6) NOT NULL,
    prior_total numeric(14,2) NULL,
    settled_total numeric(14,2) NOT NULL,
    difference numeric(14,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_lot_draw_settlements_once UNIQUE (draw_id, revaluation_id),
    CONSTRAINT inventory_lot_draw_settlements_difference_adds_up
      CHECK (difference = settled_total - COALESCE(prior_total, 0))
);

CREATE INDEX IF NOT EXISTS idx_inventory_lot_draw_settlements_txn ON public.inventory_lot_draw_settlements (txn_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot_draw_settlements_lot ON public.inventory_lot_draw_settlements (lot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot_draw_settlements_house_time ON public.inventory_lot_draw_settlements (restaurant_id, created_at);

COMMENT ON TABLE public.inventory_lot_draw_settlements IS
  'What a bottle that left on a price not yet settled was settled at, once its delivery was verified. One row per draw per revaluation that changed its cost. The draw keeps the cost it was stamped with; this row says the agreed cost and the difference owed. Written only by finalise_delivery_cost (and the founder''s one-off scripts/jobs/settle-provisional-draws.sql). Append-only: a later price is a new row against the latest one, never an edit.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.seq IS
  'Order of writing. Two settlements written in one transaction share created_at; seq says which came last.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.prior_unit_cost IS
  'What a bottle of this draw cost before this settlement: the latest settlement''s cost, else the draw''s own. NULL means the draw left with no price.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.settled_unit_cost IS
  'The agreed cost per bottle this settlement sets.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.prior_total IS
  'qty x prior_unit_cost, to the cent. NULL when the draw had no price.';
COMMENT ON COLUMN public.inventory_lot_draw_settlements.difference IS
  'What the sale''s cost moves by: settled_total minus prior_total (an unpriced draw counts its whole settled_total).';

CREATE OR REPLACE FUNCTION public.inventory_lot_draw_settlements_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'inventory_lot_draw_settlements is append-only: % is not permitted. A settlement records what a sold bottle was settled at; a later price is a new settlement, not an edit.',
    TG_OP
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION public.inventory_lot_draw_settlements_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on inventory_lot_draw_settlements, except the deletes its own foreign keys cascade (a_sale_settles_its_cost).';

DROP TRIGGER IF EXISTS trg_inventory_lot_draw_settlements_append_only ON public.inventory_lot_draw_settlements;
CREATE TRIGGER trg_inventory_lot_draw_settlements_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_lot_draw_settlements
  FOR EACH ROW EXECUTE FUNCTION public.inventory_lot_draw_settlements_append_only();

DROP TRIGGER IF EXISTS trg_inventory_lot_draw_settlements_no_truncate ON public.inventory_lot_draw_settlements;
CREATE TRIGGER trg_inventory_lot_draw_settlements_no_truncate
  BEFORE TRUNCATE ON public.inventory_lot_draw_settlements
  FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_lot_draw_settlements_append_only();

ALTER TABLE public.inventory_lot_draw_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_lot_draw_settlements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.inventory_lot_draw_settlements TO service_role;
DROP POLICY IF EXISTS inventory_lot_draw_settlements_service_role_read ON public.inventory_lot_draw_settlements;
CREATE POLICY inventory_lot_draw_settlements_service_role_read
  ON public.inventory_lot_draw_settlements FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS inventory_lot_draw_settlements_service_role_append ON public.inventory_lot_draw_settlements;
CREATE POLICY inventory_lot_draw_settlements_service_role_append
  ON public.inventory_lot_draw_settlements FOR INSERT TO service_role WITH CHECK (true);

-- 3. finalise_delivery_cost
CREATE OR REPLACE FUNCTION public.finalise_delivery_cost(
    p_delivery_id uuid,
    p_inventory_id uuid,
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
  v_lots_finalised int := 0;
  v_bottles_finalised int := 0;
  -- a_sale_settles_its_cost
  v_reval uuid;
  v_draw record;
  v_prior numeric;
  v_empty_lots_finalised int := 0;
  v_draws_settled int := 0;
BEGIN
  IF p_delivery_id IS NULL THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_delivery_id is required. A cost that names no delivery cannot say which bottles it settles.'
      USING ERRCODE = '22023';
  END IF;

  IF p_cost_provenance IS NULL
     OR p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_cost_provenance must be one of invoice, estimated, manual, sample (got %)', p_cost_provenance
      USING ERRCODE = '22023';
  END IF;

  -- An agreed price is the whole point of VERIFIED. Finalising to NULL would
  -- stamp `final` on a cost nobody established — the exact shape of finding 2,
  -- reintroduced by its own fix.
  IF p_unit_cost IS NULL THEN
    RAISE EXCEPTION 'finalise_delivery_cost: p_unit_cost is required. A lot with no agreed price stays provisional; it does not become a final cost of nothing.'
      USING ERRCODE = '22023';
  END IF;

  IF p_stock_state NOT IN ('live','shadow') THEN
    RAISE EXCEPTION 'invalid stock_state %', p_stock_state;
  END IF;

  SELECT restaurant_id INTO v_restaurant
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN
    RAISE EXCEPTION 'inventory % not found', p_inventory_id;
  END IF;

  FOR v_lot IN
    SELECT id, restaurant_id, qty, unit_cost, cost_provenance, cost_state, source_order_id
      FROM inventory_lots
     WHERE inventory_id = p_inventory_id
       AND delivery_id  = p_delivery_id
       AND stock_state  = p_stock_state
       -- a_sale_settles_its_cost: a lot sold out while provisional is still
       -- finalised; a sold-out final lot is never touched again.
       AND (qty > 0 OR cost_state = 'provisional')
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    -- lots_matched and bottles_matched still count lots that hold bottles.
    IF v_lot.qty > 0 THEN
      v_lots_matched    := v_lots_matched + 1;
      v_bottles_matched := v_bottles_matched + v_lot.qty;
    END IF;

    -- Idempotent: a re-verify of the same delivery at the same agreed price is
    -- not a correction, and a no-op row in the history would say it was.
    CONTINUE WHEN v_lot.unit_cost IS NOT DISTINCT FROM p_unit_cost
              AND v_lot.cost_provenance IS NOT DISTINCT FROM p_cost_provenance
              AND v_lot.cost_state = 'final';

    INSERT INTO inventory_lot_revaluations
      (restaurant_id, inventory_id, lot_id, source_order_id, qty_at_revaluation,
       prior_unit_cost, prior_cost_provenance, new_unit_cost, new_cost_provenance,
       performed_by, reason)
    VALUES
      (v_restaurant, p_inventory_id, v_lot.id, v_lot.source_order_id, v_lot.qty,
       v_lot.unit_cost, v_lot.cost_provenance, p_unit_cost, p_cost_provenance,
       p_performed_by, COALESCE(p_reason, 'delivery ' || p_delivery_id::text || ' verified (ADR 0103 A1)'))
    RETURNING id INTO v_reval;

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           cost_state      = 'final',
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_finalised    := v_lots_finalised + 1;
    v_bottles_finalised := v_bottles_finalised + v_lot.qty;
    IF v_lot.qty = 0 THEN
      v_empty_lots_finalised := v_empty_lots_finalised + 1;
    END IF;

    -- a_sale_settles_its_cost: every bottle that left this lot on a price not
    -- yet settled (provisional, or none) owes the difference to the agreed
    -- price. A draw taken while the lot was final is never settled. The prior
    -- cost is the latest settlement's, else the draw's own, so a re-verify at
    -- the same price writes nothing and one at a new price chains.
    FOR v_draw IN
      SELECT d.id, d.txn_id, d.inventory_id, d.qty, d.unit_cost
        FROM inventory_lot_draws d
       WHERE d.lot_id = v_lot.id
         AND (d.cost_state = 'provisional' OR d.unit_cost IS NULL)
       ORDER BY d.created_at, d.id
    LOOP
      SELECT s.settled_unit_cost INTO v_prior
        FROM inventory_lot_draw_settlements s
       WHERE s.draw_id = v_draw.id
       ORDER BY s.created_at DESC, s.seq DESC
       LIMIT 1;
      IF NOT FOUND THEN
        v_prior := v_draw.unit_cost;
      END IF;
      CONTINUE WHEN v_prior IS NOT DISTINCT FROM p_unit_cost;

      INSERT INTO inventory_lot_draw_settlements
        (restaurant_id, draw_id, lot_id, txn_id, inventory_id, revaluation_id, qty,
         prior_unit_cost, settled_unit_cost, prior_total, settled_total, difference)
      VALUES
        (v_lot.restaurant_id, v_draw.id, v_lot.id, v_draw.txn_id, v_draw.inventory_id, v_reval, v_draw.qty,
         v_prior, p_unit_cost, round(v_draw.qty * v_prior, 2), round(v_draw.qty * p_unit_cost, 2),
         round(v_draw.qty * p_unit_cost, 2) - COALESCE(round(v_draw.qty * v_prior, 2), 0));
      v_draws_settled := v_draws_settled + 1;
    END LOOP;
  END LOOP;

  -- `lots_matched = 0` is a real answer, returned rather than swallowed: the
  -- delivery booked nothing for this item, or the bottles have all been poured.
  RETURN jsonb_build_object(
    'delivery_id',        p_delivery_id,
    'inventory_id',       p_inventory_id,
    'stock_state',        p_stock_state,
    'lots_matched',       v_lots_matched,
    'bottles_matched',    v_bottles_matched,
    'lots_finalised',     v_lots_finalised,
    'bottles_finalised',  v_bottles_finalised,
    'unit_cost',          p_unit_cost,
    'cost_provenance',    p_cost_provenance,
    'empty_lots_finalised', v_empty_lots_finalised,
    'draws_settled',      v_draws_settled
  );
END;
$$;

COMMENT ON FUNCTION public.finalise_delivery_cost IS
  'ADR 0103 A1, the VERIFIED half: restate the cost of the lots ONE delivery '
  'booked at the door and flip them from provisional to final. Keyed on '
  'inventory_lots.delivery_id, not source_order_id — an UNORDERED delivery has '
  'no order and a split shipment has one order for two deliveries (A2). Writes '
  'the prior price to inventory_lot_revaluations before overwriting it, writes '
  'NO inventory_transactions row (money moved, quantity did not), refuses a '
  'NULL price rather than stamping final on nothing, and is idempotent. '
  'Returns a receipt whose lots_matched lets the caller see that a '
  'finalisation reached nothing rather than assume it reached everything. '
  'Since a_sale_settles_its_cost it also finalises a lot sold out while '
  'provisional (empty_lots_finalised) and writes one '
  'inventory_lot_draw_settlements row per provisional or unpriced draw whose '
  'cost the new price changes (draws_settled).';

GRANT EXECUTE ON FUNCTION public.finalise_delivery_cost(uuid, uuid, numeric, text, uuid, text, text)
  TO anon, authenticated, service_role;

-- 4. a ledger row's cost, settled

CREATE OR REPLACE VIEW public.inventory_transaction_settled_cost
WITH (security_invoker = true) AS
SELECT t.id AS txn_id,
       t.restaurant_id,
       t.inventory_id,
       t.cost_total,
       COALESCE(s.difference, 0)::numeric(14,2) AS settled_difference,
       CASE WHEN t.cost_total IS NULL AND s.txn_id IS NULL THEN NULL
            ELSE (COALESCE(t.cost_total, 0) + COALESCE(s.difference, 0))::numeric(14,2)
       END AS settled_cost_total,
       t.unpriced_qty,
       (t.unpriced_qty - COALESCE(u.qty, 0))::integer AS unpriced_qty_remaining
  FROM public.inventory_transactions t
  LEFT JOIN (SELECT txn_id, sum(difference) AS difference
               FROM public.inventory_lot_draw_settlements GROUP BY txn_id) s ON s.txn_id = t.id
  LEFT JOIN (SELECT d.txn_id, sum(d.qty) AS qty
               FROM public.inventory_lot_draws d
              WHERE d.unit_cost IS NULL
                AND EXISTS (SELECT 1 FROM public.inventory_lot_draw_settlements x WHERE x.draw_id = d.id)
              GROUP BY d.txn_id) u ON u.txn_id = t.id;

COMMENT ON VIEW public.inventory_transaction_settled_cost IS
  'A ledger row''s cost with its settlements added (a_sale_settles_its_cost). cost_total is what was stamped when the bottles left; settled_difference is the sum of inventory_lot_draw_settlements.difference; settled_cost_total is the two together, NULL only when nothing was ever priced or settled. unpriced_qty_remaining is unpriced_qty less the bottles of unpriced draws that have since been settled.';

REVOKE ALL ON public.inventory_transaction_settled_cost FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.inventory_transaction_settled_cost TO service_role;

-- Structural assertions (catalogs only).
DO $$
DECLARE
  v_src text;
  r text;
BEGIN
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalise_delivery_cost';
  IF position('(qty > 0 OR cost_state = ''provisional'')' in v_src) = 0 THEN
    RAISE EXCEPTION 'finalise_delivery_cost does not reach a sold-out provisional lot';
  END IF;
  IF position('INSERT INTO inventory_lot_draw_settlements' in v_src) = 0 THEN
    RAISE EXCEPTION 'finalise_delivery_cost settles no draw';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inventory_lot_draw_settlements'::regclass) THEN
    RAISE EXCEPTION 'inventory_lot_draw_settlements has RLS off';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.inventory_lot_draw_settlements', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
       OR has_table_privilege(r, 'public.inventory_transaction_settled_cost', 'SELECT') THEN
      RAISE EXCEPTION 'the settlements are reachable by %', r;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.inventory_lot_draw_settlements', 'UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'inventory_lot_draw_settlements grants service_role a change it must not make';
  END IF;
END;
$$;

COMMIT;
