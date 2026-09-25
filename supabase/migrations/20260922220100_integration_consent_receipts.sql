-- ADR 0144: exact displayed consent, one-use seal, and the sealing browser.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Widen the seal subject-kind CHECK by reading it first.
-- ---------------------------------------------------------------------------
--
-- Same read-and-append-and-prove block as
-- 20260906200000_a_document_act_takes_a_redeemed_seal.sql:44-110, with only
-- `wanted` changed. The first draft of this file dropped the constraint and
-- re-created it from a hand-typed list of ten kinds, which silently deletes any
-- kind a sibling migration adds between the day the list was typed and the day
-- this runs (KL audit J3, 2026-09-17; the hazard class is v3.0-TECH-DEBT.md
-- "Three seal migrations read the kind list with a character class").

DO $$
DECLARE
  existing_def TEXT;
  kinds TEXT[];
  wanted TEXT := 'integration_grant';
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

  -- Every quoted literal, never a character class: `pg_get_constraintdef`
  -- renders the CHECK as `ARRAY['kind'::text, ...]`, whose only quoted
  -- literals are the kinds, and a doubled quote inside one is unescaped.
  SELECT array_agg(DISTINCT replace(m[1], '''''', '''')) INTO kinds
  FROM regexp_matches(existing_def, '''((?:[^'']|'''')+)''', 'g') AS m;

  -- Four kinds existed on 2026-09-04; reading fewer means the parse failed,
  -- and rewriting from a failed parse would delete the seal's vocabulary.
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

  -- PROVE the union: read the rebuilt constraint back with the same parse and
  -- refuse unless it holds exactly the kinds read plus the one added.
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

-- ---------------------------------------------------------------------------
-- 2. The receipt.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.integration_consent_receipts (
  -- ON DELETE NO ACTION, stated rather than left implicit (KL audit J11): the
  -- redeemed seal IS the receipt's proof, so deleting a seal row that a receipt
  -- names on its own is refused (23503). NO ACTION rather than RESTRICT because
  -- NO ACTION is checked at the end of the statement: deleting the person (or
  -- the house) cascades to BOTH the seal (mcp_seal_challenges.actor_user_id and
  -- restaurant_id are ON DELETE CASCADE) and this receipt in one statement, and
  -- RESTRICT would fail that cascade depending on which row is removed first.
  seal_id uuid PRIMARY KEY REFERENCES public.mcp_seal_challenges(id) ON DELETE NO ACTION,
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  disclosure_digest text NOT NULL CHECK (disclosure_digest ~ '^[a-f0-9]{64}$'),
  disclosure_snapshot jsonb NOT NULL CHECK (jsonb_typeof(disclosure_snapshot) = 'object'),
  consented_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.integration_consent_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integration_consent_receipts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.integration_consent_receipts TO service_role;
CREATE INDEX IF NOT EXISTS integration_consent_receipts_person_house
  ON public.integration_consent_receipts(user_id, restaurant_id, consented_at DESC);
COMMENT ON TABLE public.integration_consent_receipts IS
  'Immutable permission words and retention facts sealed by the person. This receipt records consent, not provider success. A connection names the receipt when the browser-bound exchange succeeds.';

ALTER TABLE public.integration_oauth_states
  ADD COLUMN IF NOT EXISTS consent_receipt_id uuid REFERENCES public.integration_consent_receipts(seal_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS browser_proof_hash text CHECK (browser_proof_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS browser_request_id uuid,
  ADD COLUMN IF NOT EXISTS frontend_origin text,
  ADD COLUMN IF NOT EXISTS pkce_verifier_encrypted text,
  ADD COLUMN IF NOT EXISTS callback_payload_encrypted text,
  ADD COLUMN IF NOT EXISTS callback_received_at timestamptz,
  -- KL audit D1, round 2: minted only when a provider callback actually parks
  -- a result (never chosen up front by the sealer the way browser_proof_hash
  -- is), and required alongside it to complete. See
  -- integrations-oauth.service.ts consumeBrowserState() for why one secret
  -- alone let a dishonest sealer bind a stranger's account into her house.
  ADD COLUMN IF NOT EXISTS browser_delivery_secret_hash text CHECK (browser_delivery_secret_hash ~ '^[a-f0-9]{64}$');
COMMENT ON COLUMN public.integration_oauth_states.browser_proof_hash IS
  'SHA256 of a browser-generated proof retained only in the initiating tab session. Never sent to an OAuth provider. Unsealed legacy states cannot be completed.';
COMMENT ON COLUMN public.integration_oauth_states.callback_payload_encrypted IS
  'Short-lived encrypted provider code/error, cleared atomically when the correct browser claims completion; expired states use the existing purge.';
COMMENT ON COLUMN public.integration_oauth_states.browser_delivery_secret_hash IS
  'SHA256 of a second, server-minted secret set only when a provider callback parks a result and sent only in that redirect fragment. Completion requires both this and browser_proof_hash so the sealer and the browser that returned from the provider must be the same one (KL audit D1).';

ALTER TABLE public.integration_oauth_connections
  ADD COLUMN IF NOT EXISTS consent_receipt_id uuid REFERENCES public.integration_consent_receipts(seal_id) ON DELETE SET NULL;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.integration_consent_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.integration_consent_receipts', 'SELECT')
    OR has_table_privilege('service_role', 'public.integration_consent_receipts', 'UPDATE')
    OR has_table_privilege('service_role', 'public.integration_consent_receipts', 'DELETE') THEN
    RAISE EXCEPTION 'Consent receipts must be append-only and server scoped';
  END IF;
END $$;
COMMIT;
