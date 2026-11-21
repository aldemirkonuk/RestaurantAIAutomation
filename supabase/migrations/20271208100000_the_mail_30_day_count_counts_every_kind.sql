-- The 30-day letter count counts every kind the day's count counts (r104 mail-gap g5, walk r103 finding 2).
--
-- mail_inbox_summary added team and guest letters (`others`) to in_today and out_today but left in_30d on
-- vendor letters only, so the Mail header read "Today: 8,997 letters in" beside "30 days: 18". One rule now:
-- in_30d is vendor letters plus the other kinds' letters, from the same mail_other_rows (first row per
-- address and Message-ID, automatic mail left out) that in_today uses. The function has no out_30d column;
-- none is added (it would change the signature the gateway and the web read).
-- Same signature and columns as 20271206100000, so CREATE OR REPLACE.

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
      SELECT o.dir, o.at
      FROM public.mail_other_rows(p_restaurant_id, p_withhold_house_letters) o
      WHERE NOT o.automatic
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
                                   AND o.at >= v_day_start AND o.at < v_day_end))::integer END AS out_today,
             (count(*) FILTER (WHERE o.dir = 'inbound' AND o.at >= v_since))::integer AS in_30d
      FROM others o
  )
  SELECT p.waiting_people, p.oldest_wait_at,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.in_today + t.in_today END,
         CASE WHEN v_tz IS NULL THEN NULL ELSE c.out_today + t.out_today END,
         c.house_mailbox_last_at, c.whatsapp_last_at, c.mudavym_mail_last_at,
         c.in_30d + t.in_30d
  FROM people p CROSS JOIN counted c CROSS JOIN other_today t;
END;
$$;
