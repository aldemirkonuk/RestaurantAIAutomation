-- A thread list withholds an undecided or discarded credit-claim letter from
-- anyone who is not the house's owner or manager.
--
-- ADR 0167 (Locked, "Refuse staff on all four") and ADR 0230: a HOUSE_DRAFT /
-- HOUSE_CANCELLED row in procurement_conversations is a credit-claim letter
-- carrying the claimed amount, the reason and the invoice/order numbers, and
-- staff are refused those figures. PR #476 audit (2026-09-27, head 9d04c0fb6)
-- found GET /conversations/threads still showed them: this RPC's `p_status`
-- filters `delivery_status`, not `status` (the column that holds HOUSE_DRAFT /
-- HOUSE_CANCELLED), so no caller could exclude them — and `p_search` matched
-- their `message_text`, so filtering the fetched messages afterwards would
-- still have let a search answer "is this amount in a draft?" and would still
-- have counted draft-only threads in `total_threads`.
--
-- The exclusion therefore lives inside `matched`, so counts, first/last
-- timestamps, order/provider picks, search and paging all agree with what
-- the caller may see.
--
-- `p_withhold_house_letters` DEFAULTS TO TRUE — fail closed: a caller that does
-- not say otherwise gets the staff view. The gateway passes false only for an
-- owner or manager of the house (conversations.service.ts
-- listConversationThreads). reports.service.ts getReportCrossFile passes no
-- value, so its "conversation threads in this period" count now leaves out
-- letters that were never sent — the correct reading for a count of
-- conversations with vendors.
--
-- `status` is nullable (every AI-path and legacy row has none), so the test is
-- `status IS NULL OR status NOT IN (...)`: a bare NOT IN evaluates to NULL for
-- those rows and would drop most of the table.
--
-- The old 13-argument signature is dropped, not overloaded: PostgREST resolves
-- an RPC by its named arguments, and a call naming only the first 13 would
-- match both overloads and fail as ambiguous. Migrations run in one
-- transaction, so there is no moment without a function.

DROP FUNCTION IF EXISTS public.list_conversation_threads(
  uuid, uuid, text, text, text, text, text, text, text,
  timestamp with time zone, timestamp with time zone, integer, integer
);

CREATE FUNCTION public.list_conversation_threads(
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

COMMENT ON FUNCTION public.list_conversation_threads(
  uuid, uuid, text, text, text, text, text, text, text,
  timestamp with time zone, timestamp with time zone, integer, integer, boolean
) IS
  'One page of conversation threads for a house. p_withhold_house_letters '
  '(default true) leaves out HOUSE_DRAFT/HOUSE_CANCELLED credit-claim letters; '
  'the gateway passes false only for the house''s owner or manager '
  '(ADR 0167, ADR 0230, PR #476).';
