-- Mail: a letter's Message-ID is stored in one shape, `<id-left@id-right>`
-- (follow-up to #1014, which only normalised the read side).
--
-- The doors wrote procurement_conversations.message_id in different shapes:
-- the Gmail doors and both minting functions with angle brackets, the inbound
-- webhook with Postmark's own bare delivery UUID, and the orchestrator's
-- parser whatever the event carried. A bare id stored on an inbound row was
-- then dropped by the gateway's threadingHeader (it keeps only `<...>` tokens),
-- so the house's reply to that letter left without In-Reply-To.
--
-- The doors now write '<id>' (rfc822-message-id.ts, rfc822_message_id.py;
-- same rule as below). This migration rewrites the rows already stored.
--
-- Scope: channel 'email' only. WhatsApp writes Meta's wamid into the same
-- column; it is not an RFC Message-ID and is never touched. email_headers is
-- the record of the headers as received and is not rewritten; its readers
-- canonicalise what they read.
--
-- Collisions: uniq_proc_conv_sent_message_id (20260901120000) is UNIQUE on
-- (order_id, message_id) for SENT / AUTO_SENT / SEND_UNCONFIRMED rows. When
-- "<x>" and "x" both sit on one order inside that scope, rewriting the bare
-- one would break the index, so only the first row (one already canonical,
-- else the lowest id) takes the canonical value and the others are left as
-- they are and counted. A canonical value longer than the column (500) is
-- left as it is too. The readers match both shapes, so a left row still
-- threads.
--
-- Idempotent: a second run finds nothing to rewrite. The function stays so
-- the rewrite can be run again after the new code is deployed (rows written
-- by the old code between this migration and that deploy):
--   SELECT * FROM public.mail_message_ids_canonicalise();
-- It is for the service role only. The thread-key trigger fires on the
-- update; it only fills a NULL thread_key or order_number_snapshot.

CREATE OR REPLACE FUNCTION public.mail_message_ids_canonicalise()
RETURNS TABLE(rewritten bigint, left_for_collision bigint)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rewritten bigint;
  v_left bigint;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.mail_mid_canon (
    id uuid PRIMARY KEY,
    order_id uuid,
    old_id text,
    new_id text,
    in_index boolean
  ) ON COMMIT DROP;
  TRUNCATE pg_temp.mail_mid_canon;

  INSERT INTO pg_temp.mail_mid_canon (id, order_id, old_id, new_id, in_index)
  SELECT c.id, c.order_id, c.message_id::text, k.new_id,
         c.order_id IS NOT NULL
           AND c.status::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED')
  FROM public.procurement_conversations c
  CROSS JOIN LATERAL (
    SELECT btrim(substring(c.message_id::text FROM '<([^<>]*[^<>[:space:]][^<>]*)>'),
                 E' \t\r\n\v\f') AS inner_bracketed,
           substring(regexp_replace(c.message_id::text, '^[[:space:]<>]+|[[:space:]<>]+$', '', 'g')
                     FROM '^[^<>[:space:]]+') AS first_bare
  ) t
  CROSS JOIN LATERAL (
    SELECT CASE
             WHEN t.inner_bracketed IS NOT NULL THEN '<' || t.inner_bracketed || '>'
             WHEN t.first_bare IS NOT NULL THEN '<' || t.first_bare || '>'
           END AS new_id
  ) k
  WHERE c.message_id IS NOT NULL
    AND lower(c.channel::text) = 'email';

  -- A row the unique index would refuse: another in-scope row of the same
  -- order already holds the canonical value, or an earlier one (lower id)
  -- will take it in this run.
  SELECT count(*) INTO v_left
  FROM pg_temp.mail_mid_canon s
  WHERE s.new_id IS DISTINCT FROM s.old_id
    AND s.in_index AND s.new_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_temp.mail_mid_canon o
                WHERE o.id <> s.id AND o.in_index AND o.order_id = s.order_id
                  AND o.new_id = s.new_id
                  AND (o.old_id = s.new_id OR o.id < s.id));

  UPDATE public.procurement_conversations c
  SET message_id = s.new_id
  FROM pg_temp.mail_mid_canon s
  WHERE c.id = s.id
    AND s.new_id IS DISTINCT FROM s.old_id
    AND (s.new_id IS NULL OR length(s.new_id) <= 500)
    AND NOT (s.in_index AND s.new_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM pg_temp.mail_mid_canon o
                         WHERE o.id <> s.id AND o.in_index AND o.order_id = s.order_id
                           AND o.new_id = s.new_id
                           AND (o.old_id = s.new_id OR o.id < s.id)));
  GET DIAGNOSTICS v_rewritten = ROW_COUNT;

  TRUNCATE pg_temp.mail_mid_canon;
  RETURN QUERY SELECT v_rewritten, v_left;
END;
$$;

COMMENT ON FUNCTION public.mail_message_ids_canonicalise() IS
  'Rewrites email procurement_conversations.message_id to <id> (20270625100000). Idempotent; leaves a row whose rewrite would break uniq_proc_conv_sent_message_id. Service role only.';

REVOKE ALL ON FUNCTION public.mail_message_ids_canonicalise() FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mail_message_ids_canonicalise() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.mail_message_ids_canonicalise() FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mail_message_ids_canonicalise() TO service_role';
  END IF;
END
$$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.mail_message_ids_canonicalise();
  RAISE NOTICE 'mail_message_id_one_shape: % row(s) rewritten, % left for a unique-index collision',
    r.rewritten, r.left_for_collision;
END
$$;
