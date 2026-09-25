-- Version note (PR #414 BLOCK): earlier drafts shipped this file as
-- 20260919040000, behind main's applied ceiling. Renamed past 20260921114400 so
-- the runner actually applies it.
--
-- An arrival configuration batch is sealed like an order. (codex-audit/C2-adopt.md
-- #2, fixing an outstanding defect on the Codex C2 lane; ADR 0113, ADR 0144.
-- Additive to 20260904210000, which is not edited.)
--
-- THE DEFECT
-- ----------
-- `POST arrival/batches/:id/apply` took only a revision number and redeemed no
-- seal at all: the "hold to seal" gesture in Arrival.tsx was client-side
-- ceremony over a plain write, and any client holding a manager JWT could
-- apply a batch without it. ADR 0113 ("the assistant proposes; the seal
-- applies") and the gap map both expected a batch seal subject; this migration
-- and its two TypeScript companions (`arrival/arrival-seal.ts`,
-- `common/seal/seal-subject.ts`) are what was missing.
--
-- WHY THE CHECK IS WIDENED BY READ-AND-APPEND
-- -------------------------------------------
-- Same shape as 20260905225000, 20260905233000 and 20260906200000, and for the
-- same reason: several passes can add kinds to this one constraint, and a
-- migration that DROPPED it and rewrote it from a hand-typed list would
-- silently delete every kind a peer added in between. This file reads every
-- quoted literal the constraint currently admits, adds exactly one, and proves
-- the rebuilt constraint holds exactly that set — never fewer, from a
-- misparse, and never a peer's kind dropped.

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'configuration_batch';
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

  -- Nine kinds existed before this one (seal-subject.ts, measured 2026-09-19);
  -- reading fewer means the parse failed, and rewriting from a failed parse
  -- would delete the seal's entire vocabulary.
  IF kinds IS NULL OR array_length(kinds, 1) < 9 THEN
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

-- `configuration_batch` is a non-`mcp_tool` kind like `procurement_document`,
-- so `chk_mcp_seal_challenges_non_tool_has_no_connection` already forbids it a
-- `connection_id` and `chk_mcp_seal_challenges_tool_names_connection` already
-- exempts it. RLS, the service_role policy and the anon/authenticated revoke
-- on `mcp_seal_challenges` are table-level and already cover every kind.

COMMENT ON COLUMN public.mcp_seal_challenges.subject_kind IS
  'What the seal is over: mcp_tool | mcp_tool_grant | procurement_order | '
  'payment_method | price_index_upload | house_mail_export | '
  'text_credit_purchase | commodity_exposure | procurement_document | '
  'configuration_batch. See common/seal/seal-subject.ts.';
