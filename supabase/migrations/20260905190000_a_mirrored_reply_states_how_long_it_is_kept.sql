-- A mirrored reply states how long it is kept (ADR 0118, retention — decided
-- 2026-09-05).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- ADR 0118's receive half mirrors a vendor's reply out of a person's private
-- mailbox into `procurement_conversations`. Until today nothing deleted it and
-- nothing said how long the house kept it; the consent screen answered that
-- question with silence. The founder's decision splits the row into two objects
-- with two different rules:
--
--   RAW MAIL  — `message_text`, `email_headers`, `content`, and the attachment
--               bytes in the private `vendor-attachments` bucket. A copy of a
--               person's mailbox. Has a stated window, and goes immediately on
--               revocation.
--   FACTS     — `detected_intent`, `detected_sentiment`, `rolling_summary`,
--               `conversation_context` (`analysis.vendor_offers`, `key_facts`,
--               `commercial_terms`, `classification`) and the order fields the
--               understand step writes (inbound-responder.service.ts:308-339),
--               plus `procurement_orders.*` and `negotiation_facts.exact_quote`.
--               The house's own procurement record. Untouched by either rule.
--
-- WHAT IT ADDS
-- -----------
--   1. `procurement_conversations.mirrored_by_grant_id` — so a row KNOWS which
--      grant mirrored it. Measured first: the reader publishes `source:
--      "house-inbox"` on the event (house-inbox.service.ts:507) and the bridge
--      never reads it (rabbitmq-bridge.service.ts:528-570), so before this
--      column a revocation had no way to find the rows it must delete without
--      also deleting every shared-mailbox reply, which no grant covers.
--   2. `raw_deleted_at` / `raw_deleted_reason` — the tombstone. A deleted body
--      must be legible as deleted; an empty `message_text` would read as "the
--      vendor sent nothing", which is the same fault as a silent skip.
--   3. `conversation_attachments.bytes_deleted_at` — the row survives (the
--      order's record that a document arrived: filename, size, sha256), the
--      BYTES do not.
--   4. `house_mail_retention_windows` — one row per restaurant carrying the
--      derived figure, when it was derived, and the basis IN WORDS.
--   5. `house_mail_retention_sweeps` — a count recorded whether or not the run
--      changed anything (ADR 0078's rule, applied here: a sweep that deleted
--      nothing must leave a row saying it ran and deleted nothing, or the only
--      evidence the sweep exists is the runs that found something).
--
-- WHY `message_text` IS NOT NULLED, AND WHAT HAPPENS INSTEAD
-- ---------------------------------------------------------
-- `procurement_conversations.message_text` is `text NOT NULL` in the production
-- baseline (20260805000000_baseline_from_production.sql:4301). Dropping that
-- NOT NULL would be a constraint relaxation on a table five other subsystems
-- write to, which is not an additive change and is not this file's business.
-- The sweep therefore REPLACES the body with a stated tombstone sentence naming
-- the date and the reason, and nulls the columns that are nullable
-- (`email_headers` back to its own `{}` default, `content` to NULL). Everything
-- the tombstone leaves behind — order id, provider, direction, timestamps — is
-- the order's record and not the mail.
--
-- ADDITIVE, NULLABLE, NO BACKFILL
-- ------------------------------
-- Every added column is nullable with no default, because NULL is the true
-- answer for every existing row: no reply on this deployment was mirrored under
-- a grant (the reader shipped 2026-09-05 and the switch defaults OFF), and none
-- has had its raw mail deleted. Backfilling `mirrored_by_grant_id` would be a
-- claim about rows nobody can attribute. The two new tables start empty for the
-- same reason: a house with no derivation row has never had one derived, which
-- is different from a house whose window is zero.
--
-- Idempotent and safe to re-run: ADD COLUMN / CREATE TABLE / CREATE INDEX use
-- IF NOT EXISTS, `enable row level security` is a no-op when already on, every
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS, and REVOKE of an absent
-- privilege is a no-op. No explicit BEGIN/COMMIT — the Supabase CLI wraps each
-- file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. A conversation row knows which grant mirrored it, and whether its raw
--    mail is gone.
-- ---------------------------------------------------------------------------

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS mirrored_by_grant_id UUID
    REFERENCES public.integration_oauth_connections(id) ON DELETE SET NULL;

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS raw_deleted_at TIMESTAMPTZ;

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS raw_deleted_reason TEXT;

COMMENT ON COLUMN public.procurement_conversations.mirrored_by_grant_id IS
  'The integration_oauth_connections row whose gmail_read grant mirrored this reply out of a person''s mailbox. NULL means this row did NOT come from a personal mailbox: a shared-mailbox reply, an outbound letter, or a row written before the reader existed. Only NOT NULL rows are in scope for the raw-mail window and for deletion on revocation — a shared-mailbox reply is not covered by anybody''s personal grant. ON DELETE SET NULL rather than CASCADE: deleting a grant row must never delete the order''s conversation.';
COMMENT ON COLUMN public.procurement_conversations.raw_deleted_at IS
  'When the raw mail on this row was deleted. NULL means it was NOT deleted — it does NOT mean the row was never swept; the sweep''s own record is house_mail_retention_sweeps.';
COMMENT ON COLUMN public.procurement_conversations.raw_deleted_reason IS
  'Why the raw mail went: ''window_expired'' (past this house''s derived figure) or ''grant_revoked'' (the person disconnected the grant). Free text so a future reason does not need a migration, but the two the sweep writes are these.';

-- The sweep asks "which mirrored rows in this house are past the window", and
-- the revocation asks "which rows did THIS grant mirror". Both are indexed
-- partially, because the overwhelming majority of rows are not mirrored at all.
CREATE INDEX IF NOT EXISTS idx_procurement_conversations_mirrored_grant
  ON public.procurement_conversations (mirrored_by_grant_id)
  WHERE mirrored_by_grant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_mirrored_undeleted
  ON public.procurement_conversations (restaurant_id, received_at)
  WHERE mirrored_by_grant_id IS NOT NULL AND raw_deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. An attachment row survives its bytes.
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversation_attachments
  ADD COLUMN IF NOT EXISTS bytes_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.conversation_attachments.bytes_deleted_at IS
  'When the object at storage_path was removed from the private vendor-attachments bucket under the raw-mail retention rule. The ROW stays: that a document of this name, size and sha256 arrived on this order is the house''s record, and the sha256 is a hash rather than content. NULL means the bytes were not deleted.';

-- ---------------------------------------------------------------------------
-- 3. The derived window, per house.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_mail_retention_windows (
  -- ONE row per restaurant. The window is a fact about a house's own dispute
  -- history, not about a grant: two people in the same house consenting does
  -- not give the house two different answers to "how long do we keep mail".
  restaurant_id UUID PRIMARY KEY
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The figure the sweep obeys, in days. Never a bare constant: it is
  -- longest_dispute_days + margin_days, and both parts are stored beside it so
  -- a reader can check the arithmetic without re-running the derivation.
  figure_days INTEGER NOT NULL,

  -- The derivation, in words, for the consent screen. Not a code — a person
  -- reading a consent screen is owed the sentence, not an enum.
  basis TEXT NOT NULL,

  -- Which of the two shapes produced the figure. 'dispute_span' means at least
  -- one dispute was found and measured; 'no_dispute_recorded' means this house
  -- has recorded none, and the figure is the margin alone. The second is NOT an
  -- error and NOT a missing derivation: it is the true answer for a house that
  -- has never disputed anything, and it is deliberately the SHORTEST window
  -- this rule can produce.
  basis_kind TEXT NOT NULL
    CHECK (basis_kind IN ('dispute_span', 'no_dispute_recorded')),

  -- NULL when basis_kind is 'no_dispute_recorded'. Never 0 standing in for
  -- "none found" — that is the absence-as-health shape this repo names.
  longest_dispute_days INTEGER,
  disputes_considered INTEGER NOT NULL DEFAULT 0,
  margin_days INTEGER NOT NULL,

  -- The jurisdiction rule that binds the FACTS. Stored so the consent screen
  -- can print the floor and its source without re-resolving the country, and so
  -- a later reader can see which rule was in force when the figure was derived.
  jurisdiction TEXT NOT NULL,
  -- 'restaurants.country' when a country was recorded, 'unrecorded' when the
  -- strictest rule was applied by default.
  jurisdiction_source TEXT NOT NULL,
  facts_floor_years INTEGER NOT NULL,

  derived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A window of zero days would delete a vendor's reply the moment it landed.
  -- The margin is the floor by construction, and this states it so a bad
  -- derivation fails at the write rather than at the sweep.
  CONSTRAINT house_mail_retention_windows_figure_positive
    CHECK (figure_days > 0),
  CONSTRAINT house_mail_retention_windows_margin_positive
    CHECK (margin_days > 0),
  CONSTRAINT house_mail_retention_windows_span_present
    CHECK (
      (basis_kind = 'no_dispute_recorded' AND longest_dispute_days IS NULL)
      OR (basis_kind = 'dispute_span' AND longest_dispute_days IS NOT NULL)
    )
);

COMMENT ON TABLE public.house_mail_retention_windows IS
  'How long THIS house keeps the raw mail of a mirrored vendor reply, re-derived quarterly from the house''s own disputes (ADR 0118, retention). One row per restaurant. No row means no derivation has ever run for that house, which is different from a window of zero. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_mail_retention_windows.figure_days IS
  'The window the sweep obeys. Equals longest_dispute_days + margin_days when a dispute was found, and margin_days alone when none was. Re-derived quarterly; between derivations it is deliberately stale, which is what margin_days exists to absorb.';
COMMENT ON COLUMN public.house_mail_retention_windows.basis IS
  'The derivation in words, printed verbatim on the consent screen. A person consenting is owed the sentence, not a number with no provenance (GDPR Art. 5(1)(e); CCPA Cal. Civ. Code s.1798.100(a)(3)).';
COMMENT ON COLUMN public.house_mail_retention_windows.longest_dispute_days IS
  'The longest span, in days, from the start of a disputed order''s conversation to the settlement of its claim (or to now, while it is open). NULL when this house has recorded no dispute — never 0, which would read as "we measured and found nothing to keep".';
COMMENT ON COLUMN public.house_mail_retention_windows.jurisdiction IS
  'The resolved rule code (TR, GB, US, US-CA, UNKNOWN) that fixes the FACTS floor. It does NOT set the raw-mail window: no statute compels a processor to hold a copy of somebody''s mailbox. UNKNOWN means the strictest rule was applied because no country is recorded, and the consent screen says so.';

ALTER TABLE public.house_mail_retention_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_retention_windows_service_role
  ON public.house_mail_retention_windows;
CREATE POLICY house_mail_retention_windows_service_role
  ON public.house_mail_retention_windows
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_retention_windows FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Every sweep leaves a count, including the ones that changed nothing.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_mail_retention_sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- 'window_expired' — the scheduled sweep over this house's figure.
  -- 'grant_revoked'  — a person disconnected their grant; immediate, and the
  --                    window is irrelevant to it.
  reason TEXT NOT NULL CHECK (reason IN ('window_expired', 'grant_revoked')),

  -- The grant, when the sweep was a revocation. NULL for a window sweep.
  -- ON DELETE SET NULL, not CASCADE: the record that a revocation deleted mail
  -- must outlive the grant row it deleted it for.
  connection_id UUID REFERENCES public.integration_oauth_connections(id)
    ON DELETE SET NULL,

  -- Both are NOT NULL with no default reached by omission: `considered` is how
  -- many mirrored rows the sweep looked at, `deleted` is how many it changed.
  -- considered > 0 AND deleted = 0 is a real, meaningful outcome (nothing was
  -- past the window yet) and is exactly the row that must exist for the sweep's
  -- own health to be checkable. considered = 0 is equally real.
  considered INTEGER NOT NULL,
  deleted INTEGER NOT NULL,
  attachments_deleted INTEGER NOT NULL DEFAULT 0,

  -- The figure in force at the moment of a window sweep. NULL on a revocation
  -- sweep, where no figure applies.
  window_days INTEGER,

  -- Whether the owner of the grant was told, and what stopped it if not. A
  -- notice that could not be written must not disappear.
  notice TEXT,

  -- The last failure in words, or NULL. NULL means this run did not fail; it
  -- does NOT mean the sweep succeeded at deleting anything — that is `deleted`.
  error TEXT,

  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT house_mail_retention_sweeps_counts_nonneg
    CHECK (considered >= 0 AND deleted >= 0 AND attachments_deleted >= 0),
  CONSTRAINT house_mail_retention_sweeps_deleted_within_considered
    CHECK (deleted <= considered)
);

COMMENT ON TABLE public.house_mail_retention_sweeps IS
  'One row per retention sweep per house, written whether or not the sweep changed anything (ADR 0078''s count-is-recorded rule). A table that held only the sweeps that deleted something would make every rate computed over it 1.0 by construction, which is the fault this repo names as absence-reported-as-health. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_mail_retention_sweeps.considered IS
  'How many mirrored, not-yet-deleted rows this sweep looked at. Zero is a real answer and is written; it means this house has no mirrored mail, not that the sweep did not run.';
COMMENT ON COLUMN public.house_mail_retention_sweeps.deleted IS
  'How many of those had their raw mail replaced with a tombstone. Zero with considered > 0 means nothing was past the window yet, which is the ordinary daily outcome.';
COMMENT ON COLUMN public.house_mail_retention_sweeps.notice IS
  'What the owner of the grant was told, or the reason nothing could be sent. Never NULL-because-nobody-thought-about-it on a revocation sweep.';

CREATE INDEX IF NOT EXISTS idx_house_mail_retention_sweeps_restaurant
  ON public.house_mail_retention_sweeps (restaurant_id, ran_at DESC);

ALTER TABLE public.house_mail_retention_sweeps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_mail_retention_sweeps_service_role
  ON public.house_mail_retention_sweeps;
CREATE POLICY house_mail_retention_sweeps_service_role
  ON public.house_mail_retention_sweeps
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_mail_retention_sweeps FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  leaky   text;
  t       text;
BEGIN
  -- 5a. Both new tables exist, carry RLS, and grant a client role nothing.
  FOREACH t IN ARRAY ARRAY['house_mail_retention_windows',
                           'house_mail_retention_sweeps']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION '% was created without row-level security', t;
    END IF;

    SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ')
      INTO leaky
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = t
       AND grantee IN ('anon', 'authenticated');
    IF leaky IS NOT NULL THEN
      RAISE EXCEPTION '% grants privileges to a client role: %', t, leaky;
    END IF;
  END LOOP;

  -- 5b. Every column the service reads or writes.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='procurement_conversations'
      AND column_name='mirrored_by_grant_id')
  THEN missing := missing || 'procurement_conversations.mirrored_by_grant_id'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='procurement_conversations'
      AND column_name='raw_deleted_at')
  THEN missing := missing || 'procurement_conversations.raw_deleted_at'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='procurement_conversations'
      AND column_name='raw_deleted_reason')
  THEN missing := missing || 'procurement_conversations.raw_deleted_reason'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='conversation_attachments'
      AND column_name='bytes_deleted_at')
  THEN missing := missing || 'conversation_attachments.bytes_deleted_at'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_windows'
      AND column_name='figure_days')
  THEN missing := missing || 'house_mail_retention_windows.figure_days'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_windows'
      AND column_name='basis')
  THEN missing := missing || 'house_mail_retention_windows.basis'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_windows'
      AND column_name='jurisdiction')
  THEN missing := missing || 'house_mail_retention_windows.jurisdiction'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name='considered')
  THEN missing := missing || 'house_mail_retention_sweeps.considered'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name='deleted')
  THEN missing := missing || 'house_mail_retention_sweeps.deleted'; END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the retention columns did not apply: %',
      array_to_string(missing, ', ');
  END IF;

  -- 5c. `considered` and `deleted` must have NO default. A default of 0 would
  --     let an insert that forgot the count look exactly like a sweep that
  --     found nothing, which is the whole distinction this table exists to
  --     keep.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_mail_retention_sweeps'
      AND column_name IN ('considered', 'deleted')
      AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'house_mail_retention_sweeps.considered/deleted must have no default: an omitted count must fail, not read as zero';
  END IF;

  -- 5d. The added columns must be NULLABLE. A NOT NULL here would need a
  --     backfill, and there is no true value to backfill with.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='procurement_conversations'
      AND column_name IN ('mirrored_by_grant_id','raw_deleted_at','raw_deleted_reason')
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'the procurement_conversations retention columns must be nullable';
  END IF;

  -- 5e. The window table must refuse a zero-day window. A window of zero would
  --     delete a vendor''s reply on the day it arrived.
  BEGIN
    INSERT INTO public.house_mail_retention_windows (
      restaurant_id, figure_days, basis, basis_kind, longest_dispute_days,
      disputes_considered, margin_days, jurisdiction, jurisdiction_source,
      facts_floor_years
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', 0, 'assertion probe',
      'no_dispute_recorded', NULL, 0, 92, 'UNKNOWN', 'unrecorded', 10
    );
    RAISE EXCEPTION 'house_mail_retention_windows accepted a zero-day window';
  EXCEPTION
    WHEN check_violation THEN
      NULL; -- correct: the CHECK refused it before the FK was ever reached
    WHEN foreign_key_violation THEN
      RAISE EXCEPTION 'house_mail_retention_windows checked the FK before the zero-day CHECK, so the zero-day guard is unproven here';
  END;

  RAISE NOTICE 'retention: grant attribution, tombstone columns, window and sweep tables created and locked down.';
END
$$;
