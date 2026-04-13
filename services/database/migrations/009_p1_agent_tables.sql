-- ============================================================================
-- P1 Agent Tables
-- Supports GhostInventory, NegotiationPlaybook, AutoPilot, Compliance, Shrinkage
-- ============================================================================

-- Inventory trust scores
CREATE TABLE IF NOT EXISTS inventory_trust_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    trust_score DECIMAL(3,2) DEFAULT 1.0,
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_trust_scores_restaurant
    ON inventory_trust_scores(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_trust_scores_inventory
    ON inventory_trust_scores(inventory_id);

-- Inventory discrepancies
CREATE TABLE IF NOT EXISTS inventory_discrepancies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    expected_stock INTEGER,
    actual_stock INTEGER,
    delta INTEGER,
    source VARCHAR(50), -- pos, manual, camera
    status VARCHAR(50) DEFAULT 'open',
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_discrepancies_restaurant
    ON inventory_discrepancies(restaurant_id, detected_at DESC);

-- Camera movement logs
CREATE TABLE IF NOT EXISTS camera_movement_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    camera_id VARCHAR(100),
    movement_type VARCHAR(50),
    confidence DECIMAL(4,3),
    captured_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_camera_movement_logs_restaurant
    ON camera_movement_logs(restaurant_id, captured_at DESC);

-- Negotiation history
CREATE TABLE IF NOT EXISTS negotiation_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id),
    order_id UUID REFERENCES procurement_orders(id),
    direction VARCHAR(20), -- outbound/inbound
    message_text TEXT,
    price_offered DECIMAL(10,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    success BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_negotiation_history_provider
    ON negotiation_history(provider_id, created_at DESC);

-- Provider price patterns
CREATE TABLE IF NOT EXISTS provider_price_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES providers(id),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    avg_price DECIMAL(10,2),
    min_price DECIMAL(10,2),
    max_price DECIMAL(10,2),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Negotiation tactics
CREATE TABLE IF NOT EXISTS negotiation_tactics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID REFERENCES providers(id),
    tactic_name VARCHAR(100),
    success_rate DECIMAL(4,3),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-pilot rules
CREATE TABLE IF NOT EXISTS auto_pilot_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID NOT NULL REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
    target_stock INTEGER NOT NULL,
    min_stock INTEGER NOT NULL,
    max_price DECIMAL(10,2),
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-pilot executions
CREATE TABLE IF NOT EXISTS auto_pilot_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id UUID NOT NULL REFERENCES auto_pilot_rules(id) ON DELETE CASCADE,
    order_id UUID REFERENCES procurement_orders(id),
    status VARCHAR(50) DEFAULT 'pending',
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    notes TEXT
);

-- Compliance deadlines
CREATE TABLE IF NOT EXISTS compliance_deadlines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    jurisdiction VARCHAR(100),
    deadline_type VARCHAR(100),
    due_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compliance reports
CREATE TABLE IF NOT EXISTS compliance_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    report_type VARCHAR(100),
    period_start DATE,
    period_end DATE,
    file_url TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Excise tax records
CREATE TABLE IF NOT EXISTS excise_tax_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_tax DECIMAL(12,2),
    filed_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'open'
);

-- Shrinkage alerts
CREATE TABLE IF NOT EXISTS shrinkage_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    severity VARCHAR(20),
    expected_loss DECIMAL(10,2),
    details JSONB,
    status VARCHAR(50) DEFAULT 'open'
);

-- Staff correlation data
CREATE TABLE IF NOT EXISTS staff_correlation_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    staff_id UUID,
    inventory_id UUID REFERENCES restaurant_inventory(id),
    event_count INTEGER DEFAULT 0,
    anomaly_score DECIMAL(4,3),
    period_start DATE,
    period_end DATE
);

-- Anomaly patterns
CREATE TABLE IF NOT EXISTS anomaly_patterns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    pattern_type VARCHAR(100),
    description TEXT,
    model_version VARCHAR(50),
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
