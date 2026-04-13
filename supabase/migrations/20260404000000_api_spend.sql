-- ============================================================================
-- COST GUARDRAILS: api_spend + spend_alert_state tables
-- ============================================================================
-- COST-01: Track all Claude + Gemini API calls with provider, model, tokens, cost
-- COST-02: spend_alert_state holds idempotent monthly alert deduplication state

CREATE TABLE IF NOT EXISTS api_spend (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL,       -- "anthropic" | "google"
    model VARCHAR(100) NOT NULL,         -- "claude-haiku-4-5-20251001" | "gemini-2.5-flash"
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0.0,
    restaurant_id UUID,                  -- NULL allowed (enrichment tasks may not have restaurant context)
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_spend_provider_timestamp
    ON api_spend (provider, timestamp);

CREATE INDEX IF NOT EXISTS idx_api_spend_restaurant_timestamp
    ON api_spend (restaurant_id, timestamp)
    WHERE restaurant_id IS NOT NULL;

COMMENT ON TABLE api_spend IS 'Per-call API spend log for Claude and Gemini. Supports monthly aggregate queries and per-restaurant cap enforcement.';
COMMENT ON COLUMN api_spend.provider IS 'anthropic (Claude Vision + Haiku) or google (Gemini Flash)';
COMMENT ON COLUMN api_spend.restaurant_id IS 'NULL for enrichment tasks not associated with a specific restaurant extraction request';

-- Alert deduplication: one row per provider, prevents repeat alerts within same calendar month
CREATE TABLE IF NOT EXISTS spend_alert_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) UNIQUE NOT NULL,  -- "anthropic" | "google"
    last_alert_month VARCHAR(7),            -- "2026-04" format — reset each month
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE spend_alert_state IS 'Idempotent monthly alert deduplication. One row per provider. Prevents repeated emails within the same calendar month.';
