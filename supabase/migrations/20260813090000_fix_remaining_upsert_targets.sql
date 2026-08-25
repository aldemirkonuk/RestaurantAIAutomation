-- Two more upsert targets that fail exactly the way menu import did.
--
-- HOW THESE WERE FOUND
--
-- After 20260813020000 fixed master_wine_library, the obvious question was
-- whether the same bug was hiding elsewhere. It is a systematic failure, not a
-- typo: PostgREST turns `.upsert(row, { onConflict: "a,b" })` into
-- `INSERT ... ON CONFLICT (a,b)`, Postgres can only infer that target from a
-- NON-partial unique index, and callers routinely treat a failed upsert as
-- non-fatal. So it fails silently and forever.
--
-- Cross-referencing every onConflict in apps/api-gateway/src against the live
-- schema found three more. Each was then confirmed by running the exact
-- statement PostgREST emits, inside a rolled-back transaction:
--
--   master_wine_library        signature_hash              inferred OK (control)
--   vendor_price_observations  source_ref, content_hash    42P10
--   wine_location_mappings     restaurant_id, wine_id      42P10
--   notification_preferences   user_id                     42P10
--
-- Both tables fixed here hold ZERO rows, which is what a feature looks like
-- when its only write path has never once succeeded.
--
-- notification_preferences is deliberately NOT fixed here — see the end.

-- ---------------------------------------------------------------------------
-- 1. vendor_price_observations — partial unique index, same as the library
-- ---------------------------------------------------------------------------
--
-- Making it non-partial is not a weakening. The predicate was
-- `content_hash IS NOT NULL AND source_ref IS NOT NULL`, and Postgres already
-- treats NULLs as distinct in a unique index, so rows missing either column
-- still never conflict. The only thing that changes is that the index becomes
-- inferrable as an ON CONFLICT target.

DROP INDEX IF EXISTS public.idx_vpo_scrape_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vpo_scrape_dedup
  ON public.vendor_price_observations (source_ref, content_hash);

COMMENT ON INDEX public.idx_vpo_scrape_dedup IS
  'Deliberately NOT partial. A partial unique index cannot be inferred as an '
  'ON CONFLICT target by PostgREST, which made every scrape-dedup upsert fail '
  'with 42P10. NULLs are distinct in a unique index, so the old predicate was '
  'redundant.';

-- ---------------------------------------------------------------------------
-- 2. wine_location_mappings — the unique index the code assumes never existed
-- ---------------------------------------------------------------------------
--
-- StorageLocationsService.assignWineToLocation upserts on
-- (restaurant_id, wine_id), i.e. "a wine occupies one location per restaurant,
-- and re-assigning moves it". That contract is stated by the code and was
-- never backed by an index, so every assignment raised 42P10 and the endpoint
-- returned a 500. The table holds no rows at all.
--
-- Verified before creating: zero duplicate (restaurant_id, wine_id) groups, so
-- this cannot fail on existing data.

CREATE UNIQUE INDEX IF NOT EXISTS uq_wine_location_mappings_restaurant_wine
  ON public.wine_location_mappings (restaurant_id, wine_id);

COMMENT ON INDEX public.uq_wine_location_mappings_restaurant_wine IS
  'Backs assignWineToLocation''s ON CONFLICT (restaurant_id, wine_id). If a '
  'wine ever needs to occupy two locations at once, this index — and that '
  'upsert — are what must change together.';

-- ---------------------------------------------------------------------------
-- 3. notification_preferences — NOT fixed, because it is a product decision
-- ---------------------------------------------------------------------------
--
-- NotificationsService upserts with onConflict: "user_id", but the table's
-- unique index is on (restaurant_id, user_id) and the service never writes
-- restaurant_id at all. The two readings cannot both be satisfied:
--
--   a) Preferences are per user. Add UNIQUE (user_id) — but that FORBIDS a
--      user holding different preferences at two restaurants, which the
--      existing index exists to allow.
--   b) Preferences are per (restaurant, user). Change the service to upsert on
--      (restaurant_id, user_id) — but registerPushSubscription() has no
--      restaurant in scope, and a push subscription is a device token, which
--      is genuinely per-user rather than per-restaurant.
--
-- All three existing rows carry a restaurant_id, which points at (b), but
-- picking silently would either break multi-restaurant users or scatter
-- duplicate rows with a NULL restaurant. Left broken and documented rather
-- than guessed at.
DO $$
BEGIN
  RAISE NOTICE
    'notification_preferences upserts on user_id with no matching unique '
    'index — still returns 42P10. Needs a decision on whether preferences are '
    'per-user or per-(restaurant,user); see this migration.';
END $$;
