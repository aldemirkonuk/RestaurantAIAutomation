-- The mail list is read by person.
--
-- WHY
-- ---
-- The founder's /goal of 2026-11-07 asks for a Mail tab inside /communications:
-- every conversation with people, whether mail arrived and how, and which
-- address the house uses. The only read the gateway had was a flat message
-- list capped at 100 rows (procurement.service.ts getConversationHistory) and
-- an OFFSET thread pager whose counts the PostgREST row cap could truncate
-- (conversations.service.ts getStats aggregates a capped read in JS). A house
-- with 150 vendors could not see the 101st.
--
-- These four functions are the server read model behind that tab (sw-walk
-- mail proposal, Phase B row L8, narrowed to the store that exists today):
--
--   mail_thread_states   one row per (vendor, thread_key): the single place
--                        "visible", "waiting" and "open" are defined, so the
--                        list, the thread rows and the header can never
--                        disagree about who is waiting.
--   list_mail_people     one row per vendor, keyset-paged, no OFFSET, no cap.
--   list_mail_threads    one row per thread for one vendor, keyset-paged.
--   mail_inbox_summary   the header numbers and per-door "last letter stored",
--                        counted here with count(*), never in JS over a capped
--                        read.
--
-- ONLY VENDORS
-- ------------
-- procurement_conversations is vendor-only (provider_id NOT NULL). Team, guest
-- and stranger mail is not stored anywhere yet (proposal F3/L6, not built), so
-- every person here is kind 'vendor' and the key is 'vendor:'||provider_id.
-- The gateway says so to the UI (storedKinds: ['vendor']).
--
-- WHAT "VISIBLE" MEANS
-- --------------------
-- A message is a letter that passed between the house and the person when it
-- is inbound, or outbound and it left the house:
--   * status SENT or AUTO_SENT;
--   * status SEND_UNCONFIRMED — the session's call under the 2026-11-07 /goal:
--     the house pressed send and the outcome was not recorded
--     (procurement.service.ts parkSendUnconfirmed, used for both "the mail is
--     at the vendor but the row write failed" and "the send failed
--     ambiguously"). The duplicate-send guard already treats it as sent
--     (approve_draft_duplicate_send_guard). Counting it as NOT sent would put
--     the vendor back on "waiting on you" and invite exactly the second send
--     that guard exists to stop;
--   * legacy rows with status NULL and sent_at set.
-- Everything else outbound — DRAFT, PENDING_APPROVAL, SENDING, SCHEDULED,
-- AUTO_SEND_SCHEDULED, HOUSE_DRAFT, HOUSE_QUEUED, HOUSE_FAILED, SEND_REFUSED,
-- RELAY_REFUSED, DISCARDED, CANCELLED, HOUSE_CANCELLED — is not a letter yet:
-- it never becomes the last line and never clears "waiting".
--
-- `direction` is compared lower-cased: providers.service.ts writes 'INBOUND'.
--
-- WHAT "WAITING" MEANS
-- --------------------
-- A thread waits on the house when its newest visible message is inbound.
-- One inbound kind is not a letter the house owes an answer to: an inbound row
-- with status 'DELIVERED' is the house's own record of an off-app invoice
-- (providers.service.ts, the retroactive-order path). It is visible (it is on
-- the thread) but never makes the house owe a reply — the session's call.
-- waiting_since is the oldest inbound letter after the house's last visible
-- outbound letter in that thread, so a vendor who wrote twice has been waiting
-- since the first. A person's waiting_since is the oldest across their
-- waiting threads.
--
-- A thread is OPEN when it is waiting, or its order is not closed. The closed
-- list is ORDER_CLOSED_STATUSES (apps/api-gateway/src/procurement/order-status.ts).
--
-- WITHHOLDING
-- -----------
-- p_withhold_house_letters follows list_conversation_threads
-- (a_thread_list_withholds_credit_drafts_from_staff): HOUSE_DRAFT and
-- HOUSE_CANCELLED rows are removed before anything is counted, so a staff
-- caller never learns one exists — not by a count, a thread row, a subject or
-- a person row. It DEFAULTS TO TRUE (fail closed). The gateway passes false
-- only for the house's owner or manager (apps/api-gateway/src/conversations/
-- mail.service.ts).
--
-- DOORS
-- -----
-- Which door an inbound letter came by, from stored columns alone:
--   house_mailbox  mirrored_by_grant_id IS NOT NULL (a person's own mailbox,
--                  read under their grant — a_mirrored_reply_states_how_long_it_is_kept);
--   whatsapp       channel 'whatsapp';
--   mudavym_mail   every other inbound letter. The shared Mudavym mailbox and
--                  the house's own Mudavym address cannot be told apart from
--                  any stored column today (no intake record exists until
--                  proposal L2), so they are one door here, and the gateway
--                  names it "Mudavym mail", never one of the two.
--
-- TIME
-- ----
-- A message's time is received_at for inbound and sent_at for outbound, else
-- created_at. "Today" is the house's day in restaurants.timezone, not UTC.
--
-- ACCESS
-- ------
-- SECURITY INVOKER, EXECUTE for service_role only, the same as
-- list_conversation_threads: the withholding flag is caller-supplied, so a
-- client able to call these could pass false. CREATE FUNCTION gives EXECUTE to
-- PUBLIC by default, so it is revoked explicitly below.

CREATE OR REPLACE FUNCTION public.mail_thread_states(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_provider_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  provider_id uuid,
  thread_key text,
  message_count bigint,
  last_any_at timestamp with time zone,
  last_visible_at timestamp with time zone,
  last_direction text,
  last_line text,
  channels text[],
  waiting boolean,
  waiting_since timestamp with time zone,
  order_id uuid,
  order_number text,
  order_open boolean,
  order_created_at timestamp with time zone,
  subject text
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH matched AS (
    SELECT c.id,
           c.provider_id,
           c.thread_key,
           c.order_id,
           c.order_number_snapshot,
           c.channel::text AS channel,
           c.message_text,
           c.email_headers,
           c.status::text AS status,
           lower(c.direction::text) AS dir,
           COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                         THEN c.received_at ELSE c.sent_at END,
                    c.created_at) AS at,
           (lower(c.direction::text) = 'inbound'
            OR (lower(c.direction::text) = 'outbound'
                AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                     OR (c.status IS NULL AND c.sent_at IS NOT NULL)))) AS visible,
           (lower(c.direction::text) = 'inbound'
            AND c.status::text IS DISTINCT FROM 'DELIVERED') AS owes
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
      AND (p_provider_id IS NULL OR c.provider_id = p_provider_id)
      AND (p_withhold_house_letters IS NOT TRUE
           OR c.status IS NULL
           OR c.status::text NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
),
last_visible AS (
    SELECT DISTINCT ON (m.provider_id, m.thread_key)
           m.provider_id, m.thread_key, m.dir, m.owes, m.message_text
    FROM matched m
    WHERE m.visible
    ORDER BY m.provider_id, m.thread_key, m.at DESC, m.id DESC
),
last_out AS (
    SELECT m.provider_id, m.thread_key, max(m.at) AS last_out_at
    FROM matched m
    WHERE m.visible AND m.dir = 'outbound'
    GROUP BY m.provider_id, m.thread_key
),
per_thread AS (
    SELECT m.provider_id,
           m.thread_key,
           count(*) AS message_count,
           max(m.at) AS last_any_at,
           max(m.at) FILTER (WHERE m.visible) AS last_visible_at,
           min(m.at) FILTER (WHERE m.owes
                             AND (o.last_out_at IS NULL OR m.at > o.last_out_at))
             AS unanswered_since,
           array_agg(DISTINCT lower(m.channel)) FILTER (WHERE m.visible) AS channels,
           (array_agg(m.order_id ORDER BY m.at DESC, m.id DESC)
              FILTER (WHERE m.order_id IS NOT NULL))[1] AS order_id,
           (array_agg(m.order_number_snapshot ORDER BY m.at DESC, m.id DESC)
              FILTER (WHERE m.order_number_snapshot IS NOT NULL))[1] AS order_number_snapshot,
           -- The first message that names a subject: the header the bridge
           -- stored, else the "Subject: ..." line it writes at the top of
           -- message_text. Headers themselves never leave this function.
           (array_agg(s.subject ORDER BY m.at ASC, m.id ASC)
              FILTER (WHERE s.subject IS NOT NULL))[1] AS subject
    FROM matched m
    LEFT JOIN last_out o
      ON o.provider_id = m.provider_id AND o.thread_key IS NOT DISTINCT FROM m.thread_key
    CROSS JOIN LATERAL (
        SELECT COALESCE(
                 NULLIF(btrim(m.email_headers->>'subject'), ''),
                 NULLIF(btrim(m.email_headers->>'Subject'), ''),
                 NULLIF(btrim(substring(left(m.message_text, 2000)
                                        FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), '')
               ) AS subject
    ) s
    GROUP BY m.provider_id, m.thread_key, o.last_out_at
)
SELECT t.provider_id,
       t.thread_key,
       t.message_count,
       t.last_any_at,
       t.last_visible_at,
       lv.dir AS last_direction,
       -- The newest visible message, its leading "Subject: ..." line removed
       -- and whitespace folded, cut to 160 characters for a one-line preview.
       CASE WHEN lv.message_text IS NULL THEN NULL
            ELSE left(btrim(regexp_replace(
                   regexp_replace(left(lv.message_text, 4000),
                                  '^\s*[Ss]ubject:[^\n]*(\n|$)', ''),
                   '\s+', ' ', 'g')), 160)
       END AS last_line,
       COALESCE(t.channels, ARRAY[]::text[]) AS channels,
       COALESCE(lv.owes, false) AS waiting,
       CASE WHEN COALESCE(lv.owes, false) THEN t.unanswered_since END AS waiting_since,
       t.order_id,
       COALESCE(po.order_number::text, t.order_number_snapshot) AS order_number,
       (po.id IS NOT NULL
        AND po.status::text NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED'))
         AS order_open,
       po.created_at AS order_created_at,
       t.subject
FROM per_thread t
LEFT JOIN last_visible lv
  ON lv.provider_id = t.provider_id AND lv.thread_key IS NOT DISTINCT FROM t.thread_key
LEFT JOIN public.procurement_orders po
  ON po.id = t.order_id AND po.restaurant_id = p_restaurant_id;
$$;

COMMENT ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) IS
  'One row per (vendor, thread_key) of a house: visible/waiting/open defined once '
  'for the Mail tab (the_mail_list_is_read_by_person). p_withhold_house_letters '
  '(default true) removes HOUSE_DRAFT/HOUSE_CANCELLED rows before anything is counted.';


CREATE OR REPLACE FUNCTION public.list_mail_people(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_waiting_only boolean DEFAULT false,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50
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
  newest_open_order_number text
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
newest AS (
    SELECT DISTINCT ON (t.provider_id)
           t.provider_id, t.last_visible_at, t.last_line, t.last_direction
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
    SELECT ('vendor:' || p.provider_id::text) COLLATE "C" AS key,
           p.*,
           n.last_visible_at AS last_at,
           n.last_line,
           n.last_direction
    FROM person p
    JOIN newest n ON n.provider_id = p.provider_id
)
SELECT k.key::text,
       'vendor'::text AS kind,
       k.provider_id,
       pr.name::text AS name,
       k.last_at,
       k.last_line,
       k.last_direction,
       k.waiting,
       k.waiting_since,
       k.open_threads,
       k.channels,
       k.newest_open_order_id,
       k.newest_open_order_number
FROM keyed k
LEFT JOIN public.providers pr ON pr.id = k.provider_id
WHERE (p_waiting_only IS NOT TRUE OR k.waiting)
  AND (p_after_at IS NULL
       OR k.last_at < p_after_at
       OR (k.last_at = p_after_at AND k.key > (p_after_key COLLATE "C")))
ORDER BY k.last_at DESC, k.key ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

COMMENT ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer) IS
  'One page of the people a house has mail with, newest letter first, keyset-paged by '
  '(last_at desc, key). Vendors only until non-vendor mail is stored. '
  '(the_mail_list_is_read_by_person)';


CREATE OR REPLACE FUNCTION public.list_mail_threads(
  p_restaurant_id uuid,
  p_provider_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50
) RETURNS TABLE(
  thread_key text,
  subject text,
  message_count bigint,
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
    SELECT s.*,
           -- A draft never moves a thread up; a thread holding only a draft
           -- (owner/manager view) sits at the draft's own time.
           COALESCE(s.last_visible_at, s.last_any_at) AS sort_at
    FROM public.mail_thread_states(p_restaurant_id, p_withhold_house_letters, p_provider_id) s
    WHERE p_provider_id IS NOT NULL
      AND s.thread_key IS NOT NULL
)
SELECT t.thread_key,
       t.subject,
       t.message_count,
       t.sort_at AS last_at,
       t.last_direction,
       t.waiting,
       t.order_id,
       t.order_number
FROM t
WHERE p_after_at IS NULL
   OR t.sort_at < p_after_at
   OR (t.sort_at = p_after_at AND (t.thread_key COLLATE "C") > (p_after_key COLLATE "C"))
ORDER BY t.sort_at DESC, t.thread_key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

COMMENT ON FUNCTION public.list_mail_threads(uuid, uuid, boolean, timestamp with time zone, text, integer) IS
  'One page of one vendor''s threads in a house, newest first, keyset-paged by '
  '(last_at desc, thread_key). (the_mail_list_is_read_by_person)';


CREATE OR REPLACE FUNCTION public.mail_inbox_summary(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true
) RETURNS TABLE(
  waiting_people integer,
  oldest_wait_at timestamp with time zone,
  in_today integer,
  out_today integer,
  house_mailbox_last_at timestamp with time zone,
  whatsapp_last_at timestamp with time zone,
  mudavym_mail_last_at timestamp with time zone
)
    LANGUAGE plpgsql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
DECLARE
  v_tz text;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  SELECT COALESCE(NULLIF(btrim(r.timezone::text), ''), 'UTC')
    INTO v_tz
    FROM public.restaurants r
   WHERE r.id = p_restaurant_id;
  -- No house, no numbers: an answer of zeros for a house that does not exist
  -- would read as a quiet inbox (ADR 0051 — absence is not health).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mail_inbox_summary: no restaurant %', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- The house's own day. A bad timezone name raises here rather than counting
  -- a UTC day under the house's name.
  v_day_start := (date_trunc('day', now() AT TIME ZONE v_tz)) AT TIME ZONE v_tz;
  v_day_end := (date_trunc('day', now() AT TIME ZONE v_tz) + interval '1 day') AT TIME ZONE v_tz;

  RETURN QUERY
  WITH people AS (
      SELECT (count(DISTINCT s.provider_id) FILTER (WHERE s.waiting))::integer AS waiting_people,
             min(s.waiting_since) FILTER (WHERE s.waiting) AS oldest_wait_at
      FROM public.mail_thread_states(p_restaurant_id, p_withhold_house_letters, NULL) s
  ),
  letters AS (
      SELECT lower(c.direction::text) AS dir,
             c.channel::text AS channel,
             c.mirrored_by_grant_id,
             COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                           THEN c.received_at ELSE c.sent_at END,
                      c.created_at) AS at,
             (lower(c.direction::text) = 'outbound'
              AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                   OR (c.status IS NULL AND c.sent_at IS NOT NULL))) AS left_house
      FROM public.procurement_conversations c
      WHERE c.restaurant_id = p_restaurant_id
        AND (p_withhold_house_letters IS NOT TRUE
             OR c.status IS NULL
             OR c.status::text NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
  ),
  counted AS (
      SELECT (count(*) FILTER (WHERE l.dir = 'inbound'
                                 AND l.at >= v_day_start AND l.at < v_day_end))::integer AS in_today,
             (count(*) FILTER (WHERE l.left_house
                                 AND l.at >= v_day_start AND l.at < v_day_end))::integer AS out_today,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NOT NULL)
               AS house_mailbox_last_at,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NULL
                                 AND lower(l.channel) = 'whatsapp') AS whatsapp_last_at,
             max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.mirrored_by_grant_id IS NULL
                                 AND lower(l.channel) IS DISTINCT FROM 'whatsapp')
               AS mudavym_mail_last_at
      FROM letters l
  )
  SELECT p.waiting_people, p.oldest_wait_at,
         c.in_today, c.out_today,
         c.house_mailbox_last_at, c.whatsapp_last_at, c.mudavym_mail_last_at
  FROM people p CROSS JOIN counted c;
END;
$$;

COMMENT ON FUNCTION public.mail_inbox_summary(uuid, boolean) IS
  'The Mail tab header for a house: people waiting, oldest wait, letters in/out on the '
  'house''s own day, and the last letter stored per door. Counted with count(*). '
  '(the_mail_list_is_read_by_person)';


-- The thread list asks "this house, this vendor"; the base table only had
-- (restaurant_id) and (provider_id, created_at) separately. Measured on the
-- 2,000-row fixture: see the PR body.
CREATE INDEX IF NOT EXISTS idx_procurement_conversations_house_vendor
  ON public.procurement_conversations (restaurant_id, provider_id);


-- Only the gateway may call these (see ACCESS above).
REVOKE ALL ON FUNCTION public.mail_thread_states(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_mail_threads(uuid, uuid, boolean, timestamp with time zone, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_inbox_summary(uuid, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_mail_threads(uuid, uuid, boolean, timestamp with time zone, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_inbox_summary(uuid, boolean) TO service_role;
