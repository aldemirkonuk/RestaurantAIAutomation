-- Every good the house carries can run low, not only a wine.
--
-- v_low_stock_items INNER JOINed master_wine_library
-- (20260805000000_baseline_from_production.sql:6045), so a row with no wine
-- library link was dropped before its stock was ever compared with its par.
-- Since the house item became the ledger's key
-- (20260903171000_the_house_item_is_the_ledgers_key.sql: master_wine_id is
-- nullable, every row has kind, uom and display_name, all NOT NULL), a beer,
-- a spirit, a flour or a crate of lemons below its par alerted nowhere: not
-- the inbox, not the dashboard, not the MCP inventory.low_stock tool, not the
-- low-stock digest email. Each of those reads this view.
--
-- What changes, and only this:
--   * The wine library is a LEFT JOIN. A row with no library link is kept.
--   * wine_name is the library name, else the house's own name for the good
--     (display_name). Same column, same type (varchar(255)), so no reader
--     breaks: a wine reads exactly as before, a flour reads "Flour".
--   * Three columns are APPENDED (CREATE OR REPLACE VIEW may only append):
--       last_counted_at  null means nobody has counted it yet. Same position
--                        (41) and type as the open PR that adds it
--                        (a_received_wine_not_counted_yet_can_run_low), so the
--                        two definitions differ only in their WHERE and in the
--                        two columns after it.
--       kind             what the good is (wine, beer, food, ...).
--       uom              the unit its stock AND its par are written in.
--   The 40 columns before them keep their names, types and order.
--
-- Units. ADR 0070: quantities are integers and the unit belongs to the item,
-- which is restaurant_inventory.uom. stock_live and threshold_min are two
-- columns of the SAME row, so "below par" compares grams with grams and
-- bottles with bottles by construction; nothing here converts or mixes units.
-- uom is exposed so a reader can say "200 g, par 500 g" instead of calling a
-- flour's grams bottles.
--
-- The predicate is unchanged: below par is stock_live < threshold_min,
-- strictly (ADR 0129); active, not deleted, not IN_TRANSIT. Tenant scope is
-- the caller's: every reader filters restaurant_id, and the view is
-- security_invoker, so restaurant_inventory's RLS applies to whoever reads it.
--
-- CREATE OR REPLACE VIEW replaces the view's reloptions with the ones it
-- names, so security_invoker (od72_revoke_client_grants) is named again.
-- Grants survive a replace; they are restated anyway so this file alone says
-- who may read it: the service role (the gateway) and no browser role.
--
-- Rollback: re-run the baseline's CREATE VIEW body after
-- DROP VIEW public.v_low_stock_items (a replace cannot drop the three
-- appended columns).

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
    (COALESCE(mw.name, ri.display_name))::character varying(255) AS wine_name,
    mw.producer,
    mw.vintage,
    r.name AS restaurant_name,
    ri.last_counted_at,
    ri.kind,
    ri.uom
   FROM ((public.restaurant_inventory ri
     LEFT JOIN public.master_wine_library mw ON ((ri.master_wine_id = mw.id)))
     JOIN public.restaurants r ON ((ri.restaurant_id = r.id)))
  WHERE ((ri.stock_live < ri.threshold_min) AND (ri.is_active = true) AND (ri.deleted_at IS NULL) AND ((ri.inventory_state)::text <> 'IN_TRANSIT'::text));

COMMENT ON VIEW public.v_low_stock_items IS
  'Every active, undeleted, not-in-transit house good (wine or not) with '
  'stock_live < threshold_min, strictly (ADR 0129). wine_name is the wine '
  'library name, else the house''s own name for the good. stock_live and '
  'threshold_min are both in the row''s uom (ADR 0070); a reader shows that '
  'unit. last_counted_at null means not counted yet. security_invoker, so '
  'restaurant_inventory''s RLS applies to the caller.';

REVOKE ALL ON public.v_low_stock_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_low_stock_items TO service_role;
