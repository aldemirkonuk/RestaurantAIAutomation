-- Mail: one letter, whatever door it came through; a vendor at postmaster@
-- is still the vendor; an MTA bounce is read by its own header (QA round 22
-- on #946, 2026-11-11).
--
-- Replaces mail_letter_rows from 20270610100100 (the newest definition on the
-- mail stack; any older file would be overwritten by it). Three changes:
--
--  1. The copy key strips the angle brackets and white space around a
--     Message-ID before lower-casing: one door stores "<id@x>", another "id@x",
--     and both are the same letter (QA B3).
--  2. Of several copies, a copy that is NOT set aside (DISCARDED) is the
--     letter: the first copy stored no longer wins when it is the discarded
--     one, so the live copy is never the hidden one (QA B6).
--  3. "From a mail server" (transport.fromMailServer, or the raw-From fallback)
--     no longer applies when the From's own mailbox is the vendor's book
--     address (providers.contact_email or primary_contact.email): a vendor
--     whose real address is postmaster@ is that vendor (QA C6). A delivery
--     report or an auto-reply flag still makes such a row automatic.
--
-- Shape and privileges are unchanged.

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
       -- Mail a machine wrote: a bounce (the From's own mailbox is
       -- mailer-daemon@ / postmaster@, or a delivery status report) or an
       -- auto-reply (Auto-Submitted: auto-replied, X-Autoreply, X-Autorespond
       -- or Precedence: auto_reply, all read by the bridge into autoReplied).
       -- Never Auto-Submitted: auto-generated and never
       -- X-Auto-Response-Suppress: a vendor's ERP confirmation and an Outlook
       -- reply carry those, and both are letters. It stays on the thread,
       -- named as automatic, but is never counted, never the last line and
       -- never makes anyone "waiting".
       --
       -- "From a mail server" is the bridge's transport.fromMailServer, read
       -- from the PARSED From. A row stored before the bridge wrote it falls
       -- back to the raw From, but only when mailer-daemon@ / postmaster@ is
       -- the header's last address (bare, or in the final <...>, optionally
       -- followed by one comment): a display name that names postmaster on a
       -- person's letter is not a bounce.
       COALESCE(lower(c.direction::text) = 'inbound'
        AND ((c.email_headers->'transport'->>'autoReplied') = 'true'
             OR (c.email_headers->'transport'->>'deliveryReport') = 'true'
             -- A CASE, not ::boolean: a malformed stored value must not
             -- make the whole house's Mail list throw.
             OR (COALESCE(CASE c.email_headers->'transport'->>'fromMailServer'
                            WHEN 'true' THEN true WHEN 'false' THEN false END,
                          (c.email_headers->>'from') ~* '(^|<)\s*(mailer-daemon|postmaster)@[^\s<>()"]+>?\s*(\([^()]*\))?\s*$')
                 -- The vendor's own book address is the vendor, never a
                 -- mail server: a small shop that writes from postmaster@.
                 AND NOT EXISTS (
                       SELECT 1
                       FROM (VALUES (pr.contact_email::text),
                                    (pr.primary_contact->>'email')) v(e)
                       WHERE NULLIF(btrim(v.e), '') IS NOT NULL
                         AND lower(btrim(v.e)) = lower(COALESCE(
                               substring(c.email_headers->>'from' FROM '<\s*([^<>\s]+@[^<>\s]+)\s*>[^<>]*$'),
                               substring(c.email_headers->>'from' FROM '^\s*([^<>\s"()]+@[^<>\s"()]+)')))))), false) AS automatic,
       -- The same letter delivered twice (both doors, or a redelivery) has one
       -- Message-ID (angle brackets and white space aside): the first row
       -- stored that was not set aside is the letter, the rest are copies.
       COALESCE(lower(c.direction::text) = 'inbound'
        AND NULLIF(btrim(c.message_id::text, E' \t\r\n<>'), '') IS NOT NULL
        AND row_number() OVER (PARTITION BY c.provider_id,
                                            lower(btrim(c.message_id::text, E' \t\r\n<>')),
                                            (lower(c.direction::text) = 'inbound'
                                             AND NULLIF(btrim(c.message_id::text, E' \t\r\n<>'), '') IS NOT NULL)
                               -- A set-aside copy never hides a live one.
                               ORDER BY (c.status::text IS NOT DISTINCT FROM 'DISCARDED') ASC,
                                        c.created_at ASC, c.id ASC) > 1, false) AS duplicate
FROM public.procurement_conversations c
LEFT JOIN public.providers pr ON pr.id = c.provider_id
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
  'or an auto-reply marked Auto-Submitted: auto-replied, X-Autoreply, X-Autorespond or '
  'Precedence: auto_reply; a bounce is read from the parsed From, never a display name; '
  'never auto-generated mail or '
  'X-Auto-Response-Suppress; a vendor writing from its own book address is never a mail server) '
  'or a second copy of a letter already stored (same Message-ID, angle brackets aside; a '
  'set-aside copy never hides a live one); '
  'neither is ever visible or owed. Withheld rows are removed first. The one definition '
  'the other mail functions share (mail_one_letter_whatever_door).';
