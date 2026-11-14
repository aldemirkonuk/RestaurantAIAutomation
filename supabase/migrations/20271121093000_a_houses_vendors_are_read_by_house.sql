-- A house's vendors are read by the house, not by scanning every house's
-- (r41 onboarding gap 6).
--
-- WHY
-- ---
-- Every read of `providers` in the gateway is scoped to one house
-- (`.eq("restaurant_id", ...)`, 61 reads on main), and none of them had an
-- index to use. The only indexes that lead with `restaurant_id` are partial:
--
--   * uq_providers_restaurant_email  (contact_email set, not deleted)
--   * providers_tax_identity_per_restaurant  (tax id set, not deleted)
--
-- so the planner cannot use them for "this house's vendors". The setup read
-- that /house, the rail and Get started make on every load asks
--
--   SELECT created_at FROM providers
--    WHERE restaurant_id = $1 AND deleted_at IS NULL
--    ORDER BY created_at LIMIT 1                    (menus.service.ts)
--
-- and /vendors asks the same house's rows ORDER BY created_at DESC
-- (providers.service.ts listProviders). Both were a sequential scan of the
-- whole table, catalogue rows (restaurant_id NULL) included.
--
-- MEASURED (throwaway Postgres 17, the baseline's providers table and its
-- nine indexes; 500 houses x 40 vendors, 3% soft-deleted, plus 5,000
-- catalogue rows: 25,000 rows, 12 MB heap; VACUUM ANALYZE; house 250):
--
--   read                          before                       after
--   setup read (first vendor)     Seq Scan + top-N sort,       Index Scan, no sort,
--                                 1,553 buffers, 0.0070 s      3 buffers, 0.00002 s
--   /vendors list                 Seq Scan + sort,             Bitmap Index Scan,
--                                 1,550 buffers, 0.0061 s      45 buffers, 0.00003 s
--   id, name by house             Seq Scan, 1,550 buffers      Bitmap Index Scan, 42
--
-- Timings are the mean of 500 runs in one plpgsql loop, on a machine at load
-- average 15-40, so read them as an order of magnitude; buffers do not move.
-- At today's production size (a handful of houses) a scan is a few dozen
-- buffers (measured: 400 rows, 34 buffers), so this is for the platform's
-- growth, not a slow page today. The index is 960 kB at 25,000 rows.
--
-- WHAT
-- ----
-- One btree on (restaurant_id, created_at), NOT partial:
--   * restaurant_id first: every read is per house.
--   * created_at second: the setup read stops at the first row in order, and
--     /vendors reads the same order backwards, with no sort.
--   * not `WHERE deleted_at IS NULL`: several reads (`select id, name ...
--     eq restaurant_id`) do not filter on deleted_at, and a partial index
--     would not serve them. Soft-deleted vendors are few, so the filter on
--     the index scan costs little.
--
-- Not CONCURRENTLY: migrations run in a transaction here, and the table is
-- small enough that the lock is brief.

create index if not exists idx_providers_restaurant_created
  on public.providers (restaurant_id, created_at);

comment on index public.idx_providers_restaurant_created is
  'r41 onboarding gap 6: every gateway read of providers is per house; the setup read takes the first by created_at and /vendors lists by created_at desc.';
