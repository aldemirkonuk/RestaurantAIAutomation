-- Days of stock come from what was really used.
--
-- inventory_analytics (baseline:3332), the one source of usage a day and days
-- of cover, read only 'sale' rows of 30 days / 30: a food or supply (not drawn
-- by the till, ADR 0360) read 0 for ever; a good carried 10 days read a third
-- of its pace; a void still counted; every food on a shelf was dead stock.
--
-- One CREATE OR REPLACE: same columns, order and types, four added at the end.
--
--   * Sales (the till drew it in 90 days): sold = sales less voids back,
--     never below 0; usage a day = sold in 30 days / the days carried, 7 to 30.
--   * Counts (a food or supply the till did not draw in 90 days; a drink's
--     shrink is loss, not use): two live counts 3+ days apart, the later in
--     the last 30 days, the earlier near 30 days before it:
--
--         used = first count + arrived - last count
--
--     "Arrived": purchase, initial, a transfer leg, any source 'order' row
--     (door corrections, delivery reversals), a 'return' out to the vendor.
--     Every other row (sale, void, waste, comp, override, a count's own
--     correction) is use or a book fix the counts already hold. Counts that
--     found more than arrived (an unbooked delivery): not measured.
--   * A counted good's book is not drawn between counts, so its days of cover
--     and reorder suggestion read what is left: on hand less (usage a day x
--     days since the last count, less what was booked out since), >= 0.
--   * Neither: usage 0 and usage_source NULL, as before.
--   * dead_stock: as before, unless counts show use; a food or supply is dead
--     only when two counts show it unused, never for want of a sale.
--   * New: usage_source ('sales' | 'counts' | NULL), usage_since/until, usage_qty.
--
-- Reads are LATERAL per item. CREATE OR REPLACE resets reloptions, so options,
-- grants and existing columns are captured, re-applied and asserted unchanged.
--
-- The session's calls under the founder's /goal of 2026-11-07 (PR body):
-- counts for a food or supply only; 3 days between counts; the last count
-- within 30 days; which rows are arrivals; cover from what is left since the
-- last count; the 7-day floor on a new good's sales window.

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
          -- Days the 30-day window covers since it was first carried, >= 7.
          GREATEST(7::numeric, LEAST(30::numeric,
            EXTRACT(epoch FROM now() - LEAST(ri.created_at, l.first_moved_at)) / 86400.0)) AS sales_days,
          cl.counted_at AS count_until,
          cf.counted_at AS count_since,
          (cf.counted_qty + COALESCE(cu.arrived, 0) - cl.counted_qty)::numeric AS counted_used,
          GREATEST(COALESCE(cu.booked_out, 0), 0)::numeric AS booked_since,
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
     -- A food's or a supply's last live count in 30 days ...
     LEFT JOIN LATERAL (
       SELECT sc.counted_at, sc.counted_qty
         FROM public.stock_counts sc
        WHERE sc.inventory_id = ri.id AND sc.stock_state = 'live'
          AND COALESCE(ri.kind, 'wine') IN ('food', 'supply')
          AND sc.counted_at > now() - '30 days'::interval
        ORDER BY sc.counted_at DESC
        LIMIT 1
     ) cl ON true
     -- ... and one 3+ days before it: the earliest within 30 days of it, else
     -- the latest before that (within 90 days).
     LEFT JOIN LATERAL (
       SELECT sc.counted_at, sc.counted_qty
         FROM public.stock_counts sc
        WHERE sc.inventory_id = ri.id AND sc.stock_state = 'live'
          AND sc.counted_at > now() - '90 days'::interval
          AND sc.counted_at <= cl.counted_at - '3 days'::interval
        ORDER BY (sc.counted_at >= cl.counted_at - '30 days'::interval) DESC,
                 CASE WHEN sc.counted_at >= cl.counted_at - '30 days'::interval THEN sc.counted_at END ASC,
                 sc.counted_at DESC
        LIMIT 1
     ) cf ON true
     -- What arrived between the counts (the only rows they do not already
     -- hold), and what the book took off since the last one otherwise.
     LEFT JOIN LATERAL (
       SELECT sum(t.quantity_change) FILTER (WHERE k.arrival AND t.transaction_date <= cl.counted_at) AS arrived,
              sum(-t.quantity_change) FILTER (WHERE NOT k.arrival AND t.transaction_date > cl.counted_at) AS booked_out
         FROM public.inventory_transactions t
        CROSS JOIN LATERAL (SELECT t.transaction_type IN ('purchase', 'initial', 'transfer')
                                   OR (t.source)::text = 'order'
                                   OR (t.transaction_type = 'return' AND t.quantity_change < 0) AS arrival) k
        WHERE cl.counted_at IS NOT NULL
          AND t.inventory_id = ri.id AND (t.stock_type)::text = 'live'
          AND t.transaction_date > COALESCE(cf.counted_at, cl.counted_at)
     ) cu ON true
    WHERE COALESCE(ri.is_active, true)
 ), sourced AS (
   SELECT base.*,
          CASE WHEN base.sold_90d > 0 THEN 'sales'
               WHEN base.count_since IS NOT NULL AND base.counted_used >= 0 THEN 'counts'
          END AS usage_source
     FROM base
 ), paced AS (
   SELECT sourced.*,
          CASE WHEN usage_source = 'sales' THEN sold_30d::numeric / sales_days
               WHEN usage_source = 'counts'
                 THEN counted_used / (EXTRACT(epoch FROM count_until - count_since) / 86400.0)
               ELSE 0::numeric
          END AS velocity_per_day
     FROM sourced
 ), used AS (
   -- A counted good's book less the use since its last count not yet booked.
   SELECT paced.*,
          CASE WHEN usage_source = 'counts'
                 THEN GREATEST(on_hand::numeric - GREATEST(
                        velocity_per_day * (EXTRACT(epoch FROM now() - count_until) / 86400.0) - booked_since, 0), 0)
               ELSE on_hand::numeric
          END AS cover_qty
     FROM paced
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
            WHEN (velocity_per_day > (0)::numeric) THEN round((cover_qty / velocity_per_day))
            ELSE NULL::numeric
        END AS days_of_cover,
        CASE
            WHEN (velocity_per_day > (0)::numeric) THEN GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric)))
            ELSE NULL::numeric
        END AS reorder_point,
    ((velocity_per_day > (0)::numeric) AND (cover_qty <= GREATEST((1)::numeric, ceil((velocity_per_day * (10)::numeric))))) AS reorder_suggested,
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
  'Where velocity_per_day comes from: sales (net of voids, over the days carried, 7 to 30), counts (a food or supply: first count + arrived - last count, counts 3+ days apart, the later in 30 days), or NULL (neither; velocity 0). See migration days_of_stock_from_real_use.';
COMMENT ON COLUMN public.inventory_analytics.usage_qty IS
  'What was used between usage_since and usage_until, in the good''s own unit (restaurant_inventory.uom).';

COMMIT;
