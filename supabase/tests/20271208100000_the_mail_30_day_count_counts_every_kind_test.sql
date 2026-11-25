-- The 30-day letter count counts every kind, so it is never below today's (r104 mail-gap g5).
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('a1000000-0000-4000-8000-000000000001', 'Thirty H', 'thirty-h-test', 'UTC');
-- One vendor letter and three guest letters now, an out-of-office from a guest (automatic,
-- never counted), a guest letter 40 days old (outside the window), a guest letter 10 days old (inside).
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a6000000-0000-4000-8000-0000000000a1', 'a1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'vendor', 'sales@v.example', 'inbound', 'email', 'Prices', 'RECEIVED', 'gm:v1', now(), NULL, now(), '{}'),
  ('a6000000-0000-4000-8000-0000000000b1', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'g1@x.example', 'inbound', 'email', 'Table?', 'DELIVERED', 'gm:g1', now(), NULL, now(), '{}'),
  ('a6000000-0000-4000-8000-0000000000b2', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'g2@x.example', 'inbound', 'email', 'Hours?', 'DELIVERED', 'gm:g2', now(), NULL, now(), '{}'),
  ('a6000000-0000-4000-8000-0000000000b3', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'g3@x.example', 'inbound', 'email', 'Menu?', 'DELIVERED', 'gm:g3', now(), NULL, now(), '{}'),
  ('a6000000-0000-4000-8000-0000000000b4', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'g1@x.example', 'inbound', 'email', 'Away', 'DELIVERED', 'gm:g1', now(), NULL, now(), '{"transport": {"autoSubmitted": "true"}}'),
  ('a6000000-0000-4000-8000-0000000000b5', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'old@x.example', 'inbound', 'email', 'Long ago', 'DELIVERED', 'gm:g5', now() - interval '40 days', NULL, now() - interval '40 days', '{}'),
  ('a6000000-0000-4000-8000-0000000000b6', 'a1000000-0000-4000-8000-000000000001', NULL, 'guest', 'mid@x.example', 'inbound', 'email', 'Last week', 'DELIVERED', 'gm:g6', now() - interval '10 days', NULL, now() - interval '10 days', '{}');

-- Owner (withhold false): today 4 in (1 vendor + 3 guests), 30 days 5 (adds the 10-day-old guest); never below today.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000001', false, 'UTC')) = 4, 'today-counts-every-kind');
SELECT pg_temp.ok((SELECT in_30d FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000001', false, 'UTC')) = 5, 'thirty-days-counts-every-kind');
SELECT pg_temp.ok((SELECT in_30d >= in_today FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000001', false, 'UTC')), 'thirty-days-never-below-today');
-- With no zone there is no today, and the 30-day figure still counts.
SELECT pg_temp.ok((SELECT in_today IS NULL AND in_30d = 5 FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000001', false, NULL)), 'no-zone-still-counts-thirty-days');
-- Staff (withhold true) see vendors only, as before.
SELECT pg_temp.ok((SELECT in_30d FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000001', true, 'UTC')) = 1, 'staff-thirty-days-vendors-only');
rollback;
