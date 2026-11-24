-- Team and guest letters follow the vendor rules; the people list pages (r102 func-4, func-2).
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
  ('77777777-7777-4777-8777-777777777777', 'Rules H', 'rules-h-test', 'UTC');
-- One guest letter sent to the owner and the manager (two mailboxes, one Message-ID), plus the guest's
-- out-of-office reply, plus a mailer-daemon bounce, plus one team letter with a Message-ID of its own.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, message_id, received_at, sent_at, created_at, email_headers) VALUES
  ('a7000000-0000-4000-8000-0000000000a1', '77777777-7777-4777-8777-777777777777', NULL, 'guest', 'guest@x.example', 'inbound', 'email', 'Table for four?', 'DELIVERED', 'gm:g1', '<m1@x.example>', now(), NULL, now() - interval '2 minutes', '{}'),
  ('a7000000-0000-4000-8000-0000000000a2', '77777777-7777-4777-8777-777777777777', NULL, 'guest', 'guest@x.example', 'inbound', 'email', 'Table for four?', 'DELIVERED', 'gm:g1', '<M1@x.example>', now(), NULL, now() - interval '1 minute', '{}'),
  ('a7000000-0000-4000-8000-0000000000a3', '77777777-7777-4777-8777-777777777777', NULL, 'guest', 'guest@x.example', 'inbound', 'email', 'Out of office', 'DELIVERED', 'gm:g1', '<ooo@x.example>', now(), NULL, now(), '{"transport":{"autoSubmitted":"true"}}'),
  ('a7000000-0000-4000-8000-0000000000a4', '77777777-7777-4777-8777-777777777777', NULL, 'guest', 'mailer-daemon@x.example', 'inbound', 'email', 'Undeliverable', 'DELIVERED', 'gm:b1', '<b1@x.example>', now(), NULL, now(), '{"from":"Mail Delivery <mailer-daemon@x.example>"}'),
  ('a7000000-0000-4000-8000-0000000000a5', '77777777-7777-4777-8777-777777777777', NULL, 'team', 'deniz@h.example', 'inbound', 'email', 'Shift swap', 'DELIVERED', 'gm:t1', '<t1@h.example>', now(), NULL, now(), '{}');

-- The worked case: one letter, in once; the out-of-office and the bounce are not letters; the team letter is one.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('77777777-7777-4777-8777-777777777777', false, 'UTC')) = 2, 'header-counts-letters-not-copies-or-machines');
-- The copy is not read twice on the thread, and the auto-reply is named automatic.
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('77777777-7777-4777-8777-777777777777', 'gm:g1', 'guest', 'guest@x.example', false)) = 2, 'thread-has-no-copy');
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('77777777-7777-4777-8777-777777777777', 'gm:g1', 'guest', 'guest@x.example', false) WHERE automatic) = 1, 'thread-names-the-auto-reply');
SELECT pg_temp.ok((SELECT letter_count FROM public.list_mail_threads_other('77777777-7777-4777-8777-777777777777', 'guest', 'guest@x.example', false)) = 1, 'thread-row-counts-one-letter');
-- A machine is not a person; the guest and the team member are.
SELECT pg_temp.ok((SELECT array_agg(key ORDER BY key) FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false)) = ARRAY['guest:guest@x.example','team:deniz@h.example'], 'people-are-people-only');
-- Staff still see none of it.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('77777777-7777-4777-8777-777777777777', true, 'UTC')) = 0, 'staff-count-none');

-- Paging: 7 more people; a page of 3 then the cursor gives the next 3, no overlap, in order.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, message_id, received_at, created_at, email_headers)
SELECT ('b7000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '77777777-7777-4777-8777-777777777777', NULL, 'guest',
       'p' || n || '@x.example', 'inbound', 'email', 'Hello ' || n, 'DELIVERED', 'gm:p' || n, '<p' || n || '@x.example>',
       now() - make_interval(hours => n), now() - make_interval(hours => n), '{}'
FROM generate_series(1, 7) n;
CREATE TEMP TABLE pg1 AS SELECT * FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 3);
SELECT pg_temp.ok((SELECT count(*) FROM pg1) = 3, 'page-one-has-three');
CREATE TEMP TABLE pg2 AS SELECT * FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false,
  (SELECT last_at FROM pg1 ORDER BY last_at ASC, key DESC LIMIT 1), (SELECT key FROM pg1 ORDER BY last_at ASC, key DESC LIMIT 1), 3);
SELECT pg_temp.ok((SELECT count(*) FROM pg2) = 3 AND NOT EXISTS (SELECT 1 FROM pg2 JOIN pg1 USING (key)), 'page-two-is-the-next-three');
SELECT pg_temp.ok((SELECT max(last_at) FROM pg2) <= (SELECT min(last_at) FROM pg1), 'pages-are-in-time-order');
-- Each page row carries its heavy columns.
SELECT pg_temp.ok((SELECT bool_and(last_line IS NOT NULL AND channels = ARRAY['email'] AND open_threads = 1 AND last_direction = 'inbound') FROM pg1), 'page-rows-carry-their-columns');
-- A search reads the words.
SELECT pg_temp.ok((SELECT array_agg(key) FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 50, 'Hello 4')) = ARRAY['guest:p4@x.example'], 'search-reads-the-words');
-- The index is there.
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_procurement_conversations_house_kind_address'), 'index-exists');
rollback;
