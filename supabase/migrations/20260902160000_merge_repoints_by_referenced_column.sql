-- A catalog-driven repoint must name the column that references the key, not
-- every column of the constraint.
--
-- THE DEFECT
--
-- merge_library_wines() discovers the foreign keys it has to repoint from
-- pg_constraint rather than from a hard-coded list -- deliberately, and that
-- decision is still right: a hard-coded list is wrong the moment someone adds
-- a referencing table, and wrong silently. But both discovery loops unnested
-- `c.conkey` alone:
--
--     JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
--     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
--
-- `conkey` is the list of *referencing* columns. For a single-column foreign
-- key it has one element and the loop is correct. For a COMPOSITE foreign key
-- it has one element per component, and the loop emits one
-- `UPDATE <table> SET <col> = <keeper id> WHERE <col> = <loser id>` per
-- COMPONENT -- including the components that do not reference the key at all.
--
-- WHAT THAT ACTUALLY DOES -- measured, not reasoned (Postgres 17, 2026-09-02)
--
-- The consequence is not one failure mode but three, and the one that is
-- easiest to imagine is the rarest:
--
--   1. Non-uuid component (`(inventory_id, uom)`, the shape ADR 0070's ledger
--      migration introduces). The emitted statement is
--      `UPDATE t SET uom = <uuid> WHERE uom = <uuid>` and Postgres refuses it:
--        SQLSTATE 42883  operator does not exist: text = uuid
--      The MERGE ABORTS. No corruption -- but the error names an operator the
--      operator never wrote, on a statement they never wrote, and the merge is
--      simply impossible until someone reads this loop.
--
--   2. uuid component, every component non-null. The rewrite is checked by the
--      composite foreign key itself and rejected: SQLSTATE 23503. Merge aborts.
--
--   3. uuid component, another component NULL. A MATCH SIMPLE foreign key --
--      the default, and what every FK in this schema is -- is NOT enforced when
--      any component is null. The wrong-column write lands, unchecked and
--      silent. This is the corruption case. It is narrow and it is real.
--
-- Latent today: no composite foreign key to `restaurant_inventory` or
-- `master_wine_library` exists outside `inventory_lots`, which loop 1 excludes.
-- ADR 0070's `inventory_lots_item_uom_fkey (inventory_id, uom)` is the first
-- one, and it lands on that excluded table -- so this stays latent even after
-- ADR 0070 ships. Fixed now because the loop is wrong regardless of whether
-- anything is currently standing on it, and because the shape that makes it
-- wrong (a catalog query that enumerates columns without asking what they
-- reference) is invisible in review.
--
-- THE FIX, AND THE PART THAT IS NOT JUST THE FIX
--
-- `fk_repoint_plan()` pairs `conkey` with `confkey` by ordinality, so each
-- referencing column is joined to the column it actually references, and keeps
-- only the component that lands on the key. That is the repair.
--
-- The rest of it exists because of what the old query did with what it could
-- not handle: nothing, silently. A foreign key that references
-- `restaurant_inventory` on some column OTHER than `id` was enumerated,
-- repointed on a column that would never match, reported zero rows, and left
-- its rows to be orphaned or cascade-deleted when the loser row went away --
-- and the merge log said only that zero rows moved, which reads as "nothing to
-- do". So the plan returns EVERY foreign key to the target, each one either
-- with a repointable id column or with a `problem` stating why it has none,
-- and the merge RAISES on a problem rather than skipping the row. A merge that
-- cannot account for a reference must refuse, not proceed quietly.
--
-- `fk_repoint_blockers()` covers the other half. Repointing only the id
-- component of a composite key leaves the other components untouched -- which
-- is correct, because a lot's `uom` is a fact about the lot and not about its
-- parent row, and rewriting it to the keeper's value would trade a loud abort
-- for silent semantic corruption. But it means the row can fail the composite
-- FK after the move. Rather than let that surface as a bare 23503 from a
-- statement nobody wrote, the merge counts the rows that would fail FIRST and
-- refuses with a message that names the constraint, the components, and what
-- to reconcile. It counts only rows whose other components are all NOT NULL,
-- because MATCH SIMPLE does not check the rest -- see case 3 above.
--
-- SCOPE. One sibling defect in the same function is deliberately NOT fixed
-- here: the UNIQUE-collision loop reads `pg_index.indkey` and joins to
-- pg_attribute by attnum, so an expression column (attnum 0) is dropped from
-- `other_cols` and a partial index's `indpred` is ignored -- both of which make
-- the collision DELETE match more broadly than it should. Also latent (no
-- expression or partial UNIQUE index exists on any table referencing
-- `master_wine_library`, checked 2026-09-02). Filed as OD-119 with its own
-- evidence rather than folded into this migration. See ADR 0076.

-- ---------------------------------------------------------------------------
-- The plan: every FK to p_target, each with the column that references
-- p_key_column, or a stated reason it has none. Never silently short.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fk_repoint_plan(
  p_target       regclass,
  p_skip_tables  regclass[] DEFAULT '{}'::regclass[],
  p_skip_columns text[]     DEFAULT '{}'::text[],
  p_key_column   text       DEFAULT 'id'
)
RETURNS TABLE (
  constraint_name   text,
  child_table       text,
  child_oid         oid,
  id_column         text,
  other_child_cols  text[],
  other_parent_cols text[],
  problem           text
)
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $fn$
  WITH comp AS (
    -- One row per COMPONENT, with the referencing column paired to the column
    -- it actually references. The `f.ord = k.ord` join is the whole repair:
    -- conkey[i] references confkey[i], and unnesting either one alone loses
    -- that correspondence.
    SELECT c.oid                          AS c_oid,
           c.conname::text                AS c_name,
           c.conrelid                     AS c_child_oid,
           c.conrelid::regclass::text     AS c_child,
           k.ord                          AS c_ord,
           a.attname::text                AS c_child_col,
           ref.attname::text              AS c_parent_col
    FROM pg_constraint c
    JOIN unnest(c.conkey)  WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN unnest(c.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
    JOIN pg_attribute a   ON a.attrelid   = c.conrelid  AND a.attnum   = k.attnum
    JOIN pg_attribute ref ON ref.attrelid = c.confrelid AND ref.attnum = f.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = p_target
      AND NOT (c.conrelid = ANY (p_skip_tables))
  ),
  -- A skip names a COLUMN but excludes its whole constraint: half a composite
  -- key is not a thing this can repoint, and dropping only the named component
  -- would resurrect exactly the bug above.
  skipped AS (
    SELECT DISTINCT c_oid FROM comp
    WHERE c_child || '.' || c_child_col = ANY (p_skip_columns)
  ),
  cons AS (
    SELECT c_oid, c_name, c_child_oid, c_child,
           count(*)                                                   AS n_comp,
           count(*) FILTER (WHERE c_parent_col = p_key_column)         AS n_key,
           (array_agg(c_child_col ORDER BY c_ord)
              FILTER (WHERE c_parent_col = p_key_column))[1]           AS key_col,
           coalesce(array_agg(c_child_col  ORDER BY c_ord)
              FILTER (WHERE c_parent_col <> p_key_column), '{}')       AS rest_child,
           coalesce(array_agg(c_parent_col ORDER BY c_ord)
              FILTER (WHERE c_parent_col <> p_key_column), '{}')       AS rest_parent,
           array_agg(c_child_col || ' -> ' || c_parent_col ORDER BY c_ord) AS pairs
    FROM comp
    WHERE c_oid NOT IN (SELECT c_oid FROM skipped)
    GROUP BY c_oid, c_name, c_child_oid, c_child
  )
  SELECT cons.c_name,
         cons.c_child,
         cons.c_child_oid,
         CASE WHEN cons.n_key = 1 THEN cons.key_col     END,
         CASE WHEN cons.n_key = 1 THEN cons.rest_child  END,
         CASE WHEN cons.n_key = 1 THEN cons.rest_parent END,
         CASE
           WHEN cons.n_key = 0 THEN format(
             'constraint %s on %s references %s but no component of it references %I '
             '(components: %s). A merge cannot repoint it, and its rows would be '
             'orphaned or cascade-deleted when the loser row is removed.',
             cons.c_name, cons.c_child, p_target::text, p_key_column,
             array_to_string(cons.pairs, ', '))
           WHEN cons.n_key > 1 THEN format(
             'constraint %s on %s references %I from %s components (%s); which one '
             'a merge should repoint is not derivable from the catalog.',
             cons.c_name, cons.c_child, p_key_column, cons.n_key,
             array_to_string(cons.pairs, ', '))
         END
  FROM cons
  ORDER BY cons.c_child, cons.c_name;
$fn$;

COMMENT ON FUNCTION public.fk_repoint_plan IS
  'Every foreign key pointing at p_target, one row each, naming the single '
  'component that references p_key_column -- or, in `problem`, why it has no '
  'such component. Pairs conkey with confkey by ordinality: unnesting conkey '
  'alone (the pre-2026-09-02 shape) treated every component of a composite key '
  'as if it were the referencing column. Returns a row for EVERY constraint, '
  'including the ones it cannot plan, so a caller cannot mistake silence for '
  'nothing-to-do.';

-- ---------------------------------------------------------------------------
-- The blockers: rows that would fail a composite FK once only the id
-- component moves. Counted before the move, so the refusal can be readable.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fk_repoint_blockers(
  p_child             regclass,
  p_id_column         text,
  p_other_child_cols  text[],
  p_other_parent_cols text[],
  p_parent            regclass,
  p_key_column        text,
  p_keeper            uuid,
  p_loser             uuid
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $fn$
DECLARE
  v_notnull text;
  v_match   text;
  v_n       bigint;
BEGIN
  -- Single-column key: moving the id column IS the whole repoint.
  IF p_other_child_cols IS NULL OR cardinality(p_other_child_cols) = 0 THEN
    RETURN 0;
  END IF;

  -- MATCH SIMPLE (every FK in this schema) skips enforcement entirely when any
  -- component is null, so a row with a null component cannot be a blocker --
  -- counting it would refuse a merge the database would have allowed.
  SELECT string_agg(format('ch.%I IS NOT NULL', c), ' AND ')
    INTO v_notnull
    FROM unnest(p_other_child_cols) AS c;

  SELECT string_agg(format('p.%I IS NOT DISTINCT FROM ch.%I', pc, cc), ' AND ')
    INTO v_match
    FROM unnest(p_other_parent_cols, p_other_child_cols) AS t(pc, cc);

  EXECUTE format(
    'SELECT count(*) FROM %s ch WHERE ch.%I = $2 AND (%s) '
    'AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = $1 AND (%s))',
    p_child, p_id_column, v_notnull, p_parent, p_key_column, v_match)
    INTO v_n
    USING p_keeper, p_loser;

  RETURN v_n;
END;
$fn$;

COMMENT ON FUNCTION public.fk_repoint_blockers IS
  'Counts rows that reference p_loser through a COMPOSITE foreign key and '
  'whose remaining components do not exist on p_keeper -- i.e. the rows that '
  'would raise 23503 once the id component is repointed. Only the id component '
  'moves: the other components are facts about the referencing row, not about '
  'its parent, so rewriting them would trade a loud abort for silent '
  'corruption. Rows with a null component are excluded because MATCH SIMPLE '
  'does not enforce those.';
CREATE OR REPLACE FUNCTION public.merge_library_wines(
  p_keeper uuid, p_loser uuid, p_dry_run boolean DEFAULT true, p_actor text DEFAULT NULL::text
)
RETURNS TABLE(step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $function$
DECLARE
  v_fk          record;
  v_idx         record;
  v_other_cols  text;
  v_sql         text;
  v_count       bigint;
  v_steps       jsonb := '[]'::jsonb;
  v_snapshot    jsonb;
  v_inv         record;
  v_keeper_vintage integer;
  v_loser_vintage  integer;
  v_loser_name     text;
  v_loser_producer text;
  v_blockers       bigint;
  v_lot_fk         record;
BEGIN
  IF p_keeper = p_loser THEN
    RAISE EXCEPTION 'keeper and loser are the same row (%)', p_keeper;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.master_wine_library WHERE id = p_keeper) THEN
    RAISE EXCEPTION 'keeper % does not exist', p_keeper;
  END IF;
  SELECT to_jsonb(m), m.vintage, m.name, m.producer
    INTO v_snapshot, v_loser_vintage, v_loser_name, v_loser_producer
  FROM public.master_wine_library m WHERE m.id = p_loser;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'loser % does not exist', p_loser;
  END IF;

  SELECT vintage INTO v_keeper_vintage FROM public.master_wine_library WHERE id = p_keeper;
  IF v_keeper_vintage IS NOT NULL AND v_loser_vintage IS NOT NULL
     AND v_keeper_vintage <> v_loser_vintage THEN
    RAISE EXCEPTION
      'refusing to merge % (vintage %) into % (vintage %) -- vintages '
      'disagree and neither is null. This is evidence of two different '
      'wines, not a data-quality gap to resolve by picking one.',
      p_loser, v_loser_vintage, p_keeper, v_keeper_vintage;
  END IF;

  FOR v_inv IN
    SELECT li.id AS loser_inv, ki.id AS keeper_inv, li.restaurant_id
    FROM public.restaurant_inventory li
    JOIN public.restaurant_inventory ki
      ON ki.restaurant_id = li.restaurant_id AND ki.master_wine_id = p_keeper
    WHERE li.master_wine_id = p_loser
  LOOP
    -- inventory_lots is moved by hand (both of its keys travel together), so
    -- the plan loop below excludes it -- but the hand-written move is subject
    -- to exactly the same composite key. ADR 0075's
    -- `inventory_lots_item_uom_fkey (inventory_id, uom) -> (id, canonical_uom)`
    -- is the first one, and it is the ONE composite key to a merge target that
    -- actually ships. It bites whenever a keeper and a loser inventory row are
    -- based in different units, which is not exotic -- it is the ordinary
    -- duplicate produced by two different intake paths.
    --
    -- Measured against that branch's schema (2026-09-02), so the claim here is
    -- narrow and true: WITHOUT this check the move already fails, at ADR 0075's
    -- own unit trigger, `23514 uom ml disagrees with the item`. That message is
    -- accurate and it is not a silent corruption. What it does not say is that
    -- a MERGE is what moved the lot, and it arrives after the merge has already
    -- done other work. This check refuses first, names the constraint and the
    -- keeper row, and does not depend on that trigger existing -- on a schema
    -- with the key and no trigger, the same move raises a bare 23503.
    FOR v_lot_fk IN
      SELECT * FROM public.fk_repoint_plan('public.restaurant_inventory'::regclass)
       WHERE child_oid = 'public.inventory_lots'::regclass::oid
    LOOP
      IF v_lot_fk.problem IS NOT NULL THEN
        RAISE EXCEPTION
          'refusing to merge: this merge cannot account for an inventory_lots '
          'reference. %', v_lot_fk.problem;
      END IF;

      v_blockers := public.fk_repoint_blockers(
        'public.inventory_lots'::regclass, v_lot_fk.id_column,
        v_lot_fk.other_child_cols, v_lot_fk.other_parent_cols,
        'public.restaurant_inventory'::regclass, 'id',
        v_inv.keeper_inv, v_inv.loser_inv);
      IF v_blockers > 0 THEN
        RAISE EXCEPTION
          'refusing to merge: % lot(s) would violate % once moved onto the '
          'keeper inventory row. That key is composite (%); a lot''s % is a '
          'fact about the lot and moving it does not change it, so the keeper '
          'row (%) must agree before the lots can move. Re-base one side '
          'first -- an explicit rescale, never a relabel.',
          v_blockers, v_lot_fk.constraint_name,
          array_to_string(v_lot_fk.other_child_cols, ', '),
          array_to_string(v_lot_fk.other_child_cols, ', '), v_inv.keeper_inv;
      END IF;
    END LOOP;

    UPDATE public.inventory_lots
    SET inventory_id = v_inv.keeper_inv, master_wine_id = p_keeper
    WHERE inventory_id = v_inv.loser_inv;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    step := 'inventory_lots.moved'; detail := v_inv.restaurant_id::text;
    rows_affected := v_count;
    v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
    RETURN NEXT;

    -- inventory_lots is handled by hand above (both of its keys move together),
    -- so it is excluded here rather than repointed twice.
    FOR v_fk IN
      SELECT * FROM public.fk_repoint_plan(
        'public.restaurant_inventory'::regclass,
        ARRAY['public.inventory_lots'::regclass]
      )
    LOOP
      IF v_fk.problem IS NOT NULL THEN
        RAISE EXCEPTION
          'refusing to merge: this merge cannot account for an inventory '
          'reference. %', v_fk.problem;
      END IF;

      v_blockers := public.fk_repoint_blockers(
        v_fk.child_oid::regclass, v_fk.id_column,
        v_fk.other_child_cols, v_fk.other_parent_cols,
        'public.restaurant_inventory'::regclass, 'id',
        v_inv.keeper_inv, v_inv.loser_inv);
      IF v_blockers > 0 THEN
        RAISE EXCEPTION
          'refusing to merge: % row(s) in %.% would violate % once repointed. '
          'That key is composite (%); this merge moves only the inventory id, '
          'because the other component(s) describe the referencing row and not '
          'its parent -- rewriting them would corrupt data rather than move it. '
          'Reconcile % on the keeper inventory row (%) first.',
          v_blockers, v_fk.child_table, v_fk.id_column, v_fk.constraint_name,
          array_to_string(v_fk.other_child_cols, ', '),
          array_to_string(v_fk.other_parent_cols, ', '), v_inv.keeper_inv;
      END IF;
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.child_table, v_fk.id_column, v_fk.id_column)
        USING v_inv.keeper_inv, v_inv.loser_inv;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        step := 'inventory_ref.repointed'; detail := v_fk.child_table || '.' || v_fk.id_column;
        rows_affected := v_count;
        v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
        RETURN NEXT;
      END IF;
    END LOOP;

    DELETE FROM public.restaurant_inventory WHERE id = v_inv.loser_inv;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    step := 'restaurant_inventory.merged'; detail := v_inv.restaurant_id::text;
    rows_affected := v_count;
    v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
    RETURN NEXT;
  END LOOP;

  -- master_wine_library.superseded_by is the merge's own output (set below);
  -- repointing it would clobber the record of an earlier merge. Skipped by
  -- name rather than by the old `a.attname <> 'superseded_by'` filter, which
  -- would also have silenced that column on any OTHER table that happened to
  -- use the name.
  FOR v_fk IN
    SELECT * FROM public.fk_repoint_plan(
      'public.master_wine_library'::regclass,
      '{}'::regclass[],
      ARRAY['public.master_wine_library.superseded_by']
    )
  LOOP
    IF v_fk.problem IS NOT NULL THEN
      RAISE EXCEPTION
        'refusing to merge: this merge cannot account for a library '
        'reference. %', v_fk.problem;
    END IF;

    v_blockers := public.fk_repoint_blockers(
      v_fk.child_oid::regclass, v_fk.id_column,
      v_fk.other_child_cols, v_fk.other_parent_cols,
      'public.master_wine_library'::regclass, 'id', p_keeper, p_loser);
    IF v_blockers > 0 THEN
      RAISE EXCEPTION
        'refusing to merge: % row(s) in %.% would violate % once repointed. '
        'That key is composite (%); this merge moves only the library id, '
        'because the other component(s) describe the referencing row and not '
        'its parent -- rewriting them would corrupt data rather than move it. '
        'Reconcile % on the keeper wine (%) first.',
        v_blockers, v_fk.child_table, v_fk.id_column, v_fk.constraint_name,
        array_to_string(v_fk.other_child_cols, ', '),
        array_to_string(v_fk.other_parent_cols, ', '), p_keeper;
    END IF;
    FOR v_idx IN
      SELECT i.indexrelid,
             array_agg(att.attname ORDER BY ik.ord)
               FILTER (WHERE att.attname <> v_fk.id_column) AS other_cols
      FROM pg_index i
      JOIN unnest(i.indkey) WITH ORDINALITY AS ik(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ik.attnum
      WHERE i.indrelid = v_fk.child_oid
        AND i.indisunique
        AND EXISTS (
          SELECT 1 FROM unnest(i.indkey) AS kk(attnum)
          JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = kk.attnum
          WHERE a2.attname = v_fk.id_column
        )
      GROUP BY i.indexrelid
    LOOP
      IF v_idx.other_cols IS NULL OR cardinality(v_idx.other_cols) = 0 THEN
        v_sql := format('DELETE FROM %s l WHERE l.%I = $1 AND EXISTS '
                        '(SELECT 1 FROM %s k WHERE k.%I = $2)',
                        v_fk.child_table, v_fk.id_column, v_fk.child_table, v_fk.id_column);
      ELSE
        SELECT string_agg(format('k.%I IS NOT DISTINCT FROM l.%I', c, c), ' AND ')
        INTO v_other_cols
        FROM unnest(v_idx.other_cols) AS c;
        v_sql := format('DELETE FROM %s l WHERE l.%I = $1 AND EXISTS '
                        '(SELECT 1 FROM %s k WHERE k.%I = $2 AND %s)',
                        v_fk.child_table, v_fk.id_column, v_fk.child_table, v_fk.id_column, v_other_cols);
      END IF;

      EXECUTE v_sql USING p_loser, p_keeper;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        step := 'collision.dropped';
        detail := v_fk.child_table || '.' || v_fk.id_column || ' via ' || v_idx.indexrelid::regclass::text;
        rows_affected := v_count;
        v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
        RETURN NEXT;
      END IF;
    END LOOP;

    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.child_table, v_fk.id_column, v_fk.id_column)
      USING p_keeper, p_loser;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      step := 'reference.repointed'; detail := v_fk.child_table || '.' || v_fk.id_column;
      rows_affected := v_count;
      v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
      RETURN NEXT;
    END IF;
  END LOOP;

  UPDATE public.master_wine_library
     SET deleted_at = now(), superseded_by = p_keeper
   WHERE id = p_loser;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'master_wine_library.superseded'; detail := p_loser::text || ' -> ' || p_keeper::text;
  rows_affected := v_count;
  v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
  RETURN NEXT;

  -- Fixed: report the REAL insert count, not a hardcoded 1. ON CONFLICT DO
  -- NOTHING means an alias that already existed (same canonical_id +
  -- normalized name) correctly reports 0, not a fabricated success.
  INSERT INTO public.wine_aliases (canonical_id, alias_name, alias_name_normalized, alias_source)
  VALUES (p_keeper, coalesce(v_loser_producer, '') || ' ' || coalesce(v_loser_name, ''),
          public.wine_normalize_text(coalesce(v_loser_producer, '') || ' ' || coalesce(v_loser_name, '')),
          'merge:' || p_loser::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'wine_aliases.recorded'; detail := p_loser::text;
  rows_affected := v_count;
  v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
  RETURN NEXT;

  INSERT INTO public.wine_merge_log (keeper_id, loser_id, loser_snapshot, steps, merged_by)
  VALUES (p_keeper, p_loser, v_snapshot, v_steps, p_actor);

  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY RUN COMPLETE — rolled back. Pass p_dry_run => false to apply.'
      USING ERRCODE = 'query_canceled', DETAIL = v_steps::text;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.merge_library_wines IS
  'Collapse a duplicate master_wine_library row into a keeper. Repoints every '
  'FK discovered from the catalog -- by the component that actually references '
  'the id, not by every component of the constraint (fixed 2026-09-02, ADR '
  '0076) -- merges restaurant_inventory by moving lots so the stock projection '
  'recomputes, drops rows that would violate a UNIQUE constraint, soft-deletes '
  'the loser and logs to wine_merge_log. Refuses rather than proceeding when a '
  'referencing key cannot be planned, or when a composite key would reject the '
  'repointed rows. Refuses to merge two rows whose vintages disagree and '
  'neither is null. Defaults to a dry run that does the real work and then '
  'raises to roll it back. See unsupersede_library_wine() for the partial '
  'reversal.';

REVOKE ALL ON FUNCTION public.fk_repoint_plan(regclass, regclass[], text[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fk_repoint_blockers(regclass, text, text[], text[], regclass, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fk_repoint_plan(regclass, regclass[], text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fk_repoint_blockers(regclass, text, text[], text[], regclass, text, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Assertion, run at migration time against the real catalog. Not a comment
-- about what the fix does -- a statement that fails the migration if it does
-- not. Both merge targets must be fully planned: every foreign key to them
-- either names an id column or is deliberately skipped, and none reports a
-- problem. If a future migration adds a foreign key this merge cannot account
-- for, `supabase db push` says so here rather than the merge saying nothing.
-- ---------------------------------------------------------------------------

DO $assert$
DECLARE
  v_unplanned text;
  v_composite int;
BEGIN
  SELECT string_agg(problem, E'\n  ') INTO v_unplanned
  FROM (
    SELECT problem FROM public.fk_repoint_plan(
      'public.restaurant_inventory'::regclass, ARRAY['public.inventory_lots'::regclass])
    UNION ALL
    SELECT problem FROM public.fk_repoint_plan(
      'public.master_wine_library'::regclass, '{}'::regclass[],
      ARRAY['public.master_wine_library.superseded_by'])
  ) p WHERE problem IS NOT NULL;

  IF v_unplanned IS NOT NULL THEN
    RAISE EXCEPTION E'merge_library_wines cannot account for these references:\n  %', v_unplanned;
  END IF;

  -- Every planned row names exactly one id column. This is the regression
  -- assertion proper: under the pre-fix query a composite key produced one row
  -- PER COMPONENT, so this count would exceed the number of constraints.
  SELECT count(*) INTO v_composite
  FROM public.fk_repoint_plan('public.restaurant_inventory'::regclass,
                              ARRAY['public.inventory_lots'::regclass])
  WHERE id_column IS NULL;
  IF v_composite > 0 THEN
    RAISE EXCEPTION 'fk_repoint_plan returned % row(s) with no id column', v_composite;
  END IF;

  RAISE NOTICE 'merge_library_wines: every FK to restaurant_inventory and '
               'master_wine_library is planned by its id-referencing column.';
END
$assert$;
