-- a_sale_carries_its_cost: stock that leaves a lot says which lot and what it
-- cost, stamped when it left (cost-math lane 2.2, narrowed; R19 of PR #589).
--
-- WRONG BEFORE: apply_stock_movement's FIFO loop took bottles out of lots and
-- wrote a ledger row that named no lot and carried no cost. The cost of what
-- sold could only be guessed later, at today's average, and not at all once a
-- lot was revalued or the item sold out (proposal fork F1).
--
-- 1. public.inventory_lot_draws: one row per lot a negative movement touched
--    (lot, bottles taken, that lot's unit_cost, cost_state and provenance as
--    they were at that moment). Append-only for every role.
-- 2. inventory_transactions.cost_total and .unpriced_qty: the money of the
--    priced bottles that left, and how many left with no price.
-- 3. apply_stock_movement: the body of a_used_up_lot_is_kept verbatim; the
--    FIFO loop also reads each lot's cost and remembers what it took, the
--    ledger INSERT carries the two totals, and the draws are written after it
--    (the ledger row's id exists only then). Same signature: ACL, comment and
--    the one overload are kept. SECURITY INVOKER, as before.
--
-- Unchanged on purpose in this slice: the ledger row's unit_cost is still
-- p_unit_cost; record_glass_pour (re-created by the open one_pour_size_for_the_house
-- PR) writes no draws yet; transfer_stock writes none (stock stays in the
-- house); an idempotent replay returns before any draw is written.
--
-- Who reads the draws: nobody yet. Cost of goods (lane 3.1) reads them as
-- service_role. inventory_lots has RLS on and NO policy (OD-72 closed it by
-- revoking client grants: 20260825210000_od72_revoke_client_grants.sql), so
-- its shape, copied here, is RLS on, no anon/authenticated grant and no
-- member policy; service_role may SELECT and INSERT only.

BEGIN;

-- 1. the draws

CREATE TABLE IF NOT EXISTS public.inventory_lot_draws (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    txn_id uuid NOT NULL REFERENCES public.inventory_transactions(id) ON DELETE CASCADE,
    lot_id uuid NOT NULL REFERENCES public.inventory_lots(id) ON DELETE CASCADE,
    inventory_id uuid NOT NULL,
    qty integer NOT NULL CHECK (qty > 0),
    unit_cost numeric(10,2) NULL,
    cost_state text NULL,
    cost_provenance text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lot_draws_txn ON public.inventory_lot_draws (txn_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot_draws_lot ON public.inventory_lot_draws (lot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lot_draws_house_time ON public.inventory_lot_draws (restaurant_id, created_at);

COMMENT ON TABLE public.inventory_lot_draws IS
  'Which lots a stock movement took bottles out of, and what those bottles cost when they left. One row per lot touched by a negative apply_stock_movement (a sale, a write-off, a count shortfall). Written only by apply_stock_movement, in the same transaction as its ledger row. Append-only: a wrong draw is answered by a new movement, never by an edit. Lots are kept at 0, never deleted (R6), so a draw always finds its lot.';
COMMENT ON COLUMN public.inventory_lot_draws.txn_id IS
  'The ledger row (inventory_transactions) this draw belongs to.';
COMMENT ON COLUMN public.inventory_lot_draws.lot_id IS
  'The lot the bottles came out of.';
COMMENT ON COLUMN public.inventory_lot_draws.inventory_id IS
  'The house item, as the ledger row names it at the moment of the draw.';
COMMENT ON COLUMN public.inventory_lot_draws.qty IS
  'Whole bottles taken out of this lot by this movement. Always more than 0.';
COMMENT ON COLUMN public.inventory_lot_draws.unit_cost IS
  'The lot''s cost per bottle at the moment of the draw. NULL means the lot had no price then: unknown, never 0 (ADR 0067).';
COMMENT ON COLUMN public.inventory_lot_draws.cost_state IS
  'The lot''s cost_state at the moment of the draw: provisional means the price was not settled yet, so a later restatement owes a difference.';
COMMENT ON COLUMN public.inventory_lot_draws.cost_provenance IS
  'The lot''s cost_provenance at the moment of the draw (invoice, manual, estimated or sample).';
COMMENT ON COLUMN public.inventory_lot_draws.created_at IS
  'When the draw was written. The moment the stock left is the ledger row''s transaction_date.';

-- Append-only. The one exception is a referential action (the house, the
-- ledger row or the lot deleted), which arrives from inside the referential
-- trigger, one level down; the same shape as tmwc_append_only
-- (20261201110000_a_wage_is_the_owners_and_every_change_is_kept.sql). A
-- statement issued directly, by anyone, is refused.
CREATE OR REPLACE FUNCTION public.inventory_lot_draws_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'inventory_lot_draws is append-only: % is not permitted. A draw records what a bottle cost when it left; a correction is a new stock movement, not an edit.',
    TG_OP
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION public.inventory_lot_draws_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on inventory_lot_draws, except the deletes its own foreign keys cascade (a_sale_carries_its_cost).';

DROP TRIGGER IF EXISTS trg_inventory_lot_draws_append_only ON public.inventory_lot_draws;
CREATE TRIGGER trg_inventory_lot_draws_append_only
  BEFORE UPDATE OR DELETE ON public.inventory_lot_draws
  FOR EACH ROW EXECUTE FUNCTION public.inventory_lot_draws_append_only();

-- A row trigger does not see TRUNCATE; this one does.
DROP TRIGGER IF EXISTS trg_inventory_lot_draws_no_truncate ON public.inventory_lot_draws;
CREATE TRIGGER trg_inventory_lot_draws_no_truncate
  BEFORE TRUNCATE ON public.inventory_lot_draws
  FOR EACH STATEMENT EXECUTE FUNCTION public.inventory_lot_draws_append_only();

ALTER TABLE public.inventory_lot_draws ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory_lot_draws FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.inventory_lot_draws TO service_role;
DROP POLICY IF EXISTS inventory_lot_draws_service_role_read ON public.inventory_lot_draws;
CREATE POLICY inventory_lot_draws_service_role_read
  ON public.inventory_lot_draws FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS inventory_lot_draws_service_role_append ON public.inventory_lot_draws;
CREATE POLICY inventory_lot_draws_service_role_append
  ON public.inventory_lot_draws FOR INSERT TO service_role WITH CHECK (true);

-- 2. the ledger row's totals

ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS cost_total numeric(12,2) NULL;
ALTER TABLE public.inventory_transactions ADD COLUMN IF NOT EXISTS unpriced_qty integer NULL;

COMMENT ON COLUMN public.inventory_transactions.cost_total IS
  'What the bottles that left cost, stamped when they left: the sum of qty x unit_cost over this row''s inventory_lot_draws that had a price. NULL when no bottle that left had a price (unknown, never 0, ADR 0067), and on every row that added stock. Not the older total_cost column, which apply_stock_movement never writes.';
COMMENT ON COLUMN public.inventory_transactions.unpriced_qty IS
  'Bottles that left with no price: drawn from lots with no unit_cost, plus any the FIFO loop found no lot for. 0 when every bottle was priced; NULL on rows that added stock. NULL on a row that removed stock means it was written before a_sale_carries_its_cost: its cost was never stamped and is unknown.';

-- 3. apply_stock_movement

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
    p_metadata jsonb DEFAULT NULL::jsonb,
    p_restaurant_id uuid DEFAULT NULL::uuid,
    p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_restaurant uuid; v_wine uuid;
  v_before int; v_after int; v_remaining int; v_txn uuid; v_lot record;
  v_provenance text;
  v_delivery uuid;
  v_cost_state text;
  v_owned boolean;
  -- a_sale_carries_its_cost: what the FIFO loop took, lot by lot.
  v_take int;
  v_cost_total numeric(12,2);
  v_unpriced int;
  v_draw_lot uuid[] := '{}';
  v_draw_qty int[] := '{}';
  v_draw_cost numeric[] := '{}';
  v_draw_state text[] := '{}';
  v_draw_prov text[] := '{}';
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

  -- ADR 0141 — THE FIRST ASSERTION, BEFORE THE IDEMPOTENCY LOOKUP.
  --
  -- It sits here rather than beside the FOR UPDATE below for one reason: the
  -- idempotency short-circuit returns an EXISTING transaction id for a key it
  -- has seen, and a key is not tenant-scoped. Checking only after that would
  -- let a caller naming another house's item confirm, and retrieve the id of,
  -- a transaction it has no business seeing. A movement that names a house
  -- proves the item is that house's BEFORE anything is looked up or returned.
  --
  -- Deliberately not `FOR UPDATE`: this is a refusal test, not the read the
  -- write depends on, and taking the row lock before the idempotency check
  -- would make every replay contend for a lock it does not need. The
  -- authoritative comparison is repeated below, inside the lock.
  --
  -- A NULL p_restaurant_id asserts NOTHING. That is the deploy window, and it
  -- is temporary — see the header.
  IF p_restaurant_id IS NOT NULL THEN
    SELECT true INTO v_owned FROM restaurant_inventory
      WHERE id = p_inventory_id AND restaurant_id = p_restaurant_id;
    IF v_owned IS NOT TRUE THEN
      RAISE EXCEPTION
        'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
        p_inventory_id, p_restaurant_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_cost_provenance IS NOT NULL
     AND p_cost_provenance NOT IN ('invoice','estimated','manual','sample') THEN
    RAISE EXCEPTION 'invalid cost_provenance %', p_cost_provenance;
  END IF;

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

  -- ADR 0103 A1. A movement that NAMES a delivery books against it, and what it
  -- books is provisional until somebody verifies the delivery. Everything else
  -- is final only when a price AND a provenance that names a document or a
  -- person stand behind it — an estimate is not a settled cost, and saying so
  -- is the whole of finding 2.
  v_delivery := CASE WHEN p_reference_type = 'delivery' THEN p_reference_id ELSE NULL END;
  v_cost_state := CASE
    WHEN v_delivery IS NOT NULL THEN 'provisional'
    WHEN p_unit_cost IS NOT NULL AND v_provenance IN ('invoice','manual') THEN 'final'
    ELSE 'provisional'
  END;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_txn FROM inventory_transactions WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_txn IS NOT NULL THEN RETURN v_txn; END IF;
  END IF;

  SELECT restaurant_id, master_wine_id INTO v_restaurant, v_wine
    FROM restaurant_inventory WHERE id = p_inventory_id FOR UPDATE;
  IF v_restaurant IS NULL THEN RAISE EXCEPTION 'inventory % not found', p_inventory_id; END IF;

  -- ADR 0141 — THE AUTHORITATIVE ASSERTION, UNDER THE ROW LOCK.
  --
  -- The check above ran without a lock, so between it and here the item could
  -- in principle have been moved to another restaurant. This one is the
  -- comparison the write actually depends on: v_restaurant is the value about
  -- to be stamped on the lot and the ledger row, and it is compared against
  -- what the caller said it would be. Same sentence, because it is the same
  -- refusal.
  IF p_restaurant_id IS NOT NULL AND v_restaurant <> p_restaurant_id THEN
    RAISE EXCEPTION
      'apply_stock_movement: item % is not an item of restaurant %, so no stock was moved and no ledger row was written. A stock movement names the house it is for, and this one does not match the item.',
      p_inventory_id, p_restaurant_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(qty),0) INTO v_before FROM inventory_lots
    WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state;
  v_after := v_before + p_delta;
  IF v_after < 0 THEN RAISE EXCEPTION 'stock would go negative: % + %', v_before, p_delta; END IF;

  IF p_delta > 0 THEN
    INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance, source_order_id, delivery_id, cost_state)
    VALUES (v_restaurant, p_inventory_id, v_wine, p_location_id, p_stock_state, p_delta, p_unit_cost,
            v_provenance, p_order_id, v_delivery, v_cost_state);
  ELSE
    v_remaining := -p_delta;
    v_unpriced := 0;
    FOR v_lot IN SELECT id, qty, unit_cost, cost_state, cost_provenance FROM inventory_lots
        WHERE inventory_id = p_inventory_id AND stock_state = p_stock_state AND qty > 0
        ORDER BY received_at ASC, created_at ASC LOOP
      EXIT WHEN v_remaining <= 0;
      -- a_sale_carries_its_cost: the lot's cost as it is now, before the take.
      v_take := LEAST(v_lot.qty, v_remaining);
      v_draw_lot := v_draw_lot || v_lot.id;
      v_draw_qty := v_draw_qty || v_take;
      v_draw_cost := v_draw_cost || v_lot.unit_cost;
      v_draw_state := v_draw_state || v_lot.cost_state::text;
      v_draw_prov := v_draw_prov || v_lot.cost_provenance::text;
      IF v_lot.unit_cost IS NULL THEN
        v_unpriced := v_unpriced + v_take;
      ELSE
        v_cost_total := COALESCE(v_cost_total, 0) + v_take * v_lot.unit_cost;
      END IF;
      IF v_lot.qty <= v_remaining THEN
        v_remaining := v_remaining - v_lot.qty;
        -- a_used_up_lot_is_kept (R6): kept at 0 with its cost, never deleted;
        -- trg_a_used_up_lot_is_marked marks it depleted if it holds nothing.
        UPDATE inventory_lots SET qty = 0, updated_at = now() WHERE id = v_lot.id;
      ELSE
        UPDATE inventory_lots SET qty = qty - v_remaining, updated_at = now() WHERE id = v_lot.id;
        v_remaining := 0;
      END IF;
    END LOOP;
    -- Bottles the loop found no lot for leave unpriced; the over-draw itself
    -- behaves exactly as before. cost_total stays NULL when nothing was priced.
    v_unpriced := v_unpriced + GREATEST(v_remaining, 0);
  END IF;

  INSERT INTO inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source, quantity_change, quantity_before, quantity_after,
     stock_type, unit_cost, performed_by, performed_by_type, reason, order_id, idempotency_key, transaction_date,
     reference_type, reference_id, pos_transaction_id, notes, metadata, delivery_id,
     cost_total, unpriced_qty)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key,
     -- a_pos_sale_is_dated_by_its_check: the moment the movement HAPPENED, as
     -- the caller knows it (a POS check's closed_at), never later than now.
     -- NULL is now(), exactly as before. created_at keeps entry time.
     LEAST(COALESCE(p_occurred_at, now()), now()),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery,
     v_cost_total, v_unpriced)
  RETURNING id INTO v_txn;

  -- a_sale_carries_its_cost: one draw per lot touched, now that the ledger
  -- row has an id. Positive movements took nothing, so they write none.
  IF cardinality(v_draw_lot) > 0 THEN
    INSERT INTO inventory_lot_draws
      (restaurant_id, txn_id, lot_id, inventory_id, qty, unit_cost, cost_state, cost_provenance)
    SELECT v_restaurant, v_txn, d.lot_id, p_inventory_id, d.qty, d.unit_cost, d.cost_state, d.cost_provenance
      FROM unnest(v_draw_lot, v_draw_qty, v_draw_cost, v_draw_state, v_draw_prov)
           AS d(lot_id, qty, unit_cost, cost_state, cost_provenance);
  END IF;

  RETURN v_txn;
END;
$$;

-- Structural assertions (catalogs only).
DO $$
DECLARE
  v_src text;
  r text;
BEGIN
  IF (SELECT array_agg(p.pronargs) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement') IS DISTINCT FROM ARRAY[19::int2] THEN
    RAISE EXCEPTION 'expected exactly one public.apply_stock_movement, of 19 arguments';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_stock_movement';
  IF v_src ~* 'DELETE\s+FROM\s+(public\.)?inventory_lots' THEN
    RAISE EXCEPTION 'apply_stock_movement deletes a lot again; a used-up lot is kept (R6)';
  END IF;
  IF position('LEAST(COALESCE(p_occurred_at, now()), now())' in v_src) = 0 THEN
    RAISE EXCEPTION 'apply_stock_movement lost ADR 0281''s dating in the copy';
  END IF;
  IF position('INSERT INTO inventory_lot_draws' in v_src) = 0
     OR position('INSERT INTO inventory_lot_draws' in v_src) < position('INSERT INTO inventory_transactions' in v_src) THEN
    RAISE EXCEPTION 'apply_stock_movement must write its draws after its ledger row';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.inventory_lot_draws'::regclass) THEN
    RAISE EXCEPTION 'inventory_lot_draws has RLS off';
  END IF;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(r, 'public.inventory_lot_draws', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') THEN
      RAISE EXCEPTION 'inventory_lot_draws is reachable by %', r;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.inventory_lot_draws', 'UPDATE, DELETE, TRUNCATE') THEN
    RAISE EXCEPTION 'inventory_lot_draws grants service_role a change it must not make';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.inventory_lot_draws'::regclass
                    AND tgname = 'trg_inventory_lot_draws_append_only' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'trg_inventory_lot_draws_append_only is missing';
  END IF;
END;
$$;

COMMIT;
