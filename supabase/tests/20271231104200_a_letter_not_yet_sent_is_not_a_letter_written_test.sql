-- A reply the house has not sent is not a letter it wrote (r104 mail fixer, finding 1 on #2044).
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
  ('a1000000-0000-4000-8000-000000000002', 'Unsent H', 'unsent-h-test', 'UTC');
-- Jane wrote, and the owner's answer was undone (HOUSE_CANCELLED). Sam wrote, and the answer was sent.
-- A failed one (HOUSE_FAILED) to Jane too. All stamped at now() so "today" holds whenever this runs.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a6000000-0000-4000-8000-0000000000c1', 'a1000000-0000-4000-8000-000000000002', NULL, 'guest', 'jane@x.example', 'inbound', 'email', 'Table for four?', 'DELIVERED', 'gm:jane', now() - interval '3 seconds', NULL, now() - interval '3 seconds', '{}'),
  ('a6000000-0000-4000-8000-0000000000c2', 'a1000000-0000-4000-8000-000000000002', NULL, 'guest', 'jane@x.example', 'outbound', 'email', 'Yes, Friday at eight.', 'HOUSE_CANCELLED', 'gm:jane', NULL, NULL, now() - interval '2 seconds', '{}'),
  ('a6000000-0000-4000-8000-0000000000c3', 'a1000000-0000-4000-8000-000000000002', NULL, 'guest', 'jane@x.example', 'outbound', 'email', 'Sorry, resending.', 'HOUSE_FAILED', 'gm:jane', NULL, NULL, now() - interval '1 second', '{}'),
  ('a6000000-0000-4000-8000-0000000000d1', 'a1000000-0000-4000-8000-000000000002', NULL, 'guest', 'sam@x.example', 'inbound', 'email', 'Hours?', 'DELIVERED', 'gm:sam', now() - interval '3 seconds', NULL, now() - interval '3 seconds', '{}'),
  ('a6000000-0000-4000-8000-0000000000d2', 'a1000000-0000-4000-8000-000000000002', NULL, 'guest', 'sam@x.example', 'outbound', 'email', 'Noon to ten.', 'SENT', 'gm:sam', NULL, now() - interval '2 seconds', now() - interval '2 seconds', '{}');

-- Header: one letter written today (Sam's), not three.
SELECT pg_temp.ok((SELECT out_today FROM public.mail_inbox_summary('a1000000-0000-4000-8000-000000000002', false, 'UTC')) = 1, 'unsent-replies-are-not-out-today');
-- People list: Jane's last line is what she wrote, and the house did not write last; Sam's is the sent answer.
SELECT pg_temp.ok((SELECT last_direction = 'inbound' AND last_line LIKE 'Table for four%' FROM public.list_mail_people('a1000000-0000-4000-8000-000000000002', false, false, NULL, NULL, 50, NULL, 'guest') WHERE name = 'jane@x.example'), 'people-last-line-is-the-letter-sent-or-received');
SELECT pg_temp.ok((SELECT last_direction = 'outbound' AND last_line LIKE 'Noon%' FROM public.list_mail_people('a1000000-0000-4000-8000-000000000002', false, false, NULL, NULL, 50, NULL, 'guest') WHERE name = 'sam@x.example'), 'a-sent-answer-is-the-last-line');
-- Jane is ranked by her own letter's time, so she sits below no one she should lead.
SELECT pg_temp.ok((SELECT last_at <= now() - interval '2 seconds' FROM public.list_mail_people('a1000000-0000-4000-8000-000000000002', false, false, NULL, NULL, 50, NULL, 'guest') WHERE name = 'jane@x.example'), 'people-time-ignores-unsent');
-- Threads: Jane's thread ends on her letter.
SELECT pg_temp.ok((SELECT last_direction FROM public.list_mail_threads_other('a1000000-0000-4000-8000-000000000002', 'guest', 'jane@x.example', false)) = 'inbound', 'thread-last-direction-ignores-unsent');
-- The thread read keeps every row: the chips tell the truth about the cancelled and the failed one.
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('a1000000-0000-4000-8000-000000000002', 'gm:jane', 'guest', 'jane@x.example', false)) = 3, 'thread-read-keeps-every-row');
rollback;
