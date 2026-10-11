-- F-1243: wine_consumption_summary counted a sale pos-hub had marked
-- reversed (F-1197). Migration a_voided_sale_leaves_the_consumption_summary
-- leaves marked rows out, keeping the view's columns, grants and
-- security_invoker.
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
select v, 'SYNTHETIC summary house', 'syn-sum-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-SM-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC Okuzgozu', 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

-- The sale of 3 bottles, taken back by a correction to 1: the first row is
-- marked, and one live row of what the check still holds stands.
insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml,
   total_revenue, source, notes, reversed_at, reversed_by_key)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       'SYNTHETIC Okuzgozu', 'bottle', 3, 2250, 300, 'pos', 'pos:syn:CHK1:okuz:0',
       now(), 'pos:syn:CHK1:item:bottles:1';
insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml,
   total_revenue, source, notes)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       'SYNTHETIC Okuzgozu', 'bottle', 1, 750, 100, 'pos', 'pos:syn:CHK1:item:bottles:1';
-- A glass sale the till voided: marked, so no glass counts.
insert into public.wine_consumption_log
  (restaurant_id, inventory_id, wine_name, consumption_type, quantity, volume_ml,
   total_revenue, source, notes, reversed_at, reversed_by_key)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
       'SYNTHETIC Okuzgozu', 'glass', 2, 300, 40, 'pos', 'pos:syn:CHK2:okuz-g:0',
       now(), 'pos:syn:CHK2:item:void:1';

-- T1: the summary counts only what stands.
do $$
declare s record;
begin
  select * into s from public.wine_consumption_summary
   where restaurant_id = (select v from t_fx where k = 'house');
  if s.bottles_consumed <> 1 then
    raise exception 'T1 FAIL: a taken-back sale still counts, % bottles', s.bottles_consumed;
  end if;
  if s.glasses_consumed <> 0 then
    raise exception 'T1 FAIL: a voided glass still counts, % glasses', s.glasses_consumed;
  end if;
  if s.total_volume_ml <> 750 or s.total_revenue <> 100 or s.bottle_revenue <> 100
     or s.glass_revenue <> 0 then
    raise exception 'T1 FAIL: volume % / revenue % / bottle % / glass % count reversed rows',
      s.total_volume_ml, s.total_revenue, s.bottle_revenue, s.glass_revenue;
  end if;
end $$;

-- T2: the columns stay as they were, in order.
do $$
declare cols text;
begin
  select string_agg(column_name::text, ',' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'wine_consumption_summary';
  if cols <> 'restaurant_id,inventory_id,wine_name,bottles_consumed,glasses_consumed,'
             'total_volume_ml,bottle_revenue,glass_revenue,total_revenue' then
    raise exception 'T2 FAIL: columns changed: %', cols;
  end if;
end $$;

-- T3: the view stays security_invoker and closed to client roles (OD-72).
do $$
declare r text;
begin
  if not exists (
    select 1 from pg_class c
     where c.oid = 'public.wine_consumption_summary'::regclass
       and 'security_invoker=true' = any (coalesce(c.reloptions, '{}'))
  ) then
    raise exception 'T3 FAIL: the view lost security_invoker';
  end if;
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r)
       and has_table_privilege(r, 'public.wine_consumption_summary', 'SELECT') then
      raise exception 'T3 FAIL: % can read the view', r;
    end if;
  end loop;
end $$;

rollback;
