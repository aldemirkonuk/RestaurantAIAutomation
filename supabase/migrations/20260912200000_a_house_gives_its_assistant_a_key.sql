-- A house gives its assistant a key — the INBOUND half of model context.
--
-- WHAT THIS IS, AND WHAT IT IS NOT
-- --------------------------------
-- `restaurant_mcp_connections` (20260903094500, renamed 20260903151000) records
-- servers THIS HOUSE MAY CALL. This file is the opposite direction: a credential
-- an assistant the house chose presents to US, so that Mudavym can answer
-- `initialize`, `tools/list` and `tools/call` as a model-context SERVER.
-- The two must never be conflated in a query or on a page: a row here is not
-- evidence of an outbound connection and a row there is not evidence that
-- anything has ever called us.
--
-- NO TOKEN IS STORED. `token_hash` is the SHA-256 of the presented secret, hex.
-- The secret itself is shown to the operator exactly once, at mint, and is not
-- recoverable from this table — the same posture `restaurant_mcp_connections`
-- took by having no token column at all, adapted to a half that must actually
-- verify one. A hash is not a secret at rest: it cannot be replayed against us
-- without the preimage, and a leaked dump of this table grants nothing.
--
-- WHY A SECOND TABLE FOR THE LOG
-- ------------------------------
-- `mcp_tool_calls` (20260903151000:258) records calls WE MAKE OUTWARD. Calls
-- made INWARD have a different subject (a credential, not a person), a different
-- refusal vocabulary, and a different retention question. Folding them into one
-- table with a `direction` column would make every existing read of that table
-- silently wrong the moment the first inbound call landed — the reads do not
-- filter on a column that does not exist yet. Two tables; one meaning each.
--
-- ASKED_BY IS NULLABLE AND STAYS NULL
-- -----------------------------------
-- An MCP client presents a key; it does not present a person. We know WHO MINTED
-- the credential (`mcp_server_credentials.created_by`) and that is a different
-- fact from who asked the question. `asked_by` is therefore NULL on every row
-- this build writes, and it is NOT defaulted to the minter: a placeholder there
-- would let a report answer "who asked?" with a name nobody typed. When a client
-- carries an end-user identity, that is the column it lands in.
--
-- FK TARGETS. `created_by` references `public.users(user_id)` — NOT
-- `auth.users`. The two tables share zero ids in this deployment and the JWT
-- carries `public.users.user_id`, so a FK to `auth.users` would 23503 on the
-- first insert and no CI check would catch it (a fresh database has no rows to
-- violate).
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The credential
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_server_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which house this key reads. NOT NULL and the ONLY source of tenancy for an
  -- inbound call: the MCP protocol has no tenant field, every tool's arguments
  -- are the client's to choose, and a restaurant id taken from a tool argument
  -- would be a tenancy hole with a friendly name.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- What the operator calls it, shown on the register row.
  label VARCHAR(120) NOT NULL CHECK (btrim(label) <> ''),

  -- SHA-256 of the presented secret, lowercase hex, 64 chars. Never the secret.
  token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  -- The first characters of the secret, kept so a register row can say WHICH
  -- key this is without being able to reconstruct it. Display only.
  token_prefix VARCHAR(24) NOT NULL,

  -- What this key may read, in the same lowercase-slug vocabulary
  -- `restaurant_mcp_connections.scopes` uses (`inventory:read`, `orders:read`).
  -- Empty is legitimate and means "minted, nothing granted" — the server then
  -- lists no read tools for it. It is not a stand-in for "all".
  scopes TEXT[] NOT NULL DEFAULT '{}',

  -- The person who minted it. Their authority is what the key carries.
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL until something actually presents this key. Deliberately not defaulted
  -- to created_at: a mint is not a use, and a register that shows the mint time
  -- under a "last used" heading reports absence as health.
  last_used_at TIMESTAMPTZ,

  -- Soft revoke, like its outbound neighbour: a deleted key is
  -- indistinguishable from a key that never existed.
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);

-- The verification read: one hash, one row. Unique across ALL rows including
-- revoked ones, so a revoked secret can never be re-minted into a live row and
-- silently start working again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_server_credentials_token_hash
  ON public.mcp_server_credentials (token_hash);

-- The register read: this house's keys, newest first.
CREATE INDEX IF NOT EXISTS idx_mcp_server_credentials_house
  ON public.mcp_server_credentials (restaurant_id, created_at DESC);

-- One live key per label per house. Partial, so a revoked label is reusable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_server_credentials_live_label
  ON public.mcp_server_credentials (restaurant_id, lower(btrim(label)))
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. The inbound call log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_server_call_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which key made the call. ON DELETE SET NULL rather than CASCADE: revoking
  -- and then deleting a key must not erase the record of what it did.
  credential_id UUID REFERENCES public.mcp_server_credentials(id) ON DELETE SET NULL,

  -- Denormalised so the log survives the credential row and stays answerable
  -- per house. NULL only for a call refused before a credential resolved.
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The JSON-RPC method: `initialize`, `tools/list`, `tools/call`, …
  method TEXT NOT NULL CHECK (btrim(method) <> ''),

  -- The tool name for a `tools/call`; NULL for every other method. NULL here
  -- means "this method names no tool", not "we did not record which".
  tool_name TEXT,

  -- What happened, in the vocabulary the server actually distinguishes.
  -- `refused` is a RESULT (a write tool declining, an ungranted scope), not an
  -- error: §7a of the capability note makes that distinction binding, and a log
  -- that collapsed the two could not answer "did anything break?".
  outcome TEXT NOT NULL CHECK (
    outcome IN ('ok', 'refused', 'error', 'unauthorized', 'rate_limited')
  ),

  -- One sentence. For a refusal, the sentence the client was given.
  detail TEXT,

  duration_ms INTEGER,
  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The end user on whose behalf the assistant asked, when the client tells us.
  -- Nothing tells us today, so this is NULL on every row this build writes.
  -- See the header: it is never filled with the credential's minter.
  asked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_call_log_credential
  ON public.mcp_server_call_log (credential_id, called_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_server_call_log_house
  ON public.mcp_server_call_log (restaurant_id, called_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Lock both down in the SAME migration that creates them (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_server_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_credentials_service_role
  ON public.mcp_server_credentials;
CREATE POLICY mcp_server_credentials_service_role
  ON public.mcp_server_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_server_credentials FROM anon, authenticated;

ALTER TABLE public.mcp_server_call_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_server_call_log_service_role
  ON public.mcp_server_call_log;
CREATE POLICY mcp_server_call_log_service_role
  ON public.mcp_server_call_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_server_call_log FROM anon, authenticated;

COMMENT ON TABLE public.mcp_server_credentials IS
  'Keys an assistant presents to the Mudavym MCP SERVER (inbound). Not the outbound register — that is restaurant_mcp_connections. token_hash is SHA-256 hex of the secret; the secret is shown once at mint and is not stored. Soft revoke via revoked_at. RLS on, service_role only.';

COMMENT ON COLUMN public.mcp_server_credentials.last_used_at IS
  'When this key last presented itself. NULL means it never has — deliberately not defaulted to created_at, so the register shows an em dash rather than implying traffic that did not happen.';

COMMENT ON TABLE public.mcp_server_call_log IS
  'One row per inbound MCP request. Separate from mcp_tool_calls, which records calls we make OUTWARD. outcome distinguishes refused (a result) from error (a fault).';

COMMENT ON COLUMN public.mcp_server_call_log.asked_by IS
  'The end user the assistant asked for, when a client supplies one. NULL on every row this build writes: MCP presents a key, not a person, and filling this with the credential minter would answer "who asked?" with a name nobody typed.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  t           text;
  cred_cols   text[] := ARRAY[
    'id', 'restaurant_id', 'label', 'token_hash', 'token_prefix', 'scopes',
    'created_by', 'created_at', 'last_used_at', 'revoked_at', 'revoked_by'
  ];
  log_cols    text[] := ARRAY[
    'id', 'credential_id', 'restaurant_id', 'method', 'tool_name', 'outcome',
    'detail', 'duration_ms', 'called_at', 'asked_by'
  ];
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_server_credentials', 'mcp_server_call_log'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;

    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION '% is still reachable by anon/authenticated', t;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY cred_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mcp_server_credentials'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'mcp_server_credentials.' || c);
    END IF;
  END LOOP;

  FOREACH c IN ARRAY log_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mcp_server_call_log'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'mcp_server_call_log.' || c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'the MCP server is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The two nullabilities that are load-bearing. A NOT NULL last_used_at would
  -- force every mint to invent a call; a NOT NULL asked_by would force every
  -- inbound call to invent a person.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mcp_server_credentials'
         AND column_name = 'last_used_at') <> 'YES' THEN
    RAISE EXCEPTION 'last_used_at must be nullable — a never-used key has no last use';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mcp_server_call_log'
         AND column_name = 'asked_by') <> 'YES' THEN
    RAISE EXCEPTION 'asked_by must be nullable — an MCP client presents a key, not a person';
  END IF;

  -- The FK that CI cannot catch: public.users, never auth.users. The two are
  -- disjoint in this deployment, and a fresh database has no rows to violate.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class ref ON ref.oid = con.confrelid
    JOIN pg_namespace ns ON ns.oid = ref.relnamespace
    WHERE con.contype = 'f'
      AND con.conrelid IN (
        to_regclass('public.mcp_server_credentials'),
        to_regclass('public.mcp_server_call_log')
      )
      AND ns.nspname = 'auth'
  ) THEN
    RAISE EXCEPTION 'an MCP server table references auth.users; it must reference public.users(user_id)';
  END IF;

  RAISE NOTICE 'mcp_server_credentials + mcp_server_call_log created, RLS on, anon/authenticated revoked, column contract satisfied.';
END
$$;
