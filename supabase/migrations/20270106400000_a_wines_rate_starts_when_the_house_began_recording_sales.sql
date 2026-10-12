-- inventory_analytics: a wine's selling rate starts when the house's sales
-- records start, not on the day the wine was listed (wave-49 sim, F-1516).
--
-- 20270103600000 (F-687) divides sold_30d by the days the wine has been on the
-- list: LEAST(30, days since the earlier of the row's created_at and its first
-- ledger movement). A house that loads its opening stock on 1 October and
-- connects its till on 20 October has no sale before the 20th, for any wine.
-- On 22 October the divisor was 22 days for 2 days of sales: one eleventh of
-- the real rate, runway and days of cover eleven times too long, the suggested
-- order too small, and is_new false. The days before the house recorded any
-- sale are not days the wine did not sell; they are days nobody wrote sales
-- down.
--
-- The divisor is now the fewer of those listed days and the days since the
-- house's first recorded sale (its first live `sale` row with a negative
-- delta, any wine, any source), counting that day as day 1, capped at 30 as
-- before. A house with no sale keeps the listed days (sold_30d is 0 then, so
-- the rate is 0 either way). A wine listed after the house's first sale is
-- unchanged: its own days are already the fewer. A sale imported from before
-- the listing still moves both starts back, as F-687 had it.
--
-- One column is appended so a reader can say why the window is short:
--   velocity_from_till  true when the rate is taken over fewer days because
--                       the house's sales records began after the wine was
--                       listed; is_new (velocity_days < 7) then means "too
--                       little of the till to plan on", not "a new wine".
--
-- CREATE OR REPLACE keeps every existing column, name, type and position and
-- only appends the new one. It is written WITH (security_invoker = true):
-- a replace without that option resets it to the owner's rights (F-839,
-- 20270104200000_inventory_analytics_reads_as_its_caller_again.sql).
-- Version assigned by the sim fix lane note (20270106400000).

CREATE OR REPLACE VIEW public.inventory_analytics WITH (security_invoker = true) AS
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
        ), house_first_sales AS (
         SELECT ri.restaurant_id,
            min(t.transaction_date) AS first_sold_at
           FROM (public.inventory_transactions t
             JOIN public.restaurant_inventory ri ON ((ri.id = t.inventory_id)))
          WHERE (((t.stock_type)::text = 'live'::text) AND (t.transaction_type = 'sale'::public.inventory_transaction_type) AND (t.quantity_change < 0))
          GROUP BY ri.restaurant_id
        ), listed AS (
         SELECT ri.id AS inventory_id,
            LEAST((30)::numeric, GREATEST((1)::numeric, COALESCE((floor((EXTRACT(epoch FROM (now() - LEAST(ri.created_at, f.first_moved_at))) / (86400)::numeric)) + (1)::numeric), (30)::numeric))) AS listed_days,
            CASE
                WHEN (h.first_sold_at IS NULL) THEN NULL::numeric
                ELSE LEAST((30)::numeric, GREATEST((1)::numeric, (floor((EXTRACT(epoch FROM (now() - h.first_sold_at)) / (86400)::numeric)) + (1)::numeric)))
            END AS till_days
           FROM ((public.restaurant_inventory ri
             LEFT JOIN first_moves f ON ((f.inventory_id = ri.id)))
             LEFT JOIN house_first_sales h ON ((h.restaurant_id = ri.restaurant_id)))
        ), aged AS (
         SELECT listed.inventory_id,
            LEAST(listed.listed_days, COALESCE(listed.till_days, listed.listed_days)) AS velocity_days,
            COALESCE((listed.till_days < listed.listed_days), false) AS velocity_from_till
           FROM listed
        ), base AS (
         SELECT ri.id AS inventory_id,
            ri.restaurant_id,
            COALESCE(r.live_qty, (0)::bigint) AS on_hand,
            COALESCE(s.sold_30d, (0)::bigint) AS sold_30d,
            COALESCE(s.sold_90d, (0)::bigint) AS sold_90d,
            s.last_sold_at,
            ((COALESCE(s.sold_30d, (0)::bigint))::numeric / a.velocity_days) AS velocity_per_day,
            COALESCE(ri.menu_price_current, (0)::numeric) AS menu_price,
            a.velocity_days,
            a.velocity_from_till
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
            base.velocity_from_till,
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
    (velocity_days < (7)::numeric) AS is_new,
    velocity_from_till
   FROM ranked;
