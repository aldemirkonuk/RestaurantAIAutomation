-- Granting a tool is a sealed act too, and it names its own subject kind.
-- (Founder, 2026-09-04; ADR 0107 addendum. Additive to 20260904210000.)
--
-- WHAT WAS WRONG
-- --------------
-- 20260904160000 made a changed declaration SUSPEND a grant, and the re-consent
-- that lifts the suspension was gated on a `sealed: true` field in the same
-- request that asked for it. That is precisely the assertion-in-its-own-request
-- flaw ADR 0114 named and 20260904170000 closed for the CALL — reintroduced,
-- one route over, for the act that turns a refused call back on. The client set
-- the flag; nothing checked anything.
--
-- So a grant is redeemed like a call. 20260904210000 generalised the challenge
-- to (actor, subject kind, subject id, action, args hash) and listed three
-- kinds; this adds the fourth.
--
--   subject_kind  'mcp_tool_grant'
--   subject_id    the CONNECTION. Note the asymmetry with 'mcp_tool', which is
--                 required to carry connection_id as well: 210000's
--                 chk_mcp_seal_challenges_non_tool_has_no_connection forbids a
--                 connection column on any other kind, so a grant seal names
--                 the connection in subject_id ALONE. That constraint is left
--                 exactly as it is — widening it to admit a second kind would
--                 have loosened a rule written to stop a stray connection
--                 being read as scope.
--   tool_name     the act: 'grant:<tool>'. Granting `place_order` and granting
--                 `list_checks` are two approvals, not one.
--   args_hash     over { toolName, toolListHash } — the tool list the manager
--                 was looking at when the hold began. A seal held over one
--                 declaration cannot be spent after the server changed it,
--                 which is the whole point of the suspension it lifts.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
-- It does not collapse `McpConnectionsService.redeemSeal` (the CALL path) onto
-- `common/seal/seal-challenge.service.ts`. That path files its refusals in
-- `mcp_tool_calls` rather than `system_audit_log`, and merging the two logs is
-- a decision about where an MCP refusal is read, not a migration. The GRANT
-- path added alongside it uses the shared service, so the duplication does not
-- grow. Both are named in the report so the two can be reconciled in one pass.
--
-- Idempotent: the constraint is dropped before it is added, and nothing else
-- is touched. RLS is unchanged and re-asserted rather than assumed.

ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT IF EXISTS chk_mcp_seal_challenges_subject_kind;

ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind
  CHECK (subject_kind IN (
    'mcp_tool',
    'mcp_tool_grant',
    'procurement_order',
    'payment_method'
  ));

COMMENT ON COLUMN public.mcp_seal_challenges.subject_kind IS
  'What the seal is a seal ON: mcp_tool | mcp_tool_grant | procurement_order | payment_method. Two ids from two tables can collide; the kind is what stops one uuid meaning two things. mcp_tool_grant seals the act of GRANTING a tool as a write (or re-consenting to one whose declaration moved) and names its connection in subject_id alone, since a non-tool kind may not carry connection_id.';

ALTER TABLE public.mcp_seal_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_seal_challenges FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  role_ text;
  priv  text;
  ok    boolean;
BEGIN
  -- The new kind must be accepted...
  BEGIN
    PERFORM 1 WHERE 'mcp_tool_grant' IN (
      SELECT unnest(ARRAY['mcp_tool', 'mcp_tool_grant', 'procurement_order', 'payment_method'])
    );
  END;

  SELECT pg_get_constraintdef(oid) LIKE '%mcp_tool_grant%' INTO ok
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.mcp_seal_challenges')
     AND conname = 'chk_mcp_seal_challenges_subject_kind';
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'the subject-kind CHECK does not admit mcp_tool_grant — every grant seal would fail to issue';
  END IF;

  -- ...and the two rules 210000 wrote must still hold, because this file
  -- rewrote the constraint standing beside them.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.mcp_seal_challenges')
       AND conname = 'chk_mcp_seal_challenges_tool_names_connection'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'an mcp_tool seal no longer has to name its connection';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.mcp_seal_challenges')
       AND conname = 'chk_mcp_seal_challenges_non_tool_has_no_connection'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'a non-tool seal may now carry a connection — a stray connection could be read as scope';
  END IF;

  -- No row may have been left behind by the rewrite.
  IF EXISTS (
    SELECT 1 FROM public.mcp_seal_challenges
     WHERE subject_kind NOT IN ('mcp_tool', 'mcp_tool_grant', 'procurement_order', 'payment_method')
  ) THEN
    RAISE EXCEPTION 'a seal names a subject kind nothing recognises';
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

  RAISE NOTICE 'a grant is sealed like a call: mcp_tool_grant is an accepted subject kind, and the two rules that keep a connection honest are untouched.';
END
$$;
