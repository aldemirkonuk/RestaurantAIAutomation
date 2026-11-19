-- The Mail list reads the team and guest people it files.
--
-- WHY. A person who agreed to the wider `gmail_read_all` reading has team and
-- guest mail filed in procurement_conversations (20271202100000: kind,
-- from_address, to_addresses, provider_id nullable). The read model of
-- the_mail_list_is_read_by_person knew vendors only, so the Mail tab said
-- "every conversation" over a list of vendors and its Team and Guests chips
-- said "no conversation" about rows in the book (r77 walk w3, finding 1; ADR 0020).
--
-- * mail_letter_rows (the vendor model's one source) now yields vendor rows
--   only; the old body is kept as mail_letter_rows_of_every_kind. Without it a
--   row with no provider became one NULL "person" and counted as owed.
-- * list_mail_people keeps its name and columns and also lists team and guest
--   people, one per (kind, from_address), key team:<address> / guest:<address>,
--   no provider, never waiting. The vendor body is kept as list_mail_vendors.
-- * mail_other_rows is the one read of non-vendor rows; the people, threads and
--   letters of a team or guest person are read through it.
-- Withholding: every non-vendor read returns nothing when
-- p_withhold_house_letters is true (the flag #1917 uses on the thread list), so
-- anyone but the house's owner or a manager cannot learn such a row exists.
-- Header counts stay vendor letters. service_role only, like the originals.

-- 1. The vendor model reads vendors only.
ALTER FUNCTION public.mail_letter_rows(uuid, boolean, uuid)
  RENAME TO mail_letter_rows_of_every_kind;

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
SELECT l.*
FROM public.mail_letter_rows_of_every_kind(p_restaurant_id, p_withhold_house_letters, p_provider_id) l
WHERE EXISTS (SELECT 1 FROM public.procurement_conversations c
              WHERE c.id = l.id AND c.kind = 'vendor');
$$;

-- 2. The one read of non-vendor rows, with each row's time and subject.
CREATE OR REPLACE FUNCTION public.mail_other_rows(
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
  subject text
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
SELECT c.id, c.kind, c.from_address, c.thread_key, lower(c.direction::text),
       c.channel::text, c.message_text, c.ai_generated, c.status::text, c.sent_at,
       c.received_at, c.created_at, c.raw_deleted_at, c.mirrored_by_grant_id,
       COALESCE(CASE WHEN lower(c.direction::text) = 'inbound'
                     THEN c.received_at ELSE c.sent_at END, c.created_at),
       COALESCE(NULLIF(btrim(c.email_headers->>'subject'), ''),
                NULLIF(btrim(c.email_headers->>'Subject'), ''),
                NULLIF(btrim(substring(left(c.message_text, 2000)
                                       FROM '^\s*[Ss]ubject:[ \t]*([^\r\n]*)')), ''))
FROM public.procurement_conversations c
WHERE c.restaurant_id = p_restaurant_id
  AND p_withhold_house_letters IS NOT TRUE
  AND c.kind <> 'vendor'
  AND c.from_address IS NOT NULL
  AND (p_kind IS NULL OR c.kind = p_kind)
  AND (p_address IS NULL OR c.from_address = p_address);
$$;

-- 3. The people list lists every kind.
ALTER FUNCTION public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text)
  RENAME TO list_mail_vendors;

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
WITH q AS (
    SELECT public.mail_search_pattern(p_query) AS pat
),
-- No one of these is ever waiting, so "waiting only" lists none of them.
others AS (
    SELECT o.kind, o.address,
           (o.kind || ':' || o.address) COLLATE "C" AS key,
           max(o.at) AS last_at,
           (array_agg(o.id ORDER BY o.at DESC, o.id DESC))[1] AS last_id,
           (array_agg(o.dir ORDER BY o.at DESC, o.id DESC))[1] AS last_direction,
           count(DISTINCT o.thread_key)::integer AS threads,
           array_agg(DISTINCT lower(o.channel)) AS channels,
           COALESCE(bool_or(o.message_text ~* q.pat), false) AS text_hit
    FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters) o
    CROSS JOIN q
    WHERE p_waiting_only IS NOT TRUE
    GROUP BY o.kind, o.address
),
merged AS (
    SELECT v.key, v.kind, v.provider_id, v.name, v.last_at, v.last_line,
           v.last_direction, v.waiting, v.waiting_since, v.open_threads,
           v.channels, v.newest_open_order_id, v.newest_open_order_number,
           v.unsent_status
    FROM public.list_mail_vendors(p_restaurant_id, p_withhold_house_letters,
           p_waiting_only, p_after_at, p_after_key, p_limit, p_query) v
    UNION ALL
    SELECT p.key::text, p.kind, NULL::uuid, p.address, p.last_at,
           public.mail_preview(lc.message_text), p.last_direction, false,
           NULL::timestamptz, p.threads, p.channels, NULL::uuid, NULL::text,
           NULL::text
    FROM others p
    CROSS JOIN q
    LEFT JOIN public.procurement_conversations lc
      ON lc.id = p.last_id AND lc.restaurant_id = p_restaurant_id
    WHERE (q.pat IS NULL OR p.address ~* q.pat OR p.text_hit)
      AND (p_after_at IS NULL
           OR p.last_at < p_after_at
           OR (p.last_at = p_after_at AND p.key > (p_after_key COLLATE "C")))
)
SELECT m.key, m.kind, m.provider_id, m.name, m.last_at, m.last_line,
       m.last_direction, m.waiting, m.waiting_since, m.open_threads,
       m.channels, m.newest_open_order_id, m.newest_open_order_number,
       m.unsent_status
FROM merged m
ORDER BY m.last_at DESC, m.key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

-- 4. One team or guest person's threads.
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
    SELECT o.thread_key, count(*) AS n, max(o.at) AS last_at,
           (array_agg(o.dir ORDER BY o.at DESC, o.id DESC))[1] AS dir,
           (array_agg(o.subject ORDER BY o.at ASC, o.id ASC)
              FILTER (WHERE o.subject IS NOT NULL))[1] AS subject
    FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters, p_kind, p_address) o
    WHERE o.thread_key IS NOT NULL
    GROUP BY o.thread_key
)
SELECT t.thread_key, t.subject, t.n, t.n, t.last_at, t.dir, false, NULL::uuid, NULL::text
FROM t
WHERE p_after_at IS NULL
   OR t.last_at < p_after_at
   OR (t.last_at = p_after_at AND (t.thread_key COLLATE "C") > (p_after_key COLLATE "C"))
ORDER BY t.last_at DESC, t.thread_key COLLATE "C" ASC
LIMIT greatest(1, least(COALESCE(p_limit, 50), 500));
$$;

-- 5. One team or guest person's letters under one thread key.
CREATE OR REPLACE FUNCTION public.mail_thread_letters_other(
  p_restaurant_id uuid,
  p_thread_key text,
  p_kind text,
  p_address text,
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
WITH mine AS (
    SELECT o.*
    FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters, p_kind, p_address) o
    WHERE o.thread_key = p_thread_key
),
head AS (
    SELECT (array_agg(m.subject ORDER BY m.at ASC, m.id ASC)
              FILTER (WHERE m.subject IS NOT NULL))[1] AS subject
    FROM mine m
)
SELECT m.id, NULL::uuid, m.address, m.dir, m.channel, m.message_text, m.ai_generated,
       m.status, m.sent_at, m.received_at, m.created_at, m.at, m.raw_deleted_at,
       m.mirrored_by_grant_id, h.subject, NULL::uuid, NULL::text, NULL::text,
       false, NULL::timestamptz, false
FROM mine m
CROSS JOIN head h
WHERE p_before_at IS NULL
   OR m.at < p_before_at
   OR (m.at = p_before_at AND m.id < p_before_id)
ORDER BY m.at DESC, m.id DESC
LIMIT greatest(1, least(COALESCE(p_limit, 51), 501));
$$;

REVOKE ALL ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid),
  public.mail_other_rows(uuid, boolean, text, text),
  public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text),
  public.list_mail_threads_other(uuid, text, text, boolean, timestamp with time zone, text, integer),
  public.mail_thread_letters_other(uuid, text, text, text, boolean, timestamp with time zone, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid),
  public.mail_other_rows(uuid, boolean, text, text),
  public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text),
  public.list_mail_threads_other(uuid, text, text, boolean, timestamp with time zone, text, integer),
  public.mail_thread_letters_other(uuid, text, text, text, boolean, timestamp with time zone, uuid, integer)
  TO service_role;
