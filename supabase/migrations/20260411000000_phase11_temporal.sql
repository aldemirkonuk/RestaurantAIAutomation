-- ============================================================================
-- PHASE 11: Temporal Menu Intelligence & Analytics Schema
-- ============================================================================
-- Adds: crawl_schedule, restaurant_wine_roster, menu_changes,
--       wine_popularity, trending_wines
-- Backfills: crawl_schedule for all existing restaurant_directory entries
--            with weekly frequency and random 0-7 day jitter (D-04)

-- 1. crawl_schedule (D-04, TEMP-01)
-- Per-restaurant re-crawl schedule. Phase 11 TEMP-01.
CREATE TABLE IF NOT EXISTS crawl_schedule (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id        UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    crawl_frequency      TEXT NOT NULL DEFAULT 'weekly'
                           CHECK (crawl_frequency IN ('weekly', 'biweekly', 'monthly')),
    last_crawled_at      TIMESTAMPTZ,
    next_crawl_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status               TEXT NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active', 'paused', 'error')),
    tier                 VARCHAR(50),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_crawl_schedule_restaurant UNIQUE (restaurant_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_next_crawl ON crawl_schedule (next_crawl_at, status);

COMMENT ON TABLE crawl_schedule IS
'Per-restaurant re-crawl schedule. Phase 11 TEMP-01.';

COMMENT ON COLUMN crawl_schedule.tier IS
'fine_dining|casual|hotel|other — stored for future tiered scheduling; no behavioral effect in Phase 11.';

COMMENT ON COLUMN crawl_schedule.consecutive_failures IS
'Incremented on each failed crawl; status set to error after 3 consecutive failures.';

-- 2. restaurant_wine_roster (D-01, TEMP-03)
-- Current-state snapshot of each restaurant wine list. Used as diff baseline.
CREATE TABLE IF NOT EXISTS restaurant_wine_roster (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id    UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    signature_hash   TEXT NOT NULL,
    wine_name        TEXT,
    price_reference  DECIMAL(10,2),
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_roster_restaurant_hash UNIQUE (restaurant_id, signature_hash)
);

CREATE INDEX IF NOT EXISTS idx_rwr_restaurant ON restaurant_wine_roster (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_rwr_hash ON restaurant_wine_roster (signature_hash);

COMMENT ON TABLE restaurant_wine_roster IS
'Current-state snapshot of each restaurant''s wine list. Used as diff baseline.';

-- 3. menu_changes (D-03, TEMP-04)
-- Full event history of all menu diffs per restaurant.
CREATE TABLE IF NOT EXISTS menu_changes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id       UUID NOT NULL REFERENCES restaurant_directory(id) ON DELETE CASCADE,
    wine_signature_hash TEXT NOT NULL,
    change_type         TEXT NOT NULL CHECK (change_type IN ('added', 'removed', 'price_change')),
    old_value           JSONB,
    new_value           JSONB,
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mc_restaurant ON menu_changes (restaurant_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_hash ON menu_changes (wine_signature_hash, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_change_type ON menu_changes (change_type, detected_at DESC);

COMMENT ON COLUMN menu_changes.old_value IS
'Full wine snapshot: {"wine_name":..., "producer":..., "vintage":..., "price_reference":..., "signature_hash":...}. NULL for added events.';

COMMENT ON COLUMN menu_changes.new_value IS
'Full wine snapshot (same shape as old_value). NULL for removed events.';

-- 4. wine_popularity (D-02, TEMP-05)
-- Nightly-materialized count of distinct restaurants currently carrying each wine.
CREATE TABLE IF NOT EXISTS wine_popularity (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id          UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    restaurant_count INTEGER NOT NULL DEFAULT 0,
    computed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wine_popularity UNIQUE (wine_id)
);

CREATE INDEX IF NOT EXISTS idx_wp_count ON wine_popularity (restaurant_count DESC);

-- 5. trending_wines (D-02, TEMP-06)
-- Velocity-scored trend computation across 30/60/90-day windows.
CREATE TABLE IF NOT EXISTS trending_wines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id                UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    window_days            INTEGER NOT NULL CHECK (window_days IN (30, 60, 90)),
    restaurant_count_start INTEGER NOT NULL DEFAULT 0,
    restaurant_count_end   INTEGER NOT NULL DEFAULT 0,
    delta                  INTEGER NOT NULL DEFAULT 0,
    pct_change             DECIMAL(10,4),
    trend_score            DECIMAL(10,4),
    burst_detected_at      TIMESTAMPTZ,
    computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_trending_wines UNIQUE (wine_id, window_days)
);

CREATE INDEX IF NOT EXISTS idx_tw_score ON trending_wines (trend_score DESC) WHERE window_days = 30;

COMMENT ON COLUMN trending_wines.trend_score IS
'Combined: (delta_30d×3.0) + (delta_60d×1.5) + (delta_90d×1.0) + burst_bonus(+2.0 if ≥3 new restaurants in 14 days). Written to 30d row; other window rows store their own delta/pct_change.';

-- 6. Backfill crawl_schedule for all existing restaurant_directory entries
-- Uses random 0-7 day jitter on next_crawl_at (D-04: thundering herd prevention)
-- ON CONFLICT DO NOTHING ensures idempotency if migration is re-run
INSERT INTO crawl_schedule (restaurant_id, crawl_frequency, next_crawl_at, status)
SELECT
    id,
    'weekly',
    NOW() + (RANDOM() * INTERVAL '7 days'),
    'active'
FROM restaurant_directory
ON CONFLICT (restaurant_id) DO NOTHING;
