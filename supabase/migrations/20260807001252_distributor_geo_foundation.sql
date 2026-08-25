-- Distributor Discovery — geo & territory foundation
--
-- Backs the /distributors map (apps/web/src/pages/distributors +
-- apps/api-gateway/src/distributor-discovery): find wine distributors near a
-- restaurant that are LEGALLY ABLE to sell to it, filtered by what they carry.
--
-- THE CENTRAL MODELLING DECISION — territory is a gate, distance is a sort.
-- In US three-tier distribution a wholesaler may only sell inside states where
-- it holds a license, so a warehouse 5 miles away can still be unable to serve
-- you; ranking purely by distance would surface vendors the operator cannot buy
-- from. Turkey has no three-tier system — a Dağıtım Yetki Belgesi is issued
-- nationally by the Ministry of Agriculture and Forestry.
--
-- So territory is NOT modelled as "US state". It is (country, admin_area_code)
-- where a NULL admin_area_code means "nationwide within that country". One
-- predicate then serves both markets and any future market slots in without a
-- schema change. This mirrors the reasoning already recorded in
-- 20260507000002_restaurants_location_fields.sql: every country has
-- (postal_code, neighborhood, state_province), just named differently.
--
-- This migration also executes the forward-plan block left at the bottom of
-- that same file (latitude/longitude/google_place_id on restaurants).
--
-- RLS convention, both borrowed rather than invented:
--   * curated tables the browser reads  -> RLS on + FOR SELECT TO authenticated
--     (matches 20260509000001_vendor_catalogue.sql)
--   * staging/ops tables the browser must never touch -> RLS on, no policies
--     (matches 20260720130000_ux_optimizer.sql)
-- The api-gateway holds the service-role key and bypasses RLS either way.

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ===========================================================================
-- 0. Shared updated_at trigger for this feature
-- ===========================================================================
create or replace function update_distributor_discovery_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ===========================================================================
-- 1. Restaurants gain coordinates
--    Origin point for every radius query. Populated from the Google Places
--    selection already captured by apps/web/src/components/ui/PlacesAutocomplete.tsx.
-- ===========================================================================
alter table restaurants add column if not exists latitude  decimal(10, 8);
alter table restaurants add column if not exists longitude decimal(11, 8);
alter table restaurants add column if not exists google_place_id varchar(100);

-- geog is DERIVED, never written directly — lat/lng stay the single source of
-- truth so the two representations cannot drift apart.
alter table restaurants add column if not exists geog geography(Point, 4326)
  generated always as (
    case
      when latitude is not null and longitude is not null
      then st_setsrid(st_makepoint(longitude::float8, latitude::float8), 4326)::geography
    end
  ) stored;

create index if not exists idx_restaurants_geog on restaurants using gist (geog);
create unique index if not exists idx_restaurants_google_place_id
  on restaurants (google_place_id) where google_place_id is not null;

-- ===========================================================================
-- 2. vendor_catalogue gains coordinates + provenance
--    Stays the single canonical vendor identity: providers.catalogue_vendor_id
--    already points here and addProviderFromCatalogue already consumes it.
-- ===========================================================================
alter table vendor_catalogue add column if not exists latitude  decimal(10, 8);
alter table vendor_catalogue add column if not exists longitude decimal(11, 8);
alter table vendor_catalogue add column if not exists geog geography(Point, 4326)
  generated always as (
    case
      when latitude is not null and longitude is not null
      then st_setsrid(st_makepoint(longitude::float8, latitude::float8), 4326)::geography
    end
  ) stored;

-- Where this row came from. 'curated' = the original 20 hand-seeded vendors.
alter table vendor_catalogue add column if not exists source text
  not null default 'curated'
  check (source in ('curated', 'ttb', 'tadb', 'places', 'import'));
alter table vendor_catalogue add column if not exists source_ref text;      -- e.g. TTB permit number
alter table vendor_catalogue add column if not exists portfolio_url text;   -- page the crawler reads
alter table vendor_catalogue add column if not exists verified_at timestamptz;

-- Which geocoder produced latitude/longitude, and when.
-- This is a LICENSING requirement, not bookkeeping. Google Maps Platform terms
-- allow Place IDs to be stored indefinitely but restrict other geocoding
-- content to short-lived caching, whereas US Census (public domain) and
-- OpenStreetMap/Nominatim (ODbL, with attribution) may be stored permanently.
-- Recording the provider is what makes it possible to expire and refresh only
-- the rows that need it.
alter table vendor_catalogue add column if not exists geocode_provider text
  check (geocode_provider is null or geocode_provider in ('census', 'osm', 'google', 'manual'));
alter table vendor_catalogue add column if not exists geocoded_at timestamptz;
alter table vendor_catalogue add column if not exists google_place_id text;
alter table vendor_catalogue add column if not exists data_confidence numeric(3, 2)
  check (data_confidence is null or (data_confidence >= 0 and data_confidence <= 1));

create index if not exists idx_vendor_catalogue_geog on vendor_catalogue using gist (geog);
-- Fuzzy name matching for ingest dedupe (pg_trgm was already installed).
create index if not exists idx_vendor_catalogue_name_trgm
  on vendor_catalogue using gin (name gin_trgm_ops);

-- ===========================================================================
-- 3. Service territories — THE GATE
--    admin_area_code IS NULL means nationwide within that country.
--    US  -> one row per licensed state ('NY', 'NJ', ...)
--    TR  -> one nationwide row (DYB is issued nationally), admin_area_code NULL
-- ===========================================================================
create table if not exists vendor_service_territories (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references vendor_catalogue(id) on delete cascade,
  country           text not null,              -- ISO-3166-1 alpha-2, uppercase
  admin_area_code   text,                       -- NULL = nationwide
  license_type      text,                       -- ttb_basic_permit | state_wholesaler | tr_dyb | curated
  license_id        text,
  valid_until       date,                       -- NULL = no known expiry
  source            text not null default 'curated',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- coalesce() so a nationwide row cannot be inserted twice for one vendor.
create unique index if not exists idx_vendor_territories_unique
  on vendor_service_territories (vendor_id, country, coalesce(admin_area_code, '*'));
create index if not exists idx_vendor_territories_lookup
  on vendor_service_territories (country, admin_area_code);
create index if not exists idx_vendor_territories_vendor
  on vendor_service_territories (vendor_id);

drop trigger if exists trg_vendor_territories_updated_at on vendor_service_territories;
create trigger trg_vendor_territories_updated_at
  before update on vendor_service_territories
  for each row execute function update_distributor_discovery_updated_at();

-- ===========================================================================
-- 4. Vendor locations — global, multi-warehouse
--    DISTINCT from provider_locations, which is restaurant-scoped (a given
--    restaurant's view of a provider it already works with). This table is
--    global catalogue data and is readable before any relationship exists.
-- ===========================================================================
create table if not exists vendor_locations (
  id                uuid primary key default gen_random_uuid(),
  vendor_id         uuid not null references vendor_catalogue(id) on delete cascade,
  kind              text not null default 'office'
                      check (kind in ('office', 'warehouse', 'tasting_room', 'other')),
  name              text,
  address           text,
  city              text,
  admin_area_code   text,
  postal_code       text,
  country           text not null,
  latitude          decimal(10, 8),
  longitude         decimal(11, 8),
  geog              geography(Point, 4326)
                      generated always as (
                        case
                          when latitude is not null and longitude is not null
                          then st_setsrid(st_makepoint(longitude::float8, latitude::float8), 4326)::geography
                        end
                      ) stored,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_vendor_locations_vendor on vendor_locations (vendor_id);
create index if not exists idx_vendor_locations_geog   on vendor_locations using gist (geog);

drop trigger if exists trg_vendor_locations_updated_at on vendor_locations;
create trigger trg_vendor_locations_updated_at
  before update on vendor_locations
  for each row execute function update_distributor_discovery_updated_at();

-- ===========================================================================
-- 5. Portfolio facets — "what are they selling", structured
--    Replaces the single free-text vendor_catalogue.wine_specialties blob for
--    filtering purposes (that column stays as human-readable prose).
--
--    facet_value is the canonical DISPLAY name, resolved at write time by the
--    Python writer against wine_regions / grape_varieties. It is denormalized
--    on purpose: the ontology tables are reachable only from Python today
--    (zero TypeScript references), and the NestJS read path must not need them.
--
--    Provenance columns mirror provider_knowledge, which already carries
--    source/confidence for category='wine_portfolio'.
-- ===========================================================================
create table if not exists vendor_portfolio_facets (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references vendor_catalogue(id) on delete cascade,
  facet_kind    text not null
                  check (facet_kind in ('region', 'country', 'varietal',
                                        'classification', 'price_band',
                                        'certification', 'producer')),
  facet_value   text not null,                  -- canonical display name
  facet_slug    text not null,                  -- normalized filter key
  confidence    numeric(3, 2)
                  check (confidence is null or (confidence >= 0 and confidence <= 1)),
  source_kind   text check (source_kind in ('crawl', 'catalogue_email', 'curated')),
  source_url    text,
  observed_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create unique index if not exists idx_vendor_facets_unique
  on vendor_portfolio_facets (vendor_id, facet_kind, facet_slug);
create index if not exists idx_vendor_facets_lookup
  on vendor_portfolio_facets (facet_kind, facet_slug);
create index if not exists idx_vendor_facets_vendor
  on vendor_portfolio_facets (vendor_id);

-- ===========================================================================
-- 6. Geocode cache — never pay for the same address twice
--    Keyed by a hash of the NORMALIZED address so formatting noise doesn't
--    cause misses. provider records which geocoder answered: 'census' results
--    (US, public domain) may be stored indefinitely, which is why it is the
--    default path and Google is only the fallback.
-- ===========================================================================
create table if not exists geocode_cache (
  address_hash        text primary key,          -- sha256 of normalized_address
  normalized_address  text not null,
  country             text,
  provider            text not null check (provider in ('census', 'osm', 'google', 'manual')),
  latitude            decimal(10, 8),
  longitude           decimal(11, 8),
  precision           text check (precision in ('rooftop', 'street', 'locality', 'admin_area', 'failed')),
  fetched_at          timestamptz not null default now()
);

create index if not exists idx_geocode_cache_fetched on geocode_cache (fetched_at);

-- ===========================================================================
-- 7. Ingest staging — raw registry rows before promotion
--    Schema shape copied from 20260225000000_restaurant_directory.sql
--    (discovery_sources[], *_status CHECK, content_hash, last_crawled_at),
--    which was built for exactly this discover -> geocode -> crawl -> promote
--    workload.
-- ===========================================================================
create table if not exists distributor_directory (
  id                  uuid primary key default gen_random_uuid(),
  legal_name          text not null,
  trade_name          text,
  country             text not null,
  admin_area_code     text,
  city                text,
  address             text,
  postal_code         text,
  phone               text,
  email               text,
  website             text,
  license_type        text,
  license_id          text,                      -- e.g. TTB permit number
  permit_class        text,                      -- wholesaler | importer | ...
  discovery_sources   text[] not null default '{}',
  raw                 jsonb not null default '{}'::jsonb,
  content_hash        text,
  geocode_status      text not null default 'pending'
                        check (geocode_status in ('pending', 'geocoded', 'failed', 'skipped')),
  crawl_status        text not null default 'pending'
                        check (crawl_status in ('pending', 'crawled', 'failed',
                                                'no_portfolio', 'skipped', 'robots_denied')),
  last_crawled_at     timestamptz,
  latitude            decimal(10, 8),
  longitude           decimal(11, 8),
  geog                geography(Point, 4326)
                        generated always as (
                          case
                            when latitude is not null and longitude is not null
                            then st_setsrid(st_makepoint(longitude::float8, latitude::float8), 4326)::geography
                          end
                        ) stored,
  promoted_vendor_id  uuid references vendor_catalogue(id) on delete set null,
  promoted_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Primary dedupe: a license id is unique within its country.
create unique index if not exists idx_distributor_directory_license
  on distributor_directory (country, license_id) where license_id is not null;
-- Fallback dedupe when the registry row carries no license id.
create unique index if not exists idx_distributor_directory_name_city
  on distributor_directory (country, lower(legal_name), lower(coalesce(city, '')))
  where license_id is null;

create index if not exists idx_distributor_directory_geocode on distributor_directory (geocode_status);
create index if not exists idx_distributor_directory_crawl   on distributor_directory (crawl_status);
create index if not exists idx_distributor_directory_geog    on distributor_directory using gist (geog);
create index if not exists idx_distributor_directory_name_trgm
  on distributor_directory using gin (legal_name gin_trgm_ops);

drop trigger if exists trg_distributor_directory_updated_at on distributor_directory;
create trigger trg_distributor_directory_updated_at
  before update on distributor_directory
  for each row execute function update_distributor_discovery_updated_at();

-- ===========================================================================
-- 8. Crawl log — one row per URL fetched, for debugging and robots auditing
-- ===========================================================================
create table if not exists distributor_crawl_log (
  id            uuid primary key default gen_random_uuid(),
  directory_id  uuid references distributor_directory(id) on delete cascade,
  vendor_id     uuid references vendor_catalogue(id) on delete set null,
  url           text not null,
  http_status   integer,
  content_type  text,
  outcome       text check (outcome in ('ok', 'robots_denied', 'fetch_error',
                                        'no_content', 'injection_suspected')),
  bytes         integer,
  content_hash  text,
  error         text,
  crawled_at    timestamptz not null default now()
);

create index if not exists idx_distributor_crawl_log_directory on distributor_crawl_log (directory_id);
create index if not exists idx_distributor_crawl_log_crawled   on distributor_crawl_log (crawled_at desc);

-- ===========================================================================
-- 9. RLS
-- ===========================================================================

-- Curated, browser-readable. Same shape as vendor_catalogue_read.
alter table vendor_service_territories enable row level security;
alter table vendor_locations           enable row level security;
alter table vendor_portfolio_facets    enable row level security;

drop policy if exists vendor_service_territories_read on vendor_service_territories;
create policy vendor_service_territories_read on vendor_service_territories
  for select to authenticated using (true);

drop policy if exists vendor_locations_read on vendor_locations;
create policy vendor_locations_read on vendor_locations
  for select to authenticated using (true);

drop policy if exists vendor_portfolio_facets_read on vendor_portfolio_facets;
create policy vendor_portfolio_facets_read on vendor_portfolio_facets
  for select to authenticated using (true);

-- Staging / ops. RLS on with NO policies = deny-all for anon+authenticated,
-- full access for service-role. The browser must never read these.
alter table geocode_cache          enable row level security;
alter table distributor_directory  enable row level security;
alter table distributor_crawl_log  enable row level security;

-- ===========================================================================
-- 10. Documentation
-- ===========================================================================
comment on table vendor_service_territories is
  'Where a vendor may legally sell. admin_area_code NULL = nationwide within country. US=per-state license, TR=national DYB.';
comment on table vendor_locations is
  'Global vendor offices/warehouses with coordinates. Distinct from restaurant-scoped provider_locations.';
comment on table vendor_portfolio_facets is
  'Structured "what they sell" facets. facet_value is the canonical display name, denormalized so the NestJS read path needs no ontology join.';
comment on table geocode_cache is
  'Address -> coordinate cache. Permanently-storable providers first (census = US public domain, osm = ODbL with attribution); google only where its terms allow, keyed by fetched_at so those rows can be expired.';
comment on table distributor_directory is
  'Raw registry rows (TTB, TR TADB) staged before dedupe and promotion into vendor_catalogue.';
comment on table distributor_crawl_log is
  'One row per portfolio URL fetched, including robots.txt refusals and injection quarantines.';
