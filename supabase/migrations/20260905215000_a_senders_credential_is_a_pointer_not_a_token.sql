-- A sender's credential is a pointer, not a token (ADR 0121, the transport half).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- `20260905210000_a_house_sends_in_its_own_name.sql` gave a house a sender row
-- with a `vault_secret_ref` column and a comment promising it would point at
-- "the same encrypted store the OAuth grants use". That store did not exist for
-- senders: `integration_oauth_connections` is keyed on `(user_id,
-- integration_id)` and holds a PERSON's delegated grant. A house's WhatsApp
-- business token and a house's Twilio subaccount key are the HOUSE's, they
-- outlive the manager who connected them, and they are keyed on the sender.
--
-- So `vault_secret_ref` pointed at nothing, and `TextSenderService.send()`
-- returned `transport_not_built` for a reason that was true twice over: there
-- was no adapter, and there was nowhere for an adapter's credential to live.
-- This file builds the second half. It does not build a transport and nothing
-- sends because of it.
--
-- THE TWO OWNERS, AND WHY THE COLUMN EXISTS AT ALL
-- ------------------------------------------------
-- The founder's decision of 2026-09-05 gives a house two ways to be reachable,
-- and they differ in WHOSE PROVIDER ACCOUNT holds the sender:
--
--   * `platform` — the sender sits under Mudavym's own provider account
--     (Mudavym as a Meta Tech Provider, or as a Twilio ISV with one subaccount
--     per house). The credential is Mudavym's and is read from the ENVIRONMENT.
--     A row with `owner = 'platform'` therefore carries NO token, and a CHECK
--     below makes that impossible to get wrong: a platform credential stored in
--     this table would be one deployment secret copied into fourteen tenant
--     rows, which is a leak surface with no upside.
--
--   * `house` — the house connected its own account (Meta's Embedded Signup
--     hands back an exchangeable code; a Twilio subaccount hands back a scoped
--     key). That secret IS the house's, it must survive here, and it is stored
--     encrypted the way `integration_oauth_connections` stores an OAuth refresh
--     token: AES-256-GCM through `TokenCryptoService`, in a column whose NAME
--     ends `_encrypted` so an unencrypted write is obvious in review.
--
-- The identity registered is the HOUSE's in BOTH cases — that is ADR 0121's
-- rule and three registrars enforce it independently. `owner` says who holds
-- the ACCOUNT, never whose name is on the sender.
--
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------
-- No plaintext token column, under any name. The assertion block at the bottom
-- RAISES if a column matching /token|secret|api_key|auth|password/ appears on
-- this table without an `_encrypted` suffix, so the next person to add
-- `refresh_token` gets a failed migration instead of a plaintext secret. The
-- same shape as `person_text_consents`'s approval-column assertion, pointed at
-- a different failure.
--
-- ADDITIVE, NULLABLE, NO BACKFILL. One new table; no column added to an
-- existing one; no constraint relaxed. Idempotent and safe to re-run.
-- No explicit BEGIN/COMMIT — the Supabase CLI wraps each file in a transaction.

CREATE TABLE IF NOT EXISTS public.house_text_sender_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The sender this credential sends AS. CASCADE: a credential with no sender
  -- is a secret nothing can use and nobody is watching.
  sender_id UUID NOT NULL
    REFERENCES public.house_text_senders(id) ON DELETE CASCADE,

  -- Carried as well as reachable through the sender, because every read here is
  -- tenant-scoped and a join is one refactor away from being dropped. The FK
  -- names a table that exists: `public.restaurants` (ADR 0122).
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Which adapter can use it. NOT the same axis as the sender's `channel`:
  -- Twilio carries both SMS and WhatsApp, Meta carries only WhatsApp, and a
  -- row that named a channel instead of a provider could not tell an adapter
  -- which client to build.
  provider TEXT NOT NULL CHECK (provider IN ('meta_cloud', 'twilio')),

  -- NO DEFAULT. An omitted owner must fail the insert. A default of 'platform'
  -- would let a forgotten field silently route a house's traffic through
  -- Mudavym's own account, which is the shared-sender shape ADR 0121 refused.
  owner TEXT NOT NULL CHECK (owner IN ('platform', 'house')),

  -- The provider's own identifiers. NEVER credentials.
  --   meta_cloud: `account_ref` = WABA id, `sender_ref` = business phone number id
  --   twilio:     `account_ref` = subaccount SID, `sender_ref` = the From value
  --               (E.164 or the alphanumeric sender ID), `service_ref` =
  --               Messaging Service SID
  -- Named generically on purpose: a column called `waba_id` would have to be
  -- NULL on every Twilio row, and a NULL that means "not applicable" is
  -- indistinguishable from a NULL that means "not filled in".
  account_ref TEXT,
  sender_ref TEXT,
  service_ref TEXT,

  -- THE SECRET. Encrypted by the app (AES-256-GCM, TokenCryptoService), exactly
  -- as `integration_oauth_connections.refresh_token_encrypted` is. NULL on a
  -- platform-owned row by construction (see the CHECK below).
  access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,

  -- Which API version the token was minted against, so a rotation can tell a
  -- stale credential from a broken one. Meta deprecates Embedded Signup v2 on
  -- 2026-10-15 (developers.facebook.com/docs/whatsapp/embedded-signup, fetched
  -- 2026-09-05); a credential with no version recorded could not be audited
  -- against that date.
  api_version TEXT,

  -- WHO CONNECTED IT, and ADR 0114's rule again: the attachment is the HOUSE's.
  -- Deleting the manager must not delete the house's ability to send.
  connected_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Soft revoke, for the same reason the sender row soft-revokes: the fact that
  -- a credential once existed is what a dispute is about. The token is cleared
  -- in place on revoke; the row is not deleted.
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  revoked_reason TEXT,

  -- A HOUSE-OWNED CREDENTIAL MUST CARRY ONE, AND A PLATFORM ONE MUST NOT.
  -- The first half stops a `house` row that looks connected and holds nothing.
  -- The second stops a deployment secret being copied per tenant.
  -- A revoked row is exempt from the first half: revoking CLEARS the token, and
  -- a constraint that forbade that would force the row to keep the secret it
  -- was revoked to destroy.
  CONSTRAINT house_text_sender_credentials_owner_holds_token CHECK (
    (owner = 'house' AND (access_token_encrypted IS NOT NULL OR revoked_at IS NOT NULL))
    OR (owner = 'platform' AND access_token_encrypted IS NULL)
  ),

  -- A REVOKED CREDENTIAL MUST SAY WHEN.
  CONSTRAINT house_text_sender_credentials_revoked_has_time CHECK (
    revoked_by IS NULL OR revoked_at IS NOT NULL
  )
);

COMMENT ON TABLE public.house_text_sender_credentials IS
  'The provider credential ONE house''s sender uses (ADR 0121 transport half). owner=''house'' rows carry the house''s own token, encrypted at rest by TokenCryptoService (AES-256-GCM) exactly as integration_oauth_connections does; owner=''platform'' rows carry NO token and the adapter reads Mudavym''s own credential from the environment, because a deployment secret copied per tenant is a leak surface with no upside. The identity registered is the HOUSE''s in both cases — owner says who holds the provider ACCOUNT, never whose name is on the sender. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_text_sender_credentials.owner IS
  'platform — the sender sits under Mudavym''s Meta Tech Provider app or Twilio ISV subaccount and the credential comes from the environment. house — the house connected its own Meta or Twilio account and its scoped token lives here, encrypted. NO DEFAULT: an omitted owner must fail rather than silently route a house through Mudavym''s account.';
COMMENT ON COLUMN public.house_text_sender_credentials.access_token_encrypted IS
  'AES-256-GCM ciphertext in TokenCryptoService''s `v1.iv.tag.ciphertext` base64url form. The column name ends `_encrypted` so a plaintext write is obvious in review, and the assertion block in this migration RAISES if any sibling column is named like a secret without that suffix.';

-- One live credential per sender. Two would make "which key sent this"
-- unanswerable, and the answer to that question is what a provider audit asks
-- for. Revoked rows are excluded so the history stays readable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_house_text_sender_credentials_live
  ON public.house_text_sender_credentials (sender_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_house_text_sender_credentials_restaurant
  ON public.house_text_sender_credentials (restaurant_id, provider);

ALTER TABLE public.house_text_sender_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_text_sender_credentials_service_role
  ON public.house_text_sender_credentials;
CREATE POLICY house_text_sender_credentials_service_role
  ON public.house_text_sender_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_text_sender_credentials FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assertions. A migration that cannot prove it applied is a migration that
-- reports absence as health.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  leaky TEXT;
  has_rls BOOLEAN;
  client_grants INT;
  probe_restaurant UUID;
  probe_sender UUID;
  rejected BOOLEAN;
BEGIN
  -- 1. The table applied.
  IF to_regclass('public.house_text_sender_credentials') IS NULL THEN
    RAISE EXCEPTION 'house_text_sender_credentials did not apply';
  END IF;

  -- 2. RLS is on and no client role holds a grant. Checked here rather than
  --    trusted from the statements above, because REVOKE of a privilege that
  --    was never granted is a no-op and reads identically to success.
  SELECT relrowsecurity INTO has_rls
  FROM pg_class WHERE oid = 'public.house_text_sender_credentials'::regclass;
  IF NOT has_rls THEN
    RAISE EXCEPTION 'RLS is not enabled on public.house_text_sender_credentials';
  END IF;

  SELECT count(*) INTO client_grants
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'house_text_sender_credentials'
    AND grantee IN ('anon', 'authenticated');
  IF client_grants > 0 THEN
    RAISE EXCEPTION
      'anon/authenticated still hold % grants on house_text_sender_credentials',
      client_grants;
  END IF;

  -- 3. NO PLAINTEXT SECRET COLUMN, UNDER ANY NAME. This is the assertion that
  --    outlives this pass: the next person to add `refresh_token` or `api_key`
  --    here gets a failed migration rather than a plaintext credential in a
  --    backup.
  SELECT string_agg(column_name, ', ') INTO leaky
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'house_text_sender_credentials'
    AND column_name ~ '(token|secret|api_key|auth|password|credential)'
    AND column_name NOT LIKE '%\_encrypted'
    AND column_name <> 'token_expires_at';
  IF leaky IS NOT NULL THEN
    RAISE EXCEPTION
      'house_text_sender_credentials has secret-shaped column(s) with no _encrypted suffix: %',
      leaky;
  END IF;

  -- 4. `owner` has no default. An omitted owner must FAIL, not inherit one.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'house_text_sender_credentials'
      AND column_name = 'owner'
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'house_text_sender_credentials.owner must have no default: an omitted owner would silently route a house through Mudavym''s own provider account';
  END IF;

  -- 5. connected_by is ON DELETE SET NULL, not CASCADE. Deleting the manager who
  --    connected a sender must not delete the house's ability to send.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public.house_text_sender_credentials'::regclass
      AND c.contype = 'f'
      AND a.attname = 'connected_by'
      AND c.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION
      'house_text_sender_credentials.connected_by is not ON DELETE SET NULL — deleting a manager would delete the house''s credential';
  END IF;

  -- 6. PROVE the owner CHECK, rather than asserting the constraint exists. A
  --    constraint that exists and does not bite is the shape this repo calls
  --    absence-reported-as-health, so this inserts a row that must be refused.
  SELECT id INTO probe_restaurant FROM public.restaurants LIMIT 1;
  IF probe_restaurant IS NOT NULL THEN
    INSERT INTO public.house_text_senders (
      restaurant_id, channel, path, state, state_detail,
      identity, identity_kind, display_name, display_name_state,
      market, provider, external_ref, vault_secret_ref, declared_by,
      last_probe_at, last_probe_result, last_probe_detail,
      legal_name, tax_id_ref, registered_address, website_url,
      contact_name, contact_email, use_case, sample_messages,
      opt_in_description, fee_stated, timeline_stated,
      submitted_at, connected_at, revoked_at, revoked_by, revoked_reason
    ) VALUES (
      probe_restaurant, 'sms', 'bring_your_own', 'requested',
      'migration probe, deleted in this transaction',
      NULL, NULL, NULL, NULL,
      'US', NULL, NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL
    )
    RETURNING id INTO probe_sender;

    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_text_sender_credentials (
        sender_id, restaurant_id, provider, owner,
        account_ref, sender_ref, service_ref,
        access_token_encrypted, token_expires_at, api_version,
        connected_by, revoked_at, revoked_by, revoked_reason
      ) VALUES (
        probe_sender, probe_restaurant, 'twilio', 'house',
        NULL, NULL, NULL,
        NULL, NULL, NULL,
        NULL, NULL, NULL, NULL
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'house_text_sender_credentials accepted a house-owned credential with no token — the owner CHECK is not biting';
    END IF;

    rejected := FALSE;
    BEGIN
      INSERT INTO public.house_text_sender_credentials (
        sender_id, restaurant_id, provider, owner,
        account_ref, sender_ref, service_ref,
        access_token_encrypted, token_expires_at, api_version,
        connected_by, revoked_at, revoked_by, revoked_reason
      ) VALUES (
        probe_sender, probe_restaurant, 'twilio', 'platform',
        NULL, NULL, NULL,
        'v1.aa.bb.cc', NULL, NULL,
        NULL, NULL, NULL, NULL
      );
    EXCEPTION WHEN check_violation THEN
      rejected := TRUE;
    END;
    IF NOT rejected THEN
      RAISE EXCEPTION
        'house_text_sender_credentials accepted a platform credential holding a token — the owner CHECK is not biting';
    END IF;

    DELETE FROM public.house_text_sender_credentials WHERE sender_id = probe_sender;
    DELETE FROM public.house_text_senders WHERE id = probe_sender;
  END IF;
  -- When `restaurants` is empty (a fresh CI database) the CHECK probes above
  -- cannot run. That is stated rather than hidden: this migration proves the
  -- constraints bite only where there is a house to hang a probe on, and the
  -- structural assertions 1-5 run everywhere.
END $$;
