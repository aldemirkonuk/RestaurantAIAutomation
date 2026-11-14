-- A good nobody has counted or received is not "Out" (inventory r36, gap 1).
--
-- restaurant_inventory.stock_live is `integer DEFAULT 0 NOT NULL` (baseline),
-- so a title read in from a menu scan, or a food carried with no stock, holds
-- 0 from the moment it is added. The inventory page read every 0 as "Out", so
-- a house that scanned its menu on day 1 was told every title was out, for
-- goods sitting on the shelf that nobody had counted.
--
-- A 0 that nothing ever moved is told apart here from a 0 that was sold, used
-- or written down to: this returns the house's active goods that hold 0 or
-- less, have never been counted (last_counted_at), and have no ledger row and
-- no lot at all. Lots alone are not enough: apply_stock_movement DELETES a lot
-- it draws to 0, so a bottle received and then sold out has no lot left, but
-- its ledger rows stay (inventory_transactions.inventory_id is NOT NULL).
--
-- A FUNCTION returning one array, because PostgREST max_rows cannot cut one
-- value (ADR 0292): a house with more than 1,000 such goods still gets them
-- all. SECURITY INVOKER, service_role only, like pos_item_sales.
-- p_restaurant_id is trusted, since service_role reads past RLS: pass the
-- tenant-checked house. The NOT EXISTS probes use idx_inv_txn_inventory and
-- the lots' inventory index, and they run only on goods already at 0 with no
-- count.

CREATE OR REPLACE FUNCTION public.inventory_never_moved(p_restaurant_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(ri.id ORDER BY ri.id), '{}'::uuid[])
    FROM public.restaurant_inventory ri
   WHERE ri.restaurant_id = p_restaurant_id
     AND ri.is_active
     AND ri.stock_live <= 0
     AND ri.last_counted_at IS NULL
     AND NOT EXISTS (
           SELECT 1 FROM public.inventory_transactions t
            WHERE t.inventory_id = ri.id)
     AND NOT EXISTS (
           SELECT 1 FROM public.inventory_lots l
            WHERE l.inventory_id = ri.id)
$$;

COMMENT ON FUNCTION public.inventory_never_moved(uuid) IS
  'Inventory r36 gap 1. The house''s active goods at 0 that were never counted '
  'and never moved (no ledger row, no lot): "not counted yet", not "out". '
  'Pass the tenant-checked house.';

REVOKE ALL ON FUNCTION public.inventory_never_moved(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_never_moved(uuid) TO service_role;

DO $$
DECLARE
  v_oid oid;
BEGIN
  v_oid := to_regprocedure('public.inventory_never_moved(uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'public.inventory_never_moved was not created';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'public.inventory_never_moved must stay SECURITY INVOKER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'public.inventory_never_moved is executable by anon or authenticated';
  END IF;
END $$;
