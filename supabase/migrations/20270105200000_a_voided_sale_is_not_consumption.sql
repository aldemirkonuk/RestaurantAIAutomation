-- F-1197: a voided or corrected-down POS sale stays in wine_consumption_log.
--
-- pos-hub mirrors each depleting POS sale into wine_consumption_log, keyed by
-- the stock key in `notes` (unique per house, 20260824190000). When the till
-- later voids the check, or re-sends it with fewer bottles, pos-hub returns
-- the stock but the sale's consumption row stayed: voided bottles kept
-- counting as sold in the Bottles sold goal, the dashboard chart, the weekday
-- shape and every demand figure built on this table.
--
-- A negative row is not the answer: ADR 0297 gives a bottle line with a
-- negative quantity no bottle figure, and every reader refuses or names it
-- (CLAIMS AW02-ONE-CONVERTER). So the sale's row is MARKED instead, and every
-- reader leaves a marked row out:
--
--   reversed_at      when the void or correction that took it back was booked
--                    (the check's own closed_at, as the stock return is);
--   reversed_by_key  the stock key of that void or correction, so the mark
--                    names the movement that justified it.
--
-- A correction that keeps some bottles marks the item's earlier rows on the
-- check and writes ONE live row of what the check still holds, under the
-- correction's own key. No row is ever negative, and a reader only needs
-- `reversed_at is null`.
--
-- The row is kept, not deleted, so its key stays taken: the partial unique
-- index on (restaurant_id, notes) still turns a replay of the voided sale into
-- the idempotent no-op it was, instead of letting it write the sale again.
--
-- No new table and no new policy: the columns ride the table's existing RLS.

alter table public.wine_consumption_log
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by_key text;

-- Both or neither: a mark with no key cannot say what took the sale back, and
-- a key with no time is not a mark any reader filters on.
alter table public.wine_consumption_log
  drop constraint if exists wine_consumption_log_reversal_pair;
alter table public.wine_consumption_log
  add constraint wine_consumption_log_reversal_pair
  check ((reversed_at is null) = (reversed_by_key is null));

comment on column public.wine_consumption_log.reversed_at is
  'F-1197: set when a POS void or downward correction took this sale back; readers leave a marked row out. Never a negative row (ADR 0297).';
comment on column public.wine_consumption_log.reversed_by_key is
  'F-1197: the stock key of the void or correction that marked this row reversed.';
