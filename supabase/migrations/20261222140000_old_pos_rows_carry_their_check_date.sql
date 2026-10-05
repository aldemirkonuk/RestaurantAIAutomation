-- ===========================================================================
-- ADR 0281, fork F2 — POS rows written before #603 carry their check's date
-- ===========================================================================
--
-- THIS MIGRATION WRITES PRODUCTION ROWS when it is applied, which is when its
-- PR merges (the Supabase GitHub integration applies migrations on merge,
-- keyed by this filename). It is the write the founder said yes to.
--
-- WHAT WAS WRONG. a_pos_sale_is_dated_by_its_check (ADR 0281, #603, merged
-- 2b6782291) dates every NEW POS stock and consumption row by its check's
-- closed_at. Rows written before it carry the moment they were typed in.
-- Production, read-only, 2026-10-05 ~14:07Z: 10,684 rows would change; 10,483
-- of them are Tuzlu Rüzgar's (consumption 7,026, glass-pour ledger 694, keyed
-- ledger 2,763), each 32 d 15 h to 92 d 16 h late; the other 201 are three sim
-- houses' and stay on the same house day. No row was no-check, check-open,
-- unreadable or ambiguous (p4-scratch/sim-run/fixes/audits/
-- prod-dryruns-2026-10-05.md, outside the repo).
--
-- THE FOUNDER'S ANSWERS (AskUserQuestion, 2026-10-05), verbatim:
--   F2: "Dry run, then your yes (Recommended)".
--   Running the count: "You run both, read-only (Recommended)".
--   The write: "Re-date all, keep undo (Recommended)". Its option text: "I
--   build the write as its own small PR (script, test, ADR 0281 note), which
--   saves each row's old date so it can be undone. It runs on production once
--   its audit passes. Tuzlu's July–Sept stock, pour and consumption charts
--   then show each sale on its real day."
--
-- WHICH ROWS. Exactly the rows the dry run calls `change`. The classification
-- in pos_row_date_by_check() below is the dry run's
-- (p4-scratch/sim-run/fixes/tools/postime-f2-dryrun.sql, outside the repo):
-- the same three row sets, the same join, the same strict reading of the
-- till's own string, the same outcome order and the same target. Only its
-- per-house report (zones, day buckets, caveat counters) is left out. In short:
--   * ledger (key): inventory_transactions whose idempotency_key starts 'pos:'
--     (apply_stock_movement: whole-bottle sales and every ':void').
--   * ledger (glass pour): a keyless record_glass_pour row (source 'pos',
--     type 'sale', metadata with 'pours' and 'bottles_opened'). Its key is on
--     the pour_events row the same call wrote, linked by restaurant_id,
--     inventory_id and the created_at both rows took from one now(). A row
--     that links to no 'pos:' pour event (a Toast 'toast_' key, a keyless
--     pour) is out of scope; one that links to two is ambiguous.
--   * consumption: wine_consumption_log whose notes (the key) starts 'pos:';
--     a legacy 'pos:pos:' note is read without its doubled prefix.
--   * The join: same restaurant_id, source = the key's second ':' field, and
--     external_check_id equal to one of the key's ':'-joined prefixes after
--     the source. A key that two checks answer is ambiguous, never guessed.
--   * The till's own string (pos_checks.raw, by the adapter's field) must be
--     a strict ISO-8601 instant that round-trips; one that fails is
--     `unreadable` and its rows stay as they are (#603 refuses such a check,
--     F4). A check whose raw keeps no string is read by its stored closed_at.
--   * The target: LEAST(pos_checks.closed_at, the row's created_at) — what
--     #603 would have written at entry (the check's close, never later than
--     the moment the row was entered).
--
-- COLUMNS WRITTEN: inventory_transactions.transaction_date (keyed and
-- glass-pour rows); wine_consumption_log.recorded_at AND created_at, both set
-- to the target, as #603's gateway writes them (pos-hub.service.ts:1594-1595).
-- NEVER WRITTEN: pos_checks, pour_events, inventory_transactions.created_at,
-- quantities, lots, or any other column.
--
-- WHY GLASS POURS TOO. The answer's own words name pour charts, and the
-- rejected option "Skip glass pours" would leave a glass's stock and its
-- consumption row up to 92 days apart.
--
-- UNDO. Every row this changes is logged first in public.pos_row_redate_undo
-- with its exact old values (one run_id per call). The table, not the rows'
-- metadata: wine_consumption_log has no jsonb column, and
-- inventory_transactions.metadata is read (the glass-pour test above, the
-- correlation index, /logs), so a row's content stays byte-identical apart
-- from its dates. RLS on, no policy, no grant to any client role or the
-- gateway's role. The documented undo is one call, run as the database owner:
--     SELECT public.undo_pos_rows_redate();          -- every run, newest first
--     SELECT public.undo_pos_rows_redate('<run_id>'); -- one run
-- It restores each row that still carries the date this gave it and leaves,
-- and counts, any row whose date changed since.
--
-- SAFETY.
--   * Triggers. supabase/migrations defines none on inventory_transactions or
--     wine_consumption_log (the baseline dump and every later file, read
--     2026-10-05), so an UPDATE of these dates re-applies no stock, fires no
--     notification and doubles nothing: stock lives on inventory_lots, moved
--     only by the two RPCs. The block below halts this migration, before
--     anything is written, if the database it runs on has any trigger or
--     rule on either table. Nothing is disabled.
--   * Derived data recomputes on read: inventory_analytics (velocity,
--     sold_30d, runway) and get_inventory_balance_at are a view and a
--     function. The materialized view inventory_transaction_summary has no
--     reader and no caller of its refresh in the repo; it is not refreshed
--     here. analytics_insights (a stored cache) is replaced at each
--     category's next cadence run, hourly-gated, daily 06:00 by default;
--     analytics_goals.current_value is rewritten on every progress read.
--     Notifications, digests and report exports already made stay as made.
--   * Idempotent: a re-dated row then classifies `already`, so a second call
--     changes nothing.
--   * Rows #603 wrote carry their target already and are untouched. One
--     exception, by the same rule: a check re-sent with a different closed_at
--     after its rows were booked (the upsert replaces closed_at, the ledger
--     keys do not re-write; ADR 0281, "The cost F4 names") — its rows move to
--     the check's current closed_at, which revenue already reads.
--   * Bounded: one set-based statement; no per-row loop.
--
-- The classify, re-date and undo functions stay, closed to every role but
-- the owner, so the SQL test can run them on fixtures and the undo stays
-- callable.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Nothing fires on these two tables, or nothing is written.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_found text;
BEGIN
  SELECT string_agg(x, ', ' ORDER BY x) INTO v_found FROM (
    SELECT format('trigger %s on %s', t.tgname, t.tgrelid::regclass) AS x
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid IN ('public.inventory_transactions'::regclass,
                         'public.wine_consumption_log'::regclass)
       AND NOT t.tgisinternal
    UNION ALL
    SELECT format('rule %s on %s.%s', r.rulename, r.schemaname, r.tablename)
      FROM pg_catalog.pg_rules r
     WHERE r.schemaname = 'public'
       AND r.tablename IN ('inventory_transactions', 'wine_consumption_log')) s;
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'old_pos_rows_carry_their_check_date: % — an UPDATE of these dates would fire it; nothing was re-dated (ADR 0281 F2)', v_found;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. The undo log
-- ---------------------------------------------------------------------------
CREATE TABLE public.pos_row_redate_undo (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               uuid NOT NULL,
  redated_at           timestamptz NOT NULL,
  row_table            text NOT NULL
                       CHECK (row_table IN ('inventory_transactions', 'wine_consumption_log')),
  row_kind             text NOT NULL
                       CHECK (row_kind IN ('ledger (key)', 'ledger (glass pour)', 'consumption')),
  row_id               uuid NOT NULL,
  restaurant_id        uuid NOT NULL,
  pos_check_id         uuid NOT NULL,
  pos_key              text NOT NULL,
  old_transaction_date timestamptz,
  old_recorded_at      timestamptz,
  old_created_at       timestamptz,
  new_date             timestamptz NOT NULL,
  undone_at            timestamptz,
  CONSTRAINT pos_row_redate_undo_one_row_per_run UNIQUE (run_id, row_table, row_id),
  CONSTRAINT pos_row_redate_undo_ledger_has_its_date
    CHECK (row_table <> 'inventory_transactions' OR old_transaction_date IS NOT NULL)
);

COMMENT ON TABLE public.pos_row_redate_undo IS
  'ADR 0281 F2: the old dates of every POS row old_pos_rows_carry_their_check_date '
  're-dated, one run_id per call of redate_pos_rows_by_check(). '
  'SELECT public.undo_pos_rows_redate() restores them. No FK on purpose: a row '
  'deleted later must not be blocked by its undo line.';

CREATE INDEX pos_row_redate_undo_run ON public.pos_row_redate_undo (run_id);

ALTER TABLE public.pos_row_redate_undo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pos_row_redate_undo FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The classification: the dry run's, one row per POS row, read only
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.pos_row_date_by_check()
RETURNS TABLE (
  row_kind        text,
  row_table       text,
  row_id          uuid,
  restaurant_id   uuid,
  pos_key         text,
  pos_check_id    uuid,
  outcome         text,
  cur_date        timestamptz,
  cur_recorded_at timestamptz,
  target          timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
WITH rows_ AS (
  -- ledger (key): apply_stock_movement rows the gateway keyed.
  SELECT 'ledger (key)'::text AS tbl, it.id, it.restaurant_id, it.idempotency_key AS k,
         it.transaction_date AS cur, NULL::timestamptz AS cur2, it.created_at AS entry,
         1::bigint AS links
    FROM public.inventory_transactions it
   WHERE starts_with(it.idempotency_key, 'pos:')
  UNION ALL
  -- ledger (glass pour): record_glass_pour rows, keyed through pour_events.
  SELECT 'ledger (glass pour)', it.id, it.restaurant_id, p.k,
         it.transaction_date, NULL, it.created_at, p.links
    FROM public.inventory_transactions it
    CROSS JOIN LATERAL (
      SELECT min(pe.idempotency_key) AS k, count(*) AS links
        FROM public.pour_events pe
       WHERE pe.restaurant_id = it.restaurant_id
         AND pe.inventory_id = it.inventory_id
         AND pe.created_at = it.created_at
         AND starts_with(pe.idempotency_key, 'pos:')) p
   WHERE it.idempotency_key IS NULL
     AND it.source = 'pos' AND it.transaction_type = 'sale'
     AND it.metadata ? 'pours' AND it.metadata ? 'bottles_opened'
  UNION ALL
  -- consumption: notes is the key.
  SELECT 'consumption', w.id, w.restaurant_id,
         CASE WHEN starts_with(w.notes, 'pos:pos:') THEN substr(w.notes, 5) ELSE w.notes END,
         w.created_at, w.recorded_at, w.created_at, 1
    FROM public.wine_consumption_log w
   WHERE starts_with(w.notes, 'pos:')
), keyed AS (
  SELECT r.*, split_part(r.k, ':', 2) AS src,
         ARRAY(SELECT array_to_string(p.parts[1:j], ':')
                 FROM generate_series(1, cardinality(p.parts) - 1) AS j) AS cands
    FROM rows_ r
    CROSS JOIN LATERAL (
      SELECT string_to_array(substr(r.k, length(split_part(r.k, ':', 2)) + 6), ':') AS parts) p
), matched AS (
  SELECT k.*, m.n_checks, m.check_id
    FROM keyed k
    CROSS JOIN LATERAL (
      SELECT count(*) AS n_checks, min(c.id::text)::uuid AS check_id
        FROM public.pos_checks c
       WHERE c.restaurant_id = k.restaurant_id
         AND c.source = k.src
         AND c.external_check_id = ANY (k.cands)) m
), cls AS (
  SELECT m.tbl, m.id, m.restaurant_id, m.k, m.cur, m.cur2, c.id AS check_id,
         LEAST(c.closed_at, m.entry) AS target,
         CASE
           WHEN m.links = 0 THEN 'out of scope'
           WHEN m.links > 1 OR m.n_checks > 1 THEN 'ambiguous'
           WHEN m.n_checks = 0 THEN 'no check'
           WHEN c.closed_at IS NULL THEN 'check open'
           WHEN rd.reading = 'unreadable' THEN 'unreadable'
           WHEN m.cur IS NOT DISTINCT FROM LEAST(c.closed_at, m.entry)
            AND (m.tbl <> 'consumption' OR m.cur2 IS NOT DISTINCT FROM LEAST(c.closed_at, m.entry))
             THEN 'already'
           ELSE 'change'
         END AS outcome
    FROM matched m
    LEFT JOIN public.pos_checks c ON c.id = m.check_id AND m.n_checks = 1 AND m.links = 1
    -- #603's strict reading of the till's own string, for the one matched check.
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN c.source = 'clover' THEN 'read'
               WHEN t.till IS NULL THEN 'not kept'
               WHEN jsonb_typeof(t.till) <> 'string' THEN 'unreadable'
               WHEN NOT coalesce(s.ok, false) THEN 'unreadable'
               WHEN s.no_zone THEN 'read, no zone'
               ELSE 'read'
             END AS reading
        FROM (SELECT CASE
                WHEN jsonb_typeof(c.raw) IS DISTINCT FROM 'object' THEN NULL
                WHEN c.source IN ('generic_webhook', 'csv_import')
                  THEN coalesce(nullif(c.raw -> 'closedAt', 'null'::jsonb),
                                nullif(c.raw -> 'closed_at', 'null'::jsonb))
                WHEN c.source = 'square'
                  THEN coalesce(nullif(c.raw -> 'closed_at', 'null'::jsonb),
                                nullif(c.raw -> 'updated_at', 'null'::jsonb))
                WHEN c.source = 'toast' THEN nullif(c.raw -> 'closedDate', 'null'::jsonb)
              END AS till) t
        CROSS JOIN LATERAL (
          SELECT regexp_match(
                   regexp_replace(CASE WHEN jsonb_typeof(t.till) = 'string' THEN t.till #>> '{}' END,
                                  '^[ \t\r\n]+|[ \t\r\n]+$', '', 'g'),
                   '^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?(Z|[+-][0-9]{2}(?::?[0-9]{2})?)?)?$'
                 ) AS m) mm
        CROSS JOIN LATERAL (
          SELECT mm.m IS NOT NULL
                 AND mm.m[2]::int BETWEEN 1 AND 12
                 AND mm.m[3]::int BETWEEN 1 AND (CASE
                       WHEN mm.m[2]::int IN (4, 6, 9, 11) THEN 30
                       WHEN mm.m[2]::int = 2 THEN
                         CASE WHEN (mm.m[1]::int % 4 = 0 AND mm.m[1]::int % 100 <> 0)
                                   OR mm.m[1]::int % 400 = 0 THEN 29 ELSE 28 END
                       ELSE 31 END)
                 AND coalesce(mm.m[4]::int, 0) <= 23
                 AND coalesce(mm.m[5]::int, 0) <= 59
                 AND coalesce(mm.m[6]::int, 0) <= 59
                 AND (mm.m[8] IS NULL OR mm.m[8] = 'Z'
                      OR (coalesce(nullif(substr(replace(mm.m[8], ':', ''), 4), '')::int, 0) <= 59
                          AND substr(mm.m[8], 2, 2)::int * 60
                              + coalesce(nullif(substr(replace(mm.m[8], ':', ''), 4), '')::int, 0) <= 840))
                   AS ok,
                 mm.m[8] IS NULL AS no_zone) s
       WHERE c.id IS NOT NULL
    ) rd ON true
)
SELECT x.tbl,
       CASE WHEN x.tbl = 'consumption' THEN 'wine_consumption_log' ELSE 'inventory_transactions' END,
       x.id, x.restaurant_id, x.k, x.check_id, x.outcome, x.cur, x.cur2,
       CASE WHEN x.outcome IN ('change', 'already') THEN x.target END
  FROM cls x
$fn$;

COMMENT ON FUNCTION public.pos_row_date_by_check() IS
  'ADR 0281 F2: every POS ledger and consumption row with the outcome of '
  're-dating it by its check (change, already, no check, check open, unreadable, '
  'ambiguous, out of scope) and, for change and already, its target '
  'LEAST(pos_checks.closed_at, created_at). Read only; the classification of '
  'p4-scratch/sim-run/fixes/tools/postime-f2-dryrun.sql.';

-- ---------------------------------------------------------------------------
-- 3. The write: log the old dates, then re-date, in one statement
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.redate_pos_rows_by_check()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_run uuid := gen_random_uuid();
  v_at  timestamptz := clock_timestamp();
  v     jsonb;
BEGIN
  -- One statement, so the classification, the log and both UPDATEs read one
  -- snapshot: a row is logged with exactly the values it is changed from.
  WITH cls AS MATERIALIZED (
    SELECT * FROM public.pos_row_date_by_check()
  ), chg AS MATERIALIZED (
    SELECT * FROM cls WHERE cls.outcome = 'change'
  ), logged AS (
    INSERT INTO public.pos_row_redate_undo
      (run_id, redated_at, row_table, row_kind, row_id, restaurant_id, pos_check_id, pos_key,
       old_transaction_date, old_recorded_at, old_created_at, new_date)
    SELECT v_run, v_at, c.row_table, c.row_kind, c.row_id, c.restaurant_id, c.pos_check_id, c.pos_key,
           CASE WHEN c.row_table = 'inventory_transactions' THEN c.cur_date END,
           CASE WHEN c.row_table = 'wine_consumption_log' THEN c.cur_recorded_at END,
           CASE WHEN c.row_table = 'wine_consumption_log' THEN c.cur_date END,
           c.target
      FROM chg c
    RETURNING 1
  ), ledger AS (
    UPDATE public.inventory_transactions it
       SET transaction_date = c.target
      FROM chg c
     WHERE c.row_table = 'inventory_transactions' AND it.id = c.row_id
    RETURNING 1
  ), consumption AS (
    UPDATE public.wine_consumption_log w
       SET recorded_at = c.target, created_at = c.target
      FROM chg c
     WHERE c.row_table = 'wine_consumption_log' AND w.id = c.row_id
    RETURNING 1
  )
  SELECT jsonb_build_object(
           'run_id', v_run,
           'redated_at', v_at,
           'outcomes', coalesce((SELECT jsonb_object_agg(o.k, o.n)
                                   FROM (SELECT cls.row_kind || ': ' || cls.outcome AS k, count(*) AS n
                                           FROM cls GROUP BY 1) o), '{}'::jsonb),
           'changed', (SELECT count(*) FROM chg),
           'logged', (SELECT count(*) FROM logged),
           'ledger_updated', (SELECT count(*) FROM ledger),
           'consumption_updated', (SELECT count(*) FROM consumption))
    INTO v;

  IF (v ->> 'logged')::bigint <> (v ->> 'changed')::bigint
     OR (v ->> 'ledger_updated')::bigint + (v ->> 'consumption_updated')::bigint
        <> (v ->> 'changed')::bigint THEN
    RAISE EXCEPTION 'redate_pos_rows_by_check: % rows to change, % logged, % ledger and % consumption updated',
      v ->> 'changed', v ->> 'logged', v ->> 'ledger_updated', v ->> 'consumption_updated';
  END IF;
  RETURN v;
END;
$fn$;

COMMENT ON FUNCTION public.redate_pos_rows_by_check() IS
  'ADR 0281 F2: re-dates every POS row pos_row_date_by_check() calls change to its '
  'target (inventory_transactions.transaction_date; wine_consumption_log.recorded_at '
  'and created_at), after logging its old values in pos_row_redate_undo under a '
  'fresh run_id. Idempotent. Undo: SELECT public.undo_pos_rows_redate().';

-- ---------------------------------------------------------------------------
-- 4. The undo
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.undo_pos_rows_redate(p_run_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  r      record;
  n_l    bigint;
  n_c    bigint;
  n_all  bigint;
  v_l    bigint := 0;
  v_c    bigint := 0;
  v_left bigint := 0;
  v_runs bigint := 0;
BEGIN
  -- Newest run first, so a row re-dated twice goes back through both.
  FOR r IN
    SELECT u.run_id
      FROM public.pos_row_redate_undo u
     WHERE u.undone_at IS NULL AND (p_run_id IS NULL OR u.run_id = p_run_id)
     GROUP BY u.run_id
     ORDER BY max(u.redated_at) DESC, u.run_id DESC
  LOOP
    WITH u AS MATERIALIZED (
      SELECT * FROM public.pos_row_redate_undo x
       WHERE x.run_id = r.run_id AND x.undone_at IS NULL
    ), l AS (
      UPDATE public.inventory_transactions it
         SET transaction_date = u.old_transaction_date
        FROM u
       WHERE u.row_table = 'inventory_transactions' AND it.id = u.row_id
         AND it.transaction_date = u.new_date
      RETURNING u.id
    ), c AS (
      UPDATE public.wine_consumption_log w
         SET recorded_at = u.old_recorded_at, created_at = u.old_created_at
        FROM u
       WHERE u.row_table = 'wine_consumption_log' AND w.id = u.row_id
         AND w.recorded_at IS NOT DISTINCT FROM u.new_date
         AND w.created_at IS NOT DISTINCT FROM u.new_date
      RETURNING u.id
    ), done AS (
      UPDATE public.pos_row_redate_undo x
         SET undone_at = clock_timestamp()
       WHERE x.id IN (SELECT l.id FROM l UNION ALL SELECT c.id FROM c)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM l), (SELECT count(*) FROM c), (SELECT count(*) FROM u)
      INTO n_l, n_c, n_all;
    v_l := v_l + n_l;
    v_c := v_c + n_c;
    v_left := v_left + n_all - n_l - n_c;
    v_runs := v_runs + 1;
  END LOOP;
  RETURN jsonb_build_object('runs', v_runs, 'ledger_restored', v_l,
                            'consumption_restored', v_c, 'left_as_is', v_left);
END;
$fn$;

COMMENT ON FUNCTION public.undo_pos_rows_redate(uuid) IS
  'ADR 0281 F2: puts back the dates redate_pos_rows_by_check() changed, newest run '
  'first (one run when p_run_id is given). A row whose date changed since is left '
  'as is and counted in left_as_is; its undo line stays open.';

REVOKE ALL ON FUNCTION public.pos_row_date_by_check() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.redate_pos_rows_by_check() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.undo_pos_rows_redate(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The write, once, and proof that every logged row landed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v          jsonb;
  v_unlanded bigint;
BEGIN
  v := public.redate_pos_rows_by_check();
  RAISE NOTICE 'old_pos_rows_carry_their_check_date: %', v;

  SELECT count(*) INTO v_unlanded
    FROM public.pos_row_redate_undo u
    LEFT JOIN public.inventory_transactions it
      ON u.row_table = 'inventory_transactions' AND it.id = u.row_id
    LEFT JOIN public.wine_consumption_log w
      ON u.row_table = 'wine_consumption_log' AND w.id = u.row_id
   WHERE u.run_id = (v ->> 'run_id')::uuid
     AND NOT coalesce(it.transaction_date = u.new_date, false)
     AND NOT coalesce(w.recorded_at = u.new_date AND w.created_at = u.new_date, false);
  IF v_unlanded > 0 THEN
    RAISE EXCEPTION 'old_pos_rows_carry_their_check_date: % logged rows do not carry their new date', v_unlanded;
  END IF;
END;
$$;

COMMIT;
