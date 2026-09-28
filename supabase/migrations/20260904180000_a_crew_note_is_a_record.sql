-- A crew note is a RECORD, not a message that vanishes. (Founder, 2026-09-04;
-- /team parity follow-up, page note team.md §13.7.)
--
-- WHAT WAS WRONG
-- --------------
-- `/team`'s week strip could say what THIS PAGE had just sent and nothing else.
-- `POST …/team/broadcast` writes one notification row per recipient and no
-- route reads them back for a manager, so a note was gone on reload. The strip
-- had to say so in words — "an empty strip means not from here, this session"
-- — which is honest and useless: the manager still could not see what had been
-- said about the week, and could not see whether anyone had read it.
--
-- The read receipt that DOES exist is `schedule_receipts`, and it records
-- opening the SCHEDULE. Borrowing it for a note would have made "seen the
-- roster" and "read the message" the same fact, which they are not. So the note
-- gets its own receipt, per recipient, and the two stay apart.
--
-- THE WEEK IS THE KEY, NOT THE SCHEDULE
-- -------------------------------------
-- `schedule_id` is nullable on purpose: a manager writes "Saturday is moving to
-- seven" while the week is still a draft, and `schedules` may hold no row for it
-- yet. `week_start` is NOT NULL and is what the strip reads by, so a note
-- survives the schedule being created, published and re-published — all three of
-- which change or delete `schedules` rows.
--
-- WHY THE RECIPIENTS ARE ROWS
-- ---------------------------
-- A note names who it went to at the time it was sent. Recomputing "the active
-- linked crew" at read time would rewrite history every time somebody joined or
-- left: a note sent to four people would silently become a note sent to five.
-- `opened_at` is NULL until that person opens it, and NULL means unopened —
-- never "we did not look".
--
-- Idempotent: every CREATE is IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- 1. The note.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.team_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The week the note is ABOUT. Not derived from the schedule: see the header.
  week_start DATE NOT NULL,

  -- SET NULL, not CASCADE: re-publishing a week can replace its schedule row,
  -- and a note about the week must not be deleted because the schedule it
  -- happened to reference was.
  schedule_id UUID REFERENCES public.schedules(id) ON DELETE SET NULL,

  body TEXT NOT NULL CHECK (btrim(body) <> ''),

  -- `public.users`, never `auth.users`: the JWT carries `public.users.user_id`,
  -- and the two tables are disjoint — an FK to auth.users 23503s on every write
  -- and no CI check can catch it, because a fresh database has no rows to
  -- violate it.
  --
  -- RESTRICT: a note whose author has been deleted is a note nobody wrote, and
  -- the record's whole value is that it ends at a name.
  author_user_id UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,

  -- Which channels this note actually left by, as the send reported them.
  -- Recorded rather than assumed: the set is a per-send decision, and a note
  -- that reached only the inbox is a different fact from one that was pushed.
  channels TEXT[] NOT NULL DEFAULT ARRAY['inbox']::TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_notes_week
  ON public.team_notes (restaurant_id, week_start, created_at DESC);

COMMENT ON TABLE public.team_notes IS
  'A manager''s note about one week, kept as a record: the body, who wrote it, when, and which channels it left by. Keyed on week_start rather than on a schedule, because a note is written while the week is still a draft and must survive the schedule being created, published and re-published (2026-09-04, team.md §13.7).';

COMMENT ON COLUMN public.team_notes.schedule_id IS
  'The schedule that existed when the note was written, if any. SET NULL on delete: a note about the week outlives the schedule row it referenced.';

-- ---------------------------------------------------------------------------
-- 2. Who it went to, and who opened it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.team_note_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  note_id UUID NOT NULL
    REFERENCES public.team_notes(id) ON DELETE CASCADE,

  -- The roster row addressed AT THE TIME. See the header: recomputing the
  -- audience at read time would rewrite who a past note was sent to.
  member_id UUID NOT NULL
    REFERENCES public.team_members(id) ON DELETE CASCADE,

  -- NULL means UNOPENED. It has no default beyond that, and nothing may write
  -- a value here except the recipient opening the note.
  opened_at TIMESTAMPTZ
);

-- One row per person per note. Without this an "open" could be recorded twice
-- and a 4-person note could report 5 reads.
CREATE UNIQUE INDEX IF NOT EXISTS uq_team_note_recipients_note_member
  ON public.team_note_recipients (note_id, member_id);

CREATE INDEX IF NOT EXISTS idx_team_note_recipients_unopened
  ON public.team_note_recipients (member_id)
  WHERE opened_at IS NULL;

COMMENT ON TABLE public.team_note_recipients IS
  'Who a crew note was addressed to, captured at send time, with a per-person opened_at. NULL opened_at means unopened — never "not measured". Deliberately separate from schedule_receipts, which records opening the SCHEDULE and is a different fact.';

-- ---------------------------------------------------------------------------
-- 3. Locked down in the same file that creates it (OD-72/OD-73).
-- ---------------------------------------------------------------------------

ALTER TABLE public.team_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_notes_service_role ON public.team_notes;
CREATE POLICY team_notes_service_role
  ON public.team_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_notes FROM anon, authenticated;

ALTER TABLE public.team_note_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_note_recipients_service_role ON public.team_note_recipients;
CREATE POLICY team_note_recipients_service_role
  ON public.team_note_recipients
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_note_recipients FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  role_ text;
  priv  text;
  t     text;
  fk    text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_notes', 'team_note_recipients'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION '% has RLS off', t;
    END IF;
    FOREACH role_ IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      FOREACH priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege(role_, 'public.' || t, priv) THEN
          RAISE EXCEPTION '% is still %-able by %', t, priv, role_;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- The actor FK must point at public.users. An FK to auth.users would 23503
  -- on every write and no test on a fresh database could catch it, because
  -- there would be no row to violate.
  SELECT ccu.table_name INTO fk
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.constraint_schema = tc.constraint_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.constraint_schema = tc.constraint_schema
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_schema = 'public'
     AND tc.table_name = 'team_notes'
     AND kcu.column_name = 'author_user_id';
  IF fk IS DISTINCT FROM 'users' THEN
    RAISE EXCEPTION 'team_notes.author_user_id references %, not public.users', COALESCE(fk, 'nothing');
  END IF;

  -- Unopened must be expressible. A NOT NULL or a default here would make
  -- every recipient read as having opened the note the moment it was sent.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'team_note_recipients'
         AND column_name = 'opened_at') <> 'YES' THEN
    RAISE EXCEPTION 'opened_at is NOT NULL — an unopened note could not be represented';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'team_note_recipients'
         AND column_name = 'opened_at') IS NOT NULL THEN
    RAISE EXCEPTION 'opened_at has a default — every recipient would be born having read it';
  END IF;

  -- One open per person per note, enforced by the database rather than by the
  -- code path that happens to run first.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'team_note_recipients'
       AND indexname = 'uq_team_note_recipients_note_member'
  ) THEN
    RAISE EXCEPTION 'a recipient is not unique per note — one person could be counted twice';
  END IF;

  -- A note must survive its schedule. CASCADE here would delete the week's
  -- notes every time it is re-published.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
     WHERE r.relname = 'team_notes'
       AND c.contype = 'f'
       AND c.confdeltype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%schedules%'
  ) THEN
    RAISE EXCEPTION 'team_notes.schedule_id CASCADEs — re-publishing a week would delete its notes';
  END IF;

  RAISE NOTICE 'a crew note is a record: keyed on the week, authored by a public.users id, addressed to the roster rows it named at send time, and unopened until somebody opens it.';
END
$$;
