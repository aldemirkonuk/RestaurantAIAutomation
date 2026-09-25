-- A recommendations digest goes to a member who asked for it — and every one
-- that was due leaves a row saying what happened to it.
--
-- WHAT WAS THERE BEFORE
-- ---------------------
-- `recommendation_digest_prefs` (production baseline) holds one row per HOUSE:
-- `digest_enabled`, `digest_hour`, `digest_min_urgency`, `recipient_email`,
-- `last_sent_at`. It was written by `PUT /analytics/recommendations/:rid/digest`
-- and read back by the GET beside it, and by nothing else: no scheduler, no job,
-- no mail. `last_sent_at` was never written (page note recommendations.md §9).
-- The founder's answer of 2026-09-16 (ADR 0149, row 26) was "Build the sender".
--
-- WHY A SECOND TABLE FOR THE PERSON
-- ---------------------------------
-- The house row answers "does this house run a digest, at what hour, from what
-- urgency up". It cannot answer "did THIS PERSON ask to receive it", and a
-- digest is mail into a person's own inbox. Two facts, two rows, both required
-- before anything is sent — the same consent-plus-switch shape the house inbox
-- reader already uses (`enable_house_inbox_read` and a `gmail_read` grant).
-- A member with no row here has not asked, and is sent nothing. There is no
-- default subscription and none is created for anybody by this file.
--
-- `frequency` has no DEFAULT on purpose: a subscription is a choice a person
-- makes, and a column that answers "daily" for somebody who never chose would
-- be the seeded-default fault in schema form. `weekday` is ISO (1 = Monday) and
-- is present exactly when the frequency is weekly.
--
-- An unsubscribe is a soft stop (`unsubscribed_at`, `unsubscribed_via`), never a
-- delete: "this person stopped it by the link in the mail on this date" is the
-- record a house needs when somebody asks why the digest stopped.
--
-- WHY THE SEND LOG IS ALSO THE LOCK
-- ---------------------------------
-- The gateway may run as several instances, and every one of them runs the
-- sweep. The UNIQUE `(restaurant_id, user_id, period_key)` index is the
-- idempotency key: a send is preceded by an INSERT … ON CONFLICT DO NOTHING of
-- its row, and only the instance whose insert came back owns the send. Two
-- instances sweeping the same house at the same instant cannot both win it, so
-- they cannot both mail (the shape `calendar_reminder_dispatches` proved,
-- 20260903101500).
--
-- `period_key` is the house-local DATE the digest was due on, for daily and
-- weekly alike. Keying on the date rather than on "daily:…"/"weekly:…" means a
-- person who switches from daily to weekly on the day their weekly falls due
-- still gets one digest that day, not two.
--
-- OUTCOME IS NULLABLE AND STAYS NULL UNTIL SOMETHING IS KNOWN
-- ----------------------------------------------------------
-- NULL = claimed, outcome unknown (a crash between the claim and the provider's
-- answer). It is never retried — retrying mail whose delivery is unknown is how
-- a person gets it twice — and it is reported as unknown rather than counted as
-- delivered. The other outcomes:
--   sent          the provider accepted it; `sent_at` and `provider_message_id`
--   failed        the provider refused or threw; `reason` carries its words
--   skipped_empty nothing stood at or above the house's urgency when it was due;
--                 `reason` says what the engine evaluated and found
--   expired       it went unsent past the late limit of its due time; `reason`
--                 says so and lists the POSSIBLE causes (quiet hours, email or
--                 category off, membership or address, sender off or failing, no
--                 sweep), because the sweeps that did not send it recorded none.
--                 One exception writes no row: a due that is past the limit AND
--                 predates the latest save of the house's digest row or of the
--                 subscription, which may never have been owed.
-- `sent_at` is set exactly when the outcome is `sent`, and a non-sent terminal
-- outcome must say why. The CHECKs below are written with `coalesce` because a
-- CHECK whose expression evaluates to NULL PASSES in Postgres: `outcome = 'sent'`
-- on a NULL outcome would let a claimed row carry a delivery time.
--
-- PROVENANCE, NOT A COPY OF THE NUMBERS
-- -------------------------------------
-- The digest quotes the engine's own sentences and recomputes nothing. What is
-- kept is WHICH entries went out (`rule_keys`), how many rules the engine
-- evaluated, and when it read (`engine_generated_at`) — enough to answer "what
-- did that mail say and where did it come from" without storing the prose twice.
--
-- NO TOKEN IS STORED. `unsubscribe_token_hash` is the SHA-256 (lowercase hex) of
-- a 32-byte random token carried only in that one mail's unsubscribe link. A
-- leaked dump of this table cannot stop anybody's digest.
--
-- FK TARGETS. `user_id` references `public.users(user_id)` — NOT `auth.users`.
-- The two tables share zero ids in this deployment and the JWT carries the
-- public id, so an auth.users FK would 23503 on the first insert and no CI check
-- would catch it (a fresh database has no rows to violate).
--
-- Additive, idempotent and safe to re-run: CREATE … IF NOT EXISTS throughout, no
-- existing column is altered, no row is written or deleted. No explicit
-- BEGIN/COMMIT: the Supabase CLI wraps each migration file in a transaction.

-- ---------------------------------------------------------------------------
-- 1. Who asked
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recommendation_digest_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which house's digest. Taken from the session's active restaurant, never
  -- from a request body.
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Who asked. The person themselves — nobody subscribes anybody else.
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- The person's choice. No DEFAULT: see the header.
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),

  -- ISO weekday, 1 = Monday … 7 = Sunday. Present exactly when weekly.
  weekday SMALLINT CHECK (weekday BETWEEN 1 AND 7),

  -- When this subscription (or its latest resubscription) began.
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Moves when the frequency or weekday changes, on a resubscription, and on a
  -- stop; a re-save of the same choice writes nothing. A due time earlier than
  -- this that went unsent past the late limit is not recorded `expired` (the
  -- change may be what made it due); a TIMELY due is sent whatever this says.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL while active. Never defaulted.
  unsubscribed_at TIMESTAMPTZ,

  -- Which door stopped it: the link in a mail, or the person's own session.
  unsubscribed_via TEXT CHECK (unsubscribed_via IN ('link', 'settings')),

  CONSTRAINT recommendation_digest_subscriptions_weekly_names_a_day
    CHECK ((frequency = 'weekly') = (weekday IS NOT NULL)),
  CONSTRAINT recommendation_digest_subscriptions_a_stop_names_its_door
    CHECK ((unsubscribed_at IS NULL) = (unsubscribed_via IS NULL))
);

-- One subscription per person per house.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_digest_subscriptions_member
  ON public.recommendation_digest_subscriptions (restaurant_id, user_id);

-- The sweep's read: this house's active subscriptions.
CREATE INDEX IF NOT EXISTS idx_recommendation_digest_subscriptions_active
  ON public.recommendation_digest_subscriptions (restaurant_id)
  WHERE unsubscribed_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. What happened to each digest that was due
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recommendation_digest_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,

  -- The house-local date the digest was due on. With the two ids, the
  -- idempotency key.
  period_key TEXT NOT NULL CHECK (period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),

  -- The frequency that made it due, as it stood at the claim.
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),

  -- The instant it fell due, computed on the house's wall clock.
  due_at TIMESTAMPTZ NOT NULL,

  -- The zone that wall clock was read in. `UTC` for a house with no zone set,
  -- which the mail itself says.
  time_zone TEXT NOT NULL CHECK (btrim(time_zone) <> ''),

  -- Set by the claim, before anything is sent.
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- NULL until the outcome is known. Never defaulted.
  finished_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  outcome TEXT CHECK (outcome IN ('sent', 'failed', 'skipped_empty', 'expired')),

  -- One sentence, for a person reading the log.
  reason TEXT,

  -- Provenance of what the mail carried. NULL when nothing was composed.
  entries_count INTEGER CHECK (entries_count >= 0),
  rule_keys TEXT[],
  rules_evaluated INTEGER CHECK (rules_evaluated >= 0),
  engine_generated_at TIMESTAMPTZ,

  provider_message_id TEXT,

  -- SHA-256 hex of the unsubscribe token in this mail. Never the token.
  unsubscribe_token_hash TEXT CHECK (unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT recommendation_digest_sends_sent_at_means_sent
    CHECK (sent_at IS NULL OR coalesce(outcome, '') = 'sent'),
  CONSTRAINT recommendation_digest_sends_sent_has_a_time
    CHECK (coalesce(outcome, '') <> 'sent' OR sent_at IS NOT NULL),
  CONSTRAINT recommendation_digest_sends_a_miss_says_why
    CHECK (
      coalesce(outcome, '') NOT IN ('failed', 'skipped_empty', 'expired')
      OR (reason IS NOT NULL AND btrim(reason) <> '')
    )
);

-- THE IDEMPOTENCY KEY. Without it every sentence above is a hope.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_digest_sends_period
  ON public.recommendation_digest_sends (restaurant_id, user_id, period_key);

-- The unsubscribe read: one hash, one row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recommendation_digest_sends_token
  ON public.recommendation_digest_sends (unsubscribe_token_hash)
  WHERE unsubscribe_token_hash IS NOT NULL;

-- The house's log, newest first.
CREATE INDEX IF NOT EXISTS idx_recommendation_digest_sends_house
  ON public.recommendation_digest_sends (restaurant_id, claimed_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Lock both down in the SAME migration that creates them (OD-72 / OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.recommendation_digest_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_digest_subscriptions_service_role
  ON public.recommendation_digest_subscriptions;
CREATE POLICY recommendation_digest_subscriptions_service_role
  ON public.recommendation_digest_subscriptions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.recommendation_digest_subscriptions FROM anon, authenticated;

ALTER TABLE public.recommendation_digest_sends ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_digest_sends_service_role
  ON public.recommendation_digest_sends;
CREATE POLICY recommendation_digest_sends_service_role
  ON public.recommendation_digest_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.recommendation_digest_sends FROM anon, authenticated;

COMMENT ON TABLE public.recommendation_digest_subscriptions IS
  'One person asking for one house''s recommendations digest. No row = not asked = nothing sent; nothing creates a row for anybody but the person themselves. Soft stop via unsubscribed_at/unsubscribed_via, never a delete. RLS on, service_role only.';

COMMENT ON TABLE public.recommendation_digest_sends IS
  'One row per digest that fell due for a subscribed member, claimed BEFORE the send. UNIQUE (restaurant_id, user_id, period_key) is the idempotency key: two gateway instances cannot both win the insert, so they cannot both mail. outcome NULL = claimed, outcome unknown (never retried, never counted as delivered). RLS on, service_role only.';

COMMENT ON COLUMN public.recommendation_digest_sends.unsubscribe_token_hash IS
  'SHA-256 hex of the 32-byte random token carried only in this mail''s unsubscribe link. The token itself is never stored.';

COMMENT ON COLUMN public.recommendation_digest_sends.sent_at IS
  'When the provider accepted the mail. NULL unless outcome = sent — deliberately not defaulted, so a claim cannot certify its own delivery.';

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  absent_cols text;
  c           text;
  t           text;
  sub_cols    text[] := ARRAY[
    'id', 'restaurant_id', 'user_id', 'frequency', 'weekday', 'subscribed_at',
    'updated_at', 'unsubscribed_at', 'unsubscribed_via'
  ];
  send_cols   text[] := ARRAY[
    'id', 'restaurant_id', 'user_id', 'period_key', 'frequency', 'due_at',
    'time_zone', 'claimed_at', 'finished_at', 'sent_at', 'outcome', 'reason',
    'entries_count', 'rule_keys', 'rules_evaluated', 'engine_generated_at',
    'provider_message_id', 'unsubscribe_token_hash'
  ];
BEGIN
  FOREACH t IN ARRAY ARRAY['recommendation_digest_subscriptions', 'recommendation_digest_sends'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;

    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
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

  FOREACH c IN ARRAY sub_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'recommendation_digest_subscriptions'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'recommendation_digest_subscriptions.' || c);
    END IF;
  END LOOP;

  FOREACH c IN ARRAY send_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'recommendation_digest_sends'
        AND column_name = c
    ) THEN
      absent_cols := concat_ws(', ', absent_cols, 'recommendation_digest_sends.' || c);
    END IF;
  END LOOP;

  IF absent_cols IS NOT NULL THEN
    RAISE EXCEPTION 'the digest sender is missing columns the gateway reads: %', absent_cols;
  END IF;

  -- The idempotency key must exist AND be unique over exactly these columns.
  -- An index of the right name over the wrong columns would let two instances
  -- both mail the same person, and nothing downstream would notice.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE i.indrelid = to_regclass('public.recommendation_digest_sends')
      AND i.indisunique
      AND ic.relname = 'uq_recommendation_digest_sends_period'
      AND (
        SELECT array_agg(a.attname::text ORDER BY k.ord)
        FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      ) = ARRAY['restaurant_id', 'user_id', 'period_key']
  ) THEN
    RAISE EXCEPTION 'uq_recommendation_digest_sends_period is not UNIQUE (restaurant_id, user_id, period_key) — two instances could both send';
  END IF;

  -- The nullabilities that are load-bearing. A NOT NULL outcome would force a
  -- claim to invent a result; a NOT NULL sent_at would force it to invent a
  -- delivery; a DEFAULTed frequency would subscribe a person to a choice they
  -- never made.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'recommendation_digest_sends'
         AND column_name = 'outcome') <> 'YES' THEN
    RAISE EXCEPTION 'outcome must be nullable — a claim does not yet know what happened';
  END IF;

  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'recommendation_digest_sends'
         AND column_name = 'sent_at') <> 'YES' THEN
    RAISE EXCEPTION 'sent_at must be nullable — an unsent digest has no delivery time';
  END IF;

  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'recommendation_digest_subscriptions'
         AND column_name = 'frequency') IS NOT NULL THEN
    RAISE EXCEPTION 'frequency must have no default — a subscription is a choice a person makes';
  END IF;
END $$;
