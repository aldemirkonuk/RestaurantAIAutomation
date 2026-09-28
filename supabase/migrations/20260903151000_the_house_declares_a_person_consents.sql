-- The house declares, each person consents — and a tool is granted one at a
-- time, by name (ADR 0114; ADR 0107 addendum).
--
-- THE FORK THIS CLOSES
-- --------------------
-- 20260903094500 wrote, in its own comment on the column: "A model-context
-- server acts with the user's authority, so it hangs off the user"
-- (`:54-56`, user_id NOT NULL … ON DELETE CASCADE). The register that renders
-- those rows said the opposite in its lead — "Servers the house agents may
-- call" (apps/web/src/pages/profile/next/McpRegister.tsx:319). Both sentences
-- were in the tree and both could not be true. DESIGN-FOUNDATION §6b filed it
-- as the open fork; the founder answered it on 2026-09-03:
--
--     "House declares, each person consents."
--
-- Three consequences follow mechanically, and this file is all three.
--
-- 1. THE ATTACHMENT IS THE RESTAURANT'S. `user_id NOT NULL … ON DELETE CASCADE`
--    meant deleting the person who typed the URL deleted the house's Toast
--    bridge with them. The column is replaced by `declared_by … ON DELETE SET
--    NULL`: who declared it is a fact worth keeping and a dependency worth not
--    having. The table is RENAMED for the same reason — `user_mcp_connections`
--    would have been a name asserting the thing this migration disproves.
--
-- 2. A PERSON'S CREDENTIAL IS A CONSENT, NOT AN ATTACHMENT. `mcp_connection_
--    consents` holds one row per (connection, person): I agree this server may
--    act in my name. Withdrawing is a `withdrawn_at`, and it kills the consent
--    and nothing else — the attachment stands, and everyone else's consent
--    stands. This is the shape Claude, Notion, Slack and Claude Code all use
--    (the ten-product survey is DESIGN-FOUNDATION §6b).
--
-- 3. A TOOL IS GRANTED BY NAME. `mcp_tool_grants` holds one row per (connection,
--    tool). `writes` marks a tool that changes the world outside this app; the
--    gateway refuses to call an ungranted tool at all, and refuses a `writes`
--    tool that does not arrive sealed by a manager's hold-to-approve. Listing a
--    tool and invoking it were always different grants; now they are different
--    rows. `mcp_tool_calls` is the record of what was actually called —
--    §6b's checklist named "a connection event log" as the cheapest absent item
--    and the one most missed after an incident.
--
-- WHAT THIS FILE DOES *NOT* DO
-- ---------------------------
-- It does not move the OAuth grants (`integration_oauth_connections`) to the
-- house. Those are a person's Google/Microsoft account and stay personal by the
-- same rule that makes this table the house's — the credential authenticates a
-- person and the action is attributed to that person. `/connections` lists every
-- one that can touch house data, and a manager may cut the HOUSE off from it
-- (§4b) while the person keeps their own grant. What a manager may never do is
-- delete someone else's credential, or hold a personal connection in a pending
-- state waiting for approval — both were refused by name (ADR 0114).
--
-- Idempotent and safe to re-run: the rename is guarded on `to_regclass`, every
-- CREATE is `IF NOT EXISTS`, and the column work is `IF EXISTS`/`IF NOT EXISTS`.
-- No explicit BEGIN/COMMIT — the Supabase CLI wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Rename the table, so the name stops asserting the rejected answer.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.user_mcp_connections') IS NOT NULL
     AND to_regclass('public.restaurant_mcp_connections') IS NULL THEN
    ALTER TABLE public.user_mcp_connections
      RENAME TO restaurant_mcp_connections;
  END IF;
END
$$;

ALTER INDEX IF EXISTS public.idx_user_mcp_connections_user_restaurant
  RENAME TO idx_restaurant_mcp_connections_house;
ALTER INDEX IF EXISTS public.uq_user_mcp_connections_live_name
  RENAME TO uq_restaurant_mcp_connections_live_name;

-- ---------------------------------------------------------------------------
-- 2. Who declared it becomes a fact, not a dependency.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_mcp_connections
  -- SET NULL, not CASCADE. "The person who attached this has left" is a thing a
  -- register should be able to say; "the till stopped ingesting because we
  -- deleted an account" is not.
  ADD COLUMN IF NOT EXISTS declared_by UUID
    REFERENCES public.users(user_id) ON DELETE SET NULL;

-- Carry the old owner across before the column that held it goes. Only touches
-- rows that have not been backfilled, so a re-run is a no-op.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_mcp_connections'
      AND column_name = 'user_id'
  ) THEN
    EXECUTE 'UPDATE public.restaurant_mcp_connections
                SET declared_by = user_id
              WHERE declared_by IS NULL AND user_id IS NOT NULL';
  END IF;
END
$$;

-- The live-name rule is the HOUSE's now: two managers cannot declare two live
-- servers called "Toast bridge" for the same restaurant, and the old index —
-- keyed on the person — would have let them. Partial, so a revoked name is
-- reusable (20260903094500 explains why this one may be partial and its
-- neighbour may not).
DROP INDEX IF EXISTS public.uq_restaurant_mcp_connections_live_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_mcp_conn_live_name
  ON public.restaurant_mcp_connections (restaurant_id, lower(btrim(name)))
  WHERE revoked_at IS NULL;

DROP INDEX IF EXISTS public.idx_restaurant_mcp_connections_house;
CREATE INDEX IF NOT EXISTS idx_restaurant_mcp_conn_house
  ON public.restaurant_mcp_connections (restaurant_id, created_at DESC);

ALTER TABLE public.restaurant_mcp_connections
  DROP COLUMN IF EXISTS user_id;

COMMENT ON TABLE public.restaurant_mcp_connections IS
  'Model-context (MCP) servers ONE RESTAURANT has declared. The attachment is the house''s: it survives the person who declared it (declared_by … ON DELETE SET NULL), and a person''s agreement to let it act in their name is a row in mcp_connection_consents. Rows are declarations plus the last probe''s evidence, never a claim that a tool ran — that is mcp_tool_calls. Soft revoke via revoked_at. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.restaurant_mcp_connections.declared_by IS
  'The person who attached this server. A fact for the register to show, not an ownership: deleting the account nulls this column and leaves the house''s attachment intact. That is the whole point of ADR 0114.';

-- ---------------------------------------------------------------------------
-- 3. A person's consent to be acted for.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_connection_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  connection_id UUID NOT NULL
    REFERENCES public.restaurant_mcp_connections(id) ON DELETE CASCADE,

  -- CASCADE here is correct and is the opposite case to declared_by: a consent
  -- is meaningless without the person who gave it, and deleting it removes an
  -- authority rather than an attachment.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft withdrawal, like every other grant in this schema: a consent that
  -- vanishes is indistinguishable from one that was never given.
  withdrawn_at TIMESTAMPTZ,

  -- The HOUSE's side of the same consent, and the reason it is a second column
  -- rather than a second value in the first. The founder's rule (2026-09-03):
  -- "a manager may SEE, not approve, what a member has personally connected …
  -- and a manager can revoke the HOUSE's access while the person keeps the
  -- grant for their own use." Two parties can each withdraw, independently, and
  -- collapsing them would make "I changed my mind" and "the house cut this off"
  -- the same fact — which is precisely the fact an audit needs to tell apart.
  --
  -- There is deliberately NO pending/approved column. Approval-gating was
  -- refused: a personal connection is not a request, and a state that waits on a
  -- manager would turn every member's own account into the house's queue.
  house_revoked_at TIMESTAMPTZ,
  house_revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  UNIQUE (connection_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_consents_connection
  ON public.mcp_connection_consents (connection_id)
  WHERE withdrawn_at IS NULL AND house_revoked_at IS NULL;

COMMENT ON TABLE public.mcp_connection_consents IS
  'One row per (model-context server, person): this person agrees the server may act in their name. A consent is live only while BOTH withdrawn_at (the person changed their mind) and house_revoked_at (a manager cut the house off from it) are null. Either withdrawal removes ONLY that authority — the house''s attachment and everyone else''s consent are untouched. No pending state exists: approval-gating was refused (ADR 0114).';

-- ---------------------------------------------------------------------------
-- 4. A tool is granted one at a time, by name.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_tool_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  connection_id UUID NOT NULL
    REFERENCES public.restaurant_mcp_connections(id) ON DELETE CASCADE,

  -- The server's own name for the tool, as returned by tools/list. Matched
  -- case-insensitively by the unique index below; stored as the server spells
  -- it, because the register shows the server's word and not ours.
  tool_name VARCHAR(200) NOT NULL CHECK (btrim(tool_name) <> ''),

  -- TRUE means "this tool changes the world outside this app" — it sends, buys,
  -- orders or writes somewhere we do not control. The founder's rule
  -- (2026-09-03): a read runs freely once granted; a write runs only behind the
  -- seal. There is no default: classifying a tool is the granting manager's
  -- act, and a benign default would classify every unknown tool as safe, which
  -- is the absence-reported-as-health fault applied to money.
  writes BOOLEAN NOT NULL,

  granted_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mcp_tool_grants_live
  ON public.mcp_tool_grants (connection_id, lower(btrim(tool_name)))
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.mcp_tool_grants IS
  'One row per (model-context server, tool name) a manager has granted. `writes` marks a tool that changes the world outside this app: the gateway refuses an ungranted tool outright and refuses a granted `writes` tool that does not arrive sealed by a manager (ADR 0107 addendum / ADR 0114). Soft revoke via revoked_at.';

COMMENT ON COLUMN public.mcp_tool_grants.writes IS
  'NOT NULL with no default on purpose. Whether a tool commits the house is the granting manager''s judgement; a default would let an unclassified tool be treated as a read.';

-- ---------------------------------------------------------------------------
-- 4b. The house's own access to a PERSON's grant, and how it lets go of it.
--
-- `integration_oauth_connections` is a person's Google/Microsoft account and
-- stays theirs — the house cannot revoke it, and `/connections` says so on the
-- row. What the house CAN do is stop using it: the founder's rule is that a
-- manager sees every personal grant that can touch house data and may "revoke
-- the HOUSE's access to it while the person keeps the grant for their own use".
--
-- A REVOCATION LIST, NOT A PERMISSION TABLE. A row here means the house has cut
-- itself off from that grant. No row means it has not — which is the true
-- default, because the grant exists and works whether or not anyone has thought
-- about it. A permission table would have needed a row per grant per house that
-- something had to remember to write, and a missing row would have read as
-- "denied" for a grant that was in fact live: absence reported as safety, which
-- is the same fault as absence reported as health wearing a different coat.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_personal_grant_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  connection_id UUID NOT NULL
    REFERENCES public.integration_oauth_connections(id) ON DELETE CASCADE,

  -- NOT NULL with a default: the row's existence IS the revocation, so a row
  -- with no timestamp would be a revocation nobody dated.
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  -- The manager's own words, shown on the row. Optional: a reason is worth
  -- asking for and not worth blocking on.
  reason TEXT,

  UNIQUE (restaurant_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_grant_access_restaurant
  ON public.restaurant_personal_grant_access (restaurant_id);

COMMENT ON TABLE public.restaurant_personal_grant_access IS
  'A revocation list: one row means this restaurant has cut its own access to that person''s OAuth grant. The person keeps the grant for their own use — the house stops using it. No row means the house has not revoked, which is the honest default (ADR 0114). Enforced at integrations-oauth.service.ts getAccessToken, the single door feature code uses.';

-- ---------------------------------------------------------------------------
-- 5. What was actually called. The connection event log §6b said was absent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  connection_id UUID NOT NULL
    REFERENCES public.restaurant_mcp_connections(id) ON DELETE CASCADE,

  -- SET NULL: the record of what was called must outlive the account that
  -- called it, or the log stops being usable in exactly the situation it exists
  -- for.
  called_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  tool_name VARCHAR(200) NOT NULL,

  -- Copied from the grant at call time, so the log says what the call was
  -- believed to be even if the grant is later reclassified.
  writes BOOLEAN NOT NULL,

  -- TRUE when the caller asserted the seal. Only ever TRUE for a writes call;
  -- see the ADR for what this does and does not prove.
  sealed BOOLEAN NOT NULL DEFAULT FALSE,

  called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 'ok' | 'refused' | 'unreachable' | 'protocol_error' | 'unconfigured' —
  -- the runtime's own five outcomes, not a new vocabulary. No default and no
  -- 'unknown' member: a call with no recorded outcome did not happen.
  outcome TEXT NOT NULL,

  -- One sentence, in the server's words where the server supplied any.
  detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_connection
  ON public.mcp_tool_calls (connection_id, called_at DESC);

COMMENT ON TABLE public.mcp_tool_calls IS
  'Every tool call the gateway dispatched to a model-context server: who, which tool, whether it was classified as a write, whether it arrived sealed, and what came back. Append-only in practice — nothing in the gateway updates or deletes a row (ADR 0114).';

-- ---------------------------------------------------------------------------
-- 6. Lock all three down in the SAME migration that creates them (OD-72/OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_connection_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_connection_consents_service_role
  ON public.mcp_connection_consents;
CREATE POLICY mcp_connection_consents_service_role
  ON public.mcp_connection_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_connection_consents FROM anon, authenticated;

ALTER TABLE public.mcp_tool_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tool_grants_service_role ON public.mcp_tool_grants;
CREATE POLICY mcp_tool_grants_service_role
  ON public.mcp_tool_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_tool_grants FROM anon, authenticated;

ALTER TABLE public.restaurant_personal_grant_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS restaurant_personal_grant_access_service_role
  ON public.restaurant_personal_grant_access;
CREATE POLICY restaurant_personal_grant_access_service_role
  ON public.restaurant_personal_grant_access
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.restaurant_personal_grant_access FROM anon, authenticated;

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_tool_calls_service_role ON public.mcp_tool_calls;
CREATE POLICY mcp_tool_calls_service_role
  ON public.mcp_tool_calls
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_tool_calls FROM anon, authenticated;

-- The rename carried the old table's RLS and grants with it, but ADD COLUMN
-- does not re-grant, and neither does RENAME re-assert. Say it again rather
-- than assume it.
ALTER TABLE public.restaurant_mcp_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.restaurant_mcp_connections FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t        text;
  role_    text;
  priv     text;
  tables   text[] := ARRAY[
    'restaurant_mcp_connections',
    'mcp_connection_consents',
    'mcp_tool_grants',
    'mcp_tool_calls',
    'restaurant_personal_grant_access'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    FOREACH role_ IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(role_, 'public.' || t, priv) THEN
          RAISE EXCEPTION '% is still % -able by %', t, priv, role_;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- The fork is closed only if the column that asserted the other answer is
  -- gone. A migration that added `declared_by` and left `user_id NOT NULL`
  -- would have written the new rule beside the old one and enforced the old.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_mcp_connections'
      AND column_name = 'user_id'
  ) THEN
    RAISE EXCEPTION 'restaurant_mcp_connections still has user_id — the attachment is still a person''s';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'restaurant_mcp_connections'
      AND column_name = 'declared_by'
  ) THEN
    RAISE EXCEPTION 'restaurant_mcp_connections has no declared_by';
  END IF;

  -- Deleting a person must not take the house's attachment with them. Proving
  -- that needs the FK's delete action, which is readable without a row.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = to_regclass('public.restaurant_mcp_connections')
       AND c.contype = 'f'
       AND a.attname = 'declared_by'
       AND c.confdeltype = 'n'          -- 'n' = ON DELETE SET NULL
  ) THEN
    RAISE EXCEPTION 'declared_by is not ON DELETE SET NULL — deleting a manager would delete the house''s servers';
  END IF;

  -- `writes` must have no default. A default is how an unclassified tool
  -- becomes a tool nobody classified.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mcp_tool_grants'
         AND column_name = 'writes') IS NOT NULL THEN
    RAISE EXCEPTION 'mcp_tool_grants.writes has a default — an unclassified tool would be granted as a read';
  END IF;

  -- The house side of a consent must exist, or "a manager may cut the house
  -- off" is a sentence with no column behind it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mcp_connection_consents'
      AND column_name = 'house_revoked_at'
  ) THEN
    RAISE EXCEPTION 'mcp_connection_consents has no house_revoked_at — the house cannot let go of a consent it did not give';
  END IF;

  -- And there must be NO approval state. Approval-gating was refused by name;
  -- a column called anything of the sort would be the refused design arriving
  -- through the back door.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'mcp_connection_consents'
      AND column_name IN ('approved_at', 'approval_status', 'pending', 'pending_at')
  ) THEN
    RAISE EXCEPTION 'mcp_connection_consents grew an approval state — approval-gating was refused (ADR 0114)';
  END IF;

  RAISE NOTICE 'the house declares and a person consents: attachment is restaurant-scoped, consents (both sides) and per-tool grants exist, the house can let go of a personal grant, RLS on, client roles revoked.';
END
$$;
