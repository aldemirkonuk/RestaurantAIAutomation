-- The conversation book can hold mail that is not a vendor's.
--
-- WHY. The reading grant used to be bounded by the vendor book, so every row on
-- `procurement_conversations` was a vendor's. A person may now consent to the
-- wider `gmail_read_all` reading (its own consent words, its own grant row), and
-- what it files is a conversation with a vendor, a team member or a guest.
-- Each stored letter therefore says which of the three it is and who it was
-- from and to.
--
--   kind          'vendor' | 'team' | 'guest'. Every row written before this
--                 migration is a vendor row, which is what the default says and
--                 what they were.
--   from_address  the bare sender address, lower-cased.
--   to_addresses the bare recipient addresses (To and Cc), lower-cased.
--
-- A team or guest message has no vendor, so `provider_id` stops being NOT NULL;
-- the check below keeps it required for a vendor row, so nothing that relied on
-- the column being filled for vendor mail loses that.
--
-- `mirrored_by_grant_id` is how revocation finds every row a grant filed
-- (ADR 0118); team and guest rows carry it like vendor rows do, and the
-- retention sweep deletes them whole.
--
-- VISIBILITY. Team and guest mail is read by a person's mailbox and not by the
-- house's own act, so it is withheld from anyone who is not the house's owner or
-- manager. The thread list already takes `p_withhold_house_letters` for
-- credit-claim letters; the same flag withholds non-vendor rows, so a thread
-- list, its count and its search never see a row the caller may not.

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'vendor';

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS from_address TEXT;

ALTER TABLE public.procurement_conversations
  ADD COLUMN IF NOT EXISTS to_addresses TEXT[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.procurement_conversations
  ALTER COLUMN provider_id DROP NOT NULL;

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS procurement_conversations_kind_known;
ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT procurement_conversations_kind_known
  CHECK (kind IN ('vendor', 'team', 'guest'));

ALTER TABLE public.procurement_conversations
  DROP CONSTRAINT IF EXISTS procurement_conversations_vendor_has_provider;
ALTER TABLE public.procurement_conversations
  ADD CONSTRAINT procurement_conversations_vendor_has_provider
  CHECK (kind <> 'vendor' OR provider_id IS NOT NULL);

COMMENT ON COLUMN public.procurement_conversations.kind IS
  'Who the other side is: vendor (the sender is in this restaurant''s vendor book), team (a member of this restaurant) or guest (anyone else). Rows from before the wider reading are all vendor rows. Team and guest rows are only ever written by the gmail_read_all reader, carry mirrored_by_grant_id, and are deleted whole when that grant is revoked.';
COMMENT ON COLUMN public.procurement_conversations.from_address IS
  'The bare lower-cased sender address of an inbound email. NULL on rows written before this column existed and on rows that are not email.';
COMMENT ON COLUMN public.procurement_conversations.to_addresses IS
  'The bare lower-cased To and Cc addresses of an inbound email. Empty on rows written before this column existed.';

CREATE INDEX IF NOT EXISTS idx_procurement_conversations_house_kind
  ON public.procurement_conversations (restaurant_id, kind)
  WHERE kind <> 'vendor';

-- The thread list withholds non-vendor rows with the flag it already takes for
-- credit-claim letters. Same signature and return type, so the function is
-- replaced in place and its ACL (service_role only, 20261016000000) is kept.
CREATE OR REPLACE FUNCTION public.list_conversation_threads(
  p_restaurant_id uuid,
  p_provider_id uuid DEFAULT NULL::uuid,
  p_channel text DEFAULT NULL::text,
  p_direction text DEFAULT NULL::text,
  p_sentiment text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_search text DEFAULT NULL::text,
  p_order_number text DEFAULT NULL::text,
  p_thread_key text DEFAULT NULL::text,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_withhold_house_letters boolean DEFAULT true
) RETURNS TABLE(thread_key text, message_count bigint, first_at timestamp with time zone, last_at timestamp with time zone, order_id uuid, order_number text, provider_id uuid, total_threads bigint)
    LANGUAGE sql STABLE
    AS $$
WITH matched AS (
    SELECT c.*
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
      AND (p_withhold_house_letters IS NOT TRUE
           OR c.status IS NULL
           OR c.status NOT IN ('HOUSE_DRAFT', 'HOUSE_CANCELLED'))
      AND (p_withhold_house_letters IS NOT TRUE
           OR c.kind = 'vendor')
      AND (p_provider_id  IS NULL OR c.provider_id = p_provider_id)
      AND (p_thread_key   IS NULL OR c.thread_key = p_thread_key)
      AND (p_channel      IS NULL OR c.channel = p_channel)
      AND (p_direction    IS NULL OR lower(c.direction) = lower(p_direction))
      AND (p_status       IS NULL OR c.delivery_status = p_status)
      AND (p_order_number IS NULL OR c.order_number_snapshot ILIKE '%' || p_order_number || '%')
      AND (p_search       IS NULL OR c.message_text ILIKE '%' || p_search || '%')
      AND (p_date_from    IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to      IS NULL OR c.created_at <= p_date_to)
      AND (
            p_sentiment IS NULL
         OR (p_sentiment = 'unclassified'
             AND (c.detected_sentiment IS NULL OR btrim(c.detected_sentiment) = ''))
         OR (p_sentiment <> 'unclassified'
             AND lower(c.detected_sentiment) = lower(p_sentiment))
          )
),
threads AS (
    SELECT m.thread_key,
           count(*) AS message_count,
           min(m.created_at) AS first_at,
           max(m.created_at) AS last_at,
           (array_agg(m.order_id) FILTER (WHERE m.order_id IS NOT NULL))[1] AS order_id,
           (array_agg(m.order_number_snapshot)
              FILTER (WHERE m.order_number_snapshot IS NOT NULL))[1] AS order_number,
           (array_agg(m.provider_id) FILTER (WHERE m.provider_id IS NOT NULL))[1] AS provider_id
    FROM matched m
    GROUP BY m.thread_key
)
SELECT t.thread_key,
       t.message_count,
       t.first_at,
       t.last_at,
       t.order_id,
       t.order_number,
       t.provider_id,
       count(*) OVER () AS total_threads
FROM threads t
-- Mirrors the client sort: threads linked to an order first, then most recent.
ORDER BY (t.order_id IS NULL), t.last_at DESC
LIMIT  greatest(p_limit, 1)
OFFSET greatest(p_offset, 0);
$$;

-- CREATE OR REPLACE keeps the grants, but state them again so this file reads
-- the same as the one it replaces in the part that matters.
REVOKE ALL ON FUNCTION public.list_conversation_threads(
  uuid, uuid, text, text, text, text, text, text, text,
  timestamp with time zone, timestamp with time zone, integer, integer, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_conversation_threads(
  uuid, uuid, text, text, text, text, text, text, text,
  timestamp with time zone, timestamp with time zone, integer, integer, boolean
) TO service_role;
