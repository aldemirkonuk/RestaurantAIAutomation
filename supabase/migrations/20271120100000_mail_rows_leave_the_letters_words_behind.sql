-- Mail's shared row read leaves the letters' words behind (r41 mail audit,
-- gap 1).
--
-- WHY
-- ---
-- mail_letter_rows is a set-returning SQL function pinned to an empty
-- search_path, so Postgres cannot fold it into its caller: it builds every row
-- of the house before the caller filters anything. Those rows carried
-- message_text and email_headers, through the sort for copies too, so the
-- people list and the summary each wrote 32 MB of temp per read on a
-- 12,000-letter house, every 30-second poll, and the house counter (#1580)
-- runs both again on every page.
--
-- WHAT CHANGES
-- ------------
-- mail_letter_rows returns the letter's `subject` in place of message_text and
-- email_headers. The words and headers are read once, in the step that also
-- decides whether a machine wrote the letter, and never leave it; OFFSET 0
-- keeps the planner from folding that step into the sort for copies, which
-- would carry the whole text through the sort again (measured: the sort's
-- rows are 313 bytes wide, not 685, and stay in memory).
--
-- The subject rule is the one mail_thread_states and mail_thread_letters each
-- applied before: the stored header, either case, else the "Subject: ..." line
-- at the top of the first 2,000 characters of the text. It now lives here
-- once. Every other column and flag is computed exactly as before.
--
-- The readers that need words read them from procurement_conversations by id,
-- for the rows they show or test:
--   * mail_thread_letters joins the words for its page of letters only;
--   * list_mail_people's search reads them for the rows this caller may read;
--   * the list's one-line previews already read the shown rows only (#1522).
--
-- mail_thread_states reads the subject from the row, and now also names each
-- thread's newest letter from the house that has not left (unsent_*), so
-- list_mail_people reads the house's rows once, through it, instead of a
-- second time for its unsent letters. Only a search reads them again.
-- mail_inbox_summary, list_mail_threads and mail_thread_mark_seen read no
-- dropped column and are unchanged.
--
-- Measured on a throwaway Postgres 17, 12,000 synthetic letters, work_mem
-- 4MB (the PR body has the commands): every read hashed identical before
-- and after; the people list 197-223 -> 124-133 ms and temp 4,090 -> 0 blocks.
--
-- WHY DROP, NOT A NEW FUNCTION
-- ----------------------------
-- CREATE OR REPLACE cannot change a function's result columns, so
-- mail_letter_rows and mail_thread_states are dropped and created again in
-- this one transaction. The session's call (2026-11-07 /goal) over the
-- alternative, a new narrow function with mail_letter_rows kept as a shell
-- that joins the words back: an older open stack (#954 -> #1032) still
-- replaces mail_letter_rows with its own body. Against a shell, that replace
-- would succeed in silence and its rules would reach only the shell, never the
-- lists that read the narrow function. Against this shape it fails out loud
-- (the result columns differ), as it already does against the current stack,
-- which added no_reply_marked_at. Whoever carries those rules forward ports
-- them here.
--
-- REJECTED
-- --------
--   * Dropping SET search_path = '' so the function can be folded in: every
--     function in this repo pins it, and the Supabase linter flags one that
--     does not.
--   * A table of thread states kept by triggers: procurement_conversations
--     has writers in the gateway, the agents and retention, and "waiting"
--     depends on marks, withholding, copies and automatic mail; a second copy
--     of that rule would drift from this one.
--
-- ACCESS
-- ------
-- Unchanged: SECURITY INVOKER, EXECUTE for service_role only. The two dropped
-- and created functions get their grants again below; CREATE OR REPLACE keeps
-- the others' grants.

DROP FUNCTION IF EXISTS public.mail_letter_rows(uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.mail_letter_rows(
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
  subject text,
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
),
-- Each row read once, and narrowed here: the letter's words and headers are
-- read only to work out its subject and whether a machine wrote it, and never
-- leave this step. OFFSET 0 keeps the planner from folding this step into the
-- one below, which would carry every letter's whole text through the
-- house-wide sort for copies (r41 mail audit, gap 1).
src AS (
SELECT c.id,
       c.provider_id,
       c.thread_key,
       c.order_id,
       c.order_number_snapshot,
       lower(c.direction::text) AS dir,
       c.channel::text AS channel,
       -- The subject a letter names: the header the bridge stored, else the
       -- "Subject: ..." line it writes at the top of message_text.
       COALESCE(
         NULLIF(btrim(c.email_headers->>'subject'), ''),
         NULLIF(btrim(c.email_headers->>'Subject'), ''),
         NULLIF(btrim(substring(left(c.message_text, 2000)
                                FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), '')
       ) AS subject,
       c.status::text AS status,
       c.ai_generated,
       c.sent_at,
       c.received_at,
       c.created_at,
       c.raw_deleted_at,
       c.mirrored_by_grant_id,
       COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                     THEN c.received_at ELSE c.sent_at END,
                c.created_at) AS at,
       -- Both flags are forced to true/false: an outbound row with no
       -- status and no sent_at would make the bare expression NULL, and
       -- "ORDER BY visible DESC" sorts NULL first, which would rank an
       -- unsent draft as the thread's last letter.
       COALESCE(lower(c.direction::text) = 'inbound'
        OR (lower(c.direction::text) = 'outbound'
            AND (c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
                 OR (c.status IS NULL AND c.sent_at IS NOT NULL))), false) AS sent_or_in,
       -- A letter that was set aside (DISCARDED) arrived, but owes no answer.
       COALESCE(lower(c.direction::text) = 'inbound'
        AND c.status::text IS DISTINCT FROM 'DELIVERED'
        AND c.status::text IS DISTINCT FROM 'DISCARDED', false) AS owes_raw,
       -- Mail a machine wrote: an auto-reply or out-of-office (the bridge's
       -- transport.autoSubmitted, from Auto-Submitted / X-Autoreply), or a
       -- bounce from a mail server (mailer-daemon@ / postmaster@). It stays on
       -- the thread, named as automatic, but is not a letter: it is never
       -- counted, never the last line and never makes anyone "waiting".
       COALESCE(lower(c.direction::text) = 'inbound'
        AND ((c.email_headers->'transport'->>'autoSubmitted') = 'true'
             OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false) AS automatic,
       -- The copy key: the same letter delivered twice (both doors, or a
       -- redelivery) has one Message-ID.
       lower(btrim(c.message_id::text)) AS copy_key,
       (lower(c.direction::text) = 'inbound'
        AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL) AS copy_keyed
FROM public.procurement_conversations c
WHERE c.restaurant_id = p_restaurant_id
  AND (p_provider_id IS NULL OR c.provider_id = p_provider_id)
  AND (p_withhold_house_letters IS NOT TRUE
       OR c.status IS NULL
       OR c.status::text NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
OFFSET 0
),
base AS (
SELECT s.*,
       -- Of one Message-ID, the first row stored is the letter, the rest are copies.
       COALESCE(s.copy_keyed
        AND row_number() OVER (PARTITION BY s.provider_id, s.copy_key, s.copy_keyed
                               ORDER BY s.created_at ASC, s.id ASC) > 1, false) AS duplicate,
       -- Settled by a "needs no reply" mark on this letter or a later one of
       -- its thread. Row comparison: the same (at, id) order the thread reads in.
       COALESCE((s.at, s.id) <= (mk.through_at, mk.through_id), false) AS settled,
       own.marked_at AS no_reply_marked_at
FROM src s
LEFT JOIN marks mk
  ON mk.provider_id = s.provider_id
 AND mk.thread_key = s.thread_key
LEFT JOIN public.mail_letter_no_reply_marks own
  ON own.conversation_id = s.id
 AND own.restaurant_id = p_restaurant_id
)
SELECT r.id, r.provider_id, r.thread_key, r.order_id, r.order_number_snapshot, r.dir,
       r.channel, r.subject, r.status, r.ai_generated,
       r.sent_at, r.received_at, r.created_at, r.raw_deleted_at, r.mirrored_by_grant_id,
       r.at,
       r.sent_or_in AND NOT r.automatic AND NOT r.duplicate,
       r.owes_raw AND NOT r.automatic AND NOT r.duplicate AND NOT r.settled,
       r.automatic,
       r.duplicate,
       r.no_reply_marked_at
FROM base r;
$$;

COMMENT ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) IS
  'Every procurement_conversations row of a house (of one vendor, when named) the Mail tab '
  'reads, with its time, its subject, the visible/owes flags, and whether it is automatic '
  'mail (an auto-reply or a bounce) or a second copy of a letter already stored (same '
  'Message-ID); neither is ever visible or owed. A letter at or before a "needs no reply" '
  'mark of its thread owes nothing. Withheld rows are removed first. Carries no letter''s '
  'words or headers: a reader that shows words joins them by id. The one definition the '
  'other mail functions share (mail_rows_leave_the_letters_words_behind).';

REVOKE ALL ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) TO service_role;


DROP FUNCTION IF EXISTS public.mail_thread_states(uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.mail_thread_states(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_provider_id uuid DEFAULT NULL::uuid
) RETURNS TABLE(
  provider_id uuid,
  thread_key text,
  message_count bigint,
  letter_count bigint,
  last_any_at timestamp with time zone,
  last_visible_at timestamp with time zone,
  last_direction text,
  last_id uuid,
  channels text[],
  waiting boolean,
  waiting_since timestamp with time zone,
  order_id uuid,
  order_number text,
  order_open boolean,
  order_created_at timestamp with time zone,
  subject text,
  unsent_id uuid,
  unsent_at timestamp with time zone,
  unsent_status text,
  unsent_channel text
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH matched AS (
    SELECT l.id,
           l.provider_id,
           l.thread_key,
           l.order_id,
           l.order_number_snapshot,
           l.channel,
           l.status,
           l.dir,
           l.at,
           l.visible,
           l.owes,
           l.automatic,
           -- The subject a letter names, worked out by mail_letter_rows: the
           -- sorts below carry this short text and never a letter's words.
           l.subject,
           (l.dir = 'outbound'
            AND l.status IN ('HOUSE_QUEUED', 'SENDING', 'AUTO_SENDING', 'SCHEDULED',
                             'AUTO_SEND_SCHEDULED', 'HOUSE_FAILED', 'SEND_REFUSED',
                             'RELAY_REFUSED', 'HOUSE_CANCELLED', 'CANCELLED')) AS unsent
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, p_provider_id) l
    -- A second copy of a letter is not part of any thread.
    WHERE NOT l.duplicate
),
-- One sort per house: each message learns its rank among the thread's
-- visible letters and the thread's last outbound letter, so nothing below
-- joins a CTE back onto itself (the planner cannot estimate those joins and
-- nested-looped them: ~10x slower on a 2,000-row house, measured).
ranked AS (
    SELECT m.*,
           row_number() OVER (PARTITION BY m.provider_id, m.thread_key
                              ORDER BY m.visible DESC, m.at DESC, m.id DESC) AS vis_rank,
           max(m.at) FILTER (WHERE m.visible AND m.dir = 'outbound')
             OVER (PARTITION BY m.provider_id, m.thread_key) AS last_out_at
    FROM matched m
),
per_thread AS (
    SELECT r.provider_id,
           r.thread_key,
           -- Letters only: automatic mail (a bounce, an auto-reply) is not one.
           count(*) FILTER (WHERE NOT r.automatic) AS message_count,
           -- Letters that passed between the house and the vendor: sent or
           -- received. A draft, a queued or a refused letter is on the thread
           -- but is not counted as one of its letters (r28 mail gap 14).
           count(*) FILTER (WHERE r.visible) AS letter_count,
           max(r.at) AS last_any_at,
           max(r.at) FILTER (WHERE r.visible) AS last_visible_at,
           min(r.at) FILTER (WHERE r.owes
                             AND (r.last_out_at IS NULL OR r.at > r.last_out_at))
             AS unanswered_since,
           max(r.dir) FILTER (WHERE r.visible AND r.vis_rank = 1) AS last_direction,
           bool_or(r.owes) FILTER (WHERE r.visible AND r.vis_rank = 1) AS last_owes,
           -- The newest visible letter itself, by id: its one-line preview is
           -- worked out only by a reader that shows it, for the rows it shows
           -- (mail_preview; r35 mail, gap 12).
           (array_agg(r.id) FILTER (WHERE r.visible AND r.vis_rank = 1))[1] AS last_id,
           array_agg(DISTINCT lower(r.channel)) FILTER (WHERE r.visible) AS channels,
           (array_agg(r.order_id ORDER BY r.at DESC, r.id DESC)
              FILTER (WHERE r.order_id IS NOT NULL))[1] AS order_id,
           (array_agg(r.order_number_snapshot ORDER BY r.at DESC, r.id DESC)
              FILTER (WHERE r.order_number_snapshot IS NOT NULL))[1] AS order_number_snapshot,
           -- The first message that names a subject. Headers themselves never
           -- leave this function.
           (array_agg(r.subject ORDER BY r.at ASC, r.id ASC)
              FILTER (WHERE r.subject IS NOT NULL))[1] AS subject,
           -- The thread's newest letter from the house that has NOT left:
           -- queued in its undo window, being sent, scheduled, failed,
           -- refused, or pulled back. list_mail_people names the newest of
           -- these per person from here, so it reads the house's rows once.
           (array_agg(r.id ORDER BY r.at DESC, r.id DESC) FILTER (WHERE r.unsent))[1] AS unsent_id,
           (array_agg(r.at ORDER BY r.at DESC, r.id DESC) FILTER (WHERE r.unsent))[1] AS unsent_at,
           (array_agg(r.status ORDER BY r.at DESC, r.id DESC) FILTER (WHERE r.unsent))[1] AS unsent_status,
           (array_agg(r.channel ORDER BY r.at DESC, r.id DESC) FILTER (WHERE r.unsent))[1] AS unsent_channel
    FROM ranked r
    GROUP BY r.provider_id, r.thread_key
)
SELECT t.provider_id,
       t.thread_key,
       t.message_count,
       t.letter_count,
       t.last_any_at,
       t.last_visible_at,
       t.last_direction,
       t.last_id,
       COALESCE(t.channels, ARRAY[]::text[]) AS channels,
       COALESCE(t.last_owes, false) AS waiting,
       CASE WHEN COALESCE(t.last_owes, false) THEN t.unanswered_since END AS waiting_since,
       t.order_id,
       COALESCE(po.order_number::text, t.order_number_snapshot) AS order_number,
       (po.id IS NOT NULL
        AND po.status::text NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED'))
         AS order_open,
       po.created_at AS order_created_at,
       t.subject,
       t.unsent_id,
       t.unsent_at,
       t.unsent_status,
       t.unsent_channel
FROM per_thread t
LEFT JOIN public.procurement_orders po
  ON po.id = t.order_id AND po.restaurant_id = p_restaurant_id;
$$;

COMMENT ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) IS
  'One row per (vendor, thread_key) of a house: visible/waiting/open defined once '
  'for the Mail tab, and the thread''s newest letter from the house that has not left. '
  'p_withhold_house_letters (default true) removes HOUSE_DRAFT/HOUSE_CANCELLED rows before '
  'anything is counted. (mail_rows_leave_the_letters_words_behind)';

REVOKE ALL ON FUNCTION public.mail_thread_states(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.list_mail_people(
  p_restaurant_id uuid,
  p_withhold_house_letters boolean DEFAULT true,
  p_waiting_only boolean DEFAULT false,
  p_after_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_after_key text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_query text DEFAULT NULL::text
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
-- The house's threads, read once: the list below and the unsent letters both
-- come from here.
WITH s AS MATERIALIZED (
    SELECT *
    FROM public.mail_thread_states(p_restaurant_id, p_withhold_house_letters, NULL)
),
t AS (
    SELECT *
    FROM s
    -- A person is on the list once a letter has passed between them and the
    -- house. A draft-only thread is reachable under the person, never a row.
    WHERE last_visible_at IS NOT NULL
),
-- The house's newest letter to each vendor that has NOT left: queued in its
-- undo window, being sent, scheduled, failed, refused, or pulled back. A
-- vendor whose only letter is one of these stays on the list (QA round 16,
-- HARM 1: a first letter still queued made its vendor vanish, and with it the
-- only way to pull the letter back). Drafts are not here: they are not sent
-- and were never meant to be. Each thread names its own newest one
-- (mail_thread_states); this keeps the newest per person.
unsent AS (
    SELECT DISTINCT ON (s.provider_id)
           s.provider_id, s.unsent_id AS id, s.unsent_at AS at,
           s.unsent_status AS status, s.unsent_channel AS channel
    FROM s
    WHERE s.unsent_id IS NOT NULL
    ORDER BY s.provider_id, s.unsent_at DESC, s.unsent_id DESC
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
    -- The words are read from the stored row itself, joined by id to the
    -- rows this caller may read (r41 mail audit, gap 1). Only a search reads
    -- the house's rows a second time.
    SELECT l.provider_id
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l
    JOIN public.procurement_conversations c
      ON c.id = l.id AND c.restaurant_id = p_restaurant_id
    CROSS JOIN q
    WHERE NOT l.duplicate
      AND c.message_text ~* q.pat
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
           CASE WHEN u.at > n.last_visible_at THEN u.status END AS unsent_status
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
           u.status
    FROM unsent u
    WHERE NOT EXISTS (SELECT 1 FROM person p WHERE p.provider_id = u.provider_id)
),
page AS (
    SELECT k.*, pr.name::text AS name
    FROM keyed k
    LEFT JOIN public.providers pr ON pr.id = k.provider_id
    CROSS JOIN q
    WHERE (p_waiting_only IS NOT TRUE OR k.waiting)
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
       p.unsent_status
FROM page p
LEFT JOIN public.procurement_conversations lc
  ON lc.id = p.last_id AND lc.restaurant_id = p_restaurant_id
ORDER BY p.last_at DESC, p.key ASC;
$$;


CREATE OR REPLACE FUNCTION public.mail_thread_letters(
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
    SELECT (array_agg(m.subject ORDER BY m.at ASC, m.id ASC)
              FILTER (WHERE m.subject IS NOT NULL))[1] AS subject,
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
)
,
-- The page first, by the letters' own time; only its rows read their words.
page AS (
    SELECT m.*
    FROM mine m
    WHERE p_before_at IS NULL
       OR m.at < p_before_at
       OR (m.at = p_before_at AND m.id < p_before_id)
    ORDER BY m.at DESC, m.id DESC
    LIMIT greatest(1, least(COALESCE(p_limit, 51), 501))
)
SELECT m.id,
       m.provider_id,
       pr.name::text,
       m.dir,
       m.channel,
       w.message_text,
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
FROM page m
CROSS JOIN head h
JOIN public.procurement_conversations w
  ON w.id = m.id AND w.restaurant_id = p_restaurant_id
LEFT JOIN public.providers pr ON pr.id = m.provider_id
LEFT JOIN public.procurement_orders po
  ON po.id = h.order_id AND po.restaurant_id = p_restaurant_id
ORDER BY m.at DESC, m.id DESC;
$$;
