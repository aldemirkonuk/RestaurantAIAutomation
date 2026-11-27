-- The words that matched (r109 mail-gap g5): list_mail_people.hit_line and mail_hit_line.
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;
CREATE OR REPLACE FUNCTION pg_temp.letter(p_pid uuid, p_kind text, p_addr text, p_dir text, p_status text, p_ago interval, p_text text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.procurement_conversations
    (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
     sent_at, received_at, created_at, email_headers)
  VALUES (gen_random_uuid(), '71000000-0000-4000-8000-000000000001', p_pid, p_kind, p_addr, p_dir, 'email', p_text, p_status,
          'gm:' || COALESCE(p_pid::text, p_addr),
          CASE WHEN p_dir = 'outbound' AND p_status IN ('SENT', 'AUTO_SENT') THEN now() - p_ago END,
          CASE WHEN p_dir = 'inbound' THEN now() - p_ago END, now() - p_ago, '{}'::jsonb) $$;

-- pure: the line is centred, collapsed, and cut with an ellipsis only where it is cut
SELECT pg_temp.ok(public.mail_hit_line('Hello,' || E'\n' || 'the tahini' || E'\t' || 'pallet' || E'\r\n' || 'arrives.', public.mail_search_pattern('tahini'))
  = 'Hello, the tahini pallet arrives.', 'H0-collapses-whitespace-and-keeps-a-short-letter-whole');
SELECT pg_temp.ok(public.mail_hit_line('A letter with nothing in it.', public.mail_search_pattern('tahini')) IS NULL, 'H0-no-match-is-null');
SELECT pg_temp.ok(public.mail_hit_line('A letter.', NULL) IS NULL, 'H0-no-pattern-is-null');
SELECT pg_temp.ok(public.mail_hit_line('Şükrü gönderdi', public.mail_search_pattern('sukru')) = 'Şükrü gönderdi', 'H0-turkish-letters-match-as-the-search-does');
SELECT pg_temp.ok(public.mail_hit_line(repeat('a', 300) || ' tahini ' || repeat('b', 300), public.mail_search_pattern('tahini')) ~ '^….*tahini.*…$', 'H0-cut-both-ends-says-so');
SELECT pg_temp.ok(length(public.mail_hit_line(repeat('a', 300) || ' tahini ' || repeat('b', 300), public.mail_search_pattern('tahini'))) BETWEEN 140 AND 142, 'H0-about-140-chars');
SELECT pg_temp.ok(strpos(public.mail_hit_line(repeat('a', 300) || ' tahini ' || repeat('b', 300), public.mail_search_pattern('tahini')), 'tahini') BETWEEN 60 AND 80, 'H0-centred-on-the-match');
SELECT pg_temp.ok(public.mail_hit_line('tahini first, and more words after it', public.mail_search_pattern('tahini')) = 'tahini first, and more words after it', 'H0-a-match-at-the-start-has-no-leading-ellipsis');

-- 1: the word is in an older letter; the newest line does not hold it
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000001', 'vendor', 'v1@v.example', 'inbound', 'RECEIVED', interval '5 days', 'Hello,' || E'\n' || 'the tahini pallet' || E'\n' || 'arrives Friday.');
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000001', 'vendor', 'v1@v.example', 'inbound', 'RECEIVED', interval '1 day', 'Thanks, all good.');
-- 2: two letters hold it: the newest is quoted
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000002', 'vendor', 'v2@v.example', 'inbound', 'RECEIVED', interval '6 days', 'tahini ONE');
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000002', 'vendor', 'v2@v.example', 'inbound', 'RECEIVED', interval '2 days', 'tahini TWO');
-- 3: found only through a HOUSE_DRAFT: listed for an owner, never quoted
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000003', 'vendor', 'v3@v.example', 'inbound', 'RECEIVED', interval '3 days', 'Ok.');
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000003', 'vendor', 'v3@v.example', 'outbound', 'HOUSE_DRAFT', interval '1 day', 'A draft about tahini we never sent.');
-- 4: the house's own SENT letter holds it
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000004', 'vendor', 'v4@v.example', 'inbound', 'RECEIVED', interval '4 days', 'Ok.');
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000004', 'vendor', 'v4@v.example', 'outbound', 'SENT', interval '3 days', 'Please send tahini on Monday.');
-- 5: an auto-reply holds it: not a letter
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
VALUES (gen_random_uuid(), '71000000-0000-4000-8000-000000000001', '7a000000-0000-4000-8000-000000000005', 'vendor', 'v5@v.example', 'inbound', 'email', 'Out of office, tahini orders wait.', 'RECEIVED', 'gm:5',
        NULL, now() - interval '2 days', now() - interval '2 days', '{"transport":{"autoSubmitted":"true"}}'::jsonb);
SELECT pg_temp.letter('7a000000-0000-4000-8000-000000000005', 'vendor', 'v5@v.example', 'inbound', 'RECEIVED', interval '4 days', 'Real letter, no word.');
-- 6: a guest holds it; a team member's name matches the search but no letter does
SELECT pg_temp.letter(NULL, 'guest', 'guest@kitchen.example', 'inbound', 'RECEIVED', interval '2 days', 'Is the tahini gluten free?');
SELECT pg_temp.letter(NULL, 'guest', 'guest@kitchen.example', 'inbound', 'RECEIVED', interval '1 day', 'Thanks!');
SELECT pg_temp.letter(NULL, 'team', 'tahini.cook@kitchen.example', 'inbound', 'RECEIVED', interval '1 day', 'See you at nine.');

CREATE TEMP TABLE r AS SELECT * FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50, 'tahini', NULL, false);

SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000001') = 'Hello, the tahini pallet arrives Friday.', 'H1-the-words-of-the-older-letter-are-shown-collapsed');
SELECT pg_temp.ok((SELECT last_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000001') = 'Thanks, all good.', 'H1-the-row-keeps-its-own-newest-line');
SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000002') = 'tahini TWO', 'H2-the-newest-matching-letter-is-the-one-quoted');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000003') AND (SELECT hit_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000003') IS NULL, 'H3-a-draft-is-never-quoted');
SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000004') = 'Please send tahini on Monday.', 'H4-an-owner-is-quoted-a-sent-house-letter');
-- (the search itself still finds this person by the auto-reply's words, as before; it is only never quoted)
SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'vendor:7a000000-0000-4000-8000-000000000005') IS NULL, 'H5-an-auto-reply-is-never-quoted');
SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'guest:guest@kitchen.example') = 'Is the tahini gluten free?', 'H6-a-guest-is-quoted-their-older-letter');
SELECT pg_temp.ok((SELECT hit_line FROM r WHERE key = 'team:tahini.cook@kitchen.example') IS NULL
  AND EXISTS (SELECT 1 FROM r WHERE key = 'team:tahini.cook@kitchen.example'), 'H7-found-by-address-only-keeps-its-line');

-- no search: no snippet anywhere
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50) WHERE hit_line IS NOT NULL) = 0, 'H8-no-search-no-snippet');

-- staff (house letters withheld): quoted only what came in, and no team or guest row at all
CREATE TEMP TABLE s AS SELECT * FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', true, false, NULL, NULL, 50, 'tahini', NULL, false);
SELECT pg_temp.ok((SELECT hit_line FROM s WHERE key = 'vendor:7a000000-0000-4000-8000-000000000001') = 'Hello, the tahini pallet arrives Friday.', 'H9-staff-are-quoted-what-came-in');
-- the search finds vendor 4 for staff by the house's sent letter, as it always did; the row is never quoted that letter
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM s WHERE key = 'vendor:7a000000-0000-4000-8000-000000000004') AND (SELECT hit_line FROM s WHERE key = 'vendor:7a000000-0000-4000-8000-000000000004') IS NULL, 'H9-staff-are-never-quoted-a-house-letter');
-- a draft is withheld from staff altogether: it does not even find the person
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM s WHERE key = 'vendor:7a000000-0000-4000-8000-000000000003'), 'H9-staff-are-not-led-to-a-draft');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM s WHERE kind <> 'vendor') AND (SELECT count(*) FROM s WHERE hit_line IS NOT NULL AND hit_line ~* 'Monday|draft') = 0, 'H9-staff-get-no-team-guest-row-and-no-house-words');

-- another house's letters are never quoted
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
VALUES (gen_random_uuid(), '71000000-0000-4000-8000-000000000002', '7a000000-0000-4000-8000-000000000001', 'vendor', 'v1@v.example', 'inbound', 'email', 'tahini of ANOTHER house', 'RECEIVED', 'gm:o',
        NULL, now(), now(), '{}');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
VALUES (gen_random_uuid(), '71000000-0000-4000-8000-000000000002', NULL, 'guest', 'guest@kitchen.example', 'inbound', 'email', 'tahini, said the OTHER house', 'RECEIVED', 'gm:og',
        NULL, now(), now(), '{}');
SELECT pg_temp.ok((SELECT hit_line FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50, 'tahini', NULL, false) WHERE key = 'guest:guest@kitchen.example') = 'Is the tahini gluten free?', 'H10-another-houses-guest-is-never-quoted');
SELECT pg_temp.ok((SELECT hit_line FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50, 'tahini', NULL, false) WHERE key = 'vendor:7a000000-0000-4000-8000-000000000001') = 'Hello, the tahini pallet arrives Friday.', 'H10-another-house-is-never-quoted');

-- grants: service_role only
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_mail_people(uuid, boolean, boolean, timestamp with time zone, text, integer, text, text, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.mail_hit_line(text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.mail_hit_line(text, text)', 'EXECUTE'), 'H11-regranted-to-service-role-only');
rollback;
