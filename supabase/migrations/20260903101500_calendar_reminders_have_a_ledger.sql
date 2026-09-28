-- calendar reminders become a server job, and a server job that keeps a ledger.
--
-- WHAT THIS REPLACES
-- ------------------
-- `calendar_events.reminder_enabled` / `.reminder_days_before` / `.reminder_sent`
-- have existed since the production baseline
-- (20260805000000_baseline_from_production.sql:2357-2360). Two of the three were
-- written by the API and read by nothing; the third, `reminder_sent`, was read
-- once — `calendar.service.ts:1118` maps it into the response — and **written
-- nowhere in `apps/` or `services/`** (calendar.md §10). The only thing that ever
-- fired a calendar reminder was a `localStorage` queue drained by a poller booted
-- in the browser (`apps/web/src/lib/reminder-scheduler.ts:9,247`), so a reminder
-- set on the office laptop did not exist on the phone and none fired with the tab
-- closed. calendar.md §13.1 asked for exactly this migration's other half.
--
-- WHY TWO TABLES AND NOT A BOOLEAN
-- --------------------------------
-- A boolean on the event cannot answer either of the two questions the page has
-- to answer honestly:
--
--   1. *Did it go to me?* Quiet hours are a per-USER preference
--      (`notification_preferences.quiet_hours_*`), and the funnel this job writes
--      through — `NotificationsService.persistForRestaurant` — inserts one row per
--      member. So one event can be delivered to three of five members now and to
--      the other two at 08:00. `reminder_sent` cannot hold that, and a job that
--      flipped it after serving three of five would silently strand the other two.
--      `calendar_reminder_dispatches` holds one row per (event, person), and its
--      UNIQUE index is what makes a double-send structurally impossible — not a
--      read-then-write race that two gateway instances would both win.
--
--   2. *Is the job even running?* A page that says "reminders are handled" while
--      the process that handles them has been down for a day is the
--      absence-reported-as-health fault (ADR 0020). `calendar_reminder_runs` is
--      the evidence: one row per tenant per sweep, with what it considered and
--      what it did. `GET /calendar/reminders/status` renders the newest one, and
--      says "this job has never run for this restaurant" when there is none —
--      never a computed next-run time standing in for a run that did not happen.
--
-- CLAIM BEFORE SEND, AND THE ORPHAN IS VISIBLE
-- --------------------------------------------
-- The job INSERTs the dispatch row first and only then writes the notification,
-- so a crash mid-flight loses a reminder rather than sending it twice — the
-- trade the brief names. It is not a silent loss: `sent_at` stays NULL with
-- `outcome` NULL, and the status endpoint reports those rows as "claimed, never
-- confirmed" instead of counting them as delivered. `sent_at` is therefore
-- nullable ON PURPOSE and is asserted so below: defaulting it to now() would make
-- every claim certify its own delivery.
--
-- WHAT A ROW IS NOT
-- -----------------
-- A dispatch row is not proof anyone read anything. It records that this house
-- wrote a notification row for that person for that event, once. Push delivery,
-- email, and whether the phone was on are all outside it.
--
-- Idempotent and safe to re-run. No explicit BEGIN/COMMIT: the Supabase CLI wraps
-- each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. One reminder, one person, one event — for ever.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_reminder_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which house. NOT NULL and taken from the tenant the sweep is serving, never
  -- from a request body.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The stored row the reminder is about. A client-expanded virtual occurrence
  -- has no row here and therefore gets no reminder — see the ADR; that limit is
  -- stated on the page rather than hidden.
  calendar_event_id UUID NOT NULL
    REFERENCES public.calendar_events(id) ON DELETE CASCADE,

  -- Who it was written for. `public.users(user_id)` — NOT `auth.users`: the two
  -- tables are disjoint and the JWT carries the public id, so an auth.users FK
  -- would 23503 on every insert.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- The instant the reminder became due, computed in the RESTAURANT's timezone.
  due_at TIMESTAMPTZ NOT NULL,

  -- When the sweep took the claim. Set before anything is sent.
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL until the notification write actually returned. Never defaulted.
  sent_at TIMESTAMPTZ,

  -- NULL means "claimed, outcome unknown" — a crash between claim and send. It
  -- is a real state and the status endpoint names it.
  outcome TEXT CHECK (outcome IN ('sent', 'expired', 'failed')),

  -- Why, when outcome is 'failed'. Prose, for a human reading the ledger.
  failure TEXT
);

-- The uniqueness that replaces a read-then-write race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_reminder_dispatch_event_user
  ON public.calendar_reminder_dispatches (calendar_event_id, user_id);

-- The status endpoint's read: this house's most recent dispatches.
CREATE INDEX IF NOT EXISTS idx_calendar_reminder_dispatches_restaurant
  ON public.calendar_reminder_dispatches (restaurant_id, claimed_at DESC);

-- The orphan sweep: claimed and never confirmed.
CREATE INDEX IF NOT EXISTS idx_calendar_reminder_dispatches_unconfirmed
  ON public.calendar_reminder_dispatches (restaurant_id, claimed_at)
  WHERE sent_at IS NULL AND outcome IS NULL;

-- ---------------------------------------------------------------------------
-- 2. One row per tenant per sweep — the job's own account of itself.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_reminder_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The `runPerTenant` job name, so a second calendar job can share this table
  -- without either one's history reading as the other's.
  job_name TEXT NOT NULL DEFAULT 'calendar-reminders',

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL means this sweep did not finish. Never defaulted: a run that died must
  -- not be indistinguishable from a run that completed.
  finished_at TIMESTAMPTZ,

  -- What the sweep saw and did. Counts, not adjectives.
  considered INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0,
  deferred_quiet_hours INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,

  -- True when the candidate query hit its cap, so a short `considered` is never
  -- mistaken for a quiet calendar.
  truncated BOOLEAN NOT NULL DEFAULT FALSE,

  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_calendar_reminder_runs_restaurant
  ON public.calendar_reminder_runs (restaurant_id, started_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Lock both down in the SAME migration that creates them (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.calendar_reminder_dispatches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_reminder_dispatches_service_role
  ON public.calendar_reminder_dispatches;
CREATE POLICY calendar_reminder_dispatches_service_role
  ON public.calendar_reminder_dispatches
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calendar_reminder_dispatches FROM anon, authenticated;

ALTER TABLE public.calendar_reminder_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_reminder_runs_service_role
  ON public.calendar_reminder_runs;
CREATE POLICY calendar_reminder_runs_service_role
  ON public.calendar_reminder_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calendar_reminder_runs FROM anon, authenticated;

COMMENT ON TABLE public.calendar_reminder_dispatches IS
  'One calendar reminder, one person, one event — for ever. The UNIQUE index on (calendar_event_id, user_id) is the idempotency key: the sweep claims the row before it sends, so two gateway instances cannot both send. sent_at NULL with outcome NULL means claimed-but-unconfirmed (a crash), and is reported as such rather than counted as delivered. RLS on, service_role only.';

COMMENT ON COLUMN public.calendar_reminder_dispatches.sent_at IS
  'When the notification write actually returned. NULL means it did not — deliberately not defaulted to now(), so a claim cannot certify its own delivery.';

COMMENT ON TABLE public.calendar_reminder_runs IS
  'One row per tenant per sweep of the calendar-reminders cron. This is what /calendar renders as "last run": with no row the page says the job has never run for this restaurant, instead of showing a computed next-run time as if the job were armed. RLS on, service_role only.';

COMMENT ON COLUMN public.calendar_reminder_runs.finished_at IS
  'NULL means the sweep did not finish. Never defaulted: a run that died must not read as a run that completed.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  t           text;
  tbls        text[] := ARRAY[
    'calendar_reminder_dispatches', 'calendar_reminder_runs'
  ];
  dispatch_cols text[] := ARRAY[
    'id', 'restaurant_id', 'calendar_event_id', 'user_id', 'due_at',
    'claimed_at', 'sent_at', 'outcome', 'failure'
  ];
  run_cols text[] := ARRAY[
    'id', 'restaurant_id', 'job_name', 'started_at', 'finished_at',
    'considered', 'sent', 'deferred_quiet_hours', 'expired', 'failed',
    'truncated', 'error'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
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

  FOREACH c IN ARRAY dispatch_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'calendar_reminder_dispatches'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'dispatches.' || c);
    END IF;
  END LOOP;

  FOREACH c IN ARRAY run_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'calendar_reminder_runs'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'runs.' || c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'calendar reminder ledger is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The index that makes a double-send impossible. Without it this whole design
  -- is a read-then-write race, so its absence must fail the migration.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'calendar_reminder_dispatches'
      AND indexname = 'uq_calendar_reminder_dispatch_event_user'
  ) THEN
    RAISE EXCEPTION 'the (calendar_event_id, user_id) unique index is missing — nothing prevents a double send';
  END IF;

  -- The two columns whose NULLability is load-bearing.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'calendar_reminder_dispatches'
         AND column_name = 'sent_at') <> 'YES' THEN
    RAISE EXCEPTION 'sent_at must be nullable — a claim must not certify its own delivery';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'calendar_reminder_runs'
         AND column_name = 'finished_at') <> 'YES' THEN
    RAISE EXCEPTION 'finished_at must be nullable — a run that died must not read as one that finished';
  END IF;

  RAISE NOTICE 'calendar reminder ledger created, RLS on, anon/authenticated revoked, unique dispatch key present.';
END
$$;
