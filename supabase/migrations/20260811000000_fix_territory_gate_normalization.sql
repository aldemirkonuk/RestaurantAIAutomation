-- Distributor Discovery — fix the territory gate's format mismatch
--
-- search_distributors compares restaurants.country/state_province against
-- vendor_service_territories.country/admin_area_code with plain '='.
-- vendor_service_territories stores ISO country codes and 2-letter US state
-- codes ('US', 'IL', 'MI', ...) — see the backfill and Turkey-seed migrations.
-- restaurants.country/state_province store whatever
-- apps/web/src/components/ui/PlacesAutocomplete.tsx's parseAddressComponents
-- returns, which is Google's address-component .longText: "United States",
-- "Illinois". "United States" = 'US' is false, always — so the territory
-- gate has never matched a single real restaurant against a single real US
-- vendor. Every search with territoryOnly=true (the default) returns nothing
-- suppliable, regardless of how well a vendor's territory actually covers the
-- restaurant. This is what surfaced as "it says cannot supply me" for a
-- vendor (Breakthru Beverage Group) whose territory list plainly includes the
-- restaurant's state.
--
-- Fixed by normalizing both sides AT MATCH TIME inside the RPC, not by
-- rewriting restaurants.country/state_province. Those columns are read
-- elsewhere as human-readable display text (e.g. the registration flow,
-- profile pages), and a values migration would only fix restaurants that
-- exist today — new signups would immediately regress until every future
-- write path was also found and fixed. Normalizing in the one function that
-- does the comparison fixes every restaurant, past and future, in one place.
--
-- The lookup lists mirror two tables that already exist in the frontend:
--   COUNTRY_ISO in apps/web/src/components/ui/PlacesAutocomplete.tsx
--   US_STATES   in apps/web/src/pages/distributors/command/customProvider.ts
-- (the latter already solves the identical problem for the state FILTER
-- chips, reading a custom provider's flat address string). Kept as separate
-- SQL functions rather than a shared import because there is no shared code
-- path between TypeScript and this database.
--
-- UNKNOWN INPUT RETURNS AS-IS (uppercased/trimmed), not NULL and not a
-- guess. A restaurant outside these lists (a country or state the ingest
-- pipeline has no territories for yet) simply continues to not match, which
-- is the same "no data for this" outcome the gate already had for every
-- restaurant before this fix — never worse, and never a false positive.

create or replace function normalize_country_code(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or trim(p) = '' then null
    when length(trim(p)) = 2 then upper(trim(p))
    else coalesce(
      (select code from (values
('Afghanistan', 'AF'),
  ('Albania', 'AL'),
  ('Algeria', 'DZ'),
  ('Argentina', 'AR'),
  ('Armenia', 'AM'),
  ('Australia', 'AU'),
  ('Austria', 'AT'),
  ('Azerbaijan', 'AZ'),
  ('Bahrain', 'BH'),
  ('Bangladesh', 'BD'),
  ('Belarus', 'BY'),
  ('Belgium', 'BE'),
  ('Bolivia', 'BO'),
  ('Bosnia and Herzegovina', 'BA'),
  ('Brazil', 'BR'),
  ('Bulgaria', 'BG'),
  ('Cambodia', 'KH'),
  ('Canada', 'CA'),
  ('Chile', 'CL'),
  ('China', 'CN'),
  ('Colombia', 'CO'),
  ('Croatia', 'HR'),
  ('Cuba', 'CU'),
  ('Cyprus', 'CY'),
  ('Czech Republic', 'CZ'),
  ('Denmark', 'DK'),
  ('Dominican Republic', 'DO'),
  ('Ecuador', 'EC'),
  ('Egypt', 'EG'),
  ('Estonia', 'EE'),
  ('Ethiopia', 'ET'),
  ('Finland', 'FI'),
  ('France', 'FR'),
  ('Georgia', 'GE'),
  ('Germany', 'DE'),
  ('Ghana', 'GH'),
  ('Greece', 'GR'),
  ('Guatemala', 'GT'),
  ('Honduras', 'HN'),
  ('Hungary', 'HU'),
  ('Iceland', 'IS'),
  ('India', 'IN'),
  ('Indonesia', 'ID'),
  ('Iran', 'IR'),
  ('Iraq', 'IQ'),
  ('Ireland', 'IE'),
  ('Israel', 'IL'),
  ('Italy', 'IT'),
  ('Jamaica', 'JM'),
  ('Japan', 'JP'),
  ('Jordan', 'JO'),
  ('Kazakhstan', 'KZ'),
  ('Kenya', 'KE'),
  ('Kuwait', 'KW'),
  ('Latvia', 'LV'),
  ('Lebanon', 'LB'),
  ('Libya', 'LY'),
  ('Lithuania', 'LT'),
  ('Luxembourg', 'LU'),
  ('Malaysia', 'MY'),
  ('Malta', 'MT'),
  ('Mexico', 'MX'),
  ('Moldova', 'MD'),
  ('Morocco', 'MA'),
  ('Myanmar', 'MM'),
  ('Nepal', 'NP'),
  ('Netherlands', 'NL'),
  ('New Zealand', 'NZ'),
  ('Nicaragua', 'NI'),
  ('Nigeria', 'NG'),
  ('North Macedonia', 'MK'),
  ('Norway', 'NO'),
  ('Oman', 'OM'),
  ('Pakistan', 'PK'),
  ('Panama', 'PA'),
  ('Paraguay', 'PY'),
  ('Peru', 'PE'),
  ('Philippines', 'PH'),
  ('Poland', 'PL'),
  ('Portugal', 'PT'),
  ('Qatar', 'QA'),
  ('Romania', 'RO'),
  ('Russia', 'RU'),
  ('Saudi Arabia', 'SA'),
  ('Senegal', 'SN'),
  ('Serbia', 'RS'),
  ('Singapore', 'SG'),
  ('Slovakia', 'SK'),
  ('Slovenia', 'SI'),
  ('South Africa', 'ZA'),
  ('South Korea', 'KR'),
  ('Spain', 'ES'),
  ('Sri Lanka', 'LK'),
  ('Sudan', 'SD'),
  ('Sweden', 'SE'),
  ('Switzerland', 'CH'),
  ('Syria', 'SY'),
  ('Taiwan', 'TW'),
  ('Tanzania', 'TZ'),
  ('Thailand', 'TH'),
  ('Tunisia', 'TN'),
  ('Turkey', 'TR'),
  ('Uganda', 'UG'),
  ('Ukraine', 'UA'),
  ('United Arab Emirates', 'AE'),
  ('United Kingdom', 'GB'),
  ('United States', 'US'),
  ('Uruguay', 'UY'),
  ('Uzbekistan', 'UZ'),
  ('Venezuela', 'VE'),
  ('Vietnam', 'VN'),
  ('Yemen', 'YE'),
  ('Zimbabwe', 'ZW')
      ) as t(name, code) where lower(t.name) = lower(trim(p))),
      upper(trim(p))
    )
  end;
$$;

comment on function normalize_country_code is
  'Maps a Places-style full country name ("United States") to its ISO 3166-1 alpha-2 code ("US"). Already-coded or unrecognised input passes through uppercased/trimmed rather than becoming NULL, so an unmatched value fails a territory comparison the same way it did before this function existed.';

create or replace function normalize_us_state_code(p text)
returns text
language sql
immutable
as $$
  select case
    when p is null or trim(p) = '' then null
    when length(trim(p)) = 2 then upper(trim(p))
    else (select code from (values
('alabama', 'AL'),
  ('alaska', 'AK'),
  ('arizona', 'AZ'),
  ('arkansas', 'AR'),
  ('california', 'CA'),
  ('colorado', 'CO'),
  ('connecticut', 'CT'),
  ('delaware', 'DE'),
  ('florida', 'FL'),
  ('georgia', 'GA'),
  ('hawaii', 'HI'),
  ('idaho', 'ID'),
  ('illinois', 'IL'),
  ('indiana', 'IN'),
  ('iowa', 'IA'),
  ('kansas', 'KS'),
  ('kentucky', 'KY'),
  ('louisiana', 'LA'),
  ('maine', 'ME'),
  ('maryland', 'MD'),
  ('massachusetts', 'MA'),
  ('michigan', 'MI'),
  ('minnesota', 'MN'),
  ('mississippi', 'MS'),
  ('missouri', 'MO'),
  ('montana', 'MT'),
  ('nebraska', 'NE'),
  ('nevada', 'NV'),
  ('new hampshire', 'NH'),
  ('new jersey', 'NJ'),
  ('new mexico', 'NM'),
  ('new york', 'NY'),
  ('north carolina', 'NC'),
  ('north dakota', 'ND'),
  ('ohio', 'OH'),
  ('oklahoma', 'OK'),
  ('oregon', 'OR'),
  ('pennsylvania', 'PA'),
  ('rhode island', 'RI'),
  ('south carolina', 'SC'),
  ('south dakota', 'SD'),
  ('tennessee', 'TN'),
  ('texas', 'TX'),
  ('utah', 'UT'),
  ('vermont', 'VT'),
  ('virginia', 'VA'),
  ('washington', 'WA'),
  ('west virginia', 'WV'),
  ('wisconsin', 'WI'),
  ('wyoming', 'WY'),
  ('district of columbia', 'DC')
      ) as t(name, code) where lower(t.name) = lower(trim(p)))
  end;
$$;

comment on function normalize_us_state_code is
  'Maps a Places-style full US state name ("Illinois") to its 2-letter code ("IL"). Returns NULL, not a guess, for anything unrecognised — deliberately different from normalize_country_code, because a non-US admin_area_code column already means "unknown/nationwide" throughout this schema (see vendor_service_territories.admin_area_code), so NULL here is the correct honest value rather than a passthrough that could accidentally equal a real code.';

-- ===========================================================================
-- Re-point both search functions at the normalized restaurant columns.
-- Everything else is byte-for-byte identical to
-- 20260807001652_vendor_listing_tier.sql — only the two lines building r.country
-- and r.admin_area change.
-- ===========================================================================
create or replace function search_distributors(
  p_restaurant_id   uuid,
  p_origin_lat      double precision default null,
  p_origin_lng      double precision default null,
  p_radius_m        integer          default null,
  p_bbox_min_lng    double precision default null,
  p_bbox_min_lat    double precision default null,
  p_bbox_max_lng    double precision default null,
  p_bbox_max_lat    double precision default null,
  p_territory_only  boolean          default true,
  p_types           text[]           default null,
  p_facets          jsonb            default null,
  p_q               text             default null,
  p_sort            text             default 'distance',
  p_limit           integer          default 50,
  p_offset          integer          default 0,
  p_tiers           text[]           default null
)
returns table (
  id                     uuid,
  name                   text,
  type                   text,
  city                   text,
  state                  text,
  country                text,
  website                text,
  wine_specialties       text,
  latitude               numeric,
  longitude              numeric,
  distance_m             double precision,
  distance_is_hq         boolean,
  nearest_location_kind  text,
  may_serve              boolean,
  serves_via             text,
  listing_tier           text,
  data_confidence        numeric,
  verified_at            timestamptz,
  total_count            bigint
)
language sql
stable
security invoker
set search_path = public
as $$
with r as (
  select
    rest.id,
    normalize_country_code(rest.country)                    as country,
    normalize_us_state_code(rest.state_province)             as admin_area,
    coalesce(
      case
        when p_origin_lat is not null and p_origin_lng is not null
        then st_setsrid(st_makepoint(p_origin_lng, p_origin_lat), 4326)::geography
      end,
      rest.geog
    )                                                       as origin
  from restaurants rest
  where rest.id = p_restaurant_id
),
matched as (
  select
    v.*,
    loc.kind                                                as loc_kind,
    loc.geog                                                as loc_geog,
    terr.admin_area_code                                    as terr_area,
    terr.vendor_id is not null                              as can_serve
  from vendor_catalogue v
  cross join r
  left join lateral (
    select t.vendor_id, t.admin_area_code
    from vendor_service_territories t
    where t.vendor_id = v.id
      and t.country = r.country
      and (t.admin_area_code is null or t.admin_area_code = r.admin_area)
      and (t.valid_until is null or t.valid_until >= current_date)
    order by (t.admin_area_code is null)
    limit 1
  ) terr on true
  left join lateral (
    select l.kind, l.geog
    from vendor_locations l
    where l.vendor_id = v.id and l.geog is not null
    order by l.geog <-> r.origin
    limit 1
  ) loc on true
  where v.is_active = true
    and (not p_territory_only or terr.vendor_id is not null)
    and (p_types is null or v.type = any (p_types))
    and (p_tiers is null or v.listing_tier = any (p_tiers))
    and (
      p_q is null or p_q = ''
      or v.name             ilike '%' || p_q || '%'
      or v.wine_specialties ilike '%' || p_q || '%'
    )
    and (
      p_facets is null
      or not exists (
        select 1
        from jsonb_each(p_facets) as req(kind, vals)
        where not exists (
          select 1 from vendor_portfolio_facets vf
          where vf.vendor_id = v.id
            and vf.facet_kind = req.kind
            and vf.facet_slug in (select jsonb_array_elements_text(req.vals))
        )
      )
    )
),
measured as (
  select
    m.*,
    coalesce(m.loc_geog, m.geog)                                as measure_geog,
    m.loc_geog is null                                          as is_hq,
    case
      when coalesce(m.loc_geog, m.geog) is not null
      then st_distance(r.origin, coalesce(m.loc_geog, m.geog))
    end                                                         as dist
  from matched m cross join r
),
filtered as (
  select * from measured d
  where
    (p_radius_m is null or (d.dist is not null and d.dist <= p_radius_m))
    and (
      p_bbox_min_lng is null
      or (
        d.measure_geog is not null
        and st_intersects(
          d.measure_geog,
          st_makeenvelope(p_bbox_min_lng, p_bbox_min_lat,
                          p_bbox_max_lng, p_bbox_max_lat, 4326)::geography
        )
      )
    )
)
select
  f.id, f.name, f.type, f.city, f.state, f.country, f.website, f.wine_specialties,
  f.latitude, f.longitude,
  f.dist                                                        as distance_m,
  f.is_hq                                                       as distance_is_hq,
  f.loc_kind                                                    as nearest_location_kind,
  f.can_serve                                                   as may_serve,
  case
    when not f.can_serve       then null
    when f.terr_area is null   then 'nationwide'
    else f.terr_area
  end                                                           as serves_via,
  f.listing_tier,
  f.data_confidence,
  f.verified_at,
  count(*) over ()                                              as total_count
from filtered f
order by
  case when p_sort = 'name'     then f.name end asc nulls last,
  case when p_sort = 'distance' then f.dist end asc nulls last,
  case f.listing_tier when 'curated' then 0 when 'user_submitted' then 1 else 2 end,
  f.name asc
limit  greatest(coalesce(p_limit, 50), 0)
offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function search_distributors(
  uuid, double precision, double precision, integer,
  double precision, double precision, double precision, double precision,
  boolean, text[], jsonb, text, text, integer, integer, text[]
) is
  'Territory-gated, distance-sorted distributor search. Territory is keyed to the restaurant (legality does not move with the map); distance and viewport are keyed to p_origin_*/p_bbox_*. Distance measures to the nearest vendor_locations row, falling back to the catalogue HQ with distance_is_hq = true. listing_tier is returned so unverified registry rows can be labelled, and breaks ordering ties in favour of curated. Restaurant country/state are normalized via normalize_country_code/normalize_us_state_code before comparison — see 20260811000000_fix_territory_gate_normalization.sql for why.';

-- 20260728100200_search_distributors_rpc.sql created a 3-arg overload of this
-- function (no p_tiers); 20260728100400_vendor_listing_tier.sql then did
-- `create or replace` with a 4th parameter, which — since the signature
-- changed — created a SECOND overload instead of replacing the first (that
-- migration correctly `drop function if exists`-ed the old search_distributors
-- signature before its own create-or-replace, but missed doing the same here).
-- Both therefore exist right now. Drop the stale 3-arg one before replacing
-- the 4-arg one, or any unqualified reference to this name (including the
-- `comment on function` below) is ambiguous between the two.
drop function if exists search_distributor_facet_counts(uuid, boolean, text[]);

create or replace function search_distributor_facet_counts(
  p_restaurant_id   uuid,
  p_territory_only  boolean default true,
  p_types           text[] default null,
  p_tiers           text[] default null
)
returns table (
  facet_kind  text,
  facet_slug  text,
  facet_value text,
  vendors     bigint
)
language sql
stable
security invoker
set search_path = public
as $$
with r as (
  select
    normalize_country_code(rest.country)        as country,
    normalize_us_state_code(rest.state_province)  as admin_area
  from restaurants rest where rest.id = p_restaurant_id
),
eligible as (
  select v.id
  from vendor_catalogue v cross join r
  where v.is_active = true
    and (p_types is null or v.type = any (p_types))
    and (p_tiers is null or v.listing_tier = any (p_tiers))
    and (
      not p_territory_only
      or exists (
        select 1 from vendor_service_territories t
        where t.vendor_id = v.id
          and t.country = r.country
          and (t.admin_area_code is null or t.admin_area_code = r.admin_area)
          and (t.valid_until is null or t.valid_until >= current_date)
      )
    )
)
select vf.facet_kind, vf.facet_slug, min(vf.facet_value) as facet_value, count(distinct vf.vendor_id) as vendors
from vendor_portfolio_facets vf
join eligible e on e.id = vf.vendor_id
group by vf.facet_kind, vf.facet_slug
order by vf.facet_kind, count(distinct vf.vendor_id) desc, min(vf.facet_value);
$$;

comment on function search_distributor_facet_counts(uuid, boolean, text[], text[]) is
  'Facet chip counts computed against the same territory/type gate as search_distributors, so a chip never promises results the search will not return. Same normalization as search_distributors.';
