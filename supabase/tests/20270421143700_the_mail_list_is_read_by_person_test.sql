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
   'inbound', 'email', 'I am out of the office', 'RECEIVED', 'mid:v3', '<ooo@v3.example>', now(), now(), '{"from":"sales@v3.example","transport":{"autoSubmitted":true,"autoReplied":true}}'),
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
  SELECT * INTO s FROM public.mail_inbox_summary('33333333-3333-4333-8333-333333333333', true);
  PERFORM pg_temp.ok(s.in_today = 2, 'M5 in_today counts letters, once each (got ' || s.in_today || ')');
  PERFORM pg_temp.ok(s.waiting_people = 1, 'M5b one person waiting (got ' || s.waiting_people || ')');
END $$;

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

-- ── Automatic is a bounce or an auto-reply, never a letter a person wrote ───
-- (audit follow-up on PR 951; migration mail_automatic_is_a_bounce_or_an_auto_reply)
-- House H4 (its own, so the counts are exact), timezone UTC, all "today":
--   V7: the house asked; the vendor answered from Outlook / Microsoft 365, so
--       the reply carries X-Auto-Response-Suppress (transport.autoSubmitted
--       true, autoReplied false).
--   V8: the vendor's ERP confirmed an order (Auto-Submitted: auto-generated).
--   V9: a price list, then a delivery status report from the vendor's own
--       server (multipart/report; delivery-status), not from mailer-daemon.
INSERT INTO public.restaurants (id, name, slug, timezone)
VALUES ('44444444-4444-4444-8444-444444444444', 'Test house 4', 'test-house-4', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, message_id, received_at, sent_at, created_at, email_headers) VALUES
  ('d7000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000007',
   'outbound', 'email', 'Can you deliver Friday?', 'SENT', 'mid:v7', '<ask@house4.example>', NULL, now() - interval '4 seconds', now() - interval '4 seconds', '{}'),
  ('d7000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000007',
   'inbound', 'email', 'Yes, Friday works', 'RECEIVED', 'mid:v7', '<re@v7.example>', now() - interval '3 seconds', NULL, now() - interval '3 seconds',
   '{"from":"Ayse <ayse@v7.example>","transport":{"autoSubmitted":true,"autoReplied":false,"deliveryReport":false,"isAutomated":true}}'),
  ('d8000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000008',
   'inbound', 'email', 'Order 1042 confirmed', 'RECEIVED', 'mid:v8', '<erp@v8.example>', now() - interval '3 seconds', NULL, now() - interval '3 seconds',
   '{"from":"orders@v8.example","transport":{"autoSubmitted":true,"autoReplied":false,"deliveryReport":false}}'),
  ('d9000000-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000009',
   'inbound', 'email', 'Price list', 'RECEIVED', 'mid:v9', '<list@v9.example>', now() - interval '3 seconds', NULL, now() - interval '3 seconds',
   '{"from":"sales@v9.example"}'),
  ('d9000000-0000-4000-8000-000000000002', '44444444-4444-4444-8444-444444444444', 'c0000000-0000-4000-8000-000000000009',
   'inbound', 'email', 'Undeliverable: your message', 'RECEIVED', 'mid:v9', '<dsn@mx.v9.example>', now() - interval '1 second', NULL, now() - interval '1 second',
   '{"from":"Postmaster Service <service@mx.v9.example>","transport":{"autoSubmitted":true,"autoReplied":false,"deliveryReport":true}}');

-- A1: an Outlook reply is the vendor's letter: last line, and the house owes it.
DO $$ DECLARE r record; a boolean; BEGIN
  SELECT * INTO r FROM public.list_mail_people('44444444-4444-4444-8444-444444444444', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000007';
  PERFORM pg_temp.ok(r.last_line = 'Yes, Friday works', 'A1 a reply carrying X-Auto-Response-Suppress is the last line (got ' || coalesce(r.last_line, 'null') || ')');
  PERFORM pg_temp.ok(r.waiting, 'A1b and the house is waiting on it');
  SELECT automatic INTO a FROM public.mail_thread_letters('44444444-4444-4444-8444-444444444444', 'mid:v7')
   WHERE id = 'd7000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.ok(a IS FALSE, 'A1c it is not labelled automatic');
END $$;

-- A2: an ERP confirmation (auto-generated) is a letter too.
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('44444444-4444-4444-8444-444444444444', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000008';
  PERFORM pg_temp.ok(r.waiting AND r.last_line = 'Order 1042 confirmed', 'A2 an auto-generated confirmation is a letter');
END $$;

-- A3: a delivery report is automatic whoever it claims to be from.
DO $$ DECLARE r record; a boolean; BEGIN
  SELECT automatic INTO a FROM public.mail_thread_letters('44444444-4444-4444-8444-444444444444', 'mid:v9')
   WHERE id = 'd9000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.ok(a IS TRUE, 'A3 a delivery status report is automatic');
  SELECT * INTO r FROM public.list_mail_people('44444444-4444-4444-8444-444444444444', true)
   WHERE provider_id = 'c0000000-0000-4000-8000-000000000009';
  PERFORM pg_temp.ok(r.last_line = 'Price list', 'A3b the last line is the letter, not the report');
END $$;

-- A4: today's letters in are the reply, the confirmation and the price list.
DO $$ DECLARE s record; BEGIN
  SELECT * INTO s FROM public.mail_inbox_summary('44444444-4444-4444-8444-444444444444', true);
  PERFORM pg_temp.ok(s.in_today = 3, 'A4 in_today counts the three letters, not the report (got ' || s.in_today || ')');
  PERFORM pg_temp.ok(s.waiting_people = 3, 'A4b three people waiting (got ' || s.waiting_people || ')');
END $$;

rollback;
