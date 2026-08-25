-- ============================================================================
-- Providers + Reports Extensions
-- Adds provider ratings and scheduled reports tables
-- Note: providers and generated_reports already exist in base schema
-- ============================================================================

-- Provider ratings table
CREATE TABLE IF NOT EXISTS provider_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    order_id UUID REFERENCES procurement_orders(id),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    categories JSONB,
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_ratings_provider ON provider_ratings(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_ratings_restaurant ON provider_ratings(restaurant_id);

-- Scheduled reports table
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    report_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    parameters JSONB,
    frequency VARCHAR(20) NOT NULL, -- daily, weekly, monthly
    day_of_week INTEGER,
    day_of_month INTEGER,
    time_of_day TIME,
    recipients TEXT[],
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_reports_restaurant ON scheduled_reports(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_reports_next_run ON scheduled_reports(next_run_at)
    WHERE is_active = true;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
