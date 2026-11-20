-- Migration every_good_can_run_low: v_low_stock_items holds every house good
-- below its par, wine or not, in the good's own unit, and never another
-- house's good.
--
-- Self-asserting: every block raises on a failure, so
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database
-- built from supabase/migrations. It must FAIL on a build without this
-- migration (T2: a house beer below par is missing from the view) and PASS
-- with it. One transaction, rolled back. All fixtures are SYNTHETIC. NEVER run
-- it against production.

begin;

insert into public.restaurants (id, name, slug) values
  ('e7e70000-0000-4000-8000-0000000000a1', 'SYNTHETIC every-good house A', 'synthetic-every-good-a'),
  ('e7e70000-0000-4000-8000-0000000000a2', 'SYNTHETIC every-good house B', 'synthetic-every-good-b');

insert into public.master_wine_library (id, wine_id, name, primary_type) values
  ('e7e70000-0000-4000-8000-0000000000b1', 'SYN-EVERY-GOOD-1', 'SYNTHETIC Red Below Par', 'red');

-- House A: a wine (library), a beer, a flour in grams, an oil in ml above
-- par, a sugar in grams exactly at par, and a lemon crate in transit.
-- House B: a flour in grams far below par.
insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, kind, uom, display_name, identity_provenance, threshold_min, last_counted_at, inventory_state)
values
  ('e7e70000-0000-4000-8000-0000000000c1', 'e7e70000-0000-4000-8000-0000000000a1', 'e7e70000-0000-4000-8000-0000000000b1', 'wine', 'bottle', 'SYNTHETIC Red Below Par', 'wine_library', 3, now(), 'IN_STOCK'),
  ('e7e70000-0000-4000-8000-0000000000c2', 'e7e70000-0000-4000-8000-0000000000a1', null, 'beer',  'bottle', 'SYNTHETIC House Lager', 'house_declared', 6,    now(), 'IN_STOCK'),
  ('e7e70000-0000-4000-8000-0000000000c3', 'e7e70000-0000-4000-8000-0000000000a1', null, 'food',  'g',      'SYNTHETIC Flour',       'house_declared', 500,  now(), 'IN_STOCK'),
  ('e7e70000-0000-4000-8000-0000000000c4', 'e7e70000-0000-4000-8000-0000000000a1', null, 'food',  'ml',     'SYNTHETIC Olive Oil',   'house_declared', 1000, now(), 'IN_STOCK'),
  ('e7e70000-0000-4000-8000-0000000000c5', 'e7e70000-0000-4000-8000-0000000000a1', null, 'food',  'g',      'SYNTHETIC Sugar',       'house_declared', 500,  now(), 'IN_STOCK'),
  ('e7e70000-0000-4000-8000-0000000000c6', 'e7e70000-0000-4000-8000-0000000000a1', null, 'food',  'each',   'SYNTHETIC Lemons',      'house_declared', 40,   now(), 'IN_TRANSIT'),
  ('e7e70000-0000-4000-8000-0000000000c7', 'e7e70000-0000-4000-8000-0000000000a2', null, 'food',  'g',      'SYNTHETIC Flour B',     'house_declared', 5000, now(), 'IN_STOCK');

-- Stock arrives through the one stock write (apply_stock_movement), naming
-- the house (ADR 0141): each figure is in the good's own unit.
select public.apply_stock_movement(p_inventory_id => r.id, p_stock_state => 'live', p_delta => r.delta,
         p_transaction_type => 'purchase', p_source => 'order',
         p_restaurant_id => r.house)
  from (values
    (1, 'e7e70000-0000-4000-8000-0000000000c1'::uuid, 1,    'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (2, 'e7e70000-0000-4000-8000-0000000000c2'::uuid, 2,    'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (3, 'e7e70000-0000-4000-8000-0000000000c3'::uuid, 200,  'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (4, 'e7e70000-0000-4000-8000-0000000000c4'::uuid, 1500, 'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (5, 'e7e70000-0000-4000-8000-0000000000c5'::uuid, 500,  'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (6, 'e7e70000-0000-4000-8000-0000000000c6'::uuid, 5,    'e7e70000-0000-4000-8000-0000000000a1'::uuid),
    (7, 'e7e70000-0000-4000-8000-0000000000c7'::uuid, 100,  'e7e70000-0000-4000-8000-0000000000a2'::uuid)
  ) as r(n, id, delta, house)
 order by r.n;

-- T0 the fixture is what it claims.
do $$
declare got text;
begin
  select string_agg(right(id::text, 2) || '=' || stock_live || uom, ',' order by id) into got
    from public.restaurant_inventory
   where restaurant_id in ('e7e70000-0000-4000-8000-0000000000a1', 'e7e70000-0000-4000-8000-0000000000a2');
  assert got = 'c1=1bottle,c2=2bottle,c3=200g,c4=1500ml,c5=500g,c6=5each,c7=100g',
    format('T0 FAIL stock per row is %s', got);
end $$;

-- T1 a wine below par is still there, named by the library, in bottles.
do $$
declare v record;
begin
  select wine_name, stock_live, threshold_min, uom, kind, producer into strict v
    from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c1';
  assert v.wine_name = 'SYNTHETIC Red Below Par', format('T1 FAIL wine named %s', v.wine_name);
  assert v.stock_live = 1 and v.threshold_min = 3, 'T1 FAIL wine figures';
  assert v.uom = 'bottle' and v.kind = 'wine', format('T1 FAIL wine unit %s kind %s', v.uom, v.kind);
exception when no_data_found then
  raise exception 'T1 FAIL a wine at 1 under par 3 is missing from v_low_stock_items';
end $$;

-- T2 a house beer with no library row, below par: there, named by the house.
do $$
declare v record;
begin
  select wine_name, stock_live, threshold_min, uom, kind, master_wine_id, producer, vintage into strict v
    from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c2';
  assert v.wine_name = 'SYNTHETIC House Lager', format('T2 FAIL beer named %s', v.wine_name);
  assert v.stock_live = 2 and v.threshold_min = 6, 'T2 FAIL beer figures';
  assert v.uom = 'bottle' and v.kind = 'beer', format('T2 FAIL beer unit %s kind %s', v.uom, v.kind);
  assert v.master_wine_id is null and v.producer is null and v.vintage is null,
    'T2 FAIL a beer was given wine library fields';
exception when no_data_found then
  raise exception 'T2 FAIL a house beer at 2 under par 6 is missing from v_low_stock_items';
end $$;

-- T3 a flour counted in grams, below its par in grams: there, both in g.
do $$
declare v record;
begin
  select wine_name, stock_live, threshold_min, uom, kind into strict v
    from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c3';
  assert v.wine_name = 'SYNTHETIC Flour', format('T3 FAIL flour named %s', v.wine_name);
  assert v.stock_live = 200 and v.threshold_min = 500,
    format('T3 FAIL flour reads %s against %s', v.stock_live, v.threshold_min);
  assert v.uom = 'g' and v.kind = 'food', format('T3 FAIL flour unit %s kind %s', v.uom, v.kind);
exception when no_data_found then
  raise exception 'T3 FAIL a flour at 200 g under par 500 g is missing from v_low_stock_items';
end $$;

-- T4 above par (1500 ml against 1000 ml) is not low.
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c4'),
    'T4 FAIL an oil above par is in v_low_stock_items';
end $$;

-- T5 exactly at par is not below par (ADR 0129, strictly).
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c5'),
    'T5 FAIL a sugar at par is in v_low_stock_items';
end $$;

-- T6 a good marked IN_TRANSIT is left out, as before.
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = 'e7e70000-0000-4000-8000-0000000000c6'),
    'T6 FAIL an in-transit good is in v_low_stock_items';
end $$;

-- T7 house A's read holds exactly its three low goods and never house B's.
do $$
declare got text;
begin
  select string_agg(right(id::text, 2), ',' order by id) into got
    from public.v_low_stock_items where restaurant_id = 'e7e70000-0000-4000-8000-0000000000a1';
  assert got = 'c1,c2,c3', format('T7 FAIL house A reads %s', got);
  assert exists (select 1 from public.v_low_stock_items
                  where id = 'e7e70000-0000-4000-8000-0000000000c7'
                    and restaurant_id = 'e7e70000-0000-4000-8000-0000000000a2'),
    'T7 FAIL house B''s own flour below par is missing from its own read';
end $$;

-- T8 the shape readers rely on: the first 40 columns as the baseline named
-- them, wine_name still varchar(255), three columns appended after them.
do $$
declare got text;
begin
  select string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' order by attnum) into got
    from pg_attribute
   where attrelid = 'public.v_low_stock_items'::regclass and attnum between 37 and 43;
  assert got = 'wine_name:character varying(255),producer:character varying(255),vintage:integer,'
            || 'restaurant_name:character varying(255),last_counted_at:timestamp with time zone,'
            || 'kind:text,uom:text',
    format('T8 FAIL the view''s tail columns are %s', got);
  assert (select count(*) from pg_attribute
           where attrelid = 'public.v_low_stock_items'::regclass and attnum > 0) = 43,
    'T8 FAIL the view does not have 43 columns';
end $$;

-- T9 still security_invoker, and no browser role may read it.
do $$
begin
  assert (select 'security_invoker=true' = any (reloptions) from pg_class
           where oid = 'public.v_low_stock_items'::regclass),
    'T9 FAIL v_low_stock_items is not security_invoker';
  assert not has_table_privilege('anon', 'public.v_low_stock_items', 'SELECT'),
    'T9 FAIL anon can read v_low_stock_items';
  assert not has_table_privilege('authenticated', 'public.v_low_stock_items', 'SELECT'),
    'T9 FAIL authenticated can read v_low_stock_items';
  assert has_table_privilege('service_role', 'public.v_low_stock_items', 'SELECT'),
    'T9 FAIL the service role cannot read v_low_stock_items';
end $$;

rollback;
