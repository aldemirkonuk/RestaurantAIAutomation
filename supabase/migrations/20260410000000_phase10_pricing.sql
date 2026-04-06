-- ============================================================================
-- PHASE 10: Critic Scores & Pricing Intelligence Schema
-- ============================================================================
-- Adds: quality_signals, retail_price_avg, scores_last_updated_at to master_wine_library
--       menu_price_current, markup_ratio, markup_classification to restaurant_inventory
--       wine_menu_prices table (full price history)
--       pricing_anomaly to field_review_queue source constraint

-- 1. master_wine_library: pricing + score staleness tracking + quality_signals
ALTER TABLE master_wine_library
  ADD COLUMN IF NOT EXISTS quality_signals          JSONB        DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS retail_price_avg         DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS scores_last_updated_at   TIMESTAMPTZ;

COMMENT ON COLUMN master_wine_library.quality_signals IS
'{"quality_level": "standard", "producer_tier": "established", "reserve_status": false, "vintage_quality": "Unknown", "awards_ratings": [], "appellation_class": "Prosecco DOC"}';

COMMENT ON COLUMN master_wine_library.retail_price_avg IS
'Average retail price from Wine-Searcher via Serper query. NULL = not yet searched.';

COMMENT ON COLUMN master_wine_library.scores_last_updated_at IS
'Timestamp of last successful critic score search. Used by nightly beat to find stale records (> 30 days).';

-- 2. restaurant_inventory: cached price + markup columns
ALTER TABLE restaurant_inventory
  ADD COLUMN IF NOT EXISTS menu_price_current    DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS markup_ratio          DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS markup_classification VARCHAR(20);

COMMENT ON COLUMN restaurant_inventory.menu_price_current IS
'Cached latest menu price from wine_menu_prices. Denormalized for query performance. Refreshed by score_lookup_task.';

COMMENT ON COLUMN restaurant_inventory.markup_ratio IS
'menu_price_current / master_wine_library.retail_price_avg. NULL if either price missing.';

COMMENT ON COLUMN restaurant_inventory.markup_classification IS
'value (<1.5x) | standard (1.5-2.5x) | premium (2.5-4x) | luxury_markup (>4x). NULL if ratio missing.';

-- 3. wine_menu_prices: full price history table
CREATE TABLE IF NOT EXISTS wine_menu_prices (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id   UUID        NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    wine_id         UUID        NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    menu_price      DECIMAL(10,2) NOT NULL,
    currency        VARCHAR(3)  NOT NULL DEFAULT 'USD',
    source          VARCHAR(50) NOT NULL DEFAULT 'menu_scan',
    scanned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wine_menu_prices_wine
    ON wine_menu_prices(wine_id);

CREATE INDEX IF NOT EXISTS idx_wine_menu_prices_restaurant
    ON wine_menu_prices(restaurant_id, wine_id, scanned_at DESC);

COMMENT ON TABLE wine_menu_prices IS
'Full price history per wine per restaurant. Each menu scan appends a row. Phase 11 uses this for price trend analytics.';

-- 4. field_review_queue: extend source constraint to include pricing_anomaly
ALTER TABLE field_review_queue DROP CONSTRAINT IF EXISTS valid_source;
ALTER TABLE field_review_queue
    ADD CONSTRAINT valid_source
    CHECK (source IN ('visible', 'inferred', 'knowledge', 'ontology', 'pricing_anomaly'));
