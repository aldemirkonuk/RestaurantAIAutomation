-- inventory_analytics: a voided sale is not demand, and a new wine's rate is
-- taken over the days it has been on the list (wave-23 sim, F-686 and F-687).
--
-- F-686. The view summed only `transaction_type = 'sale'` rows. A POS void is
-- booked as a 'return' with a POSITIVE delta, source 'pos' (pos-hub.service.ts
-- and toast.service.ts, `isVoid ? "return" : "sale"`), so four bottles rung up
-- and voided still read as four sold: velocity up, cover down, and
-- reorder_suggested could switch on for bottles nobody drank. A POS return now
-- nets out of sold_30d / sold_90d in the window it is dated in, floored at 0
-- (a void dated in the window for a sale dated before it must not make demand
-- negative). Only source 'pos' returns are netted: a 'return' booked by hand
-- is a bottle coming back for another reason, not an undone sale.
-- last_sold_at still dates the last SALE row; it says when a bottle last went
-- out, which a later void does not change.
--
-- F-687. velocity_per_day was sold_30d / 30 for every row. A wine listed three
-- days ago selling two a day read 0.2/day: ten times the runway, a tenth of the
-- reorder point. The divisor is now the days the wine has been on the list,
-- capped at the 30-day window: LEAST(30, days since the earlier of the row's
-- created_at and its first ledger movement), at least 1. The listing day
-- counts as day 1. A row with neither (should not exist) keeps the full 30.
-- Two columns are appended so a reader can say so:
--   velocity_days  the days the rate is averaged over (1..30)
--   is_new         fewer than 7 days on the list: the rate is too young to
--                  plan on, and the page says "new" beside it.
--
-- CREATE OR REPLACE keeps every existing column, name, type and position
-- (Postgres refuses otherwise) and only appends the two new ones, so
-- `select *` readers and the gateway's explicit column list keep working.
-- Version assigned by the sim fix lane note (20270103600000).

CREATE OR REPLACE VIEW public.inventory_analytics AS
 WITH sales AS (
         SELECT t.inventory_id,
            GREATEST((0)::bigint, COALESCE(sum((- t.quantity_change)) FILTER (WHERE (t.transaction_date > (now() - '30 days'::interval))), (0)::bigint)) AS sold_30d,
            GREATEST((0)::bigint, COALESCE(sum((- t.quantity_change)) FILTER (WHERE (t.transaction_date > (now() - '90 days'::interval))), (0)::bigint)) AS sold_90d,
            max(t.transaction_date) FILTER (WHERE (t.transaction_type = 'sale'::public.inventory_transaction_type)) AS last_sold_at
           FROM public.inventory_transactions t
          WHERE (((t.stock_type)::text = 'live'::text) AND (((t.transaction_type = 'sale'::public.inventory_transaction_type) AND (t.quantity_change < 0)) OR ((t.transaction_type = 'return'::public.inventory_transaction_type) AND (t.source = 'pos'::public.inventory_transaction_source) AND (t.quantity_change > 0))))
          GROUP BY t.inventory_id
        ), first_moves AS (
         SELECT inventory_transactions.inventory_id,
            min(inventory_transactions.transaction_date) AS first_moved_at
           FROM public.inventory_transactions
          GROUP BY inventory_transactions.inventory_id
        ), aged AS (
         SELECT ri.id AS inventory_id,
            LEAST((30)::numeric, GREATEST((1)::numeric, COALESCE((floor((EXTRACT(epoch FROM (now() - LEAST(ri.created_at, f.first_moved_at))) / (86400)::numeric)) + (1)::numeric), (30)::numeric))) AS velocity_days
           FROM (public.restaurant_inventory ri
             LEFT JOIN first_moves f ON ((f.inventory_id = ri.id)))
        ), base AS (
         SELECT ri.id AS inventory_id,
            ri.restaurant_id,
            COALESCE(r.live_qty, (0)::bigint) AS on_hand,
            COALESCE(s.sold_30d, (0)::bigint) AS sold_30d,
            COALESCE(s.sold_90d, (0)::bigint) AS sold_90d,
            s.last_sold_at,
            ((COALESCE(s.sold_30d, (0)::bigint))::numeric / a.velocity_days) AS velocity_per_day,
            COALESCE(ri.menu_price_current, (0)::numeric) AS menu_price,
            a.velocity_days
           FROM (((public.restaurant_inventory ri
             JOIN aged a ON ((a.inventory_id = ri.id)))
             LEFT JOIN public.inventory_lot_rollup r ON ((r.inventory_id = ri.id)))
             LEFT JOIN sales s ON ((s.inventory_id = ri.id)))
          WHERE COALESCE(ri.is_active, true)
        ), ranked AS (
         SELECT base.inventory_id,
            base.restaurant_id,
            base.on_hand,
            base.sold_30d,
            base.sold_90d,
            base.last_sold_at,
            base.velocity_per_day,
            base.menu_price,
            base.velocity_days,
            sum(((base.sold_90d)::numeric * base.menu_price)) OVER (PARTITION BY base.restaurant_id) AS total_value,
            sum(((base.sold_90d)::numeric * base.menu_price)) OVER (PARTITION BY base.restaurant_id ORDER BY ((base.sold_90d)::numeric * base.menu_price) DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_value
           FROM base
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
    (((last_sold_at IS NULL) OR (last_sold_at < (now() - '90 days'::interval))) AND (on_hand > 0)) AS dead_stock,
        CASE
            WHEN (last_sold_at IS NOT NULL) THEN (EXTRACT(day FROM (now() - last_sold_at)))::integer
            ELSE NULL::integer
        END AS days_since_sale,
    (velocity_days)::integer AS velocity_days,
    (velocity_days < (7)::numeric) AS is_new
   FROM ranked;
