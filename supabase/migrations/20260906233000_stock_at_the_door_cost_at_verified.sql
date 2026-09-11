-- ===========================================================================
-- ADR 0103 A1 + A5 — stock is booked at the door, cost is finalised at VERIFIED
-- ===========================================================================
--
-- WHAT WAS WRONG (v3.0-TECH-DEBT.md, 2026-09-06 finding 2, V2).
--
-- `20260903160000_canonical_document_and_delivery.sql:603` added
--
--     inventory_lots.cost_state text NOT NULL DEFAULT 'final'
--
-- as a column with NO WRITER. Measured on production 2026-09-06: 165 of 165
-- lots read `final`. Every lot therefore certified its own cost as settled by
-- ABSENCE — nothing ever asserted it, the default said it. That is
-- [[absence-reported-as-health]] with a column for a face: a lot booked from a
-- door count, before anyone had read an invoice, was indistinguishable in the
-- data from one whose price a verified document had established.
--
-- The original comment's defence was that marking existing lots provisional
-- "would be a retroactive claim that their cost is unsettled". It has the
-- direction of the claim backwards. `final` is the assertion; `provisional` is
-- the absence of one. Defaulting to the assertion is what manufactures it.
--
-- WHAT THIS MIGRATION DOES.
--
--  1. `inventory_lots.delivery_id` — a lot knows which delivery booked it, so
--     a cost can be finalised for THAT delivery rather than for whatever
--     `source_order_id` happens to be shared by a split shipment (A2).
--
--  2. The default becomes `provisional`, and every existing row is restated
--     from the evidence it already carries rather than from a blanket choice.
--     THE RULE, and it is the same rule the new writer uses:
--
--        a lot is `final` when a PRICE and a PROVENANCE that names a human or a
--        document stand behind it (`unit_cost IS NOT NULL` and
--        `cost_provenance IN ('invoice','manual')`), and `provisional`
--        otherwise (no price at all, or an `estimated`/`sample` one).
--
--     This is not a guess about the past: `cost_provenance` has been NOT NULL
--     with a stated vocabulary since the baseline, and since ADR 0078
--     (`20260902150000`) it can no longer be inferred from the mere presence of
--     a price. So the column that says what kind of number the cost is, is
--     exactly the column that answers whether the cost is settled.
--
--     THE ALTERNATIVE, MEASURED AND REJECTED: "everything a delivery never
--     verified becomes provisional". On the live tenants that is every row —
--     no delivery has ever verified anything, `deliveries` having had no stock
--     writer until this PR — so it would restate 165 of 165 lots as unfinished,
--     including lots whose landed cost `verifyReceipt` had already corrected
--     from a real invoice. The row counts each choice touches are in the PR
--     body.
--
--  3. `apply_stock_movement` learns to say WHICH delivery a movement belongs to
--     and what the resulting lot's cost state is — WITHOUT a signature change.
--     A movement that names a delivery does so through the `p_reference_type` /
--     `p_reference_id` pair the function already takes. Adding parameters would
--     have created a SECOND overload (PostgREST resolves by name and would then
--     be ambiguous) or forced a DROP that silently discards the baseline ACL.
--     The body changes; the 17-argument signature does not.
--
--  4. `finalise_delivery_cost` — the VERIFIED half of A1. It restates the cost
--     of the lots ONE delivery booked, writes the prior price to
--     `inventory_lot_revaluations` first, flips `cost_state` to `final`, and
--     NEVER touches a quantity. It is `revalue_lot`'s rule keyed on the
--     delivery instead of the order, because an UNORDERED delivery has no order
--     to key on and a split shipment has one order for two deliveries.
--
-- NOT APPLIED BY HAND. The Supabase GitHub integration applies migrations on
-- merge, keyed by this filename.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. A lot knows its delivery
-- ---------------------------------------------------------------------------

alter table public.inventory_lots
  add column if not exists delivery_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_lots_delivery_id_fkey') then
    alter table public.inventory_lots
      add constraint inventory_lots_delivery_id_fkey
      foreign key (delivery_id) references public.deliveries(id) on delete set null;
  end if;
end;
$$;

create index if not exists inventory_lots_delivery
  on public.inventory_lots (delivery_id)
  where delivery_id is not null;

comment on column public.inventory_lots.delivery_id is
  'ADR 0103 A1/A2: the delivery whose door count booked this lot. Written by apply_stock_movement when the caller names p_reference_type = ''delivery''. NULL for every lot booked by a path that predates the delivery model — never a claim that no delivery exists, only that this row does not name one.';

-- ---------------------------------------------------------------------------
-- 1b. A counted line can name the shelf it belongs on
-- ---------------------------------------------------------------------------
--
-- `procurement_document_lines` carried a vendor SKU, a description and a
-- quantity, and NOTHING that says which of this restaurant's items the line is.
-- A booking cannot be invented from a description: matching "Öküzgözü 750ml" to
-- a shelf is a guess, and a wrong guess books ten bottles onto the wrong wine.
-- So the column is here, the door supplies it when it knows, and a line that
-- names no shelf is reported as NOT BOOKED with the reason — never booked onto
-- a guessed item, and never silently dropped (A6).

alter table public.procurement_document_lines
  add column if not exists inventory_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'procurement_document_lines_inventory_id_fkey') then
    alter table public.procurement_document_lines
      add constraint procurement_document_lines_inventory_id_fkey
      foreign key (inventory_id) references public.restaurant_inventory(id) on delete set null;
  end if;
end;
$$;

comment on column public.procurement_document_lines.inventory_id is
  'ADR 0103 A1: the restaurant item this line is about, when the caller knows it. The door supplies it; extraction does not guess it. NULL means "this line names no shelf" — the booking path reports such a line as not booked, with the reason, rather than matching it by description.';

-- ---------------------------------------------------------------------------
-- 2. The default stops certifying, and the past is restated from its evidence
-- ---------------------------------------------------------------------------

alter table public.inventory_lots
  alter column cost_state set default 'provisional';

update public.inventory_lots
   set cost_state = case
         when unit_cost is not null
          and cost_provenance::text in ('invoice','manual') then 'final'
         else 'provisional'
       end
 where cost_state is distinct from (case
         when unit_cost is not null
          and cost_provenance::text in ('invoice','manual') then 'final'
         else 'provisional'
       end);

comment on column public.inventory_lots.cost_state is
  'ADR 0103 A1. `provisional` = the cost behind this quantity is not settled — stock booked at the door before the invoice was agreed, or a lot carrying an estimated price or no price at all. `final` = a document or a named person established the price (cost_provenance invoice or manual, with a unit_cost). Defaults to `provisional` since 20260906233000: `final` is an ASSERTION and a default cannot make one. Written by apply_stock_movement at booking and by finalise_delivery_cost at VERIFIED.';

-- ---------------------------------------------------------------------------
-- 3. apply_stock_movement stamps the delivery and the cost state
-- ---------------------------------------------------------------------------
--
-- The parameter list is byte-identical to the deployed 17-argument signature,
-- so CREATE OR REPLACE replaces the body in place and the ACL survives. The
-- only additions are three assignments and the two columns they fill.

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
  v_delivery uuid;
  v_cost_state text;
BEGIN
  IF p_delta = 0 THEN RETURN NULL; END IF;
  IF p_stock_state NOT IN ('live','shadow') THEN RAISE EXCEPTION 'invalid stock_state %', p_stock_state; END IF;

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
     reference_type, reference_id, pos_transaction_id, notes, metadata, delivery_id)
  VALUES
    (v_restaurant, p_inventory_id, v_wine, p_transaction_type::inventory_transaction_type, p_source::inventory_transaction_source,
     p_delta, v_before, v_after, p_stock_state, p_unit_cost, p_performed_by,
     CASE WHEN p_performed_by IS NOT NULL THEN 'user' ELSE 'system' END,
     p_reason, p_order_id, p_idempotency_key, now(),
     p_reference_type, p_reference_id, p_pos_transaction_id, p_notes, COALESCE(p_metadata, '{}'::jsonb), v_delivery)
  RETURNING id INTO v_txn;

  RETURN v_txn;
END;
$$;

COMMENT ON FUNCTION public.apply_stock_movement IS
  'Single stock write primitive (SimPOS testbed plan, decision A1). Locks the '
  'inventory row, depletes/creates lots FIFO, writes the ledger row, and is '
  'idempotent on p_idempotency_key. Extended 2026-08-05 with reference_type, '
  'reference_id, pos_transaction_id, notes and metadata. Changed 2026-09-02 '
  '(ADR 0078): cost provenance is never inferred. Changed 2026-09-06 (ADR 0103 '
  'A1): a caller naming p_reference_type = ''delivery'' stamps '
  'inventory_transactions.delivery_id and inventory_lots.delivery_id, and the '
  'lot it creates is cost_state = ''provisional'' until finalise_delivery_cost '
  'settles it at VERIFIED. Every other new lot is ''final'' only when a price '
  'and an invoice/manual provenance stand behind it. Use revalue_lot or '
  'finalise_delivery_cost to CORRECT a cost — this function only ever creates '
  'or consumes quantity.';

-- ---------------------------------------------------------------------------
-- 4. finalise_delivery_cost — the VERIFIED half
-- ---------------------------------------------------------------------------

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
    SELECT id, qty, unit_cost, cost_provenance, cost_state, source_order_id
      FROM inventory_lots
     WHERE inventory_id = p_inventory_id
       AND delivery_id  = p_delivery_id
       AND stock_state  = p_stock_state
       AND qty > 0
     ORDER BY received_at ASC, created_at ASC
     FOR UPDATE
  LOOP
    v_lots_matched    := v_lots_matched + 1;
    v_bottles_matched := v_bottles_matched + v_lot.qty;

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
       p_performed_by, COALESCE(p_reason, 'delivery ' || p_delivery_id::text || ' verified (ADR 0103 A1)'));

    UPDATE inventory_lots
       SET unit_cost       = p_unit_cost,
           cost_provenance = p_cost_provenance,
           cost_state      = 'final',
           updated_at      = now()
     WHERE id = v_lot.id;

    v_lots_finalised    := v_lots_finalised + 1;
    v_bottles_finalised := v_bottles_finalised + v_lot.qty;
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
    'cost_provenance',    p_cost_provenance
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
  'finalisation reached nothing rather than assume it reached everything.';

GRANT EXECUTE ON FUNCTION public.finalise_delivery_cost(uuid, uuid, numeric, text, uuid, text, text)
  TO anon, authenticated, service_role;

COMMIT;
