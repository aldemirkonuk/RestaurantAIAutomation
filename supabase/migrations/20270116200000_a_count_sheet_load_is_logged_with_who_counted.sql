-- F-1544 owed (sim-ledger S227): a stock-take's count sheet, loaded back.
--
-- WHY. A count made on paper is loaded by an owner or a manager (lane 6,
-- countSheet.ts), and each line posts through record_stock_count as the person
-- who loaded it: the token names the counter (ADR 0078). Two things were owed:
--   (2) ADR 0335 §3: "Each import is recorded in the logs with how many rows
--       went in and how many were refused." The sheet import wrote no entry.
--   (3) The person who counted on paper may not be the person who loads the
--       sheet. They can now be named on the load (the loader by default), kept
--       with the lines, and shown in the review.
--
-- WHAT. One table, one row per load of a sheet:
--   * counted_by_name -- who counted on paper, as the loader wrote it. NULL is
--     "the loader counted it themselves". Free text, because the person who
--     counts on paper is often someone with no account here.
--   * shelf_keys -- the sheet's shelf keys (`sheet:<count>:<shelf>:<ms>`), the
--     prefix every line, held line and parked line of that shelf is keyed on.
--     That is how the name is kept WITH the lines without touching
--     record_stock_count, which stays the one count writer (ADR 0078, ADR
--     0343): no new argument, no new column on stock_counts.
--   * rows_in / rows_refused / rows_not_sent -- the log's figures.
-- The row is a record: it is never edited or deleted (append-only trigger),
-- and the gateway also writes a system_audit_log row, which /logs reads.
--
-- No backfill: sheets loaded before this have no row, and their lines read as
-- before (counted by the loader).

CREATE TABLE IF NOT EXISTS public.stock_count_sheet_loads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid NOT NULL,
  restaurant_id    uuid NOT NULL,
  loaded_by        uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  counted_by_name  text,
  shelf_keys       text[] NOT NULL DEFAULT '{}',
  rows_in          integer NOT NULL,
  rows_refused     integer NOT NULL,
  rows_not_sent    integer NOT NULL DEFAULT 0,
  loaded_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_sheet_loads_session_same_house
    FOREIGN KEY (session_id, restaurant_id)
    REFERENCES public.stock_count_sessions (id, restaurant_id) ON DELETE CASCADE,
  CONSTRAINT stock_count_sheet_loads_name_not_blank
    CHECK (counted_by_name IS NULL
           OR length(btrim(counted_by_name)) BETWEEN 1 AND 120),
  CONSTRAINT stock_count_sheet_loads_rows_not_negative
    CHECK (rows_in >= 0 AND rows_refused >= 0 AND rows_not_sent >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_count_sheet_loads_session
  ON public.stock_count_sheet_loads (session_id, loaded_at);

-- A record: kept as written.
CREATE OR REPLACE FUNCTION public.stock_count_sheet_loads_are_kept()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'A loaded count sheet is a record; it is not changed or removed.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_count_sheet_loads_are_kept ON public.stock_count_sheet_loads;
CREATE TRIGGER trg_stock_count_sheet_loads_are_kept
  BEFORE UPDATE OR DELETE ON public.stock_count_sheet_loads
  FOR EACH ROW EXECUTE FUNCTION public.stock_count_sheet_loads_are_kept();

REVOKE ALL ON FUNCTION public.stock_count_sheet_loads_are_kept() FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_sheet_loads_are_kept() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.stock_count_sheet_loads_are_kept() FROM authenticated';
  END IF;
END
$grants$;

-- Locked down, in the same migration.
ALTER TABLE public.stock_count_sheet_loads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_count_sheet_loads_service_role ON public.stock_count_sheet_loads;
CREATE POLICY stock_count_sheet_loads_service_role
  ON public.stock_count_sheet_loads
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.stock_count_sheet_loads FROM anon, authenticated;

COMMENT ON TABLE public.stock_count_sheet_loads IS
  'Each load of a stock-take''s paper count sheet (F-1544, S227 owed): who loaded it, who counted on paper (NULL = the loader), the sheet''s shelf keys its lines are keyed on, and how many rows went in, were refused, or were not sent (ADR 0335 §3). Append-only. Gateway-only: scoped to the house on the token.';
