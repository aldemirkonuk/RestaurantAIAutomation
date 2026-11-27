-- The Mail summary counts today's letters of every kind the caller may read
-- (migration the_mail_summary_counts_every_kind; r81 walk w1 finding 5).
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from
-- supabase/migrations. One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- House H (restaurants row must exist for the summary): one vendor letter in today, a guest in
-- today, a team letter in today and one out today, a guest letter from last week. House H2: a guest today.
INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('55555555-5555-4555-8555-555555555555', 'Summary H', 'summary-h-test', 'UTC'),
  ('66666666-6666-4666-8666-666666666666', 'Summary H2', 'summary-h2-test', 'UTC');
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a5000000-0000-4000-8000-0000000000a1', '55555555-5555-4555-8555-555555555555', 'c0000000-0000-4000-8000-000000000001', 'vendor', 'sales@v.example', 'inbound', 'email', 'Prices attached', 'RECEIVED', 'gm:v1', now(), NULL, now(), '{}'),
  ('a5000000-0000-4000-8000-0000000000b1', '55555555-5555-4555-8555-555555555555', NULL, 'guest', 'stranger@x.example', 'inbound', 'email', 'Can I book a table', 'DELIVERED', 'gm:g1', now(), NULL, now(), '{}'),
  ('a5000000-0000-4000-8000-0000000000c1', '55555555-5555-4555-8555-555555555555', NULL, 'team', 'deniz@h.example', 'inbound', 'email', 'Shift swap', 'DELIVERED', 'gm:t1', now(), NULL, now(), '{}'),
  ('a5000000-0000-4000-8000-0000000000c2', '55555555-5555-4555-8555-555555555555', NULL, 'team', 'deniz@h.example', 'outbound', 'email', 'Done', 'SENT', 'gm:t1', NULL, now(), now(), '{}'),
  ('a5000000-0000-4000-8000-0000000000b2', '55555555-5555-4555-8555-555555555555', NULL, 'guest', 'old@x.example', 'inbound', 'email', 'Last week', 'DELIVERED', 'gm:g2', now() - interval '7 days', NULL, now() - interval '7 days', '{}'),
  ('d5000000-0000-4000-8000-0000000000d1', '66666666-6666-4666-8666-666666666666', NULL, 'guest', 'other@x.example', 'inbound', 'email', 'Other house', 'DELIVERED', 'gm:o1', now(), NULL, now(), '{}');

-- An owner or manager (withhold false): the vendor letter, the guest and the team letter are in today; the team reply is out.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', false, 'UTC')) = 3, 'owner-in-today-counts-every-kind');
SELECT pg_temp.ok((SELECT out_today FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', false, 'UTC')) = 1, 'owner-out-today-counts-every-kind');
-- Staff (withhold true, also the default) count vendors only, as before.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', true, 'UTC')) = 1, 'staff-in-today-vendors-only');
SELECT pg_temp.ok((SELECT out_today FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', true, 'UTC')) = 0, 'staff-out-today-vendors-only');
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary(p_restaurant_id => '55555555-5555-4555-8555-555555555555', p_zone => 'UTC')) = 1, 'withholding-is-the-default');
-- Another house's letters never count here, and last week's is not today's.
SELECT pg_temp.ok((SELECT in_today FROM public.mail_inbox_summary('66666666-6666-4666-8666-666666666666', false, 'UTC')) = 1, 'another-house-counts-its-own');
-- With no zone the day has no midnight: NULL, never a count.
SELECT pg_temp.ok((SELECT in_today IS NULL AND out_today IS NULL FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', false, NULL)), 'no-zone-no-count');
-- What did not change: nobody non-vendor is waiting, and the 30-day figure is vendors'.
SELECT pg_temp.ok((SELECT waiting_people FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', false, 'UTC')) = 1, 'waiting-people-unchanged');
SELECT pg_temp.ok((SELECT in_30d FROM public.mail_inbox_summary('55555555-5555-4555-8555-555555555555', false, 'UTC')) = 1, 'in-30d-unchanged');
rollback;
