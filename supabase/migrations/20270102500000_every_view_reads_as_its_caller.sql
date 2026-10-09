-- Every public view reads as its caller again, and the last anon grant goes.
--
-- F-532. OD-72 (20260825210000_od72_revoke_client_grants.sql, section 2) set
-- `security_invoker = true` on every postgres-owned view, so a view could not
-- read past the RLS on its base tables. It ran once, over pg_class as it was
-- that day, and nothing kept it true:
--
--   * `CREATE OR REPLACE VIEW` with no WITH clause RESETS a view's options.
--     20260902150000_lot_cost_truth.sql:445 and :486 re-created
--     inventory_location_breakdown and inventory_lot_rollup that way --
--     inventory_lot_rollup is OD-72's own leak example (it returned all of
--     inventory_lots to the publishable key).
--   * v_library_provenance_health / v_promotion_blockers
--     (20260826175836_evidence_gate_v1.sql:191,208) and v_signature_drift
--     (20260826180321:28, re-created 20260906010000:234) were born after
--     OD-72 without it.
--
-- None is client-readable today: OD-72's default-privilege revoke and OD-73's
-- re-revoke (20260826210000:72-74) mean no anon/authenticated grant. That is
-- one GRANT away from a cross-house read, so both halves are restored. The
-- class is now held by scripts/check_views_security_invoker.py in CI.
--
-- The gateway reads inventory_lot_rollup / inventory_location_breakdown with
-- the service-role key, which holds its own grants on the base tables and
-- bypasses RLS, so invoker semantics change nothing it sees (they were
-- invoker from 2026-08-26 to 2026-09-02 already).
--
-- F-531. OD-72 excepted `sommelier_conversations` from its sweep by name
-- (:70, :207) as "the single live browser consumer" of the anon key. That
-- consumer is gone: /sommelier redirects to /ask (apps/web/src/App.tsx:557),
-- and the hook that queried it (hooks/queries/useSommelierQueries.ts) has no
-- importer besides the barrel. Grep on 2026-10-09: no reader in apps/web
-- pages or components, apps/mobile, apps/api-gateway or
-- services/agent-orchestrator. The table kept anon+authenticated full DML
-- behind one `user_id = auth.uid()` policy, and auth.uid() is always NULL in
-- this product (the gateway issues its own tokens). The exception goes.
--
-- Not done here: dropping the dead hook and lib/supabase.ts (CLAIMS OD-72 row
-- tracks that) and the policies on sommelier_conversations (harmless without
-- a grant).

ALTER VIEW public.inventory_location_breakdown SET (security_invoker = true);
ALTER VIEW public.inventory_lot_rollup         SET (security_invoker = true);
ALTER VIEW public.v_library_provenance_health  SET (security_invoker = true);
ALTER VIEW public.v_promotion_blockers         SET (security_invoker = true);
ALTER VIEW public.v_signature_drift            SET (security_invoker = true);

REVOKE ALL ON public.sommelier_conversations FROM anon, authenticated;

-- The outcome, asserted rather than assumed: every public view the corpus
-- owns (extension members such as PostGIS's geometry_columns are not ours)
-- reads as its caller, and no browser role holds a grant on the table.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO bad
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relkind = 'v'
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
    )
    AND coalesce((SELECT option_value
                  FROM pg_options_to_table(c.reloptions)
                  WHERE option_name = 'security_invoker'), 'off')
        NOT IN ('true', 'on', '1', 'yes');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'F-532: public view(s) still read as their owner: %', bad;
  END IF;

  IF has_table_privilege('anon', 'public.sommelier_conversations', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.sommelier_conversations', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'F-531: a browser role still holds a grant on sommelier_conversations';
  END IF;
END
$$;
