-- The people list can ask for one kind (Team, Guests, Vendors), and a thread's time is its letters' time
-- (r103 mail-1, mail-5).
-- 1. list_mail_people takes p_kind. The web filtered the pages it had already loaded, so Team could say
--    "no team member" while eight sat on the next page. Asked for in SQL, the page holds that kind only.
--    NULL is every kind, as before. 'vendor' lists vendors; 'team' and 'guest' list those people.
-- 2. list_mail_threads_other times a thread by its newest non-automatic letter (and says who wrote it),
--    falling back to the newest row only when every row is automatic, as the people list already does.
DROP FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text);

CREATE FUNCTION public.list_mail_people(
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
    WHERE NOT COALESCE(lower(c.direction::text) = 'inbound'
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
           (array_agg(o.at ORDER BY o.automatic ASC, o.at DESC, o.id DESC))[1] AS last_at,
           (array_agg(o.dir ORDER BY o.automatic ASC, o.at DESC, o.id DESC))[1] AS dir,
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

REVOKE ALL ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text)
  TO service_role;
