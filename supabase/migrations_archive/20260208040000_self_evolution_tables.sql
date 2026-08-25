-- ============================================================================
-- SELF-EVOLVING AI ARCHITECTURE - Tables
-- ============================================================================
-- All tables are created and passive data collection is ALWAYS ON.
-- Learning/optimization endpoints are DISABLED by default
-- (controlled by ENABLE_SELF_EVOLUTION=false env var).
-- ============================================================================

-- 1. AI Feedback Loop
-- Every manager override feeds back to improve agent behavior
CREATE TABLE IF NOT EXISTS ai_feedback_loop (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    event_type VARCHAR(100) NOT NULL,     -- what the agent did
    prediction JSONB NOT NULL,             -- what the agent suggested
    actual_outcome JSONB,                  -- what actually happened
    correction_type VARCHAR(50),           -- override, reject, modify, approve_as_is
    correction_details JSONB,              -- what the manager changed
    improvement_signal FLOAT,              -- -1.0 to 1.0 (negative = agent was wrong)
    context JSONB,                         -- surrounding conditions at time of prediction
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_agent ON ai_feedback_loop(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_signal ON ai_feedback_loop(improvement_signal) WHERE improvement_signal < 0;
CREATE INDEX IF NOT EXISTS idx_feedback_restaurant ON ai_feedback_loop(restaurant_id);

COMMENT ON TABLE ai_feedback_loop IS 'Records every manager override of AI suggestions for future learning (passive collection always on)';


-- 2. Prompt Versions
-- Track every prompt template and its performance
CREATE TABLE IF NOT EXISTS prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(100) NOT NULL,
    prompt_name VARCHAR(200) NOT NULL,
    prompt_template TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    performance_score FLOAT,               -- 0-1 success rate
    avg_tokens_used INTEGER,
    avg_latency_ms INTEGER,
    total_uses INTEGER DEFAULT 0,
    total_successes INTEGER DEFAULT 0,
    total_failures INTEGER DEFAULT 0,
    ab_experiment_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    retired_at TIMESTAMPTZ,
    UNIQUE(agent_name, prompt_name, version)
);

CREATE INDEX IF NOT EXISTS idx_prompt_versions_agent ON prompt_versions(agent_name, is_active);

COMMENT ON TABLE prompt_versions IS 'Tracks all prompt templates with performance metrics for A/B testing';


-- 3. A/B Experiments
-- Framework for testing parameter variants
CREATE TABLE IF NOT EXISTS ab_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_name VARCHAR(200) NOT NULL,
    agent_name VARCHAR(100) NOT NULL,
    parameter_name VARCHAR(200) NOT NULL,
    variant_a JSONB NOT NULL,               -- control
    variant_b JSONB NOT NULL,               -- challenger
    metric VARCHAR(100) NOT NULL,           -- success metric
    sample_size_target INTEGER DEFAULT 100,
    current_sample_a INTEGER DEFAULT 0,
    current_sample_b INTEGER DEFAULT 0,
    success_count_a INTEGER DEFAULT 0,
    success_count_b INTEGER DEFAULT 0,
    winner VARCHAR(1),                      -- 'A', 'B', or NULL
    confidence FLOAT,                       -- statistical confidence
    status VARCHAR(20) DEFAULT 'DISABLED',  -- DISABLED, RUNNING, COMPLETED, CANCELLED
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ab_experiments_agent ON ab_experiments(agent_name, status);

COMMENT ON TABLE ab_experiments IS 'A/B testing framework for agent parameters (DISABLED by default)';


-- 4. Agent Evolution Log
-- Immutable audit trail of all self-modifications
CREATE TABLE IF NOT EXISTS agent_evolution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_name VARCHAR(100) NOT NULL,
    parameter_changed VARCHAR(200) NOT NULL,
    old_value JSONB NOT NULL,
    new_value JSONB NOT NULL,
    reason TEXT NOT NULL,
    confidence FLOAT,
    approved_by VARCHAR(50) NOT NULL,       -- 'auto' or user_id
    experiment_id UUID REFERENCES ab_experiments(id),
    rollback_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evolution_log_agent ON agent_evolution_log(agent_name, created_at DESC);

COMMENT ON TABLE agent_evolution_log IS 'Immutable audit trail of AI self-modifications (requires ENABLE_SELF_EVOLUTION=true)';


-- 5. Prediction Outcomes
-- Track prediction accuracy for continuous improvement
CREATE TABLE IF NOT EXISTS prediction_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    agent_name VARCHAR(100) NOT NULL,
    prediction_type VARCHAR(100) NOT NULL,    -- stockout_date, demand_forecast, price_prediction
    predicted_value JSONB NOT NULL,
    actual_value JSONB,
    accuracy_score FLOAT,                      -- 0-1
    prediction_made_at TIMESTAMPTZ NOT NULL,
    outcome_recorded_at TIMESTAMPTZ,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prediction_agent ON prediction_outcomes(agent_name, prediction_type);
CREATE INDEX IF NOT EXISTS idx_prediction_accuracy ON prediction_outcomes(accuracy_score) WHERE accuracy_score IS NOT NULL;

COMMENT ON TABLE prediction_outcomes IS 'Tracks prediction accuracy for stockout, demand, and price forecasts (passive collection always on)';


-- 6. System Learning State
-- Global state for each learning model
CREATE TABLE IF NOT EXISTS system_learning_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    model_name VARCHAR(100) NOT NULL,
    model_version INTEGER DEFAULT 1,
    training_data_size INTEGER DEFAULT 0,
    last_trained_at TIMESTAMPTZ,
    accuracy_metrics JSONB,                 -- {precision, recall, f1, custom_metrics}
    parameters JSONB,                       -- current tuned parameters
    status VARCHAR(20) DEFAULT 'DISABLED',  -- DISABLED, COLLECTING, TRAINING, ACTIVE
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_state_model ON system_learning_state(model_name, status);

COMMENT ON TABLE system_learning_state IS 'Global learning state per model (DISABLED by default, collecting data passively)';


-- ============================================================================
-- Ensure restaurant_feature_flags exists (may be missing if prior migration partially failed)
-- ============================================================================
CREATE TABLE IF NOT EXISTS restaurant_feature_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurants(id) ON DELETE CASCADE,
    flag_name VARCHAR(100) NOT NULL,
    enabled BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id, flag_name)
);

-- ============================================================================
-- Insert default feature flag to keep self-evolution disabled
-- ============================================================================
INSERT INTO restaurant_feature_flags (restaurant_id, flag_name, enabled, metadata)
SELECT r.id, 'self_evolution', false, '{"reason": "Disabled by default. Set ENABLE_SELF_EVOLUTION=true to activate learning loops."}'::jsonb
FROM restaurants r
WHERE NOT EXISTS (
    SELECT 1 FROM restaurant_feature_flags rf
    WHERE rf.restaurant_id = r.id AND rf.flag_name = 'self_evolution'
);

-- ============================================================================
-- END OF SELF-EVOLUTION TABLES
-- ============================================================================
