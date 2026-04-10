-- Append-only event store for event sourcing (INFRA-DB-05)
CREATE TABLE IF NOT EXISTS event_store (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type TEXT NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    sequence_number BIGINT NOT NULL,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_store ADD CONSTRAINT uq_event_store_aggregate_sequence
    UNIQUE (aggregate_type, aggregate_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_event_store_aggregate ON event_store (aggregate_type, aggregate_id, sequence_number);
