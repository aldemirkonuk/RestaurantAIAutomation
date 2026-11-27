-- The words that matched (r109 mail-gap g5). A Mail search finds a person by a word in an older
-- letter, but the row still showed their newest line, which need not hold the word. With a search
-- set, list_mail_people now returns hit_line: about 140 characters centred on the first match in
-- the newest letter that holds it, whitespace collapsed (mail_hit_line, with mail_search_pattern
-- as the finder). With no search, or a match only in the person's name, subject or order number,
-- hit_line is NULL and the row keeps its last_line.
-- The withhold rules are the row's own: the letters are read through mail_letter_rows, so a
-- caller whose house letters are withheld (staff) is quoted only what came in, never a snippet of a
-- house letter, a copy is not a second letter, and a snippet never quotes a letter the reader could
-- not open.
-- Only a letter that passed between them is quoted (visible): never a draft, a cancelled letter,
-- an auto-reply or a copy, none of which the row's own line ever names either.
-- A new return type, so the old signature is dropped and created again, and service_role is
-- granted again. list_mail_vendors is not touched: the snippet is worked out here for the
-- people the page returns, so a change to the vendor list does not collide with it.
DROP FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean);

CREATE OR REPLACE FUNCTION public.mail_hit_line(p_text text, p_pat text)
RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = ''
    AS $$
WITH flat AS (
    SELECT btrim(regexp_replace(COALESCE(p_text, ''), '\s+', ' ', 'g')) AS t
),
hit AS (
    SELECT f.t, (regexp_match(f.t, p_pat, 'i'))[1] AS m
    FROM flat f
    WHERE p_pat IS NOT NULL
),
at AS (
    SELECT h.t, h.m, strpos(h.t, h.m) AS pos
    FROM hit h
    WHERE h.m IS NOT NULL AND h.m <> ''
)
SELECT (CASE WHEN s.start > 1 THEN '…' ELSE '' END)
       || substr(a.t, s.start, 140)
       || (CASE WHEN s.start + 140 <= length(a.t) THEN '…' ELSE '' END)
FROM at a
CROSS JOIN LATERAL (SELECT greatest(1, a.pos + length(a.m) / 2 - 70) AS start) s;
$$;

COMMENT ON FUNCTION public.mail_hit_line(text, text) IS
  'About 140 characters of a letter centred on the first match of a mail_search_pattern, whitespace collapsed, ... at a cut end; NULL when the pattern does not match (r109 mail-gap g5).';

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
  awaiting_since timestamp with time zone,
  hit_line text
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
       m.unsent_status, m.awaiting_since,
       h.hit_line
FROM merged m
CROSS JOIN q
-- The words that matched (r109 mail-gap g5): the newest letter of this person
-- that holds the search, read through the same door as the list. A vendor's
-- letters come through mail_letter_rows, so a withheld letter (staff never
-- read the house's own) is never quoted and a copy is not a second letter. The
-- other kinds exist only for a caller who may read house letters at all.
LEFT JOIN LATERAL (
    SELECT public.mail_hit_line(x.message_text, q.pat) AS hit_line
    FROM (
        SELECT l.message_text
        FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, m.provider_id) l
        WHERE m.provider_id IS NOT NULL
          AND q.pat IS NOT NULL
          AND l.visible
          -- a caller whose house letters are withheld is quoted only what came in
          AND (p_withhold_house_letters IS NOT TRUE OR l.dir = 'inbound')
          AND l.message_text ~* q.pat
        ORDER BY l.at DESC, l.id DESC
        LIMIT 1
    ) x
    UNION ALL
    SELECT public.mail_hit_line(y.message_text, q.pat)
    FROM (
        SELECT c.message_text
        FROM public.procurement_conversations c
        WHERE m.provider_id IS NULL
          AND q.pat IS NOT NULL
          AND p_withhold_house_letters IS NOT TRUE
          AND c.restaurant_id = p_restaurant_id
          AND c.kind = m.kind
          AND c.from_address = m.name
          AND c.message_text ~* q.pat
          -- a letter that passed between them: it came in, or it left; never a draft or a machine's reply
          AND COALESCE(lower(c.direction::text) = 'inbound'
                       OR c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                       OR (c.status IS NULL AND c.sent_at IS NOT NULL), false)
          AND NOT COALESCE(lower(c.direction::text) = 'inbound'
                AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
                     OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false)
        ORDER BY COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                               THEN c.received_at ELSE c.sent_at END, c.created_at) DESC, c.id DESC
        LIMIT 1
    ) y
    LIMIT 1
) h ON true
ORDER BY m.last_at DESC, m.key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;


REVOKE ALL ON FUNCTION public.mail_hit_line(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_hit_line(text, text) TO service_role;
REVOKE ALL ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)
  TO service_role;
