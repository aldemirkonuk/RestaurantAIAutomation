-- No answer yet (r108 mail-gap g7): list_mail_people(p_awaiting) and awaiting_since.
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ln(p_dir text, p_status text, p_ago interval, p_auto boolean DEFAULT false)
RETURNS TABLE(direction text, status text, sent_at timestamptz, received_at timestamptz, created_at timestamptz, email_headers jsonb)
LANGUAGE sql AS $$
  SELECT p_dir, p_status,
         CASE WHEN p_dir = 'outbound' AND p_status IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED') THEN now() - p_ago END,
         CASE WHEN p_dir = 'inbound' THEN now() - p_ago END, now() - p_ago,
         CASE WHEN p_auto THEN '{"transport":{"autoSubmitted":"true"}}'::jsonb ELSE '{}'::jsonb END $$;

-- House 1. Vendors a..h by provider id 7a000000-...-00000000000N; one thread each unless named.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
SELECT gen_random_uuid(), '71000000-0000-4000-8000-000000000001', ('7a000000-0000-4000-8000-00000000000' || v.n)::uuid,
       'vendor', 'v' || v.n || '@v.example', l.direction, 'email', 'Letter', l.status, v.thread,
       l.sent_at, l.received_at, l.created_at, l.email_headers
FROM (VALUES
  -- 1 the house wrote 4 days ago, nothing since
  (1, 'gm:1', 'outbound', 'SENT', interval '4 days', false),
  -- 2 the house wrote 4 days ago; only an out-of-office came back
  (2, 'gm:2', 'outbound', 'SENT', interval '4 days', false),
  (2, 'gm:2', 'inbound', 'RECEIVED', interval '3 days', true),
  -- 3 the vendor answered (handled, so not waiting)
  (3, 'gm:3', 'outbound', 'SENT', interval '4 days', false),
  (3, 'gm:3', 'inbound', 'DELIVERED', interval '3 days', false),
  -- 4 written one day ago: under 72 h
  (4, 'gm:4', 'outbound', 'SENT', interval '1 day', false),
  -- 5 sent 5 days ago, a second letter still queued: the queued one is not a letter yet
  (5, 'gm:5', 'outbound', 'AUTO_SENT', interval '5 days', false),
  (5, 'gm:5', 'outbound', 'HOUSE_QUEUED', interval '1 day', false),
  -- 6 its leaving was never confirmed
  (6, 'gm:6', 'outbound', 'SEND_UNCONFIRMED', interval '5 days', false),
  -- 7 the vendor waits on the house on one thread; the house wrote later on another
  (7, 'gm:7a', 'inbound', 'RECEIVED', interval '6 days', false),
  (7, 'gm:7b', 'outbound', 'SENT', interval '4 days', false),
  -- 8 73 hours, just past the line
  (8, 'gm:8', 'outbound', 'SENT', interval '73 hours', false)
) v(n, thread, dir, st, ago, auto)
CROSS JOIN LATERAL pg_temp.ln(v.dir, v.st, v.ago, v.auto) l;

-- Guests of house 1: g1 the house wrote, an auto-reply came; g2 answered; g3 a draft only after an inbound;
-- g4 under 72 h.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
SELECT gen_random_uuid(), '71000000-0000-4000-8000-000000000001', NULL, 'guest', v.addr, l.direction, 'email', 'Hello',
       l.status, 'gm:' || v.addr, l.sent_at, l.received_at, l.created_at, l.email_headers
FROM (VALUES
  ('g1@x.example', 'outbound', 'SENT', interval '5 days', false),
  ('g1@x.example', 'inbound', 'DELIVERED', interval '4 days', true),
  ('g2@x.example', 'outbound', 'SENT', interval '5 days', false),
  ('g2@x.example', 'inbound', 'DELIVERED', interval '4 days', false),
  ('g3@x.example', 'inbound', 'DELIVERED', interval '6 days', false),
  ('g3@x.example', 'outbound', 'HOUSE_DRAFT', interval '5 days', false),
  ('g4@x.example', 'outbound', 'SENT', interval '2 days', false),
  -- g5 sent, then a letter still queued; g6 its leaving never confirmed
  ('g5@x.example', 'outbound', 'SENT', interval '5 days', false),
  ('g5@x.example', 'outbound', 'HOUSE_QUEUED', interval '4 days', false),
  ('g6@x.example', 'outbound', 'SEND_UNCONFIRMED', interval '5 days', false),
  ('g7@x.example', 'outbound', 'SENT', interval '6 days', false)
) v(addr, dir, st, ago, auto)
CROSS JOIN LATERAL pg_temp.ln(v.dir, v.st, v.ago, v.auto) l;
-- g7 answered with an older row: no status, but a sent_at. It is an answer all the same.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
VALUES (gen_random_uuid(), '71000000-0000-4000-8000-000000000001', NULL, 'guest', 'g7@x.example', 'inbound', 'email', 'Yes',
        NULL, 'gm:g7@x.example', now() - interval '5 days', now() - interval '5 days', now() - interval '5 days', '{}');

-- House 2 has its own awaiting vendor and guest. House 1 must never see them.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
SELECT gen_random_uuid(), '71000000-0000-4000-8000-000000000002', v.pid, v.kind, v.addr, l.direction, 'email', 'Other house',
       l.status, 'gm:o' || v.addr, l.sent_at, l.received_at, l.created_at, l.email_headers
FROM (VALUES
  ('7a000000-0000-4000-8000-000000000009'::uuid, 'vendor', 'o@v.example'),
  (NULL::uuid, 'guest', 'g1@x.example')
) v(pid, kind, addr)
CROSS JOIN LATERAL pg_temp.ln('outbound', 'SENT', interval '9 days') l;

CREATE TEMP TABLE aw AS
SELECT * FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50, NULL, NULL, true);

SELECT pg_temp.ok((SELECT array_agg(key ORDER BY key) FROM aw) = ARRAY[
  'guest:g1@x.example',
  'guest:g5@x.example',
  'vendor:7a000000-0000-4000-8000-000000000001',
  'vendor:7a000000-0000-4000-8000-000000000002',
  'vendor:7a000000-0000-4000-8000-000000000005',
  'vendor:7a000000-0000-4000-8000-000000000008'], 'awaiting-lists-exactly-the-unanswered');
SELECT pg_temp.ok((SELECT bool_and(awaiting_since IS NOT NULL AND awaiting_since < now() - interval '72 hours') FROM aw), 'every-row-says-since-when');
SELECT pg_temp.ok((SELECT awaiting_since FROM aw WHERE key = 'vendor:7a000000-0000-4000-8000-000000000005')
  = (SELECT sent_at FROM public.procurement_conversations WHERE provider_id = '7a000000-0000-4000-8000-000000000005' AND status = 'AUTO_SENT'),
  'since-is-the-letter-that-left-not-the-queued-one');
SELECT pg_temp.ok((SELECT unsent_status FROM aw WHERE key = 'vendor:7a000000-0000-4000-8000-000000000005') = 'HOUSE_QUEUED', 'queued-letter-still-named');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM aw WHERE key = 'vendor:7a000000-0000-4000-8000-000000000002')
  AND EXISTS (SELECT 1 FROM aw WHERE key = 'guest:g1@x.example'), 'an-automatic-letter-after-is-no-answer');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM aw WHERE key = 'vendor:7a000000-0000-4000-8000-000000000007'), 'a-vendor-waiting-on-the-house-is-not-awaiting');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM aw WHERE key IN ('vendor:7a000000-0000-4000-8000-000000000009', 'vendor:7a000000-0000-4000-8000-000000000004', 'guest:g4@x.example')),
  'other-house-and-under-72h-never-returned');
-- The other house's guest shares g1's address; house 1's row is house 1's own letter.
SELECT pg_temp.ok((SELECT awaiting_since FROM aw WHERE key = 'guest:g1@x.example') > now() - interval '6 days', 'same-address-other-house-not-mixed');

-- Staff: the house's letters are withheld, so no one is awaiting.
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', true, false, NULL, NULL, 50, NULL, NULL, true)) = 0, 'staff-get-no-awaiting-rows');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', true) WHERE awaiting_since IS NOT NULL) = 0, 'staff-rows-carry-no-since');

-- Without the filter: every person, and the same five carry awaiting_since.
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50)) = 15, 'unfiltered-lists-everyone');
SELECT pg_temp.ok((SELECT array_agg(key ORDER BY key) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50) WHERE awaiting_since IS NOT NULL)
  = (SELECT array_agg(key ORDER BY key) FROM aw), 'unfiltered-since-matches-the-filter');
-- Kind narrows it as before.
SELECT pg_temp.ok((SELECT array_agg(key ORDER BY key) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50, NULL, 'guest', true)) = ARRAY['guest:g1@x.example', 'guest:g5@x.example'], 'kind-and-awaiting');

-- Paged one row at a time, the pages are the whole list in its order.
CREATE TEMP TABLE pages(n int, key text, last_at timestamptz);
DO $$
DECLARE r record; a timestamptz; k text; i int := 0;
BEGIN
  LOOP
    SELECT * INTO r FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, a, k, 1, NULL, NULL, true);
    EXIT WHEN NOT FOUND OR i > 20;
    i := i + 1; INSERT INTO pages VALUES (i, r.key, r.last_at); a := r.last_at; k := r.key;
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT array_agg(key ORDER BY n) FROM pages) = (SELECT array_agg(key ORDER BY last_at DESC, key COLLATE "C") FROM aw), 'pages-of-one-are-the-whole-list');
rollback;
