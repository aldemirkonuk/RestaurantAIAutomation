-- No answer yet (r108 mail-gap g7): the people the house wrote to and who have not answered.
-- Mail showed one direction of waiting only: a vendor waiting on the house. The list now also
-- answers p_awaiting: a person whose newest letter that came in or left is the house's, which
-- left (SENT or AUTO_SENT, or an older row with no status and a sent_at), is older than 72 h,
-- and who is not waiting on the house. An auto-reply or bounce after it is not an answer; a
-- letter still queued, failed or a draft is not the newest letter. Each row says awaiting_since.
-- A caller whose house letters are withheld (staff) gets no row from p_awaiting: the letters
-- it rests on are the house's. 72 h after Gmail's three-day nudge; elapsed time, not house days.
DROP FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text);
DROP FUNCTION public.list_mail_vendors(uuid, boolean, boolean, timestamp with time zone, text, integer, text);

CREATE FUNCTION public.list_mail_vendors(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_waiting_only boolean DEFAULT false,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_query text DEFAULT NULL::text,
  p_awaiting boolean DEFAULT false
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
  unsent_status text,
  awaiting_since timestamp with time zone
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH t AS (
    SELECT *
    FROM public.mail_thread_states(p_restaurant_id, p_withhold_house_letters, NULL)
    -- A person is on the list once a letter has passed between them and the
    -- house. A draft-only thread is reachable under the person, never a row.
    WHERE last_visible_at IS NOT NULL
),
-- The house's newest letter to each vendor that has NOT left: queued in its
-- undo window, being sent, scheduled, failed, refused, or pulled back. A
-- vendor whose only letter is one of these stays on the list (QA round 16,
-- HARM 1: a first letter still queued made its vendor vanish, and with it the
-- only way to pull the letter back). Drafts are not here: they are not sent
-- and were never meant to be.
unsent AS (
    SELECT DISTINCT ON (l.provider_id)
           l.provider_id, l.id, l.at, l.status, l.channel
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l
    WHERE l.dir = 'outbound'
      AND l.status IN ('HOUSE_QUEUED', 'SENDING', 'AUTO_SENDING', 'SCHEDULED',
                       'AUTO_SEND_SCHEDULED', 'HOUSE_FAILED', 'SEND_REFUSED',
                       'RELAY_REFUSED', 'HOUSE_CANCELLED', 'CANCELLED')
    ORDER BY l.provider_id, l.at DESC, l.id DESC
),
-- The search (r28 mail gap 16), NULL for none: see mail_search_pattern.
q AS (
    SELECT public.mail_search_pattern(p_query) AS pat
),
-- The people a search finds by a thread's subject or order number, or by the
-- words of a letter this caller may read (a withheld letter is not read:
-- mail_letter_rows removed it first; a second copy is not a letter). Worked
-- out once per call, and only when there is a search: with none, nothing
-- below asks for it.
hits AS (
    SELECT t.provider_id
    FROM t, q
    WHERE t.subject ~* q.pat
       OR t.order_number ~* q.pat
    UNION
    SELECT l.provider_id
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l, q
    WHERE NOT l.duplicate
      AND l.message_text ~* q.pat
),
newest AS (
    SELECT DISTINCT ON (t.provider_id)
           t.provider_id, t.last_visible_at, t.last_id, t.last_direction
    FROM t
    ORDER BY t.provider_id, t.last_visible_at DESC, t.thread_key DESC
),
person AS (
    SELECT t.provider_id,
           bool_or(t.waiting) AS waiting,
           min(t.waiting_since) FILTER (WHERE t.waiting) AS waiting_since,
           (count(*) FILTER (WHERE t.waiting OR t.order_open))::integer AS open_threads,
           ARRAY(SELECT DISTINCT ch
                 FROM t t2, unnest(t2.channels) ch
                 WHERE t2.provider_id = t.provider_id
                 ORDER BY ch) AS channels,
           -- F2: the order chip comes from the newest waiting thread first,
           -- then the newest open order.
           (array_agg(t.order_id ORDER BY t.waiting DESC, t.order_created_at DESC NULLS LAST,
                                         t.last_visible_at DESC)
              FILTER (WHERE t.order_open))[1] AS newest_open_order_id,
           (array_agg(t.order_number ORDER BY t.waiting DESC, t.order_created_at DESC NULLS LAST,
                                             t.last_visible_at DESC)
              FILTER (WHERE t.order_open))[1] AS newest_open_order_number
    FROM t
    GROUP BY t.provider_id
),
keyed AS (
    -- People with letters: placed by their newest letter. An unsent letter
    -- newer than that is named, but never moves them up the list.
    SELECT ('vendor:' || p.provider_id::text) COLLATE "C" AS key,
           p.provider_id,
           n.last_visible_at AS last_at,
           n.last_id,
           n.last_direction,
           p.waiting,
           p.waiting_since,
           p.open_threads,
           p.channels,
           p.newest_open_order_id,
           p.newest_open_order_number,
           CASE WHEN u.at > n.last_visible_at THEN u.status END AS unsent_status,
           -- No answer yet: the newest letter is the house's, it left, and it is 72 h old.
           CASE WHEN p_withhold_house_letters IS NOT TRUE
                 AND NOT p.waiting
                 AND n.last_direction = 'outbound'
                 AND n.last_visible_at < now() - interval '72 hours'
                 AND EXISTS (SELECT 1 FROM public.procurement_conversations hl
                             WHERE hl.id = n.last_id AND hl.restaurant_id = p_restaurant_id
                               AND (hl.status::text IN ('SENT', 'AUTO_SENT')
                                    OR (hl.status IS NULL AND hl.sent_at IS NOT NULL)))
                THEN n.last_visible_at END AS awaiting_since
    FROM person p
    JOIN newest n ON n.provider_id = p.provider_id
    LEFT JOIN unsent u ON u.provider_id = p.provider_id
    UNION ALL
    -- People with only an unsent letter: placed by that letter, never waiting.
    SELECT ('vendor:' || u.provider_id::text) COLLATE "C",
           u.provider_id,
           u.at,
           u.id,
           'outbound',
           false,
           NULL::timestamptz,
           0,
           ARRAY[lower(u.channel)]::text[],
           NULL::uuid,
           NULL::text,
           u.status,
           NULL::timestamptz
    FROM unsent u
    WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.provider_id = u.provider_id)
),
page AS (
    SELECT k.*, pr.name::text AS name
    FROM keyed k
    LEFT JOIN public.providers pr ON pr.id = k.provider_id
    CROSS JOIN q
    WHERE (p_waiting_only IS NOT TRUE OR k.waiting)
      AND (p_awaiting IS NOT TRUE OR k.awaiting_since IS NOT NULL)
      -- A person matches by their name, or is one of the search's hits.
      AND (q.pat IS NULL
           OR pr.name::text ~* q.pat
           OR k.provider_id IN (SELECT h.provider_id FROM hits h))
      AND (p_after_at IS NULL
           OR k.last_at < p_after_at
           OR (k.last_at = p_after_at AND k.key > (p_after_key COLLATE "C")))
    ORDER BY k.last_at DESC, k.key ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 500))
)
-- Each row's line is its newest letter's preview, worked out for this page
-- only (r35 mail, gap 12). The letter was read through mail_letter_rows
-- above, so a letter withheld from this caller is never the one named.
SELECT p.key::text,
       'vendor'::text AS kind,
       p.provider_id,
       p.name,
       p.last_at,
       public.mail_preview(lc.message_text) AS last_line,
       p.last_direction,
       p.waiting,
       p.waiting_since,
       p.open_threads,
       p.channels,
       p.newest_open_order_id,
       p.newest_open_order_number,
       p.unsent_status,
       p.awaiting_since
FROM page p
LEFT JOIN public.procurement_conversations lc
  ON lc.id = p.last_id AND lc.restaurant_id = p_restaurant_id
ORDER BY p.last_at DESC, p.key ASC;
$$;

CREATE FUNCTION public.list_mail_people(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_waiting_only boolean DEFAULT false,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_query text DEFAULT NULL::text,
  p_kind text DEFAULT NULL::text,
  p_awaiting boolean DEFAULT false
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
  unsent_status text,
  awaiting_since timestamp with time zone
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
           max(at_of.at) AS last_at,
           -- No answer yet: the newest letter that came in or left is the house's, it left,
           -- and it is 72 h old. A letter not yet sent is not one; an auto-reply is not one.
           CASE WHEN (array_agg(lower(c.direction::text) ORDER BY at_of.at DESC, c.id DESC)
                        FILTER (WHERE at_of.letter))[1] = 'outbound'
                 AND (array_agg(at_of.left_ok ORDER BY at_of.at DESC, c.id DESC)
                        FILTER (WHERE at_of.letter))[1]
                 AND max(at_of.at) FILTER (WHERE at_of.letter) < now() - interval '72 hours'
                THEN max(at_of.at) FILTER (WHERE at_of.letter) END AS awaiting_since,
           -- the words are read only when a search asks for them
           COALESCE(bool_or(CASE WHEN q.pat IS NULL THEN false ELSE c.message_text ~* q.pat END), false) AS text_hit
    FROM public.procurement_conversations c
    CROSS JOIN q
    CROSS JOIN LATERAL (SELECT
        COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                      THEN c.received_at ELSE c.sent_at END, c.created_at) AS at,
        COALESCE(lower(c.direction::text) = 'inbound'
          OR c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
          OR (c.status IS NULL AND c.sent_at IS NOT NULL), false) AS letter,
        COALESCE(c.status::text IN ('SENT', 'AUTO_SENT')
          OR (c.status IS NULL AND c.sent_at IS NOT NULL), false) AS left_ok) at_of
    WHERE c.restaurant_id = p_restaurant_id
      AND p_withhold_house_letters IS NOT TRUE
      AND p_waiting_only IS NOT TRUE
      AND c.kind <> 'vendor'
      AND (p_kind IS NULL OR c.kind = p_kind)
      AND c.from_address IS NOT NULL
      AND NOT COALESCE(lower(c.direction::text) = 'inbound'
            AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                 OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false)
    GROUP BY c.kind, c.from_address
),
page AS (
    SELECT r.kind, r.address, r.key, r.last_at, r.awaiting_since
    FROM ranked r
    CROSS JOIN q
    WHERE (q.pat IS NULL OR r.address ~* q.pat OR r.text_hit)
      AND (p_awaiting IS NOT TRUE OR r.awaiting_since IS NOT NULL)
      AND (p_after_at IS NULL
           OR r.last_at < p_after_at
           OR (r.last_at = p_after_at AND r.key > (p_after_key COLLATE "C")))
    ORDER BY r.last_at DESC, r.key COLLATE "C" ASC
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 500))
),
others AS (
    -- The page's people only. A copy shares its original's thread, channel, words and direction, so none of
    -- these aggregates needs the copy rule.
    SELECT pg.kind, pg.address, pg.key, pg.last_at, pg.awaiting_since,
           (array_agg(c.id ORDER BY at_of.at DESC, c.id DESC))[1] AS last_id,
           (array_agg(lower(c.direction::text) ORDER BY at_of.at DESC, c.id DESC))[1] AS last_direction,
           count(DISTINCT c.thread_key)::integer AS threads,
           array_agg(DISTINCT lower(c.channel::text)) AS channels
    FROM page pg
    JOIN public.procurement_conversations c
      ON c.restaurant_id = p_restaurant_id AND c.kind = pg.kind AND c.from_address = pg.address
    CROSS JOIN LATERAL (SELECT COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                                             THEN c.received_at ELSE c.sent_at END, c.created_at) AS at) at_of
    WHERE NOT COALESCE(lower(c.direction::text) = 'inbound'
            AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                 OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false)
    GROUP BY pg.kind, pg.address, pg.key, pg.last_at, pg.awaiting_since
),
merged AS (
    SELECT v.key, v.kind, v.provider_id, v.name, v.last_at, v.last_line,
           v.last_direction, v.waiting, v.waiting_since, v.open_threads,
           v.channels, v.newest_open_order_id, v.newest_open_order_number,
           v.unsent_status, v.awaiting_since
    FROM public.list_mail_vendors(p_restaurant_id, p_withhold_house_letters,
           p_waiting_only, p_after_at, p_after_key, p_limit, p_query, p_awaiting) v
    WHERE p_kind IS NULL OR p_kind = 'vendor'
    UNION ALL
    SELECT p.key::text, p.kind, NULL::uuid, p.address, p.last_at,
           public.mail_preview(lc.message_text), p.last_direction, false,
           NULL::timestamptz, p.threads, p.channels, NULL::uuid, NULL::text,
           NULL::text, p.awaiting_since
    FROM others p
    LEFT JOIN public.procurement_conversations lc
      ON lc.id = p.last_id AND lc.restaurant_id = p_restaurant_id
)
SELECT m.key, m.kind, m.provider_id, m.name, m.last_at, m.last_line,
       m.last_direction, m.waiting, m.waiting_since, m.open_threads,
       m.channels, m.newest_open_order_id, m.newest_open_order_number,
       m.unsent_status, m.awaiting_since
FROM merged m
ORDER BY m.last_at DESC, m.key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

REVOKE ALL ON FUNCTION public.list_mail_vendors(uuid, boolean, boolean, timestamp with time zone, text, integer, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mail_vendors(uuid, boolean, boolean, timestamp with time zone, text, integer, text, boolean)
  TO service_role;
REVOKE ALL ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)
  TO service_role;
