-- A seal names WHAT it is for. (Founder, 2026-09-04; ADR 0116 addendum and
-- ADR 0110 addendum. Additive to 20260904170000, which is NOT edited.)
--
-- WHAT 170000 BUILT, AND WHAT IT ASSUMED
-- --------------------------------------
-- `mcp_seal_challenges` bound a challenge to (actor, CONNECTION, tool,
-- args_hash), because the only thing behind the seal was an MCP tool write.
-- The founder then extended challenge-and-redeem to ORDER APPROVAL and to
-- PAYMENT-METHOD writes, and neither has a connection. Left as it was, the only
-- ways to seal an order would have been to invent a fake connection row or to
-- build a second challenge table — and two tables of one-time seals is two
-- implementations of "exactly once", which is the property that has to be
-- singular or it is nothing.
--
-- SO THE BINDING IS RESTATED ONE LEVEL UP:
--
--     (actor, SUBJECT KIND, SUBJECT ID, action, args_hash)
--
-- `connection_id` becomes the subject of the `mcp_tool` kind rather than the
-- shape of the table. Existing rows are backfilled to exactly that, which is
-- what they already were.
--
-- WHY subject_kind AND NOT JUST subject_id
-- ----------------------------------------
-- Two uuids from two tables can be equal. Without the kind, a seal minted for a
-- payment method whose id happened to match an order id would redeem against
-- the order. That is vanishingly unlikely and completely unacceptable: the
-- point of this table is that the answer is never "probably fine".
--
-- WHY restaurant_id
-- -----------------
-- The refusal is filed against a house, and a seal that could not name its
-- house would be filed against none. It is nullable ONLY because the rows that
-- exist predate it and backfilling a house onto them would be inventing one.
--
-- RLS IS UNCHANGED. 170000 turned it on, wrote the service_role policy and
-- revoked anon/authenticated. Adding columns does not alter any of that, and
-- this file re-asserts all of it below rather than assuming it.
--
-- Idempotent throughout: every ADD is IF NOT EXISTS, every constraint is
-- dropped before it is created, and the backfill only names rows not yet
-- labelled.

-- ---------------------------------------------------------------------------
-- 1. The subject.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_seal_challenges
  ADD COLUMN IF NOT EXISTS subject_kind TEXT,
  ADD COLUMN IF NOT EXISTS subject_id   UUID,
  ADD COLUMN IF NOT EXISTS restaurant_id UUID
    REFERENCES public.restaurants(id) ON DELETE CASCADE;

-- THE ONE WRITER THAT PREDATES THE COLUMN
-- ---------------------------------------
-- `McpConnectionsService.issueSealChallenge` inserts (connection_id, tool_name,
-- args_hash, token_hash, expires_at) and nothing else. It is deliberately not
-- being edited in this pass, and making subject_kind NOT NULL without this
-- would have made every MCP seal fail to issue — the gate would then refuse
-- every tool write, which reads as "the seal is broken" rather than as "a
-- migration widened a table". So the default is derived rather than assumed:
-- an insert that names a connection and no subject IS an mcp_tool seal on that
-- connection, and this says so in the one place both writers pass through.
--
-- This trigger is a SHIM with a retirement condition, stated so it cannot
-- quietly become architecture: delete it when mcp-connections is collapsed onto
-- `common/seal/seal-challenge.service.ts` and names its own subject.
CREATE OR REPLACE FUNCTION public.mcp_seal_challenges_default_subject()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.subject_kind IS NULL AND NEW.connection_id IS NOT NULL THEN
    NEW.subject_kind := 'mcp_tool';
  END IF;
  IF NEW.subject_id IS NULL AND NEW.subject_kind = 'mcp_tool' THEN
    NEW.subject_id := NEW.connection_id;
  END IF;
  -- No `ELSE` that invents a subject. A row that still names nothing hits the
  -- NOT NULL and fails loudly, which is the correct outcome: a seal whose
  -- subject had to be guessed is a seal that approves whatever asks first.
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_mcp_seal_challenges_default_subject
  ON public.mcp_seal_challenges;
CREATE TRIGGER trg_mcp_seal_challenges_default_subject
  BEFORE INSERT ON public.mcp_seal_challenges
  FOR EACH ROW EXECUTE FUNCTION public.mcp_seal_challenges_default_subject();

-- The rows that exist are all MCP tool seals, and their subject is the
-- connection they already name. Literally true; touched once.
UPDATE public.mcp_seal_challenges
   SET subject_kind = 'mcp_tool'
 WHERE subject_kind IS NULL;

UPDATE public.mcp_seal_challenges
   SET subject_id = connection_id
 WHERE subject_id IS NULL AND connection_id IS NOT NULL;

ALTER TABLE public.mcp_seal_challenges
  ALTER COLUMN subject_kind SET NOT NULL,
  ALTER COLUMN subject_id   SET NOT NULL;

-- An order and a payment method have no connection, so the old NOT NULL has to
-- go — but only for them. The CHECK below is what keeps `mcp_tool` honest.
ALTER TABLE public.mcp_seal_challenges
  ALTER COLUMN connection_id DROP NOT NULL;

ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT IF EXISTS chk_mcp_seal_challenges_subject_kind;

ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind
  -- Kept in step with `common/seal/seal-subject.ts`'s SEAL_SUBJECT_KINDS by
  -- hand, deliberately: a CHECK that rejects a kind the code declares is a
  -- guaranteed production failure, and a CHECK generated from the code would
  -- accept whatever the code says including a typo. `mcp_tool_grant` is the
  -- seal on GRANTING a tool as a write (as opposed to CALLING one); like the
  -- order and payment kinds it carries no connection_id and names the
  -- connection in subject_id.
  CHECK (subject_kind IN ('mcp_tool', 'mcp_tool_grant', 'procurement_order', 'payment_method'));

-- An `mcp_tool` seal must still name its connection, and its subject must BE
-- that connection. Dropping the NOT NULL without this would have quietly made
-- the MCP path weaker than it was before the generalisation — a widening done
-- by a migration, which is the thing 170000's header warned about.
ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT IF EXISTS chk_mcp_seal_challenges_tool_names_connection;

ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_tool_names_connection
  CHECK (
    subject_kind <> 'mcp_tool'
    OR (connection_id IS NOT NULL AND subject_id = connection_id)
  );

-- And the converse: a seal that is NOT an MCP tool seal must not carry a
-- connection, so a stray connection can never be read as scope.
ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT IF EXISTS chk_mcp_seal_challenges_non_tool_has_no_connection;

ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_non_tool_has_no_connection
  CHECK (subject_kind = 'mcp_tool' OR connection_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_mcp_seal_challenges_subject_open
  ON public.mcp_seal_challenges (subject_kind, subject_id, actor_user_id)
  WHERE redeemed_at IS NULL;

COMMENT ON COLUMN public.mcp_seal_challenges.subject_kind IS
  'What the seal is a seal ON: mcp_tool | procurement_order | payment_method. Two ids from two tables can collide; the kind is what stops one uuid meaning two things (ADR 0116/0110 addenda, 2026-09-04).';

COMMENT ON COLUMN public.mcp_seal_challenges.subject_id IS
  'The one thing sealed: this connection, this order, this instrument. For mcp_tool it equals connection_id, enforced by chk_mcp_seal_challenges_tool_names_connection.';

COMMENT ON COLUMN public.mcp_seal_challenges.tool_name IS
  'The ACT the seal approves — an MCP tool name, or "approve" on an order, or "set_default"/"remove"/"create" on a payment method. Named tool_name because 170000 named it that and renaming an applied column buys nothing.';

COMMENT ON COLUMN public.mcp_seal_challenges.restaurant_id IS
  'The house the refusal is filed against. Nullable only because the rows that predate this column have no house to name and inventing one would be a fabricated record.';

-- ---------------------------------------------------------------------------
-- 2. Unchanged, and re-asserted rather than assumed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_seal_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_seal_challenges_service_role ON public.mcp_seal_challenges;
CREATE POLICY mcp_seal_challenges_service_role
  ON public.mcp_seal_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_seal_challenges FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  role_ text;
  priv  text;
  bad   int;
BEGIN
  IF to_regclass('public.mcp_seal_challenges') IS NULL THEN
    RAISE EXCEPTION 'mcp_seal_challenges does not exist';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.mcp_seal_challenges')) THEN
    RAISE EXCEPTION 'mcp_seal_challenges has RLS off';
  END IF;

  FOREACH role_ IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(role_, 'public.mcp_seal_challenges', priv) THEN
        RAISE EXCEPTION 'mcp_seal_challenges is still %-able by %', priv, role_;
      END IF;
    END LOOP;
  END LOOP;

  -- The token must still not be storable.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mcp_seal_challenges'
       AND column_name IN ('token', 'token_plain', 'secret')
  ) THEN
    RAISE EXCEPTION 'mcp_seal_challenges grew a column that could hold the token itself';
  END IF;

  -- Single use must still be enforceable.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'mcp_seal_challenges'
       AND indexname = 'uq_mcp_seal_challenges_token'
  ) THEN
    RAISE EXCEPTION 'a token hash is not unique — a challenge could be reissued and spent twice';
  END IF;

  -- Expiry must still be stated by the issuer.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mcp_seal_challenges'
         AND column_name = 'expires_at') IS NOT NULL THEN
    RAISE EXCEPTION 'expires_at has a default — how long a seal lives would be decided twice';
  END IF;

  -- The subject must be mandatory. A nullable subject_kind would make an
  -- unlabelled seal redeemable against whatever asked for it first.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mcp_seal_challenges'
       AND column_name IN ('subject_kind', 'subject_id')
       AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'a seal may not be issued without naming what it is for';
  END IF;

  -- And no row may be left unlabelled.
  SELECT count(*) INTO bad
    FROM public.mcp_seal_challenges
   WHERE subject_kind IS NULL OR subject_id IS NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% seal challenge(s) name no subject', bad;
  END IF;

  -- An mcp_tool seal must still be a connection seal.
  SELECT count(*) INTO bad
    FROM public.mcp_seal_challenges
   WHERE subject_kind = 'mcp_tool'
     AND (connection_id IS NULL OR subject_id <> connection_id);
  IF bad > 0 THEN
    RAISE EXCEPTION '% mcp_tool seal(s) no longer name their connection', bad;
  END IF;

  -- The shim that keeps the untouched MCP writer working must actually exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = to_regclass('public.mcp_seal_challenges')
       AND tgname = 'trg_mcp_seal_challenges_default_subject'
  ) THEN
    RAISE EXCEPTION 'the subject-defaulting trigger is missing — every MCP seal would fail to issue';
  END IF;

  RAISE NOTICE 'a seal names what it is for: (actor, subject kind, subject id, act, args hash), single-use, issuer-stated expiry, and the MCP case is an instance of the rule rather than the shape of it.';
END
$$;
