-- ADR 0144: exact displayed consent, one-use seal, and the sealing browser.
BEGIN;

ALTER TABLE public.mcp_seal_challenges
  DROP CONSTRAINT chk_mcp_seal_challenges_subject_kind;
ALTER TABLE public.mcp_seal_challenges
  ADD CONSTRAINT chk_mcp_seal_challenges_subject_kind CHECK (subject_kind IN (
    'mcp_tool', 'mcp_tool_grant', 'procurement_order', 'payment_method',
    'price_index_upload', 'house_mail_export', 'text_credit_purchase',
    'commodity_exposure', 'procurement_document', 'integration_grant'
  ));

CREATE TABLE public.integration_consent_receipts (
  seal_id uuid PRIMARY KEY REFERENCES public.mcp_seal_challenges(id),
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
CREATE INDEX integration_consent_receipts_person_house
  ON public.integration_consent_receipts(user_id, restaurant_id, consented_at DESC);
COMMENT ON TABLE public.integration_consent_receipts IS
  'Immutable permission words and retention facts sealed by the person. This receipt records consent, not provider success. A connection names the receipt when the browser-bound exchange succeeds.';

ALTER TABLE public.integration_oauth_states
  ADD COLUMN consent_receipt_id uuid REFERENCES public.integration_consent_receipts(seal_id) ON DELETE SET NULL,
  ADD COLUMN browser_proof_hash text CHECK (browser_proof_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN browser_request_id uuid,
  ADD COLUMN frontend_origin text,
  ADD COLUMN pkce_verifier_encrypted text,
  ADD COLUMN callback_payload_encrypted text,
  ADD COLUMN callback_received_at timestamptz;
COMMENT ON COLUMN public.integration_oauth_states.browser_proof_hash IS
  'SHA256 of a browser-generated proof retained only in the initiating tab session. Never sent to an OAuth provider. Unsealed legacy states cannot be completed.';
COMMENT ON COLUMN public.integration_oauth_states.callback_payload_encrypted IS
  'Short-lived encrypted provider code/error, cleared atomically when the correct browser claims completion; expired states use the existing purge.';

ALTER TABLE public.integration_oauth_connections
  ADD COLUMN consent_receipt_id uuid REFERENCES public.integration_consent_receipts(seal_id) ON DELETE SET NULL;

DO $$ BEGIN
  IF has_table_privilege('anon', 'public.integration_consent_receipts', 'SELECT')
    OR has_table_privilege('authenticated', 'public.integration_consent_receipts', 'SELECT')
    OR has_table_privilege('service_role', 'public.integration_consent_receipts', 'UPDATE')
    OR has_table_privilege('service_role', 'public.integration_consent_receipts', 'DELETE') THEN
    RAISE EXCEPTION 'Consent receipts must be append-only and server scoped';
  END IF;
END $$;
COMMIT;
