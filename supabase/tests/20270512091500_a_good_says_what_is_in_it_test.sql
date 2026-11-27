-- a_good_says_what_is_in_it: per-item nutrition and the 14 allergens.
--
-- Self-asserting: every block raises on a failure, so `psql -v
-- ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a build without
-- the migration (T1: there is no item_nutrition) and PASS with it. One
-- transaction, rolled back.

begin;

insert into public.restaurants (id, name, slug) values
  ('b5120000-0000-4000-8000-000000000001', 'Nutrition house A', 'nutrition-house-a-test'),
  ('b5120000-0000-4000-8000-000000000002', 'Nutrition house B', 'nutrition-house-b-test');
insert into public.users (user_id, email, name, restaurant_id, role) values
  ('b5120000-0000-4000-8000-0000000000a1', 'nutrition-a@x.test', 'Ayşe',
   'b5120000-0000-4000-8000-000000000001', 'manager');
insert into public.restaurant_inventory (id, restaurant_id, kind, uom, display_name, identity_provenance) values
  ('b5120000-0000-4000-8000-0000000000c1', 'b5120000-0000-4000-8000-000000000001', 'food', 'g', 'Tulum cheese', 'house_declared'),
  ('b5120000-0000-4000-8000-0000000000c2', 'b5120000-0000-4000-8000-000000000001', 'spirit', 'bottle', 'Rakı', 'house_declared'),
  ('b5120000-0000-4000-8000-0000000000c3', 'b5120000-0000-4000-8000-000000000002', 'food', 'g', 'Other house flour', 'house_declared');

-- T1 the tables exist, RLS on, client roles cannot read.
do $$
begin
  assert to_regclass('public.item_nutrition') is not null, 'T1 FAIL item_nutrition is missing';
  assert to_regclass('public.item_allergens') is not null, 'T1 FAIL item_allergens is missing';
  assert (select relrowsecurity from pg_class where oid = 'public.item_nutrition'::regclass), 'T1 FAIL RLS off on item_nutrition';
  assert not has_table_privilege('authenticated', 'public.item_nutrition', 'SELECT'), 'T1 FAIL authenticated can read item_nutrition';
  assert not has_table_privilege('anon', 'public.item_allergens', 'SELECT'), 'T1 FAIL anon can read item_allergens';
  assert not has_function_privilege('authenticated',
    'public.save_item_nutrition(uuid, uuid, uuid, text, jsonb, jsonb)', 'EXECUTE'),
    'T1 FAIL authenticated can call save_item_nutrition';
end $$;

-- T2 a save keeps an unknown figure NULL (never 0), and stores its basis,
-- source and author; allergens are stored as stated.
do $$
declare
  r public.item_nutrition%rowtype;
  n int;
begin
  perform public.save_item_nutrition(
    'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c1',
    'b5120000-0000-4000-8000-0000000000a1', 'Ayşe',
    '{"basis":"100g","energy_kcal":350,"fat_g":28,"saturates_g":18,"protein_g":22,"energy_from_abv":false,"source":"pack_label"}'::jsonb,
    '[{"allergen":"milk","status":"contains"},{"allergen":"gluten","status":"free"}]'::jsonb);
  select * into r from public.item_nutrition where inventory_id = 'b5120000-0000-4000-8000-0000000000c1';
  assert r.basis = '100g', 'T2 FAIL basis not kept';
  assert r.salt_g is null, format('T2 FAIL an unstated salt became %s', r.salt_g);
  assert r.sugars_g is null, 'T2 FAIL an unstated sugar is not null';
  assert r.energy_kcal = 350, 'T2 FAIL energy not kept';
  assert r.source = 'pack_label' and r.source_ref is null, 'T2 FAIL source not kept';
  assert r.stated_by_name = 'Ayşe' and r.stated_at is not null, 'T2 FAIL the author is not kept';
  select count(*) into n from public.item_allergens where inventory_id = 'b5120000-0000-4000-8000-0000000000c1';
  assert n = 2, format('T2 FAIL expected 2 allergen rows, got %s', n);
end $$;

-- T3 a second save replaces both: an allergen left out is "not stated" again.
do $$
declare
  n int;
begin
  perform public.save_item_nutrition(
    'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c1',
    'b5120000-0000-4000-8000-0000000000a1', 'Ayşe',
    '{"basis":"100g","salt_g":3.1,"energy_from_abv":false,"source":"house"}'::jsonb,
    '[{"allergen":"milk","status":"contains"}]'::jsonb);
  select count(*) into n from public.item_allergens where inventory_id = 'b5120000-0000-4000-8000-0000000000c1';
  assert n = 1, format('T3 FAIL expected 1 allergen row after replace, got %s', n);
  assert (select energy_kcal is null and salt_g = 3.1 from public.item_nutrition
           where inventory_id = 'b5120000-0000-4000-8000-0000000000c1'), 'T3 FAIL figures not replaced';
end $$;

-- T4 another house's item is refused by the write, and by the tables.
do $$
begin
  begin
    perform public.save_item_nutrition(
      'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c3',
      'b5120000-0000-4000-8000-0000000000a1', 'Ayşe',
      '{"basis":"100g","energy_from_abv":false,"source":"house"}'::jsonb, '[]'::jsonb);
    raise exception 'T4 FAIL a save into another house''s item was accepted';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    insert into public.item_allergens (restaurant_id, inventory_id, allergen, status, stated_by, stated_by_name, stated_at)
    values ('b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c3', 'milk', 'free',
            'b5120000-0000-4000-8000-0000000000a1', 'Ayşe', now());
    raise exception 'T4 FAIL an allergen row naming another house''s item was accepted';
  exception when sqlstate '42501' then null;
  end;
end $$;

-- T5 an unknown allergen and an unknown status are refused.
do $$
begin
  begin
    perform public.save_item_nutrition(
      'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c1',
      'b5120000-0000-4000-8000-0000000000a1', 'Ayşe', null, '[{"allergen":"garlic","status":"contains"}]'::jsonb);
    raise exception 'T5 FAIL an allergen outside the 14 was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.save_item_nutrition(
      'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c1',
      'b5120000-0000-4000-8000-0000000000a1', 'Ayşe', null, '[{"allergen":"milk","status":"probably"}]'::jsonb);
    raise exception 'T5 FAIL an unknown status was accepted';
  exception when check_violation then null;
  end;
end $$;

-- T6 ABV is per volume, energy from ABV must be the arithmetic, a lookup
-- names its reference, a part cannot exceed its whole.
do $$
declare
  bad jsonb[] := array[
    '{"basis":"100g","abv_pct":40,"energy_from_abv":false,"source":"house"}',
    '{"basis":"100ml","abv_pct":40,"energy_kcal":200,"energy_from_abv":true,"source":"house"}',
    '{"basis":"100ml","energy_from_abv":false,"source":"open_food_facts"}',
    '{"basis":"100g","fat_g":5,"saturates_g":9,"energy_from_abv":false,"source":"house"}',
    '{"basis":"100g","sugars_g":120,"energy_from_abv":false,"source":"house"}'
  ]::jsonb[];
  b jsonb;
begin
  foreach b in array bad loop
    begin
      perform public.save_item_nutrition(
        'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c2',
        'b5120000-0000-4000-8000-0000000000a1', 'Ayşe', b, '[]'::jsonb);
      raise exception 'T6 FAIL accepted %', b;
    exception when check_violation then null;
    end;
  end loop;
  -- 40% ABV: 40 x 0.789 x 7 = 220.9 kcal per 100 ml.
  perform public.save_item_nutrition(
    'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c2',
    'b5120000-0000-4000-8000-0000000000a1', 'Ayşe',
    '{"basis":"100ml","abv_pct":40,"energy_kcal":220.9,"energy_from_abv":true,"source":"house"}'::jsonb, '[]'::jsonb);
  assert (select energy_from_abv and sugars_g is null from public.item_nutrition
           where inventory_id = 'b5120000-0000-4000-8000-0000000000c2'), 'T6 FAIL energy from ABV not kept';
end $$;

-- T7 a NULL nutrition removes the figures and keeps nothing behind.
do $$
begin
  perform public.save_item_nutrition(
    'b5120000-0000-4000-8000-000000000001', 'b5120000-0000-4000-8000-0000000000c2',
    'b5120000-0000-4000-8000-0000000000a1', 'Ayşe', null, '[]'::jsonb);
  assert not exists (select 1 from public.item_nutrition
                      where inventory_id = 'b5120000-0000-4000-8000-0000000000c2'), 'T7 FAIL figures not removed';
end $$;

rollback;
