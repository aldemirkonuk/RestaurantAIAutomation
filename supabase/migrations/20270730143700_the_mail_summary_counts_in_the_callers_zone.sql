-- The Mail summary counts in the caller's zone, and counts 30 days of replies.
--
-- WHY A NEW MIGRATION
-- -------------------
-- mail_inbox_summary was created by the_mail_list_is_read_by_person with two
-- arguments. This file replaces it with a three-argument version instead of
-- editing that migration in place: once the_mail_list_is_read_by_person has
-- been applied anywhere its version is recorded, and an edit to it would never
-- run there again, leaving the two-argument function behind while the gateway
-- calls rpc('mail_inbox_summary', { p_zone }) (mail-receipts lane fix round,
-- 2026-11-12, finding on PR #1093).
--
-- The return type changes (in_30d is added), so the old signature is dropped
-- first; CREATE OR REPLACE cannot change a function's result columns.

-- The zone is the CALLER's, never read here (D7, mail-receipts lane
-- 2026-11-11). The gateway resolves it by the one rule every house-day reader
-- uses (apps/api-gateway/src/common/house-day.ts readHouseZone: the house's
-- own zone, else its country's only zone, else none — never UTC). This used to
-- COALESCE a missing restaurants.timezone to 'UTC', so a house in Istanbul with
-- no zone set read "Today: 0 letters in" beside letters stamped that
-- afternoon. With no zone, in_today and out_today are NULL: the day has no
-- midnight, so the count is not known. The 30-day figure is a rolling window
-- of instants and needs no zone.
--
-- in_30d is the Letters strip's "Replies · 30 days" (D6). That strip counted
-- every INBOUND row of the conversation book — bounces, auto-replies and
-- second copies of one letter included — and read 7 where Mail read 4. Both
-- tabs now count with the one `visible` flag of mail_letter_rows, so the same
-- letters give the same number on both.
DROP FUNCTION IF EXISTS public.mail_inbox_summary(uuid, boolean);

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
  -- No house, no numbers: an answer of zeros for a house that does not exist
  -- would read as a quiet inbox (ADR 0051 — absence is not health).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mail_inbox_summary: no restaurant %', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

  -- The house's own day. A bad zone name raises here rather than counting a
  -- UTC day under the house's name. No zone: no day, so both bounds stay NULL
  -- and the two "today" counts come back NULL, never 0.
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
  counted AS (
      -- "In today" counts letters: a second copy of one letter, a bounce and
      -- an auto-reply are not letters (QA round 16, M-5). The door times below
      -- still see every stored row: they say the door is working.
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
  )
  SELECT p.waiting_people, p.oldest_wait_at,
         c.in_today, c.out_today,
         c.house_mailbox_last_at, c.whatsapp_last_at, c.mudavym_mail_last_at,
         c.in_30d
  FROM people p CROSS JOIN counted c;
END;
$$;

COMMENT ON FUNCTION public.mail_inbox_summary(uuid, boolean, text) IS
  'The Mail tab header for a house: people waiting, oldest wait, letters in/out on the '
  'house''s own day in p_zone (NULL when no zone is known), letters in over the '
  'last 30 days (the Letters strip), and the last letter stored per door. Counted with '
  'count(*). (the_mail_summary_counts_in_the_callers_zone)';

REVOKE ALL ON FUNCTION public.mail_inbox_summary(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_inbox_summary(uuid, boolean, text) TO service_role;
