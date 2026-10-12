-- Lane 4 of the menus build (ADR 0340 rule 25): house_beverage_ledger reads
-- DRINK lines only, on any live menu, counts a product once, names two prices
-- instead of taking max(), and reads the house's own section title.
-- Migration the_ledger_reads_drink_lines_and_names_two_prices.
--
-- Self-asserting: every block raises on a failure (assert -> P0004, or the
-- error itself), so `psql -v ON_ERROR_STOP=1 -f` stops at the first one. Run
-- it on a database built from supabase/migrations. Synthetic fixtures only,
-- one transaction, rolled back: it leaves nothing behind. Every product name
-- starts with "Zqlk", so rows already in a populated database cannot match.
--
-- On a build WITHOUT the migration (the_cellar_counts_the_door_checked_price
-- the latest ledger): T2 FAILS (the dish on Food and the unkinded line on
-- Desserts are ledger rows), T3 FAILS (the Tokaji on Drinks and Desserts
-- reads 2 lines), T4 FAILS (Port reads 45, the max, and no conflict), T5
-- FAILS (the glass price reads 9), T6 FAILS (the section reads 'sparkling',
-- the category) and T8 FAILS (34 columns). T1 and T7 are pins: they pass on
-- that build too (a legacy Drinks line stays; one live menu still counts
-- every line of that menu). Rows are read as jsonb, so a block fails on its
-- assertion, never on a missing column.

begin;

insert into public.restaurants (id, name, slug) values
  ('a3400004-0000-4000-8000-000000000001', 'L4 drink-lines house', 'l4-drink-lines-house');

insert into public.restaurant_menus (id, restaurant_id, name, menu_type, status) values
  ('a3400004-0000-4000-8000-0000000000d1', 'a3400004-0000-4000-8000-000000000001', 'SYNTHETIC Drinks',   'beverage', 'active'),
  ('a3400004-0000-4000-8000-0000000000f1', 'a3400004-0000-4000-8000-000000000001', 'SYNTHETIC Food',     'food',     'active'),
  ('a3400004-0000-4000-8000-0000000000e1', 'a3400004-0000-4000-8000-000000000001', 'SYNTHETIC Desserts', 'desserts', 'active'),
  ('a3400004-0000-4000-8000-0000000000a1', 'a3400004-0000-4000-8000-000000000001', 'SYNTHETIC Draft',    'beverage', 'draft');

insert into public.menu_sections (id, restaurant_id, menu_id, position, title, title_as_read, key) values
  ('a3400004-0000-4000-8000-0000000005c1', 'a3400004-0000-4000-8000-000000000001',
   'a3400004-0000-4000-8000-0000000000d1', 0, 'Bubbles & Co', 'BUBBLES & CO', 'bubbles-co');

-- d = Drinks, e = Desserts, f = Food, a = the draft.
insert into public.menu_items
  (id, menu_id, restaurant_id, name, category, bottle_price, by_glass_price, price, line_kind, section_id, status)
select ('a3400004-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       ('a3400004-0000-4000-8000-0000000000' || m || '1')::uuid,
       'a3400004-0000-4000-8000-000000000001', name, cat, bottle, glass, price, kind,
       case when sec then 'a3400004-0000-4000-8000-0000000005c1'::uuid end, 'approved'
  from (values
    ( 1, 'd', 'Zqlk Legacy Gin',   'Gin',       50::numeric, null::numeric, null::numeric, null::text, false),
    ( 2, 'd', 'Zqlk Tokaji',       'dessert',   60,   null, null, 'drink', false),
    ( 3, 'e', 'Zqlk Tokaji',       'dessert',   60,   null, null, 'drink', false),
    ( 4, 'f', 'Zqlk Lamb Shank',   'Mains',     null, null, 30,   'dish',  false),
    ( 5, 'f', 'Zqlk Olive Bread',  'Starters',  null, null, null, null,    false),
    ( 6, 'd', 'Zqlk Port',         'fortified', 40,   null, null, 'drink', false),
    ( 7, 'e', 'Zqlk Port',         'fortified', 45,   null, null, 'drink', false),
    ( 8, 'd', 'Zqlk Cava',         'sparkling', 35,   null, null, null,    true),
    ( 9, 'e', 'Zqlk Moscato',      'Puddings',  null, null, null, null,    false),
    (10, 'd', 'Zqlk Rioja',        'red',       30,   null, null, null,    false),
    (11, 'd', 'Zqlk Rioja',        'red',       30,   null, null, null,    false),
    (12, 'd', 'Zqlk Prosecco',     'sparkling', 32,   8,    null, 'drink', false),
    (13, 'e', 'Zqlk Prosecco',     'sparkling', 32,   9,    null, 'drink', false),
    (14, 'a', 'Zqlk Draft Only',   'red',       20,   null, null, null,    false)
  ) x(n, m, name, cat, bottle, glass, price, kind, sec);

create temp table t_ledger on commit drop as
  select to_jsonb(l) as r
    from public.house_beverage_ledger('a3400004-0000-4000-8000-000000000001'::uuid, 600) l
   where l.label like 'Zqlk%';

-- T1 (pin) a line with no stored kind on the Drinks menu stays: today's rule.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Legacy Gin';
  assert r is not null, 'T1 FAIL the legacy Drinks line left the ledger';
  assert (r->>'menu_lines')::int = 1, format('T1 FAIL menu_lines %s, expected 1', r->>'menu_lines');
  assert (r->>'menu_bottle_price')::numeric = 50, format('T1 FAIL bottle %s', r->>'menu_bottle_price');
end $$;

-- T2 a dish on Food, a line with no kind on Food or Desserts, and a draft's
-- line are not ledger rows.
do $$
declare names text[];
begin
  select array_agg(t.r->>'label' order by t.r->>'label') into names from t_ledger t
   where t.r->>'label' in ('Zqlk Lamb Shank', 'Zqlk Olive Bread', 'Zqlk Moscato', 'Zqlk Draft Only');
  assert names is null, format('T2 FAIL non-drink lines read as ledger rows: %s', names);
end $$;

-- T3 a dessert wine stored as a drink on Desserts is read, and counted once
-- when it is on Drinks too, at the one price both give.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Tokaji';
  assert r is not null, 'T3 FAIL the dessert wine is not a ledger row';
  assert (r->>'menu_lines')::int = 1, format('T3 FAIL menu_lines %s, expected 1 (counted once)', r->>'menu_lines');
  assert (r->>'menu_bottle_price')::numeric = 60, format('T3 FAIL bottle %s', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is false, format('T3 FAIL conflict %s', r->>'menu_price_conflict');
end $$;

-- T4 two bottle prices are named, not maxed: NULL and a conflict.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Port';
  assert r is not null, 'T4 FAIL Port is not a ledger row';
  assert (r->>'menu_bottle_price') is null, format('T4 FAIL bottle %s, expected NULL (40 vs 45)', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is true, format('T4 FAIL conflict %s, expected true', r->>'menu_price_conflict');
  assert (r->>'menu_lines')::int = 1, format('T4 FAIL menu_lines %s, expected 1', r->>'menu_lines');
end $$;

-- T5 two glass prices: the glass price is NULL and the conflict set, while
-- the bottle price both agree on stays.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Prosecco';
  assert r is not null, 'T5 FAIL Prosecco is not a ledger row';
  assert (r->>'menu_glass_price') is null, format('T5 FAIL glass %s, expected NULL (8 vs 9)', r->>'menu_glass_price');
  assert (r->>'menu_bottle_price')::numeric = 32, format('T5 FAIL bottle %s, expected 32', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is true, format('T5 FAIL conflict %s', r->>'menu_price_conflict');
end $$;

-- T6 the section is the house's own section title, not the category.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Cava';
  assert r is not null, 'T6 FAIL Cava is not a ledger row';
  assert r->'menu_sections' = '["Bubbles & Co"]'::jsonb, format('T6 FAIL sections %s', r->'menu_sections');
end $$;

-- T7 (pin) two lines of one product on one live menu still count 2.
do $$
declare r jsonb;
begin
  select t.r into r from t_ledger t where t.r->>'label' = 'Zqlk Rioja';
  assert (r->>'menu_lines')::int = 2, format('T7 FAIL menu_lines %s, expected 2', r->>'menu_lines');
  assert (r->>'menu_bottle_price')::numeric = 30, format('T7 FAIL bottle %s', r->>'menu_bottle_price');
  assert (r->>'menu_price_conflict')::boolean is false, format('T7 FAIL conflict %s', r->>'menu_price_conflict');
end $$;

-- T8 the signature is unchanged; the first 34 columns keep their names and
-- places; menu_price_conflict is the 35th; only service_role may call it.
do $$
declare args text; names text[]; ncols integer;
        f regprocedure := 'public.house_beverage_ledger(uuid, integer)'::regprocedure;
begin
  select pg_get_function_identity_arguments(p.oid),
         p.proargnames[p.pronargs + 1 : array_length(p.proargnames, 1)],
         coalesce(array_length(p.proallargtypes, 1), 0) - p.pronargs
    into args, names, ncols
    from pg_proc p where p.oid = f;
  assert args = 'p_restaurant_id uuid, p_limit integer', format('T8 FAIL the signature changed: %s', args);
  assert ncols = 35, format('T8 FAIL the return shape has %s columns, expected 35', ncols);
  assert names[1:34] = array['house_key','label','books','first_seen','menu_lines','menu_bottle_price',
    'menu_glass_price','menu_sections','invoice_lines','first_bought','last_bought','bottles_bought',
    'paid_total','last_unit_price','last_bought_from','order_lines','last_ordered_at','last_order_price',
    'last_ordered_from','quote_count','last_quote_at','last_quote_price','last_quote_source',
    'last_quote_from','pos_lines','poured_qty','poured_revenue','first_poured','last_poured',
    'beverage_id','match_method','door_checked_lines','first_bought_door_checked',
    'last_bought_door_checked'], format('T8 FAIL the first 34 columns moved: %s', names[1:34]);
  assert names[35] = 'menu_price_conflict', format('T8 FAIL the 35th column is %s', names[35]);
  assert not has_function_privilege('anon', f, 'EXECUTE'), 'T8 FAIL anon can execute the ledger';
  assert not has_function_privilege('authenticated', f, 'EXECUTE'), 'T8 FAIL authenticated can execute the ledger';
  assert has_function_privilege('service_role', f, 'EXECUTE'), 'T8 FAIL service_role cannot execute the ledger';
end $$;

rollback;
