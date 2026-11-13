-- The activity timeline (/logs) dates a closed POS check by its close and now
-- pages closed checks on closed_at (logs-timeline.service.ts, fetchPosChecks).
-- The only house-scoped index on pos_checks was (restaurant_id, opened_at), so
-- that read sorted every check the house ever closed to find the newest page.
-- This partial index serves it directly; open checks keep the opened_at index.
--
-- Plain CREATE INDEX, not CONCURRENTLY: migrations run inside a transaction.
CREATE INDEX IF NOT EXISTS idx_pos_checks_restaurant_closed
  ON public.pos_checks USING btree (restaurant_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
