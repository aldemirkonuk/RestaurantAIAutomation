-- inventory_analytics reads one house's lots, not every house's.
--
-- [2026-11-14, r41 inventory audit gap 3.] The view joins the lot rollup on
-- the good alone:
--
--     LEFT JOIN public.inventory_lot_rollup r ON r.inventory_id = ri.id
--
-- The rollup is a GROUP BY over inventory_lots, and a join on inventory_id
-- gives the planner nothing it can push into that GROUP BY. So every
-- `GET /inventory/:rid` (every 60 s per open tab, on focus, and after each
-- stock event) aggregated EVERY house's lots and then threw all but one
-- house's away. In a PGlite build of every migration with 30 houses x 300
-- goods x 3 lots: Seq Scan on inventory_lots, 27,000 rows, for 900 wanted.
--
-- The join now also says the lot's house is the good's house:
--
--     ON r.inventory_id = ri.id AND r.restaurant_id = ri.restaurant_id
--
-- restaurant_id is a rollup group key, so the caller's
-- `restaurant_id = <house>` reaches the rollup through the join and the lot
-- read becomes an index scan on idx_inventory_lots_ri (restaurant_id, ...).
-- A lot whose house differs from its good's house was never this house's
-- stock; it no longer adds to this house's on_hand. Every row of the view is
-- otherwise unchanged (the probe compares a digest of every row before and
-- after).
--
-- The session's call under the founder's /goal of 2026-11-07. The view is
-- PATCHED, not re-typed: the one join is rewritten in the definition the
-- database holds now, asserted to match exactly once. Rejected:
--   * re-typing the whole view (as #1151/#1602 do). Its CTEs move on open
--     chains; a copy taken today would quietly undo whatever lands before
--     this file applies.
--   * a LATERAL read of the rollup per good. It is also an index scan, but
--     one nested loop per good, and it changes more text than the fix needs.
--   * filtering the rollup view itself. It has no house to filter by; the
--     caller's house only exists in the join.
-- Options, grants and every column are captured, re-applied and asserted
-- unchanged, as the earlier redefinitions of this view do.

BEGIN;

DO $mig$
DECLARE
  v_def text;
  v_new text;
  v_hits int;
  v_opts text[];
  v_acl text;
  v_cols text;
  v_after_opts text[];
  v_after_acl text;
  v_after_cols text;
  -- The join as pg_get_viewdef prints it (a join condition is always
  -- deparsed inside two parentheses), with or without the schema. The
  -- parentheses are matched exactly: the one after them closes the FROM
  -- list's join group.
  c_pattern constant text :=
    'LEFT JOIN (public\.)?inventory_lot_rollup r ON \(\(r\.inventory_id = ri\.id\)\)';
BEGIN
  SELECT c.reloptions, coalesce(c.relacl, acldefault('r', c.relowner))::text
    INTO v_opts, v_acl
    FROM pg_class c WHERE c.oid = 'public.inventory_analytics'::regclass;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.inventory_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  v_def := pg_get_viewdef('public.inventory_analytics'::regclass, false);
  SELECT count(*) INTO v_hits FROM regexp_matches(v_def, c_pattern, 'g');
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'inventory_analytics_reads_one_houses_lots: expected the lot rollup joined on inventory_id alone exactly once, found % (the view moved; re-read it before patching)', v_hits;
  END IF;
  v_new := regexp_replace(
    v_def, c_pattern,
    'LEFT JOIN public.inventory_lot_rollup r ON ((r.inventory_id = ri.id) AND (r.restaurant_id = ri.restaurant_id))');

  EXECUTE 'CREATE OR REPLACE VIEW public.inventory_analytics AS ' || v_new;

  IF v_opts IS NOT NULL THEN
    EXECUTE format('ALTER VIEW public.inventory_analytics SET (%s)', array_to_string(v_opts, ', '));
  END IF;
  SELECT c.reloptions, coalesce(c.relacl, acldefault('r', c.relowner))::text
    INTO v_after_opts, v_after_acl
    FROM pg_class c WHERE c.oid = 'public.inventory_analytics'::regclass;
  SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
    INTO v_after_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.inventory_analytics'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_after_opts IS DISTINCT FROM v_opts THEN
    RAISE EXCEPTION 'inventory_analytics_reads_one_houses_lots: reloptions changed (% -> %)', v_opts, v_after_opts;
  END IF;
  IF v_after_acl IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'inventory_analytics_reads_one_houses_lots: grants changed (% -> %)', v_acl, v_after_acl;
  END IF;
  IF v_after_cols IS DISTINCT FROM v_cols THEN
    RAISE EXCEPTION 'inventory_analytics_reads_one_houses_lots: columns changed (% -> %)', v_cols, v_after_cols;
  END IF;
  IF pg_get_viewdef('public.inventory_analytics'::regclass, false) !~ 'r\.restaurant_id = ri\.restaurant_id' THEN
    RAISE EXCEPTION 'inventory_analytics_reads_one_houses_lots: the house condition did not land';
  END IF;
END
$mig$;

COMMIT;
