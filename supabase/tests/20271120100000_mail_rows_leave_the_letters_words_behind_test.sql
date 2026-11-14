-- Mail's shared row read carries no letter's words, and every reader that
-- needs them still gets the same answer (migration
-- mail_rows_leave_the_letters_words_behind; r41 mail audit, gap 1).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything it writes is inside one transaction that is ROLLED BACK at the
-- end. Each check raises 'FAIL <id>' or notices 'PASS <id>'; the run stops at
-- the first failure. Foreign keys to the parent tables are dropped inside the
-- transaction so the rows need no vendor; the rollback restores them.
--
-- The broader proof that nothing else moved is in the PR body: every read of
-- two synthetic houses (2,000 and 12,000 letters) hashed before and after.
--
-- Fidelity: run as a superuser with no RLS; synthetic rows only, production
-- was not read.

\set ON_ERROR_STOP 1
begin;

ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- House W (UTC).
--   V1  w11 in   09:00  no subject header; its text starts "Subject: Spring list"
--       w12 out  10:00  header "Subject" (capital S): "Re: Spring list"
--   V2  w21 in   08:00  "Hello"
--       w22 out  11:00  a house draft holding the word "draftword" (withheld from staff)
--   V3  w31 in   08:30  Message-ID <copy@x>, "First copy"
--       w32 in   08:30  the same Message-ID, stored later: a second copy holding "copyword"
--   V4  w41 in   07:00  "Please send normalword prices"
INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('77777777-7777-4777-8777-777777777777', 'Words house', 'words-house-test', 'UTC');
INSERT INTO public.providers (id, name, primary_contact, restaurant_id) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'Words vendor one', '{}'::jsonb, '77777777-7777-4777-8777-777777777777'),
  ('d1000000-0000-4000-8000-000000000002', 'Words vendor two', '{}'::jsonb, '77777777-7777-4777-8777-777777777777'),
  ('d1000000-0000-4000-8000-000000000003', 'Words vendor three', '{}'::jsonb, '77777777-7777-4777-8777-777777777777'),
  ('d1000000-0000-4000-8000-000000000004', 'Words vendor four', '{}'::jsonb, '77777777-7777-4777-8777-777777777777');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, message_id, received_at, sent_at, created_at, email_headers) VALUES
  ('d2000000-0000-4000-8000-000000000011', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000001',
   'inbound', 'email', E'Subject: Spring list\n\nPrices attached.', NULL, 'gm:w1', '<w11@x>', '2027-03-01 09:00+00', NULL, '2027-03-01 09:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000012', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000001',
   'outbound', 'email', 'Thank you, we will order.', 'SENT', 'gm:w1', NULL, NULL, '2027-03-01 10:00+00', '2027-03-01 10:00+00', '{"Subject":"Re: Spring list"}'),
  ('d2000000-0000-4000-8000-000000000021', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'Hello', NULL, 'gm:w2', '<w21@x>', '2027-03-01 08:00+00', NULL, '2027-03-01 08:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000022', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000002',
   'outbound', 'email', 'A credit note: draftword', 'HOUSE_DRAFT', 'gm:w2', NULL, NULL, NULL, '2027-03-01 11:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000031', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'First copy', NULL, 'gm:w3', '<copy@x>', '2027-03-01 08:30+00', NULL, '2027-03-01 08:30+00', '{}'),
  ('d2000000-0000-4000-8000-000000000032', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000003',
   'inbound', 'email', 'Second copy: copyword', NULL, 'gm:w3', '<copy@x>', '2027-03-01 08:30+00', NULL, '2027-03-01 08:31+00', '{}'),
  ('d2000000-0000-4000-8000-000000000041', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000004',
   'inbound', 'email', 'Please send normalword prices', NULL, 'gm:w4', '<w41@x>', '2027-03-01 07:00+00', NULL, '2027-03-01 07:00+00', '{}');

-- W1: the shared row read names the subject and carries no words or headers.
DO $$ DECLARE res text; BEGIN
  SELECT pg_get_function_result('public.mail_letter_rows(uuid, boolean, uuid)'::regprocedure) INTO res;
  PERFORM pg_temp.ok(res LIKE '%subject text%', 'W1 mail_letter_rows names the subject');
  PERFORM pg_temp.ok(res NOT LIKE '%message_text%' AND res NOT LIKE '%email_headers%',
    'W1b mail_letter_rows carries no words or headers (got ' || res || ')');
END $$;

-- W2: the subject is the header's, either case, else the text's first Subject line.
DO $$ DECLARE a text; b text; BEGIN
  SELECT subject INTO a FROM public.mail_letter_rows('77777777-7777-4777-8777-777777777777', true, NULL)
   WHERE id = 'd2000000-0000-4000-8000-000000000011';
  SELECT subject INTO b FROM public.mail_letter_rows('77777777-7777-4777-8777-777777777777', true, NULL)
   WHERE id = 'd2000000-0000-4000-8000-000000000012';
  PERFORM pg_temp.ok(a = 'Spring list', 'W2 no header: the text''s Subject line (got ' || COALESCE(a, 'NULL') || ')');
  PERFORM pg_temp.ok(b = 'Re: Spring list', 'W2b the "Subject" header (got ' || COALESCE(b, 'NULL') || ')');
  SELECT subject INTO a FROM public.mail_thread_states('77777777-7777-4777-8777-777777777777', true, NULL)
   WHERE thread_key = 'gm:w1';
  PERFORM pg_temp.ok(a = 'Spring list', 'W2c the thread''s subject is its first letter''s');
  SELECT subject INTO a FROM public.list_mail_threads('77777777-7777-4777-8777-777777777777',
    'd1000000-0000-4000-8000-000000000001', true) WHERE thread_key = 'gm:w1';
  PERFORM pg_temp.ok(a = 'Spring list', 'W2d the thread row says it');
END $$;

-- W3: a thread page still carries each letter's whole words, its own.
DO $$ DECLARE ws text[]; s text; BEGIN
  SELECT array_agg(message_text ORDER BY at DESC, id DESC), max(thread_subject) INTO ws, s
    FROM public.mail_thread_letters('77777777-7777-4777-8777-777777777777', 'gm:w1',
      'd1000000-0000-4000-8000-000000000001', true);
  PERFORM pg_temp.ok(ws = ARRAY['Thank you, we will order.', E'Subject: Spring list\n\nPrices attached.'],
    'W3 each letter carries its own words');
  PERFORM pg_temp.ok(s = 'Spring list', 'W3b the page names the thread''s subject');
END $$;

-- W4: a page cut by (at, id) reads the older letter, with its words, once.
DO $$ DECLARE a record; b record; n int; BEGIN
  SELECT id, at, message_text INTO a
    FROM public.mail_thread_letters('77777777-7777-4777-8777-777777777777', 'gm:w1',
      'd1000000-0000-4000-8000-000000000001', true, NULL, NULL, 1);
  PERFORM pg_temp.ok(a.id = 'd2000000-0000-4000-8000-000000000012', 'W4 the first page is the newest letter');
  SELECT count(*) INTO n
    FROM public.mail_thread_letters('77777777-7777-4777-8777-777777777777', 'gm:w1',
      'd1000000-0000-4000-8000-000000000001', true, a.at, a.id, 5);
  SELECT id, message_text INTO b
    FROM public.mail_thread_letters('77777777-7777-4777-8777-777777777777', 'gm:w1',
      'd1000000-0000-4000-8000-000000000001', true, a.at, a.id, 5);
  PERFORM pg_temp.ok(n = 1 AND b.id = 'd2000000-0000-4000-8000-000000000011'
                     AND b.message_text = E'Subject: Spring list\n\nPrices attached.',
    'W4b the next page is the older letter alone, with its words');
END $$;

-- W5: a search finds a person by a word inside a letter.
DO $$ DECLARE ps uuid[]; BEGIN
  SELECT array_agg(provider_id) INTO ps
    FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', true, false, NULL, NULL, 50, 'normalword');
  PERFORM pg_temp.ok(ps = ARRAY['d1000000-0000-4000-8000-000000000004'::uuid], 'W5 a letter''s word finds its person');
END $$;

-- W6: a withheld letter's words never find anyone for staff; the owner's search reads them.
DO $$ DECLARE n int; ps uuid[]; BEGIN
  SELECT count(*) INTO n
    FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', true, false, NULL, NULL, 50, 'draftword');
  PERFORM pg_temp.ok(n = 0, 'W6 staff: a house draft''s words find no one');
  SELECT array_agg(provider_id) INTO ps
    FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 50, 'draftword');
  PERFORM pg_temp.ok(ps = ARRAY['d1000000-0000-4000-8000-000000000002'::uuid], 'W6b owner: the draft''s words find its person');
END $$;

-- W7: a second copy of a letter is not searched.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n
    FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 50, 'copyword');
  PERFORM pg_temp.ok(n = 0, 'W7 a second copy''s words find no one');
END $$;

-- W8: another house's letter is never searched.
INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('78787878-7878-4878-8878-787878787878', 'Other words house', 'other-words-house-test', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers) VALUES
  ('d2000000-0000-4000-8000-0000000000f1', '78787878-7878-4878-8878-787878787878', 'd1000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'otherhouseword', NULL, 'gm:wf', '2027-03-01 09:00+00', '2027-03-01 09:00+00', '{}');
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n
    FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 50, 'otherhouseword');
  PERFORM pg_temp.ok(n = 0, 'W8 another house''s words find no one here');
END $$;

-- W10: a person's unsent letter is the newest across their threads, read
-- through the thread states (the list no longer reads the rows twice).
--   V5  w51 in   06:00  a letter, so V5 is listed
--       w52 out  12:00  HOUSE_QUEUED  in thread gm:w5a
--       w53 out  13:00  SEND_REFUSED  in thread gm:w5b (newest unsent)
--       w54 out  14:00  HOUSE_CANCELLED in gm:w5a: newest of all, withheld from staff
--   V6  w61 out  05:00  HOUSE_QUEUED, its only letter
INSERT INTO public.providers (id, name, primary_contact, restaurant_id) VALUES
  ('d1000000-0000-4000-8000-000000000005', 'Words vendor five', '{}'::jsonb, '77777777-7777-4777-8777-777777777777'),
  ('d1000000-0000-4000-8000-000000000006', 'Words vendor six', '{}'::jsonb, '77777777-7777-4777-8777-777777777777');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('d2000000-0000-4000-8000-000000000051', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000005',
   'inbound', 'email', 'Hello', 'DELIVERED', 'gm:w5a', '2027-03-01 06:00+00', NULL, '2027-03-01 06:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000052', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000005',
   'outbound', 'email', 'Queued', 'HOUSE_QUEUED', 'gm:w5a', NULL, NULL, '2027-03-01 12:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000053', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000005',
   'outbound', 'email', 'Refused', 'SEND_REFUSED', 'gm:w5b', NULL, NULL, '2027-03-01 13:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000054', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000005',
   'outbound', 'email', 'Pulled back', 'HOUSE_CANCELLED', 'gm:w5a', NULL, NULL, '2027-03-01 14:00+00', '{}'),
  ('d2000000-0000-4000-8000-000000000061', '77777777-7777-4777-8777-777777777777', 'd1000000-0000-4000-8000-000000000006',
   'outbound', 'email', 'Only queued', 'HOUSE_QUEUED', 'gm:w6', NULL, NULL, '2027-03-01 05:00+00', '{}');

DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', true, false, NULL, NULL, 50, NULL)
   WHERE provider_id = 'd1000000-0000-4000-8000-000000000005';
  PERFORM pg_temp.ok(r.unsent_status = 'SEND_REFUSED', 'W10 staff: the newest unsent letter across threads (got '
    || COALESCE(r.unsent_status, 'NULL') || ')');
  SELECT * INTO r FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', false, false, NULL, NULL, 50, NULL)
   WHERE provider_id = 'd1000000-0000-4000-8000-000000000005';
  PERFORM pg_temp.ok(r.unsent_status = 'HOUSE_CANCELLED', 'W10b owner: the letter pulled back is the newest (got '
    || COALESCE(r.unsent_status, 'NULL') || ')');
  SELECT * INTO r FROM public.list_mail_people('77777777-7777-4777-8777-777777777777', true, false, NULL, NULL, 50, NULL)
   WHERE provider_id = 'd1000000-0000-4000-8000-000000000006';
  PERFORM pg_temp.ok(r.unsent_status = 'HOUSE_QUEUED' AND r.last_at = '2027-03-01 05:00+00' AND r.waiting IS FALSE
                     AND r.last_direction = 'outbound',
    'W10c a person whose only letter is queued is listed by it, never waiting');
  SELECT * INTO r FROM public.mail_thread_states('77777777-7777-4777-8777-777777777777', true, NULL)
   WHERE provider_id = 'd1000000-0000-4000-8000-000000000005' AND thread_key = 'gm:w5a';
  PERFORM pg_temp.ok(r.unsent_id = 'd2000000-0000-4000-8000-000000000052' AND r.unsent_status = 'HOUSE_QUEUED'
                     AND r.unsent_at = '2027-03-01 12:00+00' AND r.unsent_channel = 'email',
    'W10d a thread names its own newest unsent letter');
END $$;

-- W9: only the gateway's service role may call the row reads.
DO $$ BEGIN
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mail_letter_rows(uuid, boolean, uuid)', 'EXECUTE'),
    'W9 anon cannot call mail_letter_rows');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated', 'public.mail_letter_rows(uuid, boolean, uuid)', 'EXECUTE'),
    'W9b authenticated cannot call mail_letter_rows');
  PERFORM pg_temp.ok(has_function_privilege('service_role', 'public.mail_letter_rows(uuid, boolean, uuid)', 'EXECUTE'),
    'W9c the service role can');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon', 'public.mail_thread_states(uuid, boolean, uuid)', 'EXECUTE')
                     AND NOT has_function_privilege('authenticated', 'public.mail_thread_states(uuid, boolean, uuid)', 'EXECUTE')
                     AND has_function_privilege('service_role', 'public.mail_thread_states(uuid, boolean, uuid)', 'EXECUTE'),
    'W9d mail_thread_states is the service role''s alone');
END $$;

rollback;
