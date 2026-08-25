-- Distributor Discovery — backfill for the 20 curated vendors
--
-- Two things the /distributors map needs before it can render anything:
--   1. coordinates, so vendors can be pinned and distance-sorted
--   2. service territories, so the legal gate has something to gate on
--
-- COORDINATES were resolved with the US Census geocoder (public domain, keyless,
-- no cache-retention limit — the reason it is the default provider). It matched
-- 15/20 addresses at street level. It has no locality fallback: a city+state
-- query returns no match at all, so the 5 vendors below are deliberately left
-- NULL for the Google fallback in the ingest pipeline rather than being given
-- invented approximate coordinates. A vendor with no pin is honest; a vendor
-- pinned to the wrong place is not.
--
-- TERRITORIES are derived from statesOrRegionsServed in
-- apps/web/src/data/providerData.ts, the same source the vendor_catalogue seed
-- was generated from. Vendors listed as serving "All 50 states" get a single
-- nationwide row (admin_area_code NULL) rather than 50 rows — the same
-- representation a Turkish DYB holder uses.
--
-- Keyed on the fixed UUIDs from seed/27_vendor_catalogue_seed.sql. Every
-- statement is idempotent, and each is a no-op if that seed was never applied.

-- ===========================================================================
-- 1. Coordinates (US Census, street-level match)
-- ===========================================================================
update vendor_catalogue as v set
  latitude        = c.lat,
  longitude       = c.lng,
  geocode_provider = 'census',
  geocoded_at     = now(),
  verified_at     = now(),
  data_confidence = 1.0
from (values
  ('a1000001-0000-4000-8000-000000000002'::uuid, 32.92442844::decimal(10,8), -96.79491449::decimal(11,8)),   -- Republic National Distributing Company (RNDC)
  ('a1000001-0000-4000-8000-000000000003'::uuid, 34.14876357::decimal(10,8), -118.13245141::decimal(11,8)),   -- Breakthru Beverage Group
  ('a1000001-0000-4000-8000-000000000005'::uuid, 47.60778094::decimal(10,8), -122.33609409::decimal(11,8)),   -- Charmer Sunbelt Group
  ('a1000001-0000-4000-8000-000000000006'::uuid, 42.39438917::decimal(10,8), -71.03938601::decimal(11,8)),   -- Martignetti Companies
  ('a1000001-0000-4000-8000-000000000007'::uuid, 40.60319519::decimal(10,8), -73.99604329::decimal(11,8)),   -- Empire Merchants
  ('a1000001-0000-4000-8000-000000000009'::uuid, 40.38333595::decimal(10,8), -74.50259778::decimal(11,8)),   -- Winebow
  ('a1000001-0000-4000-8000-000000000010'::uuid, 40.74231367::decimal(10,8), -73.98375789::decimal(11,8)),   -- Skurnik Wines & Spirits
  ('a1000001-0000-4000-8000-000000000011'::uuid, 40.75449116::decimal(10,8), -73.98902938::decimal(11,8)),   -- Kobrand Corporation
  ('a1000001-0000-4000-8000-000000000012'::uuid, 42.28590689::decimal(10,8), -87.85207135::decimal(11,8)),   -- Terlato Wine Group
  ('a1000001-0000-4000-8000-000000000013'::uuid, 34.09865860::decimal(10,8), -118.32958256::decimal(11,8)),   -- Frederick Wildman & Sons
  ('a1000001-0000-4000-8000-000000000014'::uuid, 40.81422394::decimal(10,8), -74.21970107::decimal(11,8)),   -- Polaner Selections
  ('a1000001-0000-4000-8000-000000000015'::uuid, 40.78609754::decimal(10,8), -73.95066918::decimal(11,8)),   -- Dreyfus, Ashby & Co.
  ('a1000001-0000-4000-8000-000000000017'::uuid, 40.82595162::decimal(10,8), -74.06650676::decimal(11,8)),   -- Palm Bay International
  ('a1000001-0000-4000-8000-000000000019'::uuid, 38.62947788::decimal(10,8), -90.18847435::decimal(11,8)),   -- A. Bommarito Wines
  ('a1000001-0000-4000-8000-000000000020'::uuid, 47.60443292::decimal(10,8), -122.32996060::decimal(11,8))    -- Henry Wine Group
) as c(id, lat, lng)
where v.id = c.id;

-- Awaiting the Google fallback in distributor.geocode_pending:
--   Southern Glazer's Wine & Spirits (no_match)
--   Young's Market Company (no_match)
--   Northwestern Distributing (no_address)
--   Banfi Vintners (no_match)
--   Europvin USA (no_address)

-- ===========================================================================
-- 2. Territories — nationwide (US)
-- ===========================================================================
insert into vendor_service_territories (vendor_id, country, admin_area_code, license_type, source)
select id, 'US', null, 'curated', 'curated'
from (values
  ('a1000001-0000-4000-8000-000000000001'::uuid),   -- Southern Glazer's Wine & Spirits
  ('a1000001-0000-4000-8000-000000000011'::uuid),   -- Kobrand Corporation
  ('a1000001-0000-4000-8000-000000000012'::uuid),   -- Terlato Wine Group
  ('a1000001-0000-4000-8000-000000000016'::uuid),   -- Banfi Vintners
  ('a1000001-0000-4000-8000-000000000017'::uuid)    -- Palm Bay International
) as t(id)
where exists (select 1 from vendor_catalogue v where v.id = t.id)
on conflict do nothing;

-- ===========================================================================
-- 3. Territories — explicit state lists (US)
-- ===========================================================================
insert into vendor_service_territories (vendor_id, country, admin_area_code, license_type, source)
select t.id, 'US', code, 'curated', 'curated'
from (values
  ('a1000001-0000-4000-8000-000000000002'::uuid, array['AK','AL','AZ','CO','DC','DE','FL','GA','IN','KY','LA','MD','MS','MT','NC','ND','NE','NM','NV','OH','OK','OR','PA','SC','SD','TN','TX','VA','VT','WA','WV','WY']),   -- Republic National Distributing Company (RNDC)
  ('a1000001-0000-4000-8000-000000000003'::uuid, array['AZ','CO','CT','DE','IA','IL','KS','MD','MI','MN','MO','NE','NJ','NV','NY','PA','TX','WI']),   -- Breakthru Beverage Group
  ('a1000001-0000-4000-8000-000000000004'::uuid, array['AK','CA','HI','OR','WA']),   -- Young's Market Company
  ('a1000001-0000-4000-8000-000000000005'::uuid, array['AK','ID','MT','OR','WA','WY']),   -- Charmer Sunbelt Group
  ('a1000001-0000-4000-8000-000000000006'::uuid, array['MA']),   -- Martignetti Companies
  ('a1000001-0000-4000-8000-000000000007'::uuid, array['NY']),   -- Empire Merchants
  ('a1000001-0000-4000-8000-000000000008'::uuid, array['OR','WA']),   -- Northwestern Distributing
  ('a1000001-0000-4000-8000-000000000009'::uuid, array['AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','IA','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','NC','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','TN','TX','VA','VT','WA','WI','WV']),   -- Winebow
  ('a1000001-0000-4000-8000-000000000010'::uuid, array['CA','CO','CT','DC','DE','FL','GA','IL','MA','MD','ME','NC','NH','NJ','NY','OR','PA','RI','VA','VT','WA']),   -- Skurnik Wines & Spirits
  ('a1000001-0000-4000-8000-000000000013'::uuid, array['AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','IA','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','NC','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','TN','TX','VA','VT','WA','WI','WV']),   -- Frederick Wildman & Sons
  ('a1000001-0000-4000-8000-000000000014'::uuid, array['CT','DC','DE','MA','MD','ME','NH','NJ','NY','PA','RI','VA','VT']),   -- Polaner Selections
  ('a1000001-0000-4000-8000-000000000015'::uuid, array['AK','AL','AR','AZ','CA','CO','CT','DC','DE','FL','GA','HI','IA','ID','IL','IN','KS','KY','LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA','WI','WV','WY']),   -- Dreyfus, Ashby & Co.
  ('a1000001-0000-4000-8000-000000000018'::uuid, array['CA','CT','DC','FL','IL','MA','NJ','NY','PA','TX']),   -- Europvin USA
  ('a1000001-0000-4000-8000-000000000019'::uuid, array['IA','IL','IN','KS','MO','NE']),   -- A. Bommarito Wines
  ('a1000001-0000-4000-8000-000000000020'::uuid, array['AK','OR','WA'])    -- Henry Wine Group
) as t(id, codes)
cross join lateral unnest(t.codes) as code
where exists (select 1 from vendor_catalogue v where v.id = t.id)
on conflict do nothing;

-- ===========================================================================
-- 4. Territories — non-US coverage declared in the source data
-- ===========================================================================
insert into vendor_service_territories (vendor_id, country, admin_area_code, license_type, source)
select id, country, null, 'curated', 'curated'
from (values
  ('a1000001-0000-4000-8000-000000000001'::uuid, 'CA')    -- Southern Glazer's Wine & Spirits
) as t(id, country)
where exists (select 1 from vendor_catalogue v where v.id = t.id)
on conflict do nothing;
