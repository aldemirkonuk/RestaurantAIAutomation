-- An owner accepts the house's data terms, which is what turns Jev on
-- (ADR 0207, round 4).
--
-- THE FOUNDER, 2026-09-22, round 6y, verbatim, answering who may turn Jev on:
--   "owner only, but also we're going to use this as complete data and
--    privacy usage, they have to accept that, and when they do they'd accept
--    the jev too with their names and sensitive topics redacted"
--
-- Turning Jev on is now an OWNER accepting the house's complete data-and-
-- privacy terms — every place the house's data goes, not a Jev-only notice —
-- and that acceptance INCLUDES Jev. `restaurants.vendor_tone_scoring_enabled`
-- stays the switch (built round 3, DEFAULT false); this migration adds the
-- append-only record of what was accepted, by whom, and against which
-- version, and widens the seal vocabulary so the acceptance is a redeemed
-- seal like an order cancellation or a payment-method change — never a
-- logged assertion for an act this consequential.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS, the seal kind widened
-- by read-and-append (never a hand-typed list — see section 2), no row
-- written, moved or deleted.

SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. The acceptance record — one row per owner per accepted version,
--    append-only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_data_terms_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  terms_version INTEGER NOT NULL,
  terms_digest TEXT NOT NULL,
  terms_snapshot JSONB NOT NULL,
  -- The choice is the house's; the name goes when the person does (the
  -- ask_training_opt_outs pattern) — ON DELETE SET NULL, never CASCADE, so
  -- the acceptance itself outlives the person who gave it.
  accepted_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  accepted_by_role TEXT NOT NULL,
  -- The hold that made it: an acceptance without a redeemed seal is an
  -- assertion, and this act (what leaves for TypeSafe, and under what terms)
  -- is exactly the class ADR 0125/0128/0118 already seal rather than log.
  seal_id UUID NOT NULL REFERENCES public.mcp_seal_challenges(id),
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT house_data_terms_acceptances_version_check
    CHECK (terms_version >= 1),
  CONSTRAINT house_data_terms_acceptances_digest_check
    CHECK (terms_digest ~ '^[a-f0-9]{64}$'),
  CONSTRAINT house_data_terms_acceptances_snapshot_is_object
    CHECK (jsonb_typeof(terms_snapshot) = 'object'),
  -- Owner only (question 13's ruling). A manager accepting is not a smaller
  -- version of this act; it is a different act the founder refused.
  CONSTRAINT house_data_terms_acceptances_role_check
    CHECK (accepted_by_role = 'owner'),
  -- Every owner accepts for themselves (question 19, the founder, 2026-09-22,
  -- round 6z: "Every owner, next sign-in"): a second owner accepting the same
  -- version is a second row, their own; the SAME owner accepting it again is
  -- a no-op. [2026-09-25: was UNIQUE (restaurant_id, terms_version), one row
  -- per house per version, built for the round-4 "accept to turn Jev on" act.]
  CONSTRAINT house_data_terms_acceptances_one_per_owner_per_version
    UNIQUE (restaurant_id, terms_version, accepted_by)
);

CREATE INDEX IF NOT EXISTS idx_house_data_terms_acceptances_house
  ON public.house_data_terms_acceptances (restaurant_id, terms_version DESC);

ALTER TABLE public.house_data_terms_acceptances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_data_terms_acceptances_service_role
  ON public.house_data_terms_acceptances;
-- SELECT and INSERT only — no UPDATE, no DELETE. An acceptance is a record of
-- what was agreed, when; it does not get edited, and withdrawing consent is
-- "turn Jev off" on the existing switch, which leaves this row exactly as it
-- was written (ADR 0207 §A4 "withdrawal is turn Jev off").
CREATE POLICY house_data_terms_acceptances_service_role
  ON public.house_data_terms_acceptances
  FOR SELECT TO service_role USING (true);
DROP POLICY IF EXISTS house_data_terms_acceptances_service_role_insert
  ON public.house_data_terms_acceptances;
CREATE POLICY house_data_terms_acceptances_service_role_insert
  ON public.house_data_terms_acceptances
  FOR INSERT TO service_role WITH CHECK (true);
REVOKE ALL ON public.house_data_terms_acceptances FROM anon, authenticated;
GRANT SELECT, INSERT ON public.house_data_terms_acceptances TO service_role;

COMMENT ON TABLE public.house_data_terms_acceptances IS
  'An owner accepting the house''s complete data-and-privacy terms (ADR 0207 round 4) — which is what turns Jev on. Append-only: SELECT/INSERT to service_role, no UPDATE, no DELETE. One row per (restaurant, terms_version, accepted_by): every owner accepts for themselves (ADR 0207 question 19).';
COMMENT ON COLUMN public.house_data_terms_acceptances.seal_id IS
  'The redeemed mcp_seal_challenges row that proved this was the owner''s own hold-to-accept gesture, bound to this house and this digest.';

-- ---------------------------------------------------------------------------
-- 2. Widen the seal subject-kind CHECK by reading it first (never a
--    hand-typed list — the same read-and-append shape as every other kind
--    joined this constraint, see 20260906200000 for the full rationale).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'house_data_terms';
  rebuilt TEXT;
  written TEXT[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO existing_def
  FROM pg_constraint
  WHERE conrelid = 'public.mcp_seal_challenges'::regclass
    AND conname = 'chk_mcp_seal_challenges_subject_kind';

  IF existing_def IS NULL THEN
    RAISE EXCEPTION
      'chk_mcp_seal_challenges_subject_kind is absent: this migration extends a constraint that must already exist (20260904210000)';
  END IF;

  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO kinds
  FROM regexp_matches(existing_def, '''((?:[^'']|'''')+)''', 'g') AS m;

  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" — refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(kinds) THEN
    RETURN; -- already extended; re-running this file changes nothing
  END IF;

  kinds := kinds || wanted;

  SELECT string_agg(quote_literal(k), ', ' ORDER BY k)
  INTO rebuilt
  FROM unnest(kinds) AS k;

  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind';
  EXECUTE 'ALTER TABLE public.mcp_seal_challenges '
       || 'ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind '
       || format('CHECK (subject_kind IN (%s))', rebuilt);

  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO written
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
  WHERE c.conrelid = 'public.mcp_seal_challenges'::regclass
    AND c.conname = 'chk_mcp_seal_challenges_subject_kind';

  IF written IS NULL OR NOT (written @> kinds AND kinds @> written) THEN
    RAISE EXCEPTION
      'rebuilding the seal subject_kind CHECK did not keep exactly the kinds it read plus %: read %, wrote %',
      wanted, kinds, written;
  END IF;
END
$$;

COMMENT ON COLUMN public.mcp_seal_challenges.subject_kind IS
  'What the seal is a seal ON. Two ids from two tables can collide; the kind is what stops one uuid meaning two things (ADR 0116/0110 addenda). house_data_terms joined 2026-09-22 (ADR 0207 round 4): an owner''s hold-to-accept of the house''s data terms, which is what turns Jev on.';

-- ---------------------------------------------------------------------------
-- 3. Unchanged, re-asserted rather than assumed.
-- ---------------------------------------------------------------------------

ALTER TABLE public.mcp_seal_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mcp_seal_challenges_service_role ON public.mcp_seal_challenges;
CREATE POLICY mcp_seal_challenges_service_role
  ON public.mcp_seal_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.mcp_seal_challenges FROM anon, authenticated;

COMMENT ON COLUMN public.restaurants.vendor_tone_scoring_enabled IS
  'Whether Jev reads this house''s vendor mail (ADR 0207). DEFAULT false. Owner only, and only with the house''s data terms accepted in their CURRENT version (ADR 0207 round 4) — the round-3 comment said owner or manager; superseded by the founder''s round 6y ruling on question 13.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  admitted TEXT[];
  probe_house UUID;
  probe_user UUID;
  probe_seal UUID;
  probe_row UUID;
  rejected BOOLEAN;
BEGIN
  IF to_regclass('public.house_data_terms_acceptances') IS NULL THEN
    RAISE EXCEPTION 'house_data_terms_acceptances does not exist';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = to_regclass('public.house_data_terms_acceptances')) THEN
    RAISE EXCEPTION 'house_data_terms_acceptances has RLS off';
  END IF;
  IF has_table_privilege('anon', 'public.house_data_terms_acceptances', 'SELECT')
     OR has_table_privilege('authenticated', 'public.house_data_terms_acceptances', 'SELECT') THEN
    RAISE EXCEPTION 'house_data_terms_acceptances is readable by anon/authenticated';
  END IF;
  IF has_table_privilege('service_role', 'public.house_data_terms_acceptances', 'UPDATE')
     OR has_table_privilege('service_role', 'public.house_data_terms_acceptances', 'DELETE') THEN
    RAISE EXCEPTION 'house_data_terms_acceptances grants UPDATE/DELETE to service_role — it must be append-only';
  END IF;

  SELECT array_agg(replace(m[1], '''''', '''')) INTO admitted
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
  WHERE c.conrelid = 'public.mcp_seal_challenges'::regclass
    AND c.conname = 'chk_mcp_seal_challenges_subject_kind';
  IF NOT ('house_data_terms' = ANY(admitted)) THEN
    RAISE EXCEPTION 'the seal subject_kind CHECK does not admit house_data_terms';
  END IF;
  IF NOT ('procurement_order' = ANY(admitted) AND 'payment_method' = ANY(admitted)) THEN
    RAISE EXCEPTION 'rebuilding the seal subject_kind CHECK dropped an existing kind';
  END IF;

  SELECT id INTO probe_house FROM public.restaurants LIMIT 1;
  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  IF probe_house IS NOT NULL AND probe_user IS NOT NULL THEN
    INSERT INTO public.mcp_seal_challenges (
      subject_kind, subject_id, restaurant_id, actor_user_id,
      tool_name, args_hash, token_hash, expires_at
    ) VALUES (
      'house_data_terms', probe_house, probe_house, probe_user,
      'accept', 'migration probe', 'migration probe', now() + interval '1 minute'
    ) RETURNING id INTO probe_seal;

    -- The honest half: a real acceptance row is admitted.
    INSERT INTO public.house_data_terms_acceptances (
      restaurant_id, terms_version, terms_digest, terms_snapshot,
      accepted_by, accepted_by_role, seal_id
    ) VALUES (
      probe_house, 1, repeat('a', 64), '{"v":1}'::jsonb,
      probe_user, 'owner', probe_seal
    ) RETURNING id INTO probe_row;

    -- Refusal: the SAME owner accepting the same version twice (question 19:
    -- one row per owner per version, never two).
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_data_terms_acceptances (
        restaurant_id, terms_version, terms_digest, terms_snapshot,
        accepted_by, accepted_by_role, seal_id
      ) VALUES (
        probe_house, 1, repeat('a', 64), '{"v":1}'::jsonb,
        probe_user, 'owner', probe_seal
      );
    EXCEPTION WHEN unique_violation THEN
      rejected := TRUE;
    END;
    DELETE FROM public.house_data_terms_acceptances WHERE id = probe_row;
    DELETE FROM public.mcp_seal_challenges WHERE id = probe_seal;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'one owner accepted one version twice — house_data_terms_acceptances_one_per_owner_per_version is not biting';
    END IF;

    -- Refusal: a manager's acceptance.
    INSERT INTO public.mcp_seal_challenges (
      subject_kind, subject_id, restaurant_id, actor_user_id,
      tool_name, args_hash, token_hash, expires_at
    ) VALUES (
      'house_data_terms', probe_house, probe_house, probe_user,
      'accept', 'migration probe 2', 'migration probe 2', now() + interval '1 minute'
    ) RETURNING id INTO probe_seal;
    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_data_terms_acceptances (
        restaurant_id, terms_version, terms_digest, terms_snapshot,
        accepted_by, accepted_by_role, seal_id
      ) VALUES (
        probe_house, 1, repeat('a', 64), '{"v":1}'::jsonb,
        probe_user, 'manager', probe_seal
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    DELETE FROM public.mcp_seal_challenges WHERE id = probe_seal;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'a manager acceptance was accepted — house_data_terms_acceptances_role_check is not biting';
    END IF;
  END IF;
END
$$;
