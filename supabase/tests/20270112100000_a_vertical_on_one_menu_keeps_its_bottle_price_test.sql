-- F-1559 (ADR 0340 rules 19 and 25): house_beverage_ledger compares two
-- prices within one vintage, so a vertical on one live menu keeps its bottle
-- price, and two prices for one vintage are still named a conflict.
-- Migration a_vertical_on_one_menu_keeps_its_bottle_price.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqvt", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration (the_ledger_reads_drink_lines_and_names_two_prices
-- the latest ledger): T1 FAILS (the vertical reads NULL and a conflict), T2
-- FAILS (the glass price of the vertical reads NULL) and T4 FAILS (NV and
-- 2019 read as two prices). T3 and T5 are pins: they pass on that build too
-- (two prices for one vintage, or across two menus with no vintage, are a
-- conflict). Rows are read as jsonb, so a block fails on its assertion, never
-- on a missing column.

begin;

insert into public.restaurants (id, name, slug) values
  ('a3410559-0000-4000-8000-000000000001', 'F-1559 vertical house', 'f-1559-vertical-house');

insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status) values
  ('a3410559-0000-4000-8000-0000000000d1', 'a3410559-0000-4000-8000-000000000001', 'SYNTHETIC Drinks',   'beverage', 'active'),
  ('a3410559-0000-4000-8000-0000000000e1', 'a3410559-0000-4000-8000-000000000001', 'SYNTHETIC Desserts', 'desserts', 'active');

-- d = Drinks, e = Desserts. Prices in the house's currency (EUR here).
insert into public.menu_items
  (id, menu_id, restaurant_id, name, producer, vintage, category, bottle_price, by_glass_price, line_kind, status)
select ('a3410559-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       ('a3410559-0000-4000-8000-0000000000' || m || '1')::uuid,
       'a3410559-0000-4000-8000-000000000001', name, producer, vintage, cat, bottle, glass, kind, 'approved'
  from (values
    ( 1, 'd', 'Zqvt Barolo',   'Vietti', '2015',      'red',       90::numeric, null::numeric, 'drink'),
    ( 2, 'd', 'Zqvt Barolo',   'Vietti', '2018',      'red',       70,          12,            'drink'),
    ( 3, 'd', 'Zqvt Barolo',   'Vietti', ' 2016 ',    'red',       80,          null,          'drink'),
    ( 4, 'd', 'Zqvt Chianti',  'Fonti',  '2020',      'red',       30,          null,          'drink'),
    ( 5, 'd', 'Zqvt Chianti',  'Fonti',  '2020',      'red',       34,          null,          'drink'),
    ( 6, 'd', 'Zqvt Champers', 'Maison', 'NV',        'sparkling', 60,          null,          'drink'),
    ( 7, 'd', 'Zqvt Champers', 'Maison', '2019',      'sparkling', 95,          null,          'drink'),
    ( 8, 'd', 'Zqvt Port',     'Quinta', null,        'fortified', 40,          null,          'drink'),
    ( 9, 'e', 'Zqvt Port',     'Quinta', null,        'fortified', 45,          null,          'drink')
  ) x(n, m, name, producer, vintage, cat, bottle, glass, kind);

create temp table t_ledger on commit drop as
  select to_jsonb(l) as r
    from public.house_beverage_ledger('a3410559-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label like '%Zqvt%';

-- T1 a vertical on one live menu is not two prices: the bottle price is the
-- newest vintage's, and no conflict is named.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Vietti Zqvt Barolo';
  assert r is not null, 'T1 FAIL the vertical is not a ledger row';
  assert (r->>'menu_bottle_price')::numeric = 70, format('T1 FAIL bottle %s, expected 70 (2018)', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is false, format('T1 FAIL conflict %s, expected false', r->>'menu_price_conflict');
  assert (r->>'menu_lines')::int = 3, format('T1 FAIL menu_lines %s, expected 3', r->>'menu_lines');
end $$;

-- T2 the glass price of the vertical stays: one vintage pours by the glass.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Vietti Zqvt Barolo';
  assert (r->>'menu_glass_price')::numeric = 12, format('T2 FAIL glass %s, expected 12', r->>'menu_glass_price');
end $$;

-- T3 (pin) two prices for one vintage on one menu are a conflict: NULL.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Fonti Zqvt Chianti';
  assert r is not null, 'T3 FAIL Chianti is not a ledger row';
  assert (r->>'menu_bottle_price') is null, format('T3 FAIL bottle %s, expected NULL (30 vs 34)', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is true, format('T3 FAIL conflict %s, expected true', r->>'menu_price_conflict');
end $$;

-- T4 a dated vintage beside a non-vintage is two wines: the dated year wins.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Maison Zqvt Champers';
  assert (r->>'menu_bottle_price')::numeric = 95, format('T4 FAIL bottle %s, expected 95 (2019)', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is false, format('T4 FAIL conflict %s', r->>'menu_price_conflict');
end $$;

-- T5 (pin) one wine with no vintage at two prices across two live menus is
-- still a conflict (the_ledger_reads_drink_lines_and_names_two_prices T4).
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Quinta Zqvt Port';
  assert (r->>'menu_bottle_price') is null, format('T5 FAIL bottle %s, expected NULL (40 vs 45)', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is true, format('T5 FAIL conflict %s', r->>'menu_price_conflict');
  assert (r->>'menu_lines')::int = 1, format('T5 FAIL menu_lines %s, expected 1', r->>'menu_lines');
end $$;

rollback;
