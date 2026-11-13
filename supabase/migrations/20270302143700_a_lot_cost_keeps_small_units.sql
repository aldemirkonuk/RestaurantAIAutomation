-- a_lot_cost_keeps_small_units: a lot's cost per unit keeps six decimal places.
--
-- WHY (inventory walk #7, proposal F-C / §3 lane I5, gap G24)
-- -------------------------------------------------------------------------
-- inventory_lots.unit_cost is numeric(10,2) (baseline_from_production:3180)
-- and nothing since widened it. A house item kept in grams or millilitres
-- (restaurant_inventory.uom 'g' / 'ml' / 'mg', allowed since
-- the_house_item_is_the_ledgers_key) costs its lot PER GRAM, so 0.035 TRY/g
-- was stored as 0.04: a 14% error, and every WAC, COGS and stock value read
-- from that lot carried it. inventory_lot_rollup.wac and
-- inventory_location_breakdown.wac then rounded to 2 places on top
-- (lot_cost_truth, sections 4 and 5).
--
-- WHAT
-- -------------------------------------------------------------------------
--   1. inventory_lots.unit_cost         numeric(10,2) -> numeric(14,6)
--   2. inventory_transactions.unit_cost numeric(10,2) -> numeric(14,6)
--      Widened too: apply_stock_movement writes the SAME p_unit_cost into the
--      lot and into the ledger row that created it, so leaving the ledger at
--      2 places would make the record of a receipt disagree with the lot it
--      made (0.04 vs 0.035).
--   3. Both lot views round WAC to 6 places instead of 2. Rounding for
--      display stays in the UI: prices through cellMoney, a cost per unit
--      through cellUnitCost, which keeps a sub-unit cost's places (0.035 reads
--      0.035, not 0.04; QA round 11b).
--
-- APPLYING (QA round 11b)
-- -------------------------------------------------------------------------
-- Changing a column's type rewrites inventory_lots and inventory_transactions
-- and rebuilds every index on them, under ACCESS EXCLUSIVE, inside this one
-- transaction: every stock read and write waits, the POS doors included.
-- Measured locally (Postgres 17, synthetic data): 1,000,000 ledger rows
-- (342 MB with indexes) and 100,000 lots took 13.6 s. Apply in a quiet window
-- with `SET lock_timeout` so it fails fast instead of queueing behind a long
-- reader; the PR body has the steps.
--
-- Fourteen digits with six after the point keeps the same eight integer
-- digits as before, so every value already stored fits unchanged.
--
-- NOT CHANGED, AND WHY
--   * inventory_transactions.total_cost stays numeric(10,2). It is a money
--     total, where 2 places is the currency's own precision; apply_stock_movement
--     never writes it; and widening it would mean dropping and refilling the
--     inventory_transaction_summary materialized view for no reader's gain.
--   * Every other column of the three views. Their column lists, order, types,
--     comments, grants, owner and reloptions are captured before the drop and
--     asserted equal after (section 5 below).
--
-- HOW THE VIEWS ARE REBUILT
-- -------------------------------------------------------------------------
-- A column a view reads cannot change type, so the views that read unit_cost
-- (inventory_lot_rollup, inventory_location_breakdown, found with pg_depend on
-- a database built from every migration) are dropped and recreated, together
-- with inventory_analytics, which reads inventory_lot_rollup. Nothing else
-- depends on any of the three; DROP VIEW has no CASCADE, so if production
-- holds another dependent this migration stops instead of taking it along.
--
-- Each view is recreated from ITS OWN current definition (pg_get_viewdef),
-- not from a copy pasted here. Only the WAC rounding is rewritten, and only
-- where it matches exactly once per view. So whatever body the database
-- holds at apply time (the required schema-parity job already proves it
-- equals the repo's) is kept, including any filter a migration merged
-- before this one added. Grants and reloptions are re-applied from what the
-- database holds, because the local build cannot model production's
-- grants: CREATE OR REPLACE in lot_cost_truth cleared security_invoker on
-- the two lot views after OD-72 had set it, and that state is kept as it is
-- (recorded in the tech-debt fragment, not silently changed here).
--
-- Re-running is safe: the ALTERs are skipped when the type is already right,
-- and the WAC rewrite matches any rounding scale, so a second run rebuilds
-- the same views. One transaction.
--
-- Decisions taken under the founder's /goal of 2026-11-07 ("Do not ask me any
-- questions I approve you decide them all"): six places, and widening the
-- ledger column too.

BEGIN;

-- One block, so the captured state lives in variables (no helper table).
DO $$
DECLARE
  -- pg_get_viewdef prints the lot views' rounding as
  --   round(<avg>, 2)  ELSE NULL::numeric  END AS wac
  pat constant text := ', [0-9]+\)(\s+ELSE NULL::numeric\s+END AS wac\M)';
  names constant text[] := ARRAY['inventory_location_breakdown', 'inventory_lot_rollup', 'inventory_analytics'];
  saved jsonb := '{}'::jsonb;   -- relname -> what the view held
  s jsonb;
  cur jsonb;    -- what the rebuilt view holds
  nm text;
  def text;
  n integer;
  g record;
  col record;
  bad text := '';
BEGIN
  -- 1. Capture the three views as the database holds them.
  FOREACH nm IN ARRAY names LOOP
    SELECT jsonb_build_object(
             'relkind', c.relkind,
             'owner', pg_get_userbyid(c.relowner),
             'reloptions', to_jsonb(c.reloptions),
             'acl', coalesce(c.relacl, acldefault('r', c.relowner))::text,
             'comment', obj_description(c.oid, 'pg_class'),
             'def', pg_get_viewdef(c.oid),
             'cols', (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                        FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
             'col_comments', (SELECT jsonb_object_agg(a.attname, col_description(c.oid, a.attnum))
                                FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                 AND col_description(c.oid, a.attnum) IS NOT NULL))
      INTO s
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = nm;
    IF s IS NULL OR s->>'relkind' <> 'v' THEN
      RAISE EXCEPTION 'a_lot_cost_keeps_small_units: public.% is not a plain view here', nm;
    END IF;

    -- 2. Rewrite the WAC rounding in the two lot views: exactly one match each.
    def := s->>'def';
    IF nm <> 'inventory_analytics' THEN
      SELECT count(*) INTO n FROM regexp_matches(def, pat, 'g');
      IF n <> 1 THEN
        RAISE EXCEPTION 'a_lot_cost_keeps_small_units: % has % WAC rounding(s) of the expected shape, expected exactly 1; its definition changed, re-read it before widening', nm, n;
      END IF;
      def := regexp_replace(def, pat, ', 6)\1');
    END IF;
    saved := saved || jsonb_build_object(nm, s || jsonb_build_object('new_def', def));
  END LOOP;

  -- 3. Drop dependents first, widen, recreate in dependency order.
  DROP VIEW public.inventory_analytics;
  DROP VIEW public.inventory_lot_rollup;
  DROP VIEW public.inventory_location_breakdown;

  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.inventory_lots'::regclass AND attname = 'unit_cost') <> 'numeric(14,6)' THEN
    ALTER TABLE public.inventory_lots ALTER COLUMN unit_cost TYPE numeric(14,6);
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.inventory_transactions'::regclass AND attname = 'unit_cost') <> 'numeric(14,6)' THEN
    ALTER TABLE public.inventory_transactions ALTER COLUMN unit_cost TYPE numeric(14,6);
  END IF;

  -- 4. Recreate each view from its captured body and put back what it carried.
  FOREACH nm IN ARRAY names LOOP
    s := saved->nm;
    EXECUTE format('CREATE VIEW public.%I AS %s', nm, s->>'new_def');
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = format('public.%I', nm)::regclass)) <> s->>'owner' THEN
      EXECUTE format('ALTER VIEW public.%I OWNER TO %I', nm, s->>'owner');
    END IF;
    IF jsonb_typeof(s->'reloptions') = 'array' THEN
      EXECUTE format('ALTER VIEW public.%I SET (%s)', nm,
                     (SELECT string_agg(o, ', ') FROM jsonb_array_elements_text(s->'reloptions') o));
    END IF;
    IF s->>'comment' IS NOT NULL THEN
      EXECUTE format('COMMENT ON VIEW public.%I IS %L', nm, s->>'comment');
    END IF;
    FOR col IN SELECT key, value FROM jsonb_each_text(CASE WHEN jsonb_typeof(s->'col_comments') = 'object' THEN s->'col_comments' ELSE '{}'::jsonb END) LOOP
      EXECUTE format('COMMENT ON COLUMN public.%I.%I IS %L', nm, col.key, col.value);
    END LOOP;
    -- Grants: drop whatever default privileges handed the new view, then
    -- grant back exactly what the old one held. The owner's own rights are
    -- implicit and left alone.
    FOR g IN SELECT DISTINCT e.grantee
               FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) e
              WHERE c.oid = format('public.%I', nm)::regclass AND e.grantee <> c.relowner LOOP
      EXECUTE format('REVOKE ALL ON public.%I FROM %s', nm,
                     CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END);
    END LOOP;
    FOR g IN SELECT e.grantee, e.privilege_type, e.is_grantable
               FROM aclexplode((s->>'acl')::aclitem[]) e
              WHERE e.grantee <> (SELECT oid FROM pg_roles WHERE rolname = s->>'owner') LOOP
      EXECUTE format('GRANT %s ON public.%I TO %s%s', g.privilege_type, nm,
                     CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(g.grantee)) END,
                     CASE WHEN g.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;

  -- 5. Assert the outcome: everything but the WAC rounding is as it was.
  FOREACH nm IN ARRAY names LOOP
    s := saved->nm;
    SELECT jsonb_build_object(
             'owner', pg_get_userbyid(c.relowner),
             'reloptions', to_jsonb(c.reloptions),
             'acl', coalesce(c.relacl, acldefault('r', c.relowner))::text,
             'comment', obj_description(c.oid, 'pg_class'),
             'def', pg_get_viewdef(c.oid),
             'cols', (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
                        FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
             'col_comments', (SELECT jsonb_object_agg(a.attname, col_description(c.oid, a.attnum))
                                FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                                 AND col_description(c.oid, a.attnum) IS NOT NULL))
      INTO cur
      FROM pg_class c WHERE c.oid = format('public.%I', nm)::regclass;
    IF (cur->'cols') IS DISTINCT FROM (s->'cols') THEN bad := bad || format(' %s columns;', nm); END IF;
    IF (cur->'def') IS DISTINCT FROM (s->'new_def') THEN bad := bad || format(' %s body;', nm); END IF;
    IF (cur->'reloptions') IS DISTINCT FROM (s->'reloptions') THEN bad := bad || format(' %s reloptions;', nm); END IF;
    IF (cur->'comment') IS DISTINCT FROM (s->'comment') THEN bad := bad || format(' %s comment;', nm); END IF;
    IF (cur->'col_comments') IS DISTINCT FROM (s->'col_comments') THEN bad := bad || format(' %s column comments;', nm); END IF;
    IF (cur->'owner') IS DISTINCT FROM (s->'owner') THEN bad := bad || format(' %s owner;', nm); END IF;
    IF EXISTS (SELECT grantee, privilege_type, is_grantable FROM aclexplode((cur->>'acl')::aclitem[])
               EXCEPT SELECT grantee, privilege_type, is_grantable FROM aclexplode((s->>'acl')::aclitem[]))
       OR EXISTS (SELECT grantee, privilege_type, is_grantable FROM aclexplode((s->>'acl')::aclitem[])
               EXCEPT SELECT grantee, privilege_type, is_grantable FROM aclexplode((cur->>'acl')::aclitem[])) THEN
      bad := bad || format(' %s grants;', nm);
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.inventory_lots'::regclass AND attname = 'unit_cost') <> 'numeric(14,6)' THEN
    bad := bad || ' inventory_lots.unit_cost type;';
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.inventory_transactions'::regclass AND attname = 'unit_cost') <> 'numeric(14,6)' THEN
    bad := bad || ' inventory_transactions.unit_cost type;';
  END IF;
  IF bad <> '' THEN
    RAISE EXCEPTION 'a_lot_cost_keeps_small_units: after the rebuild these differ from what they were:%', bad;
  END IF;
  RAISE NOTICE 'a_lot_cost_keeps_small_units: unit_cost is numeric(14,6) on inventory_lots and inventory_transactions; 3 views rebuilt, WAC rounded to 6 places, columns, comments, grants and options unchanged';
END $$;

COMMENT ON COLUMN public.inventory_lots.unit_cost IS
  'Cost of ONE unit of this lot, in the item''s uom (a bottle, a gram, a millilitre), in house currency. '
  'numeric(14,6) so a per-gram cost such as 0.035 is kept, not rounded to 0.04 (a_lot_cost_keeps_small_units).';
COMMENT ON COLUMN public.inventory_transactions.unit_cost IS
  'The per-unit cost this movement carried (apply_stock_movement copies p_unit_cost into the lot and here). '
  'numeric(14,6), the same scale as inventory_lots.unit_cost (a_lot_cost_keeps_small_units).';

COMMIT;
