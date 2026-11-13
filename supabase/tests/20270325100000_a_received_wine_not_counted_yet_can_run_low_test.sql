-- OD-161, second half: migration a_received_wine_not_counted_yet_can_run_low
-- lets a never-counted wine into v_low_stock_items once receipts and sales
-- have given it a figure (a live stock movement), and still keeps out a wine
-- with neither a count nor a movement.
--
-- Self-asserting: every block raises on a failure, so
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run it on a database
-- built from supabase/migrations. It must FAIL on a build that stops at
-- an_uncounted_wine_is_not_low_stock (T2: received 10, sold 8, par 3, not
-- counted, is missing from the view) and PASS with this migration.
-- One transaction, rolled back. All fixtures are SYNTHETIC. NEVER run it
-- against production.

begin;

insert into public.restaurants (id, name, slug)
values ('0d161200-0000-4000-8000-000000000001', 'SYNTHETIC OD-161 received house', 'synthetic-od161-received');

insert into public.master_wine_library (id, wine_id, name, primary_type) values
  ('0d161200-0000-4000-8000-0000000000b1', 'SYN-OD161R-1', 'SYNTHETIC Linked Never Moved', 'red'),
  ('0d161200-0000-4000-8000-0000000000b2', 'SYN-OD161R-2', 'SYNTHETIC Received Sold Low', 'red'),
  ('0d161200-0000-4000-8000-0000000000b3', 'SYN-OD161R-3', 'SYNTHETIC Received Sold Above', 'white'),
  ('0d161200-0000-4000-8000-0000000000b4', 'SYN-OD161R-4', 'SYNTHETIC Received At Par', 'white'),
  ('0d161200-0000-4000-8000-0000000000b5', 'SYN-OD161R-5', 'SYNTHETIC Received Sold Out', 'red'),
  ('0d161200-0000-4000-8000-0000000000b6', 'SYN-OD161R-6', 'SYNTHETIC Shadow Only', 'red'),
  ('0d161200-0000-4000-8000-0000000000b7', 'SYN-OD161R-7', 'SYNTHETIC Counted Low', 'red');

-- Every row: par 3, never counted, except c7 (counted).
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, threshold_min, last_counted_at) values
  ('0d161200-0000-4000-8000-0000000000c1', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b1', 3, null),
  ('0d161200-0000-4000-8000-0000000000c2', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b2', 3, null),
  ('0d161200-0000-4000-8000-0000000000c3', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b3', 3, null),
  ('0d161200-0000-4000-8000-0000000000c4', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b4', 3, null),
  ('0d161200-0000-4000-8000-0000000000c5', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b5', 3, null),
  ('0d161200-0000-4000-8000-0000000000c6', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b6', 3, null),
  ('0d161200-0000-4000-8000-0000000000c7', '0d161200-0000-4000-8000-000000000001', '0d161200-0000-4000-8000-0000000000b7', 3, now());

-- Receipts and sales go through the one stock write (apply_stock_movement),
-- naming the house (ADR 0141).
select public.apply_stock_movement(p_inventory_id => r.id, p_stock_state => r.state, p_delta => r.delta,
         p_transaction_type => r.kind, p_source => r.src,
         p_restaurant_id => '0d161200-0000-4000-8000-000000000001')
  from (values
    (1, '0d161200-0000-4000-8000-0000000000c2'::uuid, 'live',   10, 'purchase', 'order'),
    (2, '0d161200-0000-4000-8000-0000000000c2'::uuid, 'live',   -8, 'sale',     'pos'),
    (3, '0d161200-0000-4000-8000-0000000000c3'::uuid, 'live',   10, 'purchase', 'order'),
    (4, '0d161200-0000-4000-8000-0000000000c3'::uuid, 'live',   -6, 'sale',     'pos'),
    (5, '0d161200-0000-4000-8000-0000000000c4'::uuid, 'live',    3, 'purchase', 'order'),
    (6, '0d161200-0000-4000-8000-0000000000c5'::uuid, 'live',    5, 'purchase', 'order'),
    (7, '0d161200-0000-4000-8000-0000000000c5'::uuid, 'live',   -5, 'sale',     'pos'),
    (8, '0d161200-0000-4000-8000-0000000000c6'::uuid, 'shadow',  2, 'purchase', 'order'),
    (9, '0d161200-0000-4000-8000-0000000000c7'::uuid, 'live',    1, 'purchase', 'order')
  ) as r(n, id, state, delta, kind, src)
 order by r.n;

-- T0 the fixture is what it claims: received minus sold is on stock_live.
do $$
declare got text;
begin
  select string_agg(right(id::text, 2) || '=' || stock_live, ',' order by id) into got
    from public.restaurant_inventory
   where restaurant_id = '0d161200-0000-4000-8000-000000000001';
  assert got = 'c1=0,c2=2,c3=4,c4=3,c5=0,c6=0,c7=1',
    format('T0 FAIL stock_live per row is %s', got);
  assert not exists (select 1 from public.restaurant_inventory
                      where id <> '0d161200-0000-4000-8000-0000000000c7'
                        and restaurant_id = '0d161200-0000-4000-8000-000000000001'
                        and last_counted_at is not null),
    'T0 FAIL a movement stamped last_counted_at; only a count may';
end $$;

-- T1 a linked wine with no count and no movement is still not low stock.
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c1'),
    'T1 FAIL a never-counted, never-moved row at the default 0 is in v_low_stock_items';
end $$;

-- T2 received 10, sold 8, par 3, never counted: low stock (the QA round 4 case).
do $$
declare v_stock int; v_counted timestamptz;
begin
  select stock_live, last_counted_at into strict v_stock, v_counted
    from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c2';
  assert v_stock = 2, format('T2 FAIL expected 2 bottles, view says %s', v_stock);
  assert v_counted is null, 'T2 FAIL the view does not say this wine was never counted';
exception when no_data_found then
  raise exception 'T2 FAIL a received-and-sold, never-counted wine at 2 under par 3 is missing from v_low_stock_items';
end $$;

-- T3 received and sold but still above par: not low.
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c3'),
    'T3 FAIL 4 against par 3 is in v_low_stock_items';
end $$;

-- T4 at par is not below par (ADR 0129, strictly).
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c4'),
    'T4 FAIL 3 against par 3 is in v_low_stock_items';
end $$;

-- T5 received 5, sold 5, never counted: computed 0 is low stock.
do $$
begin
  assert exists (select 1 from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c5'),
    'T5 FAIL a received-then-sold-through, never-counted wine is missing from v_low_stock_items';
end $$;

-- T6 a shadow movement is not a live figure: the row stays unknown.
do $$
begin
  assert not exists (select 1 from public.v_low_stock_items where id = '0d161200-0000-4000-8000-0000000000c6'),
    'T6 FAIL a row with only a shadow movement is in v_low_stock_items';
end $$;

-- T7 a counted wine below par is still low, and says it was counted.
do $$
begin
  assert exists (select 1 from public.v_low_stock_items
                  where id = '0d161200-0000-4000-8000-0000000000c7' and last_counted_at is not null),
    'T7 FAIL a counted row at 1 under par 3 is missing, or lost its last_counted_at';
end $$;

-- T8 the shape: 41 columns, last_counted_at last, the first 40 as before.
do $$
declare n int; last_col text; first_col text; col40 text;
begin
  select count(*), max(attname) filter (where attnum = 41), max(attname) filter (where attnum = 1),
         max(attname) filter (where attnum = 40)
    into n, last_col, first_col, col40
    from pg_attribute where attrelid = 'public.v_low_stock_items'::regclass and attnum > 0 and not attisdropped;
  assert n = 41 and last_col = 'last_counted_at' and first_col = 'id' and col40 = 'restaurant_name',
    format('T8 FAIL view has %s columns, #1 %s, #40 %s, #41 %s', n, first_col, col40, last_col);
end $$;

-- T9 the view still runs as the caller, and anon/authenticated cannot read it.
do $$
begin
  assert exists (select 1 from pg_class where oid = 'public.v_low_stock_items'::regclass
                   and 'security_invoker=true' = any (reloptions)),
    'T9 FAIL v_low_stock_items lost security_invoker';
  assert not has_table_privilege('anon', 'public.v_low_stock_items', 'SELECT'),
    'T9 FAIL anon can read v_low_stock_items';
  assert not has_table_privilege('authenticated', 'public.v_low_stock_items', 'SELECT'),
    'T9 FAIL authenticated can read v_low_stock_items';
end $$;

rollback;
