-- READ-ONLY DRY RUN for ADR 0281 fork F2: re-dating POS stock and consumption rows
-- written before PR #603 ("date a sale's stock by its check", main 2b6782291).
--
-- Founder answer 2026-10-05 (AskUserQuestion): "Dry run, then your yes (Recommended)".
-- This file is the dry run. THE WRITE IS NOT IN THIS FILE, and nothing is written
-- until the founder says yes to a separate, reviewed write.
-- [2026-10-05: he said yes ("Re-date all, keep undo (Recommended)"); the write is
-- migration 20261222140000_old_pos_rows_carry_their_check_date.sql, whose
-- pos_row_date_by_check() carries this file's classification. Fork 1, ~16:00Z:
-- "Never move a row later (Recommended)" - both now read a row whose every date
-- is at or before its target as already_match. The pre-fork-1 text is kept
-- beside this file as postime-f2-dryrun.pre-fork1.sql.]
--
-- WHAT IT READS (SELECT only): public.restaurants, public.pos_checks,
-- public.inventory_transactions, public.pour_events, public.wine_consumption_log,
-- pg_timezone_names.
-- WHAT IT NEVER DOES: no INSERT/UPDATE/DELETE, no CREATE of any kind (no temp table,
-- no temp view), no function call that writes. Everything runs inside
-- BEGIN TRANSACTION READ ONLY ... ROLLBACK, so Postgres itself refuses any write.
--
-- HOW TO RUN IT (psql only; it uses \x and \pset):
--   PGOPTIONS='-c default_transaction_read_only=on' \
--   psql "<connection string of a READ-ONLY role>" -X -v ON_ERROR_STOP=1 \
--        -f postime-f2-dryrun.sql > postime-f2-dryrun-<where>.txt
-- The role needs SELECT on the five tables above and must SEE EVERY HOUSE'S ROWS
-- (RLS bypassed, or policies that return all rows). A role that RLS hides rows from
-- returns zeros, which reads as "nothing to repair". Result 1 prints what the
-- session can see; read it before reading result 2.
--
-- WHAT A REPAIR WOULD CHANGE (cited at main 2b6782291):
--   inventory_transactions.transaction_date - the only column #603 dates; created_at
--     keeps entry time (migration 20261222100000_a_pos_sale_is_dated_by_its_check.sql
--     :236-249 apply_stock_movement, :389-400 record_glass_pour, :31-33).
--   wine_consumption_log.recorded_at AND created_at - both set to the sale's instant
--     (apps/api-gateway/src/pos-hub/pos-hub.service.ts:1594-1595).
--   Not pos_checks.closed_at (the source), not pour_events.created_at (entry time,
--     migration :31-33).
--
-- THE TARGET EACH ROW IS MEASURED AGAINST: LEAST(pos_checks.closed_at, the row's
-- created_at), i.e. what #603 would have written at entry: the check's closed_at,
-- clamped to the time the row was entered when the check closes later
-- (migration :248 and :399; pos-hub.service.ts:241-249). For a consumption row both
-- columns must equal it; its shift is measured on created_at (the column the
-- series' readers filter on, ADR 0281 "What the consumption row's dates are").
-- [2026-10-05 ~16:00Z, fork 1 "Never move a row later": a row is measured as
-- already right when every date is AT OR BEFORE the target (a consumption row:
-- recorded_at and created_at both), and a repair moves each date to the earlier
-- of itself and the target. Nothing moves later.]
--
-- THE JOIN, row -> pos_checks (one check per key; uq_pos_checks_source_check):
--   key = 'pos:' || source || ':' || external_check_id || ':' || item || ':' || line
--         [|| ':void'] (pos-hub.service.ts:1275, :1334). The join is: same
--         restaurant_id, source = the key's 2nd ':' field, and external_check_id
--         equal to one of the key's ':'-joined prefixes after the source (the same
--         as starts_with(key, 'pos:'||source||':'||external_check_id||':'), but
--         index-driven). A key that two checks answer is "ambiguous", never guessed.
--   ledger (key):        inventory_transactions.idempotency_key starts 'pos:'
--                        (apply_stock_movement: whole-bottle sales and every void).
--   ledger (glass pour): a by-the-glass ledger row carries NO idempotency_key; the
--                        key is on pour_events (migration :389-404; same in the
--                        baseline and 0285 bodies). Linked by same restaurant_id,
--                        inventory_id and created_at (both rows take now() in one
--                        RPC call; the #603 SQL test asserts both = now()). ADR
--                        0281's F2 sentence ("idempotency_key starts with pos:")
--                        does not reach these rows. Pour rows with source 'pos'
--                        that link to no 'pos:' pour event (Toast's 'toast_' keys,
--                        keyless pours) are out of F2's scope and only counted.
--   consumption:         wine_consumption_log.notes starts 'pos:' (notes = the key,
--                        pos-hub.service.ts:1590). A legacy 'pos:pos:' note
--                        (written 2026-08-12..25, :1566-1567) is read without its
--                        doubled prefix and counted.
--
-- STRICT READING (#603's readClosedAt, pos-hub.service.ts:115-190, re-done in SQL):
-- the till's own string is read from pos_checks.raw by the adapter's field
-- (pos-adapters.ts: generic_webhook/csv_import closedAt ?? closed_at :59,
-- square closed_at ?? updated_at :105-108, toast closedDate :195; clover is always
-- an ISO string the adapter wrote :149-153). It must match the ISO grammar and
-- round-trip (real month/day, hour <= 23, minute/second <= 59, offset minutes <= 59
-- and offset <= 14 h). A string that fails, or a value that is not a string, is
-- "unreadable": #603 refuses such a check (F4), so its rows stay as they are. Not
-- modelled: JS trim() also strips Unicode spaces; here only ASCII space/tab/CR/LF.
--
-- RESULT 2, per house and table (and an ALL HOUSES row per table). The six outcome
-- columns partition rows_scanned (partition_ok says so):
--   would_change          some date of the row is after the target, or NULL
--                         [2026-10-05, fork 1; was: the target differs from the
--                         row today]
--   already_match         every date of the row is at or before the target
--                         [2026-10-05, fork 1; was: the row already carries the
--                         target]
--   no_check              no check in this house answers the key
--   check_open            the check's closed_at is NULL today (re-sent open)
--   unreadable_closed_at  the till's string fails the strict reading: stays as is
--   ambiguous             two checks answer the key, or a pour row links to two
--                         pour events
--   b0 b1 b2_7 b8_30 b_gt30   would_change rows by size of the move. With a usable
--                         zone: house calendar days moved (restaurants.timezone).
--                         With no zone, or a zone Postgres does not know: elapsed
--                         hours in 24 h steps (b0 < 24 h, b1 24-47 h, b2_7 48-191 h,
--                         b8_30 192-743 h, b_gt30 >= 744 h); bucket_unit says which.
--                         Per house only (NULL on ALL HOUSES rows).
--   shift_min, shift_max  signed (target - today), over would_change rows;
--                         negative = moved earlier. [2026-10-05, fork 1: never
--                         positive. A ledger row's is below 0; a consumption
--                         row's can be 0, when created_at is on the target and
--                         only recorded_at moves. NULL when nothing changes.]
-- Caveat columns (not part of the partition):
--   void_rows             keyed ledger rows ending ':void'. pos_checks keeps only
--                         the LAST closed_at sent for a check, so a sale and its
--                         void are both measured against that one value.
--   legacy_pos_pos_notes  consumption notes read without a doubled 'pos:' prefix.
--   recorded_ne_created   consumption rows whose recorded_at differs from
--                         created_at today (their recorded_at moves differently).
--   change_till_not_kept  would_change rows whose check has no till string in raw
--                         (the stored closed_at is used as is; strictness unknown).
--   change_till_no_zone   would_change rows whose till string has no zone: the
--                         stored closed_at is Postgres's session-zone reading, #603
--                         reads it in the gateway's zone (ADR 0281 Assumptions).
--   no_check_other_house  no_check rows that a check in ANOTHER house answers.
--   pour_rows_not_pos_keyed  pour ledger rows (source 'pos') outside F2's scope.

\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '300s';

-- Result 1: what this session can see. Zeros here mean the role sees nothing,
-- not that nothing needs repair.
SELECT now()                                         AS run_at,
       current_setting('TimeZone')                   AS session_zone,
       current_setting('transaction_read_only')      AS read_only,
       current_user                                  AS role,
       current_setting('row_security')               AS row_security,
       (SELECT count(*) FROM public.restaurants)     AS restaurants_visible,
       (SELECT count(*) FROM public.pos_checks)      AS pos_checks_visible,
       (SELECT count(*) FROM public.inventory_transactions
         WHERE starts_with(idempotency_key, 'pos:')) AS ledger_pos_keys_visible,
       (SELECT count(*) FROM public.pour_events
         WHERE starts_with(idempotency_key, 'pos:')) AS pour_events_pos_keys_visible,
       (SELECT count(*) FROM public.wine_consumption_log
         WHERE starts_with(notes, 'pos:'))           AS consumption_pos_notes_visible;

\x on
-- Result 2.
WITH zones AS MATERIALIZED (
  SELECT DISTINCT name FROM pg_timezone_names
), house AS (
  SELECT r.id AS restaurant_id, r.name::text AS restaurant, z.name AS zone,
         CASE WHEN nullif(btrim(r.timezone), '') IS NULL THEN 'zone not set'
              WHEN z.name IS NULL THEN 'zone not readable: ' || r.timezone
              ELSE z.name END AS zone_label
    FROM public.restaurants r
    LEFT JOIN zones z ON z.name = r.timezone
), rows_ AS (
  -- ledger (key): apply_stock_movement rows the gateway keyed.
  SELECT 'ledger (key)'::text AS tbl, it.restaurant_id, it.idempotency_key AS k,
         it.transaction_date AS cur, NULL::timestamptz AS cur2, it.created_at AS entry,
         false AS legacy, 1::bigint AS links
    FROM public.inventory_transactions it
   WHERE starts_with(it.idempotency_key, 'pos:')
  UNION ALL
  -- ledger (glass pour): record_glass_pour rows, keyed through pour_events.
  SELECT 'ledger (glass pour)', it.restaurant_id, p.k,
         it.transaction_date, NULL, it.created_at, false, p.links
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
  SELECT 'consumption', w.restaurant_id,
         CASE WHEN starts_with(w.notes, 'pos:pos:') THEN substr(w.notes, 5) ELSE w.notes END,
         w.created_at, w.recorded_at, w.created_at,
         starts_with(w.notes, 'pos:pos:'), 1
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
  SELECT m.tbl, m.restaurant_id, m.k, m.cur, m.cur2, m.legacy,
         h.restaurant, h.zone, h.zone_label, rd.reading,
         LEAST(c.closed_at, m.entry) AS target,
         CASE
           WHEN m.links = 0 THEN 'out of scope'
           WHEN m.links > 1 OR m.n_checks > 1 THEN 'ambiguous'
           WHEN m.n_checks = 0 THEN 'no check'
           WHEN c.closed_at IS NULL THEN 'check open'
           WHEN rd.reading = 'unreadable' THEN 'unreadable'
           -- Never later (ADR 0281 F2, fork 1): at or before the target is 'already'.
           WHEN m.cur <= LEAST(c.closed_at, m.entry)
            AND (m.tbl <> 'consumption' OR m.cur2 <= LEAST(c.closed_at, m.entry))
             THEN 'already'
           ELSE 'change'
         END AS outcome,
         m.links >= 1 AND m.n_checks = 0 AND EXISTS (
           SELECT 1 FROM public.pos_checks c2
            WHERE c2.restaurant_id <> m.restaurant_id
              AND c2.source = m.src
              AND c2.external_check_id = ANY (m.cands)) AS other_house
    FROM matched m
    JOIN house h ON h.restaurant_id = m.restaurant_id
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
), sized AS (
  SELECT x.*, x.target - x.cur AS shift,
         CASE WHEN x.outcome <> 'change' THEN NULL
              WHEN x.zone IS NOT NULL
                THEN abs((x.target AT TIME ZONE x.zone)::date - (x.cur AT TIME ZONE x.zone)::date)
              ELSE floor(abs(extract(epoch FROM x.target - x.cur)) / 86400)::int
         END AS steps
    FROM cls x
)
SELECT CASE WHEN grouping(s.restaurant_id) = 1 THEN 'ALL HOUSES' ELSE s.restaurant_id::text END AS restaurant_id,
       CASE WHEN grouping(s.restaurant_id) = 1 THEN '' ELSE max(s.restaurant) END   AS restaurant,
       CASE WHEN grouping(s.restaurant_id) = 1 THEN '' ELSE max(s.zone_label) END   AS zone,
       s.tbl                                                                    AS "table",
       count(*) FILTER (WHERE s.outcome <> 'out of scope')                      AS rows_scanned,
       count(*) FILTER (WHERE s.outcome = 'change')                             AS would_change,
       count(*) FILTER (WHERE s.outcome = 'already')                            AS already_match,
       count(*) FILTER (WHERE s.outcome = 'no check')                           AS no_check,
       count(*) FILTER (WHERE s.outcome = 'check open')                         AS check_open,
       count(*) FILTER (WHERE s.outcome = 'unreadable')                         AS unreadable_closed_at,
       count(*) FILTER (WHERE s.outcome = 'ambiguous')                          AS ambiguous,
       count(*) FILTER (WHERE s.outcome <> 'out of scope')
         = count(*) FILTER (WHERE s.outcome IN ('change', 'already', 'no check', 'check open',
                                                'unreadable', 'ambiguous'))     AS partition_ok,
       CASE WHEN grouping(s.restaurant_id) = 1 THEN 'per house only'
            WHEN max(s.zone) IS NOT NULL THEN 'house days'
            ELSE '24 h steps (' || max(s.zone_label) || ')' END                 AS bucket_unit,
       CASE WHEN grouping(s.restaurant_id) = 0 THEN count(*) FILTER (WHERE s.steps = 0) END              AS b0,
       CASE WHEN grouping(s.restaurant_id) = 0 THEN count(*) FILTER (WHERE s.steps = 1) END              AS b1,
       CASE WHEN grouping(s.restaurant_id) = 0 THEN count(*) FILTER (WHERE s.steps BETWEEN 2 AND 7) END  AS b2_7,
       CASE WHEN grouping(s.restaurant_id) = 0 THEN count(*) FILTER (WHERE s.steps BETWEEN 8 AND 30) END AS b8_30,
       CASE WHEN grouping(s.restaurant_id) = 0 THEN count(*) FILTER (WHERE s.steps > 30) END             AS b_gt30,
       min(s.shift) FILTER (WHERE s.outcome = 'change')                         AS shift_min,
       max(s.shift) FILTER (WHERE s.outcome = 'change')                         AS shift_max,
       count(*) FILTER (WHERE s.outcome <> 'out of scope' AND right(s.k, 5) = ':void') AS void_rows,
       count(*) FILTER (WHERE s.legacy)                                         AS legacy_pos_pos_notes,
       count(*) FILTER (WHERE s.tbl = 'consumption' AND s.cur2 IS DISTINCT FROM s.cur) AS recorded_ne_created,
       count(*) FILTER (WHERE s.outcome = 'change' AND s.reading = 'not kept')  AS change_till_not_kept,
       count(*) FILTER (WHERE s.outcome = 'change' AND s.reading = 'read, no zone') AS change_till_no_zone,
       count(*) FILTER (WHERE s.other_house)                                    AS no_check_other_house,
       count(*) FILTER (WHERE s.outcome = 'out of scope')                       AS pour_rows_not_pos_keyed
  FROM sized s
 GROUP BY GROUPING SETS ((s.restaurant_id, s.tbl), (s.tbl))
 ORDER BY grouping(s.restaurant_id), max(s.restaurant), s.restaurant_id, s.tbl;

ROLLBACK;
