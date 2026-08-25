-- Phase 27 VENDOR-01: Global admin-curated vendor catalogue
-- This table is NOT restaurant-scoped. It is maintained by WineOps admins.
-- Restaurant users can read all rows; only service_role can write.

CREATE TABLE IF NOT EXISTS vendor_catalogue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  type           TEXT CHECK (type IN ('distributor', 'importer', 'wholesaler', 'winery_direct', 'broker', 'other')),
  country        TEXT NOT NULL DEFAULT 'US',
  state          TEXT,        -- for US regional distributors (e.g. 'CA', 'NY')
  city           TEXT,
  address        TEXT,
  phone          TEXT,
  email          TEXT,
  website        TEXT,
  wine_specialties TEXT,      -- e.g. 'Burgundy, Champagne, Bordeaux'
  notes          TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast search
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_name ON vendor_catalogue USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_country ON vendor_catalogue (country);
CREATE INDEX IF NOT EXISTS idx_vendor_catalogue_state ON vendor_catalogue (state);

-- RLS
ALTER TABLE vendor_catalogue ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read active vendors
CREATE POLICY "vendor_catalogue_read" ON vendor_catalogue
  FOR SELECT TO authenticated USING (is_active = TRUE);

-- INSERT/UPDATE/DELETE not exposed to anon/authenticated roles
-- Only service_role can write (admin operations via service role key, bypasses RLS)
