-- Insight rows carry the arithmetic that produced them.
--
-- WHY
-- ---
-- `20260903091000` fixed the generator: a day with no records stopped being a
-- zero, so "Wednesday sales came in 100% lower than your average Wednesday
-- ($0 vs $104)" stopped being produced. That fix corrected every FRESH compute
-- and nothing else. `analytics_insights` is a write-through cache with no
-- freshness and no version check — `InsightGeneratorService.getStored()` reads
-- whatever is in the table, and `GET /analytics/insights/:id` prefers it over
-- a fresh compute — so on 2026-09-03, a day after the fix was on the branch,
-- the running gateway still answered:
--
--     GET /api/v1/analytics/insights/550e8400-…   → "source": "stored"
--     "Tuesday sales came in 100% lower than your average Tuesday ($0 vs $72)."
--
-- computed 2026-09-02T06:00 by the hourly sweep, with the old arithmetic. The
-- same rows also feed `AdvancedAnalyticsService.getOverview` and
-- `GoalsService`'s suggestions, so the retracted sentence had three live
-- readers, not one.
--
-- A cached sentence is a claim about the world made by a version of the code
-- that no longer exists. Time cannot decide whether it is still true — an hour
-- old and correct, a minute old and wrong are both possible — so the row has to
-- say which ARITHMETIC produced it, and the reader has to refuse anything older
-- than its own.
--
-- WHY A COLUMN AND NOT `evidence`
-- -------------------------------
-- `analytics_insights.evidence` is the insight's own payload: it is rendered,
-- and `InsightEvidence` is a typed contract shared with the verbalizer. A
-- provenance stamp is not evidence about the restaurant, and burying it there
-- would make "which code wrote this row" unqueryable without a JSON path — the
-- sweep below has to filter on it across every tenant in one read.
--
-- DEFAULT 0 IS THE POINT
-- ----------------------
-- Every row already in the table predates this column and therefore predates
-- the fix. `default 0` stamps all of them as older than any released version,
-- so they are invisible to `getStored()` from the moment this migration
-- applies and the next read recomputes and replaces them. No backfill, no
-- purge, no deploy hook: the rows correct themselves on first read, and until
-- they do they are withheld rather than served.

alter table analytics_insights
  add column if not exists generator_version integer not null default 0;

comment on column analytics_insights.generator_version is
  'INSIGHT_GENERATOR_VERSION (insight-generator.service.ts) of the code that computed this row. Readers must ignore rows below their own version — a cached sentence produced by superseded arithmetic is not stale data, it is a retracted claim. 0 means "written before this column existed", i.e. before the 2026-09-03 observed-day fix.';

-- The sweep asks "which restaurants still hold rows on an old version?" across
-- every tenant in one read; the reader asks it per restaurant. Both are served
-- by putting the version first after the tenant.
create index if not exists idx_analytics_insights_version
  on analytics_insights (restaurant_id, generator_version);
