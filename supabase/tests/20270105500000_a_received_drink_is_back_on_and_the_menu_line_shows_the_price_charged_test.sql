-- F-145: a live receipt ends the item's open stock-out (86), names the ledger
-- row that ended it and files a drink_back_on audit row; a count, a sale or a
-- shadow receipt does not. F-618: a house price changed by hand (or by
-- accepted advice) is written onto the CURRENT menu's lines for that wine; a
-- change the menu itself made ('import') is not, and draft or discarded lines
-- keep what they read. Migration
-- a_received_drink_is_back_on_and_the_menu_line_shows_the_price_charged.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration (T1, T3) and PASS with it. One transaction,
-- rolled back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid) on commit drop;
insert into t_fx values
  ('house', gen_random_uuid()), ('wine', gen_random_uuid()), ('wine2', gen_random_uuid()), ('item', gen_random_uuid()),
  ('item2', gen_random_uuid()), ('owner', gen_random_uuid()),
  ('menu', gen_random_uuid()), ('draft', gen_random_uuid()),
  ('line', gen_random_uuid()), ('line_draft', gen_random_uuid()),
  ('line_gone', gen_random_uuid()), ('line_blank', gen_random_uuid());

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC 86 house', 'syn-86-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.users (user_id, email, name, restaurant_id, role)
select (select v from t_fx where k = 'owner'), 'syn-86-' || left(replace(gen_random_uuid()::text, '-', ''), 12) || '@x.test',
       'SYNTHETIC owner', (select v from t_fx where k = 'house'), 'owner';

insert into public.master_wine_library (id, wine_id, name, primary_type)
select v, 'SYN-86-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k || ' ' || v::text, 'white'
  from t_fx where k in ('wine', 'wine2');

insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = k2), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = w), 750, 150
  from (values ('item', 'wine'), ('item2', 'wine2')) x(k2, w);

-- The house's current menu and an older draft, each listing the wine.
insert into public.restaurant_menus (id, restaurant_id, name, status)
select (select v from t_fx where k = 'menu'), (select v from t_fx where k = 'house'), 'SYNTHETIC current', 'active';
insert into public.restaurant_menus (id, restaurant_id, name, status)
select (select v from t_fx where k = 'draft'), (select v from t_fx where k = 'house'), 'SYNTHETIC draft', 'draft';

insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, by_glass_price, inventory_item_id, status)
select (select v from t_fx where k = l), (select v from t_fx where k = m), (select v from t_fx where k = 'house'),
       'SYNTHETIC Moscofilero', b, g, (select v from t_fx where k = i), s
  from (values ('line', 'menu', 60.00, 14.00, 'item', 'approved'),
               ('line_draft', 'draft', 55.00, 12.00, 'item', 'approved'),
               ('line_gone', 'menu', 50.00, null, 'item', 'discarded'))
       x(l, m, b, g, i, s);

-- A line showing no glass price beside a house glass price, flagged.
insert into public.menu_items (id, menu_id, restaurant_id, name, bottle_price, by_glass_price, inventory_item_id,
                               price_flag, price_flag_note)
select (select v from t_fx where k = 'line_blank'), (select v from t_fx where k = 'menu'), (select v from t_fx where k = 'house'),
       'SYNTHETIC Moscofilero (2)', 40.00, null, (select v from t_fx where k = 'item2'),
       'blank_kept_last_known', 'SYNTHETIC kept the glass price.';

-- T1 (F-145): a delivery booked in live ends the open 86, says which ledger
-- row did it, and files the audit row.
insert into public.stock_outs (restaurant_id, inventory_id, cause, started_at)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'), 'broken', now() - interval '2 hours';

do $$
declare
  v_txn uuid := gen_random_uuid();
  s record;
  n int;
begin
  insert into public.inventory_transactions
    (id, restaurant_id, inventory_id, wine_id, transaction_type, source,
     quantity_change, quantity_before, quantity_after, stock_type)
  values
    (v_txn, (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
     (select v from t_fx where k = 'wine'), 'purchase', 'order', 6, 0, 6, 'live');
  select * into s from public.stock_outs where inventory_id = (select v from t_fx where k = 'item');
  if s.ended_at is null then
    raise exception 'T1 FAIL: a live receipt left the drink sold out';
  end if;
  if s.ended_by_receipt is distinct from v_txn then
    raise exception 'T1 FAIL: the stock-out does not name the receipt that ended it (%)', s.ended_by_receipt;
  end if;
  select count(*) into n from public.system_audit_log
   where action = 'drink_back_on'
     and entity_id = (select v from t_fx where k = 'item')
     and restaurant_id = (select v from t_fx where k = 'house')
     and (changes->>'ended_by_receipt')::uuid = v_txn
     and changes->>'subject' like 'SYNTHETIC wine %';
  if n <> 1 then
    raise exception 'T1 FAIL: % drink_back_on audit rows, expected 1', n;
  end if;
end $$;

-- T2 (F-145): a count, a sale and a shadow receipt leave an 86 standing.
insert into public.stock_outs (restaurant_id, inventory_id, cause)
select (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'), 'ran_out';

do $$
declare n int;
begin
  insert into public.inventory_transactions
    (restaurant_id, inventory_id, wine_id, transaction_type, source,
     quantity_change, quantity_before, quantity_after, stock_type)
  values
    ((select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'),
     (select v from t_fx where k = 'wine2'), 'reconciliation', 'manual', 2, 0, 2, 'live'),
    ((select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'),
     (select v from t_fx where k = 'wine2'), 'sale', 'pos', -1, 2, 1, 'live'),
    ((select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'),
     (select v from t_fx where k = 'wine2'), 'purchase', 'order', 6, 0, 6, 'shadow');
  select count(*) into n from public.stock_outs
   where inventory_id = (select v from t_fx where k = 'item2') and ended_at is null;
  if n <> 1 then
    raise exception 'T2 FAIL: a count, a sale or a shadow receipt ended the 86';
  end if;
end $$;

-- T3 (F-618): a manager's price is written onto the current menu's line;
-- the draft and the discarded line keep what they read.
do $$
declare
  b numeric; g numeric;
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 72.00, true, 16.00, 'manual', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC your price', null, null, null);
  select bottle_price, by_glass_price into b, g from public.menu_items where id = (select v from t_fx where k = 'line');
  if b <> 72.00 or g <> 16.00 then
    raise exception 'T3 FAIL: the current menu line reads % / %, the house charges 72.00 / 16.00', b, g;
  end if;
  select bottle_price into b from public.menu_items where id = (select v from t_fx where k = 'line_draft');
  if b <> 55.00 then
    raise exception 'T3 FAIL: a draft menu line was rewritten to %', b;
  end if;
  select bottle_price into b from public.menu_items where id = (select v from t_fx where k = 'line_gone');
  if b <> 50.00 then
    raise exception 'T3 FAIL: a discarded line was rewritten to %', b;
  end if;
end $$;

-- T4 (F-618): a price the menu itself set ('import') does not rewrite the
-- current line (the menu is the source; its own line already holds it).
do $$
declare b numeric;
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item'),
    true, 80.00, false, null, 'import', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC menu line', null, null, null);
  select bottle_price into b from public.menu_items where id = (select v from t_fx where k = 'line');
  if b <> 72.00 then
    raise exception 'T4 FAIL: a menu-set price rewrote another line to %', b;
  end if;
end $$;

-- T5 (F-618): a blank kind is filled and its blank-price flag cleared.
do $$
declare r record;
begin
  perform public.set_house_menu_price(
    (select v from t_fx where k = 'house'), (select v from t_fx where k = 'item2'),
    false, null, true, 11.00, 'manual', (select v from t_fx where k = 'owner'),
    now(), 'SYNTHETIC glass price', null, null, null);
  select by_glass_price, price_flag, price_flag_note into r from public.menu_items where id = (select v from t_fx where k = 'line_blank');
  if r.by_glass_price is distinct from 11.00 then
    raise exception 'T5 FAIL: the blank glass price was not filled (%)', r.by_glass_price;
  end if;
  if r.price_flag is not null or r.price_flag_note is not null then
    raise exception 'T5 FAIL: the blank-price flag still stands (%)', r.price_flag;
  end if;
end $$;

rollback;
