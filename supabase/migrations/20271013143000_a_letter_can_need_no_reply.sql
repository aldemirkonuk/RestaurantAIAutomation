-- A letter can need no reply (r28 mail audit, gap 4).
--
-- WHY
-- ---
-- A Mail thread stopped waiting only when a letter the house sent was stored
-- in it. A vendor's "Thanks!", an answer given by phone, or a reply sent from
-- Gmail that Mudavym never reads kept "N vendors are waiting on you" and the
-- tab badge up for good. These two functions let an owner or manager say a
-- received letter needs no reply, and take that back. What a mark does to
-- "waiting" is in mail_letter_rows, wrapped below, which reads the table
-- mail_letter_no_reply_marks that is created here.
--
-- WHO
-- ---
-- The gateway decides who may (owner or manager, MailService.setNoReply);
-- these decide what may be marked: a letter of THIS house that it received.
-- SECURITY INVOKER, EXECUTE for service_role only: the house is
-- caller-supplied, so a browser able to call these could mark another house's
-- mail.
--
-- WHY THE MARK IS A WRAPPER HERE AND NOT AN EDIT OF 20270421143700
-- ----------------------------------------------------------------
-- This migration used to edit the_mail_list_is_read_by_person in place, adding
-- no_reply_marked_at to mail_letter_rows' RETURNS TABLE. Two things break that:
--   * a database that already ran 20270421143700 never sees the edit, and
--   * 20270601090000, 20270610100100 and 20270620100000 CREATE OR REPLACE the
--     same function with the old 21-column table; Postgres refuses a changed
--     return type (42P13), so a reset died at 20270601090000, and had it not,
--     the newest body would have lost the mark.
-- So 20270421143700 stays as it was. This file sorts after all of them and
-- before 20271204100000 (which renames mail_letter_rows and wraps it again),
-- and puts the mark on top of whichever body is newest: the old function is
-- renamed to mail_letter_rows_without_marks and mail_letter_rows becomes a
-- wrapper that adds no_reply_marked_at and takes a settled letter out of
-- "owes". It copies no body, so a later or earlier edit of the inner function
-- stays whole. mail_thread_letters gained two result columns, so it is
-- dropped and created again (nothing else redefines it).

CREATE TABLE IF NOT EXISTS public.mail_letter_no_reply_marks (
  conversation_id uuid PRIMARY KEY
    REFERENCES public.procurement_conversations(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- public.users.id from the token (never auth.users); no foreign key, so a
  -- person who leaves does not take the house's mark with them.
  marked_by uuid,
  marked_at timestamp with time zone NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.mail_letter_no_reply_marks IS
  'A letter the house received that an owner or manager said needs no reply: it and every '
  'earlier letter of its thread stop making the thread wait (the_mail_list_is_read_by_person, '
  'r28 mail gap 4). Written only through mail_letter_mark_no_reply (a_letter_can_need_no_reply).';

CREATE INDEX IF NOT EXISTS idx_mail_letter_no_reply_marks_restaurant
  ON public.mail_letter_no_reply_marks (restaurant_id);

ALTER TABLE public.mail_letter_no_reply_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_letter_no_reply_marks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.mail_letter_no_reply_marks TO service_role;

ALTER FUNCTION public.mail_letter_rows(uuid, boolean, uuid)
  RENAME TO mail_letter_rows_without_marks;

COMMENT ON FUNCTION public.mail_letter_rows_without_marks(uuid, boolean, uuid) IS
  'mail_letter_rows as it was before the "needs no reply" mark; mail_letter_rows wraps it. '
  '(a_letter_can_need_no_reply)';

CREATE FUNCTION public.mail_letter_rows(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_provider_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  id uuid,
  provider_id uuid,
  thread_key text,
  order_id uuid,
  order_number_snapshot text,
  dir text,
  channel text,
  message_text text,
  email_headers jsonb,
  status text,
  ai_generated boolean,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  created_at timestamp with time zone,
  raw_deleted_at timestamp with time zone,
  mirrored_by_grant_id uuid,
  at timestamp with time zone,
  visible boolean,
  owes boolean,
  automatic boolean,
  duplicate boolean,
  no_reply_marked_at timestamp with time zone
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
-- Per thread, the newest letter the house marked as needing no reply: every
-- letter of that thread up to it, in (at, id) order, owes nothing.
WITH marks AS (
SELECT DISTINCT ON (mc.provider_id, mc.thread_key)
       mc.provider_id,
       mc.thread_key,
       COALESCE(CASE WHEN lower(mc.direction::text) = 'inbound'
                     THEN mc.received_at ELSE mc.sent_at END,
                mc.created_at) AS through_at,
       mc.id AS through_id
FROM public.mail_letter_no_reply_marks k
JOIN public.procurement_conversations mc
  ON mc.id = k.conversation_id
 AND mc.restaurant_id = p_restaurant_id
WHERE k.restaurant_id = p_restaurant_id
  AND (p_provider_id IS NULL OR mc.provider_id = p_provider_id)
ORDER BY mc.provider_id, mc.thread_key, through_at DESC, mc.id DESC
)
SELECT l.id, l.provider_id, l.thread_key, l.order_id, l.order_number_snapshot, l.dir,
       l.channel, l.message_text, l.email_headers, l.status, l.ai_generated,
       l.sent_at, l.received_at, l.created_at, l.raw_deleted_at, l.mirrored_by_grant_id,
       l.at,
       l.visible,
       -- Settled by a mark on this letter or a later one of its thread. Row
       -- comparison: the same (at, id) order the thread reads in.
       l.owes AND NOT COALESCE((l.at, l.id) <= (mk.through_at, mk.through_id), false),
       l.automatic,
       l.duplicate,
       own.marked_at
FROM public.mail_letter_rows_without_marks(p_restaurant_id, p_withhold_house_letters, p_provider_id) l
LEFT JOIN marks mk
  ON mk.provider_id = l.provider_id
 AND mk.thread_key = l.thread_key
LEFT JOIN public.mail_letter_no_reply_marks own
  ON own.conversation_id = l.id
 AND own.restaurant_id = p_restaurant_id;
$$;

COMMENT ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) IS
  'Every procurement_conversations row of a house (of one vendor, when named) the Mail tab '
  'reads, with its time, the visible/owes flags, and whether it is automatic mail or a second '
  'copy of a letter already stored (mail_letter_rows_without_marks, the newest body of the '
  'mail stack). A letter at or before a "needs no reply" mark of its thread owes nothing, and '
  'each row says when it was itself marked. The one definition the other mail functions share '
  '(a_letter_can_need_no_reply).';

DROP FUNCTION IF EXISTS public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer);

CREATE FUNCTION public.mail_thread_letters(
  p_restaurant_id uuid,
  p_thread_key text,
  p_provider_id uuid DEFAULT NULL::uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_before_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_before_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 51
) RETURNS TABLE(
  id uuid,
  provider_id uuid,
  provider_name text,
  direction text,
  channel text,
  message_text text,
  ai_generated boolean,
  status text,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  created_at timestamp with time zone,
  at timestamp with time zone,
  raw_deleted_at timestamp with time zone,
  mirrored_by_grant_id uuid,
  thread_subject text,
  order_id uuid,
  order_number text,
  order_status text,
  automatic boolean,
  no_reply_marked_at timestamp with time zone,
  thread_waiting boolean
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
-- Whose page this is: the vendor named, else the vendor of the thread's first
-- letter (by time, then id, so the same link always opens the same person).
WITH owner AS (
    SELECT COALESCE(p_provider_id, (
             SELECT c.provider_id
             FROM public.procurement_conversations c
             WHERE c.restaurant_id = p_restaurant_id
               AND c.thread_key = p_thread_key
               AND (p_withhold_house_letters IS NOT TRUE
                    OR c.status IS NULL
                    OR c.status::text NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
             ORDER BY COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                                    THEN c.received_at ELSE c.sent_at END,
                               c.created_at) ASC,
                      c.id ASC
             LIMIT 1)) AS provider_id
),
mine AS (
    SELECT l.*
    FROM owner o
    CROSS JOIN LATERAL public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, o.provider_id) l
    WHERE o.provider_id IS NOT NULL
      AND l.thread_key = p_thread_key
      AND NOT l.duplicate
),
-- The thread's subject is its first letter's that names one; its order is the
-- newest letter's that names one. Headers themselves never leave.
head AS (
    SELECT (array_agg(s.subject ORDER BY m.at ASC, m.id ASC)
              FILTER (WHERE s.subject IS NOT NULL))[1] AS subject,
           (array_agg(m.order_id ORDER BY m.at DESC, m.id DESC)
              FILTER (WHERE m.order_id IS NOT NULL))[1] AS order_id,
           (array_agg(m.order_number_snapshot ORDER BY m.at DESC, m.id DESC)
              FILTER (WHERE m.order_id IS NOT NULL))[1] AS order_number_snapshot,
           -- Whether the house owes this thread a reply: its newest visible
           -- letter owes one. The same rule as mail_thread_states' "waiting",
           -- over the whole thread, not the page.
           COALESCE((array_agg(m.owes ORDER BY m.at DESC, m.id DESC)
                       FILTER (WHERE m.visible))[1], false) AS waiting
    FROM mine m
    CROSS JOIN LATERAL (
        SELECT COALESCE(
                 NULLIF(btrim(m.email_headers->>'subject'), ''),
                 NULLIF(btrim(m.email_headers->>'Subject'), ''),
                 NULLIF(btrim(substring(left(m.message_text, 2000)
                                        FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), '')
               ) AS subject
    ) s
)
SELECT m.id,
       m.provider_id,
       pr.name::text,
       m.dir,
       m.channel,
       m.message_text,
       m.ai_generated,
       m.status,
       m.sent_at,
       m.received_at,
       m.created_at,
       m.at,
       m.raw_deleted_at,
       m.mirrored_by_grant_id,
       h.subject,
       h.order_id,
       COALESCE(po.order_number::text, h.order_number_snapshot),
       po.status::text,
       m.automatic,
       m.no_reply_marked_at,
       h.waiting
FROM mine m
CROSS JOIN head h
LEFT JOIN public.providers pr ON pr.id = m.provider_id
LEFT JOIN public.procurement_orders po
  ON po.id = h.order_id AND po.restaurant_id = p_restaurant_id
WHERE p_before_at IS NULL
   OR m.at < p_before_at
   OR (m.at = p_before_at AND m.id < p_before_id)
ORDER BY m.at DESC, m.id DESC
LIMIT greatest(1, least(COALESCE(p_limit, 51), 501));
$$;

COMMENT ON FUNCTION public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer) IS
  'One page of one vendor''s letters under one thread key, newest first by the letter''s own '
  'time, keyset-paged by (at desc, id desc). With no vendor named, the vendor of the thread''s '
  'first letter. Never two vendors. Each row carries when it was marked as needing no reply, '
  'and whether the thread is waiting on the house. (the_mail_list_is_read_by_person)';

REVOKE ALL ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer) TO service_role;

-- An owner's or manager's "this letter needs no reply" (gap 4). The gateway
-- decides who may; this decides what may be marked: a letter of THIS house
-- that the house received. Marking twice keeps the first mark.
CREATE OR REPLACE FUNCTION public.mail_letter_mark_no_reply(
  p_restaurant_id uuid,
  p_conversation_id uuid,
  p_marked_by uuid DEFAULT NULL::uuid
) RETURNS text
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER
    SET search_path = ''
    AS $$
DECLARE
  v_dir text;
BEGIN
  SELECT lower(c.direction::text)
    INTO v_dir
    FROM public.procurement_conversations c
   WHERE c.id = p_conversation_id
     AND c.restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_dir IS DISTINCT FROM 'inbound' THEN
    RETURN 'not_received';
  END IF;
  INSERT INTO public.mail_letter_no_reply_marks (conversation_id, restaurant_id, marked_by)
  VALUES (p_conversation_id, p_restaurant_id, p_marked_by)
  ON CONFLICT (conversation_id) DO NOTHING;
  RETURN 'marked';
END;
$$;

COMMENT ON FUNCTION public.mail_letter_mark_no_reply(uuid, uuid, uuid) IS
  'Marks one received letter of a house as needing no reply: not_found (no such letter in '
  'this house), not_received (the house sent it), or marked. (a_letter_can_need_no_reply)';


-- Taking the mark back: the thread waits again from the oldest letter the
-- mark had settled, unless another mark still covers it.
CREATE OR REPLACE FUNCTION public.mail_letter_unmark_no_reply(
  p_restaurant_id uuid,
  p_conversation_id uuid
) RETURNS text
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER
    SET search_path = ''
    AS $$
BEGIN
  PERFORM 1
     FROM public.procurement_conversations c
    WHERE c.id = p_conversation_id
      AND c.restaurant_id = p_restaurant_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  DELETE FROM public.mail_letter_no_reply_marks k
   WHERE k.conversation_id = p_conversation_id
     AND k.restaurant_id = p_restaurant_id;
  RETURN CASE WHEN FOUND THEN 'unmarked' ELSE 'not_marked' END;
END;
$$;

COMMENT ON FUNCTION public.mail_letter_unmark_no_reply(uuid, uuid) IS
  'Takes back the "needs no reply" mark on one letter of a house: not_found, not_marked, or '
  'unmarked. (a_letter_can_need_no_reply)';

REVOKE ALL ON FUNCTION public.mail_letter_mark_no_reply(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_letter_unmark_no_reply(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_letter_mark_no_reply(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_letter_unmark_no_reply(uuid, uuid) TO service_role;
