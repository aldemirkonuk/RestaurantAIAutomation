-- F-343 (sim wave 5, 2026-10-09): a lot's cost states its currency. Migration
-- a_lot_cost_states_its_currency adds inventory_lots.unit_cost_currency, a
-- trigger that copies the booking order's currency, and two rollup columns.
--
-- Self-asserting: every block raises on a failure, so `psql -v ON_ERROR_STOP=1
-- -f` stops at the first one. It must FAIL on a build without that migration
-- (T1: there is no column) and PASS with it. One transaction, rolled back.

begin;

-- T1 the column exists, is varchar(3), nullable, and refuses a non-ISO code.
do $$
declare
  t text;
  nn boolean;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull into t, nn
    from pg_attribute a
   where a.attrelid = 'public.inventory_lots'::regclass
     and a.attname = 'unit_cost_currency' and not a.attisdropped;
  assert t = 'character varying(3)', format('T1 FAIL unit_cost_currency is %s', coalesce(t, 'absent'));
  assert nn = false, 'T1 FAIL unit_cost_currency is NOT NULL; null must mean not stated';
  assert exists (select 1 from pg_constraint
                  where conname = 'inventory_lots_unit_cost_currency_is_iso_4217'
                    and conrelid = 'public.inventory_lots'::regclass and convalidated),
    'T1 FAIL no validated ISO 4217 CHECK';
end $$;

-- Fixture: one house, one shelf, one EUR order and one TRY order, booked
-- through the real ledger RPC so the trigger is proved on the delivery path.
insert into public.restaurants (id, name, slug) values
  ('f3430000-0000-4000-8000-000000000001', 'F343 lot house', 'f343-lot-house');
insert into public.providers (id, name, primary_contact, restaurant_id) values
  ('f3430000-0000-4000-8000-0000000000b1', 'Zqlc Vendor', '{}'::jsonb, 'f3430000-0000-4000-8000-000000000001');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('f3430000-0000-4000-8000-0000000000c1', 'f3430000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqlc Shelf', 'house_declared');
insert into public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total,
   final_price, total_cost, status, currency, currency_source) values
  ('f3430000-0000-4000-8000-000000000101', 'ZQLC-1', 'f3430000-0000-4000-8000-000000000001', 'f3430000-0000-4000-8000-0000000000c1', 'f3430000-0000-4000-8000-0000000000b1', 6, 6, 20, 120, 'COMPLETED', 'EUR', 'typed'),
  ('f3430000-0000-4000-8000-000000000102', 'ZQLC-2', 'f3430000-0000-4000-8000-000000000001', 'f3430000-0000-4000-8000-0000000000c1', 'f3430000-0000-4000-8000-0000000000b1', 6, 6, 900, 5400, 'COMPLETED', 'TRY', 'typed');

do $$
declare
  v_house uuid := 'f3430000-0000-4000-8000-000000000001';
  v_inv   uuid := 'f3430000-0000-4000-8000-0000000000c1';
  v_eur   uuid := 'f3430000-0000-4000-8000-000000000101';
  v_try   uuid := 'f3430000-0000-4000-8000-000000000102';
  r record;
begin
  perform public.apply_stock_movement(
    p_inventory_id => v_inv, p_stock_state => 'live', p_delta => 6,
    p_transaction_type => 'purchase', p_source => 'order', p_reason => 'F-343 probe',
    p_unit_cost => 20, p_cost_provenance => 'invoice', p_order_id => v_eur,
    p_idempotency_key => 'f343-eur-' || v_eur::text, p_restaurant_id => v_house);

  -- T2 the delivered lot took the order's currency.
  select unit_cost_currency into r from public.inventory_lots where source_order_id = v_eur;
  assert r.unit_cost_currency = 'EUR', format('T2 FAIL delivered lot currency is %s, expected EUR', coalesce(r.unit_cost_currency, 'NULL'));

  -- T3 the rollup names the one currency its WAC is in.
  select cost_currency, cost_currency_count into r
    from public.inventory_lot_rollup where inventory_id = v_inv;
  assert r.cost_currency = 'EUR' and r.cost_currency_count = 1,
    format('T3 FAIL rollup says %s / %s, expected EUR / 1', coalesce(r.cost_currency, 'NULL'), r.cost_currency_count);

  -- T4 a second lot in another money: the WAC now mixes two, and says so.
  perform public.apply_stock_movement(
    p_inventory_id => v_inv, p_stock_state => 'live', p_delta => 6,
    p_transaction_type => 'purchase', p_source => 'order', p_reason => 'F-343 probe',
    p_unit_cost => 900, p_cost_provenance => 'invoice', p_order_id => v_try,
    p_idempotency_key => 'f343-try-' || v_try::text, p_restaurant_id => v_house);
  select cost_currency, cost_currency_count into r
    from public.inventory_lot_rollup where inventory_id = v_inv;
  assert r.cost_currency is null and r.cost_currency_count = 2,
    format('T4 FAIL mixed rollup says %s / %s, expected NULL / 2', coalesce(r.cost_currency, 'NULL'), r.cost_currency_count);

  -- T5 a stated code is never overwritten by the trigger.
  update public.inventory_lots set unit_cost_currency = 'GBP', unit_cost = 21 where source_order_id = v_eur;
  assert (select unit_cost_currency from public.inventory_lots where source_order_id = v_eur) = 'GBP',
    'T5 FAIL the trigger overwrote a stated currency';

  -- T6 a lot with no order stays NULL: nothing is guessed.
  insert into public.inventory_lots (restaurant_id, inventory_id, stock_state, qty, unit_cost, cost_provenance)
    values (v_house, v_inv, 'live', 1, 10, 'manual');
  assert (select unit_cost_currency from public.inventory_lots
           where inventory_id = v_inv and source_order_id is null) is null,
    'T6 FAIL a lot with no order was given a currency';
end $$;

rollback;
