-- Phase 37: sim_ground_truth* oracle + seed_sim_restaurant SECURITY DEFINER RPC
-- SYNTH-04 / D-08 / D-09 / D-10 — fail-closed atomic seed+oracle.
-- No anon/authenticated INSERT/UPDATE/DELETE policies on oracle tables.
-- Service-role bypasses RLS; seed path uses this SECURITY DEFINER function.

CREATE TABLE IF NOT EXISTS sim_ground_truth_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  archetype_id TEXT NOT NULL,
  seed_version TEXT NOT NULL,
  menu_quality TEXT NOT NULL CHECK (menu_quality IN ('full', 'partial')),
  snapshot_path TEXT NOT NULL,
  snapshot_sha256 TEXT NOT NULL,
  params JSONB NOT NULL,
  sku_count INTEGER NOT NULL,
  priced_sku_count INTEGER NOT NULL,
  seeded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id)
);

CREATE TABLE IF NOT EXISTS sim_ground_truth_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES sim_ground_truth_runs(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'profile', 'roster', 'sku', 'menu_price', 'opening_stock', 'menu_quality_meta'
  )),
  sku_key TEXT,
  entity_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sim_gt_facts_rest_type
  ON sim_ground_truth_facts (restaurant_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_sim_gt_facts_run_sku
  ON sim_ground_truth_facts (run_id, fact_type, sku_key);

ALTER TABLE sim_ground_truth_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sim_ground_truth_facts ENABLE ROW LEVEL SECURITY;

-- Intentionally NO policies for anon/authenticated writes.
-- Service-role / SECURITY DEFINER seed only (T-37-02-01).

COMMENT ON TABLE sim_ground_truth_runs IS
  'Phase 37 synthetic-tenant oracle run header — one active run per sim restaurant.';
COMMENT ON TABLE sim_ground_truth_facts IS
  'Phase 37/41 ground-truth facts (opening_stock, menu_price, roster, sku, …).';

-- ---------------------------------------------------------------------------
-- Atomic seed RPC (D-10). Full body completed in plan 37-02 Task 3.
-- Callable stub raises until Task 3 wires the write-set inserts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_sim_restaurant(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Task 1 skeleton: ensure function exists and is SECURITY DEFINER.
  -- Task 3 replaces this body with fail-closed live+oracle writes.
  RAISE EXCEPTION 'seed_sim_restaurant: not implemented';
END;
$$;

REVOKE ALL ON FUNCTION seed_sim_restaurant(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_sim_restaurant(jsonb) TO service_role;

COMMENT ON FUNCTION seed_sim_restaurant(jsonb) IS
  'Phase 37 fail-closed atomic sim seed + oracle. SECURITY DEFINER; service_role only.';
