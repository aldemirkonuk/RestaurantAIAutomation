-- The people list asks for one kind in SQL, and a thread is timed by its letters (r103 mail-1, mail-5).
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- 60 newer guests bury 3 older team people and 2 vendors. The first page of 50 holds no team person.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers)
SELECT ('e7000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '88888888-8888-4888-8888-888888888888', NULL, 'guest',
       'g' || n || '@x.example', 'inbound', 'email', 'Hello ' || n, 'DELIVERED', 'gm:g' || n,
       now() - make_interval(mins => n), now() - make_interval(mins => n), '{}'
FROM generate_series(1, 60) n;
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers)
SELECT ('e8000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '88888888-8888-4888-8888-888888888888', NULL, 'team',
       't' || n || '@h.example', 'inbound', 'email', 'Shift ' || n, 'DELIVERED', 'gm:t' || n,
       now() - make_interval(days => n), now() - make_interval(days => n), '{}'
FROM generate_series(1, 3) n;
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers)
SELECT ('e9000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '88888888-8888-4888-8888-888888888888',
       ('c9000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'vendor',
       'v' || n || '@v.example', 'inbound', 'email', 'Prices ' || n, 'RECEIVED', 'gm:v' || n,
       now() - make_interval(days => n), now() - make_interval(days => n), '{}'
FROM generate_series(1, 2) n;

-- mail-1: unfiltered, the first 50 hold no team person (the walk's finding); asked for, all three come.
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 50) WHERE kind = 'team') = 0, 'unfiltered-first-page-holds-no-team');
SELECT pg_temp.ok((SELECT array_agg(key ORDER BY key) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 50, NULL, 'team'))
  = ARRAY['team:t1@h.example','team:t2@h.example','team:t3@h.example'], 'team-filter-lists-every-team-person');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 50, NULL, 'guest')) = 50
  AND (SELECT bool_and(kind = 'guest') FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 50, NULL, 'guest')), 'guest-filter-pages-guests-only');
SELECT pg_temp.ok((SELECT array_agg(kind ORDER BY key) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 50, NULL, 'vendor')) = ARRAY['vendor','vendor'], 'vendor-filter-lists-vendors-only');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', false, false, NULL, NULL, 100)) = 65, 'no-filter-is-every-kind');
-- A caller who may not read team and guest mail gets none of them by asking for the kind.
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('88888888-8888-4888-8888-888888888888', true, false, NULL, NULL, 50, NULL, 'team')) = 0, 'staff-asking-for-team-gets-none');

-- mail-5: a guest writes at 10:59, their out-of-office answers at 11:13. The thread is timed 10:59 and
-- says the guest wrote last; a thread that is only an out-of-office is timed by it.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, message_id, received_at, created_at, email_headers) VALUES
  ('f7000000-0000-4000-8000-0000000000a1', '99999999-9999-4999-8999-999999999999', NULL, 'guest', 'ooo@x.example', 'inbound', 'email', 'Table for two?', 'DELIVERED', 'gm:o1', '<o1@x.example>', '2027-02-01 10:59+00', '2027-02-01 10:59+00', '{}'),
  ('f7000000-0000-4000-8000-0000000000a2', '99999999-9999-4999-8999-999999999999', NULL, 'guest', 'ooo@x.example', 'inbound', 'email', 'Out of office', 'DELIVERED', 'gm:o1', '<o2@x.example>', '2027-02-01 11:13+00', '2027-02-01 11:13+00', '{"transport":{"autoSubmitted":"true"}}'),
  ('f7000000-0000-4000-8000-0000000000b1', '99999999-9999-4999-8999-999999999999', NULL, 'guest', 'only@x.example', 'inbound', 'email', 'Out of office', 'DELIVERED', 'gm:o2', '<o3@x.example>', '2027-02-02 08:00+00', '2027-02-02 08:00+00', '{"transport":{"autoSubmitted":"true"}}');
SELECT pg_temp.ok((SELECT last_at FROM public.list_mail_threads_other('99999999-9999-4999-8999-999999999999', 'guest', 'ooo@x.example', false)) = '2027-02-01 10:59+00', 'thread-is-timed-by-its-letter-not-the-auto-reply');
SELECT pg_temp.ok((SELECT last_at FROM public.list_mail_people('99999999-9999-4999-8999-999999999999', false) WHERE key = 'guest:ooo@x.example') = '2027-02-01 10:59+00', 'list-and-thread-agree');
SELECT pg_temp.ok((SELECT last_at FROM public.list_mail_threads_other('99999999-9999-4999-8999-999999999999', 'guest', 'only@x.example', false)) = '2027-02-02 08:00+00', 'an-all-automatic-thread-keeps-its-own-time');
rollback;
