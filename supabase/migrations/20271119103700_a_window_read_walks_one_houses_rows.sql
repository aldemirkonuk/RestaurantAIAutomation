-- A window read walks one house's rows, not every house's (r41 /reports gap 3).
--
-- WHY
-- ---
-- `readWholeWindow` (apps/api-gateway/src/common/read-whole-window.ts) pages a
-- window in `id` order: every page is
--
--   SELECT ... WHERE restaurant_id = $house AND <window column> >= $since
--              AND id > $cursor ORDER BY id LIMIT 1000
--
-- plus the exact count of the same filter. No index led with the house and then
-- `id`, so the planner walked the PRIMARY KEY in id order and threw away every
-- other house's row, and every row of this house outside the window, until it
-- had a thousand. Measured on a throwaway database (fixlane-pg, main_tpl at
-- c459b0a12, 20 houses at the one real house's measured volume of 131
-- consumption lines and 58 checks a day, 6 orders a day):
--
--   one mid-window consumption page: Index Scan on wine_consumption_log_pkey,
--   83,286 rows removed by filter, about 82,000 buffers. (Timings are left out:
--   the machine ran at a load average of 50 to 200 while this was measured, so
--   milliseconds moved by 3x between identical runs; buffers did not.)
--
-- The cost of every page grows with every house on the platform, not with this
-- house's window. A /reports load runs five consumption chains and a check
-- chain, besides two order chains (r41 audit, "Request chain").
--
-- WHAT
-- ----
-- One index per window the /reports load pages, keyed (restaurant_id, id) so a
-- page is a range of this house's ids in id order. The window column rides as
-- a third key, so the window filter and the exact count are both answered from
-- the index without visiting a row outside the window:
--
--   * wine_consumption_log (restaurant_id, id, created_at): the consumption
--     chains filter on created_at (advanced-analytics, analytics, goals).
--   * pos_checks (restaurant_id, id, opened_at) WHERE voided = false: the
--     till's check chain filters on opened_at and voided = false
--     (goals.service computeMetricWithSeries; insight-generator and
--     table-analytics read the same shape). Partial, because a voided check is
--     never read by a window, and because a count must test `voided` inside
--     the index to stay index-only (measured: without it the count stayed a
--     6,960-buffer bitmap heap scan).
--
-- And one for the "first record" read (`ORDER BY created_at LIMIT 1` per house),
-- which sorted the house's whole history to find one row:
--
--   * wine_consumption_log (restaurant_id, created_at).
--
-- Measured after (same database, VACUUM ANALYZE), buffers per statement:
--
--   statement                        20 houses before -> after   1 house before -> after
--   consumption 90-day page          81,850 -> 1,033             4,440 -> 1,033
--   consumption 90-day count         16,777 -> 175               16,488 -> 175
--   consumption first line           16,780 -> 4                 16,491 -> 4
--   checks 365-day page              19,143 -> 1,010             1,076 -> 1,010
--   checks 365-day count              6,960 -> 80                6,941 -> 80
--
-- Not added:
--   * procurement_orders (restaurant_id, id): measured, the planner already reads
--     the orders page through idx_procurement_orders_restaurant and a sort
--     (1,294 buffers for a year of one house's orders), and the new index moved
--     it to 879. Orders are a handful a day; not worth a write path.
--   * pos_checks (restaurant_id, closed_at): #1278/#1320 add it for /logs.
--
-- Plain CREATE INDEX (the migration runs in a transaction, so not
-- CONCURRENTLY). On the one real house the tables hold tens of thousands of
-- rows; each build is well under a second.

CREATE INDEX IF NOT EXISTS idx_consumption_house_id_created
  ON public.wine_consumption_log USING btree (restaurant_id, id, created_at);

CREATE INDEX IF NOT EXISTS idx_consumption_house_created
  ON public.wine_consumption_log USING btree (restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pos_checks_house_id_opened
  ON public.pos_checks USING btree (restaurant_id, id, opened_at)
  WHERE voided = false;
