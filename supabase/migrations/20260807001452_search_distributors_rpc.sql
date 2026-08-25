-- Distributor Discovery — the read path
--
-- One function backs GET /distributors/search. It is called with .rpc() from
-- apps/api-gateway/src/distributor-discovery, the established route for
-- queries that need real SQL (cf. inventory-ledger.service.ts).
--
-- TWO ORIGINS, DELIBERATELY SEPARATE:
--   * the TERRITORY GATE is always keyed to the RESTAURANT's jurisdiction.
--     Panning the map does not change who may legally sell to you.
--   * DISTANCE and the viewport are keyed to wherever the map is looking,
--     which is why p_origin_* is separate from p_restaurant_id.
-- Conflating the two would let a user "discover" vendors by panning to a state
-- they cannot buy from.
--
-- DISTANCE IS TO THE NEAREST SERVING LOCATION, NOT THE HQ.
-- This is not a refinement, it is a correctness fix. Breakthru Beverage Group
-- is headquartered in Pasadena CA and licensed in New York; measured from its
-- HQ it looks 3,932 km from a Manhattan restaurant, which would bury a vendor
-- that in practice ships from a New York warehouse. So distance prefers the
-- nearest vendor_locations row and falls back to the catalogue HQ point only
-- when no location is known -- and says so via distance_is_hq, so the UI can
-- be honest rather than quietly misleading.

create or replace function search_distributors(
  p_restaurant_id   uuid,
  p_origin_lat      double precision default null,   -- defaults to the restaurant
  p_origin_lng      double precision default null,
  p_radius_m        integer          default null,   -- null = no distance limit
  p_bbox_min_lng    double precision default null,   -- map viewport
  p_bbox_min_lat    double precision default null,
  p_bbox_max_lng    double precision default null,
  p_bbox_max_lat    double precision default null,
  p_territory_only  boolean          default true,
  p_types           text[]           default null,
  p_facets          jsonb            default null,   -- {"region":["burgundy"],...}
  p_q               text             default null,
  p_sort            text             default 'distance',
  p_limit           integer          default 50,
  p_offset          integer          default 0
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
    -- Nearest known location for this vendor; NULL when none are on file.
    loc.kind                                                as loc_kind,
    loc.geog                                                as loc_geog,
    terr.admin_area_code                                    as terr_area,
    terr.vendor_id is not null                              as can_serve
  from vendor_catalogue v
  cross join r
  -- Best territory row proving this vendor may serve the restaurant.
  -- A specific admin-area licence is reported in preference to a nationwide
  -- one so the UI can show "NY" rather than the vaguer "nationwide".
  left join lateral (
    select t.vendor_id, t.admin_area_code
    from vendor_service_territories t
    where t.vendor_id = v.id
      and t.country = r.country
      and (t.admin_area_code is null or t.admin_area_code = r.admin_area)
      and (t.valid_until is null or t.valid_until >= current_date)
    order by (t.admin_area_code is null)      -- false (specific) sorts first
    limit 1
  ) terr on true
  left join lateral (
    select l.kind, l.geog
    from vendor_locations l
    where l.vendor_id = v.id and l.geog is not null
    order by l.geog <-> r.origin              -- GIST-backed nearest-neighbour
    limit 1
  ) loc on true
  where v.is_active = true
    and (not p_territory_only or terr.vendor_id is not null)
    and (p_types is null or v.type = any (p_types))
    and (
      p_q is null or p_q = ''
      or v.name             ilike '%' || p_q || '%'
      or v.wine_specialties ilike '%' || p_q || '%'
    )
    -- AND across facet kinds, OR within a kind: the vendor must match every
    -- requested kind by at least one of that kind's values.
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
    -- Vendors with no coordinates are kept unless the user constrained space;
    -- an ungeocoded vendor is unknown-distance, not far away.
    (
      p_radius_m is null
      or (d.dist is not null and d.dist <= p_radius_m)
    )
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
  f.verified_at,
  count(*) over ()                                              as total_count
from filtered f
order by
  case when p_sort = 'name'     then f.name end asc nulls last,
  case when p_sort = 'distance' then f.dist end asc nulls last,
  f.name asc
limit  greatest(coalesce(p_limit, 50), 0)
offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function search_distributors is
  'Territory-gated, distance-sorted distributor search. Territory is keyed to the restaurant (legality does not move with the map); distance and viewport are keyed to p_origin_*/p_bbox_*. Distance measures to the nearest vendor_locations row, falling back to the catalogue HQ with distance_is_hq = true.';


-- ===========================================================================
-- Facet counts for the filter rail.
--
-- Counts are computed against the SAME gate as the result set, so a chip never
-- promises results the search will not return. Facet values are read from the
-- denormalized vendor_portfolio_facets rows, so this needs no ontology join --
-- the wine_regions / grape_varieties tables are Python-only today.
-- ===========================================================================
create or replace function search_distributor_facet_counts(
  p_restaurant_id   uuid,
  p_territory_only  boolean default true,
  p_types           text[] default null
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

comment on function search_distributor_facet_counts is
  'Facet chip counts computed against the same territory/type gate as search_distributors, so a chip never promises results the search will not return.';
