-- Premortem audit finding #3: merge_library_wines_undo() reversed only the
-- catalogue-level decision (soft-delete + superseded_by + wine_aliases),
-- not the FK repoints or restaurant_inventory consolidation from the
-- original merge -- documented as a scoping limitation, but the function's
-- own OUTPUT gave no signal that anything was left unreversed. Audited
-- concretely: restaurant R stocks keeper K (12 bottles) and loser L (5),
-- both vintage NULL so the merge's vintage guard does not fire (NULL
-- vintages are the common case). merge_library_wines(K, L, false) moves
-- L's inventory_lots onto K and deletes L's restaurant_inventory row.
-- An operator who then runs "undo" because K/L turned out to be different
-- cuvees sees L restored as a live row -- with zero inventory anywhere.
-- R's on-hand for K silently overstates by 5 bottles, permanently, and
-- the function's result set names no residue. The word "undo" is what
-- does the damage, not the partial scope by itself.
--
-- Full reversal (repointing every touched row back, including
-- restaurant_inventory) is real, separable work: it needs the FK-repoint
-- loop to capture ROW IDS (RETURNING id), not just table.column and a
-- count, which is a bigger, riskier change to a function nothing calls
-- yet but that isn't free to get wrong either. Deferred, not attempted
-- rushed. This migration ships the honest, smaller fix instead: the
-- function reports exactly what it did NOT reverse, by name, in the same
-- result set the caller is already reading, and is renamed so calling it
-- does not itself assert a claim ("undo") the function cannot back up.
-- Zero application callers today (checked) -- the rename costs nothing
-- external.

CREATE OR REPLACE FUNCTION public.unsupersede_library_wine(p_loser uuid)
RETURNS TABLE(step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_keeper  uuid;
  v_count   bigint;
  v_log     record;
  v_step    jsonb;
BEGIN
  SELECT superseded_by INTO v_keeper FROM public.master_wine_library WHERE id = p_loser;
  IF v_keeper IS NULL THEN
    RAISE EXCEPTION '% is not a superseded row (superseded_by is null)', p_loser;
  END IF;

  UPDATE public.master_wine_library
     SET deleted_at = NULL, superseded_by = NULL
   WHERE id = p_loser;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'master_wine_library.restored'; detail := p_loser::text;
  rows_affected := v_count;
  RETURN NEXT;

  DELETE FROM public.wine_aliases WHERE alias_source = 'merge:' || p_loser::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'wine_aliases.removed'; detail := p_loser::text;
  rows_affected := v_count;
  RETURN NEXT;

  -- Report every OTHER step the original merge performed, by name, so the
  -- caller sees exactly what was NOT reversed instead of inferring "undo"
  -- means everything was. Reads the most recent merge log for this loser.
  SELECT * INTO v_log FROM public.wine_merge_log
   WHERE loser_id = p_loser ORDER BY merged_at DESC LIMIT 1;
  IF v_log.id IS NOT NULL THEN
    FOR v_step IN SELECT * FROM jsonb_array_elements(v_log.steps) LOOP
      IF v_step ->> 'step' NOT IN ('master_wine_library.superseded', 'wine_aliases.recorded') THEN
        step := 'NOT REVERSED: ' || (v_step ->> 'step');
        detail := v_step ->> 'detail';
        rows_affected := coalesce((v_step ->> 'rows')::bigint, 0);
        RETURN NEXT;
      END IF;
    END LOOP;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.unsupersede_library_wine IS
  'Reverses ONLY the catalogue-level effect of merge_library_wines(): the '
  'loser becomes a live row again and its wine_aliases entry is removed. '
  'Does NOT reverse inventory_lots moves, restaurant_inventory '
  'consolidation, or FK repoints -- those steps are listed in the result '
  'set prefixed "NOT REVERSED:" rather than silently omitted, so the '
  'caller sees the residue instead of inferring completeness from the '
  'function''s name. Replaces merge_library_wines_undo(), renamed '
  'deliberately -- "undo" implied a completeness this never had. See '
  '20260818020000''s header for the concrete failure this fixes: undoing '
  'a merge left the loser live with the keeper permanently holding its '
  'former inventory, unreported.';

DROP FUNCTION IF EXISTS public.merge_library_wines_undo(uuid);

-- ---------------------------------------------------------------------
-- Second finding from the same audit: wine_aliases.recorded hardcoded
-- rows_affected := 1 even when ON CONFLICT DO NOTHING inserted zero rows
-- (the constraint is UNIQUE (canonical_id, alias_name_normalized)) -- the
-- merge log could attest to an alias existing that does not. Fixed to
-- report the real insert count.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_library_wines(
  p_keeper uuid, p_loser uuid, p_dry_run boolean DEFAULT true, p_actor text DEFAULT NULL::text
)
RETURNS TABLE(step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
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
    UPDATE public.inventory_lots
    SET inventory_id = v_inv.keeper_inv, master_wine_id = p_keeper
    WHERE inventory_id = v_inv.loser_inv;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    step := 'inventory_lots.moved'; detail := v_inv.restaurant_id::text;
    rows_affected := v_count;
    v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
    RETURN NEXT;

    FOR v_fk IN
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.restaurant_inventory'::regclass
        AND c.conrelid <> 'public.inventory_lots'::regclass
    LOOP
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col)
        USING v_inv.keeper_inv, v_inv.loser_inv;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        step := 'inventory_ref.repointed'; detail := v_fk.tbl || '.' || v_fk.col;
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

  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.conrelid AS reloid
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.master_wine_library'::regclass
      AND a.attname <> 'superseded_by'
    ORDER BY 1, 2
  LOOP
    FOR v_idx IN
      SELECT i.indexrelid,
             array_agg(att.attname ORDER BY ik.ord)
               FILTER (WHERE att.attname <> v_fk.col) AS other_cols
      FROM pg_index i
      JOIN unnest(i.indkey) WITH ORDINALITY AS ik(attnum, ord) ON true
      JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = ik.attnum
      WHERE i.indrelid = v_fk.reloid
        AND i.indisunique
        AND EXISTS (
          SELECT 1 FROM unnest(i.indkey) AS kk(attnum)
          JOIN pg_attribute a2 ON a2.attrelid = i.indrelid AND a2.attnum = kk.attnum
          WHERE a2.attname = v_fk.col
        )
      GROUP BY i.indexrelid
    LOOP
      IF v_idx.other_cols IS NULL OR cardinality(v_idx.other_cols) = 0 THEN
        v_sql := format('DELETE FROM %s l WHERE l.%I = $1 AND EXISTS '
                        '(SELECT 1 FROM %s k WHERE k.%I = $2)',
                        v_fk.tbl, v_fk.col, v_fk.tbl, v_fk.col);
      ELSE
        SELECT string_agg(format('k.%I IS NOT DISTINCT FROM l.%I', c, c), ' AND ')
        INTO v_other_cols
        FROM unnest(v_idx.other_cols) AS c;
        v_sql := format('DELETE FROM %s l WHERE l.%I = $1 AND EXISTS '
                        '(SELECT 1 FROM %s k WHERE k.%I = $2 AND %s)',
                        v_fk.tbl, v_fk.col, v_fk.tbl, v_fk.col, v_other_cols);
      END IF;

      EXECUTE v_sql USING p_loser, p_keeper;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count > 0 THEN
        step := 'collision.dropped';
        detail := v_fk.tbl || '.' || v_fk.col || ' via ' || v_idx.indexrelid::regclass::text;
        rows_affected := v_count;
        v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
        RETURN NEXT;
      END IF;
    END LOOP;

    EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', v_fk.tbl, v_fk.col, v_fk.col)
      USING p_keeper, p_loser;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count > 0 THEN
      step := 'reference.repointed'; detail := v_fk.tbl || '.' || v_fk.col;
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
