-- Mail remembers what each person has seen (r36 mail audit, gap 6, second half).
--
-- WHY
-- ---
-- Mail had no unread state. A person coming back after a week could not tell
-- which vendor letters had come in since they last looked: "waiting on you"
-- says the house owes a reply, which is not the same as "you have not read
-- this". A letter marked "needs no reply", or one a colleague answered, still
-- ought to read as new to someone who never opened it.
--
-- WHAT
-- ----
-- One row per person, house, vendor and thread: the time of the newest letter
-- of that thread this person was shown. A thread is new to a person when its
-- newest letter came from the vendor and is later than that time (or the
-- person has no row). The gateway (MailService) compares; this file only
-- stores and reads the times.
--
-- The time stored is a LETTER's time, never the clock. mail_thread_mark_seen
-- takes the newest letter the screen showed and keeps the smaller of it and
-- the thread's real newest letter, so
--   * a letter that arrives between the read and the mark stays new, and
--   * a caller cannot mark a thread seen past the letters it holds.
-- Because every stored time is at most that thread's newest letter, the
-- largest time over a vendor's threads equals the vendor's newest letter only
-- when the thread holding it was seen. That is the person row's rule
-- (mail_seen_through_by_person).
--
-- The row is keyed by thread_key. If two threads are joined later
-- (one_conversation_is_one_thread re-keys rows), the joined thread reads as new
-- once more: it errs toward showing, never toward hiding.
--
-- ACCESS
-- ------
-- The person and the house come from the verified token in the gateway, never
-- the request. Table and functions are for service_role only: the house and
-- the person are caller-supplied here, so a browser able to call these could
-- read or write another person's marks.

CREATE TABLE IF NOT EXISTS public.mail_thread_seen (
  -- public.users.id from the token (never auth.users); no foreign key, like
  -- mail_letter_no_reply_marks.marked_by.
  user_id uuid NOT NULL,
  restaurant_id uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL,
  thread_key text NOT NULL
    CHECK (char_length(thread_key) BETWEEN 1 AND 500),
  -- The newest letter of this thread this person was shown.
  seen_through timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, restaurant_id, provider_id, thread_key)
);

COMMENT ON TABLE public.mail_thread_seen IS
  'Per person, house, vendor and thread: the newest letter that person was shown in Mail '
  '(r36 mail gap 6). A thread whose newest letter came from the vendor after this time is '
  'new to them. Written only through mail_thread_mark_seen. '
  '(mail_remembers_what_each_person_has_seen)';

CREATE INDEX IF NOT EXISTS idx_mail_thread_seen_restaurant
  ON public.mail_thread_seen (restaurant_id);

ALTER TABLE public.mail_thread_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_thread_seen FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.mail_thread_seen TO service_role;


-- A person was shown a thread through the letter at p_through. Returns the
-- time now kept (never earlier than one kept before), or NULL when the thread
-- has no letter that came or went between this house and this vendor.
CREATE OR REPLACE FUNCTION public.mail_thread_mark_seen(
  p_restaurant_id uuid,
  p_user_id uuid,
  p_provider_id uuid,
  p_thread_key text,
  p_through timestamp with time zone
) RETURNS timestamp with time zone
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER
    SET search_path = ''
    AS $$
DECLARE
  v_last timestamp with time zone;
  v_kept timestamp with time zone;
BEGIN
  IF p_through IS NULL OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- The thread's newest letter that came or went. Drafts, queued and refused
  -- letters are not letters here, the same as in the Mail list.
  SELECT s.last_visible_at
    INTO v_last
    FROM public.mail_thread_states(p_restaurant_id, true, p_provider_id) s
   WHERE s.thread_key = p_thread_key;
  IF v_last IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.mail_thread_seen AS m
         (user_id, restaurant_id, provider_id, thread_key, seen_through)
  VALUES (p_user_id, p_restaurant_id, p_provider_id, p_thread_key,
          least(p_through, v_last))
  ON CONFLICT (user_id, restaurant_id, provider_id, thread_key) DO UPDATE
     SET seen_through = greatest(m.seen_through, EXCLUDED.seen_through),
         updated_at = now()
  RETURNING m.seen_through INTO v_kept;
  RETURN v_kept;
END;
$$;

COMMENT ON FUNCTION public.mail_thread_mark_seen(uuid, uuid, uuid, text, timestamp with time zone) IS
  'Keeps the newest letter of one thread a person was shown: the smaller of p_through and the '
  'thread''s newest letter, never earlier than a time kept before. NULL when the thread has '
  'no letter between this house and this vendor. (mail_remembers_what_each_person_has_seen)';


-- Per vendor, the latest seen_through over that vendor's threads, for one
-- person in one house. One row per vendor however many threads it has, so a
-- page of people never reads more than a page of rows.
CREATE OR REPLACE FUNCTION public.mail_seen_through_by_person(
  p_restaurant_id uuid,
  p_user_id uuid,
  p_provider_ids uuid[]
) RETURNS TABLE(provider_id uuid, seen_through timestamp with time zone)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
SELECT m.provider_id, max(m.seen_through) AS seen_through
FROM public.mail_thread_seen m
WHERE m.restaurant_id = p_restaurant_id
  AND m.user_id = p_user_id
  AND m.provider_id = ANY (p_provider_ids)
GROUP BY m.provider_id;
$$;

COMMENT ON FUNCTION public.mail_seen_through_by_person(uuid, uuid, uuid[]) IS
  'For one person in one house, the latest seen_through over each named vendor''s threads. '
  '(mail_remembers_what_each_person_has_seen)';

REVOKE ALL ON FUNCTION public.mail_thread_mark_seen(uuid, uuid, uuid, text, timestamp with time zone)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_seen_through_by_person(uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_thread_mark_seen(uuid, uuid, uuid, text, timestamp with time zone)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_seen_through_by_person(uuid, uuid, uuid[])
  TO service_role;
