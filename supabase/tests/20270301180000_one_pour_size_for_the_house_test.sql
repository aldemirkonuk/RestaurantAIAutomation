-- one_pour_size_for_the_house (recipes walk G13/G17, proposal lane A4, calls
-- F11/F12): a glass sold with no stated pour draws the house's CONFIRMED pour
-- before the 150 ml last resort, and restaurants.default_pour_ml is NULL or
-- 10..500 ml.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` or the PGlite harness stops at the first one. Run it on
-- a database built from supabase/migrations. Synthetic fixtures only, one
-- transaction, rolled back.
--
-- On a build WITHOUT the migration, T1 (pours 150, not 125) and T5 (a 9 ml
-- house pour is accepted) FAIL. T2, T3 and T4 pass on both builds: they pin
-- what the migration keeps (the item's pour and an explicit pour still win; an
-- unconfirmed house still pours 150).

begin;

create function pg_temp.op_pour(p uuid, p_ml int default null) returns int language sql as $$
  select (public.record_glass_pour(p_inventory_id => p, p_pours => 1, p_pour_ml => p_ml,
                                   p_source => 'manual',
                                   p_idempotency_key => 'a4-test:' || p::text)->>'pour_ml')::int
$$;

do $$
declare
  h  uuid := 'a4000000-0000-4000-8000-000000000001';  -- confirmed 125 ml house
  h2 uuid := 'a4000000-0000-4000-8000-000000000002';  -- unconfirmed house
  u  uuid := 'a4000000-0000-4000-8000-000000000011';
  i int;
begin
  insert into public.restaurants (id, name, slug) values
    (h,  'A4 confirmed house',   'a4-confirmed-house'),
    (h2, 'A4 unconfirmed house', 'a4-unconfirmed-house');
  insert into public.users (user_id, email, name, restaurant_id, role) values
    (u, 'a4-owner@x.test', 'A4 owner', h, 'owner');
  update public.restaurants
     set default_pour_ml = 125, pour_size_confirmed_by = u, pour_size_confirmed_at = now()
   where id = h;
  -- Unconfirmed: a number nobody stated, which the stock draw must not read.
  update public.restaurants set default_pour_ml = 175 where id = h2;

  for i in 1..4 loop
    insert into public.master_wine_library (id, wine_id, name, primary_type)
    values (('a4000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid,
            'A4-TEST-' || i, 'A4 test wine ' || i, 'red');
    insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
    values (('a4000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid,
            case when i = 4 then h2 else h end,
            ('a4000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 750,
            case when i = 2 then 100 else null end);
    insert into public.inventory_lots
      (restaurant_id, inventory_id, master_wine_id, qty, open_bottle_ml, received_at)
    values (case when i = 4 then h2 else h end,
            ('a4000000-0000-4000-8000-0000000002' || lpad(i::text, 2, '0'))::uuid,
            ('a4000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, 2, 0, now() - interval '3 days');
  end loop;
  assert (select pour_size_ml from public.restaurant_inventory
           where id = 'a4000000-0000-4000-8000-000000000201') is null, 'setup: item 1 has no pour of its own';
end;
$$;

-- T1 the house's confirmed pour: an item with no pour, no p_pour_ml -> 125 ml.
do $$
declare v int := pg_temp.op_pour('a4000000-0000-4000-8000-000000000201');
begin
  if v <> 125 then
    raise exception 'T1: an item with no pour in a house that confirmed 125 ml poured % ml', v;
  end if;
  if (select pour_ml from public.pour_events where inventory_id = 'a4000000-0000-4000-8000-000000000201') <> 125
     or (select sum(open_bottle_ml) from public.inventory_lots
          where inventory_id = 'a4000000-0000-4000-8000-000000000201') <> 625 then
    raise exception 'T1: the pour event or the open bottle does not show a 125 ml draw';
  end if;
end;
$$;

-- T2 the item's own pour wins over the house's.
do $$
declare v int := pg_temp.op_pour('a4000000-0000-4000-8000-000000000202');
begin
  if v <> 100 then raise exception 'T2: the item''s 100 ml pour lost to % ml', v; end if;
end;
$$;

-- T3 an explicit pour wins over both.
do $$
declare v int := pg_temp.op_pour('a4000000-0000-4000-8000-000000000203', 60);
begin
  if v <> 60 then raise exception 'T3: an explicit 60 ml pour became % ml', v; end if;
end;
$$;

-- T4 an unconfirmed house pours the 150 ml last resort, never its unstated 175.
do $$
declare v int := pg_temp.op_pour('a4000000-0000-4000-8000-000000000204');
begin
  if v <> 150 then raise exception 'T4: an unconfirmed house poured % ml, not 150', v; end if;
end;
$$;

-- T5 the house pour is NULL or 10..500 ml: 9 is refused, 10 and NULL are not.
do $$
begin
  begin
    update public.restaurants set default_pour_ml = 9 where id = 'a4000000-0000-4000-8000-000000000002';
    raise exception 'T5: a 9 ml house pour was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.restaurants set default_pour_ml = 501 where id = 'a4000000-0000-4000-8000-000000000002';
    raise exception 'T5: a 501 ml house pour was accepted';
  exception when check_violation then null;
  end;
  update public.restaurants set default_pour_ml = 10 where id = 'a4000000-0000-4000-8000-000000000002';
  update public.restaurants set default_pour_ml = null where id = 'a4000000-0000-4000-8000-000000000002';
end;
$$;

rollback;
