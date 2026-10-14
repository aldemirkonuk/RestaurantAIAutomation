-- a_parked_count_line_keeps_its_open_bottle -- a bottle the house does not
-- carry, parked in a stock-take, keeps what was left in its open bottle.
-- Sim ledger S232/S234 owed item (parked open amounts), ADR 0343 §6 and §8.
--
-- WHAT WAS MISSING. A walk line counts sealed bottles and the open bottle in
-- tenths (ADR 0343 §6, the founder's F3 (a), S224); a parked line counted
-- sealed bottles only (stock_count_parked_lines.counted_qty). So a half-empty
-- bottle of a wine the house had not entered yet was either typed as a full
-- bottle or left out, and when the manager matched it in review the open part
-- never reached the books.
--
-- WHAT THIS FILE DOES. stock_count_parked_lines gains counted_open_ml: the
-- open bottle in integer ml (ADR 0070), NULL when it was not counted, which is
-- every parked line before this file. The gateway turns the tenths staff
-- enter into ml on the 750 ml stand-in bottle (ADR 0297), because a parked
-- bottle is not an item yet and has no size; review shows it back in tenths,
-- and matching it to an item posts those tenths through record_stock_count
-- (the one writer, ADR 0078), which sizes them on that item's own bottle.
--
-- Nothing is backfilled: an old parked line simply has no open bottle.
-- The table keeps its lock-down (RLS on, service-role only) from
-- a_count_session_groups_a_walk_of_shelves; no grant changes here.

ALTER TABLE public.stock_count_parked_lines
  ADD COLUMN IF NOT EXISTS counted_open_ml integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'stock_count_parked_lines_open_ml_not_negative'
  ) THEN
    ALTER TABLE public.stock_count_parked_lines
      ADD CONSTRAINT stock_count_parked_lines_open_ml_not_negative
      CHECK (counted_open_ml IS NULL OR counted_open_ml >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.stock_count_parked_lines.counted_open_ml IS
  'What was left in the open bottle of a parked line, in ml on a 750 ml stand-in bottle (entered in tenths). NULL: not counted.';
