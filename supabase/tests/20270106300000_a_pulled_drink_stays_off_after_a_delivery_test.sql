-- F-1465: a live receipt leaves a deliberate 'pulled' 86 open (no
-- ended_by_receipt, no drink_back_on row) and still ends a 'ran_out' one.
-- Migration a_pulled_drink_stays_off_after_a_delivery.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (P1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('wine2', gen_random_uuid()),
  ('item', gen_random_uuid()), ('item2', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC pulled house', 'syn-pull-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-PL-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k || ' ' || v::text, 'red'
  from t_fx where k in ('wine', 'wine2');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = k2), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = w), 750, 150
  from (values ('item', 'wine'), ('item2', 'wine2')) x(k2, w);

insert into public.stock_outs (restaurant_id, inventory_id, cause, started_at)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = i), c, now() - interval '2 hours'
  from (values ('item', 'pulled'), ('item2', 'ran_out')) x(i, c);

-- P1 (F-1465): a delivery of the pulled drink leaves it off.
do $$
declare
  s record;
  n int;
begin
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source,
     quantity_change, quantity_before, quantity_after, stock_type)
  values
    ((select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
     (select v from t_fx where k = 'wine'), 'purchase', 'order', 6, 4, 10, 'live');
  select * into s from public.stock_outs where inventory_id = (select v from t_fx where k = 'item');
  if s.ended_at is not null or s.ended_by_receipt is not null then
    raise exception 'P1 FAIL: a delivery put a pulled drink back on sale';
  end if;
  select count(*) into n from public.system_audit_log
   where action = 'drink_back_on' and entity_id = (select v from t_fx where k = 'item');
  if n <> 0 then
    raise exception 'P1 FAIL: % drink_back_on rows for a pulled drink', n;
  end if;
end $$;

-- P2: a drink that ran out still comes back on with its delivery.
do $$
declare
  v_txn uuid := gen_random_uuid();
  s record;
begin
  insert into public.inventory_transactions
    (id, restaurant_id, inventory_id, wine_id, transaction_type, source,
     quantity_change, quantity_before, quantity_after, stock_type)
  values
    (v_txn, (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'),
     (select v from t_fx where k = 'wine2'), 'purchase', 'order', 6, 0, 6, 'live');
  select * into s from public.stock_outs where inventory_id = (select v from t_fx where k = 'item2');
  if s.ended_at is null or s.ended_by_receipt is distinct from v_txn then
    raise exception 'P2 FAIL: a delivery left a drink that ran out sold out';
  end if;
end $$;

rollback;
