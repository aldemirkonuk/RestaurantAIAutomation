-- F-1160 / F-1165 (sim 40): migration
-- an_open_bottle_stays_and_a_shelf_count_stays_on_its_shelf.
--   F-1160: a take-off that empties a lot holding an open bottle keeps the lot
--           at qty 0 with its ml (F-428), AND still writes lots_taken (F-644).
--   F-1165: a count of one shelf does not stamp the wine's last_counted_at; a
--           count of every shelf still does.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. On a build WITHOUT the
-- migration T1 and T2 FAIL; T3 passes either way (kept behaviour). One
-- transaction, rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('cellar', gen_random_uuid()), ('bar', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC open-bottle shelf house', 'syn-obshelf-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-OB-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Kalecik Karasi', 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

insert into public.storage_locations (id, restaurant_id, zone, capacity_bottles)
select (select v from t_fx where k = l), (select v from t_fx where k = 'house'), z, 100
  from (values ('cellar', 'Cellar'), ('bar', 'Bar')) as x(l, z);

-- Cellar: 6 sealed. Bar: 2 sealed + 300 ml open, costed, the older lot.
insert into public.inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state,
                                   qty, open_bottle_ml, received_at, unit_cost, cost_provenance, cost_state)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       (select v from t_fx where k = 'wine'), (select v from t_fx where k = l), 'live', q, ml, now() - d,
       12.00, 'invoice', 'final'
  from (values ('bar', 2, 300, interval '30 days'), ('cellar', 6, 0, interval '2 days')) as x(l, q, ml, d);

-- T1 (F-1160) a breakage of the Bar's 2 sealed bottles keeps the Bar lot at
-- qty 0 with its 300 ml, and the ledger row still says which lot it took.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_bar uuid := (select v from t_fx where k = 'bar');
  v_txn uuid;
  l record;
  taken jsonb;
begin
  v_txn := public.apply_stock_movement(
    p_inventory_id => v_item, p_stock_state => 'live', p_delta => -2,
    p_transaction_type => 'waste', p_source => 'manual', p_reason => 'SYNTHETIC breakage at the bar',
    p_location_id => v_bar, p_idempotency_key => 'syn-obshelf-t1-' || v_item::text);
  select qty, open_bottle_ml into l from public.inventory_lots
   where inventory_id = v_item and location_id = v_bar;
  assert l.qty is not null,
    'T1 FAIL the Bar lot was deleted with its open bottle (300 ml left the books)';
  assert l.qty = 0 and l.open_bottle_ml = 300,
    format('T1 FAIL the Bar lot is %s sealed + %s ml, expected 0 + 300', l.qty, l.open_bottle_ml);
  assert (select coalesce(sum(qty), 0) from public.inventory_lots
           where inventory_id = v_item and location_id = (select v from t_fx where k = 'cellar')) = 6,
    'T1 FAIL a Bar breakage took bottles off the Cellar';
  select metadata->'lots_taken' into taken from public.inventory_transactions where id = v_txn;
  assert jsonb_array_length(taken) = 1 and (taken->0->>'qty')::int = 2
         and (taken->0->>'location_id')::uuid = v_bar and (taken->0->>'unit_cost')::numeric = 12.00,
    format('T1 FAIL lots_taken is %s, expected the Bar lot, 2 bottles at 12.00', taken);
end $$;

-- T2 (F-1165) counting the Cellar dates that count on its stock_counts row
-- and leaves the wine's last_counted_at alone: the Bar was not counted.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  v_cellar uuid := (select v from t_fx where k = 'cellar');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item, p_counted_qty => 5,
    p_idempotency_key => 'count:' || v_item::text || ':cellar', p_location_id => v_cellar);
  assert (select location_id from public.stock_counts where id = (r->>'count_id')::uuid) = v_cellar,
    'T2 FAIL the shelf count does not name its shelf';
  assert (select last_counted_at from public.restaurant_inventory where id = v_item) is null,
    format('T2 FAIL a count of the Cellar alone marked the whole wine counted at %s',
           (select last_counted_at from public.restaurant_inventory where id = v_item));
end $$;

-- T3 kept: a count of every shelf still stamps last_counted_at, and an
-- agreeing count (every sealed bottle on the books) moves no stock.
do $$
declare
  v_item uuid := (select v from t_fx where k = 'item');
  r jsonb;
begin
  r := public.record_stock_count(
    p_inventory_id => v_item,
    p_counted_qty => (select coalesce(sum(qty), 0)::int from public.inventory_lots
                       where inventory_id = v_item and stock_state = 'live'),
    p_idempotency_key => 'count:' || v_item::text || ':whole');
  assert (r->>'variance_qty')::int = 0, format('T3 FAIL variance %s, expected 0', r->>'variance_qty');
  assert (select last_counted_at from public.restaurant_inventory where id = v_item) = now(),
    'T3 FAIL a count of every shelf did not stamp last_counted_at';
end $$;

rollback;
