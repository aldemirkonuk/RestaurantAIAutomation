-- Server-side, thread-aware pagination for the communication history.
--
-- Why: grouping was done client-side over a page of messages, so a 6-message thread
-- could render as 4 + 2 across the pager and look broken. Raising the page size only
-- moved the cliff. This paginates by THREAD — the page boundary now falls between
-- conversations instead of through the middle of one.
--
-- Tenant scope is a required argument, not an optional filter: p_restaurant_id has no
-- default, so there is no way to call this without scoping it.

CREATE OR REPLACE FUNCTION public.list_conversation_threads(
    p_restaurant_id  UUID,
    p_provider_id    UUID        DEFAULT NULL,
    p_channel        TEXT        DEFAULT NULL,
    p_direction      TEXT        DEFAULT NULL,
    p_sentiment      TEXT        DEFAULT NULL,
    p_status         TEXT        DEFAULT NULL,
    p_search         TEXT        DEFAULT NULL,
    p_order_number   TEXT        DEFAULT NULL,
    p_thread_key     TEXT        DEFAULT NULL,
    p_date_from      TIMESTAMPTZ DEFAULT NULL,
    p_date_to        TIMESTAMPTZ DEFAULT NULL,
    p_limit          INT         DEFAULT 20,
    p_offset         INT         DEFAULT 0
)
RETURNS TABLE (
    thread_key    TEXT,
    message_count BIGINT,
    first_at      TIMESTAMPTZ,
    last_at       TIMESTAMPTZ,
    order_id      UUID,
    order_number  TEXT,
    provider_id   UUID,
    total_threads BIGINT
)
LANGUAGE sql
STABLE
-- SECURITY INVOKER (the default): RLS on procurement_conversations still applies, so
-- this cannot become a way to read across tenants if it is ever exposed directly.
AS $$
WITH matched AS (
    SELECT c.*
    FROM public.procurement_conversations c
    WHERE c.restaurant_id = p_restaurant_id
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

REVOKE ALL ON FUNCTION public.list_conversation_threads(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.list_conversation_threads(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INT, INT
) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_conversation_threads IS
    'Thread-level pagination for communication history. Tenant scope is a required argument.';
