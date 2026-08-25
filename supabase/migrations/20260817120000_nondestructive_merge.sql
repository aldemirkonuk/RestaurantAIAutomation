-- A5 (register, arch §3.7): merge must be non-destructive.
--
-- merge_library_wines() today HARD DELETEs the loser row after repointing
-- every FK reference. The full pre-delete state is snapshotted to
-- wine_merge_log.loser_snapshot (JSONB), so the DATA is not literally gone
-- -- but the loser's id no longer resolves to a live row anywhere, "undo"
-- means manually reconstructing an INSERT from JSONB, and nothing has ever
-- tested that reconstruction actually round-trips.
--
-- Fix: supersede, never delete.
--   1. A vintage-conflict guard, checked BEFORE anything is repointed. Two
--      rows disagreeing on a non-null vintage is evidence they are
--      different products (arch §3.7) -- this blocks the merge outright,
--      it does not pick a winner.
--   2. The loser is soft-deleted (deleted_at) and gains superseded_by
--      pointing at the keeper, instead of being deleted.
--   3. A wine_aliases row records the loser's own name/producer against the
--      keeper, so a future lookup by the loser's old identity redirects
--      rather than finding nothing.
-- FK repointing and collision handling are UNCHANGED -- that logic was
-- already sound (repoint current references, which is exactly arch §3.7's
-- "repoint current references; leave history alone").
--
-- merge_library_wines_undo() reverses steps 2 and 3. It does NOT reverse
-- the FK repoints from step 2 of the original function (restaurant
-- inventory moves, references repointed to the keeper) -- doing that
-- correctly requires knowing exactly which rows were touched, and today's
-- audit log records table.column and a row COUNT, not row ids. Undoing the
-- catalogue-level decision (the loser is a real, distinct, live row again)
-- is what this delivers; a full transactional undo of every downstream
-- repoint is a larger, separate piece of work, stated here rather than
-- silently implied.

ALTER TABLE public.master_wine_library
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.master_wine_library(id);

COMMENT ON COLUMN public.master_wine_library.superseded_by IS
  'Set when this row was merged into another (merge_library_wines). The '
  'row is soft-deleted (deleted_at) but never removed -- arch §3.7, '
  'non-destructive merge. merge_library_wines_undo() reverses this.';

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

  -- A5 / arch §3.7: a non-null vintage disagreement is evidence these are
  -- different products. Block, do not pick a winner.
  SELECT vintage INTO v_keeper_vintage FROM public.master_wine_library WHERE id = p_keeper;
  IF v_keeper_vintage IS NOT NULL AND v_loser_vintage IS NOT NULL
     AND v_keeper_vintage <> v_loser_vintage THEN
    RAISE EXCEPTION
      'refusing to merge % (vintage %) into % (vintage %) -- vintages '
      'disagree and neither is null. This is evidence of two different '
      'wines, not a data-quality gap to resolve by picking one.',
      p_loser, v_loser_vintage, p_keeper, v_keeper_vintage;
  END IF;

  -- =========================================================================
  -- 1. restaurant_inventory: merge, do not repoint (unchanged)
  -- =========================================================================
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

  -- =========================================================================
  -- 2. Every FK to master_wine_library (unchanged)
  -- =========================================================================
  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.conrelid AS reloid
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.master_wine_library'::regclass
      -- superseded_by is a self-FK added by THIS migration -- never a
      -- candidate for repointing, or a merge chain could rewrite its own
      -- history.
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

  -- =========================================================================
  -- 3. Supersede the loser -- NEVER delete (A5 / arch §3.7)
  -- =========================================================================
  UPDATE public.master_wine_library
     SET deleted_at = now(), superseded_by = p_keeper
   WHERE id = p_loser;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'master_wine_library.superseded'; detail := p_loser::text || ' -> ' || p_keeper::text;
  rows_affected := v_count;
  v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
  RETURN NEXT;

  INSERT INTO public.wine_aliases (canonical_id, alias_name, alias_name_normalized, alias_source)
  VALUES (p_keeper, coalesce(v_loser_producer, '') || ' ' || coalesce(v_loser_name, ''),
          public.wine_normalize_text(coalesce(v_loser_producer, '') || ' ' || coalesce(v_loser_name, '')),
          'merge:' || p_loser::text)
  ON CONFLICT DO NOTHING;
  step := 'wine_aliases.recorded'; detail := p_loser::text;
  rows_affected := 1;
  v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', 1);
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
  'Merges loser into keeper. Non-destructive (A5, arch §3.7): the loser is '
  'soft-deleted with superseded_by set, never hard-deleted, and gains a '
  'wine_aliases entry so a future lookup by its old identity redirects to '
  'the keeper. Blocks outright on a non-null vintage disagreement -- that '
  'is evidence of two different wines. See merge_library_wines_undo() for '
  'the reverse, and its own comment for exactly what it does and does not '
  'undo.';

CREATE OR REPLACE FUNCTION public.merge_library_wines_undo(p_loser uuid)
RETURNS TABLE(step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_keeper uuid;
  v_count  bigint;
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
END;
$function$;

COMMENT ON FUNCTION public.merge_library_wines_undo IS
  'Reverses the catalogue-level effect of merge_library_wines(): the loser '
  'becomes a live, real row again. Does NOT reverse the FK repoints from '
  'the original merge (inventory moves, reference repoints to the keeper) '
  '-- today''s audit log records table.column and a row count, not row '
  'ids, so that reversal is not derivable automatically. See '
  '20260817120000''s header comment.';
