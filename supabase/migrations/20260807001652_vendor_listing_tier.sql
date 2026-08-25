-- Distributor Discovery — listing tier
--
-- Phase 3 ingests the TTB permit registry, which is tens of thousands of rows.
-- vendor_catalogue is ALREADY read by the add-provider modal
-- (apps/web/src/components/providers/VendorSearchModal.tsx via
-- /vendor-catalogue/search), which filters only on is_active and country. Left
-- alone, ingest would flood a screen this feature never set out to change: a
-- manager searching for a supplier would get raw federal records instead of
-- twenty vetted ones.
--
-- The fix is the pattern every large directory product converges on: ONE entity
-- table plus an explicit verification tier, rather than a second parallel table.
-- Keeping one identity space means providers.catalogue_vendor_id, the territory,
-- location and facet child tables, and the search RPC all keep working unchanged
-- for both kinds of row.
--
--   curated        -- human-vetted. What the add-provider modal shows by default.
--   registry       -- straight from an official permit registry. Real, but
--                     unverified: may be stale, may not sell wine, may be a
--                     holding company.
--   user_submitted -- entered by a restaurant, not yet reviewed.
--
-- DEFAULT IS 'registry' ON PURPOSE. The safe failure mode is that a row nobody
-- explicitly vetted is treated as unvetted, so an ingest that forgets to set the
-- column cannot silently launder registry data into the curated set.

alter table vendor_catalogue add column if not exists listing_tier text
  not null default 'registry'
  check (listing_tier in ('curated', 'registry', 'user_submitted'));

-- The twenty seeded vendors predate this column and were hand-curated.
update vendor_catalogue set listing_tier = 'curated' where source = 'curated';

-- Supports both the modal's curated-only default and the map's tier filter.
create index if not exists idx_vendor_catalogue_tier
  on vendor_catalogue (listing_tier) where is_active = true;

comment on column vendor_catalogue.listing_tier is
  'Verification tier. curated = human-vetted (default view in the add-provider modal); registry = straight from an official permit registry, unverified; user_submitted = restaurant-entered, unreviewed. Defaults to registry so unvetted rows are never silently treated as curated.';

-- ===========================================================================
-- Search RPC gains tier awareness
--
-- Tier is returned so the UI can badge trust rather than hide it, and is
-- filterable so "verified only" is one toggle. Ordering still puts distance
-- first when the caller asked for distance -- a verified vendor 400 km away is
-- not more useful than an unverified one down the street -- but curated wins
-- ties, which is what surfaces vetted rows when several sit at similar range.
-- ===========================================================================
drop function if exists search_distributors(
  uuid, double precision, double precision, integer,
  double precision, double precision, double precision, double precision,
  boolean, text[], jsonb, text, text, integer, integer);

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
  p_tiers           text[]           default null   -- null = every tier
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
    rest.country                                            as country,
    rest.state_province                                     as admin_area,
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
  -- Curated breaks ties, so vetted rows surface among equals.
  case f.listing_tier when 'curated' then 0 when 'user_submitted' then 1 else 2 end,
  f.name asc
limit  greatest(coalesce(p_limit, 50), 0)
offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function search_distributors is
  'Territory-gated, distance-sorted distributor search. Territory is keyed to the restaurant (legality does not move with the map); distance and viewport are keyed to p_origin_*/p_bbox_*. Distance measures to the nearest vendor_locations row, falling back to the catalogue HQ with distance_is_hq = true. listing_tier is returned so unverified registry rows can be labelled, and breaks ordering ties in favour of curated.';

-- Facet counts must respect the same tier filter or a chip would over-promise.
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
  select rest.country as country, rest.state_province as admin_area
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
