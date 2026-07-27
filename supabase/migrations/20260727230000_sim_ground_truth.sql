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
-- Atomic fail-closed seed (D-10). Entire function runs in one TX.
-- Payload shape matches scripts/synth/seed.py build_rpc_payload().
-- Only allows slug LIKE 'sim-%'. Never touches e2e-test-restaurant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_sim_restaurant(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org jsonb := payload->'organization';
  v_restaurant jsonb := payload->'restaurant';
  v_menu jsonb := payload->'restaurant_menu';
  v_run jsonb := payload->'oracle_run';
  v_restaurant_id uuid;
  v_slug text;
  v_item jsonb;
  v_fact jsonb;
  v_wine jsonb;
  v_sub jsonb;
  v_ura jsonb;
  v_user jsonb;
  v_member jsonb;
  v_inv jsonb;
  v_vintage int;
BEGIN
  IF v_restaurant IS NULL OR v_run IS NULL THEN
    RAISE EXCEPTION 'seed_sim_restaurant: restaurant and oracle_run required';
  END IF;

  v_slug := v_restaurant->>'slug';
  IF v_slug IS NULL OR v_slug NOT LIKE 'sim-%' THEN
    RAISE EXCEPTION 'seed_sim_restaurant: refusing non-sim slug %', v_slug;
  END IF;
  IF v_slug = 'e2e-test-restaurant' THEN
    RAISE EXCEPTION 'seed_sim_restaurant: refusing e2e anchor slug';
  END IF;

  v_restaurant_id := (v_restaurant->>'id')::uuid;

  -- organizations
  INSERT INTO organizations (id, name)
  VALUES ((v_org->>'id')::uuid, v_org->>'name')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  -- restaurants (UUID5 id + sim-* slug)
  INSERT INTO restaurants (
    id, organization_id, name, slug, timezone, city, country,
    cuisine_type, default_threshold_min, is_active
  )
  VALUES (
    v_restaurant_id,
    (v_restaurant->>'organization_id')::uuid,
    v_restaurant->>'name',
    v_slug,
    v_restaurant->>'timezone',
    v_restaurant->>'city',
    v_restaurant->>'country',
    v_restaurant->>'cuisine_type',
    COALESCE((v_restaurant->>'default_threshold_min')::int, 5),
    COALESCE((v_restaurant->>'is_active')::boolean, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    timezone = EXCLUDED.timezone,
    city = EXCLUDED.city,
    country = EXCLUDED.country,
    cuisine_type = EXCLUDED.cuisine_type,
    default_threshold_min = EXCLUDED.default_threshold_min,
    is_active = EXCLUDED.is_active;

  -- public.users mirrors (live schema: no auth_provider)
  FOR v_user IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'users', '[]'::jsonb))
  LOOP
    INSERT INTO users (user_id, email, name, role, email_verified)
    VALUES (
      (v_user->>'user_id')::uuid,
      v_user->>'email',
      v_user->>'name',
      v_user->>'role',
      true
    )
    ON CONFLICT (user_id) DO UPDATE SET
      email = EXCLUDED.email,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      email_verified = EXCLUDED.email_verified;
  END LOOP;

  FOR v_member IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'organization_members', '[]'::jsonb))
  LOOP
    INSERT INTO organization_members (organization_id, user_id, role)
    VALUES (
      (v_member->>'organization_id')::uuid,
      (v_member->>'user_id')::uuid,
      v_member->>'role'
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  END LOOP;

  FOR v_ura IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'user_restaurant_access', '[]'::jsonb))
  LOOP
    INSERT INTO user_restaurant_access (user_id, restaurant_id, role, is_active)
    VALUES (
      (v_ura->>'user_id')::uuid,
      (v_ura->>'restaurant_id')::uuid,
      v_ura->>'role',
      COALESCE((v_ura->>'is_active')::boolean, true)
    )
    ON CONFLICT (user_id, restaurant_id) DO UPDATE SET
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active;
  END LOOP;

  -- provisional master wines (source = sim; live schema uses primary_type not wine_type)
  FOR v_wine IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'master_wine_library', '[]'::jsonb))
  LOOP
    BEGIN
      v_vintage := NULLIF(v_wine->>'vintage', '')::int;
    EXCEPTION WHEN others THEN
      v_vintage := NULL;
    END;
    INSERT INTO master_wine_library (
      id, wine_id, name, producer, vintage, region, country, grape_variety,
      primary_type, signature_hash, source, data_enrichment
    )
    VALUES (
      (v_wine->>'id')::uuid,
      COALESCE(
        NULLIF(v_wine->>'wine_id', ''),
        'sim' || left(replace(COALESCE(v_wine->>'signature_hash', v_wine->>'id'), '-', ''), 17)
      ),
      v_wine->>'name',
      v_wine->>'producer',
      v_vintage,
      v_wine->>'region',
      v_wine->>'country',
      v_wine->>'grape_variety',
      COALESCE(v_wine->>'primary_type', v_wine->>'wine_type', 'unknown'),
      v_wine->>'signature_hash',
      COALESCE(v_wine->>'source', 'sim'),
      COALESCE(v_wine->'data_enrichment', jsonb_build_object('source', 'sim'))
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      producer = EXCLUDED.producer,
      signature_hash = EXCLUDED.signature_hash,
      source = EXCLUDED.source,
      primary_type = EXCLUDED.primary_type,
      data_enrichment = EXCLUDED.data_enrichment;
  END LOOP;

  FOR v_sub IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'master_wine_library_submissions', '[]'::jsonb))
  LOOP
    INSERT INTO master_wine_library_submissions (
      id, restaurant_id, signature_hash, status, matched_master_id, payload
    )
    VALUES (
      (v_sub->>'id')::uuid,
      (v_sub->>'restaurant_id')::uuid,
      v_sub->>'signature_hash',
      COALESCE(v_sub->>'status', 'accepted'),
      (v_sub->>'matched_master_id')::uuid,
      COALESCE(v_sub->'payload', '{}'::jsonb)
    )
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      matched_master_id = EXCLUDED.matched_master_id,
      payload = EXCLUDED.payload;
  END LOOP;

  INSERT INTO restaurant_menus (id, restaurant_id, name, menu_type, status, season)
  VALUES (
    (v_menu->>'id')::uuid,
    (v_menu->>'restaurant_id')::uuid,
    COALESCE(v_menu->>'name', 'Wine List'),
    COALESCE(v_menu->>'menu_type', 'beverage'),
    COALESCE(v_menu->>'status', 'active'),
    COALESCE(v_menu->>'season', 'year_round')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    menu_type = EXCLUDED.menu_type,
    status = EXCLUDED.status;

  -- Idempotent re-seed: replace menu items + inventory for this restaurant
  DELETE FROM menu_items WHERE restaurant_id = v_restaurant_id;
  DELETE FROM restaurant_inventory WHERE restaurant_id = v_restaurant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'menu_items', '[]'::jsonb))
  LOOP
    INSERT INTO menu_items (
      id, menu_id, restaurant_id, name, producer, vintage, region, country,
      grape_variety, bottle_price, by_glass_price, wine_library_id, source, status
    )
    VALUES (
      (v_item->>'id')::uuid,
      (v_item->>'menu_id')::uuid,
      (v_item->>'restaurant_id')::uuid,
      v_item->>'name',
      v_item->>'producer',
      v_item->>'vintage',
      v_item->>'region',
      v_item->>'country',
      v_item->>'grape_variety',
      NULLIF(v_item->>'bottle_price', '')::numeric,
      NULLIF(v_item->>'by_glass_price', '')::numeric,
      (v_item->>'wine_library_id')::uuid,
      COALESCE(v_item->>'source', 'manual'),
      COALESCE(v_item->>'status', 'approved')
    );
  END LOOP;

  -- Opening stock goes to restaurant_inventory.stock_live only
  FOR v_inv IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'restaurant_inventory', '[]'::jsonb))
  LOOP
    INSERT INTO restaurant_inventory (
      id, restaurant_id, master_wine_id, wine_name, stock_live, threshold_min, is_active
    )
    VALUES (
      (v_inv->>'id')::uuid,
      (v_inv->>'restaurant_id')::uuid,
      (v_inv->>'master_wine_id')::uuid,
      v_inv->>'wine_name',
      COALESCE((v_inv->>'stock_live')::int, 0),
      COALESCE((v_inv->>'threshold_min')::int, 5),
      COALESCE((v_inv->>'is_active')::boolean, true)
    );
  END LOOP;

  -- Oracle last inside same TX — failure rolls back live rows (D-10)
  DELETE FROM sim_ground_truth_facts WHERE restaurant_id = v_restaurant_id;
  DELETE FROM sim_ground_truth_runs WHERE restaurant_id = v_restaurant_id;

  INSERT INTO sim_ground_truth_runs (
    id, restaurant_id, archetype_id, seed_version, menu_quality,
    snapshot_path, snapshot_sha256, params, sku_count, priced_sku_count
  )
  VALUES (
    (v_run->>'id')::uuid,
    (v_run->>'restaurant_id')::uuid,
    v_run->>'archetype_id',
    v_run->>'seed_version',
    v_run->>'menu_quality',
    v_run->>'snapshot_path',
    v_run->>'snapshot_sha256',
    COALESCE(v_run->'params', '{}'::jsonb),
    COALESCE((v_run->>'sku_count')::int, 0),
    COALESCE((v_run->>'priced_sku_count')::int, 0)
  );

  FOR v_fact IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'oracle_facts', '[]'::jsonb))
  LOOP
    INSERT INTO sim_ground_truth_facts (
      id, run_id, restaurant_id, fact_type, sku_key, entity_ref, payload
    )
    VALUES (
      (v_fact->>'id')::uuid,
      (v_fact->>'run_id')::uuid,
      (v_fact->>'restaurant_id')::uuid,
      v_fact->>'fact_type',
      v_fact->>'sku_key',
      COALESCE(v_fact->'entity_ref', '{}'::jsonb),
      COALESCE(v_fact->'payload', '{}'::jsonb)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurant_id', v_restaurant_id,
    'slug', v_slug,
    'sku_count', COALESCE((v_run->>'sku_count')::int, 0),
    'fact_count', jsonb_array_length(COALESCE(payload->'oracle_facts', '[]'::jsonb))
  );
END;
$$;

REVOKE ALL ON FUNCTION seed_sim_restaurant(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seed_sim_restaurant(jsonb) TO service_role;

COMMENT ON FUNCTION seed_sim_restaurant(jsonb) IS
  'Phase 37 fail-closed atomic sim seed + oracle. SECURITY DEFINER; service_role only.';
