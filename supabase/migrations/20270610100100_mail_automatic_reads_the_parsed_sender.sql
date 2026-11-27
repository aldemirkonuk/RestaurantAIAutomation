-- Mail: a bounce is read from the From's own mailbox, and older auto-reply
-- markers count (QA round 24, item 3, 2026-11-07).
--
-- 20270601090000 called a row automatic when its RAW From matched
-- (^|[<\s"'])(mailer-daemon|postmaster)@, so a display name or comment naming
-- postmaster hid a person's letter. The bridge now writes
-- transport.fromMailServer from the parsed From; this reads it.
--
-- Older rows have no flag and fall back to the raw From anchored at its END:
-- mailer-daemon@ / postmaster@ must be the last address, bare or in the final
-- <...>, optionally followed by one comment. No backfill.
--
-- transport.autoReplied (the bridge's flag) now also covers X-Autoreply,
-- X-Autorespond and Precedence: auto_reply; older rows keep their value.
--
-- Only `automatic` and the comment change; shape and privileges (service_role
-- only) are as before. A new migration, not an edit of 20270601090000, so it
-- lands whatever order the mail stack's PRs merge in.

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
             OR COALESCE(CASE c.email_headers->'transport'->>'fromMailServer'
                           WHEN 'true' THEN true WHEN 'false' THEN false END,
                         (c.email_headers->>'from') ~* '(^|<)\s*(mailer-daemon|postmaster)@[^\s<>()"]+>?\s*(\([^()]*\))?\s*$')), false) AS automatic,
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
  'or an auto-reply marked Auto-Submitted: auto-replied, X-Autoreply, X-Autorespond or '
  'Precedence: auto_reply; a bounce is read from the parsed From, never a display name; '
  'never auto-generated mail or '
  'X-Auto-Response-Suppress) or a second copy of a letter already stored (same Message-ID); '
  'neither is ever visible or owed. Withheld rows are removed first. The one definition '
  'the other mail functions share (mail_automatic_reads_the_parsed_sender).';
