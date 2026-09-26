-- A meeting note gets its own table — not the calendar event description.
--
-- THE FOUNDER, 2026-09-21, answer (2), "Build all now":
--   meeting notes get their own table (not the calendar event description).
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS CLOSES
-- ---------------------------------------------------------------------------
-- `MeetingMemoPrompt` has asked for a note on every labeled calendar event
-- (provider meeting, call, tasting) since before this migration existed, and
-- `CalendarPage.tsx`'s `handleMemoSave` has always dropped what it collects:
--
--   const handleMemoSave = useCallback((_memo: MeetingMemo) => {
--     // Future: persist to documents API
--     setMemoPromptOpen(false)
--   }, [])
--
-- [[0111-the-calendar-is-the-houses-day-book]] already found and named this
-- (its "Note / memo" row: "Collected and discarded today... `MeetingMemoPrompt`
-- asks for notes and `handleMemoSave` drops them") and already designed the
-- fix: "the note gets its **own** table... rather than waiting on
-- `/documents-reports`, which has no upload path at all." This migration
-- builds that table, close to 0111's own shape
-- (`calendar_day_notes (restaurant_id, business_date, body, author,
-- created_at)`), with two additions the modal already collects and would
-- otherwise still discard: `doc_type` (0111's own five-kind model draws a
-- meeting memo, a call log and tasting notes differently) and `event_title`,
-- kept as a plain snapshot of what the note was written against — never a
-- foreign key to `calendar_events`, because a note is a day's marginalia
-- (0111 §1) and must survive that event being edited or deleted.
--
-- ---------------------------------------------------------------------------
-- WHY THE CALENDAR EVENT DESCRIPTION WAS NEVER THE ANSWER
-- ---------------------------------------------------------------------------
-- `calendar_events.description` is one text field the event form itself
-- writes (the event's own free-text field, shown on the event card). Folding
-- a meeting memo into it would mean two independent authors — "what this
-- event is" and "what was actually discussed" — racing to overwrite the same
-- column, and it would tie the note's lifetime to the event's: editing or
-- recreating the event would silently destroy the note. A note is its own
-- fact with its own author and moment, same as every other typed statement
-- this schema records as its own row (usual_currency, the price-code
-- mappings, the carrying-cost statements) rather than folding into a
-- neighbour column.
--
-- ---------------------------------------------------------------------------
-- WHY `business_date`, NOT AN EVENT ID
-- ---------------------------------------------------------------------------
-- 0111's entry model draws a note attached to a DAY, and only an Entry may be
-- edited on the calendar (0111 §1, "the rule that makes this one model rather
-- than five lists"). `event_title` is carried as a plain snapshot for display
-- context, never a foreign key — an event this note names can be renamed,
-- rescheduled or deleted without corrupting or cascading into the note.
--
-- ADDITIVE. One table, RLS, one index, comments. No existing table altered.

SET local statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.calendar_day_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- The day this note is marginalia for — never an event id. See header.
  business_date DATE NOT NULL,

  -- 0111's five-kind model draws each differently; matches
  -- `MeetingMemoPrompt`'s `DocType` union exactly (`MeetingMemoPrompt.tsx`).
  doc_type VARCHAR(32) NOT NULL DEFAULT 'general'
    CHECK (doc_type IN ('meeting_memo', 'call_log', 'tasting_notes', 'general')),

  -- A plain snapshot of the event title the note was written against, for
  -- display only. Never a foreign key — see header.
  event_title TEXT,

  body TEXT NOT NULL CHECK (btrim(body) <> ''),

  -- WHO wrote it and WHEN. `public.users`, never `auth.users` — the two
  -- tables are disjoint on this deployment (see
  -- `20260905240000_a_manager_states_what_a_code_means.sql` for the same
  -- note) — RESTRICT rather than SET NULL: a note by nobody is not a state
  -- this table admits.
  author UUID NOT NULL
    REFERENCES public.users(user_id) ON DELETE RESTRICT,
  -- The name AS IT WAS when written — an attestation, not a live join.
  author_name VARCHAR(200) NOT NULL CHECK (btrim(author_name) <> ''),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The day-book's own read: every note for a house's day, newest first.
CREATE INDEX IF NOT EXISTS idx_calendar_day_notes_house_day
  ON public.calendar_day_notes (restaurant_id, business_date, created_at DESC);

ALTER TABLE public.calendar_day_notes ENABLE ROW LEVEL SECURITY;

-- Same shape as every other gateway-owned table in this schema: the gateway
-- holds the service_role key and scopes every query by the restaurant_id in
-- the caller's JWT at the application layer (ProvidersService, CalendarService
-- and every sibling do the same — there is no per-row Postgres policy keyed
-- on auth.uid() anywhere in this schema to be consistent with). `anon` and
-- `authenticated` get nothing directly.
DROP POLICY IF EXISTS calendar_day_notes_service_role
  ON public.calendar_day_notes;
CREATE POLICY calendar_day_notes_service_role
  ON public.calendar_day_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.calendar_day_notes FROM anon, authenticated;

COMMENT ON TABLE public.calendar_day_notes IS
  'A day''s marginalia — what a human knows that no other table does (ADR 0111 §1). Written from MeetingMemoPrompt on a labeled calendar entry (provider meeting, call, tasting); attaches to a business_date, never to a specific calendar_events row, so editing or deleting that event cannot destroy the note. Built 2026-09-21 closing the "Collected and discarded today" gap ADR 0111 named.';
COMMENT ON COLUMN public.calendar_day_notes.event_title IS
  'A plain snapshot of the event this note was written against, for display only — never a foreign key. See the file header for why.';
COMMENT ON COLUMN public.calendar_day_notes.author IS
  'From public.users(user_id) — never auth.users, which is disjoint from it on this deployment.';
