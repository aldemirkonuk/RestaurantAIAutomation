-- A unique index decides what collides. Nothing else gets to have an opinion.
--
-- WHAT THIS REPLACES
--
-- ADR 0076 fixed how merge_library_wines() finds the foreign keys it repoints.
-- It left alone the loop that runs next: the one that deletes loser-side rows
-- which would collide with a keeper-side row on a UNIQUE index. That loop read
-- `pg_index.indkey`, joined it to `pg_attribute` by attnum, and rebuilt the
-- index's equality test by hand as a string of
-- `k.col IS NOT DISTINCT FROM l.col`.
--
-- OD-119 filed two defects in it. An audit of all seven UNIQUE indexes the loop
-- can actually reach (2026-09-02, catalog query, not grep) found FIVE, and the
-- one OD-119 did not name is the one losing rows today:
--
--   1. EXPRESSION columns have attnum 0, so the join found nothing and the
--      component vanished from the comparison. Fewer AND-terms, broader match,
--      more deleted.                                             [latent: 0 of 7]
--   2. PARTIAL indexes: `indpred` ignored, so an index constraining a subset of
--      rows was treated as constraining all of them.             [latent: 0 of 7]
--   3. INCLUDE columns (`indnatts` > `indnkeyatts`) are not part of uniqueness
--      but were compared as if they were -- narrowing the match, so a genuine
--      collision survived to raise 23505 on the repoint instead. [latent: 0 of 7]
--   4. INVALID indexes (a failed CONCURRENTLY build) enforce nothing, and were
--      treated as constraints.                                   [latent: 0 of 7]
--   5. NULL SEMANTICS. `IS NOT DISTINCT FROM` makes NULL equal NULL. A unique
--      index holds NULLs DISTINCT unless it says `NULLS NOT DISTINCT` (none of
--      the seven does), so two rows that are NULL in a key column DO NOT
--      collide -- and the loop deleted one of them anyway.
--                                    [REACHABLE BY SCHEMA: 1 of 7, sku_mappings]
--
-- Measured, on the schema built from all 88 migrations, keeper and loser both
-- carrying a GLOBAL (restaurant_id IS NULL) mapping for the same SKU:
--
--   sku_mappings, UNIQUE (restaurant_id, master_wine_id, sku_type, sku_value),
--   restaurant_id nullable. Probe: "index permits both rows on the keeper: t".
--   Then merge_library_wines() on the same fixture --
--     pre-fix : "sku_mappings rows on the keeper after merge: 1"
--     fixed   : "sku_mappings rows on the keeper after merge: 2"
--   The old loop deleted a row nothing was stopping it from keeping.
--
--   Two corrections to an earlier draft of this header, kept because the
--   mistake is the instructive part. It first named `wine_aliases` as a second
--   instance: WRONG. Its nullable key column is `alias_name_normalized`, and
--   `trg_normalize_alias` derives it from a NOT NULL `alias_name` on every
--   INSERT and UPDATE, so it is never actually null and the case is
--   unreachable there. And the "proof" of that non-instance counted rows with
--   `alias_source IS NULL` -- a NOT NULL column with a default, so the
--   predicate could only ever return 0. A probe that cannot return anything
--   else is not evidence. Whether production holds two such sku_mappings rows
--   today is NOT knowable from here and is not claimed.
--
-- THE DECISION
--
-- The fix is not to add four more cases. Four of the five were invisible
-- because nobody pictured that index shape, and the fifth was invisible because
-- `IS NOT DISTINCT FROM` reads like the careful choice. A unique index is
-- expressions, partial predicates, opclasses, collations, INCLUDE columns and
-- null semantics; any hand-built equality test is a second implementation of
-- all of that, and it drifts the moment someone adds a shape the author did not
-- picture. Reconstructing it from the catalog is the defect, not the details.
--
-- So the reconstruction is deleted outright. The repoint is ATTEMPTED and
-- Postgres answers: a row that raises 23505 collided, and is dropped in favour
-- of the keeper's; a row that does not, did not. That is right by construction
-- for every index shape, including ones added after this migration -- which is
-- the property the previous loop could never have.
--
-- The set-based UPDATE stays as the fast path, so nothing collides at no
-- per-row cost, and one subtransaction covers the ordinary case. Only a real
-- collision drops to per-row, bounded by the rows referencing the loser in that
-- one table. The dropped step now names the constraint that ACTUALLY fired
-- (GET STACKED DIAGNOSTICS CONSTRAINT_NAME) instead of one the loop guessed
-- might.
--
-- WHAT THIS DOES NOT COVER, stated rather than discovered later
--
--   * DEFERRED unique constraints raise at COMMIT, not at the UPDATE, so
--     neither this nor the loop it replaces can catch one. None of the seven is
--     deferred.
--   * EXCLUSION constraints (23P01) are not caught. The old loop did not
--     consider them either; this is unchanged scope, not a new gap.
--   * Loop 1 (references to restaurant_inventory) still has NO collision
--     handling and aborts the merge on 23505. That asymmetry predates this
--     change and is left alone deliberately: teaching loop 1 to DELETE rows
--     would be new destructive behaviour, and aborting is the safe direction.
CREATE OR REPLACE FUNCTION public.merge_library_wines(
  p_keeper uuid, p_loser uuid, p_dry_run boolean DEFAULT true, p_actor text DEFAULT NULL::text
)
RETURNS TABLE(step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $function$
DECLARE
  v_fk          record;
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
  v_ctids          tid[];
  v_ctid           tid;
  v_con            text;
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
    -- Repoint, and let the INDEXES decide what collides.
    --
    -- This replaces a loop that reconstructed each UNIQUE index from
    -- `pg_index.indkey` and rebuilt its equality test by hand. That
    -- reconstruction was wrong in five separate ways (ADR 0081), and the fifth
    -- is reachable on the schema as it stands: it compared with
    -- `IS NOT DISTINCT FROM`, so two NULLs counted as a collision -- while a
    -- default unique index holds NULLs DISTINCT and would have allowed both
    -- rows. sku_mappings is UNIQUE on (restaurant_id, master_wine_id, sku_type,
    -- sku_value) with restaurant_id NULLABLE, so two global mappings for one
    -- SKU are exactly that shape, and the merge deleted one of them.
    --
    -- The lesson generalises past the five: a unique index is expressions,
    -- partial predicates, opclasses, collations, INCLUDE columns and null
    -- semantics, and any hand-built equality test is a second implementation of
    -- all of it that drifts the moment someone adds an index shape the author
    -- did not picture. So nothing is reconstructed. The repoint is attempted and
    -- Postgres itself answers, which is right by construction for every index
    -- shape including ones added later.
    --
    -- Fast path first: one set-based UPDATE, one subtransaction, no per-row
    -- cost when nothing collides -- the ordinary case. Only when that raises
    -- does it fall back to per-row, bounded by the rows actually referencing
    -- the loser in this table, and only there is a subtransaction spent per row.
    v_count := 0;
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2',
                     v_fk.child_table, v_fk.id_column, v_fk.id_column)
        USING p_keeper, p_loser;
      GET DIAGNOSTICS v_count = ROW_COUNT;

    EXCEPTION WHEN unique_violation THEN
      -- The set-based attempt rolled back to this block's savepoint, so the
      -- table is untouched. Collect the rows FIRST -- an UPDATE changes a row's
      -- ctid, and iterating a live cursor while rewriting the rows it is
      -- reading is how that goes wrong.
      EXECUTE format('SELECT array_agg(ctid) FROM %s WHERE %I = $1',
                     v_fk.child_table, v_fk.id_column)
        INTO v_ctids USING p_loser;

      FOREACH v_ctid IN ARRAY coalesce(v_ctids, '{}'::tid[])
      LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2',
                         v_fk.child_table, v_fk.id_column)
            USING p_keeper, v_ctid;
          v_count := v_count + 1;
        EXCEPTION WHEN unique_violation THEN
          -- The keeper's row wins: it is the one the rest of the system already
          -- points at. Name the constraint that actually fired rather than one
          -- that might have.
          GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
          EXECUTE format('DELETE FROM %s WHERE ctid = $1', v_fk.child_table)
            USING v_ctid;
          step := 'collision.dropped';
          detail := v_fk.child_table || '.' || v_fk.id_column || ' via '
                    || coalesce(nullif(v_con, ''), '<unnamed unique index>');
          rows_affected := 1;
          v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', 1);
          RETURN NEXT;
        END;
      END LOOP;
    END;

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
  'FK discovered from the catalog, by the component that actually references '
  'the id (ADR 0076). On a UNIQUE collision the keeper''s row wins and the '
  'loser''s is dropped -- decided by attempting the repoint and reading the '
  'index''s own answer, never by reconstructing the index from pg_index '
  '(ADR 0081): the reconstruction was wrong for expression, partial, INCLUDE '
  'and invalid indexes, and wrong TODAY for a nullable key column, where it '
  'deleted rows the index would have allowed. Merges restaurant_inventory by '
  'moving lots so the stock projection recomputes, soft-deletes the loser and '
  'logs to wine_merge_log. Refuses rather than proceeding when a referencing '
  'key cannot be planned, or when a composite key would reject the repointed '
  'rows. Refuses to merge two rows whose vintages disagree and neither is '
  'null. Defaults to a dry run that does the real work and then raises to roll '
  'it back. See unsupersede_library_wine() for the partial reversal.';

-- ---------------------------------------------------------------------------
-- Assertion, at migration time, against the real catalog. The claim this
-- migration rests on is that nothing reconstructs a unique index any more --
-- so state it as something that FAILS the migration, not as a comment.
-- ---------------------------------------------------------------------------

DO $assert$
DECLARE
  v_src  text;
  v_null int;
BEGIN
  -- Comments stripped before matching. The function's own body explains what
  -- was removed and names it, and an assertion that trips on its own
  -- explanation is an assertion that gets the explanation deleted.
  SELECT regexp_replace(p.prosrc, '--[^\n]*', '', 'g') INTO v_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'merge_library_wines';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'merge_library_wines is not installed -- cannot verify anything';
  END IF;
  IF v_src LIKE '%indkey%' THEN
    RAISE EXCEPTION 'merge_library_wines still reads pg_index.indkey -- the '
                    'index reconstruction ADR 0081 removed is back';
  END IF;
  IF v_src LIKE '%IS NOT DISTINCT FROM%' AND v_src NOT LIKE '%fk_repoint_blockers%' THEN
    RAISE EXCEPTION 'merge_library_wines compares key columns with IS NOT '
                    'DISTINCT FROM, which makes NULL equal NULL and deletes '
                    'rows a NULLS DISTINCT index would have allowed';
  END IF;

  -- Name the shapes that made this live, so a future reader sees the evidence
  -- rather than the assertion alone.
  SELECT count(*) INTO v_null
  FROM pg_index i
  WHERE i.indisunique AND i.indisvalid AND NOT i.indnullsnotdistinct
    AND i.indrelid = 'public.sku_mappings'::regclass
    AND EXISTS (
      SELECT 1 FROM unnest(i.indkey[0:i.indnkeyatts-1]) kk(an)
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = kk.an
      WHERE NOT a.attnotnull);
  IF v_null = 0 THEN
    RAISE EXCEPTION 'the sku_mappings shape this migration was measured against '
                    'is gone -- re-measure before trusting ADR 0081''s severity';
  END IF;
  RAISE NOTICE 'merge_library_wines: no index is reconstructed; the % NULLS-DISTINCT '
               'sku_mappings index(es) with a nullable key column no longer lose rows.', v_null;
END
$assert$;
