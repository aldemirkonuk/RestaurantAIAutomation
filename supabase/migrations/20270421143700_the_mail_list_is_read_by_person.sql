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
-- These functions are the server read model behind that tab (sw-walk
-- mail proposal, Phase B row L8, narrowed to the store that exists today):
--
--   mail_letter_rows     every row a house's Mail tab reads, with its time
--                        and whether it is a letter: the one place a row's
--                        "visible", "owes" and time are worked out.
--   mail_thread_states   one row per (vendor, thread_key): the single place
--                        "visible", "waiting" and "open" are defined, so the
--                        list, the thread rows and the header can never
--                        disagree about who is waiting.
--   list_mail_people     one row per vendor, keyset-paged, no OFFSET, no cap.
--   list_mail_threads    one row per thread for one vendor, keyset-paged.
--   mail_inbox_summary   the header numbers and per-door "last letter stored",
--                        counted here with count(*), never in JS over a capped
--                        read.
--   mail_thread_letters  one page of ONE vendor's letters under one thread
--                        key, in the order they happened, keyset-paged.
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
-- A thread reads in that time too, never in created_at order: a mailbox
-- backfill stores old letters after new ones, and created_at order then reads
-- a thread backwards (QA round 18 on PR #895, finding 2).
--
-- THREAD KEYS
-- -----------
-- thread_key is set on every insert by trg_procurement_conversations_thread_key
-- (baseline set_conversation_thread_key); a thread is (provider_id,
-- thread_key), so the same key under two vendors is two threads — one Gmail
-- thread the house mailbox wrote to two vendors (a `gm:` key), or one group
-- mail (a `mid:` key). That holds in every function here, the thread page
-- included: a page asked for by key alone belongs to the vendor of the
-- thread's first letter, and never mixes in another vendor's letters.
--
-- NEEDS NO REPLY (r28 mail audit, gap 4)
-- ----------------------------------------
-- Before this, a thread stopped waiting only when a letter the house sent was
-- stored in the same thread. A vendor's "Thanks!", an answer the owner gave by
-- phone, or a reply sent from Gmail that Mudavym never reads kept "N vendors
-- are waiting on you" and the tab badge up for good: Mail had no act at all.
--
-- An owner or manager can now say a letter the house received needs no reply.
-- The mark is a row in mail_letter_no_reply_marks naming that letter. It
-- settles that letter and every earlier letter of the same thread, in the
-- thread's own order (at, id). It settles nothing after it: a letter that
-- arrives later makes the thread wait again, from that letter. Letter rows are
-- never changed (their status is read by orders, the scorecard and the AI
-- responder), and the mark can be taken back.
--
-- The mark names a letter, never a thread key, so it follows the letter if
-- its thread is joined to another one later (one_conversation_is_one_thread
-- re-keys rows). A settled letter is still visible; it only stops owing.
-- The two functions that set and take back a mark are in
-- 20271013143000_a_letter_can_need_no_reply.sql; this file holds the table
-- because mail_letter_rows reads it.
--
-- ACCESS
-- ------
-- SECURITY INVOKER, EXECUTE for service_role only, the same as
-- list_conversation_threads: the withholding flag is caller-supplied, so a
-- client able to call these could pass false. CREATE FUNCTION gives EXECUTE to
-- PUBLIC by default, so it is revoked explicitly below. The marks table is the
-- gateway's alone too: RLS on, no policy, nothing granted to anon or
-- authenticated.

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
),
base AS (
SELECT c.id,
       c.provider_id,
       c.thread_key,
       c.order_id,
       c.order_number_snapshot,
       lower(c.direction::text) AS dir,
       c.channel::text AS channel,
       c.message_text,
       c.email_headers,
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
       -- The same letter delivered twice (both doors, or a redelivery) has one
       -- Message-ID: the first row stored is the letter, the rest are copies.
       COALESCE(lower(c.direction::text) = 'inbound'
        AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL
        AND row_number() OVER (PARTITION BY c.provider_id, lower(btrim(c.message_id::text)),
                                            (lower(c.direction::text) = 'inbound'
                                             AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL)
                               ORDER BY c.created_at ASC, c.id ASC) > 1, false) AS duplicate,
       -- Settled by a "needs no reply" mark on this letter or a later one of
       -- its thread. Row comparison: the same (at, id) order the thread reads in.
       COALESCE((COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                               THEN c.received_at ELSE c.sent_at END,
                          c.created_at), c.id)
                <= (mk.through_at, mk.through_id), false) AS settled,
       own.marked_at AS no_reply_marked_at
FROM public.procurement_conversations c
LEFT JOIN marks mk
  ON mk.provider_id = c.provider_id
 AND mk.thread_key = c.thread_key
LEFT JOIN public.mail_letter_no_reply_marks own
  ON own.conversation_id = c.id
 AND own.restaurant_id = p_restaurant_id
WHERE c.restaurant_id = p_restaurant_id
  AND (p_provider_id IS NULL OR c.provider_id = p_provider_id)
  AND (p_withhold_house_letters IS NOT TRUE
       OR c.status IS NULL
       OR c.status::text NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
)
SELECT r.id, r.provider_id, r.thread_key, r.order_id, r.order_number_snapshot, r.dir,
       r.channel, r.message_text, r.email_headers, r.status, r.ai_generated,
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
  'reads, with its time, the visible/owes flags, and whether it is automatic mail (an '
  'auto-reply or a bounce) or a second copy of a letter already stored (same Message-ID); '
  'neither is ever visible or owed. A letter at or before a "needs no reply" mark of its '
  'thread owes nothing. Withheld rows are removed first. The one definition '
  'the other mail functions share (the_mail_list_is_read_by_person).';


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
  subject text
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
           -- The subject a letter names: the header the bridge stored, else
           -- the "Subject: ..." line it writes at the top of message_text.
           -- Read here, once per letter, so the sorts below carry this short
           -- text and never a letter's whole words (r35 mail, gap 12).
           s.subject
    FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, p_provider_id) l
    CROSS JOIN LATERAL (
        SELECT COALESCE(
                 NULLIF(btrim(l.email_headers->>'subject'), ''),
                 NULLIF(btrim(l.email_headers->>'Subject'), ''),
                 NULLIF(btrim(substring(left(l.message_text, 2000)
                                        FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), '')
               ) AS subject
    ) s
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
              FILTER (WHERE r.subject IS NOT NULL))[1] AS subject
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
       t.subject
FROM per_thread t
LEFT JOIN public.procurement_orders po
  ON po.id = t.order_id AND po.restaurant_id = p_restaurant_id;
$$;

COMMENT ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) IS
  'One row per (vendor, thread_key) of a house: visible/waiting/open defined once '
  'for the Mail tab (the_mail_list_is_read_by_person). p_withhold_house_letters '
  '(default true) removes HOUSE_DRAFT/HOUSE_CANCELLED rows before anything is counted.';


-- Text as the Mail search compares it (r28 mail gap 16): Turkish and the
-- common Latin accents read as their plain letter, then lower case, so
-- "sut", "Süt" and "SÜT" find each other and "Istanbul" finds "İstanbul".
-- translate() runs first because lower() of a dotted capital I is not "i"
-- in every collation.
CREATE OR REPLACE FUNCTION public.mail_fold(p_text text)
RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = ''
    AS $$
SELECT lower(translate(p_text,
  'İIıÇçĞğÖöŞşÜüÂâÎîÛûÁáÀàÄäÉéÈèÊêËëÍíÌìÓóÒòÔôÚúÙùÑñ',
  'iiiccggoossuuaaiiuuaaaaaaeeeeeeeeiiiioooooouuuunn'));
$$;

COMMENT ON FUNCTION public.mail_fold(text) IS
  'Folds Turkish and common accented letters to plain lower case for the Mail '
  'search (the_mail_list_is_read_by_person, r28 mail gap 16).';

-- The search as a case-blind regular expression (use with ~*): what was
-- typed, trimmed, cut to 100 characters and folded, each plain letter
-- standing for its accented and Turkish forms, every other character taken
-- literally (a backslash before a character that is not a letter or digit
-- makes it plain). NULL for no search. The fold is applied to the few
-- characters typed, never to the letters searched: translate() over every
-- letter's text was most of the search's time (measured, PR body).
CREATE OR REPLACE FUNCTION public.mail_search_pattern(p_query text)
RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = ''
    AS $$
SELECT string_agg(
         CASE ch
           WHEN 'a' THEN '[aâáàäAÂÁÀÄ]'
           WHEN 'c' THEN '[cçCÇ]'
           WHEN 'e' THEN '[eéèêëEÉÈÊË]'
           WHEN 'g' THEN '[gğGĞ]'
           WHEN 'i' THEN '[iıîíìIİÎÍÌ]'
           WHEN 'n' THEN '[nñNÑ]'
           WHEN 'o' THEN '[oöóòôOÖÓÒÔ]'
           WHEN 's' THEN '[sşSŞ]'
           WHEN 'u' THEN '[uüûúùUÜÛÚÙ]'
           ELSE CASE WHEN ch ~ '^[[:alnum:]]$' THEN ch ELSE '\' || ch END
         END, '' ORDER BY n)
FROM (SELECT public.mail_fold(left(btrim(p_query), 100)) AS f) x
CROSS JOIN LATERAL generate_series(1, length(x.f)) AS n
CROSS JOIN LATERAL (SELECT substr(x.f, n, 1) AS ch) c;
$$;

COMMENT ON FUNCTION public.mail_search_pattern(text) IS
  'The Mail search as a case-blind regular expression for ~*: folded, each plain letter '
  'standing for its accented and Turkish forms, all else literal (r28 mail gap 16).';


-- A letter's one-line preview: its leading "Subject: ..." line removed,
-- whitespace folded, cut to 160 characters. Its own function since r35 (mail
-- gap 12) so a list works it out only for the rows it shows: run over every
-- thread of a house, this regex was most of each poll's time (PGlite, 6,000
-- letters: about 450 of 650 ms).
CREATE OR REPLACE FUNCTION public.mail_preview(p_text text)
RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path = ''
    AS $$
SELECT CASE WHEN p_text IS NULL THEN NULL
            ELSE left(btrim(regexp_replace(
                   regexp_replace(left(p_text, 4000),
                                  '^\s*[Ss]ubject:[^\n]*(\n|$)', ''),
                   '\s+', ' ', 'g')), 160)
       END;
$$;

COMMENT ON FUNCTION public.mail_preview(text) IS
  'A letter''s one-line preview for the Mail list: leading Subject line removed, whitespace '
  'folded, 160 characters (r35 mail gap 12).';


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

COMMENT ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text) IS
  'One page of the people a house has mail with, newest letter first, keyset-paged by '
  '(last_at desc, key); a vendor whose only letter has not left (queued, failed, refused, '
  'pulled back) is listed with unsent_status. p_query keeps only the people whose name, a '
  'thread subject or order number, or a readable letter holds it, accents folded. Vendors '
  'only until non-vendor mail is stored. '
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
       t.letter_count,
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
      SELECT l.dir, l.channel, l.mirrored_by_grant_id, l.at, l.visible, l.automatic, l.duplicate
      FROM public.mail_letter_rows(p_restaurant_id, p_withhold_house_letters, NULL) l
  ),
  counted AS (
      -- "In today" counts letters: a second copy of one letter, a bounce and
      -- an auto-reply are not letters (QA round 16, M-5). The door times below
      -- still see every stored row: they say the door is working.
      SELECT (count(*) FILTER (WHERE l.dir = 'inbound' AND l.visible
                                 AND l.at >= v_day_start AND l.at < v_day_end))::integer AS in_today,
             (count(*) FILTER (WHERE l.dir = 'outbound' AND l.visible
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



-- No new index. Measured on a 2,000-row house (PR body): one vendor's rows
-- are found through the existing idx_procurement_conversations_provider_created
-- (0.12 ms; 0.26 ms with a trial (restaurant_id, provider_id) index), so a
-- second index on every write to this table buys nothing. The people list and
-- the summary read the whole house through idx_conv_restaurant_id either way.


-- Only the gateway may call these (see ACCESS above).
REVOKE ALL ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_thread_states(uuid, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_fold(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_search_pattern(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_preview(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_mail_threads(uuid, uuid, boolean, timestamp with time zone, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_inbox_summary(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_thread_states(uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_fold(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_search_pattern(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_preview(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_mail_threads(uuid, uuid, boolean, timestamp with time zone, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_inbox_summary(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer) TO service_role;
