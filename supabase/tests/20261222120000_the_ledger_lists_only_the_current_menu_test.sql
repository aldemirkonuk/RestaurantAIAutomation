-- A-028 (2026-10-03 analytics walk, register F-148): house_beverage_ledger
-- read every menu_items row of a house, so an archived copy of the current
-- menu counted each line twice (267 lines read for a 134-line menu). Migration
-- the_ledger_lists_only_the_current_menu joins restaurant_menus and keeps
-- status = 'active' only (ADR 0193).
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` or the PGlite harness stops
-- at the first one. Run it on a database built from supabase/migrations. It
-- must FAIL on a build without that migration (T1: the line reads
-- menu_lines = 2) and PASS with it. One transaction, rolled back: it leaves
-- nothing behind. Every product name is unique to this file, so rows already
-- in a populated database cannot match.

begin;

insert into public.restaurants (id, name, slug)
values ('a0280000-0000-4000-8000-000000000001', 'A028 house', 'a028-house');

-- The current menu, an archived copy of it, and a draft that was never chosen.
insert into public.restaurant_menus (id, restaurant_id, name, status) values
  ('a0280000-0000-4000-8000-0000000000a1', 'a0280000-0000-4000-8000-000000000001', 'Current', 'active'),
  ('a0280000-0000-4000-8000-0000000000a2', 'a0280000-0000-4000-8000-000000000001', 'Last season', 'archived'),
  ('a0280000-0000-4000-8000-0000000000a3', 'a0280000-0000-4000-8000-000000000001', 'Draft scan', 'draft');

insert into public.menu_items (menu_id, restaurant_id, name, producer, category, bottle_price, status) values
  -- T1: the same line on the current menu and on its archived copy.
  ('a0280000-0000-4000-8000-0000000000a1', 'a0280000-0000-4000-8000-000000000001', 'Zqxa Raki Copy Test', null, 'Spirits', 40, 'approved'),
  ('a0280000-0000-4000-8000-0000000000a2', 'a0280000-0000-4000-8000-000000000001', 'Zqxa Raki Copy Test', null, 'Spirits', 40, 'approved'),
  -- T2: a line only on the draft.
  ('a0280000-0000-4000-8000-0000000000a3', 'a0280000-0000-4000-8000-000000000001', 'Zqxa Draft Only Lager', null, 'Beer', 9, 'approved'),
  -- T3: a discarded line on the current menu.
  ('a0280000-0000-4000-8000-0000000000a1', 'a0280000-0000-4000-8000-000000000001', 'Zqxa Discarded Cider', null, 'Cider', 8, 'discarded');

-- T1 a line on the current menu and on its archived copy is on the menu ONCE.
do $$
declare
  n integer;
begin
  select l.menu_lines into n
    from public.house_beverage_ledger('a0280000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqxa Raki Copy Test';
  assert n is not null, 'T1 FAIL the current menu''s line is missing from the ledger';
  assert n = 1, format('T1 FAIL the current menu''s line reads menu_lines = %s, expected 1 (the archived copy is still counted)', n);
end $$;

-- T2 a line only on a draft menu is not on the menu.
do $$
declare
  n integer;
begin
  select count(*) into n
    from public.house_beverage_ledger('a0280000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqxa Draft Only Lager';
  assert n = 0, format('T2 FAIL a draft-only line reads as on the menu (%s ledger rows)', n);
end $$;

-- T3 a discarded line on the current menu stays off it.
do $$
declare
  n integer;
begin
  select count(*) into n
    from public.house_beverage_ledger('a0280000-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label = 'Zqxa Discarded Cider';
  assert n = 0, format('T3 FAIL a discarded line reads as on the menu (%s ledger rows)', n);
end $$;

-- T4 the signature and return shape did not change: the function still takes
-- (uuid, integer) and returns the same 31 columns, so callers need no change.
-- [CORRECTED 2026-10-05, the_cellar_counts_the_door_checked_price (ADR 0301
-- §2): that migration appends three columns after the 31, so this block now
-- pins the 31 by name and place rather than the count.]
do $$
declare
  args text;
  ncols integer;
  names text[];
begin
  select pg_get_function_identity_arguments(p.oid), coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs,
         p.proargnames[p.pronargs + 1 : p.pronargs + 31]
    into args, ncols, names
    from pg_proc p
   where p.oid = 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
  assert args = 'p_restaurant_id uuid, p_limit integer',
    format('T4 FAIL the signature changed: %s', args);
  assert ncols >= 31, format('T4 FAIL the return shape has %s columns, expected at least 31', ncols);
  assert names = array['house_key','label','books','first_seen','menu_lines','menu_bottle_price',
      'menu_glass_price','menu_sections','invoice_lines','first_bought','last_bought','bottles_bought',
      'paid_total','last_unit_price','last_bought_from','order_lines','last_ordered_at','last_order_price',
      'last_ordered_from','quote_count','last_quote_at','last_quote_price','last_quote_source',
      'last_quote_from','pos_lines','poured_qty','poured_revenue','first_poured','last_poured',
      'beverage_id','match_method'],
    format('T4 FAIL the 31 columns moved: %s', names);
end $$;

rollback;
