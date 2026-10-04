-- A CHECK CARRIES ITS CHANNEL. AW24 / A-050, ADR 0302.
--
-- WHAT BROKE. The analytics walk on Tuzlu Rüzgar (2026-10-03, read-only)
-- found the street-fair booth's two checks ($4,201.10 and $3,508.42, rung up
-- under Kerem's name, no covers, no tip) scored as Kerem's table service: at
-- 42 days his average check read 27.6% above the staff mean and his tip rate
-- 9.82% against 12.87% without the booth. pos_checks had nowhere to say how a
-- check was rung up (baseline_from_production.sql, CREATE TABLE
-- public.pos_checks), so every reader counted every check with a server name
-- as that server's service.
--
-- THE RULING. The founder, 2026-10-04, verbatim pick "Own row, POS field
-- (Recommended)": booth and event checks are their own row ("Booth & events")
-- in staff and table figures and still count in takings; the channel comes
-- from the POS, and a check that names none is table service. ADR 0302 holds
-- the question, the options and the method.
--
-- THE COLUMN. `channel` is text, null, CHECK in ('table', 'booth_event').
-- Null means the POS named no channel, which is table service; 'table' says
-- so outright. The gateway normalises a feed's value (trimmed, lower-cased)
-- before it writes, so the CHECK sees only the two spellings it admits; any
-- other value is counted in the import result and not written.
--
-- NO BACKFILL. No feed has ever sent a channel: the canonical adapter never
-- read one, and the sim's generator (gen.py) sends none. There is nothing to
-- match, and guessing from table_ref ('BOOTH', 'EVENT') is exactly what the
-- ruling declined. Re-posting the affected days with a channel corrects them:
-- the ingest upserts on (restaurant_id, source, external_check_id), and the
-- stock effects of a re-post are idempotent. NOT checked against production
-- (no production reads from this lane).
--
-- NO INDEX. Readers fold the channel in memory from the window they already
-- select; nothing filters on it in SQL.
--
-- LOCK. ADD COLUMN with no default is a catalogue-only change under a brief
-- ACCESS EXCLUSIVE lock. The CHECK is added NOT VALID (no scan under that
-- lock) and then validated, which scans pos_checks under SHARE UPDATE
-- EXCLUSIVE and so does not block reads or writes; every existing value is
-- null, so it cannot fail. statement_timeout follows the repo's ALTER TABLE
-- precedent (a_google_place_id_is_as_long_as_google_makes_it). Re-runnable:
-- the column and the constraint are each added only if absent. No explicit
-- BEGIN/COMMIT: the Supabase CLI wraps each file in a transaction. The closing
-- DO block reads the catalogue only; it writes no row.

SET local statement_timeout = '120s';

ALTER TABLE public.pos_checks
  ADD COLUMN IF NOT EXISTS channel text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_checks_channel_known'
       AND conrelid = to_regclass('public.pos_checks')
  ) THEN
    ALTER TABLE public.pos_checks
      ADD CONSTRAINT pos_checks_channel_known
      CHECK (channel IS NULL OR channel IN ('table', 'booth_event')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.pos_checks VALIDATE CONSTRAINT pos_checks_channel_known;

COMMENT ON COLUMN public.pos_checks.channel IS
  'How the POS rang the check up (ADR 0302). booth_event = a booth, fair or event check: its own row (''Booth & events'') in staff and table figures, still in takings. table or null = table service; null means the POS named no channel. Written by the POS hub only when the feed names one.';

DO $$
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
       WHERE a.attrelid = 'public.pos_checks'::regclass
         AND a.attname = 'channel'
         AND NOT a.attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'pos_checks.channel is missing or not text';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_checks_channel_known'
       AND conrelid = 'public.pos_checks'::regclass
       AND contype = 'c'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'pos_checks_channel_known is missing or not validated';
  END IF;
END $$;
