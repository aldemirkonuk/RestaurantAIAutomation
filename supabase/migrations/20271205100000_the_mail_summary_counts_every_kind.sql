-- The Mail header's "today" counts include every kind the caller may read
-- (r81 walk w1 finding 5; decision 2026-11-19).
--
-- mail_inbox_summary counted vendor letters only (mail_letter_rows), so a house
-- that reads every conversation (gmail_read_all) saw "Today: 0 letters in, 0
-- out" beside team and guest letters stored that very day. The people list and
-- the thread list already read every kind through mail_other_rows; the summary
-- now does too, for the same callers: mail_other_rows returns nothing when
-- p_withhold_house_letters is true, so staff still count vendors only.
--
-- What does not change, on purpose:
--   * waiting_people ("Mail · N"). It is the number of people waiting for a
--     reply, and no team or guest person is ever waiting (list_mail_people:
--     "No one of these is ever waiting"). Counting them there would make the tab
--     label disagree with the "waiting only" filter.
--   * in_30d, the Letters strip's "Replies · 30 days", which answers orders.
--   * the door times, which say whether a door is working.
-- Same signature and result columns as 20270730143700, so CREATE OR REPLACE.
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mail_inbox_summary: no restaurant %', p_restaurant_id
      USING ERRCODE = 'P0002';
  END IF;

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
  others AS (
      -- A team or guest letter has no order, no vendor and no duplicate rule:
      -- every stored row is a letter. Empty for a caller who may not read them.
      SELECT o.dir, o.at
      FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters) o
  ),
  counted AS (
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
  ),
  other_today AS (
      SELECT CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE o.dir = 'inbound'
                                   AND o.at >= v_day_start AND o.at < v_day_end))::integer END AS in_today,
             CASE WHEN v_tz IS NULL THEN NULL ELSE
               (count(*) FILTER (WHERE o.dir = 'outbound'
                                   AND o.at >= v_day_start AND o.at < v_day_end))::integer END AS out_today
      FROM others o
  )
  SELECT p.waiting_people, p.oldest_wait_at,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.in_today + t.in_today END,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.out_today + t.out_today END,
         c.house_mailbox_last_at, c.whatsapp_last_at, c.mudavym_mail_last_at,
         c.in_30d
  FROM people p CROSS JOIN counted c CROSS JOIN other_today t;
END;
$$;

COMMENT ON FUNCTION public.mail_inbox_summary(uuid, boolean, text) IS
  'The Mail tab header for a house: people waiting, oldest wait, letters in/out on the '
  'house''s own day in p_zone (NULL when no zone is known) across every kind the caller may '
  'read, letters in over the last 30 days (vendors, the Letters strip), and the last letter '
  'stored per door. (the_mail_summary_counts_every_kind)';

REVOKE ALL ON FUNCTION public.mail_inbox_summary(uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mail_inbox_summary(uuid, boolean, text) TO service_role;
