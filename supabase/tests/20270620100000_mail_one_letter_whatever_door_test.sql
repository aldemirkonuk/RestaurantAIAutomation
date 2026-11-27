-- One letter whatever door it came through; a vendor at postmaster@ is still
-- the vendor (migration mail_one_letter_whatever_door; QA round 22 on #946,
-- probes B3, B6, C6).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything is inside one transaction that is ROLLED BACK. Each check raises
-- 'FAIL <id>' or notices 'PASS <id>'; the run stops at the first failure.
-- Foreign keys to parent tables are dropped inside the transaction.
--
-- Fidelity: superuser, no RLS; synthetic rows only, production was not read.

\set ON_ERROR_STOP 1
begin;

ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_restaurant_id_fkey;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- Letters counted and whether the vendor is waiting on the house, staff view.
CREATE OR REPLACE FUNCTION pg_temp.st(p uuid, OUT n bigint, OUT w boolean) LANGUAGE sql AS $$
  SELECT COALESCE(sum(s.message_count), 0), COALESCE(bool_or(s.waiting), false)
  FROM public.mail_thread_states('22222222-2222-4222-8222-222222222222', true, p) s $$;

-- Every vendor: the house wrote at 10:00, mail came back at 10:05 (and 10:06).
CREATE OR REPLACE FUNCTION pg_temp.row(id text, p text, dir text, status text, at text, mid text, hdr jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.procurement_conversations
    (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key,
     received_at, sent_at, created_at, message_id, email_headers)
  VALUES (id::uuid, '22222222-2222-4222-8222-222222222222', p::uuid, dir, 'email', 'body ' || id, status,
          'gm:' || p, CASE WHEN dir = 'inbound' THEN at::timestamptz END,
          CASE WHEN dir = 'outbound' THEN at::timestamptz END, at::timestamptz, mid, hdr) $$;

INSERT INTO public.providers (id, restaurant_id, name, primary_contact, contact_email) VALUES
  ('d0000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', 'Small Winery',
   '{"name":"Anna"}', 'Postmaster@SmallWinery.example'),
  ('d0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Pm Wines',
   '{"name":"Ali","email":"sales@pmwines.example"}', NULL),
  ('d0000000-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', 'Book Only In Contact',
   '{"email":"postmaster@cellar.example"}', NULL);

-- D1 (QA B3): the Gmail door stores "<id>", the webhook door "id": one letter.
SELECT pg_temp.row('e1000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000001', 'outbound', 'SENT', '2027-02-01 10:00+00', NULL, '{}');
SELECT pg_temp.row('e1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'inbound', 'RECEIVED', '2027-02-01 10:05+00', '<Abc2@X.example>', '{"from":"Jo <jo@v1.example>"}');
SELECT pg_temp.row('e1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'inbound', 'RECEIVED', '2027-02-01 10:06+00', ' abc2@x.example ', '{"from":"Jo <jo@v1.example>"}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.ok(r.n = 2 AND r.w, 'D1 <id> and bare id through two doors are one letter (2 = ours + theirs), got ' || r.n);
END $$;

-- D2 (QA B6): the first copy stored was set aside; the live copy is the letter.
SELECT pg_temp.row('e2000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000002', 'outbound', 'SENT', '2027-02-01 10:00+00', NULL, '{}');
SELECT pg_temp.row('e2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'inbound', 'DISCARDED', '2027-02-01 10:05+00', '<disc@x.example>', '{"from":"Jo <jo@v2.example>"}');
SELECT pg_temp.row('e2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'inbound', 'RECEIVED', '2027-02-01 10:06+00', '<disc@x.example>', '{"from":"Jo <jo@v2.example>"}');
DO $$ DECLARE r record; d uuid[]; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.ok(r.n = 2 AND r.w, 'D2 a discarded first copy never hides the live copy: counted once and owed');
  SELECT array_agg(l.id) INTO d FROM public.mail_letter_rows('22222222-2222-4222-8222-222222222222', true, 'd0000000-0000-4000-8000-000000000002') l WHERE l.duplicate;
  PERFORM pg_temp.ok(d = ARRAY['e2000000-0000-4000-8000-000000000001'::uuid], 'D2b the discarded copy is the one marked duplicate');
END $$;

-- D2c (kept): both copies set aside: still one letter, owed by neither.
SELECT pg_temp.row('e2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000007', 'inbound', 'DISCARDED', '2027-02-01 10:05+00', '<both@x.example>', '{}');
SELECT pg_temp.row('e2000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000007', 'inbound', 'DISCARDED', '2027-02-01 10:06+00', '<both@x.example>', '{}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000007');
  PERFORM pg_temp.ok(r.n = 1 AND NOT r.w, 'D2c two discarded copies: one letter, nobody waiting');
END $$;

-- D3 (QA C6): a vendor whose book address IS postmaster@ writes. The bridge
-- flags the parsed From as a mail server; it is the vendor all the same.
-- Case differs from the book on purpose. Also a row stored before the flag.
SELECT pg_temp.row('e3000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000003', 'outbound', 'SENT', '2027-02-01 10:00+00', NULL, '{}');
SELECT pg_temp.row('e3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 'inbound', 'RECEIVED', '2027-02-01 10:05+00', '<pm1@x.example>',
  '{"from":"Anna Small Winery <postmaster@smallwinery.example>","transport":{"fromMailServer":true,"deliveryReport":false,"autoReplied":false}}');
SELECT pg_temp.row('e3000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 'inbound', 'RECEIVED', '2027-02-01 10:06+00', '<pm2@x.example>',
  '{"from":"postmaster@smallwinery.example"}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.ok(r.n = 3 AND r.w, 'D3 a vendor at its own postmaster@ address is a letter (flagged and legacy rows), got ' || r.n);
END $$;
-- D3b: the book address held only in primary_contact.email counts too.
SELECT pg_temp.row('e3000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000006', 'inbound', 'RECEIVED', '2027-02-01 10:05+00', '<pm3@x.example>',
  '{"from":"Cellar <postmaster@cellar.example>","transport":{"fromMailServer":true}}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000006');
  PERFORM pg_temp.ok(r.n = 1 AND r.w, 'D3b primary_contact.email is a book address too');
END $$;

-- D4 (kept): the same vendor's mail server bouncing is still automatic: a
-- postmaster@ that is not the book address, and a delivery report from the
-- book address itself.
SELECT pg_temp.row('e4000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000004', 'outbound', 'SENT', '2027-02-01 10:00+00', NULL, '{}');
SELECT pg_temp.row('e4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'inbound', 'RECEIVED', '2027-02-01 10:05+00', '<b1@x.example>',
  '{"from":"postmaster@pmwines.example","transport":{"fromMailServer":true}}');
SELECT pg_temp.row('e4000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003', 'inbound', 'RECEIVED', '2027-02-01 10:07+00', '<b2@x.example>',
  '{"from":"postmaster@smallwinery.example","transport":{"fromMailServer":true,"deliveryReport":true}}');
DO $$ DECLARE r record; a boolean; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.ok(r.n = 1 AND NOT r.w, 'D4 a postmaster@ that is not the book address is a bounce');
  SELECT l.automatic INTO a FROM public.mail_letter_rows('22222222-2222-4222-8222-222222222222', true, NULL) l
   WHERE l.id = 'e4000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.ok(a, 'D4b a delivery report from the book address is still automatic');
END $$;

-- D5 (kept, from 20270601090000): a DSN with no mail-server address but a
-- delivery report flag (QA C10/C11 shapes) is not a letter.
SELECT pg_temp.row('e5000000-0000-4000-8000-000000000000', 'd0000000-0000-4000-8000-000000000005', 'outbound', 'SENT', '2027-02-01 10:00+00', NULL, '{}');
SELECT pg_temp.row('e5000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'inbound', 'RECEIVED', '2027-02-01 10:05+00', '<dsn@x.example>',
  '{"from":"Mail Delivery System <noreply-dsn@google.example>","transport":{"fromMailServer":false,"deliveryReport":true}}');
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM pg_temp.st('d0000000-0000-4000-8000-000000000005');
  PERFORM pg_temp.ok(r.n = 1 AND NOT r.w, 'D5 a delivery report from any address is not a letter');
END $$;

rollback;
