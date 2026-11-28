-- A thread keeps the house's own notes (r110 mail-gap g5).
--
-- WHY
-- ---
-- A manager reading a vendor thread could only answer it or leave it. There
-- was nowhere to write "Ayşe: they promised a credit on the phone, chase
-- Friday" for the rest of the house, so it went into a reply draft, a chat
-- message or nowhere. Front's internal comments and Help Scout's notes are the
-- shape: words on the thread, for the house, never sent.
--
-- WHAT
-- ----
-- One row per note. A thread is the pair (person, thread_key): one Gmail
-- thread to two vendors is two threads (mail_thread_letters), so a note is
-- kept under the person it was written for as well as the key. person_key is
-- the Mail person key the gateway already reads: `vendor:<provider uuid>` or
-- `team:<address>` / `guest:<address>`, lower case.
--
-- A note is the HOUSE's, not a mailbox grant's. Nothing here refers to a
-- letter (procurement_conversations) or a grant (integration_oauth_connections):
--   * the raw-mail retention rule and revoke-by-provenance delete or re-point
--     letters, and a note is left exactly as it was;
--   * a note whose letters are gone is still read by (person, key), and the
--     gateway shows it under the person.
-- Deleting a note sets deleted_at (the writer's own, enforced in the gateway);
-- the row stays so the record of what the house wrote is not lost.
--
-- ACCESS
-- ------
-- RLS on, no policy, every client grant revoked: the house, the person and the
-- writer come from the verified token in the gateway (MailService), which reads
-- and writes with the service role. A browser holding the publishable key reads
-- and writes nothing here (scripts/check_new_tables_are_locked_down.py).
--
-- Version taken past every migration on the open r108-r110 branches at write
-- time; the merge guard re-numbers it if it collides.

CREATE TABLE IF NOT EXISTS public.mail_thread_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  person_key text NOT NULL
    CHECK (
      person_key ~ '^vendor:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR (person_key ~ '^(team|guest):[^\s:@A-Z]+@[^\s:@A-Z]+$'
          AND char_length(person_key) <= 330)
    ),
  thread_key text NOT NULL
    CHECK (char_length(thread_key) BETWEEN 1 AND 500),
  -- Trimmed by the gateway; never empty, never over 1000 characters.
  body text NOT NULL
    CHECK (char_length(body) BETWEEN 1 AND 1000 AND body = btrim(body)),
  -- public.users.user_id from the token (never auth.users); no foreign key,
  -- like mail_thread_seen.user_id and mail_letter_no_reply_marks.marked_by.
  written_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

COMMENT ON TABLE public.mail_thread_notes IS
  'The house''s own notes on a Mail thread (r110 mail-gap g5): read by the house, never sent. '
  'Keyed by (restaurant_id, person_key, thread_key); no reference to a letter or a grant, so '
  'retention and revoke-by-provenance leave notes alone. Service role only. '
  '(a_thread_keeps_the_houses_own_notes)';

CREATE INDEX IF NOT EXISTS idx_mail_thread_notes_thread
  ON public.mail_thread_notes (restaurant_id, person_key, thread_key, created_at)
  WHERE deleted_at IS NULL;

ALTER TABLE public.mail_thread_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_thread_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mail_thread_notes TO service_role;
