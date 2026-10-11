-- F-1243: wine_consumption_summary still counted a voided or corrected-down
-- POS sale.
--
-- 20270105200000 (F-1197) marks such a sale's wine_consumption_log row
-- reversed (reversed_at + reversed_by_key) instead of deleting it, and every
-- app reader leaves a marked row out. This view (baseline_from_production.sql
-- :6403) summed every row, so its bottles, glasses, volume and revenue still
-- counted the bottles the till took back.
--
-- Same columns, same order, same grouping; only the filter is new. CREATE OR
-- REPLACE keeps the view's grants (OD-72 revoked anon and authenticated, and
-- that stays), but it REPLACES the view's options with the ones it names, so
-- security_invoker (set by OD-72, 20260825210000) is named again here.

create or replace view public.wine_consumption_summary
  with (security_invoker = true)
as
select restaurant_id,
    inventory_id,
    wine_name,
    sum(
        case
            when ((consumption_type)::text = 'bottle'::text) then quantity
            else 0
        end) as bottles_consumed,
    sum(
        case
            when ((consumption_type)::text = 'glass'::text) then quantity
            else 0
        end) as glasses_consumed,
    sum(volume_ml) as total_volume_ml,
    sum(
        case
            when ((consumption_type)::text = 'bottle'::text) then coalesce(total_revenue, (0)::numeric)
            else (0)::numeric
        end) as bottle_revenue,
    sum(
        case
            when ((consumption_type)::text = 'glass'::text) then coalesce(total_revenue, (0)::numeric)
            else (0)::numeric
        end) as glass_revenue,
    sum(coalesce(total_revenue, (0)::numeric)) as total_revenue
   from public.wine_consumption_log cl
  where cl.reversed_at is null
  group by restaurant_id, inventory_id, wine_name;

comment on view public.wine_consumption_summary is
  'Per-wine consumption totals. F-1243: rows a POS void or downward correction marked reversed (F-1197) are left out. security_invoker so base-table RLS applies to the caller.';
