-- A kitchen good's use reads all of it, and a new good's pace is not diluted.
--
-- Redefines inventory_analytics as days_of_stock_from_real_use left it, with
-- two changes (inventory r36 audit, gaps 3 and 10). Same columns, order and
-- types; options, grants and columns are captured, re-applied and asserted
-- unchanged, as that migration does.
--
--   * Counts before sales. A food or a supply with a count window (two live
--     counts 3+ days apart, the later in 30 days) reads its use from the
--     counts even when the till drew it. Before, any sale row in 90 days won:
--     once a recipe draw books a cocktail's lime as a 'sale'
--     (record_recipe_draw, recipe draw slice 3b), lime's pace would have read
--     the cocktail draws alone and dropped every dish's use and every
--     write-off, so "Days left" read many times too long and below-par
--     warnings stopped. The counts already hold those draws (they are booked
--     out between the counts, and cover subtracts the ones since the last
--     count), so nothing is counted twice. Only a food or a supply has a count
--     window, so a drink is unchanged: its shrink between counts is loss.
--   * The sales window is the days carried, 1 to 30 (was 7 to 30). Two
--     bottles sold on a good's first day read 2 a day, not 0.29, and
--     usage_since is the day it was first carried, so "sold in the last N
--     days" names the real window. A good carried 30 days or more is
--     unchanged.
--
-- The session's calls under the founder's /goal of 2026-11-07 (PR body):
-- counts over sales for a kitchen good, rather than adding the two sources or
-- keying on a current dish recipe; a 1-day floor rather than 7 or 3.

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
          -- Days the 30-day window covers since it was first carried, 1 to 30.
          GREATEST(1::numeric, LEAST(30::numeric,
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
          -- Counts first: only a food or a supply has a count window, and its
          -- counts hold all of its use, the till's draws among it.
          CASE WHEN base.count_since IS NOT NULL AND base.counted_used >= 0 THEN 'counts'
               WHEN base.sold_90d > 0 THEN 'sales'
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
    RAISE EXCEPTION 'a_kitchen_goods_use_reads_its_counts: reloptions changed (% -> %)', v_opts, v_after_opts;
  END IF;
  IF v_after_acl IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'a_kitchen_goods_use_reads_its_counts: grants changed (% -> %)', v_acl, v_after_acl;
  END IF;
  IF v_after_cols IS DISTINCT FROM v_cols THEN
    RAISE EXCEPTION 'a_kitchen_goods_use_reads_its_counts: existing columns changed (% -> %)', v_cols, v_after_cols;
  END IF;
END
$mig$;

COMMENT ON COLUMN public.inventory_analytics.usage_source IS
  'Where velocity_per_day comes from: counts (a food or supply: first count + arrived - last count, counts 3+ days apart, the later in 30 days; it wins over sales, since it holds the till''s draws too), sales (net of voids, over the days carried, 1 to 30), or NULL (neither; velocity 0). See migrations days_of_stock_from_real_use and a_kitchen_goods_use_reads_its_counts.';
COMMENT ON COLUMN public.inventory_analytics.usage_qty IS
  'What was used between usage_since and usage_until, in the good''s own unit (restaurant_inventory.uom).';

COMMIT;
