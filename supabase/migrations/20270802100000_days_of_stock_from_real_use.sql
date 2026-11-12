-- ===========================================================================
-- Days of stock come from what was really used
-- ===========================================================================
--
-- WHAT WAS WRONG (read at origin/fix/inventory-drawer-reads-right 7225fabc0's
-- child, on a local stack built from every migration, never production).
--
-- public.inventory_analytics (baseline:3332) is the one source of usage a day
-- (velocity_per_day) and days of cover for /inventory, its drawer, the cellar
-- and the count sheet. It measured usage from one thing only: ledger rows of
-- type 'sale' in the last 30 days, divided by 30. Four ways that misread a
-- house:
--
--   1. A food or a supply is never drawn by the till (no dish recipe is taken
--      from stock at a sale yet, ADR 0360), so its usage was 0 for ever and
--      its days of cover were never shown: 10 kg of flour counted down to
--      8.2 kg over three weeks read "Not known". The counts already record
--      what was used: stock_counts keeps every count, with the book figure
--      it corrected (a_count_is_a_record, ADR 0078).
--   2. A good the house started carrying 10 days ago that sold 10 read
--      10/30 = 0.33 a day, so its days of cover were three times too long.
--   3. A voided sale stays a sale: the void writes a 'return' row
--      (toast.service, pos-hub.service), which the view never read, so a
--      voided bottle still counted as sold.
--   4. dead_stock is "no sale in 90 days and some on hand", so every food on
--      a shelf was dead stock ("consider clearing it" on the count sheet).
--
-- WHAT THIS MIGRATION DOES. One CREATE OR REPLACE of the view, same columns
-- in the same order and types, four columns added at the end.
--
--   * Sales (a good the till drew in the last 90 days): sold = sales out
--     less voids back ('return' rows into stock), never below 0. Usage a
--     day = sold in 30 days / the days the house has carried it, at least 7
--     and at most 30 (the earlier of restaurant_inventory.created_at and its
--     first ledger row).
--   * Counts (a good the till did not draw in 90 days): between two live
--     counts at least 3 days apart, the later one in the last 90 days and
--     the earlier as close to 30 days before it as the counts allow, usage =
--     what was sold, wasted or given in between, plus every count gap in
--     between (a count that found less than the book is stock used and not
--     booked). That equals first count + received - last count, without
--     having to say which ledger types are deliveries. Usage a day = that /
--     the days between the two counts. Never below 0.
--   * Neither: usage 0 and usage_source NULL, exactly as before.
--   * dead_stock: as before, unless counts show the good is used; and a food
--     or supply is dead only when two counts show it unused, never because
--     the till does not sell it.
--   * New columns: usage_source ('sales' | 'counts' | NULL), usage_since,
--     usage_until (the window the figure covers) and usage_qty (what was used
--     in it, in the good's own unit), so a reader can say where the figure
--     came from.
--
-- Everything else is the baseline body: on_hand from inventory_lot_rollup,
-- days_of_cover, reorder_point, reorder_suggested, abc_class (90-day sales x
-- menu price) and days_since_sale keep their formulas over the new usage.
--
-- PER ITEM, NOT PER TABLE. The baseline aggregated the whole ledger before
-- joining it; the ledger and count reads are now LATERAL per item, on
-- idx_inv_txn_inventory and stock_counts_item_recent, so a house reading its
-- own rows reads its own ledger only.
--
-- CREATE OR REPLACE resets a view's reloptions (it cleared security_invoker on
-- the lot views once, see a_lot_cost_keeps_small_units), so the options and
-- grants the database holds are captured first, re-applied, and asserted
-- unchanged, with the existing columns. Re-running is safe. One transaction.
--
-- Decided under the founder's /goal of 2026-11-07 (the session's calls are in
-- the PR body): counts as the usage of a good the till does not draw; 3-day
-- minimum between counts; the 7-day floor on a new good's sales window.

BEGIN;

DO $mig$
DECLARE
  v_opts text[];
  v_acl text;
  v_cols text;
  v_after_opts text[];
  v_after_acl text;
  v_after_cols text;
BEGIN
  SELECT c.reloptions, coalesce(c.relacl, acldefault('r', c.relowner))::text
    INTO v_opts, v_acl
    FROM pg_class c WHERE c.oid = 'public.inventory_analytics'::regclass;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.inventory_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('usage_source', 'usage_since', 'usage_until', 'usage_qty');

  EXECUTE $view$
CREATE OR REPLACE VIEW public.inventory_analytics AS
 WITH base AS (
   SELECT ri.id AS inventory_id,
          ri.restaurant_id,
          COALESCE(r.live_qty, (0)::bigint) AS on_hand,
          GREATEST(COALESCE(l.out_30d, 0) - COALESCE(l.back_30d, 0), 0)::bigint AS sold_30d,
          GREATEST(COALESCE(l.out_90d, 0) - COALESCE(l.back_90d, 0), 0)::bigint AS sold_90d,
          l.last_sold_at,
          -- The days the 30-day sales window really covers: since the house
          -- started carrying it, at least 7 (a good's first days are noisy).
          GREATEST(7::numeric, LEAST(30::numeric,
            EXTRACT(epoch FROM now() - LEAST(ri.created_at, l.first_moved_at)) / 86400.0)) AS sales_days,
          cl.counted_at AS count_until,
          cf.counted_at AS count_since,
          GREATEST(COALESCE(cu.used_out, 0) - COALESCE(cu.gap, 0), 0)::numeric AS counted_used,
          COALESCE(ri.kind, 'wine') IN ('food', 'supply') AS kitchen_good,
          COALESCE(ri.menu_price_current, (0)::numeric) AS menu_price
     FROM public.restaurant_inventory ri
     LEFT JOIN public.inventory_lot_rollup r ON r.inventory_id = ri.id
     -- The good's own ledger: sales out, voids back, its first movement.
     LEFT JOIN LATERAL (
       SELECT sum(-t.quantity_change) FILTER (WHERE t.transaction_type = 'sale' AND t.quantity_change < 0 AND t.transaction_date > now() - '30 days'::interval) AS out_30d,
              sum(t.quantity_change)  FILTER (WHERE t.transaction_type = 'return' AND t.quantity_change > 0 AND t.transaction_date > now() - '30 days'::interval) AS back_30d,
              sum(-t.quantity_change) FILTER (WHERE t.transaction_type = 'sale' AND t.quantity_change < 0 AND t.transaction_date > now() - '90 days'::interval) AS out_90d,
              sum(t.quantity_change)  FILTER (WHERE t.transaction_type = 'return' AND t.quantity_change > 0 AND t.transaction_date > now() - '90 days'::interval) AS back_90d,
              max(t.transaction_date) FILTER (WHERE t.transaction_type = 'sale' AND t.quantity_change < 0) AS last_sold_at,
              min(t.transaction_date) AS first_moved_at
         FROM public.inventory_transactions t
        WHERE t.inventory_id = ri.id AND (t.stock_type)::text = 'live'
     ) l ON true
     -- The last live count in 90 days ...
     LEFT JOIN LATERAL (
       SELECT sc.counted_at
         FROM public.stock_counts sc
        WHERE sc.inventory_id = ri.id AND sc.stock_state = 'live'
          AND sc.counted_at > now() - '90 days'::interval
        ORDER BY sc.counted_at DESC
        LIMIT 1
     ) cl ON true
     -- ... and an earlier one at least 3 days before it: the earliest within
     -- 30 days of it, else the latest before that (still within 90 days).
     LEFT JOIN LATERAL (
       SELECT sc.counted_at
         FROM public.stock_counts sc
        WHERE sc.inventory_id = ri.id AND sc.stock_state = 'live'
          AND sc.counted_at > now() - '90 days'::interval
          AND sc.counted_at <= cl.counted_at - '3 days'::interval
        ORDER BY (sc.counted_at >= cl.counted_at - '30 days'::interval) DESC,
                 CASE WHEN sc.counted_at >= cl.counted_at - '30 days'::interval THEN sc.counted_at END ASC,
                 sc.counted_at DESC
        LIMIT 1
     ) cf ON true
     -- What was used between them: sold, wasted or given, and every count
     -- gap after the first count up to and including the last.
     LEFT JOIN LATERAL (
       SELECT (SELECT sum(-t.quantity_change)
                 FROM public.inventory_transactions t
                WHERE t.inventory_id = ri.id AND (t.stock_type)::text = 'live'
                  AND t.transaction_type IN ('sale', 'waste', 'comp') AND t.quantity_change < 0
                  AND t.transaction_date > cf.counted_at AND t.transaction_date <= cl.counted_at) AS used_out,
              (SELECT sum(sc.variance_qty)
                 FROM public.stock_counts sc
                WHERE sc.inventory_id = ri.id AND sc.stock_state = 'live'
                  AND sc.counted_at > cf.counted_at AND sc.counted_at <= cl.counted_at) AS gap
        WHERE cf.counted_at IS NOT NULL
     ) cu ON true
    WHERE COALESCE(ri.is_active, true)
 ), used AS (
   SELECT base.*,
          CASE WHEN base.sold_90d > 0 THEN 'sales'
               WHEN base.count_since IS NOT NULL THEN 'counts'
          END AS usage_source,
          CASE WHEN base.sold_90d > 0 THEN base.sold_30d::numeric / base.sales_days
               WHEN base.count_since IS NOT NULL
                 THEN base.counted_used / (EXTRACT(epoch FROM base.count_until - base.count_since) / 86400.0)
               ELSE 0::numeric
          END AS velocity_per_day
     FROM base
 ), ranked AS (
   SELECT used.*,
          sum(((used.sold_90d)::numeric * used.menu_price)) OVER (PARTITION BY used.restaurant_id) AS total_value,
          sum(((used.sold_90d)::numeric * used.menu_price)) OVER (PARTITION BY used.restaurant_id ORDER BY ((used.sold_90d)::numeric * used.menu_price) DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value
     FROM used
 )
 SELECT inventory_id,
    restaurant_id,
    on_hand,
    sold_30d,
    sold_90d,
    last_sold_at,
    round(velocity_per_day, 3) AS velocity_per_day,
        CASE
            WHEN (velocity_per_day > (0)::numeric) THEN round(((on_hand)::numeric / velocity_per_day))
            ELSE NULL::numeric
        END AS days_of_cover,
        CASE
            WHEN (velocity_per_day > (0)::numeric) THEN GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric)))
            ELSE NULL::numeric
        END AS reorder_point,
    ((velocity_per_day > (0)::numeric) AND ((on_hand)::numeric <= GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric))))) AS reorder_suggested,
        CASE
            WHEN (total_value = (0)::numeric) THEN NULL::text
            WHEN (cum_value <= (0.80 * total_value)) THEN 'A'::text
            WHEN (cum_value <= (0.95 * total_value)) THEN 'B'::text
            ELSE 'C'::text
        END AS abc_class,
    (on_hand > 0
       AND (last_sold_at IS NULL OR last_sold_at < (now() - '90 days'::interval))
       AND NOT COALESCE(usage_source = 'counts' AND velocity_per_day > (0)::numeric, false)
       AND (NOT kitchen_good OR COALESCE(usage_source = 'counts', false))) AS dead_stock,
        CASE
            WHEN (last_sold_at IS NOT NULL) THEN (EXTRACT(day FROM (now() - last_sold_at)))::integer
            ELSE NULL::integer
        END AS days_since_sale,
    usage_source,
    CASE WHEN usage_source = 'sales' THEN now() - make_interval(secs => (sales_days * 86400)::double precision)
         WHEN usage_source = 'counts' THEN count_since
    END AS usage_since,
    CASE WHEN usage_source = 'sales' THEN now()
         WHEN usage_source = 'counts' THEN count_until
    END AS usage_until,
    CASE WHEN usage_source = 'sales' THEN sold_30d::numeric
         WHEN usage_source = 'counts' THEN counted_used
    END AS usage_qty
   FROM ranked
$view$;

  -- Put back what CREATE OR REPLACE reset, then prove nothing else moved.
  IF v_opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.inventory_analytics SET (%s)', array_to_string(v_opts, ', '));
  END IF;
  SELECT c.reloptions, coalesce(c.relacl, acldefault('r', c.relowner))::text
    INTO v_after_opts, v_after_acl
    FROM pg_class c WHERE c.oid = 'public.inventory_analytics'::regclass;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_after_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.inventory_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('usage_source', 'usage_since', 'usage_until', 'usage_qty');
  IF v_after_opts IS DISTINCT FROM v_opts THEN
    RAISE EXCEPTION 'days_of_stock_from_real_use: reloptions changed (% -> %)', v_opts, v_after_opts;
  END IF;
  IF v_after_acl IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'days_of_stock_from_real_use: grants changed (% -> %)', v_acl, v_after_acl;
  END IF;
  IF v_after_cols IS DISTINCT FROM v_cols THEN
    RAISE EXCEPTION 'days_of_stock_from_real_use: existing columns changed (% -> %)', v_cols, v_after_cols;
  END IF;
END
$mig$;

COMMENT ON COLUMN public.inventory_analytics.usage_source IS
  'Where velocity_per_day comes from: sales (the till drew it in 90 days; net of voids, over the days carried, 7 to 30), counts (two live counts at least 3 days apart: sold + wasted + given + count gaps between them), or NULL (neither; velocity 0).';
COMMENT ON COLUMN public.inventory_analytics.usage_qty IS
  'What was used between usage_since and usage_until, in the good''s own unit (restaurant_inventory.uom).';

COMMIT;
