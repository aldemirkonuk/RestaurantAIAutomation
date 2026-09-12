-- The notification producers get a claim ledger and a run ledger.
--
-- WHAT THIS IS FOR
-- ----------------
-- `/notifications` gained five PRODUCERS on 2026-09-03 — goal reached, delivery
-- recorded at the door, invoice certified, the day's sale record, and a market
-- price signal. Every one of them is a SWEEP: a cron re-reads the same source
-- rows every tick and must decide, each time, whether it has already spoken.
--
-- WHY THE EXISTING DEDUPE IS NOT ENOUGH
-- -------------------------------------
-- `NotificationsService.persistForRestaurant` already accepts a `groupKey` plus
-- `dedupeWithinMinutes` and skips the write when a matching row exists in the
-- window (notifications.service.ts:648-663). Three producers in this repo use
-- it — the low-stock digest (low-stock-alerts.service.ts:389,403), receipt
-- verification and receipt discrepancy (procurement.service.ts:1753,1762 and
-- :2371,2382). It is a SELECT followed by an INSERT with nothing between them:
-- two gateway instances sweeping the same tenant on the same tick both read
-- "no row" and both insert. It is also WINDOWED, so a signal older than the
-- window silently repeats.
--
-- The shape that does not race is the one `calendar_reminder_dispatches` uses
-- (20260903101500): claim first, into a table with a UNIQUE index, and only
-- send if the claim was won. Two instances cannot both win an INSERT. This
-- migration generalises that table so every producer shares one ledger instead
-- of each growing its own.
--
-- WHY THE CLAIM IS PER PERSON AND NOT PER EVENT
-- ---------------------------------------------
-- Because quiet hours defer people, and a per-event claim would turn a deferral
-- into a permanent loss. A member inside their quiet window gets NO claim on
-- this tick, so the next sweep after the window closes serves them; a member
-- who is awake is claimed and written to now. With a per-event claim the first
-- tick would mark the event done for everyone and the sleeping member would
-- never receive it at all. `calendar_reminder_dispatches` is keyed
-- `(calendar_event_id, user_id)` for exactly this reason and this table keeps
-- the property.
--
-- WHAT `dedupe_key` IS
-- --------------------
-- The producer's own name for the thing that happened, unique inside one
-- restaurant and one producer, and STABLE across sweeps — that stability is the
-- whole mechanism. The five in use on the day this landed:
--
--   goal_reached       goal:<goalId>:<targetValue>   (target changes ⇒ new crossing)
--   delivery_recorded  receipt:<receiptEventId>
--   invoice_confirmed  document:<documentId>:<verifiedAt>
--   sale_record        service:<localDate>
--   market_price       product:<productKey>:<windowStartDate>
--
-- A key that embedded a timestamp of "now" would defeat the index and is the
-- one way to get this wrong; `low_stock_instant:${Date.now()}`
-- (low-stock-alerts.service.ts:341) is that mistake living in the tree today,
-- which is why it is named here rather than left for the next reader to find.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI
-- wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. One producer, one event, one person — for ever.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_producer_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which house. NOT NULL and taken from the tenant the sweep is serving
  -- (`ScheduledTenantsService.runPerTenant`, ADR 0022), never from a request.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Which producer spoke. Part of the unique key so two producers may use the
  -- same natural id (an order id, say) without colliding.
  producer TEXT NOT NULL CHECK (btrim(producer) <> ''),

  -- The producer's stable name for this event. See the header.
  dedupe_key TEXT NOT NULL CHECK (btrim(dedupe_key) <> ''),

  -- Who it was written for. `public.users(user_id)` — NOT `auth.users`: the two
  -- tables are disjoint and the JWT carries the public id, so an auth.users FK
  -- would 23503 on every insert (same reasoning as
  -- 20260903101500_calendar_reminders_have_a_ledger.sql:75-78).
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- When the sweep took the claim. Set before anything is written.
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL until the notification write actually returned. Never defaulted: a
  -- claim must not be able to certify its own delivery.
  delivered_at TIMESTAMPTZ,

  -- NULL means "claimed, outcome unknown" — a crash between claim and write.
  -- It is a real state and the status read names it.
  outcome TEXT CHECK (outcome IN ('written', 'failed')),

  -- The instant the underlying event actually happened, as the producer read
  -- it. It is NOT `claimed_at`: a goal crossed at 23:04 and delivered at 08:00
  -- the next morning because the reader was inside quiet hours must still say
  -- 23:04. The founder asked for "time of event" by name.
  occurred_at TIMESTAMPTZ,

  -- Why, when outcome is 'failed'. Prose, for a human reading the ledger.
  failure TEXT
);

-- The uniqueness that replaces a read-then-write race. This index IS the
-- idempotency guarantee; without it every producer here is a double-writer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_producer_claim
  ON public.notification_producer_claims
     (restaurant_id, producer, dedupe_key, user_id);

-- The sweep's own lookup: "have I already spoken about these events?"
CREATE INDEX IF NOT EXISTS idx_notification_producer_claims_lookup
  ON public.notification_producer_claims
     (restaurant_id, producer, claimed_at DESC);

-- Claimed and never confirmed — the crash state, so it can be reported rather
-- than counted as delivered.
CREATE INDEX IF NOT EXISTS idx_notification_producer_claims_unconfirmed
  ON public.notification_producer_claims (restaurant_id, claimed_at)
  WHERE delivered_at IS NULL AND outcome IS NULL;

-- ---------------------------------------------------------------------------
-- 2. One row per tenant per producer per sweep — the job's account of itself.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_producer_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  producer TEXT NOT NULL,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL means this sweep did not finish. Never defaulted: a run that died must
  -- not be indistinguishable from a run that completed.
  finished_at TIMESTAMPTZ,

  -- What the sweep saw and did. Counts, not adjectives.
  considered INTEGER NOT NULL DEFAULT 0,
  emitted INTEGER NOT NULL DEFAULT 0,
  deferred_quiet_hours INTEGER NOT NULL DEFAULT 0,
  already_claimed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,

  -- True when the candidate query hit its cap, so a short `considered` is never
  -- mistaken for a quiet house.
  truncated BOOLEAN NOT NULL DEFAULT FALSE,

  -- The producer's own sentence about why it did nothing, when "nothing" is the
  -- honest answer and an empty count would read as health. Example: the sale
  -- record producer writes "no POS check has ever landed for this restaurant"
  -- rather than emitting a zero-revenue summary.
  withheld_reason TEXT,

  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_producer_runs_restaurant
  ON public.notification_producer_runs (restaurant_id, producer, started_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Lock both down in the SAME migration that creates them (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_producer_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_producer_claims_service_role
  ON public.notification_producer_claims;
CREATE POLICY notification_producer_claims_service_role
  ON public.notification_producer_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.notification_producer_claims FROM anon, authenticated;

ALTER TABLE public.notification_producer_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_producer_runs_service_role
  ON public.notification_producer_runs;
CREATE POLICY notification_producer_runs_service_role
  ON public.notification_producer_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.notification_producer_runs FROM anon, authenticated;

COMMENT ON TABLE public.notification_producer_claims IS
  'One notification producer, one event, one person — for ever. The UNIQUE index on (restaurant_id, producer, dedupe_key, user_id) is the idempotency key: a sweep claims before it writes, so two gateway instances cannot both write. The claim is per person so quiet hours can DEFER a reader without losing the record. delivered_at NULL with outcome NULL means claimed-but-unconfirmed (a crash) and is reported as that, never as delivered. RLS on, service_role only, anon/authenticated revoked.';

COMMENT ON COLUMN public.notification_producer_claims.delivered_at IS
  'When the notification write actually returned. NULL means it did not — deliberately not defaulted to now(), so a claim cannot certify its own delivery.';

COMMENT ON COLUMN public.notification_producer_claims.occurred_at IS
  'When the underlying event happened, as the producer read it. Distinct from claimed_at: a goal crossed at 23:04 and delivered at 08:00 after quiet hours must still report 23:04.';

COMMENT ON TABLE public.notification_producer_runs IS
  'One row per tenant per producer per sweep. This is what /notifications renders as "last run": with no row the page says the producer has never run for this restaurant rather than showing a next-run time as if it were armed. withheld_reason carries the producer''s own sentence for a legitimate no-op, so absence is never reported as health. RLS on, service_role only.';

COMMENT ON COLUMN public.notification_producer_runs.finished_at IS
  'NULL means the sweep did not finish. Never defaulted: a run that died must not read as a run that completed.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  claim_cols  text[] := ARRAY[
    'id', 'restaurant_id', 'producer', 'dedupe_key', 'user_id',
    'claimed_at', 'delivered_at', 'outcome', 'occurred_at', 'failure'
  ];
  run_cols    text[] := ARRAY[
    'id', 'restaurant_id', 'producer', 'started_at', 'finished_at',
    'considered', 'emitted', 'deferred_quiet_hours', 'already_claimed',
    'failed', 'truncated', 'withheld_reason', 'error'
  ];
  t           text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_producer_claims',
                           'notification_producer_runs'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class
             WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;

    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE')
    THEN
      RAISE EXCEPTION '% is still reachable by anon/authenticated', t;
    END IF;
  END LOOP;

  FOREACH c IN ARRAY claim_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notification_producer_claims'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;
  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'notification_producer_claims is missing columns the gateway reads: %', absent_cols;
  END IF;

  FOREACH c IN ARRAY run_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'notification_producer_runs'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, c);
    END IF;
  END LOOP;
  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'notification_producer_runs is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The one index the whole design rests on. Without it every producer here is
  -- a double-writer and nothing above would fail.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'notification_producer_claims'
       AND indexname  = 'uq_notification_producer_claim'
  ) THEN
    RAISE EXCEPTION 'the (restaurant_id, producer, dedupe_key, user_id) unique index is missing — nothing prevents a producer writing the same event twice';
  END IF;

  -- Nullability that is load-bearing: a NOT NULL delivered_at would force every
  -- claim to invent a delivery that had not happened yet.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'notification_producer_claims'
         AND column_name = 'delivered_at') <> 'YES' THEN
    RAISE EXCEPTION 'delivered_at must be nullable — a claim cannot certify its own delivery';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'notification_producer_runs'
         AND column_name = 'finished_at') <> 'YES' THEN
    RAISE EXCEPTION 'finished_at must be nullable — a run that died must not read as one that completed';
  END IF;

  RAISE NOTICE 'notification_producer_claims and notification_producer_runs created, RLS on, anon/authenticated revoked, unique claim index present.';
END
$$;
