-- Phase 2 · 2a foundation: inventory_lots (ADDITIVE, non-breaking).
-- stock_live/shadow_stock keep working; nothing is dropped. Live vs shadow preserved via stock_state.
-- Applied to project exzueerziesmczwlhomd on 2026-07-10 (also recorded via MCP migration history).
-- See .planning/INVENTORY_SOTA_PLAN.md §6a.
CREATE TABLE IF NOT EXISTS inventory_lots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   UUID NOT NULL,
  inventory_id    UUID REFERENCES restaurant_inventory(id) ON DELETE CASCADE,
  master_wine_id  UUID NOT NULL,
  location_id     UUID REFERENCES storage_locations(id) ON DELETE SET NULL,
  stock_state     VARCHAR(10) NOT NULL DEFAULT 'live' CHECK (stock_state IN ('live','shadow')),
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  open_bottle_ml  INTEGER NOT NULL DEFAULT 0 CHECK (open_bottle_ml >= 0),
  unit_cost       NUMERIC(10,2),
  cost_provenance VARCHAR(12) NOT NULL DEFAULT 'estimated' CHECK (cost_provenance IN ('invoice','estimated','manual')),
  vintage         INTEGER,
  status          VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserved','depleted')),
  source_order_id UUID,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_ri  ON inventory_lots(restaurant_id, master_wine_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_loc ON inventory_lots(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_inv ON inventory_lots(inventory_id);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE inventory_lots IS 'Phase 2 (2a): physical stock as cost/location/vintage lots. on-hand = SUM(qty) live lots; location count = SUM(qty)@loc; WAC = SUM(qty*unit_cost)/SUM(qty). Live vs shadow preserved via stock_state. Additive until app cutover.';

-- Genesis backfill (D16). wine_location_mappings.wine_id is varchar (compare as text); location_id is uuid.
INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance)
SELECT ri.restaurant_id, ri.id, ri.master_wine_id, sl.id, 'live', ri.stock_live,
       ri.last_purchase_price,
       CASE WHEN ri.last_purchase_price IS NOT NULL THEN 'invoice' ELSE 'estimated' END
FROM restaurant_inventory ri
LEFT JOIN wine_location_mappings wlm ON wlm.restaurant_id = ri.restaurant_id AND wlm.wine_id = ri.master_wine_id::text
LEFT JOIN storage_locations sl ON sl.id = wlm.location_id
WHERE ri.master_wine_id IS NOT NULL AND COALESCE(ri.stock_live,0) > 0
  AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.inventory_id = ri.id AND l.stock_state = 'live');

INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, location_id, stock_state, qty, unit_cost, cost_provenance)
SELECT ri.restaurant_id, ri.id, ri.master_wine_id, NULL, 'shadow', ri.shadow_stock,
       ri.last_purchase_price,
       CASE WHEN ri.last_purchase_price IS NOT NULL THEN 'invoice' ELSE 'estimated' END
FROM restaurant_inventory ri
WHERE ri.master_wine_id IS NOT NULL AND COALESCE(ri.shadow_stock,0) > 0
  AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.inventory_id = ri.id AND l.stock_state = 'shadow');
