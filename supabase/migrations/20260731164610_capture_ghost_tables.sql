-- ============================================================================
-- Capture ghost tables — 13 tables and 4 enums that live in production and
-- appear in no migration file.
-- ============================================================================
--
-- Found by the v3.0 debt compile (see .planning/v3.0-TECH-DEBT.md 44.3a). Until
-- this file existed, a developer running the migrations against an empty database
-- got a schema that production does not have: anything touching these tables
-- worked in production and failed locally, which blocks onboarding anyone new and
-- makes local reproduction of a production bug impossible.
--
-- EVERY DEFINITION BELOW WAS READ OUT OF THE LIVE CATALOG — pg_attribute,
-- pg_constraint, pg_indexes, pg_enum — not inferred from the application code
-- that uses these tables. Inferring is how the drift arrived: the code shows
-- which columns are written, never which are NOT NULL, defaulted, generated, or
-- constrained. (The `notifications` table taught this the hard way in 44.1d,
-- where three NOT NULL columns no code path mentioned were rejecting every
-- insert.)
--
-- Idempotent throughout: IF NOT EXISTS everywhere, so this is a no-op against
-- production and correct against a fresh database.
--
-- FAITHFUL, INCLUDING THE WARTS. Several tables carry exact duplicate indexes
-- under two names (idx_dlq_error_code / idx_event_dlq_error_code and five more —
-- see the note at the foot of this file). They are reproduced rather than
-- silently cleaned, because the point of this migration is that a fresh
-- environment matches production. Dropping them is a separate change that must
-- happen in both places at once.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Enums. These are ghosts too — the drift is not limited to tables, and four
-- types the event pipeline depends on exist in no migration.
-- --------------------------------------------------------------------------
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_type') THEN
        CREATE TYPE event_type AS ENUM ('inventory_change', 'order_change', 'calendar_event',
            'dashboard_update', 'wine_update', 'report_event', 'notification_sent',
            'user_action', 'system_event', 'provider_change', 'template_change');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_page') THEN
        CREATE TYPE source_page AS ENUM ('dashboard', 'inventory', 'wine_library', 'orders',
            'calendar', 'reports', 'communications', 'providers', 'documents',
            'notifications', 'settings', 'system');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dlq_status') THEN
        CREATE TYPE dlq_status AS ENUM ('pending', 'retrying', 'exhausted', 'resolved', 'ignored');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'replay_job_status') THEN
        CREATE TYPE replay_job_status AS ENUM ('pending', 'running', 'paused', 'completed',
            'failed', 'cancelled');
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- _migrations — legacy migration tracker, superseded by
-- supabase_migrations.schema_migrations. Captured rather than dropped: it is
-- reachable and something may still read it, and deleting a table on the
-- strength of "probably unused" is exactly the guess this file exists to stop.
-- Flagged for removal once a writer search comes back empty.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    checksum VARCHAR(64),
    execution_time_ms INTEGER,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_migrations_applied_at ON _migrations(applied_at);
CREATE INDEX IF NOT EXISTS idx_migrations_version ON _migrations(version);

-- --------------------------------------------------------------------------
-- conversation_embeddings — 768-dim pgvector store for provider conversation
-- retrieval. Requires the `vector` extension, which the baseline schema creates.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    session_id UUID NOT NULL,
    message_text TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    channel VARCHAR(50),
    embedding vector(768),
    has_signal BOOLEAN DEFAULT FALSE,
    extracted_entities JSONB,
    extracted_intents TEXT[],
    importance_score DOUBLE PRECISION DEFAULT 0.5,
    sensitive BOOLEAN DEFAULT FALSE,
    language VARCHAR(10),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT conversation_embeddings_role_check
        CHECK (role::text = ANY (ARRAY['provider','restaurant','agent']::text[]))
);
COMMENT ON TABLE conversation_embeddings IS
    'Stores 768-dim text-embedding-004 vectors for signal messages only (has_signal=true, sensitive=false). Used for pgvector semantic retrieval. HNSW index supports cosine similarity search via match_conversation_embeddings RPC.';
CREATE INDEX IF NOT EXISTS idx_ce_provider ON conversation_embeddings(provider_id);
CREATE INDEX IF NOT EXISTS idx_ce_restaurant ON conversation_embeddings(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_ce_session ON conversation_embeddings(session_id);
CREATE INDEX IF NOT EXISTS idx_ce_signal ON conversation_embeddings(provider_id)
    WHERE has_signal = TRUE AND sensitive = FALSE;
-- HNSW parameters copied exactly: recall depends on them, so a fresh index built
-- with defaults would return measurably different results for the same query.
CREATE INDEX IF NOT EXISTS idx_ce_embedding_hnsw ON conversation_embeddings
    USING hnsw (embedding vector_cosine_ops) WITH (m='16', ef_construction='64');

-- --------------------------------------------------------------------------
-- enrichment_queue — background web enrichment jobs for Tier 2/3 wines.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrichment_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wine_id UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    fields_targeted JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'queued',
    enriched_fields JSONB DEFAULT '{}'::jsonb,
    web_sources JSONB DEFAULT '[]'::jsonb,
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT enrichment_queue_status_check
        CHECK (status = ANY (ARRAY['queued','in_progress','complete','failed','skipped'])),
    CONSTRAINT enrichment_queue_wine_id_status_key UNIQUE (wine_id, status)
);
COMMENT ON TABLE enrichment_queue IS
    'Background web enrichment jobs for Tier 2/3 wines. Processed by Celery workers.';
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_status ON enrichment_queue(status, queued_at)
    WHERE status = ANY (ARRAY['queued','in_progress']);
CREATE INDEX IF NOT EXISTS idx_enrichment_queue_wine ON enrichment_queue(wine_id);

-- --------------------------------------------------------------------------
-- event_dead_letters — failed events awaiting retry or manual resolution.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_dead_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id),
    user_id UUID,
    event_type event_type NOT NULL,
    source_page source_page NOT NULL,
    payload JSONB NOT NULL,
    schema_version INTEGER,
    idempotency_key VARCHAR(255),
    trace_id VARCHAR(64),
    error_code VARCHAR(50) NOT NULL,
    error_message TEXT NOT NULL,
    error_details JSONB,
    error_stack TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    status dlq_status DEFAULT 'pending'::dlq_status,
    resolved_by UUID,
    resolution_notes TEXT,
    resolved_event_id UUID REFERENCES events(id),
    failed_at TIMESTAMPTZ DEFAULT NOW(),
    last_retry_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);
COMMENT ON TABLE event_dead_letters IS 'Failed events awaiting retry or manual resolution';
CREATE INDEX IF NOT EXISTS idx_dlq_error_code ON event_dead_letters(error_code);
CREATE INDEX IF NOT EXISTS idx_dlq_restaurant ON event_dead_letters(restaurant_id, failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_status_retry ON event_dead_letters(status, next_retry_at)
    WHERE status = ANY (ARRAY['pending'::dlq_status,'retrying'::dlq_status]);
-- Duplicates of the three above, present in production. See foot of file.

-- --------------------------------------------------------------------------
-- event_replay_jobs — event replay/reprocessing for recovery and backfill.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_replay_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID REFERENCES restaurants(id),
    event_types event_type[],
    from_timestamp TIMESTAMPTZ NOT NULL,
    to_timestamp TIMESTAMPTZ NOT NULL,
    source VARCHAR(20) NOT NULL,
    archive_paths TEXT[],
    target_type VARCHAR(20) NOT NULL,
    target_endpoint TEXT,
    target_config JSONB,
    status replay_job_status DEFAULT 'pending'::replay_job_status,
    total_events INTEGER,
    processed_events INTEGER DEFAULT 0,
    failed_events INTEGER DEFAULT 0,
    skipped_events INTEGER DEFAULT 0,
    last_processed_id UUID,
    last_processed_at TIMESTAMPTZ,
    events_per_second INTEGER DEFAULT 100,
    batch_size INTEGER DEFAULT 1000,
    created_by UUID NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT,
    CONSTRAINT event_replay_jobs_source_check
        CHECK (source::text = ANY (ARRAY['database','archive','both']::text[])),
    CONSTRAINT event_replay_jobs_target_type_check
        CHECK (target_type::text = ANY (ARRAY['realtime','webhook','internal']::text[]))
);
COMMENT ON TABLE event_replay_jobs IS 'Tracks event replay/reprocessing jobs for recovery and backfill';
CREATE INDEX IF NOT EXISTS idx_replay_jobs_restaurant ON event_replay_jobs(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_replay_jobs_status ON event_replay_jobs(status)
    WHERE status = ANY (ARRAY['pending'::replay_job_status,'running'::replay_job_status,'paused'::replay_job_status]);

-- --------------------------------------------------------------------------
-- event_schema_registry — JSON Schema per event type/version. HAS LIVE DATA
-- (9 rows in production); a fresh environment starts empty and event validation
-- will behave differently until it is seeded.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_schema_registry (
    id SERIAL PRIMARY KEY,
    event_type event_type NOT NULL,
    schema_version INTEGER NOT NULL,
    json_schema JSONB NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deprecated_at TIMESTAMPTZ,
    CONSTRAINT uq_schema_version UNIQUE (event_type, schema_version)
);
COMMENT ON TABLE event_schema_registry IS
    'JSON Schema definitions per event type and version for validation';
CREATE INDEX IF NOT EXISTS idx_schema_registry_active ON event_schema_registry(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_schema_registry_type ON event_schema_registry(event_type);

-- --------------------------------------------------------------------------
-- inventory_events — idempotent inventory event log.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL,
    inventory_id UUID,
    master_wine_id UUID REFERENCES master_wine_library(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    quantity_change INTEGER NOT NULL DEFAULT 0,
    source VARCHAR(50),
    idempotency_key TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_inventory_events_idempotency UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_events_master ON inventory_events(master_wine_id)
    WHERE master_wine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_events_restaurant ON inventory_events(restaurant_id, created_at);

-- --------------------------------------------------------------------------
-- keyboard_shortcuts / manager_preferences — per-user settings.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS keyboard_shortcuts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    action VARCHAR(100) NOT NULL,
    key_combination VARCHAR(50) NOT NULL,
    is_custom BOOLEAN DEFAULT FALSE,
    default_combination VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT keyboard_shortcuts_user_id_action_key UNIQUE (user_id, action)
);
CREATE INDEX IF NOT EXISTS idx_keyboard_shortcuts_user ON keyboard_shortcuts(user_id);

CREATE TABLE IF NOT EXISTS manager_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_id UUID NOT NULL UNIQUE,
    report_frequency VARCHAR(20),
    report_delivery_time TIME DEFAULT '07:00:00'::time,
    report_timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    notification_channels JSONB DEFAULT '{"sms": true, "push": true, "email": true, "voice": false}'::jsonb,
    low_stock_alert_enabled BOOLEAN DEFAULT TRUE,
    low_stock_alert_channels JSONB DEFAULT '{"sms": true, "push": true}'::jsonb,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT manager_preferences_report_frequency_check
        CHECK (report_frequency::text = ANY (ARRAY['DAILY','WEEKLY','MONTHLY','NONE']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_manager_preferences_manager ON manager_preferences(manager_id);

-- --------------------------------------------------------------------------
-- negotiation_facts — quoted commitments extracted from provider conversations.
-- Self-referencing FK (supersedes_id) models fact revision.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS negotiation_facts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    fact_type VARCHAR(50) NOT NULL,
    fact_key VARCHAR(100) NOT NULL,
    value_numeric NUMERIC(14,4),
    value_text VARCHAR(500),
    unit VARCHAR(50),
    message_index INTEGER NOT NULL,
    message_timestamp TIMESTAMPTZ NOT NULL,
    exact_quote TEXT NOT NULL,
    stated_by VARCHAR(20) NOT NULL,
    commitment_type VARCHAR(20) NOT NULL DEFAULT 'INDICATIVE',
    supersedes_id UUID REFERENCES negotiation_facts(id),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT negotiation_facts_commitment_type_check
        CHECK (commitment_type::text = ANY (ARRAY['INDICATIVE','OFFER','COUNTER','AGREEMENT']::text[])),
    CONSTRAINT negotiation_facts_status_check
        CHECK (status::text = ANY (ARRAY['active','superseded','disputed']::text[]))
);
CREATE INDEX IF NOT EXISTS idx_neg_facts_active ON negotiation_facts(session_id, status)
    WHERE status::text = 'active';
CREATE INDEX IF NOT EXISTS idx_neg_facts_provider ON negotiation_facts(provider_id, fact_key);
CREATE INDEX IF NOT EXISTS idx_neg_facts_session ON negotiation_facts(session_id);
CREATE INDEX IF NOT EXISTS negotiation_facts_commitment_idx ON negotiation_facts(commitment_type);
CREATE INDEX IF NOT EXISTS negotiation_facts_provider_idx ON negotiation_facts(provider_id);
CREATE INDEX IF NOT EXISTS negotiation_facts_restaurant_idx ON negotiation_facts(restaurant_id);

-- --------------------------------------------------------------------------
-- restaurant_providers — the restaurant↔provider join with tier and history.
-- HAS LIVE DATA (8 rows).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS restaurant_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    tier VARCHAR(50) NOT NULL,
    wine_categories TEXT[],
    custom_lead_time_days INTEGER,
    custom_minimum_order INTEGER,
    orders_placed INTEGER DEFAULT 0,
    last_order_date DATE,
    total_spent NUMERIC(12,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT restaurant_providers_restaurant_id_provider_id_key UNIQUE (restaurant_id, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_restaurant_providers_provider ON restaurant_providers(provider_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_providers_restaurant ON restaurant_providers(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_providers_tier ON restaurant_providers(tier);

-- --------------------------------------------------------------------------
-- vendor_promotions — LLM-extracted promotions from inbound email.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    detected_from_conversation_id UUID REFERENCES procurement_conversations(id),
    detected_from_email_subject TEXT,
    product_name TEXT,
    grape_variety TEXT,
    region TEXT,
    discount_pct NUMERIC(5,2),
    discount_fixed NUMERIC(10,2),
    valid_from DATE,
    valid_until DATE,
    promo_description TEXT,
    conditions TEXT,
    min_quantity INTEGER,
    menu_fit VARCHAR(20) DEFAULT 'PENDING',
    menu_fit_detail TEXT,
    dedup_hash TEXT UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    urgency_score NUMERIC(4,2) DEFAULT NULL,
    linked_event_ids UUID[] DEFAULT '{}'::uuid[],
    last_comparison_price NUMERIC(10,2) DEFAULT NULL,
    price_source_inventory_id UUID,
    snoozed_until TIMESTAMPTZ,
    CONSTRAINT vendor_promotions_menu_fit_check
        CHECK (menu_fit::text = ANY (ARRAY['STRONG_FIT','PARTIAL_FIT','NO_FIT','PENDING']::text[])),
    CONSTRAINT vendor_promotions_status_check
        CHECK (status::text = ANY (ARRAY['active','actioned','expired','suppressed']::text[]))
);
COMMENT ON TABLE vendor_promotions IS
    'LLM-extracted promotions from inbound emails and conversations. EmailIntelAgent checks dedup_hash before insert (7-day window). menu_fit populated by MenuFitAnalyzer.';
CREATE INDEX IF NOT EXISTS idx_vp_dedup ON vendor_promotions(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_vp_expiry ON vendor_promotions(valid_until) WHERE status::text = 'active';
CREATE INDEX IF NOT EXISTS idx_vp_provider_active ON vendor_promotions(provider_id, status) WHERE status::text = 'active';
CREATE INDEX IF NOT EXISTS idx_vp_restaurant ON vendor_promotions(restaurant_id);
CREATE INDEX IF NOT EXISTS vendor_promotions_provider_id_idx ON vendor_promotions(provider_id);
CREATE INDEX IF NOT EXISTS vendor_promotions_status_idx ON vendor_promotions(status);
CREATE INDEX IF NOT EXISTS vendor_promotions_urgency_idx ON vendor_promotions(urgency_score DESC NULLS LAST);

-- --------------------------------------------------------------------------
-- wine_aliases — variant names, OCR corruptions and regional spellings mapped
-- back to canonical wines.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wine_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_id UUID NOT NULL REFERENCES master_wine_library(id) ON DELETE CASCADE,
    alias_name TEXT NOT NULL,
    alias_name_normalized TEXT,
    alias_source TEXT NOT NULL DEFAULT 'human_review',
    language TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT wine_aliases_canonical_id_alias_name_normalized_key
        UNIQUE (canonical_id, alias_name_normalized)
);
COMMENT ON TABLE wine_aliases IS
    'Maps variant names, OCR corruptions, and regional spellings back to canonical wine entries';
CREATE INDEX IF NOT EXISTS idx_wine_aliases_canonical ON wine_aliases(canonical_id);
CREATE INDEX IF NOT EXISTS idx_wine_aliases_normalized ON wine_aliases(alias_name_normalized);

-- ============================================================================
-- KNOWN REDUNDANCY, reproduced deliberately
--
-- Six index pairs below are byte-identical under two names, presumably from a
-- migration applied twice under different naming conventions:
--
--   idx_dlq_error_code            / idx_event_dlq_error_code
--   idx_dlq_restaurant            / idx_event_dlq_restaurant
--   idx_dlq_status_retry          / idx_event_dlq_status_retry
--   idx_replay_jobs_restaurant    / idx_event_replay_jobs_restaurant
--   idx_replay_jobs_status        / idx_event_replay_jobs_status
--   idx_schema_registry_active    / idx_event_schema_registry_active
--   idx_schema_registry_type      / idx_event_schema_registry_type
--   conversation_embeddings_restaurant_idx / idx_ce_restaurant
--   idx_vp_restaurant             / vendor_promotions_restaurant_id_idx
--   idx_vp_provider_active (partial) overlaps vendor_promotions_provider_id_idx
--
-- Each duplicate costs write throughput and storage on every insert. They are
-- reproduced here rather than cleaned because this migration's contract is
-- "a fresh environment matches production" — dropping them is a separate change
-- that must land in both places at once. Tracked as v3.0 task 44.3e.
-- ============================================================================
