-- ADR 0340 rule 21 (S202: the house holds one list price): a price changed
-- from one live menu's line follows onto the same house item's line on every
-- OTHER live menu, never back onto the menu that made it, and never onto a
-- dish. Migration a_live_price_follows_on_every_other_live_menu.
--
-- Self-asserting: every block raises on a failure. It must FAIL on a build
-- without that migration (T1: a correction on the Drinks line, source
-- 'import', leaves the Desserts line at the old price) and PASS with it.
-- One transaction, rolled back. SYNTHETIC fixtures only.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('item', gen_random_uuid()),
  ('owner', gen_random_uuid()), ('drinks', gen_random_uuid()), ('sweet', gen_random_uuid()),
  ('draft', gen_random_uuid()), ('line_d', gen_random_uuid()), ('line_s', gen_random_uuid()),
  ('line_draft', gen_random_uuid()), ('dish', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC follow house', 'syn-fol-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';
insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = 'owner'), 'syn-fol-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner';
insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-FOL-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC wine ' || v::text, 'white'
  from t_fx where k = 'wine';
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'wine'), 500, 75;

-- A live Drinks menu and a live Desserts menu both list the house item; a
-- Desserts dish names it too (a pairing), and an older draft lists it.
insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status)
select (select v from t_fx where k = m), (select v from t_fx where k = 'house'), 'SYNTHETIC ' || m, t, s
  from (values ('drinks', 'beverage', 'active'), ('sweet', 'desserts', 'active'),
               ('draft', 'desserts', 'draft')) x(m, t, s);

insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, inventory_item_id, status)
select (select v from t_fx where k = l), (select v from t_fx where k = m), (select v from t_fx where k = 'house'),
       'SYNTHETIC Muscat', 60.00, (select v from t_fx where k = 'item'), 'approved'
  from (values ('line_d', 'drinks'), ('line_s', 'sweet'), ('line_draft', 'draft')) x(l, m);
insert into public.menu_items (id, menu_id, restaurant_id, name, line_kind, price, inventory_item_id, status)
select (select v from t_fx where k = 'dish'), (select v from t_fx where k = 'sweet'), (select v from t_fx where k = 'house'),
       'SYNTHETIC Baklava with Muscat', 'dish', 14.00, (select v from t_fx where k = 'item'), 'approved';

-- T1 a correction on the Drinks line (source 'import', naming that menu)
-- follows onto the Desserts line, not back onto the Drinks line, and never
-- onto the dish or the draft.
do $$
declare r record;
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 75.00, false, null, 'import', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC live-line correction', null, null, (select v from t_fx where k = 'drinks'));
  if (select bottle_price from public.menu_items where id = (select v from t_fx where k = 'line_s')) <> 75.00 then
    raise exception 'T1 FAIL: the Desserts line kept % after a Drinks correction',
      (select bottle_price from public.menu_items where id = (select v from t_fx where k = 'line_s'));
  end if;
  if (select bottle_price from public.menu_items where id = (select v from t_fx where k = 'line_d')) <> 60.00 then
    raise exception 'T1 FAIL: the trigger rewrote the line on the menu that made the change';
  end if;
  select bottle_price, price into r from public.menu_items where id = (select v from t_fx where k = 'dish');
  if r.bottle_price is not null or r.price <> 14.00 then
    raise exception 'T1 FAIL: the dish took the drink price (% / %)', r.bottle_price, r.price;
  end if;
  if (select bottle_price from public.menu_items where id = (select v from t_fx where k = 'line_draft')) <> 60.00 then
    raise exception 'T1 FAIL: a draft line followed a live price';
  end if;
end $$;

-- T2 a menu-made change that names no menu still follows nowhere.
do $$
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 80.00, false, null, 'import', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC unnamed import', null, null, null);
  if (select bottle_price from public.menu_items where id = (select v from t_fx where k = 'line_s')) <> 75.00 then
    raise exception 'T2 FAIL: a menu-made change with no menu moved a line';
  end if;
end $$;

-- T3 a price changed off the menus (by hand) follows on every live menu.
do $$
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 90.00, false, null, 'manual', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC by hand', null, null, null);
  if exists (select 1 from public.menu_items
              where id in ((select v from t_fx where k = 'line_d'), (select v from t_fx where k = 'line_s'))
                and bottle_price <> 90.00) then
    raise exception 'T3 FAIL: a hand price did not reach every live line';
  end if;
end $$;

rollback;
