-- An owner names who may send to a vendor — the ADR 0112 F12 grant row
-- (founder, 2026-09-05; applied to vendor sends by ADR 0175 D10 and its
-- 2026-09-21 amendment).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- ADR 0112 F12, founder ruling 2 (2026-09-05): *"one man approval if the
-- authority is valid — owner/manager or authorized personnel (owner can give
-- access), otherwise double approval is needed."* The same section defines
-- "authorized personnel" as a first-class grant row with six facts: grantor,
-- grantee, scope, limit, expiry and revoked-at. ADR 0175 D10 (founder,
-- 2026-09-19) applies that rule to every vendor send, and the founder's answer
-- of 2026-09-21 ("Staff ask, manager sends") asks for the row now. Nothing in
-- the corpus stores one: before this file `grantor` and `grantee` occur in no
-- migration except as `information_schema` column names.
--
-- ONE ROW = ONE GRANT, NEVER EDITED IN PLACE
-- ----------------------------------------
-- A grant is issued once and revoked once. There is no UPDATE path for its
-- scope, limit or expiry: an owner who wants a different limit revokes and
-- issues again, so the row a send was made under still says what it allowed at
-- the time. `procurement_conversations.sent_under_grant_id`
-- (20260926140100) points here for exactly that reason.
--
-- WHAT THE COLUMNS REFUSE, AND WHY IN THE DATABASE
-- -----------------------------------------------
-- * grantor <> grantee. F12: "grantor ≠ approver enforced in the database (an
--   owner cannot approve twice through a self-issued grant)". The gateway also
--   refuses it, but the database is the only layer every writer passes.
-- * `scope` is a closed vocabulary. `vendor_send` is the only act a grant
--   covers today; a grant for "everything" is not representable.
-- * A limit states its currency, and a currency without a limit is refused:
--   an amount with no currency is not a limit anyone set (ADR 0117 Q31's rule
--   for money, applied to a ceiling). A NULL limit is NOT "unlimited" to the
--   gate: `decideVendorSend` (organizations/vendor-send-authority.ts) refuses a
--   limitless grant for any act that carries money, so an absent limit covers
--   letters only. That reading is recorded as an open fork in ADR 0175's
--   2026-09-21 amendment, not decided here.
-- * `revoked_by_user_id` without `revoked_at` is refused. The reverse is
--   allowed because the actor column is ON DELETE SET NULL.
-- * `expires_at` NULL means "until revoked". The gateway only accepts that when
--   the owner sends `expiresAt: null` explicitly — a missing field is refused,
--   so no default stands in for the owner's answer (ADR 0116).
--
-- ACTOR COLUMNS POINT AT public.users, NEVER auth.users
-- ----------------------------------------------------
-- The two tables share zero ids in this deployment and the JWT carries
-- `public.users.user_id`; an actor column aimed at `auth.users` 23503s on every
-- write and CI cannot see it because a fresh database has no rows.
-- The grantor and the revoker are ON DELETE SET NULL (who acted is worth
-- keeping, and a deletion flow must not be blocked by it); the gate treats a
-- grant whose grantor is gone as void. The grantee is ON DELETE CASCADE: a
-- grant to nobody authorises nothing.
--
-- LOCKED DOWN IN THE SAME FILE THAT CREATES IT
-- -------------------------------------------
-- RLS on, one service_role policy, anon and authenticated revoked — the house
-- rule `scripts/check_new_tables_are_locked_down.py` enforces. The gateway is
-- the only reader and writer.
--
-- Additive and idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout, and
-- the assertions at the bottom fail the migration rather than letting a
-- partial apply report success. No BEGIN/COMMIT — the CLI wraps each file.

CREATE TABLE IF NOT EXISTS public.authority_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  grantor_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  grantee_user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  limit_amount NUMERIC(12, 2),
  limit_currency VARCHAR(3),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT authority_grants_scope_known CHECK (scope IN ('vendor_send')),
  CONSTRAINT authority_grants_not_self CHECK (grantor_user_id <> grantee_user_id),
  CONSTRAINT authority_grants_limit_is_money CHECK (
    (limit_amount IS NULL) = (limit_currency IS NULL)
  ),
  CONSTRAINT authority_grants_limit_not_negative CHECK (
    limit_amount IS NULL OR limit_amount >= 0
  ),
  CONSTRAINT authority_grants_currency_is_a_code CHECK (
    limit_currency IS NULL OR limit_currency ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT authority_grants_expiry_after_issue CHECK (
    expires_at IS NULL OR expires_at > created_at
  ),
  CONSTRAINT authority_grants_revoker_needs_revocation CHECK (
    revoked_by_user_id IS NULL OR revoked_at IS NOT NULL
  )
);

-- The gate's read: this person's live grants in this house.
CREATE INDEX IF NOT EXISTS idx_authority_grants_grantee_live
  ON public.authority_grants (restaurant_id, grantee_user_id)
  WHERE revoked_at IS NULL;

-- The owners' register: every grant this house has issued, newest first.
CREATE INDEX IF NOT EXISTS idx_authority_grants_house
  ON public.authority_grants (restaurant_id, created_at DESC);

ALTER TABLE public.authority_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_grants_service_role ON public.authority_grants;
CREATE POLICY authority_grants_service_role
  ON public.authority_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.authority_grants FROM anon, authenticated;

COMMENT ON TABLE public.authority_grants IS
  'ADR 0112 F12 "authorized personnel": an owner names a person who may act with one approval. Issued once, revoked once, never edited. scope vendor_send covers every vendor send (ADR 0175 D10). RLS on, service_role only.';
COMMENT ON COLUMN public.authority_grants.limit_amount IS
  'The largest single act, in limit_currency, this grant covers. NULL = the owner named no money limit, which the gate reads as covering acts that carry no amount (letters) and refusing any act that carries one (confirm-deal). Not "unlimited".';
COMMENT ON COLUMN public.authority_grants.expires_at IS
  'Enforced at check time. NULL = until revoked, and only ever written when the owner said so explicitly.';
COMMENT ON COLUMN public.authority_grants.grantor_user_id IS
  'The owner who issued it. NULL only after that person was deleted; the gate then treats the grant as void.';

-- ---------------------------------------------------------------------------
-- Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent text;
  c text;
  wanted text[] := ARRAY[
    'id', 'restaurant_id', 'grantor_user_id', 'grantee_user_id', 'scope',
    'limit_amount', 'limit_currency', 'expires_at', 'created_at',
    'revoked_at', 'revoked_by_user_id'
  ];
  fk_target text;
BEGIN
  IF to_regclass('public.authority_grants') IS NULL THEN
    RAISE EXCEPTION 'authority_grants was not created';
  END IF;

  FOREACH c IN ARRAY wanted LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'authority_grants'
        AND column_name = c
    ) THEN
      absent := concat_ws(', ', absent, c);
    END IF;
  END LOOP;
  IF absent IS NOT NULL THEN
    RAISE EXCEPTION 'authority_grants is missing columns the gateway reads: %', absent;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.authority_grants')) THEN
    RAISE EXCEPTION 'authority_grants has RLS off';
  END IF;

  IF has_table_privilege('anon', 'public.authority_grants', 'SELECT')
     OR has_table_privilege('anon', 'public.authority_grants', 'INSERT')
     OR has_table_privilege('anon', 'public.authority_grants', 'UPDATE')
     OR has_table_privilege('anon', 'public.authority_grants', 'DELETE')
     OR has_table_privilege('authenticated', 'public.authority_grants', 'SELECT')
     OR has_table_privilege('authenticated', 'public.authority_grants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.authority_grants', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.authority_grants', 'DELETE')
  THEN
    RAISE EXCEPTION 'authority_grants is still reachable by anon/authenticated';
  END IF;

  -- Every actor column must reference public.users(user_id). Read from the
  -- catalogue rather than trusted from the DDL above, because a re-run that
  -- finds the relation already present keeps THAT relation's keys.
  FOREACH c IN ARRAY ARRAY['grantor_user_id', 'grantee_user_id', 'revoked_by_user_id'] LOOP
    SELECT ccu.table_schema || '.' || ccu.table_name || '.' || ccu.column_name
      INTO fk_target
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = kcu.constraint_name
       AND rc.constraint_schema = kcu.constraint_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = rc.unique_constraint_name
       AND ccu.constraint_schema = rc.unique_constraint_schema
     WHERE kcu.table_schema = 'public'
       AND kcu.table_name = 'authority_grants'
       AND kcu.column_name = c
     LIMIT 1;
    IF fk_target IS DISTINCT FROM 'public.users.user_id' THEN
      RAISE EXCEPTION 'authority_grants.% must reference public.users(user_id), found %', c, coalesce(fk_target, 'no foreign key');
    END IF;
  END LOOP;

  -- The self-grant refusal must be a live constraint, not a comment.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'authority_grants_not_self'
       AND conrelid = to_regclass('public.authority_grants')
  ) THEN
    RAISE EXCEPTION 'authority_grants_not_self is missing: an owner could grant themself';
  END IF;

  RAISE NOTICE 'authority_grants: created, locked down, actor keys on public.users, self-grant refused.';
END
$$;
