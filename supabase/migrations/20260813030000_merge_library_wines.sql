-- A reusable, transactional merge for duplicate master_wine_library rows.
--
-- WHY A FUNCTION AND NOT A ONE-OFF SCRIPT
--
-- The backfill in 20260812000000 exposed 11 duplicates that had been invisible
-- because nothing was keyed. They are not the last: any library that accepts
-- submissions from menus, vendors and humans accumulates them, and until now
-- there was no safe way to collapse one. "Safe" is doing a lot of work in that
-- sentence:
--
--   * 15 columns across 15 tables reference master_wine_library.id, and five
--     of those FKs are ON DELETE CASCADE. Deleting a duplicate without
--     repointing first silently deletes a restaurant's inventory.
--   * Seven of the referencing tables carry UNIQUE constraints that include
--     the FK column, so a blind repoint raises 23505 half-way through.
--   * restaurant_inventory is worse than a repoint: it is UNIQUE on
--     (restaurant_id, master_wine_id), and measured on the 11 duplicates the
--     keeper and loser BOTH hold stock in the same restaurant every time. The
--     rows have to be merged, not moved.
--
-- FKs are discovered from the catalog rather than listed here. A hard-coded
-- list is wrong the moment someone adds a table that references the library,
-- and it would be wrong silently — which is the failure mode this whole line
-- of work exists to eliminate.
--
-- STOCK IS NOT WRITTEN DIRECTLY
--
-- inventory_lots is the source of truth and restaurant_inventory.stock_live is
-- a projection maintained by trg_project_stock_from_lots (see
-- scripts/check_no_direct_stock_writes.sh). So the merge moves LOTS and lets
-- the trigger recompute the projection. Summing stock_live by hand would both
-- violate that contract and drift from the lots.

CREATE TABLE IF NOT EXISTS public.wine_merge_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keeper_id    uuid NOT NULL REFERENCES public.master_wine_library(id) ON DELETE CASCADE,
  loser_id     uuid NOT NULL,
  loser_snapshot jsonb NOT NULL,
  steps        jsonb NOT NULL,
  merged_at    timestamptz NOT NULL DEFAULT now(),
  merged_by    text
);

COMMENT ON TABLE public.wine_merge_log IS
  'Audit trail for merge_library_wines. loser_snapshot is the full deleted row '
  'so a bad merge can be reconstructed; loser_id is deliberately NOT a foreign '
  'key because the row it names no longer exists.';

CREATE INDEX IF NOT EXISTS idx_wine_merge_log_keeper
  ON public.wine_merge_log (keeper_id);

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.merge_library_wines(
  p_keeper  uuid,
  p_loser   uuid,
  p_dry_run boolean DEFAULT true,
  p_actor   text    DEFAULT NULL
)
RETURNS TABLE (step text, detail text, rows_affected bigint)
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_fk          record;
  v_idx         record;
  v_other_cols  text;
  v_sql         text;
  v_count       bigint;
  v_steps       jsonb := '[]'::jsonb;
  v_snapshot    jsonb;
  v_inv         record;
BEGIN
  IF p_keeper = p_loser THEN
    RAISE EXCEPTION 'keeper and loser are the same row (%)', p_keeper;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.master_wine_library WHERE id = p_keeper) THEN
    RAISE EXCEPTION 'keeper % does not exist', p_keeper;
  END IF;
  SELECT to_jsonb(m) INTO v_snapshot
  FROM public.master_wine_library m WHERE m.id = p_loser;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'loser % does not exist', p_loser;
  END IF;

  -- Everything below runs inside the caller's transaction. On a dry run the
  -- work is still performed so the reported counts are real, then rolled back
  -- to a savepoint — a dry run that only guesses is worth nothing.
  IF p_dry_run THEN
    RAISE NOTICE 'DRY RUN: merging % into % (changes will be rolled back)', p_loser, p_keeper;
  END IF;

  -- =========================================================================
  -- 1. restaurant_inventory: merge, do not repoint
  -- =========================================================================
  FOR v_inv IN
    SELECT li.id AS loser_inv, ki.id AS keeper_inv, li.restaurant_id
    FROM public.restaurant_inventory li
    JOIN public.restaurant_inventory ki
      ON ki.restaurant_id = li.restaurant_id AND ki.master_wine_id = p_keeper
    WHERE li.master_wine_id = p_loser
  LOOP
    -- Lots carry both keys; move both so the projection trigger recomputes
    -- stock_live on the keeper from the combined set.
    UPDATE public.inventory_lots
    SET inventory_id = v_inv.keeper_inv, master_wine_id = p_keeper
    WHERE inventory_id = v_inv.loser_inv;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    step := 'inventory_lots.moved'; detail := v_inv.restaurant_id::text;
    rows_affected := v_count;
    v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
    RETURN NEXT;

    -- Everything else hanging off the loser's inventory row follows it.
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
  -- 2. Every FK to master_wine_library, discovered from the catalog
  -- =========================================================================
  FOR v_fk IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.conrelid AS reloid
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.master_wine_library'::regclass
    ORDER BY 1, 2
  LOOP
    -- Drop loser-side rows that would collide with a keeper-side row on any
    -- UNIQUE index covering this FK column. The keeper's row wins: it is the
    -- one the rest of the system already points at.
    FOR v_idx IN
      SELECT i.indexrelid,
             array_agg(att.attname ORDER BY ik.ord) FILTER (WHERE att.attname <> v_fk.col) AS other_cols
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
        -- UNIQUE on the FK column alone: at most one row may survive.
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
  -- 3. Remove the loser and record what happened
  -- =========================================================================
  DELETE FROM public.master_wine_library WHERE id = p_loser;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  step := 'master_wine_library.deleted'; detail := p_loser::text;
  rows_affected := v_count;
  v_steps := v_steps || jsonb_build_object('step', step, 'detail', detail, 'rows', v_count);
  RETURN NEXT;

  INSERT INTO public.wine_merge_log (keeper_id, loser_id, loser_snapshot, steps, merged_by)
  VALUES (p_keeper, p_loser, v_snapshot, v_steps, p_actor);

  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY RUN COMPLETE — rolling back (pass p_dry_run => false to apply)'
      USING ERRCODE = 'query_canceled';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public.merge_library_wines IS
  'Collapse a duplicate master_wine_library row into a keeper. Repoints every '
  'FK discovered from the catalog, merges restaurant_inventory by moving lots '
  'so the stock projection recomputes, drops rows that would violate a UNIQUE '
  'constraint, and logs to wine_merge_log. Defaults to a dry run that does the '
  'real work and then raises to roll it back.';

REVOKE ALL ON FUNCTION public.merge_library_wines FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_library_wines TO service_role;
