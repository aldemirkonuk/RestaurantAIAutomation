-- OD-161 (rule half): a wine nobody has counted is unknown, not zero.
--
-- `restaurant_inventory.stock_live` defaults to 0 and `threshold_min` to 3
-- (baseline_from_production), and menu linking inserts a row with no count, so
-- `stock_live < threshold_min` was true of every wine the house had never
-- counted, and each one became a "Low Stock" alert reading "0 bottles".
--
-- `last_counted_at` is stamped only by `record_stock_count()`, in the same
-- transaction as its `stock_counts` row (a_count_is_a_record). This view now
-- keeps only rows that have been counted at least once. The /promotions
-- "Running low" chip already uses the same test (offer-scope.ts).
--
-- Same columns, same order, so CREATE OR REPLACE is allowed. CREATE OR REPLACE
-- replaces the view's reloptions with the ones it names, so security_invoker
-- (set on every public view by od72_revoke_client_grants) is named again here.
-- Grants are kept by CREATE OR REPLACE.

CREATE OR REPLACE VIEW public.v_low_stock_items
  WITH (security_invoker = true) AS
 SELECT ri.id,
    ri.restaurant_id,
    ri.master_wine_id,
    ri.provider_id,
    ri.stock_live,
    ri.physical_stock,
    ri.shadow_stock,
    ri.expected_stock,
    ri.in_transit_quantity,
    ri.threshold_min,
    ri.validation_max,
    ri.buffer_window_minutes,
    ri.inventory_state,
    ri.last_alerted_at,
    ri.last_alert_level,
    ri.alert_count,
    ri.last_manual_edit_at,
    ri.last_manual_edit_by,
    ri.manual_edit_reason,
    ri.custom_price,
    ri.last_purchase_price,
    ri.negotiated_price,
    ri.margin_percentage,
    ri.sales_velocity_30d,
    ri.sales_velocity_7d,
    ri.last_sold_at,
    ri.times_ordered_count,
    ri.total_revenue,
    ri.expected_delivery_date,
    ri.last_delivery_date,
    ri.is_active,
    ri.menu_section,
    ri.menu_position,
    ri.created_at,
    ri.updated_at,
    ri.deleted_at,
    mw.name AS wine_name,
    mw.producer,
    mw.vintage,
    r.name AS restaurant_name
   FROM ((public.restaurant_inventory ri
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
     JOIN public.restaurants r ON ((ri.restaurant_id = r.id)))
  WHERE ((ri.stock_live < ri.threshold_min)
     AND (ri.is_active = true)
     AND (ri.deleted_at IS NULL)
     AND ((ri.inventory_state)::text <> 'IN_TRANSIT'::text)
     AND (ri.last_counted_at IS NOT NULL));

COMMENT ON VIEW public.v_low_stock_items IS
  'Active, undeleted, not-in-transit rows with stock_live < threshold_min that '
  'have been counted at least once (last_counted_at IS NOT NULL). A row never '
  'counted is unknown, not zero (OD-161).';
