-- The Mail list reads team and guest people, only for a caller who may
-- (migration the_mail_list_reads_team_and_guest_people; r77 walk w3 finding 1).
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from
-- supabase/migrations. One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- House H: a vendor letter (09:00), a guest (10:00), a team person's two letters
-- on one thread (11:00, 11:30). House H2: a guest and the same team address.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001', 'vendor', 'sales@v.example', 'inbound', 'email', 'Prices attached', 'RECEIVED', 'gm:v1', '2027-01-05 09:00+00', '2027-01-05 09:00+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', NULL, 'guest', 'stranger@x.example', 'inbound', 'email', 'Can I book a table', 'DELIVERED', 'gm:g1', '2027-01-05 10:00+00', '2027-01-05 10:00+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', NULL, 'team', 'deniz@h.example', 'inbound', 'email', E'Subject: Rota\nShift swap', 'DELIVERED', 'gm:t1', '2027-01-05 11:00+00', '2027-01-05 11:00+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111', NULL, 'team', 'deniz@h.example', 'inbound', 'email', 'Thanks, done', 'DELIVERED', 'gm:t1', '2027-01-05 11:30+00', '2027-01-05 11:30+00', '{}'),
  ('d0000000-0000-4000-8000-0000000000d1', '22222222-2222-4222-8222-222222222222', NULL, 'guest', 'other@x.example', 'inbound', 'email', 'Other house', 'DELIVERED', 'gm:o1', '2027-01-05 12:00+00', '2027-01-05 12:00+00', '{}'),
  ('d0000000-0000-4000-8000-0000000000d2', '22222222-2222-4222-8222-222222222222', NULL, 'team', 'deniz@h.example', 'inbound', 'email', 'Same address', 'DELIVERED', 'gm:t1', '2027-01-05 12:30+00', '2027-01-05 12:30+00', '{}');

-- An owner reads every kind, newest first; each row says what it is.
SELECT pg_temp.ok((SELECT string_agg(kind, ',' ORDER BY last_at DESC) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false)) = 'team,guest,vendor', 'every-kind-newest-first');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false) p
                   WHERE p.key = 'team:deniz@h.example' AND p.kind = 'team' AND p.provider_id IS NULL AND p.name = 'deniz@h.example'
                     AND p.last_line = 'Thanks, done' AND p.open_threads = 1 AND NOT p.waiting) = 1, 'team-row-carries-its-kind');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false) p
                   WHERE p.key = 'guest:stranger@x.example' AND p.kind = 'guest') = 1, 'guest-row-carries-its-kind');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false) p
                   WHERE p.key = 'vendor:c0000000-0000-4000-8000-000000000001' AND p.kind = 'vendor' AND p.waiting) = 1, 'vendor-row-unchanged');
-- A caller who may not (withhold true, also the default) reads vendors only.
SELECT pg_temp.ok((SELECT string_agg(kind, ',') FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', true)) = 'vendor', 'staff-reads-vendors-only');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111')) = 1, 'withholding-is-the-default');
-- Another house reads its own and nothing of this one.
SELECT pg_temp.ok((SELECT string_agg(key, ',' ORDER BY key) FROM public.list_mail_people('22222222-2222-4222-8222-222222222222', false)) = 'guest:other@x.example,team:deniz@h.example', 'another-house-reads-its-own');
-- Paging keeps the order, and "waiting only" lists no team or guest person.
SELECT pg_temp.ok((SELECT key FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false, false, '2027-01-05 11:30+00', 'team:deniz@h.example', 1)) = 'guest:stranger@x.example', 'keyset-page');
SELECT pg_temp.ok((SELECT string_agg(kind, ',') FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false, true)) = 'vendor', 'waiting-only-is-vendors');
-- Search finds them by a letter's words or an address, and never reads a withheld one.
SELECT pg_temp.ok((SELECT string_agg(key, ',') FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', false, false, NULL, NULL, 50, 'shift swap')) = 'team:deniz@h.example', 'search-by-letter-words');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('11111111-1111-4111-8111-111111111111', true, false, NULL, NULL, 50, 'shift swap')) = 0, 'search-never-reads-withheld');
-- One person's threads and letters: their own, withheld for staff, never another kind's or house's.
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_threads_other('11111111-1111-4111-8111-111111111111', 'team', 'deniz@h.example', false) t
                   WHERE t.thread_key = 'gm:t1' AND t.subject = 'Rota' AND t.letter_count = 2 AND t.last_direction = 'inbound' AND NOT t.waiting) = 1, 'threads-other');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_threads_other('11111111-1111-4111-8111-111111111111', 'team', 'deniz@h.example', true)) = 0, 'threads-other-withheld');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_threads_other('11111111-1111-4111-8111-111111111111', 'guest', 'deniz@h.example', false)) = 0, 'threads-other-wrong-kind');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_threads_other('11111111-1111-4111-8111-111111111111', 'team', 'someone@h.example', false)) = 0, 'threads-other-wrong-address');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_threads_other('11111111-1111-4111-8111-111111111111', 'team', 'deniz@h.example', false, '2027-01-05 11:30+00', 'gm:t1')) = 0, 'threads-other-keyset');
SELECT pg_temp.ok((SELECT string_agg(l.id::text, ',' ORDER BY l.at DESC) FROM public.mail_thread_letters_other('11111111-1111-4111-8111-111111111111', 'gm:t1', 'team', 'deniz@h.example', false) l)
                   = 'a0000000-0000-4000-8000-0000000000c2,a0000000-0000-4000-8000-0000000000c1', 'letters-other');
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('11111111-1111-4111-8111-111111111111', 'gm:t1', 'team', 'deniz@h.example', true)) = 0, 'letters-other-withheld');
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('22222222-2222-4222-8222-222222222222', 'gm:t1', 'team', 'deniz@h.example', false)) = 1, 'letters-other-own-house-only');
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters_other('11111111-1111-4111-8111-111111111111', 'gm:t1', 'team', 'deniz@h.example', false, '2027-01-05 11:30+00', 'a0000000-0000-4000-8000-0000000000c2')) = 1, 'letters-other-keyset');
-- The vendor model stays vendor: no other row is a letter or a thread state in it.
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_letter_rows('11111111-1111-4111-8111-111111111111', false, NULL)) = 1
                  AND (SELECT count(*) FROM public.mail_thread_states('11111111-1111-4111-8111-111111111111', false, NULL)) = 1, 'vendor-model-is-vendors-only');
rollback;
