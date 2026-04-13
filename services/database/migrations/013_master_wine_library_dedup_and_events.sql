-- ============================================================================
-- Migration: 013_master_wine_library_dedup_and_events
-- Created: 2026-01-31
-- Description: Add master wine dedup fields, submissions staging, and inventory events
-- ============================================================================

-- Ensure UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === Master Wine Library: dedup fields ===
ALTER TABLE IF EXISTS master_wine_library
  ADD COLUMN IF NOT EXISTS signature_hash TEXT,
  ADD COLUMN IF NOT EXISTS normalized_name TEXT,
  ADD COLUMN IF NOT EXISTS normalized_producer TEXT,
  ADD COLUMN IF NOT EXISTS signature_source TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_wine_library_signature_hash
  ON master_wine_library(signature_hash)
  WHERE signature_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_wine_library_normalized_name
  ON master_wine_library(normalized_name)
  WHERE normalized_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_wine_library_normalized_producer
  ON master_wine_library(normalized_producer)
  WHERE normalized_producer IS NOT NULL;

-- === Staging: Master Wine Library Submissions ===
CREATE TABLE IF NOT EXISTS master_wine_library_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID,
  submitted_by UUID,
  payload JSONB NOT NULL,
  normalized_fields JSONB,
  signature_hash TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decision_reason TEXT,
  matched_master_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT fk_mwls_master
    FOREIGN KEY (matched_master_id)
    REFERENCES master_wine_library(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mwls_status
  ON master_wine_library_submissions(status);

CREATE INDEX IF NOT EXISTS idx_mwls_signature_hash
  ON master_wine_library_submissions(signature_hash)
  WHERE signature_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mwls_restaurant_id
  ON master_wine_library_submissions(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_mwls_created_at
  ON master_wine_library_submissions(created_at);

-- Updated at trigger (if function exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER update_mwls_updated_at
      BEFORE UPDATE ON master_wine_library_submissions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- === Inventory Events (idempotent sync) ===
CREATE TABLE IF NOT EXISTS inventory_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  restaurant_id UUID NOT NULL,
  inventory_id UUID,
  master_wine_id UUID,
  event_type VARCHAR(50) NOT NULL,
  quantity_change INTEGER NOT NULL DEFAULT 0,
  source VARCHAR(50),
  idempotency_key TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_inventory_events_idempotency UNIQUE (idempotency_key),
  CONSTRAINT fk_inventory_events_master
    FOREIGN KEY (master_wine_id)
    REFERENCES master_wine_library(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_events_restaurant
  ON inventory_events(restaurant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_events_master
  ON inventory_events(master_wine_id)
  WHERE master_wine_id IS NOT NULL;

