-- A letter can need no reply (r28 mail audit, gap 4).
--
-- WHY
-- ---
-- A Mail thread stopped waiting only when a letter the house sent was stored
-- in it. A vendor's "Thanks!", an answer given by phone, or a reply sent from
-- Gmail that Mudavym never reads kept "N vendors are waiting on you" and the
-- tab badge up for good. These two functions let an owner or manager say a
-- received letter needs no reply, and take that back. What a mark does to
-- "waiting" is in mail_letter_rows (the_mail_list_is_read_by_person), which
-- also holds the table mail_letter_no_reply_marks.
--
-- WHO
-- ---
-- The gateway decides who may (owner or manager, MailService.setNoReply);
-- these decide what may be marked: a letter of THIS house that it received.
-- SECURITY INVOKER, EXECUTE for service_role only: the house is
-- caller-supplied, so a browser able to call these could mark another house's
-- mail.
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
