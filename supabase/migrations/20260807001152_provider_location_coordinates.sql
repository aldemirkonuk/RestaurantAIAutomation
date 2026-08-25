-- Coordinates for provider locations.
--
-- Closes the loop opened in a23220f: PlacesAutocomplete now returns lat/lng
-- from the fetchFields call it already makes, so the address a user types when
-- adding a custom provider can be stored as a point rather than a string.
--
-- Why this table and not `providers`
-- ----------------------------------
-- A provider can have several sites — an office, a warehouse, a pickup depot —
-- and only the one nearest the restaurant matters for "who can actually serve
-- me". Hanging a single lat/lng off `providers` would force a choice of which
-- site is "the" location and make multi-site vendors unrepresentable.
--
-- Three constraints worth their weight
-- ------------------------------------
-- coords_paired: a row with a latitude and no longitude is not a partial
-- answer, it is a corrupt one. Half a coordinate cannot be plotted, cannot be
-- distance-ranked, and reads as present to any `IS NOT NULL` check.
--
-- The range checks catch the classic transposition — passing (lng, lat)
-- instead of (lat, lng). Longitudes beyond ±90 are common in the US, so a
-- swapped pair fails loudly here instead of silently placing a New York
-- distributor in the Indian Ocean.
--
-- geocode_source records where the point came from. When these later feed
-- distance ranking, "the user typed it" and "Google resolved it" deserve
-- different trust, and that is impossible to reconstruct afterwards.

ALTER TABLE public.provider_locations
  ADD COLUMN latitude numeric,
  ADD COLUMN longitude numeric,
  ADD COLUMN geocoded_at timestamp with time zone,
  ADD COLUMN geocode_source text;

ALTER TABLE public.provider_locations
  ADD CONSTRAINT provider_locations_latitude_range
    CHECK (latitude IS NULL OR (latitude BETWEEN -90 AND 90)),
  ADD CONSTRAINT provider_locations_longitude_range
    CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180)),
  ADD CONSTRAINT provider_locations_coords_paired
    CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT provider_locations_geocode_source_check
    CHECK (geocode_source IS NULL OR geocode_source IN ('google_places', 'manual', 'import'));

-- "which of my providers can I put on a map" — the only query that cares.
CREATE INDEX idx_provider_locations_geocoded
  ON public.provider_locations (restaurant_id)
  WHERE latitude IS NOT NULL;

COMMENT ON COLUMN public.provider_locations.latitude IS
  'Resolved when the address was picked from Places autocomplete. NULL means not geocoded — never 0, which is a real point in the Gulf of Guinea.';
