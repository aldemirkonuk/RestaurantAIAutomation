-- Distributor Discovery — Türkiye, hand-curated
--
-- Türkiye has no three-tier system and no bulk permit download equivalent to the
-- TTB's. The Ministry of Agriculture and Forestry publishes licensed sellers
-- only through an interactive form (tadbsatisbelgesi.tarimorman.gov.tr), so this
-- market is curated by hand rather than ingested. That is a reasonable trade:
-- Türkiye has a small number of significant wine suppliers, not tens of
-- thousands.
--
-- A Dağıtım Yetki Belgesi is issued nationally, so every row here gets a single
-- territory row with admin_area_code = NULL, meaning nationwide within TR. This
-- is the same representation the schema uses for a US distributor licensed in
-- all fifty states, which is the point of modelling territory as
-- (country, admin_area_code) rather than as "US state".
--
-- ON VERIFICATION, and consistent with 20260728100300_distributor_data_quality.sql:
-- every company below is a real, independently documented Turkish wine business.
-- Only Kavaklıdere has a street address confirmed against a public source, so it
-- is the only row given coordinates. The rest are deliberately left without a
-- map pin and with a lower data_confidence rather than being assigned plausible
-- guesses. Inventing an address is precisely the defect that migration had to
-- clean up in the US seed; repeating it here would be worse for having known
-- better. Phone, email and street address are left NULL for the same reason.
--
-- Coordinates: OpenStreetMap/Nominatim (ODbL). (c) OpenStreetMap contributors.

insert into vendor_catalogue (
  id, name, type, country, city, website, wine_specialties,
  latitude, longitude, geocode_provider, geocoded_at,
  source, listing_tier, data_confidence, is_active, notes
) values
  (
    'a1000002-0000-4000-8000-000000000001',
    'Kavaklıdere Şarapları',
    'winery_direct', 'TR', 'Ankara',
    'https://www.kavaklidere.com',
    'Türkiye''s oldest winery (founded 1929). Indigenous varieties including Öküzgözü, Boğazkere, Kalecik Karası, Narince and Emir, alongside international varieties.',
    40.08037620, 33.01678020, 'osm', now(),
    'curated', 'curated', 0.90, true,
    'Street address confirmed against public sources; coordinates resolved to the Akyurt production site.'
  ),
  (
    'a1000002-0000-4000-8000-000000000002',
    'Mey İçki Sanayi ve Ticaret A.Ş.',
    'distributor', 'TR', 'İstanbul',
    'https://www.meyicki.com',
    'Türkiye''s largest alcoholic beverage producer and distributor, part of Diageo since 2011. Operates the country''s widest distribution network; portfolio spans domestic wine and spirits plus imported international brands.',
    null, null, null, null,
    'curated', 'curated', 0.50, true,
    'Company independently verified; head-office street address not confirmed against a public source, so no coordinates assigned. Listed without a map pin until an address is verified.'
  ),
  (
    'a1000002-0000-4000-8000-000000000003',
    'Doluca',
    'winery_direct', 'TR', 'İstanbul',
    'https://www.doluca.com',
    'Founded 1926, one of Türkiye''s two largest wine producers. Thrace and Aegean vineyards; indigenous and international varieties.',
    null, null, null, null,
    'curated', 'curated', 0.50, true,
    'Company independently verified; address not confirmed against a public source, so no coordinates assigned.'
  ),
  (
    'a1000002-0000-4000-8000-000000000004',
    'Kayra Şarapları',
    'winery_direct', 'TR', 'Elazığ',
    'https://www.kayrasaraplari.com',
    'Major Turkish producer with Elazığ and Şarköy operations. Known for Öküzgözü and Boğazkere bottlings.',
    null, null, null, null,
    'curated', 'curated', 0.50, true,
    'Company independently verified; address not confirmed against a public source, so no coordinates assigned.'
  ),
  (
    'a1000002-0000-4000-8000-000000000005',
    'Sevilen Şarapçılık',
    'winery_direct', 'TR', 'İzmir',
    'https://www.sevilen.com',
    'Aegean producer with vineyards in İzmir and Denizli (Güney). International varieties plus indigenous Turkish grapes.',
    null, null, null, null,
    'curated', 'curated', 0.50, true,
    'Company independently verified; address not confirmed against a public source, so no coordinates assigned.'
  )
on conflict (id) do nothing;

-- ===========================================================================
-- Nationwide territory: one row per vendor, admin_area_code NULL.
-- A Turkish DYB is national, so there is no per-province equivalent of a US
-- state licence.
-- ===========================================================================
insert into vendor_service_territories (vendor_id, country, admin_area_code, license_type, source)
select id, 'TR', null, 'tr_dyb', 'curated'
from (values
  ('a1000002-0000-4000-8000-000000000001'::uuid),
  ('a1000002-0000-4000-8000-000000000002'::uuid),
  ('a1000002-0000-4000-8000-000000000003'::uuid),
  ('a1000002-0000-4000-8000-000000000004'::uuid),
  ('a1000002-0000-4000-8000-000000000005'::uuid)
) as t(id)
where exists (select 1 from vendor_catalogue v where v.id = t.id)
on conflict do nothing;

-- ===========================================================================
-- Turkish grape varieties — absent from the 401-row grape seed entirely.
-- Without these, a portfolio facet for a Turkish producer has no canonical
-- value to normalise to. Guarded so it is a no-op where the ontology tables
-- were never applied (seed/ files are not run by the Supabase CLI).
-- ===========================================================================
do $$
begin
  if to_regclass('public.grape_varieties') is not null then
    insert into grape_varieties (name, canonical_name, color, aliases, typical_regions)
    values
      ('Öküzgözü',       'okuzgozu',       'red',   array['Okuzgozu', 'Oküzgözü'],       array['Elazığ', 'Eastern Anatolia']),
      ('Boğazkere',      'bogazkere',      'red',   array['Bogazkere'],                  array['Diyarbakır', 'Eastern Anatolia']),
      ('Kalecik Karası', 'kalecik-karasi', 'red',   array['Kalecik Karasi'],             array['Ankara', 'Central Anatolia']),
      ('Narince',        'narince',        'white', array[]::text[],                     array['Tokat', 'Central Anatolia']),
      ('Emir',           'emir',           'white', array[]::text[],                     array['Nevşehir', 'Cappadocia', 'Central Anatolia']),
      ('Çalkarası',      'calkarasi',      'red',   array['Calkarasi'],                  array['Denizli', 'Aegean Turkey']),
      ('Papazkarası',    'papazkarasi',    'red',   array['Papazkarasi'],                array['Thrace'])
    on conflict (canonical_name) do nothing;
  end if;
end $$;
