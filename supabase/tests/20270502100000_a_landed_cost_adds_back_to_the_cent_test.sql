-- QA round 15, finding 3: a landed cost shares freight over bottles, so its
-- cost per bottle has more than two places. 4.90 freight over 1000 bottles at
-- 10 is 10.0049 a bottle. With inventory_lots.unit_cost numeric(10,2) the lot
-- keeps 10.00, the whole 4.90 vanishes, and finalise_delivery_cost's
-- idempotency check (unit_cost IS NOT DISTINCT FROM p_unit_cost) compares the
-- stored 10.00 with 10.0049, so every re-verify writes another revaluation.
-- The landed-cost stack posts six places and carries #839's numeric(14,6).
--
-- Self-asserting (assert -> P0004). It must PASS with #839's migration and
-- FAIL without it (L1 keeps 10.00; L2 sees a second revaluation).
-- One transaction, rolled back. Fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('delivery', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC landed cents house', 'syn-landcents-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance)
select (select v from t_fx where k = 'wine'), (select v from t_fx where k = 'house'),
       null, 'food', 'bottle', 'SYNTHETIC house red', 'house_declared';

insert into public.deliveries (id, restaurant_id, state)
select (select v from t_fx where k = 'delivery'), (select v from t_fx where k = 'house'), 'DELIVERED';

-- The door booked 1000 bottles with no price: a provisional lot of the delivery.
insert into public.inventory_lots
  (restaurant_id, inventory_id, stock_state, qty, unit_cost, cost_provenance, cost_state, delivery_id)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'wine'),
       'live', 1000, null, 'estimated', 'provisional', (select v from t_fx where k = 'delivery');

-- L1 VERIFIED posts 10.0049; the lot keeps it, and 1000 bottles add back to 10004.90.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'wine');
  v_del uuid := (select v from t_fx where k = 'delivery');
  r jsonb;
  c numeric;
begin
  r := public.finalise_delivery_cost(v_del, v_item, 10.0049, 'invoice');
  assert (r->>'lots_finalised')::int = 1, format('L1 FAIL expected one lot finalised, got %s', r);
  select unit_cost into c from public.inventory_lots where inventory_id = v_item;
  assert c = 10.0049, format('L1 FAIL the lot kept %s a bottle, expected 10.0049 (the freight vanished)', c);
  assert round(c * 1000, 2) = 10004.90, format('L1 FAIL 1000 bottles add back to %s, expected 10004.90', round(c * 1000, 2));
end $$;

-- L2 a re-verify at the same six-place cost is a no-op: no second revaluation.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'wine');
  v_del uuid := (select v from t_fx where k = 'delivery');
  r jsonb;
  n int;
begin
  r := public.finalise_delivery_cost(v_del, v_item, 10.0049, 'invoice');
  assert (r->>'lots_finalised')::int = 0, format('L2 FAIL a re-verify at the same cost finalised again: %s', r);
  select count(*) into n from public.inventory_lot_revaluations where inventory_id = v_item;
  assert n = 1, format('L2 FAIL %s revaluation rows after two verifies at one cost, expected 1', n);
end $$;

rollback;
