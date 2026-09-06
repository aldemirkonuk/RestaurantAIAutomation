-- The server declares, the manager confirms, a change costs a re-consent.
-- (Founder, 2026-09-04; ADR 0107 status addendum. Additive to
--  20260903151000_the_house_declares_a_person_consents.sql.)
--
-- WHAT WAS MISSING
-- ----------------
-- 20260903151000 gave `mcp_tool_grants.writes` no default, with the comment:
-- "Whether a tool commits the house is the granting manager's judgement; a
-- default would let an unclassified tool be treated as a read." That was right
-- and it was half the answer. It left the manager classifying from nothing: the
-- server had already said something about the tool — the MCP spec's
-- `annotations.readOnlyHint` / `destructiveHint` — and the row did not record
-- it. So a grant could not be checked against the server's own words, and a
-- server that CHANGED those words changed nothing on our side. The tool a
-- manager approved as a read on Tuesday could be a write on Wednesday and the
-- gate would never have known.
--
-- The founder's rule closes it in three parts, and this file is the storage for
-- all three:
--
--   1. SERVER-DECLARED. `declared_read` and `declared_annotations` record what
--      the server said about THIS tool at grant time; `tool_list_hash` records
--      what its whole list looked like the same moment.
--   2. MANAGER-CONFIRMED. `classification_source` says whether `writes` is the
--      server's default or a manager's tightening of it. The CHECK below makes
--      the loosening direction unrepresentable, rather than merely unwritten:
--      a row can only claim `writes = FALSE` when the server itself declared
--      the tool read-only.
--   3. RE-CONSENT ON CHANGE. `needs_reconsent_at` / `needs_reconsent_reason`
--      suspend a grant whose declaration has moved. The gateway refuses a
--      suspended grant by name, quoting the reason; only a manager granting it
--      again — against the CURRENT declaration — clears it.
--
-- WHY AN UNKNOWN COUNTS AS A WRITE
-- --------------------------------
-- `readOnlyHint` defaults to false and `destructiveHint` to true in the
-- protocol's own schema (schema/2025-06-18/schema.ts:881-923), and the same
-- spec section requires clients to treat annotations as untrusted. So silence
-- is not evidence of safety, and `declared_read IS NULL` — never probed, no
-- annotations, or annotations without the hint — sits on the write side of the
-- CHECK with everything else that was not affirmed.
--
-- Idempotent: every ADD is `IF NOT EXISTS`, the constraint is dropped before it
-- is added, and the backfill only touches rows that have not been converted.
-- RLS is UNCHANGED — this file adds columns to a table that is already
-- service_role-only, and re-asserts the revoke rather than assuming it.

-- ---------------------------------------------------------------------------
-- 1. What the server declared, and what the whole list looked like.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_tool_grants
  -- Tri-state on purpose. TRUE = the server declared readOnlyHint: true.
  -- FALSE = it declared something else. NULL = it declared nothing, or was
  -- never probed. Only TRUE is permission to grant this as a read.
  ADD COLUMN IF NOT EXISTS declared_read BOOLEAN,

  -- The four hints, verbatim, as the server sent them. Kept so the register can
  -- show the server's own words and so a later change can be described in them
  -- rather than as a hash mismatch.
  ADD COLUMN IF NOT EXISTS declared_annotations JSONB,

  -- sha256 of (lowercased name + the four hints), truncated. What "this tool's
  -- declaration changed" is measured against.
  ADD COLUMN IF NOT EXISTS tool_fingerprint TEXT,

  -- sha256 of every tool's fingerprint, sorted. The audit fact: what this
  -- server offered at the moment this grant was made. NOT what the gate
  -- compares — a server adding an unrelated tool must not suspend a grant
  -- nobody touched.
  ADD COLUMN IF NOT EXISTS tool_list_hash TEXT,

  -- 'declared' — the manager accepted the server's default.
  -- 'manager_override' — the server declared a read and the manager made it a
  -- write. There is no third value, because the other direction is refused.
  -- The actor is `granted_by` and the moment is `granted_at`: an override is
  -- not a separate event from the grant that carries it.
  ADD COLUMN IF NOT EXISTS classification_source TEXT NOT NULL DEFAULT 'declared',

  -- Set when the server's declaration has moved since the grant. A grant with
  -- this set is refused at the gate until a manager grants it again.
  ADD COLUMN IF NOT EXISTS needs_reconsent_at TIMESTAMPTZ,

  -- In words, and never null when the timestamp is set: "needs re-consent"
  -- with no statement of what changed is a demand nobody can act on.
  ADD COLUMN IF NOT EXISTS needs_reconsent_reason TEXT;

COMMENT ON COLUMN public.mcp_tool_grants.declared_read IS
  'What the SERVER said: TRUE only when tools/list carried annotations.readOnlyHint = true. FALSE when it declared otherwise, NULL when it declared nothing or was never probed. Only TRUE permits writes = FALSE (see chk_mcp_tool_grants_no_downgrade).';

COMMENT ON COLUMN public.mcp_tool_grants.classification_source IS
  '''declared'' = the manager accepted the server''s own classification. ''manager_override'' = the server declared the tool read-only and the manager granted it as a write anyway. The reverse override does not exist and is refused by CHECK.';

COMMENT ON COLUMN public.mcp_tool_grants.needs_reconsent_reason IS
  'What changed, in words, e.g. "the server changed readOnlyHint true to false". The gate quotes this in its refusal, so a hash mismatch is never what a manager is asked to consent to.';

-- ---------------------------------------------------------------------------
-- 2. Grants made before any of this was recorded.
--
-- They were classified by a manager against no declaration at all, which is the
-- state this migration exists to end. Two things happen to them, both in the
-- safe direction and both stated rather than silent:
--
--   * a `writes = FALSE` grant becomes `writes = TRUE`. It has to: the CHECK
--     below refuses `FALSE` without an affirmed `declared_read`, and widening
--     an unverified read into a write is the only direction that cannot lose
--     money. It is not a silent widening — the row is suspended in the same
--     statement and the reason says exactly this.
--   * every such grant is marked `needs_reconsent`, so the gate refuses it and
--     a manager re-grants it against the server's real declaration.
--
-- `20260903151000` has not reached production (it is unmerged as this is
-- written), so this backfill is expected to touch zero rows there. It is
-- written for correctness, not for an expected population, and it does not
-- report how many it touched as a success — the assertion block below proves
-- the end state instead.
-- ---------------------------------------------------------------------------

UPDATE public.mcp_tool_grants
   SET writes = TRUE,
       needs_reconsent_at = NOW(),
       needs_reconsent_reason =
         'This tool was granted before the server''s own declaration was recorded, so nothing is known about what the server says it does. It is treated as a write and suspended until a manager grants it again against the current tool list.'
 WHERE revoked_at IS NULL
   AND tool_fingerprint IS NULL
   AND needs_reconsent_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Make the loosening direction unrepresentable.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_tool_grants
  DROP CONSTRAINT IF EXISTS chk_mcp_tool_grants_no_downgrade;

ALTER TABLE public.mcp_tool_grants
  ADD CONSTRAINT chk_mcp_tool_grants_no_downgrade
  CHECK (writes = TRUE OR declared_read IS TRUE);

COMMENT ON CONSTRAINT chk_mcp_tool_grants_no_downgrade ON public.mcp_tool_grants IS
  'A grant may only say "this is a read" when the server itself declared it read-only. Everything else — a declared write, an absent hint, an unprobed server — is a write. This is the founder''s rule of 2026-09-04 as a constraint rather than as a code path that could be forgotten at one call site.';

ALTER TABLE public.mcp_tool_grants
  DROP CONSTRAINT IF EXISTS chk_mcp_tool_grants_source;

ALTER TABLE public.mcp_tool_grants
  ADD CONSTRAINT chk_mcp_tool_grants_source
  CHECK (classification_source IN ('declared', 'manager_override'));

-- A suspension with no stated cause is a dead end for whoever has to clear it.
ALTER TABLE public.mcp_tool_grants
  DROP CONSTRAINT IF EXISTS chk_mcp_tool_grants_reconsent_reason;

ALTER TABLE public.mcp_tool_grants
  ADD CONSTRAINT chk_mcp_tool_grants_reconsent_reason
  CHECK (
    (needs_reconsent_at IS NULL AND needs_reconsent_reason IS NULL)
    OR (needs_reconsent_at IS NOT NULL AND btrim(coalesce(needs_reconsent_reason, '')) <> '')
  );

CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_reconsent
  ON public.mcp_tool_grants (connection_id)
  WHERE revoked_at IS NULL AND needs_reconsent_at IS NOT NULL;

-- RLS was set by 20260903151000 and ADD COLUMN does not re-grant. Say it again
-- rather than assume it.
ALTER TABLE public.mcp_tool_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_tool_grants FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  role_ text;
  priv  text;
  col   text;
  bad   int;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'declared_read', 'declared_annotations', 'tool_fingerprint',
    'tool_list_hash', 'classification_source',
    'needs_reconsent_at', 'needs_reconsent_reason'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mcp_tool_grants'
         AND column_name = col
    ) THEN
      RAISE EXCEPTION 'mcp_tool_grants.% was not added', col;
    END IF;
  END LOOP;

  -- The rule itself. Not "the constraint exists" — that a constraint is
  -- present says nothing about whether it holds over the rows that are there.
  SELECT count(*) INTO bad
    FROM public.mcp_tool_grants
   WHERE writes = FALSE AND declared_read IS NOT TRUE;
  IF bad > 0 THEN
    RAISE EXCEPTION
      '% grant(s) claim to be reads without the server declaring them read-only', bad;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.mcp_tool_grants')
       AND conname = 'chk_mcp_tool_grants_no_downgrade'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'chk_mcp_tool_grants_no_downgrade is missing or NOT VALID — a declared write could still be granted as a read';
  END IF;

  -- `writes` must STILL have no default. This migration adds defaults to a
  -- neighbouring column, and the earlier file's guarantee has to survive it.
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mcp_tool_grants'
         AND column_name = 'writes') IS NOT NULL THEN
    RAISE EXCEPTION 'mcp_tool_grants.writes grew a default';
  END IF;

  -- No suspension without a stated cause.
  SELECT count(*) INTO bad
    FROM public.mcp_tool_grants
   WHERE needs_reconsent_at IS NOT NULL
     AND btrim(coalesce(needs_reconsent_reason, '')) = '';
  IF bad > 0 THEN
    RAISE EXCEPTION '% grant(s) need re-consent with no reason recorded', bad;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.mcp_tool_grants')) THEN
    RAISE EXCEPTION 'mcp_tool_grants has RLS off';
  END IF;
  FOREACH role_ IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(role_, 'public.mcp_tool_grants', priv) THEN
        RAISE EXCEPTION 'mcp_tool_grants is still %-able by %', priv, role_;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'the server declares and the manager confirms: the declaration is stored per grant, a read requires an affirmed readOnlyHint, and a changed declaration has somewhere to say so.';
END
$$;
