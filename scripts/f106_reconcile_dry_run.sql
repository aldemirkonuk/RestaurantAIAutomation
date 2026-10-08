-- F-106 PR-3 dry-run (ADR 0266): what the reconcile WOULD do. Read-only.
--
-- Run before the reconcile migration merges, by the founder or a session with
-- his yes for a production read (design §2e). It writes nothing: the whole
-- file runs in a READ ONLY transaction that is rolled back.
--
--   psql "$PROD_READ_URL" -X -v ON_ERROR_STOP=1 -f scripts/f106_reconcile_dry_run.sql
--
-- What each query answers:
--   1  scale: orders with 2+ waiting drafts, rows the reconcile would discard
--      under F0 (first-written survives), rows to discard that carry a staff
--      send request (F8: asked only if > 0), null created_at, house mismatches
--   2  per pair: each row's writer kind and whether its body holds the
--      approval-time agent's placeholders
--   3  held: a send_draft seal on the order issued between the two rows'
--      created_at, so the older row was the one held (seals store args_hash,
--      not the draft id: seal-challenge.service.ts:108-113)
--   4  an approval-time order_inquiry still waiting on an order that already
--      has a sent outbound letter
--   5  PENDING_APPROVAL next to AUTO_SEND_SCHEDULED on one order (F6)
--   6  pairs the PR-1 trigger already settled newest-wins (ADR 0266, fork of
--      2026-10-04: "Accept, as disclosed")

BEGIN TRANSACTION READ ONLY;

-- f106_waiting (repeated per query, because a READ ONLY transaction refuses
-- CREATE, temp views included): every waiting row on an order, ranked by F0,
-- created_at ASC NULLS LAST, id ASC; rank 1 survives.

-- 1. Scale
WITH f106_waiting AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY c.restaurant_id, c.order_id
                            ORDER BY c.created_at ASC NULLS LAST, c.id ASC) AS f0_rank,
         count(*)     OVER (PARTITION BY c.restaurant_id, c.order_id)      AS waiting_n
    FROM public.procurement_conversations c
   WHERE c.order_id IS NOT NULL
     AND (c.status)::text = 'PENDING_APPROVAL'
)
SELECT count(DISTINCT (w.restaurant_id, w.order_id))                       AS orders_affected,
       count(*) FILTER (WHERE w.f0_rank > 1)                              AS rows_to_discard,
       count(*) FILTER (WHERE w.f0_rank > 1 AND w.send_requested_at IS NOT NULL)
                                                                          AS discarded_with_staff_request_f8,
       count(*) FILTER (WHERE w.created_at IS NULL)                       AS null_created_at,
       count(*) FILTER (WHERE o.restaurant_id IS DISTINCT FROM w.restaurant_id)
                                                                          AS house_mismatch
  FROM f106_waiting w
  LEFT JOIN public.procurement_orders o ON o.id = w.order_id
 WHERE w.waiting_n > 1;

-- 2. Per pair
WITH f106_waiting AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY c.restaurant_id, c.order_id
                            ORDER BY c.created_at ASC NULLS LAST, c.id ASC) AS f0_rank,
         count(*)     OVER (PARTITION BY c.restaurant_id, c.order_id)      AS waiting_n
    FROM public.procurement_conversations c
   WHERE c.order_id IS NOT NULL
     AND (c.status)::text = 'PENDING_APPROVAL'
)
SELECT o.order_number,
       w.restaurant_id,
       w.id,
       w.f0_rank,
       w.created_at,
       w.outbound_email_type,
       CASE
         WHEN w.outbound_email_type IS NOT NULL AND w.disclaimer_appended   THEN 'create-time'
         WHEN w.outbound_email_type IS NULL AND w.constraint_flags ? 'session_id' THEN 'approval-time'
         ELSE 'other'
       END                                                                AS writer_kind,
       w.send_requested_at IS NOT NULL                                    AS staff_send_request,
       coalesce(w.content, w.message_text) ~ '\[Your Name\]|Wine Buyer'  AS has_placeholder
  FROM f106_waiting w
  LEFT JOIN public.procurement_orders o ON o.id = w.order_id
 WHERE w.waiting_n > 1
 ORDER BY w.restaurant_id, o.order_number, w.f0_rank;

-- 3. Held: a send_draft seal issued between the first and second row
WITH f106_waiting AS (
  SELECT c.*,
         row_number() OVER (PARTITION BY c.restaurant_id, c.order_id
                            ORDER BY c.created_at ASC NULLS LAST, c.id ASC) AS f0_rank,
         count(*)     OVER (PARTITION BY c.restaurant_id, c.order_id)      AS waiting_n
    FROM public.procurement_conversations c
   WHERE c.order_id IS NOT NULL
     AND (c.status)::text = 'PENDING_APPROVAL'
)
SELECT w1.restaurant_id, w1.order_id,
       w1.id AS first_row, w2.id AS second_row,
       count(s.id) AS seals_between
  FROM f106_waiting w1
  JOIN f106_waiting w2
    ON w2.restaurant_id = w1.restaurant_id AND w2.order_id = w1.order_id
   AND w1.f0_rank = 1 AND w2.f0_rank = 2
  LEFT JOIN public.mcp_seal_challenges s
    ON s.subject_kind = 'procurement_order'
   AND s.subject_id = w1.order_id
   AND s.tool_name = 'send_draft'
   AND s.issued_at > w1.created_at AND s.issued_at < w2.created_at
 GROUP BY 1, 2, 3, 4
 ORDER BY seals_between DESC;

-- 4. Approval-time order_inquiry waiting where a letter was already sent
SELECT c.restaurant_id, c.order_id, c.id, c.created_at
  FROM public.procurement_conversations c
 WHERE (c.status)::text = 'PENDING_APPROVAL'
   AND c.constraint_flags -> 'intent' ->> 'intent_type' = 'order_inquiry'
   AND EXISTS (
     SELECT 1 FROM public.procurement_conversations s
      WHERE s.restaurant_id = c.restaurant_id
        AND s.order_id::text = c.constraint_flags -> 'intent' ->> 'order_id'
        AND (s.direction)::text = 'outbound'
        AND (s.status)::text IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED'));

-- 5. Waiting next to scheduled on one order (F6)
SELECT p.restaurant_id, p.order_id, count(*) AS rows
  FROM public.procurement_conversations p
  JOIN public.procurement_conversations a
    ON a.restaurant_id = p.restaurant_id AND a.order_id = p.order_id
   AND (a.status)::text = 'AUTO_SEND_SCHEDULED'
 WHERE (p.status)::text = 'PENDING_APPROVAL'
 GROUP BY 1, 2;

-- 6. Pairs the PR-1 trigger already settled newest-wins
SELECT count(*) AS settled_by_trigger,
       count(*) FILTER (WHERE discard_reason LIKE '%send request on it no longer applies%')
                AS with_dropped_send_request
  FROM public.procurement_conversations
 WHERE (status)::text = 'DISCARDED'
   AND (discard_reason LIKE 'Replaced by a newer draft for this order (%'
     OR discard_reason LIKE 'A newer draft for this order was already waiting (%');

ROLLBACK;
