-- Phase 2 read-cutover support (ADDITIVE). Lots stay accurate while the app still writes
-- stock_live directly; reads can derive WAC/on-hand/location from lots safely.
-- Applied to project exzueerziesmczwlhomd on 2026-07-10 (also recorded via MCP migration history).
-- See .planning/INVENTORY_SOTA_PLAN.md §6a / §12 (count-as-truth, dual-run transition).

-- 1. Rollup view: per-inventory derived on-hand, WAC (only over lots with known cost), locations.
CREATE OR REPLACE VIEW inventory_lot_rollup AS
SELECT
  inventory_id,
  restaurant_id,
  master_wine_id,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live'), 0)   AS live_qty,
  COALESCE(SUM(qty) FILTER (WHERE stock_state = 'shadow'), 0) AS shadow_qty,
  CASE
    WHEN COALESCE(SUM(qty) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL), 0) > 0
    THEN ROUND(
      SUM(qty * unit_cost) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL)
      / SUM(qty) FILTER (WHERE stock_state = 'live' AND unit_cost IS NOT NULL), 2)
    ELSE NULL
  END AS wac,
  bool_or(cost_provenance = 'invoice') FILTER (WHERE stock_state = 'live') AS has_invoice_cost,
  count(*) FILTER (WHERE stock_state = 'live') AS live_lot_count,
  count(DISTINCT location_id) FILTER (WHERE stock_state = 'live' AND location_id IS NOT NULL) AS live_location_count
FROM inventory_lots
GROUP BY inventory_id, restaurant_id, master_wine_id;

COMMENT ON VIEW inventory_lot_rollup IS 'Phase 2 read model: per-inventory live/shadow on-hand, WAC (over cost-known live lots only), and location spread derived from inventory_lots.';

-- 2. Dual-run sync trigger: mirror stock_live/shadow_stock writes into the wine's lots so
-- lot-derived reads never go stale during the transition. TRANSITION-ONLY: removed at the
-- write-path cutover, when lots become the source of truth and this direction reverses.
CREATE OR REPLACE FUNCTION sync_lots_from_inventory() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_live IS DISTINCT FROM OLD.stock_live THEN
    UPDATE inventory_lots SET qty = GREATEST(COALESCE(NEW.stock_live, 0), 0), updated_at = now()
      WHERE inventory_id = NEW.id AND stock_state = 'live';
    IF NOT FOUND AND COALESCE(NEW.stock_live, 0) > 0 THEN
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, cost_provenance)
      VALUES (NEW.restaurant_id, NEW.id, NEW.master_wine_id, 'live', NEW.stock_live, 'estimated');
    END IF;
  END IF;
  IF NEW.shadow_stock IS DISTINCT FROM OLD.shadow_stock THEN
    UPDATE inventory_lots SET qty = GREATEST(COALESCE(NEW.shadow_stock, 0), 0), updated_at = now()
      WHERE inventory_id = NEW.id AND stock_state = 'shadow';
    IF NOT FOUND AND COALESCE(NEW.shadow_stock, 0) > 0 THEN
      INSERT INTO inventory_lots (restaurant_id, inventory_id, master_wine_id, stock_state, qty, cost_provenance)
      VALUES (NEW.restaurant_id, NEW.id, NEW.master_wine_id, 'shadow', NEW.shadow_stock, 'estimated');
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_lots_from_inventory ON restaurant_inventory;
CREATE TRIGGER trg_sync_lots_from_inventory
  AFTER UPDATE OF stock_live, shadow_stock ON restaurant_inventory
  FOR EACH ROW EXECUTE FUNCTION sync_lots_from_inventory();
