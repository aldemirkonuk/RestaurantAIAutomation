-- The Mail people search matches the names the list shows (r104 mail fixer, finding 6 on #2043).
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
ALTER TABLE public.users DISABLE TRIGGER USER;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_restaurant_id_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('a1000000-0000-4000-8000-000000000003', 'Names H', 'names-h-test', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a6000000-0000-4000-8000-0000000000e1', 'a1000000-0000-4000-8000-000000000003', NULL, 'guest', 'j@x.example', 'inbound', 'email', 'Table?', 'DELIVERED', 'gm:j', now(), NULL, now(), '{"from": "Jane Roe <j@x.example>"}'),
  ('a6000000-0000-4000-8000-0000000000e2', 'a1000000-0000-4000-8000-000000000003', NULL, 'team', 'sam@h.example', 'inbound', 'email', 'Shift?', 'DELIVERED', 'gm:s', now(), NULL, now(), '{}');
INSERT INTO public.users (user_id, email, name, role, restaurant_id) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'Sam@H.Example', 'Sam Staff', 'staff', 'a1000000-0000-4000-8000-000000000003');

SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('a1000000-0000-4000-8000-000000000003', false, false, NULL, NULL, 50, 'Jane Roe', NULL)) = 1, 'a-guest-is-found-by-the-name-shown');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('a1000000-0000-4000-8000-000000000003', false, false, NULL, NULL, 50, 'sam staff', NULL)) = 1, 'a-team-member-is-found-by-the-roster-name');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('a1000000-0000-4000-8000-000000000003', false, false, NULL, NULL, 50, 'nobody here', NULL)) = 0, 'a-name-nobody-has-finds-nobody');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_mail_people('a1000000-0000-4000-8000-000000000003', false, false, NULL, NULL, 50, 'x.example', NULL)) = 1, 'the-address-still-finds-them');
rollback;
