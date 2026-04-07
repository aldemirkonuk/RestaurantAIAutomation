-- Phase 13 DEVUI-05, D-15: override_events — full provenance for every manual field override
-- Coexists with field_corrections (Phase 5 QA); does NOT replace it.
-- promotion_status drives D-12/D-13 workflow: pending → approved/rejected (certified_contributor)
--   or auto_promoted instantly (developer, review_admin, auto_promote certified_contributor)

CREATE TABLE IF NOT EXISTS override_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES onboarding_sessions(id) ON DELETE CASCADE,
    submission_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT NOT NULL,
    old_confidence DECIMAL(3,2),
    reason TEXT,
    citation_url TEXT,
    citation_snippet TEXT,
    promotion_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (promotion_status IN ('pending', 'auto_promoted', 'approved', 'rejected')),
    approved_by UUID,
    approval_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_override_events_submission ON override_events(submission_id);
CREATE INDEX IF NOT EXISTS idx_override_events_session ON override_events(session_id);
CREATE INDEX IF NOT EXISTS idx_override_events_actor ON override_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_override_events_pending ON override_events(promotion_status, created_at)
    WHERE promotion_status = 'pending';

ALTER TABLE override_events ENABLE ROW LEVEL SECURITY;

-- Actors can read overrides from their own sessions
CREATE POLICY "override_read_own" ON override_events
    FOR SELECT USING (auth.uid() = actor_id);

-- review_admins and developers can read all override_events (for queue/metrics)
CREATE POLICY "override_read_admin" ON override_events
    FOR SELECT USING (
        (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
        OR (auth.jwt() -> 'app_metadata' -> 'roles') ? 'developer'
    );

-- Any authenticated studio user can insert an override for their own session
CREATE POLICY "override_insert_policy" ON override_events
    FOR INSERT WITH CHECK (auth.uid() = actor_id);

-- Only review_admins can update (approve/reject) overrides
CREATE POLICY "override_update_admin" ON override_events
    FOR UPDATE USING (
        (auth.jwt() -> 'app_metadata' -> 'roles') ? 'review_admin'
    );

COMMENT ON TABLE override_events IS 'Phase 13 DEVUI-05 D-15: Full provenance for every manual field override. promotion_status tracks D-12/D-13 workflow. Coexists with field_corrections; does not replace it.';
COMMENT ON COLUMN override_events.old_confidence IS 'Field confidence BEFORE override. When >= 0.8, reason was required (D-07). NULL means field was previously empty.';
COMMENT ON COLUMN override_events.promotion_status IS 'pending = queued for review_admin approval; auto_promoted = instantly applied (developer/review_admin or auto_promote certified_contributor); approved/rejected = decided by review_admin (D-12, D-13).';
