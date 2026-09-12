-- A house sends in its own name (ADR 0121, the parts the founder decided on
-- 2026-09-05: "a crew text exists and build it next"; the first market is
-- "both"; the number arrives either because "the house brings their own name"
-- or because "with mudavym help buys per house and bills with info").
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- Until today the only text sender in this deployment was Plivo's ONE number
-- for every restaurant on it (`communications/sms.service.ts:30-33`,
-- `PLIVO_PHONE_NUMBER` read from env, no per-restaurant column anywhere). ADR
-- 0121 refused that shape for the reason ADR 0118 refused the shared mailbox
-- one layer over — the envelope says Mudavym whatever the signature says — and
-- added one consequence that has no email analogue: on a shared number STOP is
-- GLOBAL. A person who replies STOP is opted out of every restaurant on the
-- deployment, for five years (47 CFR 64.1200(d)(6)), and no house can undo
-- another house's opt-out.
--
-- Twilio's own US SMS guidelines list "shared phone numbers" among the
-- restricted use cases (twilio.com/en-us/guidelines/us/sms, fetched
-- 2026-09-05), so the shared sender is not merely a design objection here: it
-- is a listed prohibition at the carrier layer.
--
-- This migration gives a house a sender of its OWN, in ADR 0114's shape —
-- **the attachment is the restaurant's, the consent is each person's** — and
-- gives the crew text a receipt that cannot report absence as health.
--
-- WHAT IT ADDS, AND WHY EACH ONE
-- ------------------------------
--   1. `house_text_senders` — the house's WhatsApp or SMS sender, in one of the
--      two paths the founder named. `declared_by … ON DELETE SET NULL` so
--      deleting the manager who connected it does not delete the house's
--      sender, exactly as ADR 0114 did for a model-context server.
--   2. `person_text_consents` — a person's agreement to be texted at a number,
--      withdrawable, with NO approval column at any layer. A manager may see a
--      consent and may stop the HOUSE using its sender; a manager may never
--      approve, grant or restore somebody else's consent. Asserted below.
--   3. `team_note_deliveries` — one row per (recipient, channel) for every crew
--      note, written WHETHER OR NOT anything was delivered. This is the fix for
--      the fault ADR 0121 measured: `broadcast` returns `notified:
--      pushIds.length` counted off the roster (`team.controller.ts:521,527`)
--      while `ExpoPushService.sendToUsers` returns silently on an empty read
--      AND on a failed one (`push/expo-push.service.ts:83`), so a broadcast to
--      the eleven-person crew reports 11 and delivers 0.
--
-- NOTHING SENDS BECAUSE OF THIS FILE
-- ----------------------------------
-- Every table starts empty and every send path asks `house_text_senders` for a
-- `connected` row first. No house on this deployment has one, so the honest
-- answer today is still "this house has no sender", and the surfaces say so in
-- words rather than drawing a control that would appear to work.
--
-- ADDITIVE, NULLABLE, NO BACKFILL. Three new tables, no column added to an
-- existing one, no constraint relaxed. Idempotent and safe to re-run:
-- CREATE TABLE / CREATE INDEX use IF NOT EXISTS, `enable row level security`
-- is a no-op when already on, every CREATE POLICY is preceded by DROP POLICY
-- IF EXISTS, and REVOKE of an absent privilege is a no-op. No explicit
-- BEGIN/COMMIT — the Supabase CLI wraps each file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. The house's sender.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_text_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Two channels, and they are not interchangeable. WhatsApp can hold a
  -- conversation everywhere; an SMS sender in Türkiye cannot receive a reply at
  -- all (twilio.com/en-us/guidelines/tr/sms, "Two-way SMS supported: No",
  -- fetched 2026-09-05), which is why the channel is part of the row's identity
  -- rather than a rendering detail.
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms')),

  -- The founder's two paths, verbatim in intent: the house "brings their own
  -- name and we have to make sure the connection is secure", or "with mudavym
  -- help buys per house and bills with info".
  path TEXT NOT NULL CHECK (path IN ('bring_your_own', 'mudavym_registers')),

  -- NO DEFAULT. A sender whose state was not stated must fail the insert; a
  -- default of 'requested' would let a forgotten field read as a real request,
  -- and a default of 'connected' would let it read as a live sender.
  --
  -- `submitted` and `in_review` are deliberately different: the first means the
  -- registration left this building, the second means a registrar has it.
  -- Collapsing them would let "we have not sent it yet" render as "they are
  -- looking at it".
  state TEXT NOT NULL CHECK (state IN (
    'requested',   -- the house asked; nothing has been submitted anywhere
    'submitted',   -- the paperwork left this building
    'in_review',   -- a registrar (TCR, Meta, a Turkish operator) holds it
    'connected',   -- proven live; only this state may send
    'rejected',    -- the registrar refused; `state_detail` carries their words
    'revoked'      -- the house stopped it, or the provider took it away
  )),

  -- The registrar's or provider's own sentence about the state. NOT a code:
  -- a manager reading "rejected" is owed the reason the reviewer gave.
  state_detail TEXT,

  -- The number in E.164, or the alphanumeric sender ID (up to 11 characters,
  -- one-way only, and not supported in the US or Canada at all).
  --
  -- NULLABLE, because a `requested` row genuinely has no identity yet: in the
  -- "Mudavym registers for you" path the house submits its legal identity
  -- WEEKS before a number exists. A zero-length string standing in for "not yet
  -- issued" is the shape this repo refuses.
  identity TEXT,
  identity_kind TEXT CHECK (identity_kind IN ('e164', 'alphanumeric')),

  -- What the recipient sees. Meta reviews it (`APPROVED`, `PENDING_REVIEW`,
  -- `DECLINED`, `AVAILABLE_WITHOUT_REVIEW`) and a declined display name caps
  -- the sender at 250 messages per 24 hours, so it is a fact about deliverability
  -- and not a label.
  display_name TEXT,
  display_name_state TEXT,

  -- ISO 3166-1 alpha-2. The market decides the entire registration: US 10DLC
  -- brand plus campaign, a Turkish sender ID on operator paperwork, or WhatsApp
  -- with no SMS registration at all. A sender with no market recorded could not
  -- be told which rules bind it.
  market TEXT NOT NULL CHECK (market ~ '^[A-Z]{2}$'),

  -- 'meta_cloud_api', 'twilio', 'plivo', … NULL means no provider has been
  -- chosen yet, which is the true state of a `requested` row.
  provider TEXT,

  -- The provider's own id for this sender: a WABA id, a business phone number
  -- id, a Messaging Service SID, a Sender SID. Never a credential.
  external_ref TEXT,

  -- A POINTER into the same encrypted store the OAuth grants use, never a
  -- token. The house's WhatsApp system-user token and the provider's subaccount
  -- credentials are secrets; a column that could hold one would eventually hold
  -- one. `integration_oauth_connections` already encrypts tokens at rest
  -- (AES-256-GCM) and this row names the record rather than copying it.
  vault_secret_ref TEXT,

  -- ADR 0114's rule, applied: the attachment is the HOUSE's. Deleting the
  -- manager who connected the sender must not delete the sender.
  declared_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  -- THE LIVE PROBE. "We have to make sure the connection is secure" (founder)
  -- is only true if something checks. A declared sender is not a reachable one
  -- (ADR 0107), so the row carries when it was last proven and what came back —
  -- and a NULL `last_probe_at` means NEVER PROBED, which the surface must say
  -- rather than draw as healthy.
  last_probe_at TIMESTAMPTZ,
  last_probe_result TEXT CHECK (
    last_probe_result IN ('reachable', 'unreachable', 'refused', 'unconfigured')
  ),
  last_probe_detail TEXT,

  -- WHAT THE REGISTRATION NEEDS, when the house asks Mudavym to do it. These
  -- are the fields the registrars actually demand, and they are stored so the
  -- request is a record rather than an email somebody sent:
  --   * US 10DLC brand: legal business name matching EIN records exactly, EIN,
  --     business type, address, a publicly reachable website, contact person.
  --   * US 10DLC campaign: use case, 2+ sample messages, the opt-in flow in
  --     40-2049 characters with message frequency and the "message and data
  --     rates may apply" disclosure.
  --   * Türkiye sender ID: company/brand registration certificate, a Letter of
  --     Authorization, an authorization letter and an NOC letter, each on the
  --     house's own letterhead, signed by an authorized signatory and stamped.
  -- NULLABLE throughout: a `bring_your_own` sender needs none of them, and a
  -- blank string standing in for "not applicable" would be indistinguishable
  -- from "the house did not fill it in".
  legal_name TEXT,
  tax_id_ref TEXT,
  registered_address TEXT,
  website_url TEXT,
  contact_name TEXT,
  contact_email TEXT,
  use_case TEXT,
  sample_messages TEXT[],
  opt_in_description TEXT,

  -- THE FEE AND THE TIMELINE, PRINTED AT REQUEST TIME AND KEPT.
  --
  -- Stated in WORDS with their source, not as a number. A house that submitted
  -- a registration in September must be able to read what it was told the fee
  -- and the wait would be, even after the provider changes both. A numeric
  -- column would have invited a figure with no date and no citation, which is
  -- exactly the fabrication ADR 0020 forbids.
  fee_stated TEXT,
  timeline_stated TEXT,

  submitted_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  revoked_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A CONNECTED SENDER MUST HAVE AN IDENTITY. This is the constraint that stops
  -- the whole feature lying: `connected` is the only state that may send, and a
  -- connected row with no number would let the send path believe it had a
  -- sender and fail at the provider, where nobody is reading.
  CONSTRAINT house_text_senders_connected_has_identity CHECK (
    state <> 'connected' OR (identity IS NOT NULL AND identity_kind IS NOT NULL)
  ),

  -- A REVOKED SENDER MUST SAY WHEN. Otherwise `revoked` and "we lost the
  -- timestamp" render identically.
  CONSTRAINT house_text_senders_revoked_has_time CHECK (
    state <> 'revoked' OR revoked_at IS NOT NULL
  ),

  -- AN ALPHANUMERIC SENDER ID IS ONE-WAY AND IS NOT A US SENDER. Twilio:
  -- alphanumeric sender IDs are "Not supported in the US or Canada". A row
  -- claiming one would be a sender that can never deliver.
  CONSTRAINT house_text_senders_alpha_not_us CHECK (
    identity_kind IS DISTINCT FROM 'alphanumeric'
    OR market NOT IN ('US', 'CA')
  )
);

COMMENT ON TABLE public.house_text_senders IS
  'The text sender ONE RESTAURANT owns — its WhatsApp Business number or its registered SMS sender (ADR 0121, ADR 0114 shape). The attachment is the house''s and survives the manager who connected it (declared_by … ON DELETE SET NULL); a person''s agreement to be texted is a separate row in person_text_consents. Only state=''connected'' may send. Rows never hold a credential: vault_secret_ref names the encrypted record instead. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_text_senders.state IS
  'requested | submitted | in_review | connected | rejected | revoked. NO DEFAULT: an insert that omits the state must fail rather than inherit one. Only ''connected'' may send, and the connected-has-identity CHECK makes that state impossible to reach without a number.';
COMMENT ON COLUMN public.house_text_senders.path IS
  'bring_your_own — the house''s own number/WABA, connected through the provider''s embedded signup or a subaccount, the token in the vault, proven by a live probe. mudavym_registers — the house submits its own legal identity and Mudavym operates the submission. The registration is still the HOUSE''s in both: Twilio''s regulatory-bundle rule is that a bundle must represent the actual end-user and "Twilio audits this", so Mudavym''s own identity may never stand in for a house''s.';
COMMENT ON COLUMN public.house_text_senders.vault_secret_ref IS
  'A POINTER to the encrypted credential record, never the credential. A column that could hold a token would eventually hold one.';
COMMENT ON COLUMN public.house_text_senders.last_probe_at IS
  'When the sender was last proven reachable. NULL means NEVER PROBED, which is not the same as unreachable and must never render as healthy (ADR 0107).';
COMMENT ON COLUMN public.house_text_senders.fee_stated IS
  'The fee the house was shown at request time, in words, with its source and date. Deliberately not numeric: a bare number would outlive its citation.';

CREATE INDEX IF NOT EXISTS idx_house_text_senders_restaurant
  ON public.house_text_senders (restaurant_id, channel);

-- ONE LIVE SENDER PER HOUSE PER CHANNEL. A second live WhatsApp number for the
-- same house would make "which number did this leave from" unanswerable, and a
-- vendor would see two identities for one restaurant. Revoked and rejected rows
-- are excluded so the history stays readable.
CREATE UNIQUE INDEX IF NOT EXISTS uq_house_text_senders_live
  ON public.house_text_senders (restaurant_id, channel)
  WHERE state <> 'revoked' AND state <> 'rejected';

ALTER TABLE public.house_text_senders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_text_senders_service_role ON public.house_text_senders;
CREATE POLICY house_text_senders_service_role
  ON public.house_text_senders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_text_senders FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The person's consent.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.person_text_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE, and it is the opposite case to declared_by above: a consent is
  -- the PERSON's and must not outlive the account that gave it.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The number this person agreed to be reached at, which is not necessarily
  -- the one on their profile: a person may give the house a work number and
  -- keep their own. Stored here rather than read from `users.phone` for that
  -- reason — the consent names its own address.
  phone TEXT NOT NULL,

  -- 'any' is a real answer and not a missing one: a person may agree to be
  -- texted however the house can reach them.
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'any')),

  consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL means live. Withdrawal is a timestamp and a reason, never a delete:
  -- 47 CFR 64.1200(d)(3) and (d)(6) require a revocation to be RECORDED and
  -- honoured for five years, so a deleted consent row is a compliance failure
  -- dressed as tidiness.
  withdrawn_at TIMESTAMPTZ,
  withdrawn_via TEXT CHECK (
    withdrawn_via IN ('person', 'stop_keyword', 'account_closed')
  ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.person_text_consents IS
  'A person''s agreement that this house may text them at a stated number (ADR 0114: house declares, person consents; ADR 0121). Withdrawable by the person and by a STOP reply, never by a manager, and never approved by one — the assertions in this migration raise if an approval column ever appears. Withdrawal is a timestamp, never a delete: 47 CFR 64.1200(d)(3)/(d)(6) require the request to be recorded and honoured for five years. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.person_text_consents.phone IS
  'The number the person consented to be reached at. Deliberately its own column rather than a read of users.phone: the consent names the address it covers, so changing a profile number does not silently re-point a consent.';
COMMENT ON COLUMN public.person_text_consents.withdrawn_via IS
  'person (they switched it off), stop_keyword (they replied STOP and the gateway recorded it), account_closed. NULL while the consent is live.';

-- ONE LIVE CONSENT PER PERSON PER HOUSE. A second live row would make "did they
-- agree?" have two answers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_text_consents_live
  ON public.person_text_consents (user_id, restaurant_id)
  WHERE withdrawn_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_person_text_consents_restaurant
  ON public.person_text_consents (restaurant_id);

ALTER TABLE public.person_text_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS person_text_consents_service_role ON public.person_text_consents;
CREATE POLICY person_text_consents_service_role
  ON public.person_text_consents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.person_text_consents FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The receipt. One row per recipient per channel, always.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.team_note_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  note_id UUID NOT NULL
    REFERENCES public.team_notes(id) ON DELETE CASCADE,

  member_id UUID NOT NULL
    REFERENCES public.team_members(id) ON DELETE CASCADE,

  channel TEXT NOT NULL CHECK (
    channel IN ('inbox', 'push', 'whatsapp', 'sms')
  ),

  -- NO DEFAULT, and the seven states are kept apart on purpose. Folding any two
  -- of them re-creates the fault this table exists to close: `broadcast`
  -- reported `notified: 11` off the roster while `mobile_devices` held zero
  -- rows, because "nobody has a device" and "we reached them" had the same
  -- shape.
  --
  -- `accepted_by_service` IS NOT `delivered`. Expo accepting a push ticket
  -- means Expo has it, not that a handset showed it; claiming delivery from an
  -- accepted ticket is the same overclaim one layer down.
  state TEXT NOT NULL CHECK (state IN (
    'delivered',            -- the destination confirmed receipt
    'accepted_by_service',  -- a provider took it; delivery is unconfirmed
    'no_device_registered', -- there was nowhere to send it
    'no_consent',           -- the person has not agreed to this channel
    'no_sender',            -- this house has no sender for this channel
    'declined',             -- the person switched this channel off
    'read_failed',          -- we could not find out; NOT the same as "nobody"
    'failed'                -- it was attempted and refused
  )),

  -- The sentence a manager reads. Required, because the whole point of the row
  -- is that "notified: 0" without a reason is the same silence in a new coat.
  detail TEXT NOT NULL,

  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.team_note_deliveries IS
  'One row per (crew note, recipient, channel), written WHETHER OR NOT anything was delivered (ADR 0083, ADR 0121 P0). The fault it closes was measured: POST …/broadcast returned notified: 11 counted off the roster while mobile_devices held 0 rows and ExpoPushService.sendToUsers returned silently on both an empty read and a failed one. Absence of a row here means no attempt was recorded, which is itself a defect — it never means success. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.team_note_deliveries.state IS
  'accepted_by_service is NOT delivered: a push service taking a ticket is not a handset showing a notification. read_failed is NOT no_device_registered: the first is a fact about our knowledge, the second about the crew.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_team_note_deliveries_note_member_channel
  ON public.team_note_deliveries (note_id, member_id, channel);

CREATE INDEX IF NOT EXISTS idx_team_note_deliveries_note
  ON public.team_note_deliveries (note_id);

ALTER TABLE public.team_note_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_note_deliveries_service_role ON public.team_note_deliveries;
CREATE POLICY team_note_deliveries_service_role
  ON public.team_note_deliveries
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_note_deliveries FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assertions. A migration that cannot prove it applied is a migration that
--    reports absence as health.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing TEXT[] := ARRAY[]::TEXT[];
  t TEXT;
BEGIN
  -- 4a. The three tables exist.
  FOREACH t IN ARRAY ARRAY[
    'house_text_senders', 'person_text_consents', 'team_note_deliveries'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      missing := missing || t;
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the text-sender tables did not apply: %',
      array_to_string(missing, ', ');
  END IF;

  -- 4b. RLS is on for all three. Checked rather than assumed: the whole OD-72 /
  --     OD-73 class was tables created with RLS off and client grants intact.
  FOREACH t IN ARRAY ARRAY[
    'house_text_senders', 'person_text_consents', 'team_note_deliveries'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', t;
    END IF;
  END LOOP;

  -- 4c. NO DEFAULT on the two columns whose absence must fail rather than read
  --     as an answer. A default on `state` would let a forgotten field render
  --     as a real sender state; a default on a delivery state would let a
  --     forgotten receipt render as a delivery.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'house_text_senders'
      AND column_name = 'state' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'house_text_senders.state must have no default: an omitted state must fail, not inherit one';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'team_note_deliveries'
      AND column_name = 'state' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'team_note_deliveries.state must have no default: an omitted receipt must fail, not read as a delivery';
  END IF;

  -- 4d. `declared_by` is ON DELETE SET NULL. ADR 0114's own assertion, applied
  --     to the sender: deleting the manager who connected the house's WhatsApp
  --     number must not delete the house's WhatsApp number.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = ANY (con.conkey)
    WHERE n.nspname = 'public'
      AND rel.relname = 'house_text_senders'
      AND a.attname = 'declared_by'
      AND con.contype = 'f'
      AND con.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'house_text_senders.declared_by is not ON DELETE SET NULL — deleting a manager would delete the house''s sender';
  END IF;

  -- 4e. NO APPROVAL AXIS ON A CONSENT. ADR 0114's migration raises if an
  --     `approved_at` / `approval_status` / `pending` column ever appears on
  --     the consents table, for the reason that a consent a manager can approve
  --     is not a consent. The same rule, on the same shape, one product over.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'person_text_consents'
      AND column_name IN ('approved_at', 'approval_status', 'pending', 'approved_by')
  ) THEN
    RAISE EXCEPTION 'person_text_consents has an approval column — a consent a manager can approve is not a consent';
  END IF;

  -- 4f. A connected sender cannot exist without an identity. Proven rather than
  --     asserted in prose: the insert below MUST be refused by the CHECK.
  BEGIN
    INSERT INTO public.house_text_senders (
      restaurant_id, channel, path, state, market
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', 'whatsapp',
      'bring_your_own', 'connected', 'TR'
    );
    RAISE EXCEPTION 'house_text_senders accepted a connected sender with no identity';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- correct: refused before the FK was ever reached
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'house_text_senders checked the FK before the connected-has-identity CHECK, so that guard is unproven here';
  END;

  -- 4g. An alphanumeric sender ID cannot be a US sender. Same shape, and it
  --     matters because a US house asking for a branded sender name is the most
  --     natural wrong request this product will receive.
  BEGIN
    INSERT INTO public.house_text_senders (
      restaurant_id, channel, path, state, market, identity, identity_kind
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', 'sms',
      'mudavym_registers', 'requested', 'US', 'MUDAVYM', 'alphanumeric'
    );
    RAISE EXCEPTION 'house_text_senders accepted an alphanumeric sender ID for the US, where they are not supported';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'house_text_senders checked the FK before the alphanumeric-not-US CHECK, so that guard is unproven here';
  END;

  RAISE NOTICE 'text senders: house_text_senders, person_text_consents and team_note_deliveries created, locked down and proven.';
END
$$;
