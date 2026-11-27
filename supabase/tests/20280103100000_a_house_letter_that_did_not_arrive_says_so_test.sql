-- A house letter that did not arrive says so (r109 mail-gap g1): list_mail_people's unsent_status.
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- Vendors 1..7 of house 1, vendor 9 of house 2. mark: the delivery state the house reader wrote, or none.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   sent_at, received_at, created_at, email_headers)
SELECT gen_random_uuid(), v.house::uuid, ('7a000000-0000-4000-8000-00000000000' || v.n)::uuid,
       'vendor', 'v' || v.n || '@v.example', v.dir, 'email', 'Letter', v.st, 'gm:' || v.n,
       CASE WHEN v.dir = 'outbound' AND v.st IN ('SENT', 'AUTO_SENT', 'SEND_UNCONFIRMED') THEN now() - v.ago END,
       CASE WHEN v.dir = 'inbound' THEN now() - v.ago END, now() - v.ago,
       CASE WHEN v.mark IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('delivery', jsonb_build_object('state', v.mark, 'status', '5.1.1', 'recipient', 'v' || v.n || '@v.example')) END
FROM (VALUES
  -- 1 the house's newest letter did not arrive
  ('71000000-0000-4000-8000-000000000001', 1, 'outbound', 'SENT', interval '2 days', 'did_not_arrive'),
  -- ... and a newer draft carrying a copy of the mark, which never left: it hides nothing
  ('71000000-0000-4000-8000-000000000001', 1, 'outbound', 'HOUSE_DRAFT', interval '1 hour', 'did_not_arrive'),
  -- 2 only delayed: Gmail is still trying
  ('71000000-0000-4000-8000-000000000001', 2, 'outbound', 'SENT', interval '2 days', 'delayed'),
  -- 3 did not arrive, and the vendor wrote after it
  ('71000000-0000-4000-8000-000000000001', 3, 'outbound', 'SENT', interval '3 days', 'did_not_arrive'),
  ('71000000-0000-4000-8000-000000000001', 3, 'inbound', 'RECEIVED', interval '1 day', NULL),
  -- 4 did not arrive, then a later letter left
  ('71000000-0000-4000-8000-000000000001', 4, 'outbound', 'AUTO_SENT', interval '5 days', 'did_not_arrive'),
  ('71000000-0000-4000-8000-000000000001', 4, 'outbound', 'SENT', interval '1 day', NULL),
  -- 5 did not arrive five days ago: not "No answer yet"
  ('71000000-0000-4000-8000-000000000001', 5, 'outbound', 'SENT', interval '5 days', 'did_not_arrive'),
  -- 6 left five days ago with no notice: "No answer yet" as before
  ('71000000-0000-4000-8000-000000000001', 6, 'outbound', 'SENT', interval '5 days', NULL),
  -- 7 did not arrive, then a letter still queued: the queued one is named
  ('71000000-0000-4000-8000-000000000001', 7, 'outbound', 'SENT', interval '3 days', 'did_not_arrive'),
  ('71000000-0000-4000-8000-000000000001', 7, 'outbound', 'HOUSE_QUEUED', interval '1 hour', NULL),
  -- 8 its leaving was never confirmed, and a notice came back: it left, and did not arrive
  ('71000000-0000-4000-8000-000000000001', 8, 'outbound', 'SEND_UNCONFIRMED', interval '2 days', 'did_not_arrive'),
  -- 9 another house's letter that did not arrive
  ('71000000-0000-4000-8000-000000000002', 9, 'outbound', 'SENT', interval '2 days', 'did_not_arrive')
) v(house, n, dir, st, ago, mark);

CREATE TEMP TABLE l AS
SELECT * FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50);
CREATE FUNCTION pg_temp.st(p_n int) RETURNS text LANGUAGE sql AS $$
  SELECT unsent_status FROM l WHERE key = 'vendor:7a000000-0000-4000-8000-00000000000' || p_n $$;

SELECT pg_temp.ok(pg_temp.st(1) = 'did_not_arrive', 'newest-letter-that-did-not-arrive-is-named');
SELECT pg_temp.ok(pg_temp.st(2) IS NULL, 'a-delay-is-never-named');
SELECT pg_temp.ok(pg_temp.st(3) IS NULL, 'an-answer-after-it-ends-it');
SELECT pg_temp.ok(pg_temp.st(4) IS NULL, 'a-later-letter-that-left-ends-it');
SELECT pg_temp.ok(pg_temp.st(5) = 'did_not_arrive', 'old-one-still-named');
SELECT pg_temp.ok(pg_temp.st(7) = 'HOUSE_QUEUED', 'a-newer-queued-letter-is-named-first');
SELECT pg_temp.ok(pg_temp.st(8) = 'did_not_arrive', 'an-unconfirmed-letter-a-notice-came-back-for-is-named');
SELECT pg_temp.ok((SELECT awaiting_since FROM l WHERE key = 'vendor:7a000000-0000-4000-8000-000000000005') IS NULL
  AND (SELECT awaiting_since FROM l WHERE key = 'vendor:7a000000-0000-4000-8000-000000000006') IS NOT NULL,
  'a-letter-that-did-not-arrive-awaits-no-answer');
SELECT pg_temp.ok((SELECT count(*) FROM l) = 8, 'house-one-lists-its-eight');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM l WHERE key = 'vendor:7a000000-0000-4000-8000-000000000009'), 'other-house-never-returned');
SELECT pg_temp.ok((SELECT unsent_status FROM public.list_mail_people('71000000-0000-4000-8000-000000000002', false, false, NULL, NULL, 50)
  WHERE key = 'vendor:7a000000-0000-4000-8000-000000000009') = 'did_not_arrive', 'other-house-sees-its-own');
-- Staff see it as they see the letter (only drafts and cancelled letters are withheld from them).
SELECT pg_temp.ok((SELECT unsent_status FROM public.list_mail_people('71000000-0000-4000-8000-000000000001', true, false, NULL, NULL, 50)
  WHERE key = 'vendor:7a000000-0000-4000-8000-000000000001') = 'did_not_arrive', 'staff-see-it-as-they-see-the-letter');
-- The grants are the ones 20271229100000 gave.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.list_mail_vendors(uuid, boolean, boolean, timestamp with time zone, text, integer, text, boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.list_mail_vendors(uuid, boolean, boolean, timestamp with time zone, text, integer, text, boolean)', 'EXECUTE'),
  'grants-kept');
rollback;
