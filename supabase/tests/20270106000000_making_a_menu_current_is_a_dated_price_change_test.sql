-- F-618, founder answer S202 (an amendment to ADR 0193): making a menu
-- current is a dated price change of its own, change_source 'menu_current'.
-- It is recorded as such, it does not rewrite another line of the current
-- menu (the menu made it), a menu_current change dated before the price in
-- effect is still refused as stale (item 3), and a lock still holds. Migration
-- making_a_menu_current_is_a_dated_price_change.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('owner', gen_random_uuid()), ('menu', gen_random_uuid()),
  ('line_a', gen_random_uuid()), ('line_b', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC menu-current house', 'syn-mc-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = 'owner'), 'syn-mc-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-MC-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC wine ' || v::text, 'red'
  from t_fx where k = 'wine';

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 750, 150;

-- The current menu lists the wine twice (two lines, two prices).
insert into public.restaurant_menus (id, restaurant_id, name, status)
select (select v from t_fx where k = 'menu'), (select v from t_fx where k = 'house'), 'SYNTHETIC current', 'active';

insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, inventory_item_id, status)
select (select v from t_fx where k = l), (select v from t_fx where k = 'menu'), (select v from t_fx where k = 'house'),
       'SYNTHETIC Kalecik Karasi', b, (select v from t_fx where k = 'item'), 'approved'
  from (values ('line_a', 60.00), ('line_b', 70.00)) x(l, b);

-- T1: a menu made current writes its price as 'menu_current', dated at the
-- activation it is given, and the version row says so.
do $$
declare
  r jsonb;
  vr record;
begin
  r := public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 70.00, false, null, 'menu_current', (select v from t_fx where k = 'owner'),
    now() - interval '1 hour', 'menu line', null, null, (select v from t_fx where k = 'menu'));
  if r->>'outcome' <> 'changed' then
    raise exception 'T1 FAIL: a menu made current did not set the price (%)', r;
  end if;
  select change_source, menu_id, effective_from, bottle_price into vr
    from public.menu_price_versions
   where inventory_id = (select v from t_fx where k = 'item') and effective_to is null;
  if vr.change_source is distinct from 'menu_current' or vr.bottle_price <> 70.00
     or vr.menu_id is distinct from (select v from t_fx where k = 'menu') then
    raise exception 'T1 FAIL: the version row reads % / % / %', vr.change_source, vr.bottle_price, vr.menu_id;
  end if;
  if vr.effective_from > now() - interval '59 minutes' then
    raise exception 'T1 FAIL: the price is not dated at the activation (%)', vr.effective_from;
  end if;
end $$;

-- T2: the menu made that change, so its other line keeps what it reads.
do $$
declare b numeric;
begin
  select bottle_price into b from public.menu_items where id = (select v from t_fx where k = 'line_a');
  if b <> 60.00 then
    raise exception 'T2 FAIL: a menu_current price rewrote the menu''s own other line to %', b;
  end if;
end $$;

-- T3 (item 3 unchanged): a menu_current change dated before the price in
-- effect is refused as stale and applied nowhere.
do $$
declare r jsonb; p numeric;
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 75.00, false, null, 'manual', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC your price', null, null, null);
  r := public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 65.00, false, null, 'menu_current', (select v from t_fx where k = 'owner'),
    now() - interval '30 minutes', 'menu line', null, null, (select v from t_fx where k = 'menu'));
  select menu_price_current into p from public.restaurant_inventory where id = (select v from t_fx where k = 'item');
  if r->>'outcome' <> 'stale' or p <> 75.00 then
    raise exception 'T3 FAIL: an older menu_current change was applied (% / %)', r->>'outcome', p;
  end if;
end $$;

-- T4: a lock holds against a menu made current ("The menu sets it, locks keep").
do $$
declare r jsonb; p numeric;
begin
  perform public.lock_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    'bottle', (select v from t_fx where k = 'owner'), 'SYNTHETIC hold');
  r := public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 90.00, false, null, 'menu_current', (select v from t_fx where k = 'owner'),
    now(), 'menu line', null, null, (select v from t_fx where k = 'menu'));
  select menu_price_current into p from public.restaurant_inventory where id = (select v from t_fx where k = 'item');
  if r->>'outcome' <> 'locked' or p <> 75.00 then
    raise exception 'T4 FAIL: a lock did not hold against a menu made current (% / %)', r->>'outcome', p;
  end if;
end $$;

-- T5: any other word is still refused.
do $$
begin
  begin
    perform public.set_house_menu_price(
      (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
      true, 50.00, false, null, 'guess', (select v from t_fx where k = 'owner'),
      now(), 'SYNTHETIC', null, null, null);
    raise exception 'T5 FAIL: an unknown change_source was accepted';
  exception when sqlstate '22023' then
    null;
  end;
end $$;

rollback;
