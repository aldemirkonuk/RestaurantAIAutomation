-- Phase 2 (2d/2e): velocity, days-of-cover, reorder point, ABC class, dead-stock — derived from
-- the ledger 'sale' rows (bottle-equivalent depletion, incl. bottles opened for glass pours).
-- Honest by design (D14): a days-of-supply reorder point, NOT a fake z*sigma*sqrt(LT) with no data.
-- Empty until sales accrue; degrades gracefully (velocity 0 -> days_of_cover NULL, no reorder).
-- Applied to prod exzueerziesmczwlhomd on 2026-07-10 (also via MCP migration history).
CREATE OR REPLACE VIEW inventory_analytics AS
WITH sales AS (
  SELECT inventory_id,
    SUM(-quantity_change) FILTER (WHERE transaction_date > now() - interval '30 days') AS sold_30d,
    SUM(-quantity_change) FILTER (WHERE transaction_date > now() - interval '90 days') AS sold_90d,
    MAX(transaction_date) AS last_sold_at
  FROM inventory_transactions
  WHERE transaction_type = 'sale' AND stock_type = 'live' AND quantity_change < 0
  GROUP BY inventory_id
),
base AS (
  SELECT ri.id AS inventory_id, ri.restaurant_id,
    COALESCE(r.live_qty,0) AS on_hand,
    COALESCE(s.sold_30d,0) AS sold_30d,
    COALESCE(s.sold_90d,0) AS sold_90d,
    s.last_sold_at,
    COALESCE(s.sold_30d,0)/30.0 AS velocity_per_day,
    COALESCE(ri.menu_price_current, 0) AS menu_price
  FROM restaurant_inventory ri
  LEFT JOIN inventory_lot_rollup r ON r.inventory_id = ri.id
  LEFT JOIN sales s ON s.inventory_id = ri.id
  WHERE COALESCE(ri.is_active, true)
),
ranked AS (
  SELECT *,
    SUM(sold_90d * menu_price) OVER (PARTITION BY restaurant_id) AS total_value,
    SUM(sold_90d * menu_price) OVER (
      PARTITION BY restaurant_id ORDER BY (sold_90d*menu_price) DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value
  FROM base
)
SELECT
  inventory_id, restaurant_id, on_hand, sold_30d, sold_90d, last_sold_at,
  ROUND(velocity_per_day::numeric, 3) AS velocity_per_day,
  CASE WHEN velocity_per_day > 0 THEN ROUND(on_hand / velocity_per_day) ELSE NULL END AS days_of_cover,
  CASE WHEN velocity_per_day > 0 THEN GREATEST(1, CEIL(velocity_per_day * 10)) ELSE NULL END AS reorder_point,  -- 7d lead + 3d safety
  (velocity_per_day > 0 AND on_hand <= GREATEST(1, CEIL(velocity_per_day * 10))) AS reorder_suggested,
  CASE
    WHEN total_value = 0 THEN NULL
    WHEN cum_value <= 0.80 * total_value THEN 'A'
    WHEN cum_value <= 0.95 * total_value THEN 'B'
    ELSE 'C'
  END AS abc_class,
  ((last_sold_at IS NULL OR last_sold_at < now() - interval '90 days') AND on_hand > 0) AS dead_stock,
  CASE WHEN last_sold_at IS NOT NULL THEN EXTRACT(day FROM now() - last_sold_at)::int ELSE NULL END AS days_since_sale
FROM ranked;

COMMENT ON VIEW inventory_analytics IS 'Phase 2 (2d/2e): per-wine velocity, days-of-cover, days-of-supply reorder point, ABC class, dead-stock. Sourced from ledger sale rows; honest/graceful when data is sparse.';
