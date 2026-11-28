-- "Not now" (r110 mail, DD-r109-13): an owner or manager puts a waiting thread off until a time.
-- Until then it is not waiting anywhere: the list, the person's threads, the rail badge and the
-- tab title all read mail_thread_states, and mail_thread_states now asks mail_thread_snoozed.
-- A newer letter from the vendor ends it at once; so does the time passing; so does the house
-- answering the thread (an answered thread is not 'back', it was answered). Nothing else does.
--
-- The thread is the pair (provider_id, thread_key), as everywhere in Mail: one Gmail thread to
-- two vendors is two threads, so putting one off never puts off the other.
--
-- "A newer letter" is newer than the newest letter the vendor had written when "Not now" was
-- said (known_in_at), not newer than the click. A letter received at 10:00 and mirrored at
-- 10:05 was never seen by someone who said "Not now" at 10:02; it ends the wait it was never
-- part of.
--
-- Only the gateway reads or writes this (service_role). No client role has the table or the
-- functions. The time is worked out in the gateway on the house's clock; this file only stores it.

CREATE TABLE public.mail_thread_snoozes (
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  thread_key text NOT NULL,
  until timestamptz NOT NULL,
  -- The newest letter the vendor had written on this thread when it was put off; NULL for none.
  known_in_at timestamptz,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, provider_id, thread_key)
);
ALTER TABLE public.mail_thread_snoozes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_thread_snoozes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.mail_thread_snoozes TO service_role;

-- The one rule. 'on': put off and its time has not come. 'back': its time came and the vendor
-- has not written since. 'ended': the vendor wrote again, or the house sent a letter on the thread
-- after it was put off. NULL: never put off.
CREATE FUNCTION public.mail_thread_snooze_state(
  p_until timestamptz, p_known_in_at timestamptz, p_last_in_at timestamptz,
  p_set_at timestamptz, p_last_out_at timestamptz
) RETURNS text
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
SELECT CASE
         WHEN p_until IS NULL THEN NULL
         WHEN p_last_in_at IS NOT NULL
              AND (p_known_in_at IS NULL OR p_last_in_at > p_known_in_at) THEN 'ended'
         WHEN p_last_out_at IS NOT NULL AND p_last_out_at > p_set_at THEN 'ended'
         WHEN p_until > now() THEN 'on'
         ELSE 'back'
       END;
$$;

-- Whether a thread is put off right now. Every waiting count asks this, through mail_thread_states.
CREATE FUNCTION public.mail_thread_snoozed(
  p_until timestamptz, p_known_in_at timestamptz, p_last_in_at timestamptz,
  p_set_at timestamptz, p_last_out_at timestamptz
) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
SELECT COALESCE(public.mail_thread_snooze_state(p_until, p_known_in_at, p_last_in_at, p_set_at, p_last_out_at) = 'on', false);
$$;

-- Same signature and columns as 20270421143700, so CREATE OR REPLACE keeps its grants; the body
-- gains last_in_at and the snooze join, nothing else.
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
              FILTER (WHERE r.subject IS NOT NULL))[1] AS subject,
           -- The newest letter the vendor wrote: one newer than the house knew
           -- of when it said "Not now" ends that (mail_thread_snooze_state).
           max(r.at) FILTER (WHERE r.dir = 'inbound' AND r.visible AND NOT r.automatic) AS last_in_at,
           -- The newest letter the house sent: answering a put-off thread ends the put-off too.
           max(r.at) FILTER (WHERE r.dir = 'outbound' AND r.visible) AS last_out_at
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
       -- "Not now" (r110): a thread the house put off is not waiting until its
       -- time comes or the vendor writes again. The one rule: mail_thread_snoozed.
       w.waiting,
       CASE WHEN w.waiting THEN t.unanswered_since END AS waiting_since,
       t.order_id,
       COALESCE(po.order_number::text, t.order_number_snapshot) AS order_number,
       (po.id IS NOT NULL
        AND po.status::text NOT IN ('DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED', 'FAILED'))
         AS order_open,
       po.created_at AS order_created_at,
       t.subject
FROM per_thread t
LEFT JOIN public.mail_thread_snoozes sz
  ON sz.restaurant_id = p_restaurant_id
 AND sz.provider_id = t.provider_id
 AND sz.thread_key = t.thread_key
CROSS JOIN LATERAL (
    SELECT COALESCE(t.last_owes, false)
           AND NOT public.mail_thread_snoozed(sz.until, sz.known_in_at, t.last_in_at, sz.set_at, t.last_out_at) AS waiting
) w
LEFT JOIN public.procurement_orders po
  ON po.id = t.order_id AND po.restaurant_id = p_restaurant_id;
$$;
-- Put a thread off. The thread must be this house's and this vendor's: a key another house
-- holds, or none holds, raises P0002 (the gateway answers 404). A time already past, or more
-- than eight days ahead, raises 22023. Saying it again moves the time and what is known.
CREATE FUNCTION public.set_mail_thread_snooze(
  p_restaurant_id uuid, p_provider_id uuid, p_thread_key text, p_until timestamptz, p_set_by uuid
) RETURNS timestamptz
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER
    SET search_path = ''
    AS $$
DECLARE
  v_letters bigint;
  v_known timestamptz;
BEGIN
  IF p_until IS NULL OR p_until <= now() OR p_until > now() + interval '8 days' THEN
    RAISE EXCEPTION 'set_mail_thread_snooze: % is not a time to come back', p_until
      USING ERRCODE = '22023';
  END IF;
  SELECT count(*),
         max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.visible AND NOT l.automatic)
    INTO v_letters, v_known
  FROM public.mail_letter_rows(p_restaurant_id, false, p_provider_id) l
  WHERE p_provider_id IS NOT NULL
    AND l.thread_key = p_thread_key
    AND NOT l.duplicate;
  IF v_letters = 0 THEN
    RAISE EXCEPTION 'set_mail_thread_snooze: no such thread' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.mail_thread_snoozes AS s
    (restaurant_id, provider_id, thread_key, until, known_in_at, set_by, set_at)
  VALUES (p_restaurant_id, p_provider_id, p_thread_key, p_until, v_known, p_set_by, now())
  ON CONFLICT (restaurant_id, provider_id, thread_key) DO UPDATE
    SET until = EXCLUDED.until, known_in_at = EXCLUDED.known_in_at,
        set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
  RETURN p_until;
END;
$$;

-- Take it back (Undo), or clear a thread that came back once it is opened. True when there was one.
CREATE FUNCTION public.clear_mail_thread_snooze(
  p_restaurant_id uuid, p_provider_id uuid, p_thread_key text
) RETURNS boolean
    LANGUAGE sql VOLATILE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH gone AS (
    DELETE FROM public.mail_thread_snoozes s
    WHERE s.restaurant_id = p_restaurant_id
      AND s.provider_id = p_provider_id
      AND s.thread_key = p_thread_key
    RETURNING 1
)
SELECT EXISTS (SELECT 1 FROM gone);
$$;

-- The house's snoozes for some vendors, each with its state by the one rule. The gateway reads
-- this to say "Not now until ..." on a thread and "Back from Not now" on a row.
CREATE FUNCTION public.mail_thread_snooze_rows(
  p_restaurant_id uuid, p_provider_ids uuid[]
) RETURNS TABLE(provider_id uuid, thread_key text, until timestamptz, state text)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
SELECT s.provider_id, s.thread_key, s.until,
       public.mail_thread_snooze_state(s.until, s.known_in_at, li.last_in_at, s.set_at, li.last_out_at)
FROM public.mail_thread_snoozes s
CROSS JOIN LATERAL (
    SELECT max(l.at) FILTER (WHERE l.dir = 'inbound' AND l.visible AND NOT l.automatic) AS last_in_at,
           max(l.at) FILTER (WHERE l.dir = 'outbound' AND l.visible) AS last_out_at
    FROM public.mail_letter_rows(p_restaurant_id, false, s.provider_id) l
    WHERE l.thread_key = s.thread_key
      AND NOT l.duplicate
) li
WHERE s.restaurant_id = p_restaurant_id
  AND s.provider_id = ANY (p_provider_ids);
$$;

REVOKE ALL ON FUNCTION public.mail_thread_snooze_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.mail_thread_snoozed(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.set_mail_thread_snooze(uuid, uuid, text, timestamptz, uuid),
  public.clear_mail_thread_snooze(uuid, uuid, text),
  public.mail_thread_snooze_rows(uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_thread_snooze_state(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.mail_thread_snoozed(timestamptz, timestamptz, timestamptz, timestamptz, timestamptz),
  public.set_mail_thread_snooze(uuid, uuid, text, timestamptz, uuid),
  public.clear_mail_thread_snooze(uuid, uuid, text),
  public.mail_thread_snooze_rows(uuid, uuid[])
  TO service_role;
