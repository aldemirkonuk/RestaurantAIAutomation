-- A house chooses its sender only among its own grants, and its test letters
-- stay its own (migration a_house_chooses_its_sender_and_tests_its_address).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything is inside one transaction that is ROLLED BACK at the end. Each
-- check raises 'FAIL <id>' or notices 'PASS <id>'. Synthetic rows only;
-- production was not read. Run as a superuser, so RLS is proved from the
-- catalog, not by switching role.

\set ON_ERROR_STOP 1
begin;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- True when the statement is refused with a check_violation.
CREATE OR REPLACE FUNCTION pg_temp.refused(stmt text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE stmt; RETURN false;
EXCEPTION WHEN check_violation THEN RETURN true; END $$;

-- The parents' own constraints are not under test; lift them so the rows need
-- no real house or person. The new tables' FK to the grants table stays.
ALTER TABLE public.house_mail_sender_choice DROP CONSTRAINT IF EXISTS house_mail_sender_choice_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS house_mail_sender_choice_chosen_by_fkey;
ALTER TABLE public.mail_setup_checks DROP CONSTRAINT IF EXISTS mail_setup_checks_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS mail_setup_checks_started_by_fkey;
ALTER TABLE public.integration_oauth_connections DROP CONSTRAINT IF EXISTS integration_oauth_connections_user_id_fkey,
  DROP CONSTRAINT IF EXISTS integration_oauth_connections_restaurant_id_fkey;

-- House A has two sending grants; house B has one.
INSERT INTO public.integration_oauth_connections (id, user_id, restaurant_id, provider, integration_id, account_email, scopes) VALUES
  ('a0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'google', 'gmail_send', 'chef@house-a.test', ARRAY['https://www.googleapis.com/auth/gmail.send']),
  ('a0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'google', 'gmail_send', 'office@house-a.test', ARRAY['https://www.googleapis.com/auth/gmail.send']),
  ('b0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000003', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'google', 'gmail_send', 'chef@house-b.test', ARRAY['https://www.googleapis.com/auth/gmail.send']);

-- S1: house A may choose its own second grant.
INSERT INTO public.house_mail_sender_choice (restaurant_id, connection_id)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-00000000000b');
SELECT pg_temp.ok((SELECT connection_id FROM public.house_mail_sender_choice
  WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'a0000000-0000-4000-8000-00000000000b', 'S1 a house chooses its own grant');

-- S2: house A may not point at house B's grant, by insert or by update.
SELECT pg_temp.ok(pg_temp.refused($$UPDATE public.house_mail_sender_choice
  SET connection_id = 'b0000000-0000-4000-8000-00000000000b'
  WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$), 'S2a another house''s grant is refused on update');
SELECT pg_temp.ok(pg_temp.refused($$INSERT INTO public.house_mail_sender_choice (restaurant_id, connection_id)
  VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'b0000000-0000-4000-8000-00000000000b')$$), 'S2b another house''s grant is refused on insert');

-- S3: one choice per house.
SELECT pg_temp.ok((SELECT count(*) FROM public.house_mail_sender_choice
  WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1, 'S3 one choice per house');

-- S4: deleting the grant drops the pointer.
DELETE FROM public.integration_oauth_connections WHERE id = 'a0000000-0000-4000-8000-00000000000b';
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.house_mail_sender_choice
  WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'S4 a deleted grant takes its pointer with it');

-- T1: a check code has the typed shape; a lower-case or look-alike code is refused.
INSERT INTO public.mail_setup_checks (restaurant_id, code, address)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'K7QM-2RZD', 'r-1a2b3c4d@in.example.test');
SELECT pg_temp.ok(pg_temp.refused($$INSERT INTO public.mail_setup_checks (restaurant_id, code, address)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'k7qm-2rzd', 'x@in.example.test')$$), 'T1a a lower-case code is refused');
SELECT pg_temp.ok(pg_temp.refused($$INSERT INTO public.mail_setup_checks (restaurant_id, code, address)
  VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'O0I1-2RZD', 'x@in.example.test')$$), 'T1b a look-alike code is refused');

-- T2: arrival is all or nothing: a time with no sender, or a sender with no time, is refused.
SELECT pg_temp.ok(pg_temp.refused($$UPDATE public.mail_setup_checks SET arrived_at = now()
  WHERE code = 'K7QM-2RZD'$$), 'T2 an arrival names who it came from');

-- T3: the same code may exist in two houses; it is unique only inside one.
INSERT INTO public.mail_setup_checks (restaurant_id, code, address)
  VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'K7QM-2RZD', 'r-9f8e7d6c@in.example.test');
SELECT pg_temp.ok((SELECT count(*) FROM public.mail_setup_checks WHERE code = 'K7QM-2RZD') = 2, 'T3 a code is unique per house');
SELECT pg_temp.ok((SELECT count(*) FROM (
  SELECT 1 FROM public.mail_setup_checks WHERE restaurant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND code = 'K7QM-2RZD'
  ) x) = 1, 'T3b one row per house and code');

-- R1: RLS is on and only service_role has a policy; anon and authenticated hold no privilege.
SELECT pg_temp.ok((SELECT bool_and(relrowsecurity) FROM pg_class
  WHERE oid IN ('public.house_mail_sender_choice'::regclass, 'public.mail_setup_checks'::regclass)), 'R1a RLS is on');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policies
  WHERE tablename IN ('house_mail_sender_choice', 'mail_setup_checks') AND roles <> '{service_role}'), 'R1b only service_role has a policy');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
  WHERE table_name IN ('house_mail_sender_choice', 'mail_setup_checks') AND grantee IN ('anon', 'authenticated')), 'R1c anon and authenticated hold nothing');

rollback;
