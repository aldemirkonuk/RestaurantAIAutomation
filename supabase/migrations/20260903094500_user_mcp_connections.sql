-- user_mcp_connections — model-context servers become a register with a table
-- behind it, not a shape drawn on a page.
--
-- WHAT THIS REPLACES
-- ------------------
-- `/profile`'s Mudavym rebuild shipped a "Model context" rail on 2026-09-02 whose
-- every control was `disabled` with the reason "there is no endpoint to call and
-- no table to write". That was true: `grep -rniw mcp apps/api-gateway/src
-- apps/web/src supabase/migrations` matched nothing outside the page's own
-- honesty prose. The founder's answer to the honest dash was to build the thing,
-- so this file is the table half and `apps/api-gateway/src/mcp-connections/` is
-- the gateway half.
--
-- WHAT A ROW IS, AND WHAT IT IS NOT
-- ---------------------------------
-- A row is a DECLARED server: a name, an endpoint, and the scopes the house has
-- granted it. It is NOT evidence that anything has ever called that server.
-- `last_used_at` is NULL until a caller stamps it, and today nothing in this
-- product dispatches to a model-context server, so it will stay NULL. That is
-- deliberate and it is the whole reason the column is nullable rather than
-- defaulting to now(): a `created_at` masquerading as a `last_used_at` is the
-- absence-reported-as-health fault in one column, and the page renders the dash.
--
-- No token column. The connect handshake, whatever it turns out to be, is a
-- later decision (OD register); storing a credential before there is a code path
-- that uses one would put a secret in a table nothing reads. When that lands it
-- gets its own migration and its own encryption, the way
-- integration_oauth_connections did.
--
-- SOFT REVOKE, like its neighbour
-- ------------------------------
-- Revocation sets `revoked_at` instead of deleting, so the register can show
-- that a server was once trusted and is not any more — the same choice
-- 20260826170000_integration_oauth_tables.sql made, and for the same reason: a
-- deleted grant is indistinguishable from a grant that never existed.
--
-- The uniqueness is PARTIAL (`where revoked_at is null`) on purpose, and that is
-- the opposite of the decision its neighbour made. integration_oauth_connections
-- must stay NON-partial because a PostgREST upsert binds `ON CONFLICT` to it;
-- this table is written with a plain INSERT, so nothing binds to the index, and
-- a partial one lets a revoked name be used again — which a soft revoke
-- otherwise makes permanently impossible.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_mcp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Whose grant it is. A model-context server acts with the user's authority,
  -- so it hangs off the user the way a linked account does.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- Which house it may act in. NOT NULL: a server scoped to "every restaurant
  -- this user can reach" is a tenancy hole, and the gateway takes this from the
  -- signed JWT rather than from the request body.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- What the operator calls it. Shown as the row title.
  name VARCHAR(120) NOT NULL CHECK (btrim(name) <> ''),

  -- Where it answers. http(s) only — a `command:` transport would run a process
  -- on our servers, which is a decision, not a field.
  url TEXT NOT NULL CHECK (url ~ '^https?://'),

  -- Exactly what this server has been granted, in the house's own vocabulary.
  -- Empty is a legitimate value and means "declared, nothing granted yet"; it is
  -- not a stand-in for unknown.
  scopes TEXT[] NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL until something actually calls. See the header: never defaulted.
  last_used_at TIMESTAMPTZ,

  -- Soft revoke.
  revoked_at TIMESTAMPTZ
);

-- The register's only read: this user's servers in this restaurant.
CREATE INDEX IF NOT EXISTS idx_user_mcp_connections_user_restaurant
  ON public.user_mcp_connections (user_id, restaurant_id, created_at DESC);

-- One live server per name per house. Partial, so a revoked name is reusable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_mcp_connections_live_name
  ON public.user_mcp_connections (user_id, restaurant_id, lower(btrim(name)))
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_mcp_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_mcp_connections_service_role
  ON public.user_mcp_connections;
CREATE POLICY user_mcp_connections_service_role
  ON public.user_mcp_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.user_mcp_connections FROM anon, authenticated;

COMMENT ON TABLE public.user_mcp_connections IS
  'Model-context (MCP) servers a user has declared for one restaurant. Rows are declarations, not evidence of use: last_used_at is NULL until a caller stamps it and nothing dispatches to these servers yet. Soft revoke via revoked_at. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.user_mcp_connections.last_used_at IS
  'When this server last answered a call. NULL means it never has — deliberately not defaulted to created_at, so the UI renders an em dash instead of implying traffic that did not happen.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'id', 'user_id', 'restaurant_id', 'name', 'url', 'scopes',
    'created_at', 'last_used_at', 'revoked_at'
  ];
BEGIN
  IF to_regclass('public.user_mcp_connections') IS NULL THEN
    RAISE EXCEPTION 'user_mcp_connections was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.user_mcp_connections')) THEN
    RAISE EXCEPTION 'user_mcp_connections has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.user_mcp_connections', 'SELECT')
     OR has_table_privilege('anon', 'public.user_mcp_connections', 'INSERT')
     OR has_table_privilege('anon', 'public.user_mcp_connections', 'UPDATE')
     OR has_table_privilege('anon', 'public.user_mcp_connections', 'DELETE')
     OR has_table_privilege('authenticated', 'public.user_mcp_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_mcp_connections', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_mcp_connections', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_mcp_connections', 'DELETE')
  THEN
    RAISE EXCEPTION 'user_mcp_connections is still reachable by anon/authenticated';
  END IF;

  FOREACH c IN ARRAY required LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'user_mcp_connections'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'user_mcp_connections is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The one column whose nullability is load-bearing: a NOT NULL last_used_at
  -- would force every insert to invent a call that never happened.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'user_mcp_connections'
         AND column_name = 'last_used_at') <> 'YES' THEN
    RAISE EXCEPTION 'last_used_at must be nullable — a never-called server has no last call';
  END IF;

  RAISE NOTICE 'user_mcp_connections created, RLS on, anon/authenticated revoked, column contract satisfied.';
END
$$;
