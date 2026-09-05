-- The producers get their own memory of which tools a server has offered.
--
-- WHAT WAS MEASURED FIRST, AND WHY IT IS NOT ENOUGH
-- -------------------------------------------------
-- `restaurant_mcp_connections.probe_tools` already holds a tools/list result
-- (20260903104500_user_mcp_connection_runtime.sql:89-92, JSONB array of
-- {name, title, description}; NULL = never probed, [] = answered and offers
-- nothing). It is the right column and it is NOT a history: every probe
-- OVERWRITES it in one patch — `probe_tools: outcome.tools`,
-- `mcp-connections.service.ts:1666`. After a probe that adds a tool the
-- previous list is gone, so nothing in the schema can tell a tool that was
-- just ADDED from one that has been there all along.
--
-- WHY A TABLE HERE AND NOT A COLUMN THERE
-- ---------------------------------------
-- A `probe_tools_previous` column on `restaurant_mcp_connections` would be smaller,
-- and it was rejected on two grounds. It would have to be written by the probe,
-- which lives in `mcp-connections/` — another builder's module, under active
-- edit — so the producer could not ship without their hunk landing first. And a
-- single previous-list column cannot answer "when did we first see this tool",
-- which is exactly what the notification has to say and what makes a
-- removed-then-re-added tool a NEW event rather than a suppressed one.
--
-- So the producer keeps its own sighting ledger. It READS `probe_tools` (a read
-- across a module boundary, which is fine) and writes only here. Nothing in
-- `mcp-connections/` changes, and there is no race with the probe: this table is
-- written by one per-tenant sweep, serially.
--
-- WHAT A ROW IS
-- -------------
-- One tool, on one server, over one CONTIGUOUS RUN of sightings. A tool that
-- disappears from a later probe is stamped `gone_at` and its row is closed; if
-- it comes back it opens a NEW row with a new `first_seen_at`, and therefore a
-- new dedupe key, and therefore a new line in the day book. That is the
-- founder's rule — "a removed-then-re-added tool writes again" — expressed as a
-- shape rather than as a branch.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

CREATE TABLE IF NOT EXISTS public.notification_mcp_tool_sightings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which house. NOT NULL and taken from the tenant the sweep is serving
  -- (`ScheduledTenantsService.runPerTenant`, ADR 0022), never from a request.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Which declared server. Cascades, so revoking and deleting a connection
  -- takes its sightings with it rather than leaving orphans that would read as
  -- tools on a server that no longer exists.
  connection_id UUID NOT NULL
    REFERENCES public.restaurant_mcp_connections(id) ON DELETE CASCADE,

  -- The tool's own name, as the server declared it.
  tool_name TEXT NOT NULL CHECK (btrim(tool_name) <> ''),

  -- read_only | write | unknown. `unknown` is a real member and is treated as
  -- WRITE by every reader — the founder's rule. It is NOT defaulted to
  -- read_only, because a tool whose classification we could not read being
  -- rendered as harmless is the absence-reported-as-health fault with a
  -- permission attached.
  classification TEXT NOT NULL DEFAULT 'unknown'
    CHECK (classification IN ('read_only', 'write', 'unknown')),

  -- The opening of this contiguous run of sightings. Part of the producer's
  -- dedupe key, which is why a re-added tool is a new event.
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The most recent probe that still offered it.
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL while the tool is still being offered. Stamped when a probe that
  -- ANSWERED no longer lists it — never on a failed probe, which says nothing
  -- about what the server offers.
  gone_at TIMESTAMPTZ
);

-- One OPEN run per tool per server. Partial, so the closed runs of a tool that
-- came and went and came back all coexist — which is the whole point.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_mcp_tool_open_run
  ON public.notification_mcp_tool_sightings (connection_id, tool_name)
  WHERE gone_at IS NULL;

-- The sweep's read: this house's open sightings, newest first.
CREATE INDEX IF NOT EXISTS idx_notification_mcp_tool_sightings_house
  ON public.notification_mcp_tool_sightings
     (restaurant_id, connection_id, first_seen_at DESC);

-- ---------------------------------------------------------------------------
-- Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_mcp_tool_sightings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_mcp_tool_sightings_service_role
  ON public.notification_mcp_tool_sightings;
CREATE POLICY notification_mcp_tool_sightings_service_role
  ON public.notification_mcp_tool_sightings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.notification_mcp_tool_sightings FROM anon, authenticated;

COMMENT ON TABLE public.notification_mcp_tool_sightings IS
  'One tool, on one model-context server, over one contiguous run of sightings. The producers'' own memory: restaurant_mcp_connections.probe_tools is overwritten by every probe (mcp-connections.service.ts:1666) and therefore cannot say what is NEW. A tool that disappears is stamped gone_at; if it returns it opens a new row with a new first_seen_at, so a removed-then-re-added tool is a new event and is said again. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.notification_mcp_tool_sightings.gone_at IS
  'NULL while the tool is still offered. Stamped only from a probe that ANSWERED — a failed probe says nothing about what a server offers, and closing a run on one would invent a removal.';

COMMENT ON COLUMN public.notification_mcp_tool_sightings.classification IS
  'read_only | write | unknown. unknown is treated as write by every reader; it is deliberately not defaulted to read_only, because rendering an unreadable permission as the harmless one is how a register starts reporting safety it never measured.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'restaurant_id', 'connection_id', 'tool_name', 'classification',
    'first_seen_at', 'last_seen_at', 'gone_at'
  ];
BEGIN
  IF to_regclass('public.notification_mcp_tool_sightings') IS NULL THEN
    RAISE EXCEPTION 'notification_mcp_tool_sightings was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.notification_mcp_tool_sightings')) THEN
    RAISE EXCEPTION 'notification_mcp_tool_sightings has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.notification_mcp_tool_sightings', 'SELECT')
     OR has_table_privilege('anon', 'public.notification_mcp_tool_sightings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notification_mcp_tool_sightings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notification_mcp_tool_sightings', 'INSERT')
  THEN
    RAISE EXCEPTION 'notification_mcp_tool_sightings is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notification_mcp_tool_sightings'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;
  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'notification_mcp_tool_sightings is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The index the "said once, ever" property rests on.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'notification_mcp_tool_sightings'
       AND indexname  = 'uq_notification_mcp_tool_open_run'
  ) THEN
    RAISE EXCEPTION 'the partial unique index on (connection_id, tool_name) WHERE gone_at IS NULL is missing — a tool could open two concurrent runs and be announced twice';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'notification_mcp_tool_sightings'
         AND column_name = 'gone_at') <> 'YES' THEN
    RAISE EXCEPTION 'gone_at must be nullable — an open run has no removal';
  END IF;

  RAISE NOTICE 'notification_mcp_tool_sightings created, RLS on, anon/authenticated revoked, open-run index present.';
END
$$;
