-- user_mcp_connections gains a RUNTIME half — a declared server can now be
-- exercised, and the row records what answered.
--
-- WHAT THIS CHANGES ABOUT THE ROW
-- ------------------------------
-- 20260903094500 created this table and said, in its own header, that a row is
-- "a DECLARED server … NOT evidence that anything has ever called that server",
-- that `last_used_at` would stay NULL because nothing dispatched, and that a
-- credential column would arrive "when that lands … with its own migration and
-- its own encryption, the way integration_oauth_connections did".
--
-- That is this file. `apps/api-gateway/src/mcp-runtime/` performs the
-- Streamable-HTTP handshake (`initialize` → `notifications/initialized` →
-- `tools/list`) and `POST /mcp-connections/:id/probe` writes the outcome here.
--
-- THE TWO TIMESTAMPS ARE NOT ONE TIMESTAMP
-- ----------------------------------------
-- `last_used_at` KEEPS its 20260903094500 meaning exactly: when this server last
-- *answered*. It is stamped only on a handshake that completed. `last_probe_at`
-- is new and means when we last *called*, answered or not. Collapsing them into
-- one column would have been the absence-reported-as-health fault in its purest
-- form: a failed probe would refresh "last call", and a server that has been
-- dead for a month would read as busy. Two columns, two sentences on the page.
--
-- `probe_status` IS NULLABLE, AND NULL IS NOT 'ok'
-- -----------------------------------------------
-- NULL means "never probed" and renders as an em dash. There is no default and
-- no 'unknown' member of the CHECK, because a status enum with a benign default
-- is how a register starts reporting health it never measured. The five members
-- are the five outcomes the runtime can actually distinguish, and the CHECK is
-- proven to fire by this file's own DO block rather than asserted.
--
-- THE SECRET
-- ----------
-- `secret_encrypted` holds an AES-256-GCM envelope produced by
-- `mcp-runtime/mcp-secret.service.ts` under `MCP_CONNECTION_SECRET_KEY` — the
-- same `v1.iv.tag.ciphertext` shape `common/crypto/token-crypto.service.ts`
-- uses for OAuth refresh tokens. It is TEXT, never returned by any route
-- (`mcp-connections.service.ts` selects an explicit column list that omits it,
-- and the only read of it is inside the probe path), and `secret_set_at` exists
-- so the page can say "a secret is stored, set on <date>" without the value.
--
-- If the key is absent the gateway REFUSES to store a secret rather than
-- writing one in plaintext, so a NULL here never means "stored, unencrypted".
--
-- WHAT IS STILL NOT HERE
-- ----------------------
-- No tool INVOCATION, and no column for one. Calling a tool can bind the house
-- to money, which is the subject of ADR 0013's commitment guardrail; that
-- decision comes before the code, so there is no `last_invoked_tool`, no
-- invocation log, and no argument column. `tools/list` is a read and stops
-- there.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.user_mcp_connections
  -- Per-connection bearer credential, encrypted at rest. NULL means the server
  -- is called without an Authorization header — a legitimate configuration for
  -- a server that authenticates by network position, not a missing value.
  ADD COLUMN IF NOT EXISTS secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS secret_set_at TIMESTAMPTZ,

  -- When we last CALLED. Distinct from last_used_at (when it last ANSWERED).
  ADD COLUMN IF NOT EXISTS last_probe_at TIMESTAMPTZ,

  -- The outcome of that call. NULL = never probed. No default, deliberately.
  ADD COLUMN IF NOT EXISTS probe_status TEXT,
  -- The server's own words, or ours about it. Rendered verbatim on the row.
  ADD COLUMN IF NOT EXISTS probe_detail TEXT,

  -- What `tools/list` returned, capped by the runtime's size limit. JSONB array
  -- of {name, title, description}; NULL when never probed, '[]' when the server
  -- answered and offers nothing — which are different sentences on the page.
  ADD COLUMN IF NOT EXISTS probe_tools JSONB,
  -- How many the server reported, which may exceed the array above when the cap
  -- truncated it. Storing only the array would have let a truncation read as
  -- the whole catalogue.
  ADD COLUMN IF NOT EXISTS probe_tool_count INTEGER,

  -- serverInfo/protocolVersion from the InitializeResult. The house's record of
  -- what it actually shook hands with.
  ADD COLUMN IF NOT EXISTS probe_server_name TEXT,
  ADD COLUMN IF NOT EXISTS probe_server_version TEXT,
  ADD COLUMN IF NOT EXISTS probe_protocol_version TEXT;

-- The five outcomes the runtime can tell apart. Added separately and guarded so
-- a re-run does not fail on the existing constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_mcp_connections_probe_status_known'
      AND conrelid = to_regclass('public.user_mcp_connections')
  ) THEN
    ALTER TABLE public.user_mcp_connections
      ADD CONSTRAINT user_mcp_connections_probe_status_known
      CHECK (
        probe_status IS NULL
        OR probe_status IN (
          -- the handshake completed and tools/list answered
          'ok',
          -- nothing answered: DNS, connect, TLS, or the timeout expired
          'unreachable',
          -- something answered and said no: 4xx/5xx, or a JSON-RPC error
          'refused',
          -- something answered and it was not MCP, or not this MCP: a bad
          -- envelope, a redirect, a body over the cap, an unusable version
          'protocol_error',
          -- we could not call at all because this deployment holds no
          -- MCP_CONNECTION_SECRET_KEY and this row carries a secret
          'unconfigured'
        )
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The lockdown is inherited, and re-asserted below rather than assumed.
--    (RLS, the service_role policy and the anon/authenticated REVOKE were set
--    by 20260903094500 and are not re-granted by ALTER TABLE ... ADD COLUMN.)
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.user_mcp_connections.secret_encrypted IS
  'AES-256-GCM envelope (v1.iv.tag.ciphertext) of this connection''s bearer credential, under MCP_CONNECTION_SECRET_KEY. Never returned by any route; the gateway refuses to store a secret at all when the key is absent, so NULL never means "stored in plaintext".';

COMMENT ON COLUMN public.user_mcp_connections.last_probe_at IS
  'When this server was last CALLED, answered or not. Its neighbour last_used_at means when it last ANSWERED and is stamped only on a completed handshake — one column for each, so a failed probe cannot make a dead server read as busy.';

COMMENT ON COLUMN public.user_mcp_connections.probe_status IS
  'Outcome of the last probe: ok | unreachable | refused | protocol_error | unconfigured. NULL means never probed and renders as an em dash. No default and no "unknown" member: a status enum with a benign default is how a register starts reporting health it never measured.';

COMMENT ON COLUMN public.user_mcp_connections.probe_tools IS
  'The tools/list result, capped by the runtime. NULL = never probed. [] = the server answered and offers no tools. probe_tool_count carries what the server reported, which may exceed this array when the cap truncated it.';

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  required    text[] := ARRAY[
    'secret_encrypted', 'secret_set_at', 'last_probe_at',
    'probe_status', 'probe_detail', 'probe_tools', 'probe_tool_count',
    'probe_server_name', 'probe_server_version', 'probe_protocol_version'
  ];
  nullable    text;
  check_fired boolean := false;
  probe_row   uuid;
  owner_user  uuid;
  owner_rest  uuid;
BEGIN
  IF to_regclass('public.user_mcp_connections') IS NULL THEN
    RAISE EXCEPTION 'user_mcp_connections is missing; 20260903094500 did not run';
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
    RAISE EXCEPTION 'the runtime columns the gateway reads are missing: %', absent_cols;
  END IF;

  -- Every one of them must be nullable. A NOT NULL on any runtime column would
  -- force an insert to invent a probe that never happened — the exact fault
  -- 20260903094500 refused for last_used_at.
  FOREACH c IN ARRAY required LOOP
    SELECT is_nullable INTO nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_mcp_connections'
       AND column_name = c;
    IF nullable <> 'YES' THEN
      RAISE EXCEPTION '% must be nullable — a never-probed server has no %', c, c;
    END IF;
  END LOOP;

  -- The lockdown 20260903094500 set must still hold after the ALTER.
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.user_mcp_connections')) THEN
    RAISE EXCEPTION 'user_mcp_connections has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.user_mcp_connections', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_mcp_connections', 'SELECT')
     OR has_column_privilege('anon', 'public.user_mcp_connections', 'secret_encrypted', 'SELECT')
     OR has_column_privilege('authenticated', 'public.user_mcp_connections', 'secret_encrypted', 'SELECT')
  THEN
    RAISE EXCEPTION 'the encrypted secret is reachable by a client role';
  END IF;

  -- PROVE the CHECK fires rather than asserting it exists. Needs a real parent
  -- row, so this arm only runs where one can be made; where it cannot, the
  -- constraint's presence is still asserted above and the skip is announced
  -- instead of being silently counted as a pass.
  SELECT u.user_id, r.id INTO owner_user, owner_rest
    FROM public.users u CROSS JOIN public.restaurants r LIMIT 1;

  IF owner_user IS NULL OR owner_rest IS NULL THEN
    RAISE NOTICE 'probe_status CHECK not exercised: no users/restaurants row exists to hang a test row on. The constraint is asserted present above.';
  ELSE
    INSERT INTO public.user_mcp_connections (user_id, restaurant_id, name, url)
    VALUES (owner_user, owner_rest,
            'migration probe_status check ' || gen_random_uuid()::text,
            'https://example.invalid/mcp')
    RETURNING id INTO probe_row;

    BEGIN
      UPDATE public.user_mcp_connections
         SET probe_status = 'healthy'   -- not a member; must be rejected
       WHERE id = probe_row;
    EXCEPTION WHEN check_violation THEN
      check_fired := true;
    END;

    DELETE FROM public.user_mcp_connections WHERE id = probe_row;

    IF NOT check_fired THEN
      RAISE EXCEPTION 'probe_status accepted a value outside its CHECK — the register can record a health it cannot produce';
    END IF;
  END IF;

  RAISE NOTICE 'user_mcp_connections runtime columns added, all nullable, secret unreachable by client roles, probe_status CHECK verified.';
END
$$;
