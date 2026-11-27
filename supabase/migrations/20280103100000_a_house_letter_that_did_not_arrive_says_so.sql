-- A house letter that did not arrive says so on the list (r109 mail-gap g1).
-- The house reader writes email_headers.delivery = {state, at, recipient, status, said} on the
-- house's own letter when a checked delivery notice names its Message-ID. The list's
-- unsent_status gains 'did_not_arrive': the person's newest letter is the house's, it left
-- (a visible letter: SENT, AUTO_SENT or SEND_UNCONFIRMED), and a notice said it did not arrive. A delay ('delayed') never sets it.
-- A letter that did not arrive is not "No answer yet" either: nothing reached them to answer.
-- Same arguments and same result columns, so CREATE OR REPLACE keeps the grants
-- (service_role only, 20271229100000) and list_mail_people, which reads this, is unchanged.
-- Staff see it as they see the letter itself: mail_letter_rows withholds only drafts and
-- cancelled letters from them, never a letter that left.

CREATE OR REPLACE FUNCTION public.list_mail_vendors(
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
-- The house's newest letter that left and came back: a delivery notice the
-- house reader kept wrote email_headers.delivery.state = 'did_not_arrive' on
-- it (r109 mail-gap g1). A delay ('delayed') is not here: Gmail is still trying.
bounced AS (
    SELECT DISTINCT ON (l.provider_id)
           l.provider_id, l.id, l.at, 'did_not_arrive'::text AS status
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l
    WHERE l.dir = 'outbound'
      -- A letter that left (SENT, AUTO_SENT, SEND_UNCONFIRMED, or an older row
      -- with a sent_at), and not a second copy: a notice proves it left.
      AND l.visible
      AND (l.email_headers->'delivery'->>'state') = 'did_not_arrive'
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
           -- A letter not yet left is named when it is newer than the newest
           -- letter; one that did not arrive when it IS the newest letter (it
           -- left, so it is the newest letter itself). An answer after it, or a
           -- later letter that left, ends the chip.
           COALESCE(CASE WHEN u.at > n.last_visible_at THEN u.status END,
                    CASE WHEN b.id = n.last_id THEN b.status END) AS unsent_status,
           -- No answer yet: the newest letter is the house's, it left, and it is 72 h old.
           CASE WHEN p_withhold_house_letters IS NOT TRUE
                 AND NOT p.waiting
                 AND n.last_direction = 'outbound'
                 AND n.last_visible_at < now() - interval '72 hours'
                 AND EXISTS (SELECT 1 FROM public.procurement_conversations hl
                             WHERE hl.id = n.last_id AND hl.restaurant_id = p_restaurant_id
                               AND (hl.status::text IN ('SENT', 'AUTO_SENT')
                                    OR (hl.status IS NULL AND hl.sent_at IS NOT NULL))
                               -- A letter that did not arrive awaits no answer.
                               AND (hl.email_headers->'delivery'->>'state') IS DISTINCT FROM 'did_not_arrive')
                THEN n.last_visible_at END AS awaiting_since
    FROM person p
    JOIN newest n ON n.provider_id = p.provider_id
    LEFT JOIN unsent u ON u.provider_id = p.provider_id
    LEFT JOIN bounced b ON b.provider_id = p.provider_id
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
