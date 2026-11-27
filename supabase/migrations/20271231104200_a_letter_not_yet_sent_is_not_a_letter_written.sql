-- A letter the house has not sent is not a letter it wrote (r104 mail fixer, finding 1 on #2044).
--
-- #2044 writes a reply to a guest or a team member as an outbound row that is HOUSE_QUEUED, SENDING, SENT,
-- HOUSE_FAILED or HOUSE_CANCELLED. The vendor path counts only SENT, AUTO_SENT, SEND_UNCONFIRMED (or no
-- status with sent_at); the team and guest reads had no such rule, so an Undo or a failed send put the
-- person at the top of the list with the unsent words as the last line and "you wrote last", and raised the
-- header's out today.
--
-- mail_other_rows gains `visible` (the vendor rule, mail_letter_rows.sent_or_in). The header's other_today
-- counts visible letters only. The people list ranks, and reads last line and direction from, visible rows
-- only. A thread's last time and direction come from visible letters (every row when none is). The thread
-- read (mail_thread_letters_other) keeps every row: its status chips tell the truth about an unsent one.
-- Same signatures as before except mail_other_rows (a column added: DROP and CREATE, grants re-applied).

DROP FUNCTION public.mail_other_rows(uuid, boolean, text, text);
CREATE FUNCTION public.mail_other_rows(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_kind text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
) RETURNS TABLE(
  id uuid,
  kind text,
  address text,
  thread_key text,
  dir text,
  channel text,
  message_text text,
  ai_generated boolean,
  status text,
  sent_at timestamp with time zone,
  received_at timestamp with time zone,
  created_at timestamp with time zone,
  raw_deleted_at timestamp with time zone,
  mirrored_by_grant_id uuid,
  at timestamp with time zone,
  subject text,
  automatic boolean,
  visible boolean
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH rows AS (
    SELECT c.id, c.kind, c.from_address, c.thread_key, lower(c.direction::text) AS dir,
           c.channel::text AS channel, c.message_text, c.ai_generated, c.status::text AS status,
           c.sent_at, c.received_at, c.created_at, c.raw_deleted_at, c.mirrored_by_grant_id,
           COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                         THEN c.received_at ELSE c.sent_at END, c.created_at) AS at,
           COALESCE(NULLIF(btrim(c.email_headers->>'subject'), ''),
                    NULLIF(btrim(c.email_headers->>'Subject'), ''),
                    NULLIF(btrim(substring(left(c.message_text, 2000)
                                           FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), '')) AS subject,
           COALESCE(lower(c.direction::text) = 'inbound'
            AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                 OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false) AS automatic,
           -- Sent or received, never a draft, a queued, a sending, a failed or a cancelled letter: the vendor
           -- path's rule (mail_letter_rows.sent_or_in). Without it an unsent reply counted as written.
           COALESCE(lower(c.direction::text) = 'inbound'
            OR (lower(c.direction::text) = 'outbound'
                AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                     OR (c.status IS NULL AND c.sent_at IS NOT NULL))), false) AS visible,
           -- One letter delivered to two mailboxes has one Message-ID: the first row stored is the letter.
           COALESCE(lower(c.direction::text) = 'inbound'
            AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL
            AND row_number() OVER (PARTITION BY c.from_address, lower(btrim(c.message_id::text)),
                                                (lower(c.direction::text) = 'inbound'
                                                 AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL)
                                   ORDER BY c.created_at ASC, c.id ASC) > 1, false) AS duplicate
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
      AND p_withhold_house_letters IS NOT TRUE
      AND c.kind <> 'vendor'
      AND c.from_address IS NOT NULL
      AND (p_kind IS NULL OR c.kind = p_kind)
      AND (p_address IS NULL OR c.from_address = p_address)
)
SELECT r.id, r.kind, r.from_address, r.thread_key, r.dir, r.channel, r.message_text,
       r.ai_generated, r.status, r.sent_at, r.received_at, r.created_at, r.raw_deleted_at,
       r.mirrored_by_grant_id, r.at, r.subject, r.automatic, r.visible
FROM rows r
WHERE NOT r.duplicate;
$$;

CREATE OR REPLACE FUNCTION public.mail_inbox_summary(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_zone text DEFAULT NULL
) RETURNS TABLE(
  waiting_people integer,
  oldest_wait_at timestamp with time zone,
  in_today integer,
  out_today integer,
  house_mailbox_last_at timestamp with time zone,
  whatsapp_last_at timestamp with time zone,
  mudavym_mail_last_at timestamp with time zone,
  in_30d integer
)
    LANGUAGE plpgsql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
DECLARE
  v_tz text := NULLIF(btrim(p_zone), '');
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_since timestamptz := now() - interval '30 days';
BEGIN
  PERFORM 1 FROM public.restaurants r WHERE r.id = p_restaurant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mail_inbox_summary: no restaurant %', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_tz IS NOT NULL THEN
    v_day_start := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;
    v_day_end := (date_trunc('day', now() AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz;
  END IF;

  RETURN QUERY
  WITH people AS (
      SELECT (count(DISTINCT s.provider_id) FILTER (WHERE s.waiting))::integer AS waiting_people,
             min(s.waiting_since) FILTER (WHERE s.waiting) AS oldest_wait_at
      FROM public.mail_thread_states(p_restaurant_id, p_withhold_house_letters, NULL) s
  ),
  letters AS (
      SELECT l.dir, l.channel, l.mirrored_by_grant_id, l.at, l.visible, l.automatic, l.duplicate
      FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l
  ),
  others AS (
      SELECT o.dir, o.at
      FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters) o
      WHERE NOT o.automatic AND o.visible
  ),
  counted AS (
      SELECT CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE l.dir = 'inbound' AND l.visible
                                   AND l.at >= v_day_start AND l.at < v_day_end))::integer END AS in_today,
             CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE l.dir = 'outbound' AND l.visible
                                   AND l.at >= v_day_start AND l.at < v_day_end))::integer END AS out_today,
             (count(*) FILTER (WHERE l.dir = 'inbound' AND l.visible AND l.at >= v_since))::integer AS in_30d,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NOT NULL)
               AS house_mailbox_last_at,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NULL
                                 AND lower(l.channel) = 'whatsapp') AS whatsapp_last_at,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NULL
                                 AND lower(l.channel) IS DISTINCT FROM 'whatsapp')
               AS mudavym_mail_last_at
      FROM letters l
  ),
  other_today AS (
      SELECT CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE o.dir = 'inbound'
                                   AND o.at >= v_day_start AND o.at < v_day_end))::integer END AS in_today,
             CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE o.dir = 'outbound'
                                   AND o.at >= v_day_start AND o.at < v_day_end))::integer END AS out_today,
             (count(*) FILTER (WHERE o.dir = 'inbound' AND o.at >= v_since))::integer AS in_30d
      FROM others o
  )
  SELECT p.waiting_people, p.oldest_wait_at,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.in_today + t.in_today END,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.out_today + t.out_today END,
         c.house_mailbox_last_at, c.whatsapp_last_at, c.mudavym_mail_last_at,
         c.in_30d + t.in_30d
  FROM people p CROSS JOIN counted c CROSS JOIN other_today t;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_mail_people(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_waiting_only boolean DEFAULT false,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_query text DEFAULT NULL::text,
  p_kind text DEFAULT NULL::text
) RETURNS TABLE(
  key text,
  kind text,
  provider_id uuid,
  name text,
  last_at timestamp with time zone,
  last_line text,
  last_direction text,
  waiting boolean,
  waiting_since timestamp with time zone,
  open_threads integer,
  channels text[],
  newest_open_order_id uuid,
  newest_open_order_number text,
  unsent_status text
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH q AS (
    SELECT public.mail_search_pattern(p_query) AS pat
),
-- No one of these is ever waiting, so "waiting only" lists none of them. Machines are not people.
ranked AS (
    -- Straight off the book (no copy rule, so no window over the whole house): a copy of a
    -- letter lands in the same minute as the original, so it moves no one's place.
    SELECT c.kind, c.from_address AS address,
           (c.kind || ':' || c.from_address) COLLATE "C" AS key,
           max(COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                             THEN c.received_at ELSE c.sent_at END, c.created_at)) AS last_at,
           -- the words are read only when a search asks for them
           COALESCE(bool_or(CASE WHEN q.pat IS NULL THEN false ELSE c.message_text ~* q.pat END), false) AS text_hit
    FROM public.procurement_conversations c
    CROSS JOIN q
    WHERE c.restaurant_id = p_restaurant_id
      AND p_withhold_house_letters IS NOT TRUE
      AND p_waiting_only IS NOT TRUE
      AND c.kind <> 'vendor'
      AND (p_kind IS NULL OR c.kind = p_kind)
      AND c.from_address IS NOT NULL
      -- Sent or received only: an unsent reply is not the person's last word.
      AND (lower(c.direction::text) = 'inbound'
           OR (lower(c.direction::text) = 'outbound'
               AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                    OR (c.status IS NULL AND c.sent_at IS NOT NULL))))
      AND NOT COALESCE(lower(c.direction::text) = 'inbound'
            AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                 OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false)
    GROUP BY c.kind, c.from_address
),
page AS (
    SELECT r.kind, r.address, r.key, r.last_at
    FROM ranked r
    CROSS JOIN q
    WHERE (q.pat IS NULL OR r.address ~* q.pat OR r.text_hit)
      AND (p_after_at IS NULL
           OR r.last_at < p_after_at
           OR (r.last_at = p_after_at AND r.key > (p_after_key COLLATE "C")))
    ORDER BY r.last_at DESC, r.key COLLATE "C" ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 500))
),
others AS (
    -- The page's people only. A copy shares its original's thread, channel, words and direction, so none of
    -- these aggregates needs the copy rule.
    SELECT pg.kind, pg.address, pg.key, pg.last_at,
           (array_agg(c.id ORDER BY at_of.at DESC, c.id DESC))[1] AS last_id,
           (array_agg(lower(c.direction::text) ORDER BY at_of.at DESC, c.id DESC))[1] AS last_direction,
           count(DISTINCT c.thread_key)::integer AS threads,
           array_agg(DISTINCT lower(c.channel::text)) AS channels
    FROM page pg
    JOIN public.procurement_conversations c
      ON c.restaurant_id = p_restaurant_id AND c.kind = pg.kind AND c.from_address = pg.address
    CROSS JOIN LATERAL (SELECT COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                                             THEN c.received_at ELSE c.sent_at END, c.created_at) AS at) at_of
    WHERE (lower(c.direction::text) = 'inbound'
           OR (lower(c.direction::text) = 'outbound'
               AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                    OR (c.status IS NULL AND c.sent_at IS NOT NULL))))
      AND NOT COALESCE(lower(c.direction::text) = 'inbound'
            AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                 OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false)
    GROUP BY pg.kind, pg.address, pg.key, pg.last_at
),
merged AS (
    SELECT v.key, v.kind, v.provider_id, v.name, v.last_at, v.last_line,
           v.last_direction, v.waiting, v.waiting_since, v.open_threads,
           v.channels, v.newest_open_order_id, v.newest_open_order_number,
           v.unsent_status
    FROM public.list_mail_vendors(p_restaurant_id, p_withhold_house_letters,
           p_waiting_only, p_after_at, p_after_key, p_limit, p_query) v
    WHERE p_kind IS NULL OR p_kind = 'vendor'
    UNION ALL
    SELECT p.key::text, p.kind, NULL::uuid, p.address, p.last_at,
           public.mail_preview(lc.message_text), p.last_direction, false,
           NULL::timestamptz, p.threads, p.channels, NULL::uuid, NULL::text,
           NULL::text
    FROM others p
    LEFT JOIN public.procurement_conversations lc
      ON lc.id = p.last_id AND lc.restaurant_id = p_restaurant_id
)
SELECT m.key, m.kind, m.provider_id, m.name, m.last_at, m.last_line,
       m.last_direction, m.waiting, m.waiting_since, m.open_threads,
       m.channels, m.newest_open_order_id, m.newest_open_order_number,
       m.unsent_status
FROM merged m
ORDER BY m.last_at DESC, m.key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

CREATE OR REPLACE FUNCTION public.list_mail_threads_other(
  p_restaurant_id uuid,
  p_kind text,
  p_address text,
  p_withhold_house_letters boolean DEFAULT true,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  thread_key text,
  subject text,
  message_count bigint,
  letter_count bigint,
  last_at timestamp with time zone,
  last_direction text,
  waiting boolean,
  order_id uuid,
  order_number text
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH t AS (
    SELECT o.thread_key, count(*) AS n, count(*) FILTER (WHERE NOT o.automatic) AS letters,
           -- The newest letter that is a letter; the newest of all only when every row is automatic.
           -- Sent or received only (an unsent reply is not the thread's last word); a thread with none
           -- falls back to every row, so it still has a time.
           COALESCE((array_agg(o.at ORDER BY o.automatic ASC, o.at DESC, o.id DESC) FILTER (WHERE o.visible))[1],
                    (array_agg(o.at ORDER BY o.automatic ASC, o.at DESC, o.id DESC))[1]) AS last_at,
           COALESCE((array_agg(o.dir ORDER BY o.automatic ASC, o.at DESC, o.id DESC) FILTER (WHERE o.visible))[1],
                    (array_agg(o.dir ORDER BY o.automatic ASC, o.at DESC, o.id DESC))[1]) AS dir,
           (array_agg(o.subject ORDER BY o.at ASC, o.id ASC)
              FILTER (WHERE o.subject IS NOT NULL))[1] AS subject
    FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters, p_kind, p_address) o
    WHERE o.thread_key IS NOT NULL
    GROUP BY o.thread_key
)
SELECT t.thread_key, t.subject, t.n, t.letters, t.last_at, t.dir, false, NULL::uuid, NULL::text
FROM t
WHERE p_after_at IS NULL
   OR t.last_at < p_after_at
   OR (t.last_at = p_after_at AND (t.thread_key COLLATE "C") > (p_after_key COLLATE "C"))
ORDER BY t.last_at DESC, t.thread_key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

REVOKE ALL ON FUNCTION public.mail_other_rows(uuid, boolean, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_other_rows(uuid, boolean, text, text) TO service_role;
