-- Make the dry run actually report what it would do.
--
-- merge_library_wines defaults to a dry run that performs the real work and
-- then raises so the transaction unwinds — which is the right shape, because a
-- dry run that only predicts is worth nothing on an operation whose whole risk
-- is in the parts you did not predict.
--
-- But the raise discards the RETURN NEXT rows: an operator saw only "DRY RUN
-- COMPLETE" and none of the steps. The accumulated step log now travels in the
-- exception's DETAIL, which survives the rollback.

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

  -- =========================================================================
  -- 1. restaurant_inventory: merge, do not repoint
  --
  -- UNIQUE (restaurant_id, master_wine_id) means a repoint collides whenever
  -- both wines hold stock in the same restaurant — which, measured on the 11
  -- duplicates this was written for, is every single time. Lots are the
  -- source of truth and stock_live is a projection maintained by
  -- trg_project_stock_from_lots, so moving the lots is what makes the keeper's
  -- stock correct. Summing stock_live by hand would violate that contract.
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
  -- 2. Every FK to master_wine_library, discovered from the catalog.
  --    A hard-coded list would be wrong the moment a new referencing table is
  --    added, and wrong silently.
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
    -- Drop loser-side rows that would violate a UNIQUE index covering this FK
    -- column. The keeper's row wins: it is the one everything else points at.
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
    -- The step log rides out in DETAIL because the RETURN NEXT rows do not
    -- survive the rollback, and a dry run whose output you cannot read is not
    -- a dry run.
    RAISE EXCEPTION 'DRY RUN COMPLETE — rolled back. Pass p_dry_run => false to apply.'
      USING ERRCODE = 'query_canceled', DETAIL = v_steps::text;
  END IF;
END;
$fn$;
