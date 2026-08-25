-- Phase 13 DEVUI-08: onboarding_sessions table for full session audit timeline
-- Each ingestion session (PDF, URL crawl, manual seed) creates one row
-- scan_session_id links to master_wine_library_submissions.scan_session_id from existing pipeline

CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('pdf_upload', 'url_crawl', 'manual_seed')),
    source_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'abandoned')),
    scan_session_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_actor ON onboarding_sessions(actor_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_scan ON onboarding_sessions(scan_session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status ON onboarding_sessions(status) WHERE status = 'active';

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read sessions they created OR if they are a review_admin/developer (via JWT)
CREATE POLICY "session_read_policy" ON onboarding_sessions
    FOR SELECT USING (
        auth.uid() = actor_id
        OR (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
        OR (auth.jwt() -> 'app_metadata' -> 'roles') ? 'developer'
    );

-- Authenticated studio users (any role) can insert their own sessions
CREATE POLICY "session_insert_policy" ON onboarding_sessions
    FOR INSERT WITH CHECK (auth.uid() = actor_id);

COMMENT ON TABLE onboarding_sessions IS 'Phase 13 DEVUI-08: Per-session audit anchor for GET /api/v1/studio/sessions/{id} timeline endpoint.';
