-- The house reads its own inbox — where a reading grant's cursor lives, and the
-- switch that has to be on before anything is read (ADR 0118, receive half).
--
-- WHAT THIS FILE IS FOR
-- --------------------
-- The founder let the sending grant stay send-only on condition that the house
-- can also RECEIVE on its own mailbox and have the whole conversation there, and
-- chose the shape: a second grant, read-only, house-declared and
-- person-consented. Two things that shape needs cannot be stored today.
--
--   1. **A cursor per grant.** A reader with no durable record of where it got
--      to re-reads a person's mail on every tick. `GmailWatchService` keeps the
--      SHARED mailbox's position in Redis under a 7-day TTL
--      (gmail-watch.service.ts:29,179), and there a lost key costs one re-sync
--      of a mailbox the deployment owns. Here it would cost a re-read of
--      somebody's private inbox, so it is a row.
--
--      `last_internal_date` is the operative cursor: Gmail's `after:` search
--      operator takes a UNIX timestamp, and `internalDate` is the same clock, so
--      the two compose exactly. `last_history_id` is recorded and is NOT the
--      cursor — `history.list` takes no `q`, so it cannot express "only mail
--      from the vendors in this house's book", which is the whole bound. The
--      column exists so a future per-grant `users.watch` has the value it needs,
--      and its comment says it is unused rather than leaving a reader to assume
--      otherwise.
--
--   2. **A per-restaurant switch that defaults OFF.** `restaurant_feature_flags`
--      is the EAV table with one reserved `restaurant_settings` row per
--      restaurant carrying the boolean columns (20260826120000). Reading a
--      mailbox needs both a person's consent AND the house's switch, because
--      consent is a fact about a person and the switch is a fact about a
--      deployment, and neither implies the other.
--
-- WHAT IT DELIBERATELY DOES NOT STORE
-- ----------------------------------
-- No subject, no sender, no body, no message id. The messages this reader
-- admits are published onto the same event the shared mailbox publishes and are
-- written by `RabbitMqBridgeService.handleInboundEmail` into
-- `procurement_conversations`, exactly as a shared-mailbox reply is. A message
-- it DISCARDS (Gmail's `from:` matches display names, so mail from outside the
-- book can come back from a query that only named book addresses) leaves
-- nothing at all — the count below is the only trace, and a count cannot
-- identify anybody. That is the point: the audit trail of what was refused must
-- not itself become a record of who wrote to this person.
--
-- ADDITIVE, NULLABLE, NO BACKFILL
-- ------------------------------
-- The new table starts empty by construction: a grant with no cursor row has
-- never been read, and the service seeds it at `now` and reads nothing on that
-- first tick. Writing a cursor for a grant that does not exist yet would be a
-- claim, not a default. The flag column is `NOT NULL DEFAULT false` because OFF
-- is the true answer for every restaurant on this deployment right now, and a
-- nullable switch would give "unset" and "off" the same behaviour under two
-- different names.
--
-- Idempotent and safe to re-run: CREATE TABLE / CREATE INDEX / ADD COLUMN use
-- IF NOT EXISTS, `enable row level security` is a no-op when already on, every
-- CREATE POLICY is preceded by DROP POLICY IF EXISTS, and REVOKE of an absent
-- privilege is a no-op. No explicit BEGIN/COMMIT — the Supabase CLI wraps each
-- file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Where a reading grant got to.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.house_inbox_cursors (
  -- ONE row per grant, not per restaurant. Two people in the same house may
  -- each consent, and each mailbox has its own position; keying on the
  -- restaurant would make the second consent silently overwrite the first's
  -- cursor and re-read or skip that person's mail.
  connection_id UUID PRIMARY KEY
    REFERENCES public.integration_oauth_connections(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The operative cursor: Gmail `internalDate`, milliseconds since the epoch.
  -- bigint because it will not fit in an int after 2038 and because Gmail
  -- returns it as a millisecond string.
  last_internal_date BIGINT NOT NULL,

  -- When reading started for this grant. Load-bearing for the promise on the
  -- consent screen: nothing older than this was ever read.
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  last_read_at TIMESTAMPTZ,
  -- The last failure, in words. NULL means the last run did not fail; it does
  -- NOT mean a run has happened (that is `last_read_at`).
  last_error TEXT,

  -- Counts from the last run only. Not a history: a per-message log of what was
  -- refused would rebuild the record this table exists to avoid keeping.
  last_listed INTEGER NOT NULL DEFAULT 0,
  last_admitted INTEGER NOT NULL DEFAULT 0,
  last_discarded INTEGER NOT NULL DEFAULT 0,

  -- Recorded, and NOT the cursor. See the header.
  last_history_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The reader asks "which houses am I reading for?" per surface request
-- (`statusFor`), and the sender line is on a page a manager opens often.
CREATE INDEX IF NOT EXISTS idx_house_inbox_cursors_restaurant
  ON public.house_inbox_cursors (restaurant_id);

COMMENT ON TABLE public.house_inbox_cursors IS
  'Where each house-declared, person-consented gmail_read grant got to. One row per grant. Holds no subject, sender, body or message id — admitted messages are written to procurement_conversations through the shared inbound path, and discarded ones leave only a count. RLS on, service_role only, anon/authenticated revoked.';
COMMENT ON COLUMN public.house_inbox_cursors.last_internal_date IS
  'Gmail internalDate in milliseconds. The operative cursor: the next run queries after:<this/1000> and admits only messages strictly newer. Seeded at the moment the grant is first read, so nothing that arrived before consent is ever fetched.';
COMMENT ON COLUMN public.house_inbox_cursors.last_history_id IS
  'Recorded for a future per-grant users.watch. NOT the cursor and not read by anything today: history.list accepts no q, so it cannot express "only the vendors in this house''s book", which is the bound the whole grant rests on.';
COMMENT ON COLUMN public.house_inbox_cursors.last_discarded IS
  'How many messages the last run fetched and threw away because their From was not an exact address in this house''s book. Gmail''s from: operator matches display names and partial tokens, so this is expected to be non-zero and a non-zero value is the second bound working, not a fault.';
COMMENT ON COLUMN public.house_inbox_cursors.last_error IS
  'The last failure in words, or NULL. NULL means the last run did not fail — it does NOT mean a run has happened; that is last_read_at.';

-- ---------------------------------------------------------------------------
-- 2. Lock it down in the SAME migration that creates it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.house_inbox_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS house_inbox_cursors_service_role
  ON public.house_inbox_cursors;
CREATE POLICY house_inbox_cursors_service_role
  ON public.house_inbox_cursors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.house_inbox_cursors FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The switch. OFF for every restaurant, including the ones that consent.
-- ---------------------------------------------------------------------------

ALTER TABLE public.restaurant_feature_flags
  ADD COLUMN IF NOT EXISTS enable_house_inbox_read boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurant_feature_flags.enable_house_inbox_read IS
  'On the ''restaurant_settings'' row only. TRUE lets the scheduled reader fetch vendor replies from the mailboxes this house has a gmail_read grant for, bounded to the addresses in its vendor book. Defaults FALSE and is read fails-closed: no row, a read error or a thrown client all mean OFF. Consent alone never starts a read.';

-- ---------------------------------------------------------------------------
-- 4. Assertions. A partial apply must fail here, not pass quietly.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
  leaky   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='house_inbox_cursors'
  ) THEN
    RAISE EXCEPTION 'house_inbox_cursors was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='house_inbox_cursors' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'house_inbox_cursors was created without row-level security';
  END IF;

  -- The reader runs as service_role. A client role with any privilege here
  -- could read where somebody''s mailbox has been read to.
  SELECT string_agg(DISTINCT grantee || ':' || privilege_type, ', ')
    INTO leaky
    FROM information_schema.role_table_grants
   WHERE table_schema='public'
     AND table_name='house_inbox_cursors'
     AND grantee IN ('anon','authenticated');
  IF leaky IS NOT NULL THEN
    RAISE EXCEPTION 'house_inbox_cursors grants privileges to a client role: %', leaky;
  END IF;

  -- Every column the service reads or writes.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_inbox_cursors'
      AND column_name='last_internal_date')
  THEN missing := missing || 'house_inbox_cursors.last_internal_date'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_inbox_cursors'
      AND column_name='started_at')
  THEN missing := missing || 'house_inbox_cursors.started_at'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_inbox_cursors'
      AND column_name='last_error')
  THEN missing := missing || 'house_inbox_cursors.last_error'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='house_inbox_cursors'
      AND column_name='last_discarded')
  THEN missing := missing || 'house_inbox_cursors.last_discarded'; END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='restaurant_feature_flags'
      AND column_name='enable_house_inbox_read')
  THEN missing := missing || 'restaurant_feature_flags.enable_house_inbox_read'; END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'the house inbox columns did not apply: %', array_to_string(missing, ', ');
  END IF;

  -- The switch must default to OFF. A default of true would turn reading on for
  -- every restaurant on the deployment the moment a person consented, which is
  -- the surprise the whole grant is shaped to avoid.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='restaurant_feature_flags'
      AND column_name='enable_house_inbox_read'
      AND column_default IS DISTINCT FROM 'false'
  ) THEN
    RAISE EXCEPTION 'enable_house_inbox_read does not default to false';
  END IF;

  RAISE NOTICE 'house inbox: cursors table created and locked down, enable_house_inbox_read added (default false).';
END
$$;
