-- An order can repeat on the last day of the month (F-307).
--
-- 20260905235800_an_order_that_repeats_says_so_on_itself.sql capped a monthly
-- or quarterly anchor at 28, "so that every month has one". The cost of that
-- cap: an owner who buys at month end could not say so. Leaving the anchor
-- empty and starting on the 31st reaches the month end (the gateway clamps from
-- the series' own day each step), but it is not a choice anybody would find.
--
-- Decision record (coordinator's call, 2026-10-09, founder delegation of
-- 2026-10-07): p4-scratch/sim-run/bulletproof/wave6/recurrence-month-end-decision.md.
-- The anchor widens to 1..31. 31 means "the last day of the month"; 29 and 30
-- take a shorter month's last day. Every month is clamped on its own from the
-- anchor (`snapToMonthDay` in apps/api-gateway/src/procurement/order-recurrence.ts),
-- never carried forward from a clamped February, so the date does not "move
-- twice a year" — the reason the original comment gave for the cap.
--
-- Additive: only the one constraint is dropped and re-added, under the same
-- name, with the same COALESCE shape (an anchor on a NULL frequency still
-- fails) and the weekday branch untouched. Every row the old CHECK accepted,
-- the new one accepts.
ALTER TABLE public.procurement_orders
  DROP CONSTRAINT IF EXISTS procurement_orders_recurrence_anchor_day_check,
  ADD  CONSTRAINT procurement_orders_recurrence_anchor_day_check
       CHECK (COALESCE(
         recurrence_anchor_day IS NULL
         OR (recurrence_frequency IS NOT NULL
             AND recurrence_frequency IN ('weekly','biweekly')
             AND recurrence_anchor_day BETWEEN 0 AND 6)
         OR (recurrence_frequency IS NOT NULL
             AND recurrence_frequency IN ('monthly','quarterly')
             AND recurrence_anchor_day BETWEEN 1 AND 31)
       , false));

COMMENT ON CONSTRAINT procurement_orders_recurrence_anchor_day_check
  ON public.procurement_orders IS
  'Weekly/biweekly: 0 (Mon)..6 (Sun). Monthly/quarterly: 1..31, where 31 means the last day of the month and 29-31 take a shorter month''s last day (F-307). Daily: none.';
