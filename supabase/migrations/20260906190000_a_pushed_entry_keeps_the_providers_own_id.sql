-- A pushed entry keeps the provider's own id, and every attempt says what happened.
--
-- ADR 0111 §5, connection direction 1 (PUSH). Built 2026-09-06.
-- ---------------------------------------------------------------------------
-- Mudavym writes its day-book entries into a Mudavym-OWNED SECONDARY calendar
-- on a connected Google account, under `calendar.app.created` -- the narrowest
-- scope Google publishes for the job ("Make secondary Google calendars, and
-- see, create, change, and delete events on them", read live from
-- https://developers.google.com/workspace/calendar/api/auth on 2026-09-06).
-- Nothing is read back. Nothing is two-way. That is directions 2 and 3.
--
-- The ADR names the cost of direction 1 exactly: "one mapping table (entry id
-- -> provider event id), one write per mutation, no sync token, no webhook",
-- and the risk exactly: "duplicates if the mapping is lost -- closed by an
-- idempotency key on (restaurant, entry, provider account) and by updating the
-- provider's own event id rather than searching."
--
-- Three tables, because the ADR's one mapping table needs two facts it cannot
-- hold: WHICH secondary calendar (created once per house-and-account, and its
-- id is the thing every write is addressed to) and WHAT HAPPENED on each
-- attempt.
--
--
-- WHY THE OUTCOME LOG IS A TABLE AND NOT A LOG LINE
-- ---------------------------------------------------------------------------
-- `absence-reported-as-health` is this repo's named cardinal fault, and a push
-- is its perfect habitat: when a push silently does not happen, the house's
-- calendar simply lacks an event, every count still reconciles against itself,
-- and nothing anywhere says a write was owed. An empty mapping table on a
-- connected house has to be readable as "0 of N pushed" and never as "in sync",
-- and that sentence needs a denominator (the house's entries), a numerator (the
-- mappings) and an account of the difference (these rows). Two of the three are
-- derivable; the third is not, so it is written down.
--
--
-- WHY `calendar_event_id` CARRIES NO FOREIGN KEY
-- ---------------------------------------------------------------------------
-- Deliberate, and the one place this schema departs from the house style.
-- A mapping's LAST job is removing the copy in Google after the original entry
-- is gone from `calendar_events`. An `ON DELETE CASCADE` would take the mapping
-- away in the same statement that deletes the entry, so the provider event
-- would be orphaned in somebody's Google account with nothing left pointing at
-- it -- permanently, silently, and un-enumerably. `ON DELETE SET NULL` cannot
-- apply to a NOT NULL column, and a nullable one loses the very id the delete
-- needs. So the column is a plain UUID, `deleted_locally_at` marks an entry the
-- house has removed, and the reconcile sweep retries the provider delete until
-- it lands. `check_fk_targets_exist.py` checks the FKs that exist; this comment
-- is why one does not.
--
--
-- WHY THE IDEMPOTENCY KEY IS ALSO THE GOOGLE EVENT ID
-- ---------------------------------------------------------------------------
-- Google Calendar accepts a client-supplied `id` on `events.insert` and answers
-- a second insert of the same id with 409 -- so a key that is BOTH our
-- uniqueness constraint and the provider's own identifier makes "one write per
-- mutation" idempotent at both ends with no search and no second round trip.
-- The id must be base32hex (RFC 4648 s.7: characters `0-9a-v`, length 5-1024),
-- and a lowercase hex digest is a strict subset of that alphabet, so the key is
-- `sha256(restaurant_id | calendar_event_id | connection_id)` in hex. The three
-- components are precisely the ADR's "(restaurant, entry, provider account)".
--
--
-- The Supabase CLI wraps each migration file in a transaction; no explicit
-- BEGIN/COMMIT, in line with every other file here. Everything is IF NOT
-- EXISTS / DROP-then-CREATE and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The secondary calendar. Created ONCE per (restaurant, provider account).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_push_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The grant this house pushes through. A grant is a PERSON's (ADR 0114), so
  -- the target names the connection and not a user: when the house stops using
  -- that grant, or the person revokes it, the target that depends on it goes
  -- with it and the register says the push has no way out any more.
  connection_id UUID NOT NULL
    REFERENCES public.integration_oauth_connections(id) ON DELETE CASCADE,

  provider VARCHAR(16) NOT NULL DEFAULT 'google'
    CHECK (provider IN ('google')),

  -- Google's own id for the secondary calendar it made for us. Every write is
  -- addressed to this; nothing is ever found by searching a title.
  provider_calendar_id TEXT NOT NULL CHECK (btrim(provider_calendar_id) <> ''),

  -- The title as we asked for it, so the register can say WHICH calendar in a
  -- person's Google account this house is writing into, in the words they will
  -- see there.
  provider_calendar_summary TEXT NOT NULL
    CHECK (btrim(provider_calendar_summary) <> ''),

  -- The IANA zone the calendar was created with, taken from the restaurant.
  time_zone TEXT,

  -- public.users(user_id), NEVER auth.users: the two tables are disjoint in
  -- production (5 rows vs 7, zero shared ids) and the JWT carries the
  -- public.users id, so an FK to auth.users 23503s on every write and no CI job
  -- can see it -- a fresh database has no rows to violate.
  created_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- "Creates the secondary calendar once per (restaurant, account)" -- the
  -- constraint, not a check in application code that two concurrent mutations
  -- would race past and leave the house with two calendars.
  CONSTRAINT uq_calendar_push_targets_house_account
    UNIQUE (restaurant_id, connection_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_push_targets_house
  ON public.calendar_push_targets (restaurant_id);

-- ---------------------------------------------------------------------------
-- 2. The mapping. One row per (entry, target).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_push_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  target_id UUID NOT NULL
    REFERENCES public.calendar_push_targets(id) ON DELETE CASCADE,

  -- No foreign key, on purpose. See the header.
  calendar_event_id UUID NOT NULL,

  -- sha256(restaurant | entry | connection), hex. Both our uniqueness
  -- constraint and the id Google is asked to store the event under.
  idempotency_key TEXT NOT NULL
    CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),

  -- NULL means: this entry is owed a copy and has not got one. That is the
  -- whole reconcile query, and the reason the column is nullable rather than
  -- the row being absent -- an absent row cannot say a push was attempted and
  -- refused.
  provider_event_id TEXT,

  last_verb VARCHAR(8) CHECK (last_verb IN ('create', 'update', 'delete')),
  last_pushed_at TIMESTAMPTZ,

  -- Set when the house deletes the entry. The mapping outlives the entry for
  -- exactly as long as it takes to remove the copy.
  deleted_locally_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_calendar_push_mappings_key UNIQUE (idempotency_key),
  CONSTRAINT uq_calendar_push_mappings_entry UNIQUE (target_id, calendar_event_id)
);

-- The reconcile's own query: this house's mappings that carry no provider id.
CREATE INDEX IF NOT EXISTS idx_calendar_push_mappings_unpushed
  ON public.calendar_push_mappings (restaurant_id)
  WHERE provider_event_id IS NULL;

-- The delete retry: copies whose original is gone and whose removal has not
-- landed.
CREATE INDEX IF NOT EXISTS idx_calendar_push_mappings_pending_delete
  ON public.calendar_push_mappings (restaurant_id)
  WHERE deleted_locally_at IS NOT NULL AND provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_push_mappings_event
  ON public.calendar_push_mappings (calendar_event_id);

-- ---------------------------------------------------------------------------
-- 3. What happened. Append-only.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.calendar_push_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- Both nullable: an attempt can fail BEFORE either exists -- no connection,
  -- credentials unconfigured, the house stopped using the grant. Those are the
  -- attempts most worth recording, because they are the ones that leave no
  -- other trace at all.
  target_id UUID REFERENCES public.calendar_push_targets(id) ON DELETE SET NULL,
  mapping_id UUID REFERENCES public.calendar_push_mappings(id) ON DELETE SET NULL,

  calendar_event_id UUID,

  verb VARCHAR(16) NOT NULL
    CHECK (verb IN ('create', 'update', 'delete', 'ensure_calendar')),

  -- Every state this push can end in, named. `delivered` is one of eight, which
  -- is the point: a status column with two values makes six different failures
  -- indistinguishable from each other and from success-with-nothing-to-do.
  outcome VARCHAR(24) NOT NULL CHECK (outcome IN (
    'delivered',          -- Google accepted the write.
    'not_connected',      -- no live google_calendar grant for this house.
    'unavailable',        -- the deployment has no Google credentials at all.
    'house_stopped',      -- a manager stopped the house using the grant (0114).
    'token_expired',      -- refresh failed; the connection row says reconnect.
    'rate_limited',       -- 429, or a 403 whose reason is a rate/quota error.
    'refused',            -- Google said no, for a reason recorded verbatim.
    'failed'              -- the call did not complete (network, timeout, bug).
  )),

  -- The provider's own HTTP status and its own reason string. Kept apart from
  -- `detail` so a reader can tell what Google said from what we said about it.
  provider_status INTEGER,
  provider_reason TEXT,

  -- One sentence a person can read, always present. Never blank: an outcome row
  -- with nothing in it is the silence this table exists to break.
  detail TEXT NOT NULL CHECK (btrim(detail) <> ''),

  -- Set only on 'rate_limited', from Retry-After when Google sends one.
  retry_after_seconds INTEGER CHECK (retry_after_seconds IS NULL OR retry_after_seconds >= 0),

  -- TRUE when this attempt came from the scheduled reconcile rather than from a
  -- person changing an entry. Both are real pushes; conflating them would make
  -- "the house pushed 40 times today" unreadable.
  from_reconcile BOOLEAN NOT NULL DEFAULT false,

  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_push_outcomes_house
  ON public.calendar_push_outcomes (restaurant_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_calendar_push_outcomes_event
  ON public.calendar_push_outcomes (calendar_event_id, attempted_at DESC);

CREATE OR REPLACE FUNCTION public.calendar_push_outcomes_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION
    'calendar_push_outcomes is append-only: % is not permitted. A later attempt is a NEW row.',
    TG_OP;
END
$function$;

DROP TRIGGER IF EXISTS trg_calendar_push_outcomes_append_only
  ON public.calendar_push_outcomes;
CREATE TRIGGER trg_calendar_push_outcomes_append_only
  BEFORE UPDATE OR DELETE ON public.calendar_push_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.calendar_push_outcomes_append_only();

-- ---------------------------------------------------------------------------
-- 4. "The connection row says reconnect."
--
-- ADR 0111 direction 1 requires that an expired token be VISIBLE on the grant
-- rather than inferred from a failure somebody has to go looking for. There was
-- nowhere to put that: `token_expires_at` is a timestamp that passes on every
-- healthy grant between refreshes, so reading it as "reconnect" would mark
-- every working connection broken once an hour.
--
-- Two columns, not a boolean: the SECOND one is why. A flag says a reconnect is
-- needed and cannot say what happened, and the person being asked to reconnect
-- is the only one who can decide whether the reason is theirs to fix.
-- ---------------------------------------------------------------------------

ALTER TABLE public.integration_oauth_connections
  ADD COLUMN IF NOT EXISTS reconnect_required_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reconnect_reason TEXT;

COMMENT ON COLUMN public.integration_oauth_connections.reconnect_required_at IS
  'Set when a refresh actually FAILED, never when a token merely expired -- token_expires_at passes on every healthy grant between refreshes. Cleared by a successful reconnect. NULL means "no refresh has failed", which is not the same as "this grant works": nothing has necessarily tried.';
COMMENT ON COLUMN public.integration_oauth_connections.reconnect_reason IS
  'The provider''s own words about why the refresh failed. A boolean flag would tell the person a reconnect is needed and not why, and they are the only one who can judge whether the reason is theirs to fix.';

-- ---------------------------------------------------------------------------
-- 5. Lock all three down in the SAME migration that creates them (OD-72/OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.calendar_push_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_push_targets_service_role ON public.calendar_push_targets;
CREATE POLICY calendar_push_targets_service_role
  ON public.calendar_push_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calendar_push_targets FROM anon, authenticated;

ALTER TABLE public.calendar_push_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_push_mappings_service_role ON public.calendar_push_mappings;
CREATE POLICY calendar_push_mappings_service_role
  ON public.calendar_push_mappings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calendar_push_mappings FROM anon, authenticated;

ALTER TABLE public.calendar_push_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calendar_push_outcomes_service_role ON public.calendar_push_outcomes;
CREATE POLICY calendar_push_outcomes_service_role
  ON public.calendar_push_outcomes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.calendar_push_outcomes FROM anon, authenticated;

COMMENT ON TABLE public.calendar_push_targets IS
  'The Mudavym-owned SECONDARY Google calendar this house pushes its day-book into, one per (restaurant, connected account) by constraint. Created under calendar.app.created, which can make secondary calendars and touch nothing else in the account. ADR 0111 §5 direction 1.';
COMMENT ON TABLE public.calendar_push_mappings IS
  'entry id -> provider event id, the mapping ADR 0111 §5 direction 1 names as the whole cost of push. provider_event_id NULL means a copy is OWED and absent -- which is what makes "0 of N pushed" sayable instead of "in sync". calendar_event_id deliberately carries no FK: the mapping must outlive the entry long enough to remove the copy.';
COMMENT ON TABLE public.calendar_push_outcomes IS
  'Append-only account of every push attempt: delivered, refused by Google with the reason, token expired, rate limited, or never attempted because nothing was connected. Eight outcomes rather than a boolean, because a push that silently did not happen leaves no other trace anywhere.';
COMMENT ON COLUMN public.calendar_push_mappings.idempotency_key IS
  'sha256(restaurant_id | calendar_event_id | connection_id) in lowercase hex -- exactly ADR 0111''s "(restaurant, entry, provider account)". Also the id Google stores the event under: hex is a strict subset of base32hex (RFC 4648 s.7), Calendar accepts a client-supplied id on insert, and a repeated insert answers 409 -- so a retry produces one provider event with no search.';
COMMENT ON COLUMN public.calendar_push_mappings.provider_event_id IS
  'Google''s own id for the copy. Every update and delete is addressed to THIS, never to a search: searching is how a push writes over somebody else''s event. NULL is a real state and means the copy is owed.';
COMMENT ON COLUMN public.calendar_push_mappings.deleted_locally_at IS
  'The house deleted the entry. The mapping stays until the copy in Google is gone, because "only we can delete" cuts both ways: a copy the house removed must actually be removed, and a copy removed IN GOOGLE comes back on the next push.';

-- ---------------------------------------------------------------------------
-- 6. Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t          text;
  missing    text;
  required   text[] := ARRAY[
    'calendar_push_targets', 'calendar_push_mappings', 'calendar_push_outcomes'
  ];
BEGIN
  FOREACH t IN ARRAY required LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% was not created', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('anon', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'INSERT') THEN
      RAISE EXCEPTION '% still grants a client role', t;
    END IF;
  END LOOP;

  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['reconnect_required_at', 'reconnect_reason']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'integration_oauth_connections'
      AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'integration_oauth_connections is missing: %', missing;
  END IF;

  -- The append-only trigger actually refuses, rather than merely existing.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_calendar_push_outcomes_append_only'
      AND tgrelid = to_regclass('public.calendar_push_outcomes')
  ) THEN
    RAISE EXCEPTION 'the append-only trigger on calendar_push_outcomes is absent';
  END IF;

  RAISE NOTICE 'calendar push: 3 tables locked down, 2 columns added, append-only trigger armed';
END $$;
