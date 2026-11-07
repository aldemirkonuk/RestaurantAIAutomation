-- OD-161, second half of the rule: a wine nobody has counted is unknown, not
-- zero, UNLESS receipts and sales have given it a figure.
--
-- an_uncounted_wine_is_not_low_stock made v_low_stock_items keep only rows
-- with last_counted_at set. That closed the false "0 bottles" alert for every
-- wine a menu linked but nobody stocked, and opened a quieter hole: a wine
-- received through apply_stock_movement and then sold, without ever being
-- counted, could never alert, however low it ran (QA round 4, built in
-- PGlite: received 10, sold 8, par 3, not in the view).
--
-- The rule now: a row is in the view when it is below par AND either somebody
-- counted it, or at least one live stock movement has been written for it.
-- stock_live is the sum of the row's live lots (trg_project_stock_from_lots),
-- and every lot is made or drawn by apply_stock_movement (or a function that
-- calls it), which writes an inventory_transactions row each time. So a row
-- with a live movement and no count holds received minus sold: a computed
-- figure, not a guess. A row with neither still holds the column default 0,
-- which means nothing, and stays out.
--
-- "Below par" is still stock_live < threshold_min, strictly (ADR 0129).
--
-- last_counted_at is added as the LAST column so readers can say "not counted
-- yet" beside the figure. CREATE OR REPLACE VIEW may only append columns; the
-- 40 columns before it keep their names, types and order.
--
-- CREATE OR REPLACE replaces the view's reloptions with the ones it names, so
-- security_invoker (od72_revoke_client_grants) is named again. Grants are kept.
-- The EXISTS runs as the caller; the gateway reads this view with the service
-- role, and anon/authenticated have no SELECT on it.

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
    r.name AS restaurant_name,
    ri.last_counted_at
   FROM ((public.restaurant_inventory ri
     JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
     JOIN public.restaurants r ON ((ri.restaurant_id = r.id)))
  WHERE ((ri.stock_live < ri.threshold_min)
     AND (ri.is_active = true)
     AND (ri.deleted_at IS NULL)
     AND ((ri.inventory_state)::text <> 'IN_TRANSIT'::text)
     AND ((ri.last_counted_at IS NOT NULL)
       OR (EXISTS ( SELECT 1
               FROM public.inventory_transactions t
              WHERE ((t.inventory_id = ri.id)
                AND ((t.stock_type)::text = 'live'::text))))));

COMMENT ON VIEW public.v_low_stock_items IS
  'Active, undeleted, not-in-transit rows with stock_live < threshold_min '
  '(strictly, ADR 0129) whose figure is known: counted at least once '
  '(last_counted_at IS NOT NULL), or given a figure by at least one live stock '
  'movement (receipts and sales). A row with neither is unknown, not zero '
  '(OD-161). last_counted_at is the last column: null means the figure is '
  'received minus sold, not counted yet.';
