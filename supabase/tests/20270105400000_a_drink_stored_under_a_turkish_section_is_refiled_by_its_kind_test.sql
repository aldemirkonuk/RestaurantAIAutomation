-- F-1314: library rows stored before F-1293 with a Turkish menu_category
-- ("Rakı", "Bira", "Kırmızı Şaraplar") stayed beverage_kind 'unknown', and
-- their house items were filed as wine. Migration a_drink_stored_under_a_
-- turkish_section_is_refiled_by_its_kind refiles them by the kind the section
-- names, the way the import now does.
--
-- Self-asserting: every block raises on a failure, so the PGlite harness or
-- `psql -v ON_ERROR_STOP=1 -f` stops at the first one. It must FAIL on a
-- build without that migration and PASS with it. One transaction, rolled
-- back. All fixtures are SYNTHETIC, keyed by fresh uuids.

begin;

create temporary table t_fx (k text primary key, v uuid, section text) on commit drop;
insert into t_fx values
  ('house',     gen_random_uuid(), null),
  ('raki',      gen_random_uuid(), 'Rakı'),
  ('raki_caps', gen_random_uuid(), 'RAKILAR VE RAKI'),
  ('bira',      gen_random_uuid(), 'Biralar'),
  ('viski',     gen_random_uuid(), 'Viski'),
  ('kokteyl',   gen_random_uuid(), 'Kokteyller'),
  ('alkolsuz',  gen_random_uuid(), 'Alkolsüz İçecekler'),
  ('kirmizi',   gen_random_uuid(), 'Kırmızı Şaraplar'),
  ('kopuklu',   gen_random_uuid(), 'KÖPÜKLÜ'),
  ('tatli',     gen_random_uuid(), 'Tatlı Şarap'),
  ('et',        gen_random_uuid(), 'Kırmızı Et'),
  ('two',       gen_random_uuid(), 'Beyaz ve Roze'),
  ('english',   gen_random_uuid(), 'beer'),
  ('item_raki', gen_random_uuid(), null),
  ('item_bira', gen_random_uuid(), null),
  ('item_kirm', gen_random_uuid(), null);

insert into public.restaurants (id, name, slug)
select v, 'SYNTHETIC refile house', 'syn-refile-' || left(replace(v::text, '-', ''), 16)
  from t_fx where k = 'house';

insert into public.master_wine_library (id, wine_id, name, primary_type, data_enrichment)
select v, 'SYN-RF-' || left(replace(v::text, '-', ''), 12), 'SYNTHETIC ' || k, 'unknown',
       jsonb_build_object('menu_category', section)
  from t_fx where section is not null;

-- A house item the trigger filed (unknown library row -> wine), one more,
-- and one whose kind a person declared.
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item_raki'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'raki'), 700, 50;
insert into public.restaurant_inventory (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml)
select (select v from t_fx where k = 'item_kirm'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'kirmizi'), 750, 150;
insert into public.restaurant_inventory
  (id, restaurant_id, master_wine_id, bottle_size_ml, pour_size_ml, kind, uom, display_name, identity_provenance)
select (select v from t_fx where k = 'item_bira'), (select v from t_fx where k = 'house'),
       (select v from t_fx where k = 'bira'), 500, 500, 'wine', 'bottle', 'SYNTHETIC declared', 'house_declared';

-- T0: the bug as stored: every Turkish row is unknown, its house item wine.
do $$
declare n int;
begin
  select count(*) into n from public.master_wine_library w join t_fx f on f.v = w.id
   where f.k not in ('english') and w.beverage_kind <> 'unknown';
  if n <> 0 then raise exception 'T0 FAIL: % Turkish row(s) already classified before the refile', n; end if;
  if (select kind from public.restaurant_inventory where id = (select v from t_fx where k = 'item_raki')) <> 'wine' then
    raise exception 'T0 FAIL: the rakı house item was not filed as wine before the refile';
  end if;
end $$;

-- T1: the refile files each unambiguous row by its kind.
create temporary table t_run1 on commit drop as
  select * from public.refile_drinks_by_their_turkish_section();

do $$
declare
  want record;
  got text;
  mc text;
begin
  for want in
    select * from (values
      ('raki', 'spirit', 'spirit'), ('raki_caps', 'spirit', 'spirit'),
      ('bira', 'beer', 'beer'), ('viski', 'spirit', 'whiskey'),
      ('kokteyl', 'cocktail', 'cocktail'), ('alkolsuz', 'non_alcoholic', 'non-alcoholic'),
      ('kirmizi', 'wine', 'red'), ('kopuklu', 'wine', 'sparkling'),
      ('tatli', 'wine', 'dessert'), ('english', 'beer', 'beer')
    ) as t(k, kind, cat)
  loop
    select w.beverage_kind, w.data_enrichment ->> 'menu_category' into got, mc
      from public.master_wine_library w where w.id = (select v from t_fx where k = want.k);
    if got <> want.kind or mc <> want.cat then
      raise exception 'T1 FAIL: % filed as % / %, want % / %', want.k, got, mc, want.kind, want.cat;
    end if;
  end loop;
  if (select data_enrichment ->> 'menu_category_as_written' from public.master_wine_library
       where id = (select v from t_fx where k = 'raki')) <> 'Rakı' then
    raise exception 'T1 FAIL: the heading as written was not kept';
  end if;
end $$;

-- T2: food and two-kind sections are left exactly as they were.
do $$
declare r record;
begin
  for r in
    select f.k, f.section, w.beverage_kind, w.data_enrichment
      from t_fx f join public.master_wine_library w on w.id = f.v
     where f.k in ('et', 'two')
  loop
    if r.beverage_kind <> 'unknown' or r.data_enrichment <> jsonb_build_object('menu_category', r.section) then
      raise exception 'T2 FAIL: % was touched (% / %)', r.k, r.beverage_kind, r.data_enrichment;
    end if;
  end loop;
end $$;

-- T3: house items: the trigger-filed rakı moves to spirit; the red wine stays
-- wine; a kind a person declared is left alone.
do $$
begin
  if (select kind from public.restaurant_inventory where id = (select v from t_fx where k = 'item_raki')) <> 'spirit' then
    raise exception 'T3 FAIL: the rakı house item is not a spirit';
  end if;
  if (select kind from public.restaurant_inventory where id = (select v from t_fx where k = 'item_kirm')) <> 'wine' then
    raise exception 'T3 FAIL: the red wine house item moved off wine';
  end if;
  if (select kind from public.restaurant_inventory where id = (select v from t_fx where k = 'item_bira')) <> 'wine' then
    raise exception 'T3 FAIL: a declared kind was overwritten';
  end if;
  if (select library_rows from t_run1) < 9 or (select house_items from t_run1) < 1 then
    raise exception 'T3 FAIL: counts % / % under the seeded rows', (select library_rows from t_run1), (select house_items from t_run1);
  end if;
end $$;

-- T4: idempotent: a second run changes nothing and deletes nothing.
do $$
declare r record; n int;
begin
  select * into r from public.refile_drinks_by_their_turkish_section();
  if r.library_rows <> 0 or r.house_items <> 0 then
    raise exception 'T4 FAIL: a second run refiled % row(s) and % item(s)', r.library_rows, r.house_items;
  end if;
  select count(*) into n from public.master_wine_library w join t_fx f on f.v = w.id;
  if n <> 12 then raise exception 'T4 FAIL: % of 12 seeded library rows remain', n; end if;
  if (select data_enrichment ->> 'menu_category_as_written' from public.master_wine_library
       where id = (select v from t_fx where k = 'raki')) <> 'Rakı' then
    raise exception 'T4 FAIL: the second run overwrote the heading as written';
  end if;
end $$;

-- T5: a browser's role cannot run the refile.
do $$
begin
  if has_function_privilege('authenticated', 'public.refile_drinks_by_their_turkish_section()', 'execute')
     or has_function_privilege('anon', 'public.refile_drinks_by_their_turkish_section()', 'execute') then
    raise exception 'T5 FAIL: anon or authenticated may run the refile';
  end if;
end $$;

rollback;
