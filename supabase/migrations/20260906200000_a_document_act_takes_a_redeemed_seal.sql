-- A document act takes a redeemed seal. (Founder, 2026-09-06, batch 64.
-- Additive to 20260904170000/20260904210000, neither of which is edited.)
--
-- THE DECISION
-- ------------
-- Asked whether procurement's three write routes should be sealed, the founder
-- answered: "Decide as a module: seal all three" — the option read "One policy
-- for the corridor: verify, line edit and currency restatement each take a
-- redeemed seal like the payment and register acts do. Its own pass; the
-- receiving flow gains one ceremony per act."
--
-- So `mcp_seal_challenges` gains ONE new subject kind, `procurement_document`,
-- carrying three acts in `tool_name`: `verify`, `line_edit`, `currency_restate`.
-- The subject is the DOCUMENT for all three; the line a correction touches is
-- named in `args_hash` rather than in `subject_id`, because two tables' uuids
-- under one kind is precisely the collision `subject_kind` exists to stop.
--
-- WHY THE CHECK IS WIDENED BY READ-AND-APPEND
-- -------------------------------------------
-- Several passes are adding kinds to this one constraint on the same day, and a
-- migration that DROPPED the CHECK and re-created it from a hand-typed list
-- would silently delete every kind a peer added between the moment its list was
-- typed and the moment it runs. Every such deletion is a production failure that
-- looks like a code bug: the gateway declares a kind the database refuses.
--
-- So this file READS the kinds the constraint currently admits, adds exactly
-- one, and writes the union back. It cannot drop a peer's kind, and it RAISES
-- rather than guessing if it cannot read the existing constraint. Same shape as
-- 20260905225000 and 20260905233000, deliberately, with one difference since
-- 2026-09-11: those two (and 20260906070000) read the kinds with the character
-- class [a-z_], which silently drops a kind holding a digit or a capital; this
-- file reads every quoted literal, and then checks that the rebuilt constraint
-- holds exactly the kinds it read plus its own (section 1).
--
-- NOTHING ELSE ABOUT THE TABLE CHANGES. `procurement_document` is a non-`mcp_tool`
-- kind, so `chk_mcp_seal_challenges_non_tool_has_no_connection` already forbids
-- it a `connection_id` and `chk_mcp_seal_challenges_tool_names_connection`
-- already exempts it. RLS, the service_role policy and the anon/authenticated
-- revoke are re-asserted below rather than assumed.

-- ---------------------------------------------------------------------------
-- 1. Widen the subject-kind CHECK by reading it first.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'procurement_document';
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

  -- EVERY QUOTED LITERAL, not a character class (2026-09-11, audit of
  -- b6d2e4b4). This read '''([a-z_]+)''', which silently DROPPED any existing
  -- kind whose name holds a digit or a capital: the parse skipped it, the union
  -- was written back without it, and the floor below could not notice because
  -- the other kinds were read. `pg_get_constraintdef` renders the CHECK as
  -- `ARRAY['kind'::text, ...]`, whose only quoted literals are the kinds, so
  -- every literal is taken whole and a doubled quote inside one is unescaped.
  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO kinds
  FROM regexp_matches(existing_def, '''((?:[^'']|'''')+)''', 'g') AS m;

  -- Four kinds existed on 2026-09-04 before any of this week's work; reading
  -- fewer than four means the parse failed, and rewriting a constraint from a
  -- failed parse would delete the seal's entire vocabulary.
  IF kinds IS NULL OR array_length(kinds, 1) < 4 THEN
    RAISE EXCEPTION
      'could not read the admitted seal kinds out of "%" — refusing to rewrite a constraint this migration cannot read',
      existing_def;
  END IF;

  IF wanted = ANY(kinds) THEN
    RETURN;  -- already extended; re-running this file changes nothing
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

  -- PROVE the union rather than trust it: read the rebuilt constraint back
  -- with the same parse and refuse unless it holds exactly the kinds read plus
  -- the one added. The PGlite probe proves the parse itself by INSERTING a row
  -- of every older kind, which no comparison of constraint text can do.
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
END $$;

COMMENT ON COLUMN public.mcp_seal_challenges.subject_kind IS
  'What the seal is a seal ON. Two ids from two tables can collide; the kind is what stops one uuid meaning two things (ADR 0116/0110 addenda). procurement_document joined 2026-09-06: the receiving corridor''s three write acts, sealed as a module by the founder''s decision.';

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
  role_ TEXT;
  priv  TEXT;
  admitted TEXT[];
  probe_restaurant UUID;
  probe_user UUID;
  probe_challenge UUID;
  rejected BOOLEAN;
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

  SELECT array_agg(replace(m[1], '''''', '''')) INTO admitted
  FROM pg_constraint c,
       LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''((?:[^'']|'''')+)''', 'g') AS m
  WHERE c.conrelid = 'public.mcp_seal_challenges'::regclass
    AND c.conname = 'chk_mcp_seal_challenges_subject_kind';

  IF NOT ('procurement_document' = ANY(admitted)) THEN
    RAISE EXCEPTION
      'the seal subject_kind CHECK does not admit procurement_document; the gateway declares a kind the database refuses';
  END IF;

  -- The second half is the point of section 1: a rebuild that dropped a peer's
  -- kind would pass the first check alone. These four are the kinds that
  -- predate every one of this week's passes.
  FOREACH role_ IN ARRAY ARRAY['mcp_tool', 'mcp_tool_grant',
                               'procurement_order', 'payment_method'] LOOP
    IF NOT (role_ = ANY(admitted)) THEN
      RAISE EXCEPTION
        'rebuilding the seal subject_kind CHECK dropped % — the union in section 1 is broken',
        role_;
    END IF;
  END LOOP;

  -- PROVE the pre-existing constraints still bite for the new kind, rather than
  -- asserting they exist: a document seal must never carry a connection.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  SELECT user_id INTO probe_user FROM public.users LIMIT 1;
  IF probe_restaurant IS NOT NULL AND probe_user IS NOT NULL THEN
    rejected := FALSE;
    probe_challenge := NULL;
    BEGIN
      INSERT INTO public.mcp_seal_challenges (
        subject_kind, subject_id, restaurant_id, actor_user_id, connection_id,
        tool_name, args_hash, token_hash, expires_at
      ) VALUES (
        'procurement_document', gen_random_uuid(), probe_restaurant, probe_user,
        gen_random_uuid(),
        'verify', 'migration probe', 'migration probe', now() + interval '1 minute'
      )
      RETURNING id INTO probe_challenge;
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      -- Scoped by the id the INSERT itself just returned, never by
      -- args_hash: a magic string is not a key, and this table is real and
      -- live -- it would delete any genuine challenge that happened to
      -- share the string, not only this probe's row.
      DELETE FROM public.mcp_seal_challenges WHERE id = probe_challenge;
      RAISE EXCEPTION
        'a procurement_document seal was accepted carrying a connection_id — chk_mcp_seal_challenges_non_tool_has_no_connection is not biting';
    END IF;

    -- And the honest half: the same row WITHOUT a connection is admitted. A
    -- migration that only proved the refusal would pass just as happily if the
    -- new kind were refused outright.
    INSERT INTO public.mcp_seal_challenges (
      subject_kind, subject_id, restaurant_id, actor_user_id,
      tool_name, args_hash, token_hash, expires_at
    ) VALUES (
      'procurement_document', gen_random_uuid(), probe_restaurant, probe_user,
      'verify', 'migration probe', 'migration probe', now() + interval '1 minute'
    )
    RETURNING id INTO probe_challenge;
    DELETE FROM public.mcp_seal_challenges WHERE id = probe_challenge;
  END IF;
END $$;
