-- r109 onboarding g3: a till's past item sales, brought in on day one.
--
-- One row per (house, house-local day, item). The key carries no money, so a
-- re-upload of a corrected export replaces a day's figure and never adds one.
-- These are not checks: nothing here is a pos_checks row, so no reader counts
-- an item-day as a check, and no stock path (apply_stock_movement,
-- record_glass_pour, the consumption mirror) can see them (ADR 0281, amended
-- 2026-11-27: history imports do not deplete).
--
-- `net` is NULL when the export had none, or when the house's money was not
-- set at import (the quantity is kept, the money is not guessed). `currency`
-- is the house's money at import, and only beside a net.
CREATE TABLE IF NOT EXISTS public.pos_sales_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sale_date date NOT NULL,
  item_key text NOT NULL,
  item_name text NOT NULL,
  qty numeric(14,3) NOT NULL CONSTRAINT pos_sales_history_qty_positive CHECK (qty > 0),
  net numeric(14,2) CONSTRAINT pos_sales_history_net_not_negative CHECK (net IS NULL OR net >= 0),
  currency varchar(3) CONSTRAINT pos_sales_history_currency_with_net CHECK (currency IS NULL OR net IS NOT NULL),
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_sales_history_one_per_day_item UNIQUE (restaurant_id, sale_date, item_key)
);

COMMENT ON TABLE public.pos_sales_history IS
  'A till''s past item sales per house-local day (r109 onboarding g3). Not checks; never moves stock (ADR 0281, amended 2026-11-27).';

-- The gateway writes and reads it with its service client; no browser role reads it directly.
ALTER TABLE public.pos_sales_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_sales_history FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pos_sales_history TO service_role;
