-- AW10 (2026-10-03 analytics walk, A-015 / A-016): house_beverage_ledger's
-- pour read only the OPEN pos_unresolved_lines queue, which holds the lines
-- the bridge could not book against this house's stock. A mapped rakı whose
-- sale volume resolved never entered it, and pos-hub skips every non-wine
-- line (cocktails, soft drinks) before it, so neither reached Sold or Taken.
-- Migration the_cellar_reads_the_tills_own_record (ADR 0301 §1) reads the
-- till's own record instead: every line of every check not voided, plus the
-- queue lines with no check behind them.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqtl", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration, T1, T2, T3, T5, T6, T7, T8, T9, T11, T13,
-- T14 and T15 FAIL (T10 fails too on a build without the_ledger_lists_only_the_current_menu,
-- which it pins). T4 and T12 pass on both builds: they pin what the migration
-- keeps (food stays out; the ledger's signature and shape). T15 also fails on
-- this migration's first build, which made a row of every till-only name
-- flagged is_wine (added 2026-10-05).

begin;

insert into public.restaurants (id, name, slug)
values ('a3010000-0000-4000-8000-000000000001', 'AW10 till house', 'aw10-till-house');

insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Current', 'active'),
  ('a3010000-0000-4000-8000-0000000000a2', 'a3010000-0000-4000-8000-000000000001', 'Last season', 'archived');

insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Lions Milk', null, 'Cocktails', 17, 'approved'),
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Cola', null, 'Soft drinks', 4, 'approved'),
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Yeni Raki', null, 'Rakı', 90, 'approved'),
  -- T15: a beer the till rings under its own name (bottled) and with a serve
  -- size added (draft), as Tuzlu Rüzgar's till does.
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Efes Pilsen', null, 'Beer', 8, 'approved'),
  -- T10: a line discarded from the current menu, and one only on the archived menu.
  ('a3010000-0000-4000-8000-0000000000a1', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Discarded Tonic', null, 'Soft drinks', 3, 'discarded'),
  ('a3010000-0000-4000-8000-0000000000a2', 'a3010000-0000-4000-8000-000000000001', 'Zqtl Archived Gin', null, 'Spirits', 40, 'approved');

insert into public.pos_checks (restaurant_id, source, external_check_id, opened_at, closed_at, voided, items) values
  -- C1: a closed check. A mapped rakı (is_wine true, inventory_id set; no
  -- queue row, as when its sale volume resolves), a cocktail and a cola (not
  -- wine: pos-hub never queues them), food, and two lines whose names are off
  -- the current menu.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c1',
   '2026-08-07 19:00+00', '2026-08-07 20:30+00', false,
   '[{"name": "Zqtl Yeni Raki", "qty": 2, "price": 9, "is_wine": true, "inventory_id": "a3010000-0000-4000-8000-0000000000f1"},
     {"name": "Zqtl Lions Milk", "qty": 3, "price": 17, "is_wine": false, "inventory_id": null},
     {"name": "Zqtl Cola", "qty": 1, "price": 4, "is_wine": false},
     {"name": "Zqtl Burger", "qty": 1, "price": 20, "is_wine": false},
     {"name": "Zqtl Discarded Tonic", "qty": 1, "price": 3, "is_wine": false},
     {"name": "Zqtl Archived Gin", "qty": 1, "price": 12, "is_wine": false}]'::jsonb),
  -- C2: a voided check. Nothing on it is sold.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c2',
   '2026-08-07 21:00+00', '2026-08-07 21:05+00', true,
   '[{"name": "Zqtl Lions Milk", "qty": 9, "price": 17, "is_wine": false},
     {"name": "Zqtl Voided Wine", "qty": 1, "price": 60, "is_wine": true}]'::jsonb),
  -- C3: an unmapped wine, rung on a check AND queued (the queue row below).
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c3',
   '2026-08-08 19:00+00', '2026-08-08 19:40+00', false,
   '[{"name": "Zqtl Unmapped Wine", "qty": 1, "price": 50, "is_wine": true}]'::jsonb),
  -- C4: still open (no closed_at), so its lines are dated when it opened. A
  -- qty that is not a number, a qty and a price sent as strings, padding
  -- around a name, and a longer name that contains "Zqtl Cola".
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c4',
   '2026-08-09 18:00+00', null, false,
   '[{"name": "Zqtl Cola", "qty": "abc", "price": 4},
     {"name": "  Zqtl Cola ", "qty": "2", "price": "4.00"},
     {"name": "Zqtl Cola Zero", "qty": 1, "price": 4}]'::jsonb),
  -- C5 (T14): one name three ways: plain, with a tab at its end, and with a
  -- no-break space (U+00A0) at its end. btrim strips spaces only, so the
  -- till lists three names.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c5',
   '2026-08-10 19:00+00', '2026-08-10 19:30+00', false,
   '[{"name": "Zqtl Ayran", "qty": 1, "price": 3},
     {"name": "Zqtl Ayran\t", "qty": 2, "price": 3},
     {"name": "Zqtl Ayran\u00a0", "qty": 3, "price": 3}]'::jsonb),
  -- C6 (T15): Tuzlu Rüzgar's own naming (sim feed, rebuild/run/feed/pos-*.json).
  -- The till adds the serve size to the menu's name: 'Yeni Rakı (single
  -- 50ml)', 'Yeni Rakı 70cl bottle', 'Efes Pilsen (draft 400ml)'. Every line
  -- is mapped and flagged is_wine, as Tuzlu's mappings are, and none is queued.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c6',
   '2026-08-11 19:00+00', '2026-08-11 20:00+00', false,
   '[{"name": "Zqtl Yeni Raki (single 50ml)", "qty": 4, "price": 14, "is_wine": true, "inventory_id": "a3010000-0000-4000-8000-0000000000f1"},
     {"name": "Zqtl Yeni Raki 70cl bottle", "qty": 1, "price": 80, "is_wine": true, "inventory_id": "a3010000-0000-4000-8000-0000000000f1"},
     {"name": "Zqtl Efes Pilsen", "qty": 2, "price": 8, "is_wine": true, "inventory_id": "a3010000-0000-4000-8000-0000000000f2"},
     {"name": "Zqtl Efes Pilsen (draft 400ml)", "qty": 3, "price": 10, "is_wine": true, "inventory_id": "a3010000-0000-4000-8000-0000000000f3"}]'::jsonb);

insert into public.pos_unresolved_lines
  (restaurant_id, source, external_check_id, external_item_id, item_name, qty, price, resolved, created_at) values
  -- T5: the queue row of C3's line: its check exists, so it is counted once.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c3', 'w1', 'Zqtl Unmapped Wine', 1, 50, false, '2026-08-08 19:41+00'),
  -- T2: the queue row of C2's voided line goes with its check.
  ('a3010000-0000-4000-8000-000000000001', 'simpos', 'zqtl-c2', 'w2', 'Zqtl Voided Wine', 1, 60, false, '2026-08-07 21:06+00'),
  -- T6: an orphan (no pos_checks row behind it), e.g. the Toast direct path.
  ('a3010000-0000-4000-8000-000000000001', 'toast', 'zqtl-orphan', 'b1', 'Zqtl Orphan Lager', 2, 6, false, '2026-08-10 20:00+00'),
  -- T7: an orphan that was resolved. Still a sale.
  ('a3010000-0000-4000-8000-000000000001', 'toast', 'zqtl-orphan-2', 'b2', 'Zqtl Resolved Orphan', 1, 7, true, '2026-08-11 20:00+00');

create function pg_temp.aw10_row(p_label text)
returns table (books text[], pos_lines integer, poured_qty numeric, poured_revenue numeric,
               first_poured timestamptz, last_poured timestamptz)
language sql as $$
  select l.books, l.pos_lines, l.poured_qty, l.poured_revenue, l.first_poured, l.last_poured
    from public.house_beverage_ledger('a3010000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = p_label
$$;

-- T1 a mapped rakı rung on a closed check is sold (A-016). It never entered
-- the queue, so the old pour left it blank.
do $$
declare r record;
begin
  select * into r from pg_temp.aw10_row('Zqtl Yeni Raki');
  assert r.pos_lines is not null, 'T1 FAIL the rakı has no ledger row';
  assert r.pos_lines = 1, format('T1 FAIL the rakı reads pos_lines = %s, expected 1 (the till rang it once)', r.pos_lines);
  assert r.poured_qty = 2, format('T1 FAIL the rakı reads poured_qty = %s, expected 2', r.poured_qty);
  assert r.poured_revenue = 18, format('T1 FAIL the rakı reads poured_revenue = %s, expected 18', r.poured_revenue);
  assert 'pos' = any (r.books), format('T1 FAIL the rakı''s books are %s, expected pos among them', r.books);
end $$;

-- T2 a voided check sells nothing: its lines and its queue rows are out.
do $$
declare n integer;
begin
  select count(*) into n from pg_temp.aw10_row('Zqtl Voided Wine');
  assert n = 0, format('T2 FAIL a line only on a voided check reads as a ledger row (%s rows)', n);
  select count(*) into n
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid) t
   where t.external_check_id = 'zqtl-c2';
  assert n = 0, format('T2 FAIL the till record carries %s lines of the voided check', n);
end $$;

-- T3 a cocktail on the menu, rung on a check and never queued, gets its Sold
-- and Taken (A-015); the voided check's 9 are not among them.
do $$
declare r record;
begin
  select * into r from pg_temp.aw10_row('Zqtl Lions Milk');
  assert r.pos_lines is not null, 'T3 FAIL the cocktail has no ledger row';
  assert r.pos_lines = 1, format('T3 FAIL the cocktail reads pos_lines = %s, expected 1', r.pos_lines);
  assert r.poured_qty = 3, format('T3 FAIL the cocktail reads poured_qty = %s, expected 3', r.poured_qty);
  assert r.poured_revenue = 51, format('T3 FAIL the cocktail reads poured_revenue = %s, expected 51', r.poured_revenue);
  assert r.books @> array['menu', 'pos'], format('T3 FAIL the cocktail''s books are %s', r.books);
end $$;

-- T4 food (not wine, never queued, on no other book) makes no ledger row.
do $$
declare n integer;
begin
  select count(*) into n from pg_temp.aw10_row('Zqtl Burger');
  assert n = 0, format('T4 FAIL a food line reads as a ledger row (%s rows)', n);
end $$;

-- T5 a queue line whose check exists is counted once, from the check.
do $$
declare r record; n integer; q integer;
begin
  select count(*), count(*) filter (where t.from_queue) into n, q
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Unmapped Wine']) t;
  assert n = 1, format('T5 FAIL the till record carries the unmapped wine %s times, expected once', n);
  assert q = 0, 'T5 FAIL the unmapped wine was counted from the queue, not from its check';
  select * into r from pg_temp.aw10_row('Zqtl Unmapped Wine');
  assert r.pos_lines = 1, format('T5 FAIL the unmapped wine reads pos_lines = %s, expected 1', r.pos_lines);
  assert r.poured_qty = 1, format('T5 FAIL the unmapped wine reads poured_qty = %s, expected 1', r.poured_qty);
end $$;

-- T6 an orphan queue line (no check behind it) is a sale.
do $$
declare r record; n integer;
begin
  select count(*) into n
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Orphan Lager']) t
   where t.from_queue and t.id like 'q:%';
  assert n = 1, format('T6 FAIL the till record carries %s orphan lines, expected 1', n);
  select * into r from pg_temp.aw10_row('Zqtl Orphan Lager');
  assert r.pos_lines = 1, format('T6 FAIL the orphan reads pos_lines = %s, expected 1', r.pos_lines);
  assert r.poured_qty = 2 and r.poured_revenue = 12,
    format('T6 FAIL the orphan reads qty %s, revenue %s; expected 2 and 12', r.poured_qty, r.poured_revenue);
end $$;

-- T7 a resolved orphan is still a sale: resolving a queue row names what it
-- was, it does not unsell it.
do $$
declare r record;
begin
  select * into r from pg_temp.aw10_row('Zqtl Resolved Orphan');
  assert r.pos_lines is not null, 'T7 FAIL a resolved orphan has no ledger row';
  assert r.pos_lines = 1, format('T7 FAIL a resolved orphan reads pos_lines = %s, expected 1', r.pos_lines);
end $$;

-- T8 house_till_lines(p_names) returns exactly the named lines (btrim, exact:
-- not "Zqtl Cola Zero"), parses a string qty and price, keeps a non-number qty
-- as NULL, and its id is unique, so a keyset page (id > last) is stable.
do $$
declare n integer; d integer; q2 integer; qnull integer; first_id text; rest integer;
begin
  select count(*), count(distinct t.id),
         count(*) filter (where t.qty = 2 and t.price = 4),
         count(*) filter (where t.qty is null)
    into n, d, q2, qnull
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Cola']) t;
  assert n = 3, format('T8 FAIL "Zqtl Cola" reads %s lines, expected 3 (C1, and two on C4)', n);
  assert d = n, 'T8 FAIL two lines share an id';
  assert q2 = 1, 'T8 FAIL the string qty "2" and price "4.00" were not read as numbers';
  assert qnull = 1, 'T8 FAIL a qty that is not a number was not kept as NULL';
  select min(t.id) into first_id
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Cola']) t;
  select count(*) into rest
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Cola']) t
   where t.id > first_id;
  assert rest = n - 1, format('T8 FAIL the page after the first id holds %s lines, expected %s', rest, n - 1);
  select count(*) into n
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array['Zqtl Cola']) t
   where t.item_name <> 'Zqtl Cola';
  assert n = 0, 'T8 FAIL a line not named exactly "Zqtl Cola" came back';
end $$;

-- T9 house_till_names lists each name once, with its line count; the voided
-- check adds nothing.
do $$
declare cola bigint; milk bigint; dup integer;
begin
  select t.lines into cola from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) t
   where t.item_name = 'Zqtl Cola';
  select t.lines into milk from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) t
   where t.item_name = 'Zqtl Lions Milk';
  assert cola = 3, format('T9 FAIL "Zqtl Cola" lists %s lines, expected 3', cola);
  assert milk = 1, format('T9 FAIL "Zqtl Lions Milk" lists %s lines, expected 1 (the voided check counted)', milk);
  select count(*) - count(distinct t.item_name) into dup
    from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) t;
  assert dup = 0, 'T9 FAIL a name is listed twice';
end $$;

-- T10 the current-menu rule survives (the_ledger_lists_only_the_current_menu):
-- a discarded line, and a line only on an archived menu, make no ledger row
-- even though the till rang them (neither is flagged wine nor ever queued).
do $$
declare n integer;
begin
  select count(*) into n from pg_temp.aw10_row('Zqtl Discarded Tonic');
  assert n = 0, format('T10 FAIL a discarded menu line reads as a ledger row (%s rows)', n);
  select count(*) into n from pg_temp.aw10_row('Zqtl Archived Gin');
  assert n = 0, format('T10 FAIL a line only on an archived menu reads as a ledger row (%s rows)', n);
end $$;

-- T11 the browser roles cannot execute the two new functions or the ledger;
-- service_role can.
do $$
declare f text;
begin
  foreach f in array array['public.house_till_lines(uuid, text[])',
                           'public.house_till_names(uuid)',
                           'public.house_beverage_ledger(uuid, integer)'] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), format('T11 FAIL anon can execute %s', f);
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), format('T11 FAIL authenticated can execute %s', f);
    assert has_function_privilege('service_role', f, 'EXECUTE'), format('T11 FAIL service_role cannot execute %s', f);
  end loop;
end $$;

-- T12 the ledger's signature and return shape did not change. [CORRECTED
-- 2026-10-05, the_cellar_counts_the_door_checked_price (ADR 0301 §2): that
-- migration appends three columns after the 31, so this block now pins the 31
-- by name and place rather than the count.]
do $$
declare args text; ncols integer; names text[];
begin
  select pg_get_function_identity_arguments(p.oid), coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs,
         p.proargnames[p.pronargs + 1 : p.pronargs + 31]
    into args, ncols, names
    from pg_proc p
   where p.oid = 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
  assert args = 'p_restaurant_id uuid, p_limit integer', format('T12 FAIL the signature changed: %s', args);
  assert ncols >= 31, format('T12 FAIL the return shape has %s columns, expected at least 31', ncols);
  assert names = array['house_key','label','books','first_seen','menu_lines','menu_bottle_price',
      'menu_glass_price','menu_sections','invoice_lines','first_bought','last_bought','bottles_bought',
      'paid_total','last_unit_price','last_bought_from','order_lines','last_ordered_at','last_order_price',
      'last_ordered_from','quote_count','last_quote_at','last_quote_price','last_quote_source',
      'last_quote_from','pos_lines','poured_qty','poured_revenue','first_poured','last_poured',
      'beverage_id','match_method'],
    format('T12 FAIL the 31 columns moved: %s', names);
end $$;

-- T13 an open check's lines count, dated when the check opened; a closed
-- check's when it closed. The cola's Sold is 1 + 0 (qty not a number) + 2.
do $$
declare r record;
begin
  select * into r from pg_temp.aw10_row('Zqtl Cola');
  assert r.pos_lines = 3, format('T13 FAIL the cola reads pos_lines = %s, expected 3', r.pos_lines);
  assert r.poured_qty = 3, format('T13 FAIL the cola reads poured_qty = %s, expected 3', r.poured_qty);
  assert r.poured_revenue = 16, format('T13 FAIL the cola reads poured_revenue = %s, expected 16', r.poured_revenue);
  assert r.first_poured = '2026-08-07 20:30+00'::timestamptz,
    format('T13 FAIL the cola was first sold %s, expected when C1 closed', r.first_poured);
  assert r.last_poured = '2026-08-09 18:00+00'::timestamptz,
    format('T13 FAIL the cola was last sold %s, expected when the open C4 opened', r.last_poured);
end $$;

-- T14 every name house_till_names lists, passed back to house_till_lines
-- exactly as listed, returns exactly that name's lines: a tab or a no-break
-- space at its edge included. The row record's till book relies on this
-- (readTillLines sends the listed names back untrimmed, ADR 0301 §1).
do $$
declare tab_lines bigint; nbsp_lines bigint; bad integer;
begin
  select t.lines into tab_lines from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) t
   where t.item_name = 'Zqtl Ayran' || E'\t';
  select t.lines into nbsp_lines from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) t
   where t.item_name = 'Zqtl Ayran' || chr(160);
  assert tab_lines = 1, format('T14 FAIL the name with a tab at its end lists %s lines, expected 1', tab_lines);
  assert nbsp_lines = 1, format('T14 FAIL the name with a no-break space at its end lists %s lines, expected 1', nbsp_lines);
  select count(*) into bad
    from public.house_till_names('a3010000-0000-4000-8000-000000000001'::uuid) n
   where n.lines <> (select count(*)
                       from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid, array[n.item_name]) t
                      where t.item_name = n.item_name);
  assert bad = 0, format('T14 FAIL %s listed names do not return their own lines when passed back as listed', bad);
end $$;

-- T15 (added 2026-10-05) a till name with a serve size added has a key of its
-- own. Its lines reach neither the menu row's Sold and Taken (the cell joins
-- names by beverage_house_key, and 'Zqtl Yeni Raki (single 50ml)' keys apart
-- from 'Zqtl Yeni Raki'), nor a row of their own (a till-only name is a row
-- only when the queue held it; the first build also admitted it when a line
-- was flagged is_wine). They stay in the till's record, where the row record
-- reads them. How such a name should join its row is the founder's fork (ADR
-- 0301, "Fork deferred"); an answer that joins them changes this test.
do $$
declare r record; n integer;
begin
  select * into r from pg_temp.aw10_row('Zqtl Yeni Raki');
  assert r.pos_lines = 1 and r.poured_qty = 2,
    format('T15 FAIL the rakı reads pos_lines %s, Sold %s; expected 1 and 2 (only the line under its own name, C1)', r.pos_lines, r.poured_qty);
  select * into r from pg_temp.aw10_row('Zqtl Efes Pilsen');
  assert r.pos_lines = 1 and r.poured_qty = 2 and r.poured_revenue = 16,
    format('T15 FAIL the beer reads pos_lines %s, Sold %s, Taken %s; expected 1, 2 and 16 (the bottled line only)', r.pos_lines, r.poured_qty, r.poured_revenue);
  select count(*) into n
    from public.house_beverage_ledger('a3010000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label in ('Zqtl Yeni Raki (single 50ml)', 'Zqtl Yeni Raki 70cl bottle', 'Zqtl Efes Pilsen (draft 400ml)');
  assert n = 0, format('T15 FAIL %s till-only names with a serve size read as ledger rows of their own, expected 0', n);
  select count(*) into n
    from public.house_till_lines('a3010000-0000-4000-8000-000000000001'::uuid,
           array['Zqtl Yeni Raki (single 50ml)', 'Zqtl Yeni Raki 70cl bottle', 'Zqtl Efes Pilsen (draft 400ml)']) t;
  assert n = 3, format('T15 FAIL the till''s record holds %s of the three serve-size lines, expected 3', n);
end $$;

rollback;
