-- ADR 0301, the founder's ruling of 2026-10-05 ("Join by contained name,
-- split Sold"): Tuzlu Rüzgar's till adds a serve size to the menu's name
-- ('Yeni Rakı (single 50ml)', 'Efes Pilsen (draft 400ml)'), and
-- house_beverage_ledger joined a till name to a row only when their
-- beverage_house_keys were equal, so those lines reached no Sold or Taken.
-- Migration a_till_name_with_a_serve_size_joins_its_row joins each till name
-- to the most specific row whose words it holds (an exact key wins; a tie
-- joins none), and splits Sold into bottles, glasses and unknown unit by each
-- line's sale unit, in ADR 0011's order.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqss", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration (#627's head, 27faf423a), every block
-- fails. S2, S4 and S5 fail on what they count: the names they join reach no
-- row there. S1's and S3's counts hold on that build too, since it joined
-- equal keys only and so never joined either case; they fail there on what
-- they add (house_till_names(uuid, text), tied_lines), and they pin that the
-- looser rule did not loosen them. S6 to S9 fail because the columns and the
-- function they read do not exist on that build.

begin;

insert into public.restaurants (id, name, slug) values
  ('a3030000-0000-4000-8000-000000000001', 'Servesize house', 'servesize-house'),
  ('a3030000-0000-4000-8000-000000000002', 'Servesize other house', 'servesize-other-house');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Current', 'active');

insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  -- S1: two rows with the same three words. 'Zqss Efes' + 'Efes Pilsen' keys
  -- 'efes efes pilsen zqss'; 'Zqss Efes Pilsen' keys 'efes pilsen zqss'.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Efes Pilsen', 'Zqss Efes', 'Beer', 8, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Efes Pilsen', null, 'Beer', 8, 'approved'),
  -- S2: a row and a more specific one.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Yeni Raki', null, 'Rakı', 90, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Yeni Raki Ala', null, 'Rakı', 120, 'approved'),
  -- S3: two rows a till name can hold equally.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Lal Rose', null, 'Wine', 40, 'approved'),
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Lal Kavak', null, 'Wine', 40, 'approved'),
  -- S4: a spirit with a row, and a cocktail named after it with none.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Fords Gin', null, 'Spirits', 70, 'approved'),
  -- S5: a draft beer the till rings with its serve size and no inventory item.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Reality Czeck', null, 'Beer', 9, 'approved'),
  -- S6: the wine whose lines exercise every unit rule.
  ('a3030000-0000-4000-8000-0000000000a1', 'a3030000-0000-4000-8000-000000000001', 'Zqss Suvla Sur', null, 'Wine', 45, 'approved');

-- Inventory: the rakı (a 700 ml bottle, no pour size), the wine (750 ml, a
-- 150 ml pour), an item with no sizes, and the other house's rakı.
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance, bottle_size_ml, pour_size_ml) values
  ('a3030000-0000-4000-8000-0000000000f1', 'a3030000-0000-4000-8000-000000000001', 'spirit', 'bottle', 'Zqss Yeni Raki', 'house_declared', 700, null),
  ('a3030000-0000-4000-8000-0000000000f2', 'a3030000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqss Suvla Sur', 'house_declared', 750, 150),
  ('a3030000-0000-4000-8000-0000000000f3', 'a3030000-0000-4000-8000-000000000001', 'wine', 'bottle', 'Zqss No Sizes', 'house_declared', null, null),
  ('a3030000-0000-4000-8000-0000000000f9', 'a3030000-0000-4000-8000-000000000002', 'spirit', 'bottle', 'Zqss Yeni Raki', 'house_declared', 700, null);

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c1',
   '2026-08-07 19:00+00', '2026-08-07 21:00+00', false,
   '[{"name": "Zqss Efes Pilsen", "qty": 2, "price": 8},
     {"name": "Zqss Yeni Raki", "qty": 2, "price": 90, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_unit": "bottle"},
     {"name": "Zqss Yeni Raki (single 50ml)", "qty": 4, "price": 14, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_unit": "glass", "sale_volume_ml": 50},
     {"name": "Zqss Yeni Raki 70cl bottle", "qty": 1, "price": 80, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_volume_ml": 700},
     {"name": "Zqss Yeni Raki (single 50ml)", "qty": 3, "price": 14, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f9", "sale_unit": "glass", "sale_volume_ml": 50},
     {"name": "Zqss Yeni Raki Ala (single 50ml)", "qty": 2, "price": 16, "is_wine": true, "inventory_id": "a3030000-0000-4000-8000-0000000000f1", "sale_volume_ml": 50},
     {"name": "Zqss Lal Rose Kavak (glass)", "qty": 1, "price": 12},
     {"name": "Zqss Fords Gin (50ml)", "qty": 1, "price": 12},
     {"name": "Zqss Fords Gin Fizz", "qty": 2, "price": 15},
     {"name": "Zqss Reality Czeck (draft 400ml)", "qty": 3, "price": 10}]'::jsonb),
  -- S6: every unit rule, on the wine's row. Sold 5+1+1+2+1+2+1+1+1+1+1 = 17.
  ('a3030000-0000-4000-8000-000000000001', 'simpos', 'zqss-c2',
   '2026-08-08 19:00+00', '2026-08-08 21:00+00', false,
   '[{"name": "Zqss Suvla Sur (glass)", "qty": 5, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_unit": "glass"},
     {"name": "Zqss Suvla Sur (glass)", "qty": 1, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_unit": "glass"},
     {"name": "Zqss Suvla Sur magnum", "qty": 1, "price": 90, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": 1500},
     {"name": "Zqss Suvla Sur taste", "qty": 2, "price": 0, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": 5},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 11, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_unit": "bottle", "sale_volume_ml": 150},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 2, "price": 45, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_unit": " BOTTLE "},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": "750"},
     {"name": "Zqss Suvla Sur carafe", "qty": 1, "price": 30, "inventory_id": "a3030000-0000-4000-8000-0000000000f3", "sale_volume_ml": 600},
     {"name": "Zqss Suvla Sur carafe", "qty": 1, "price": 30, "inventory_id": "a3030000-0000-4000-8000-0000000000f2", "sale_volume_ml": "abc"},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "not-a-uuid", "sale_unit": "bottle"},
     {"name": "Zqss Suvla Sur (bottle)", "qty": 1, "price": 45, "inventory_id": "A3030000-0000-4000-8000-0000000000F2", "sale_unit": "bottle"}]'::jsonb);

insert into public.pos_unresolved_lines
  (restaurant_id, source, external_check_id, external_item_id, item_name, qty, price, resolved, created_at) values
  -- S3: an orphan queue line whose name ties too. The queue held it, so it is
  -- a row of its own, as a till name that joins no row always was.
  ('a3030000-0000-4000-8000-000000000001', 'toast', 'zqss-orphan', 'm1', 'Zqss Lal Rose Kavak Magnum', 1, 90, false, '2026-08-09 20:00+00');

create function pg_temp.ss_row(p_label text)
returns table (pos_lines integer, poured_qty numeric, poured_revenue numeric)
language sql as $$
  select l.pos_lines, l.poured_qty, l.poured_revenue
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = p_label
$$;

-- S1 an exact key wins over a row the name merely holds. 'Zqss Efes Pilsen'
-- holds every word of both rows, and both have three; its key is the second
-- row's, so it joins that one, and the first gets nothing: not its lines, and
-- not a tie either, since an exact key wins outright rather than drawing
-- level with a row of the same words.
do $$
declare r record; got text; n integer;
begin
  select * into r from pg_temp.ss_row('Zqss Efes Pilsen');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S1 FAIL ''Zqss Efes Pilsen'' reads pos_lines %s, Sold %s; expected 1 and 2 (its exact name)', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.ss_row('Zqss Efes Efes Pilsen');
  assert r.pos_lines = 0, format('S1 FAIL the producer-and-name row reads pos_lines %s; expected 0 (the exact row won)', r.pos_lines);
  select l.tied_lines into n from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Efes Efes Pilsen';
  assert n = 0, format('S1 FAIL the producer-and-name row reads tied_lines %s; expected 0 (an exact key ties with nothing)', n);
  select string_agg(t.item_name || '=' || t.joined_by, ', ') into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Efes Pilsen') t;
  assert got = 'Zqss Efes Pilsen=exact', format('S1 FAIL the exact row''s record lists %s', got);
  select count(*) into n
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Efes Efes Pilsen') t;
  assert n = 0, format('S1 FAIL the producer-and-name row''s record lists %s names; expected 0', n);
end $$;

-- S2 the most specific row wins. 'Zqss Yeni Raki Ala (single 50ml)' holds the
-- words of both rakı rows and joins the one with more; the plain rakı's sized
-- names join the plain rakı.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Yeni Raki Ala');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('S2 FAIL the Ala reads pos_lines %s, Sold %s; expected 1 and 2', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.ss_row('Zqss Yeni Raki');
  assert r.pos_lines = 4 and r.poured_qty = 10 and r.poured_revenue = 180 + 56 + 80 + 42,
    format('S2 FAIL the rakı reads pos_lines %s, Sold %s, Taken %s; expected 4, 10 and 358 (its own name and its two sized names, not the Ala''s)', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S3 a tie joins neither row. 'Zqss Lal Rose Kavak (glass)' holds both wines'
-- three words; neither's Sold counts it, and, never queued, it is no row of
-- its own. The queued orphan that ties the same way is a row of its own.
do $$
declare r record; n integer; a integer; b integer;
begin
  select * into r from pg_temp.ss_row('Zqss Lal Rose');
  assert r.pos_lines = 0, format('S3 FAIL the rosé reads pos_lines %s; expected 0 (the name tied)', r.pos_lines);
  select * into r from pg_temp.ss_row('Zqss Lal Kavak');
  assert r.pos_lines = 0, format('S3 FAIL the kavak reads pos_lines %s; expected 0 (the name tied)', r.pos_lines);
  select count(*) into n from pg_temp.ss_row('Zqss Lal Rose Kavak (glass)');
  assert n = 0, format('S3 FAIL the tied name reads as %s ledger rows of its own; expected 0 (the queue never held it)', n);
  select * into r from pg_temp.ss_row('Zqss Lal Rose Kavak Magnum');
  assert r.pos_lines = 1, format('S3 FAIL the queued tied name reads pos_lines %s; expected 1 (a row of its own)', r.pos_lines);
  -- The tie is counted where it shows: each tied row's tied_lines holds the
  -- lines of the names that tied on it (the glass, and the queued magnum).
  select l.tied_lines into a from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Lal Rose';
  select l.tied_lines into b from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Lal Kavak';
  assert a = 2 and b = 2, format('S3 FAIL the tied rows read tied_lines %s and %s; expected 2 and 2', a, b);
  select l.tied_lines into a from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Yeni Raki';
  assert a = 0, format('S3 FAIL the rakı reads tied_lines %s; expected 0', a);
end $$;

-- S4 the ruling's stated risk, pinned: a cocktail named after a spirit, with
-- no row of its own, joins that spirit. 'Zqss Fords Gin Fizz' holds the
-- gin's three words, so the gin's Sold counts its 2 with the 50 ml single.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Fords Gin');
  assert r.pos_lines = 2 and r.poured_qty = 3 and r.poured_revenue = 12 + 30,
    format('S4 FAIL the gin reads pos_lines %s, Sold %s, Taken %s; expected 2, 3 and 42 (its single and the cocktail)', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S5 an unmapped draft with a serve size joins its row too: the till rang
-- 'Zqss Reality Czeck (draft 400ml)' with no inventory item, and it holds
-- every word of 'Zqss Reality Czeck'.
do $$
declare r record;
begin
  select * into r from pg_temp.ss_row('Zqss Reality Czeck');
  assert r.pos_lines = 1 and r.poured_qty = 3 and r.poured_revenue = 30,
    format('S5 FAIL the draft beer reads pos_lines %s, Sold %s, Taken %s; expected 1, 3 and 30', r.pos_lines, r.poured_qty, r.poured_revenue);
end $$;

-- S6 Sold splits by what one of each line is, in ADR 0011's order, and the
-- three parts sum to Sold. On the wine's row:
--   glass  : 5 (label glass, item pours 150) + 1 (volume 150 outranks the
--            label bottle) + 1 (volume 600, item with no bottle size: under
--            the 750 default)                                       =  7
--   bottle : 2 (label ' BOTTLE ', no sizes needed) + 1 (volume "750" equals
--            the item's bottle)                                      =  3
--   unknown: 1 (label glass, item has no pour size) + 1 (1500 over the
--            item's bottle) + 2 (5 ml, under 10) + 1 (volume not a number)
--            + 1 (inventory_id not a uuid) + 1 (inventory_id not as
--            Postgres writes the item's id, which the bridge cannot find
--            either)                                                 =  7
do $$
declare r record;
begin
  select l.pos_lines, l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Suvla Sur';
  assert r.pos_lines = 11 and r.poured_qty = 17,
    format('S6 FAIL the wine reads pos_lines %s, Sold %s; expected 11 and 17', r.pos_lines, r.poured_qty);
  assert r.poured_glasses = 7, format('S6 FAIL the wine reads %s glasses, expected 7', r.poured_glasses);
  assert r.poured_bottles = 3, format('S6 FAIL the wine reads %s bottles, expected 3', r.poured_bottles);
  assert r.poured_unit_unknown = 7, format('S6 FAIL the wine reads %s of unknown unit, expected 7', r.poured_unit_unknown);
end $$;

-- S7 on the rakı: a label bottle (2) and a volume equal to the bottle (1) are
-- bottles; a 50 ml single on this house's item is a glass (4); the same
-- single on the other house's item is unknown (3), as the bridge books it
-- nowhere. Every line with no inventory item is unknown: the cocktail and the
-- draft. Across the house, bottles + glasses + unknown = Sold on every row.
do $$
declare r record; bad integer;
begin
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Yeni Raki';
  assert r.poured_bottles = 3 and r.poured_glasses = 4 and r.poured_unit_unknown = 3,
    format('S7 FAIL the rakı splits %s bottles, %s glasses, %s unknown; expected 3, 4 and 3', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Fords Gin';
  assert r.poured_unit_unknown = 3 and r.poured_bottles = 0 and r.poured_glasses = 0,
    format('S7 FAIL the gin splits %s bottles, %s glasses, %s unknown; expected 0, 0 and 3 (no line names an item)', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select l.poured_qty, l.poured_bottles, l.poured_glasses, l.poured_unit_unknown
    into r
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqss Reality Czeck';
  assert r.poured_unit_unknown = 3 and r.poured_bottles = 0 and r.poured_glasses = 0,
    format('S7 FAIL the draft splits %s bottles, %s glasses, %s unknown; expected 0, 0 and 3 (unmapped: no item)', r.poured_bottles, r.poured_glasses, r.poured_unit_unknown);
  select count(*) into bad
    from public.house_beverage_ledger('a3030000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.poured_qty is distinct from
         (l.poured_bottles + l.poured_glasses + l.poured_unit_unknown);
  assert bad = 0, format('S7 FAIL %s rows'' three parts do not sum to their Sold', bad);
  select count(*) into bad
    from public.house_till_lines('a3030000-0000-4000-8000-000000000001'::uuid) t
   where t.from_queue and t.sold_as is not null;
  assert bad = 0, format('S7 FAIL %s queue lines have a unit; the queue records none', bad);
end $$;

-- S8 house_till_names(p_restaurant_id, p_label) lists the names the ledger
-- counts on that row and how each joined, so the row record reads the lines
-- the Sold cell sums: the rakı's own name (exact) and its two sized names
-- (contains), not the Ala's; the label is read through beverage_house_key, so
-- case and word order do not matter. A tied row lists nothing.
do $$
declare got text; n integer;
begin
  select string_agg(t.item_name || '=' || t.joined_by || ':' || t.lines, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'raki YENI zqss') t;
  assert got = 'Zqss Yeni Raki=exact:1, Zqss Yeni Raki (single 50ml)=contains:2, Zqss Yeni Raki 70cl bottle=contains:1',
    format('S8 FAIL the rakı''s record lists %s', got);
  select count(*) into n
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Lal Rose') t;
  assert n = 0, format('S8 FAIL the tied rosé''s record lists %s names; expected 0', n);
  select string_agg(t.item_name || '=' || t.joined_by, ', ' order by t.item_name collate "C")
    into got
    from public.house_till_names('a3030000-0000-4000-8000-000000000001'::uuid, 'Zqss Fords Gin') t;
  assert got = 'Zqss Fords Gin (50ml)=contains, Zqss Fords Gin Fizz=contains',
    format('S8 FAIL the gin''s record lists %s', got);
end $$;

-- S9 the shape and the grants: the ledger keeps its signature and appends
-- five columns; house_till_lines gains sold_as; the new overload is
-- service_role only, like every till function.
do $$
declare args text; ncols integer; f text;
begin
  select pg_get_function_identity_arguments(p.oid), coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs
    into args, ncols
    from pg_proc p
   where p.oid = 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
  assert args = 'p_restaurant_id uuid, p_limit integer', format('S9 FAIL the ledger''s signature changed: %s', args);
  assert ncols = 36, format('S9 FAIL the ledger returns %s columns, expected 36', ncols);
  foreach f in array array['public.house_till_lines(uuid, text[])',
                           'public.house_till_names(uuid)',
                           'public.house_till_names(uuid, text)',
                           'public.house_beverage_ledger(uuid, integer)'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('S9 FAIL anon can execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('S9 FAIL authenticated can execute %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('S9 FAIL service_role cannot execute %s', f);
  end loop;
end $$;

rollback;
