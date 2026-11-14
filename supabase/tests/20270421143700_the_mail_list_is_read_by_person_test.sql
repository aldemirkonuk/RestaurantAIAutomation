-- A mail thread is one vendor's letters under one key, read in the letters'
-- own time (migration the_mail_list_is_read_by_person; QA round 18 on #895:
-- the page asked for by key alone merged two vendors, and read in created_at).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything it writes is inside one transaction that is ROLLED BACK at the
-- end. Each check raises 'FAIL <id>' or notices 'PASS <id>'; the run stops at
-- the first failure. Foreign keys to the parent tables are dropped inside the
-- transaction so the rows need no house or vendor; the rollback restores them.
--
-- Fidelity: run as a superuser with no RLS; synthetic rows only, production
-- was not read.

\set ON_ERROR_STOP 1
begin;

ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- House H, vendors V1 and V2 sharing the key gm:shared; house H2 reuses it.
--   a1  V1 inbound   received 09:00, stored 12:00   (a backfill: stored late)
--   a2  V1 outbound  sent     10:00, stored 10:00
--   b1  V2 inbound   received 09:30, stored 09:30
--   b0  V2 house draft         08:00  (withheld from staff; would own the key)
--   z1  H2 V1 inbound received 08:30 under the same key
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Prices attached', 'DELIVERED', 'gm:shared', '2027-01-05 09:00+00', NULL, '2027-01-05 12:00+00', '{"subject":"Spring list"}'),
  ('a0000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'outbound', 'email', 'Thank you', 'SENT', 'gm:shared', NULL, '2027-01-05 10:00+00', '2027-01-05 10:00+00', '{}'),
  ('b0000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'Other vendor', 'DELIVERED', 'gm:shared', '2027-01-05 09:30+00', NULL, '2027-01-05 09:30+00', '{"subject":"Not yours"}'),
  ('b0000000-0000-4000-8000-0000000000b0', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002',
   'outbound', 'email', 'Unsent draft', 'HOUSE_DRAFT', 'gm:shared', NULL, NULL, '2027-01-05 08:00+00', '{}'),
  ('f0000000-0000-4000-8000-0000000000f1', '99999999-9999-4999-8999-999999999999', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Another house', 'DELIVERED', 'gm:shared', '2027-01-05 08:30+00', NULL, '2027-01-05 08:30+00', '{}');

-- T1: by key alone, the page is one vendor's: the first visible letter's (V1).
DO $$ DECLARE ids uuid[]; vs uuid[]; BEGIN
  -- WITH ORDINALITY keeps the order the function returned, so T2 checks it.
  SELECT array_agg(t.id ORDER BY t.ordinality), array_agg(DISTINCT t.provider_id)
    INTO ids, vs
    FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:shared') WITH ORDINALITY AS t;
  PERFORM pg_temp.ok(vs = ARRAY['c0000000-0000-4000-8000-000000000001'::uuid], 'T1 key alone reads one vendor, never two');
  -- T2: read in the letters' own time: sent 10:00 before received 09:00,
  -- although the 09:00 letter was stored last (created_at 12:00).
  PERFORM pg_temp.ok(ids = ARRAY['a0000000-0000-4000-8000-0000000000a2'::uuid, 'a0000000-0000-4000-8000-0000000000a1'::uuid],
                     'T2 newest first by received/sent time, not created_at');
END $$;

-- T3: naming the vendor reads that vendor only.
DO $$ DECLARE ids uuid[]; BEGIN
  SELECT array_agg(id) INTO ids FROM public.mail_thread_letters(
    '11111111-1111-4111-8111-111111111111', 'gm:shared', 'c0000000-0000-4000-8000-000000000002', true);
  PERFORM pg_temp.ok(ids = ARRAY['b0000000-0000-4000-8000-0000000000b1'::uuid], 'T3 with=V2 reads V2 alone, its draft withheld');
END $$;

-- T4: an owner/manager sees V2's 08:00 draft, which then owns the bare key.
DO $$ DECLARE vs uuid[]; BEGIN
  SELECT array_agg(DISTINCT provider_id) INTO vs FROM public.mail_thread_letters(
    '11111111-1111-4111-8111-111111111111', 'gm:shared', NULL, false);
  PERFORM pg_temp.ok(vs = ARRAY['c0000000-0000-4000-8000-000000000002'::uuid], 'T4 a withheld letter never picks the owner for staff, only for owners');
END $$;

-- T5: the page cursor is (at, id): after a2 comes a1 alone.
DO $$ DECLARE ids uuid[]; BEGIN
  SELECT array_agg(id) INTO ids FROM public.mail_thread_letters(
    '11111111-1111-4111-8111-111111111111', 'gm:shared', 'c0000000-0000-4000-8000-000000000001', true,
    '2027-01-05 10:00+00', 'a0000000-0000-4000-8000-0000000000a2');
  PERFORM pg_temp.ok(ids = ARRAY['a0000000-0000-4000-8000-0000000000a1'::uuid], 'T5 keyset page on (at, id)');
END $$;

-- T6: the subject is the vendor's own first letter's, never the other vendor's.
DO $$ DECLARE s text; BEGIN
  SELECT DISTINCT thread_subject INTO s FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:shared');
  PERFORM pg_temp.ok(s = 'Spring list', 'T6 subject from this vendor''s letters');
END $$;

-- T7: another house's letter under the same key never shows.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:shared')
   WHERE id = 'f0000000-0000-4000-8000-0000000000f1';
  PERFORM pg_temp.ok(n = 0, 'T7 tenant scope');
  SELECT count(*) INTO n FROM public.mail_thread_letters('99999999-9999-4999-8999-999999999999', 'gm:shared');
  PERFORM pg_temp.ok(n = 1, 'T7b the other house reads its own letter');
END $$;

-- T8: the thread list keeps the two vendors apart under the shared key.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.mail_thread_states('11111111-1111-4111-8111-111111111111', true, NULL)
   WHERE thread_key = 'gm:shared';
  PERFORM pg_temp.ok(n = 2, 'T8 one thread per (vendor, key)');
END $$;

-- T9: staff cannot call it; only the gateway's service role can.
DO $$ BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.mail_thread_letters(uuid, text, uuid, boolean, timestamp with time zone, uuid, integer)', 'EXECUTE'), 'T9 not granted to authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.mail_letter_rows(uuid, boolean, uuid)', 'EXECUTE'), 'T9b helper not granted to anon');
END $$;

-- ── Letters are counted once, and only letters (QA round 16, M-5) ──────────
-- House H3 (its own, so the counts are exact), timezone UTC, all "today":
--   V3: one vendor letter delivered twice (same Message-ID, both doors),
--       then a bounce from mailer-daemon, then an auto-reply.
--   V6: one inbound letter the triage set aside (DISCARDED).
INSERT INTO public.restaurants (id, name, timezone)
VALUES ('33333333-3333-4333-8333-333333333333', 'Test house', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, message_id, received_at, created_at, email_headers) VALUES
  ('d3000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'Our prices', 'RECEIVED', 'mid:v3', '<abc@v3.example>', now() - interval '3 seconds', now() - interval '3 seconds', '{"from":"Sales <sales@v3.example>"}'),
  ('d3000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'Our prices', 'RECEIVED', 'mid:v3', ' <ABC@v3.example> ', now() - interval '3 seconds', now() - interval '2 seconds', '{"from":"Sales <sales@v3.example>"}'),
  ('d3000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'Delivery Status Notification (Failure)', 'RECEIVED', 'mid:v3', '<bounce@mx.example>', now() - interval '1 second', now() - interval '1 second', '{"from":"Mail Delivery Subsystem <MAILER-DAEMON@mx.example>"}'),
  ('d3000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'I am out of the office', 'RECEIVED', 'mid:v3', '<ooo@v3.example>', now(), now(), '{"from":"sales@v3.example","transport":{"autoSubmitted":true}}'),
  ('d6000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000006',
   'inbound', 'email', 'Win a cruise', 'DISCARDED', 'mid:v6', '<spam@v6.example>', now() - interval '5 seconds', now() - interval '5 seconds', '{"from":"x@v6.example"}');
UPDATE public.procurement_conversations SET discard_reason = 'not a vendor letter'
 WHERE id = 'd6000000-0000-4000-8000-000000000001';

-- M1: one letter delivered twice is one letter in the thread list and page.
DO $$ DECLARE n bigint; ids uuid[]; BEGIN
  SELECT message_count INTO n FROM public.mail_thread_states('33333333-3333-4333-8333-333333333333', true, NULL)
   WHERE thread_key = 'mid:v3';
  PERFORM pg_temp.ok(n = 1, 'M1 a second copy and automatic mail are not counted as letters');
  SELECT array_agg(id ORDER BY id) INTO ids FROM public.mail_thread_letters('33333333-3333-4333-8333-333333333333', 'mid:v3');
  PERFORM pg_temp.ok(ids = ARRAY['d3000000-0000-4000-8000-000000000001'::uuid, 'd3000000-0000-4000-8000-000000000003'::uuid,
                                 'd3000000-0000-4000-8000-000000000004'::uuid],
                     'M1b the page shows the letter once, the first copy stored');
END $$;

-- M2: the bounce and the auto-reply stay on the page, named automatic.
DO $$ DECLARE a uuid[]; BEGIN
  SELECT array_agg(id ORDER BY id) INTO a FROM public.mail_thread_letters('33333333-3333-4333-8333-333333333333', 'mid:v3')
   WHERE automatic;
  PERFORM pg_temp.ok(a = ARRAY['d3000000-0000-4000-8000-000000000003'::uuid, 'd3000000-0000-4000-8000-000000000004'::uuid],
                     'M2 a bounce and an auto-reply are automatic');
END $$;

-- M3: the person's last line is the vendor's letter, not the auto-reply,
-- and an auto-reply never makes the house owe an answer by itself.
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000003';
  PERFORM pg_temp.ok(r.last_line = 'Our prices', 'M3 last line is the letter, not automatic mail');
  PERFORM pg_temp.ok(r.waiting, 'M3b the vendor''s real letter still waits for an answer');
END $$;

-- M4: a letter that was set aside owes no answer.
DO $$ DECLARE w boolean; BEGIN
  SELECT waiting INTO w FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000006';
  PERFORM pg_temp.ok(w IS FALSE, 'M4 a DISCARDED letter is not waiting');
END $$;

-- M5: the header counts letters in today: V3's letter once and V6's, never
-- the second copy, the bounce or the auto-reply.
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM public.mail_inbox_summary('33333333-3333-4333-8333-333333333333', true, 'UTC');
  PERFORM pg_temp.ok(s.in_today = 2, 'M5 in_today counts letters, once each (got ' || s.in_today || ')');
  PERFORM pg_temp.ok(s.waiting_people = 1, 'M5b one person waiting (got ' || s.waiting_people || ')');
  -- D6: the Letters strip's 30-day reply count is the same letters, by the
  -- same flag, as Mail's "in" — never the bounce, the auto-reply or the copy.
  PERFORM pg_temp.ok(s.in_30d = 2, 'M5c in_30d counts the same letters as in_today (got ' || s.in_30d || ')');
END $$;

-- M6 (D7): with no zone the house's day has no midnight, so both "today"
-- counts are unknown (NULL), never a UTC day's count; the 30-day figure needs
-- no zone and stays counted.
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM public.mail_inbox_summary('33333333-3333-4333-8333-333333333333', true, NULL);
  PERFORM pg_temp.ok(s.in_today IS NULL AND s.out_today IS NULL, 'M6 no zone: today''s counts are unknown, not 0');
  PERFORM pg_temp.ok(s.in_30d = 2, 'M6b no zone: the 30-day count is still counted (got ' || s.in_30d || ')');
  SELECT * INTO s FROM public.mail_inbox_summary('33333333-3333-4333-8333-333333333333', true, '  ');
  PERFORM pg_temp.ok(s.in_today IS NULL, 'M6c a blank zone is no zone');
END $$;

-- M7 (D6): a letter older than 30 days is out of the 30-day count.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, message_id, received_at, created_at, email_headers) VALUES
  ('d7000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000007',
   'inbound', 'email', 'Old prices', 'RECEIVED', 'mid:v7', '<old@v7.example>', now() - interval '31 days', now() - interval '31 days', '{"from":"a@v7.example"}');
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM public.mail_inbox_summary('33333333-3333-4333-8333-333333333333', true, 'UTC');
  PERFORM pg_temp.ok(s.in_30d = 2, 'M7 a 31-day-old letter is not in the 30-day count (got ' || s.in_30d || ')');
END $$;
DELETE FROM public.procurement_conversations WHERE id = 'd7000000-0000-4000-8000-000000000001';

-- ── A vendor whose only letter has not left stays listed (QA round 16, HARM 1)
--   V4: one letter queued in its undo window, nothing else.
--   V5: one letter pulled back (HOUSE_CANCELLED: withheld from staff).
--   V3: a letter queued after its replies.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, created_at, scheduled_send_at) VALUES
  ('d4000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000004',
   'outbound', 'email', E'Subject: First order\nPlease send 6 cases', 'HOUSE_QUEUED', 'q:v4', now() - interval '1 minute', now() + interval '1 minute'),
  ('d5000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000005',
   'outbound', 'email', 'Pulled back', 'HOUSE_CANCELLED', 'q:v5', now() - interval '2 minutes', NULL),
  ('d3000000-0000-4000-8000-000000000009', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000003',
   'outbound', 'email', 'Thank you, ordering', 'HOUSE_QUEUED', 'mid:v3', now() + interval '1 second', now() + interval '1 minute');

DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000004';
  PERFORM pg_temp.ok(r.provider_id IS NOT NULL, 'H1 a vendor with only a queued letter is listed');
  PERFORM pg_temp.ok(r.unsent_status = 'HOUSE_QUEUED', 'H1b its state is named');
  PERFORM pg_temp.ok(r.waiting IS FALSE AND r.last_direction = 'outbound', 'H1c never waiting');
  PERFORM pg_temp.ok(r.last_line = 'Please send 6 cases', 'H1d its line, Subject removed');
END $$;

DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000005';
  PERFORM pg_temp.ok(n = 0, 'H2 a pulled-back letter stays withheld from staff');
  SELECT count(*) INTO n FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', false)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000005' AND unsent_status = 'HOUSE_CANCELLED';
  PERFORM pg_temp.ok(n = 1, 'H2b the owner sees the vendor, pulled back');
END $$;

DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000003';
  PERFORM pg_temp.ok(r.unsent_status = 'HOUSE_QUEUED', 'H3 a queued letter after the replies is named');
  PERFORM pg_temp.ok(r.last_line = 'Our prices', 'H3b but the list line stays the last letter that passed');
END $$;

-- H4: waiting-only never lists an unsent-only vendor; the waiting page is a page.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.list_mail_people('33333333-3333-4333-8333-333333333333', true, true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000004';
  PERFORM pg_temp.ok(n = 0, 'H4 waiting-only leaves out unsent-only vendors');
END $$;

-- ── A letter can need no reply (r28 mail audit, gap 4) ──────────────────────
-- House H4 (UTC). Vendor V8, thread gm:nr, in the thread's own order:
--   n1 in  09:00  "Can you confirm?"      (answered by n2)
--   n2 out 10:00  "Confirmed"
--   n3 in  11:00  "Thanks!"
--   n4 in  11:00  "See you Friday"         same time as n3, larger id: after it
-- V8 also has thread gm:other (o1 in 08:00). V9 shares the key gm:nr (p1 in
-- 10:30, before V8's marks). V10 has one thread (q1 in 07:00). House H5 has V8's key too (z1).
ALTER TABLE public.mail_letter_no_reply_marks DROP CONSTRAINT IF EXISTS mail_letter_no_reply_marks_restaurant_id_fkey;
INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('44444444-4444-4444-8444-444444444444', 'No reply house', 'no-reply-house-test', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('e8000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'Can you confirm?', 'RECEIVED', 'gm:nr', '2027-02-01 09:00+00', NULL, '2027-02-01 09:00+00', '{}'),
  ('e8000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'outbound', 'email', 'Confirmed', 'SENT', 'gm:nr', NULL, '2027-02-01 10:00+00', '2027-02-01 10:00+00', '{}'),
  ('e8000000-0000-4000-8000-000000000003', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'Thanks!', 'RECEIVED', 'gm:nr', '2027-02-01 11:00+00', NULL, '2027-02-01 11:00+00', '{}'),
  ('e8000000-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'See you Friday', 'RECEIVED', 'gm:nr', '2027-02-01 11:00+00', NULL, '2027-02-01 11:00+00', '{}'),
  ('e8000000-0000-4000-8000-0000000000a1', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'Another question', 'RECEIVED', 'gm:other', '2027-02-01 08:00+00', NULL, '2027-02-01 08:00+00', '{}'),
  ('e9000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000009',
   'inbound', 'email', 'Other vendor, same key', 'RECEIVED', 'gm:nr', '2027-02-01 10:30+00', NULL, '2027-02-01 10:30+00', '{}'),
  ('ea000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-00000000000a',
   'inbound', 'email', 'Price list', 'RECEIVED', 'gm:v10', '2027-02-01 07:00+00', NULL, '2027-02-01 07:00+00', '{}'),
  ('e5000000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'Other house', 'RECEIVED', 'gm:nr', '2027-02-01 13:00+00', NULL, '2027-02-01 13:00+00', '{}');

-- NR1: before any mark the thread waits since n3, the first letter after n2.
DO $$ DECLARE r record; s record; BEGIN
  SELECT * INTO r FROM public.mail_thread_states('44444444-4444-4444-8444-444444444444', true, NULL)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008' AND thread_key = 'gm:nr';
  PERFORM pg_temp.ok(r.waiting AND r.waiting_since = '2027-02-01 11:00+00', 'NR1 unmarked thread waits since n3');
  SELECT * INTO s FROM public.mail_inbox_summary('44444444-4444-4444-8444-444444444444', true, 'UTC');
  PERFORM pg_temp.ok(s.waiting_people = 3, 'NR1b three people wait (got ' || s.waiting_people || ')');
END $$;

-- NR2: what may be marked: only a letter of this house that it received.
DO $$ BEGIN
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000002') = 'not_received', 'NR2 a letter the house sent cannot be marked');
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e5000000-0000-4000-8000-000000000001') = 'not_found', 'NR2b another house''s letter is not found');
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e0000000-0000-4000-8000-0000000000ff') = 'not_found', 'NR2c an unknown letter is not found');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mail_letter_no_reply_marks), 'NR2d no refused mark was written');
END $$;

-- NR3: marking n3 settles n3 and the earlier n1, never n4 (same time, after it).
DO $$ DECLARE r record; o record; BEGIN
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-0000000000aa') = 'marked', 'NR3 n3 marked');
  SELECT bool_or(owes) FILTER (WHERE id = 'e8000000-0000-4000-8000-000000000001') AS n1,
         bool_or(owes) FILTER (WHERE id = 'e8000000-0000-4000-8000-000000000003') AS n3,
         bool_or(owes) FILTER (WHERE id = 'e8000000-0000-4000-8000-000000000004') AS n4
    INTO o FROM public.mail_letter_rows('44444444-4444-4444-8444-444444444444', true, NULL);
  PERFORM pg_temp.ok(o.n1 IS FALSE AND o.n3 IS FALSE, 'NR3b n1 and n3 owe nothing');
  PERFORM pg_temp.ok(o.n4, 'NR3c n4, after n3 in the thread''s order, still owes');
  SELECT * INTO r FROM public.mail_thread_states('44444444-4444-4444-8444-444444444444', true, NULL)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008' AND thread_key = 'gm:nr';
  PERFORM pg_temp.ok(r.waiting, 'NR3d the thread still waits on n4');
END $$;

-- NR4: marking n4 too settles the thread, and only that thread.
DO $$ DECLARE r record; p record; v9 boolean; s record; tw boolean; BEGIN
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000004') = 'marked', 'NR4 n4 marked');
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000004') = 'marked', 'NR4b marking twice is still marked');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.mail_letter_no_reply_marks) = 2, 'NR4c one mark per letter');
  SELECT * INTO r FROM public.mail_thread_states('44444444-4444-4444-8444-444444444444', true, NULL)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008' AND thread_key = 'gm:nr';
  PERFORM pg_temp.ok(r.waiting IS FALSE AND r.waiting_since IS NULL, 'NR4d the thread no longer waits');
  PERFORM pg_temp.ok(r.message_count = 4 AND r.last_direction = 'inbound', 'NR4e its letters are all still there');
  SELECT * INTO p FROM public.list_mail_people('44444444-4444-4444-8444-444444444444', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008';
  PERFORM pg_temp.ok(p.waiting AND p.waiting_since = '2027-02-01 08:00+00', 'NR4f V8''s other thread still waits');
  SELECT waiting INTO v9 FROM public.mail_thread_states('44444444-4444-4444-8444-444444444444', true, NULL)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000009' AND thread_key = 'gm:nr';
  PERFORM pg_temp.ok(v9, 'NR4g another vendor under the same key still waits');
  SELECT DISTINCT thread_waiting INTO tw FROM public.mail_thread_letters('44444444-4444-4444-8444-444444444444', 'gm:nr',
    'c0000000-0000-4000-8000-000000000008', true);
  PERFORM pg_temp.ok(tw IS FALSE, 'NR4h the thread page says it is not waiting');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.mail_thread_letters('44444444-4444-4444-8444-444444444444', 'gm:nr',
    'c0000000-0000-4000-8000-000000000008', true) WHERE no_reply_marked_at IS NOT NULL) = 2, 'NR4i the page names the two marked letters');
END $$;

-- NR5: marking V10's only letter takes V10 off the header count.
DO $$ DECLARE s record; BEGIN
  PERFORM public.mail_letter_mark_no_reply('44444444-4444-4444-8444-444444444444', 'ea000000-0000-4000-8000-000000000001');
  SELECT * INTO s FROM public.mail_inbox_summary('44444444-4444-4444-8444-444444444444', true, 'UTC');
  PERFORM pg_temp.ok(s.waiting_people = 2, 'NR5 the header counts two waiting (got ' || s.waiting_people || ')');
  PERFORM pg_temp.ok(s.oldest_wait_at = '2027-02-01 08:00+00', 'NR5b the oldest wait is no longer V10''s');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.list_mail_people('44444444-4444-4444-8444-444444444444', true, true)
    WHERE provider_id = 'c0000000-0000-4000-8000-00000000000a') = 0, 'NR5c V10 is off the waiting list');
END $$;

-- NR6: a mark is never another house's: H5 marks its own letter under the
-- same vendor and key, and a later H4 letter still waits.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('e8000000-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'One more thing', 'RECEIVED', 'gm:nr', '2027-02-01 12:30+00', NULL, '2027-02-01 12:30+00', '{}'),
  -- A letter the house has queued but not sent is newer, and answers nothing yet.
  ('e8000000-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'outbound', 'email', 'Let me check', 'HOUSE_QUEUED', 'gm:nr', NULL, NULL, '2027-02-01 12:45+00', '{}');
DO $$ DECLARE r record; tw boolean; BEGIN
  PERFORM pg_temp.ok(public.mail_letter_mark_no_reply('55555555-5555-4555-8555-555555555555',
    'e5000000-0000-4000-8000-000000000001') = 'marked', 'NR6 the other house marks its own letter');
  SELECT * INTO r FROM public.mail_thread_states('44444444-4444-4444-8444-444444444444', true, NULL)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008' AND thread_key = 'gm:nr';
  PERFORM pg_temp.ok(r.waiting AND r.waiting_since = '2027-02-01 12:30+00',
    'NR6b a letter after the mark waits again, from that letter, whatever another house marked');
  SELECT DISTINCT thread_waiting INTO tw FROM public.mail_thread_letters('44444444-4444-4444-8444-444444444444', 'gm:nr',
    'c0000000-0000-4000-8000-000000000008', false);
  PERFORM pg_temp.ok(tw, 'NR6c the thread page says it waits again, a queued letter after it or not');
END $$;

-- NR7: taking a mark back.
DO $$ DECLARE o record; BEGIN
  PERFORM pg_temp.ok(public.mail_letter_unmark_no_reply('55555555-5555-4555-8555-555555555555',
    'e8000000-0000-4000-8000-000000000004') = 'not_found', 'NR7 another house cannot take H4''s mark back');
  PERFORM pg_temp.ok(public.mail_letter_unmark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000004') = 'unmarked', 'NR7b n4''s mark taken back');
  PERFORM pg_temp.ok(public.mail_letter_unmark_no_reply('44444444-4444-4444-8444-444444444444',
    'e8000000-0000-4000-8000-000000000004') = 'not_marked', 'NR7c twice: nothing to take back');
  SELECT bool_or(owes) FILTER (WHERE id = 'e8000000-0000-4000-8000-000000000003') AS n3,
         bool_or(owes) FILTER (WHERE id = 'e8000000-0000-4000-8000-000000000004') AS n4
    INTO o FROM public.mail_letter_rows('44444444-4444-4444-8444-444444444444', true, NULL);
  PERFORM pg_temp.ok(o.n4 AND o.n3 IS FALSE, 'NR7d n4 owes again; n3''s own mark still holds');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.mail_letter_no_reply_marks
    WHERE conversation_id = 'e5000000-0000-4000-8000-000000000001') = 1, 'NR7e the other house''s mark is untouched');
END $$;

-- NR8: only the gateway reaches the marks.
DO $$ BEGIN
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.mail_letter_no_reply_marks', 'SELECT'),
    'NR8 the marks are not readable by authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.mail_letter_mark_no_reply(uuid, uuid, uuid)', 'EXECUTE'), 'NR8b marking is not granted to authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.mail_letter_unmark_no_reply(uuid, uuid)', 'EXECUTE'), 'NR8c unmarking is not granted to anon');
  PERFORM pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mail_letter_no_reply_marks'::regclass),
    'NR8d row level security is on');
END $$;

-- ── A thread counts its letters, and the list can be searched (r28 mail gaps 14, 16) ──
-- House H6, its own. Vendors (providers rows, so the list has names):
--   P1 "Süt Evi":      s1 in "Our list", subject "Spring prices"; then a
--                      queued letter (not left) and a bounce, same thread.
--   P2 "Fish Co":      s2 in "The İstanbul van is late".
--   P3 "Bread 50% Ltd": s3 in "hello", on order PO-777 (snapshot only),
--                      DELIVERED: it owes nothing, so P3 is not waiting.
--   P4 "Wine Cellar":  s4 in "hi"; a HOUSE_DRAFT "credit claim secret".
--   P5 "Sut Copy":     a second copy (same Message-ID) holds "cheddar".
-- House H7 has P2's twin letter "Süt", which H6 must never find.
INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('66666666-6666-4666-8666-666666666666', 'Search house', 'search-house-test', 'UTC'),
  ('77777777-7777-4777-8777-777777777777', 'Other search house', 'other-search-house-test', 'UTC');
INSERT INTO public.providers (id, restaurant_id, name, primary_contact) VALUES
  ('c6000000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 'Süt Evi', '{}'),
  ('c6000000-0000-4000-8000-000000000002', '66666666-6666-4666-8666-666666666666', 'Fish Co', '{}'),
  ('c6000000-0000-4000-8000-000000000003', '66666666-6666-4666-8666-666666666666', 'Bread 50% Ltd', '{}'),
  ('c6000000-0000-4000-8000-000000000004', '66666666-6666-4666-8666-666666666666', 'Wine Cellar', '{}'),
  ('c6000000-0000-4000-8000-000000000005', '66666666-6666-4666-8666-666666666666', 'Plain Dairy', '{}'),
  ('c7000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777', 'Elsewhere', '{}');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, message_id,
   order_number_snapshot, received_at, sent_at, created_at, email_headers) VALUES
  ('f6000000-0000-4000-8000-000000000001', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Our list', 'RECEIVED', 'mid:s1', '<s1@a>', NULL, '2027-03-01 09:00+00', NULL, '2027-03-01 09:00+00', '{"subject":"Spring prices"}'),
  ('f6000000-0000-4000-8000-000000000002', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000001',
   'outbound', 'email', 'Not left yet', 'HOUSE_QUEUED', 'mid:s1', NULL, NULL, NULL, NULL, '2027-03-01 09:30+00', '{}'),
  ('f6000000-0000-4000-8000-000000000003', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Undeliverable', 'RECEIVED', 'mid:s1', '<b@mx>', NULL, '2027-03-01 09:40+00', NULL, '2027-03-01 09:40+00', '{"from":"MAILER-DAEMON@mx.example"}'),
  ('f6000000-0000-4000-8000-000000000004', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'The İstanbul van is late', 'RECEIVED', 'mid:s2', '<s2@a>', NULL, '2027-03-01 08:00+00', NULL, '2027-03-01 08:00+00', '{}'),
  ('f6000000-0000-4000-8000-000000000005', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'hello', 'DELIVERED', 'mid:s3', '<s3@a>', 'PO-777', '2027-03-01 07:00+00', NULL, '2027-03-01 07:00+00', '{}'),
  ('f6000000-0000-4000-8000-000000000006', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000004',
   'inbound', 'email', 'hi', 'RECEIVED', 'mid:s4', '<s4@a>', NULL, '2027-03-01 06:00+00', NULL, '2027-03-01 06:00+00', '{}'),
  ('f6000000-0000-4000-8000-000000000007', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000004',
   'outbound', 'email', 'credit claim secret', 'HOUSE_DRAFT', 'mid:s4', NULL, NULL, NULL, NULL, '2027-03-01 06:30+00', '{}'),
  ('f6000000-0000-4000-8000-000000000008', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000005',
   'inbound', 'email', 'butter', 'RECEIVED', 'mid:s5', '<s5@a>', NULL, '2027-03-01 05:00+00', NULL, '2027-03-01 05:00+00', '{}'),
  ('f6000000-0000-4000-8000-000000000009', '66666666-6666-4666-8666-666666666666', 'c6000000-0000-4000-8000-000000000005',
   'inbound', 'email', 'butter and cheddar', 'RECEIVED', 'mid:s5', '<S5@a>', NULL, '2027-03-01 05:00+00', NULL, '2027-03-01 05:05+00', '{}'),
  ('f7000000-0000-4000-8000-000000000001', '77777777-7777-4777-8777-777777777777', 'c7000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Süt and wine', 'RECEIVED', 'mid:z7', '<z7@a>', NULL, '2027-03-01 09:00+00', NULL, '2027-03-01 09:00+00', '{}');

-- LC1: a thread counts the letters that came or went, not the queued one.
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.mail_thread_states('66666666-6666-4666-8666-666666666666', true, NULL)
   WHERE thread_key = 'mid:s1';
  PERFORM pg_temp.ok(r.letter_count = 1, 'LC1 a queued letter and a bounce are not counted as letters');
  PERFORM pg_temp.ok(r.message_count = 2, 'LC1b message_count still holds every row that is not automatic');
  SELECT * INTO r FROM public.list_mail_threads('66666666-6666-4666-8666-666666666666',
    'c6000000-0000-4000-8000-000000000001', true);
  PERFORM pg_temp.ok(r.letter_count = 1 AND r.message_count = 2, 'LC1c the thread list carries both counts');
  SELECT * INTO r FROM public.list_mail_threads('66666666-6666-4666-8666-666666666666',
    'c6000000-0000-4000-8000-000000000004', false);
  PERFORM pg_temp.ok(r.letter_count = 1 AND r.message_count = 2, 'LC1d an owner''s draft is on the thread, not one of its letters');
END $$;

-- S1: the search finds by name, accents and dotted I folded.
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key ORDER BY key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'SUT');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000001'], 'S1 "SUT" finds Süt Evi by name, and no other house');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'istanbul');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000002'], 'S1b "istanbul" finds a letter that says İstanbul');
END $$;

-- S2: by a thread subject and by an order number.
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, '  spring PRICES ');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000001'], 'S2 a subject is found, trimmed and folded');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'po-777');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000003'], 'S2b an order number is found');
END $$;

-- S3: % and _ are plain characters, never wildcards.
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, '50%');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000003'], 'S3 "50%" finds the name holding it');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, '%');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000003'], 'S3b a bare "%" is not "everyone"');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'h_');
  PERFORM pg_temp.ok(ks IS NULL, 'S3c "_" matches only an underscore');
END $$;

-- S4: a withheld draft is not searched for staff, and is for an owner.
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'credit claim');
  PERFORM pg_temp.ok(ks IS NULL, 'S4 staff do not find a word that is only in a withheld draft');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', false, false, NULL, NULL, 50, 'credit claim');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000004'], 'S4b an owner finds it');
END $$;

-- S5: a second copy of a letter is not searched; the letter itself is.
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'cheddar');
  PERFORM pg_temp.ok(ks IS NULL, 'S5 words only in a second copy find no one');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'butter');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000005'], 'S5b the letter''s own words do');
END $$;

-- S6: no search, a blank one and a search with the waiting chip.
DO $$ DECLARE n int; ks text[]; BEGIN
  SELECT count(*) INTO n FROM public.list_mail_people('66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, NULL);
  PERFORM pg_temp.ok(n = 5, 'S6 no search lists everyone');
  SELECT count(*) INTO n FROM public.list_mail_people('66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, '   ');
  PERFORM pg_temp.ok(n = 5, 'S6b a blank search lists everyone');
  SELECT count(*) INTO n FROM public.list_mail_people('66666666-6666-4666-8666-666666666666');
  PERFORM pg_temp.ok(n = 5, 'S6c the old call, with no search argument, still works');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, true, NULL, NULL, 50, 'hello');
  PERFORM pg_temp.ok(ks IS NULL, 'S6d a search with Waiting on you keeps both filters (P3 is not waiting)');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, true, NULL, NULL, 50, 'late');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000002'], 'S6e a waiting vendor is found with the chip on');
END $$;

-- S7: what was typed is cut at 100 characters; the fold and the grants.
UPDATE public.procurement_conversations SET message_text = 'butter ' || repeat('x', 100) || 'y'
 WHERE id = 'f6000000-0000-4000-8000-000000000008';
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, repeat('x', 100) || 'q');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000005'], 'S7 only the first 100 characters are searched');
  PERFORM pg_temp.ok(public.mail_fold('İSTANBUL Çığ Şöför') = 'istanbul cig sofor', 'S7 the fold reads Turkish letters as plain ones');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mail_fold(text)', 'EXECUTE'), 'S7b the fold is not granted to anon');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text)', 'EXECUTE'),
    'S7c the searching list is not granted to authenticated');
END $$;

-- S8: what was typed is matched as plain text, never as a pattern; each plain
-- letter stands for its accented and Turkish forms in upper and lower case.
DO $$ DECLARE ks text[]; ok_paren boolean; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'fish.co');
  PERFORM pg_temp.ok(ks IS NULL, 'S8 a dot is a dot: "fish.co" does not find Fish Co');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'süt');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000001'], 'S8b "süt" typed with its accent finds Süt Evi');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'İSTANBUL');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000002'], 'S8c "İSTANBUL" typed in capitals finds the letter');
  BEGIN
    SELECT array_agg(key) INTO ks FROM public.list_mail_people(
      '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'bread (50');
    ok_paren := ks IS NULL;
  EXCEPTION WHEN OTHERS THEN ok_paren := false;
  END;
  PERFORM pg_temp.ok(ok_paren, 'S8d an open bracket is searched plainly and does not fail');
  PERFORM pg_temp.ok('âçéğñöşıü' ~* public.mail_search_pattern('acegnosiu')
                 AND 'ÂÇÉĞÑÖŞİÜ' ~* public.mail_search_pattern('ACEGNOSIU'),
    'S8e every plain letter stands for its accented forms, both cases');
  PERFORM pg_temp.ok(public.mail_search_pattern('  ') IS NULL AND public.mail_search_pattern(NULL) IS NULL,
    'S8f a blank search is no search');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mail_search_pattern(text)', 'EXECUTE'),
    'S8g the search pattern is not granted to anon');
END $$;

-- S9: the search does not care about case, in names, subjects and letters,
-- and an accented letter typed finds the plain one written.
UPDATE public.procurement_conversations SET email_headers = '{"subject":"Spring Prices"}'
 WHERE id = 'f6000000-0000-4000-8000-000000000001';
DO $$ DECLARE ks text[]; BEGIN
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'fish co');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000002'], 'S9 "fish co" finds Fish Co by name');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'spring prices');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000001'], 'S9b "spring prices" finds the subject Spring Prices');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'the istanbul');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000002'], 'S9c "the istanbul" finds a letter that begins The İstanbul');
  SELECT array_agg(key) INTO ks FROM public.list_mail_people(
    '66666666-6666-4666-8666-666666666666', true, false, NULL, NULL, 50, 'PLÂİN');
  PERFORM pg_temp.ok(ks = ARRAY['vendor:c6000000-0000-4000-8000-000000000005'], 'S9d "PLÂİN" typed with accents finds Plain Dairy');
END $$;

-- ── The list line is worked out for the shown rows only (r35 mail, gap 12) ──
-- The thread states carry the newest visible letter's id, not its text; the
-- people list reads that one letter's preview after paging. These pin that the
-- id is the right letter and that the preview reads exactly as before.

-- P1: the thread's last letter is its vendor's letter, the first copy stored:
-- not the second copy, not the bounce or auto-reply, not the queued letter.
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.mail_thread_states('33333333-3333-4333-8333-333333333333', true, NULL)
   WHERE thread_key = 'mid:v3';
  PERFORM pg_temp.ok(r.last_id = 'd3000000-0000-4000-8000-000000000001'::uuid,
    'P1 the thread''s last letter is the vendor''s letter, not automatic mail or a queued letter');
END $$;

-- P2: the preview drops a leading Subject line, folds whitespace, keeps 160.
DO $$ BEGIN
  PERFORM pg_temp.ok(public.mail_preview(E'Subject: Order 12\n  Please   send\t\t6\n cases ') = 'Please send 6 cases',
    'P2 a leading Subject line is removed and whitespace folded');
  PERFORM pg_temp.ok(public.mail_preview(E'  subject: lower case\nBody') = 'Body',
    'P2b the Subject line is removed whatever its case and leading space');
  PERFORM pg_temp.ok(public.mail_preview(E'Hello\nSubject: not first') = 'Hello Subject: not first',
    'P2c only a leading Subject line is removed');
  PERFORM pg_temp.ok(public.mail_preview(repeat('x', 300)) = repeat('x', 160),
    'P2d the line is cut to 160 characters');
  PERFORM pg_temp.ok(public.mail_preview(NULL) IS NULL, 'P2e no text is no line');
  PERFORM pg_temp.ok(public.mail_preview('Subject: only') = '', 'P2f a letter of only a Subject line has an empty line');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mail_preview(text)', 'EXECUTE')
                 AND NOT has_function_privilege('authenticated', 'public.mail_preview(text)', 'EXECUTE'),
    'P2g the preview is not granted to anon or signed-in callers');
END $$;

-- P3: a house draft written after the vendor's letter is never staff's line.
--   House A, vendor VA1: its letter at 09:00, a house draft at 10:00.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('5e000000-0000-4000-8000-0000000000e1', '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e', '5e000000-0000-4000-8000-0000000000c1',
   'inbound', 'email', E'Subject: Prices\nHello there', 'DELIVERED', 'gm:p3', '2027-02-01 09:00+00', NULL, '2027-02-01 09:00+00', '{}'),
  ('5e000000-0000-4000-8000-0000000000e2', '5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e', '5e000000-0000-4000-8000-0000000000c1',
   'outbound', 'email', 'Secret draft', 'HOUSE_DRAFT', 'gm:p3', NULL, NULL, '2027-02-01 10:00+00', '{}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e', true)
   WHERE provider_id = '5e000000-0000-4000-8000-0000000000c1';
  PERFORM pg_temp.ok(r.last_line = 'Hello there', 'P3 a withheld draft is never staff''s line');
END $$;

-- P4: every row of a short page carries its own line, not its neighbour's.
DO $$ DECLARE ls text[]; BEGIN
  SELECT array_agg(last_line ORDER BY provider_id) INTO ls FROM public.list_mail_people(
    '33333333-3333-4333-8333-333333333333', true, false, NULL, NULL, 50)
   WHERE provider_id IN ('c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.ok(ls = ARRAY['Our prices', 'Please send 6 cases'], 'P4 each listed person carries their own line');
END $$;

rollback;
