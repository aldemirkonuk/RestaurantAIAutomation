-- Distributor Discovery — data-quality corrections to the curated 20
--
-- Building the map surfaced that seed/27_vendor_catalogue_seed.sql (and the
-- apps/web/src/data/providerData.ts it was generated from) is not as "verified"
-- as its header claims. The US Census geocoder failed on 5 of 20 addresses, and
-- checking each failure against public sources found three distinct problems:
-- a fabricated address, a company absorbed by a competitor in 2022, and a
-- company that does not appear to exist.
--
-- This matters more than tidiness. The whole point of the feature is to hand a
-- restaurant manager a distributor they can actually call. A vendor that was
-- acquired three years ago, or never existed, is worse than no result at all --
-- it burns the manager's time and their trust in the tool the first time they
-- use it. Phase 3 replaces this hand-curated set with the TTB permit registry
-- precisely so correctness stops depending on someone's manual list.
--
-- Everything here is reversible: nothing is deleted, and the two suppressed
-- vendors are hidden with is_active = false and an explanatory note.
--
-- Coordinates below come from OpenStreetMap/Nominatim (ODbL, permanently
-- storable with attribution) rather than Google, whose terms restrict storing
-- geocoding content. Attribution: (c) OpenStreetMap contributors.

-- ===========================================================================
-- 1. Southern Glazer's — seeded address does not exist
--    Seed said "4300 Alcoa Avenue, Fort Lauderdale, FL 33309", which no
--    geocoder resolves. Public sources place the corporate HQ in Miramar.
-- ===========================================================================
update vendor_catalogue set
  address          = '2400 SW 145th Ave, Suite 200, Miramar, FL 33027',
  city             = 'Miramar',
  latitude         = 25.98673310,
  longitude        = -80.34215950,
  geocode_provider = 'osm',
  geocoded_at      = now(),
  verified_at      = now(),
  data_confidence  = 0.95,
  notes            = coalesce(notes || ' | ', '') ||
    'Address corrected 2026-07-28: seeded Fort Lauderdale address was not resolvable; HQ verified as Miramar FL.'
where id = 'a1000001-0000-4000-8000-000000000001';

-- ===========================================================================
-- 2. Banfi Vintners — seeded address was correct all along
--    Census simply has no record for it. Nominatim resolves it exactly, to the
--    Rynwood estate that is in fact Banfi's Glen Head headquarters.
-- ===========================================================================
update vendor_catalogue set
  latitude         = 40.83074610,
  longitude        = -73.59576260,
  geocode_provider = 'osm',
  geocoded_at      = now(),
  verified_at      = now(),
  data_confidence  = 1.0
where id = 'a1000001-0000-4000-8000-000000000016';

-- ===========================================================================
-- 3. Young's Market Company — no longer an independent distributor
--    RNDC completed its acquisition on 2022-11-01 and is now sole owner.
--    Its territories (AK, AZ, CA, HI, MT, OR, UT, WA, WY) are served by RNDC,
--    which is already PROV_002 in this catalogue. Suppressed rather than
--    deleted so the history and any existing provider links survive.
-- ===========================================================================
update vendor_catalogue set
  is_active        = false,
  latitude         = 33.67387920,
  longitude        = -117.87861480,
  geocode_provider = 'osm',
  geocoded_at      = now(),
  data_confidence  = 0.30,
  notes            = coalesce(notes || ' | ', '') ||
    'Deactivated 2026-07-28: acquired by RNDC, transaction completed 2022-11-01. Its West Coast territories are now served by RNDC (PROV_002).'
where id = 'a1000001-0000-4000-8000-000000000004';

-- ===========================================================================
-- 4. Northwestern Distributing — cannot be verified to exist
--    Seeded with address "N/A" and no phone. No company under this name is
--    findable; the similarly-named regional distributors (American Northwest
--    Distributors, NW Wine Distributors, Northwest Wine & Spirits) are
--    different businesses. Suppressed pending verification rather than guessed
--    at, because inventing an identity here is exactly the failure mode this
--    feature exists to avoid.
-- ===========================================================================
update vendor_catalogue set
  is_active       = false,
  data_confidence = 0.10,
  notes           = coalesce(notes || ' | ', '') ||
    'Deactivated 2026-07-28: no verifiable company by this name; seeded with no address or phone. Re-enable if confirmed against the TTB permit registry.'
where id = 'a1000001-0000-4000-8000-000000000008';

-- ===========================================================================
-- 5. Europvin USA — real, but no public street address
--    Operates as a division of Golden State Wine Co. Left active because the
--    business is genuine; simply has no coordinates, so it appears in list
--    results without a map pin until the ingest pipeline resolves one.
-- ===========================================================================
update vendor_catalogue set
  data_confidence = 0.60,
  notes           = coalesce(notes || ' | ', '') ||
    'No public street address; operates as a division of Golden State Wine Co. Listed without a map pin until an address is confirmed.'
where id = 'a1000001-0000-4000-8000-000000000018';

-- ===========================================================================
-- 6. Territories follow deactivation
--    Suppressed vendors keep their rows but must never satisfy the gate.
-- ===========================================================================
update vendor_service_territories t set valid_until = current_date - 1
from vendor_catalogue v
where v.id = t.vendor_id
  and v.is_active = false
  and (t.valid_until is null or t.valid_until >= current_date);
