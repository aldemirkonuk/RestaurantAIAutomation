-- A seal on a tool write is REDEEMED, not asserted. (Founder, 2026-09-04;
-- ADR 0107 addendum. Additive to 20260904160000.)
--
-- WHAT WAS WRONG WITH THE SEAL
-- ----------------------------
-- ADR 0114 was explicit about its own limit: `sealed: true` was "an assertion by
-- an authenticated manager, recorded with their id — not a cryptographic proof
-- of the gesture". Anything holding that manager's session could send
-- `sealed: true` on a purchase and the gateway would believe it, because the
-- claim and the thing it claimed about were the same field in the same request.
-- The hold-to-approve gesture existed in the browser and left no trace the
-- server could check.
--
-- CHALLENGE AND REDEEM
-- --------------------
-- The hold now BEGINS with a request: the gateway mints a one-time,
-- short-lived challenge and returns it once. The write must carry it back, and
-- the gateway redeems it exactly once. A challenge is bound to four things and
-- a mismatch in any of them is a refusal in words:
--
--   * the ACTOR — a token issued to one manager cannot be spent by another;
--   * the CONNECTION and the TOOL — a seal for "read the cellar" cannot pay
--     for "place the order", which is the substitution the assertion model had
--     no way to see;
--   * the ARGUMENTS — `args_hash` binds the seal to what was actually approved,
--     so a token minted for a 6-bottle order cannot be spent on 600.
--
-- Expiry is short and redemption is single: `redeemed_at IS NULL` in the WHERE
-- clause of the UPDATE is what makes "exactly once" a property of the database
-- rather than of the code path that happens to run first.
--
-- THE TOKEN IS NOT STORED. `token_hash` holds sha256 of the token; the token
-- itself is returned once and never persisted. A table of live seals readable
-- by anything that reaches the database would be a table of pre-approved
-- purchases, which is worse than the assertion it replaces.
--
-- SCOPE. This is the seal on an MCP TOOL WRITE. Ordinary sealed settings keep
-- the assertion model and are deliberately untouched — the founder scoped it
-- that way, and widening it silently would be a decision taken by a migration.
--
-- Idempotent: every CREATE is IF NOT EXISTS, the column work is IF NOT EXISTS,
-- and the backfill only names rows that have not been labelled.

-- ---------------------------------------------------------------------------
-- 1. The challenges themselves.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_seal_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  connection_id UUID NOT NULL
    REFERENCES public.restaurant_mcp_connections(id) ON DELETE CASCADE,

  -- CASCADE: a challenge is an authority held by one person for the next two
  -- minutes. It is meaningless without them and must not outlive them.
  actor_user_id UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE CASCADE,

  tool_name VARCHAR(200) NOT NULL CHECK (btrim(tool_name) <> ''),

  -- sha256 of the canonical JSON of the arguments the hold was begun over. The
  -- seal is for THIS call, not for this tool in general.
  args_hash TEXT NOT NULL,

  -- sha256 of the token. The token is returned to the browser once and is never
  -- stored: see the header.
  token_hash TEXT NOT NULL,

  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- No default. How long a seal lives is a decision the issuing code states
  -- explicitly, and a column default would be a second, silent opinion about it.
  expires_at TIMESTAMPTZ NOT NULL,

  -- The single-use mark. NULL means unspent; the redeeming UPDATE requires it.
  redeemed_at TIMESTAMPTZ
);

-- One live challenge per token. Not partial: a redeemed token's hash must stay
-- unusable, so the row has to keep blocking its own reissue.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_seal_challenges_token
  ON public.mcp_seal_challenges (token_hash);

CREATE INDEX IF NOT EXISTS idx_mcp_seal_challenges_open
  ON public.mcp_seal_challenges (connection_id, actor_user_id)
  WHERE redeemed_at IS NULL;

COMMENT ON TABLE public.mcp_seal_challenges IS
  'One-time, short-lived proofs that a hold-to-approve gesture happened, bound to (actor, connection, tool, args_hash). The gateway mints one when the hold begins and redeems it exactly once when the write arrives; a replay, a different actor, a different tool, different arguments or an expired token is refused and filed in mcp_tool_calls. The token itself is never stored — only its sha256 (ADR 0107 addendum, 2026-09-04).';

COMMENT ON COLUMN public.mcp_seal_challenges.args_hash IS
  'sha256 of the canonical JSON of the call arguments. Binds the seal to what was approved, so a token minted for one order cannot be spent on a different one.';

-- ---------------------------------------------------------------------------
-- 2. What the call log says about the seal it saw.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_tool_calls
  -- 'proven'   — a challenge was redeemed for exactly this call.
  -- 'asserted' — the caller claimed the seal and nothing checked it. Every row
  --              written before this migration is one of these, and saying so
  --              is the point: relabelling history as proven would make the log
  --              certify a guarantee it never had.
  -- NULL       — not a sealed call at all.
  ADD COLUMN IF NOT EXISTS seal_proof TEXT;

ALTER TABLE public.mcp_tool_calls
  DROP CONSTRAINT IF EXISTS chk_mcp_tool_calls_seal_proof;

ALTER TABLE public.mcp_tool_calls
  ADD CONSTRAINT chk_mcp_tool_calls_seal_proof
  CHECK (seal_proof IS NULL OR seal_proof IN ('asserted', 'proven'));

-- Historical rows: sealed and unchecked. Literally true, and only touched once.
UPDATE public.mcp_tool_calls
   SET seal_proof = 'asserted'
 WHERE sealed = TRUE AND seal_proof IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool
  ON public.mcp_tool_calls (connection_id, lower(btrim(tool_name)), called_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Locked down in the same file that creates it (OD-72/OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_seal_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_seal_challenges_service_role ON public.mcp_seal_challenges;
CREATE POLICY mcp_seal_challenges_service_role
  ON public.mcp_seal_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_seal_challenges FROM anon, authenticated;

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_tool_calls FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  role_ text;
  priv  text;
  t     text;
  bad   int;
BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_seal_challenges', 'mcp_tool_calls'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    FOREACH role_ IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(role_, 'public.' || t, priv) THEN
          RAISE EXCEPTION '% is still %-able by %', t, priv, role_;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- The token must not be storable. A column named for it would be the whole
  -- mechanism undone by a convenience.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mcp_seal_challenges'
       AND column_name IN ('token', 'token_plain', 'secret')
  ) THEN
    RAISE EXCEPTION 'mcp_seal_challenges grew a column that could hold the token itself';
  END IF;

  -- Single use has to be enforceable: one row per token hash.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'mcp_seal_challenges'
       AND indexname = 'uq_mcp_seal_challenges_token'
  ) THEN
    RAISE EXCEPTION 'a token hash is not unique — a challenge could be reissued and spent twice';
  END IF;

  -- Expiry must be stated by the issuer, never defaulted.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mcp_seal_challenges'
         AND column_name = 'expires_at') IS NOT NULL THEN
    RAISE EXCEPTION 'expires_at has a default — how long a seal lives would be decided twice';
  END IF;

  -- And no sealed call may be left unlabelled: an unlabelled seal reads as a
  -- proven one to anyone scanning the column.
  SELECT count(*) INTO bad
    FROM public.mcp_tool_calls
   WHERE sealed = TRUE AND seal_proof IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% sealed call(s) have no seal_proof', bad;
  END IF;

  RAISE NOTICE 'a seal on a tool write is redeemed: challenges are single-use, bound to actor/connection/tool/arguments, expire on an issuer-stated deadline, and the log distinguishes proven from asserted.';
END
$$;
