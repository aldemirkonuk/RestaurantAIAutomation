-- Mail: "automatic" means a bounce or an auto-reply, and nothing a person wrote.
--
-- Audit follow-up on PR 951 (2026-11-07). mail_letter_rows (migration
-- 20270421143700_the_mail_list_is_read_by_person) called an inbound row
-- automatic when the bridge's transport.autoSubmitted was true. That flag is
-- the triage's broad "machine-ish" marker: it is also true for
-- `Auto-Submitted: auto-generated` (a vendor ERP's real order confirmation or
-- invoice) and for `X-Auto-Response-Suppress`, an instruction to the RECIPIENT
-- that Outlook / Microsoft 365 puts on ordinary person-written mail. So a
-- Microsoft 365 vendor's real reply was hidden from "waiting", never the last
-- line, and not counted in today's letters.
--
-- Automatic is now only what QA M-5 named (bounces) plus true auto-replies:
--   * From mailer-daemon@ / postmaster@ (unchanged);
--   * transport.deliveryReport: Content-Type multipart/report;
--     report-type=delivery-status (RFC 3464), the bridge's new signal;
--   * transport.autoReplied: Auto-Submitted: auto-replied exactly (RFC 3834),
--     an out-of-office, the bridge's new signal.
-- Rows stored before the bridge wrote those two signals carry only
-- autoSubmitted; they now read as letters unless they came from a mail server.
-- That errs toward showing a letter, never toward hiding one.
--
-- Only the `automatic` expression changes; the function's shape, privileges
-- (service_role only) and every other column are as before. A new migration
-- rather than an edit of 20270421143700 so the change is applied whatever order
-- the mail stack's PRs merge in.

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
  duplicate boolean
)
    LANGUAGE sql STABLE SECURITY INVOKER
    SET search_path = ''
    AS $$
WITH base AS (
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
       -- Mail a machine wrote: a bounce (from mailer-daemon@ / postmaster@, or
       -- a delivery status report) or an auto-reply (Auto-Submitted:
       -- auto-replied exactly). Never Auto-Submitted: auto-generated and never
       -- X-Auto-Response-Suppress: a vendor's ERP confirmation and an Outlook
       -- reply carry those, and both are letters. It stays on the thread,
       -- named as automatic, but is never counted, never the last line and
       -- never makes anyone "waiting".
       COALESCE(lower(c.direction::text) = 'inbound'
        AND ((c.email_headers->'transport'->>'autoReplied') = 'true'
             OR (c.email_headers->'transport'->>'deliveryReport') = 'true'
             OR (c.email_headers->>'from') ~* '(^|[<\s"''])(mailer-daemon|postmaster)@'), false) AS automatic,
       -- The same letter delivered twice (both doors, or a redelivery) has one
       -- Message-ID: the first row stored is the letter, the rest are copies.
       COALESCE(lower(c.direction::text) = 'inbound'
        AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL
        AND row_number() OVER (PARTITION BY c.provider_id, lower(btrim(c.message_id::text)),
                                            (lower(c.direction::text) = 'inbound'
                                             AND NULLIF(btrim(c.message_id::text), '') IS NOT NULL)
                               ORDER BY c.created_at ASC, c.id ASC) > 1, false) AS duplicate
FROM public.procurement_conversations c
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
       r.owes_raw AND NOT r.automatic AND NOT r.duplicate,
       r.automatic,
       r.duplicate
FROM base r;
$$;

COMMENT ON FUNCTION public.mail_letter_rows(uuid, boolean, uuid) IS
  'Every procurement_conversations row of a house (of one vendor, when named) the Mail tab '
  'reads, with its time, the visible/owes flags, and whether it is automatic mail (a bounce, '
  'or an auto-reply marked Auto-Submitted: auto-replied; never auto-generated mail or '
  'X-Auto-Response-Suppress) or a second copy of a letter already stored (same Message-ID); '
  'neither is ever visible or owed. Withheld rows are removed first. The one definition '
  'the other mail functions share (mail_automatic_is_a_bounce_or_an_auto_reply).';
