-- F-1197: a voided or corrected-down POS sale stayed in wine_consumption_log.
-- Migration a_voided_sale_is_not_consumption adds reversed_at and
-- reversed_by_key, which pos-hub sets on the sale's row when the till takes
-- the sale back, and which every reader filters on.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('item', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC void house', 'syn-void-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-VD-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Kalecik', 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

-- The sale, as pos-hub mirrors it: 3 bottles under the line's stock key.
insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       'SYNTHETIC Kalecik', 'bottle', 3, 2250, 'pos', 'pos:syn:CHK1:kalecik:0';

-- T1: the void marks the sale's row; the row is kept and a reader that
-- leaves marked rows out sees no bottles for the check.
do $$
declare n int; live int;
begin
  update public.wine_consumption_log
     set reversed_at = now(), reversed_by_key = 'pos:syn:CHK1:item:void:1'
   where notes = 'pos:syn:CHK1:kalecik:0';
  select count(*), coalesce(sum(quantity) filter (where reversed_at is null), 0)
    into n, live
    from public.wine_consumption_log
   where restaurant_id = (select v from t_fx where k = 'house');
  if n <> 1 then raise exception 'T1 FAIL: the marked row must be kept, found % rows', n; end if;
  if live <> 0 then raise exception 'T1 FAIL: a voided sale still counts % bottles', live; end if;
end $$;

-- T2: a replay of the voided sale under its own key cannot write it again:
-- the marked row keeps the key taken.
do $$
begin
  begin
    insert into public.wine_consumption_log
      (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml, source, notes)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
           'SYNTHETIC Kalecik', 'bottle', 3, 2250, 'pos', 'pos:syn:CHK1:kalecik:0';
    raise exception 'T2 FAIL: a replay of the voided sale wrote a second row';
  exception when unique_violation then null;
  end;
end $$;

-- T3: a mark is both columns or neither.
do $$
begin
  begin
    update public.wine_consumption_log set reversed_by_key = null
     where notes = 'pos:syn:CHK1:kalecik:0';
    raise exception 'T3 FAIL: a mark with a time and no key was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.wine_consumption_log
      (restaurant_id, inventory_id, consumption_type, quantity, volume_ml, source, notes, reversed_by_key)
    select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
           'bottle', 1, 750, 'pos', 'pos:syn:CHK2:kalecik:0', 'pos:syn:CHK2:item:void:1';
    raise exception 'T3 FAIL: a key with no time was accepted';
  exception when check_violation then null;
  end;
end $$;

-- T4: an unmarked row stays live; a new row is unmarked by default.
do $$
declare live int;
begin
  insert into public.wine_consumption_log
    (restaurant_id, inventory_id, consumption_type, quantity, volume_ml, source, notes)
  select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
         'bottle', 2, 1500, 'pos', 'pos:syn:CHK3:item:bottles:1';
  select coalesce(sum(quantity), 0) into live
    from public.wine_consumption_log
   where restaurant_id = (select v from t_fx where k = 'house') and reversed_at is null;
  if live <> 2 then raise exception 'T4 FAIL: expected 2 live bottles, found %', live; end if;
end $$;

rollback;
