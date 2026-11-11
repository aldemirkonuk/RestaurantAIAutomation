-- A letter's Message-ID is stored in one shape, `<id>` (migration
-- mail_message_id_one_shape; follow-up to #1014).
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

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

CREATE OR REPLACE FUNCTION pg_temp.row(id text, ord text, ch text, dir text, status text, mid text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.procurement_conversations
    (id, restaurant_id, provider_id, order_id, direction, channel, message_text, status, thread_key, message_id)
  VALUES (id::uuid, '33333333-3333-4333-8333-333333333333', 'd3000000-0000-4000-8000-000000000001',
          ord::uuid, dir, ch, 'body ' || id, status, 'gm:t-' || id, mid) $$;

CREATE OR REPLACE FUNCTION pg_temp.mid(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT c.message_id::text FROM public.procurement_conversations c WHERE c.id = p_id::uuid $$;

-- M0: the unique index the collision rule protects exists here, so M5/M6 test it.
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uniq_proc_conv_sent_message_id'),
                  'M0 uniq_proc_conv_sent_message_id exists');

-- Shapes, one row each (inbound, no order: outside the unique index).
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000001', NULL, 'email', 'inbound', 'RECEIVED', 'abc@x.example');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000002', NULL, 'email', 'inbound', 'RECEIVED', E' < Sp@x.example >\r\n');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000003', NULL, 'email', 'inbound', 'RECEIVED', 'junk <First@x.example> <second@x.example>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000004', NULL, 'email', 'inbound', 'RECEIVED', '<Already@X.example>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000005', NULL, 'whatsapp', 'inbound', 'RECEIVED', 'wamid.HBgLMTIzNDU2Nzg5MA==');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000006', NULL, 'email', 'inbound', 'RECEIVED', '   ');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000007', NULL, 'email', 'inbound', 'RECEIVED', '<>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000008', NULL, 'email', 'inbound', 'RECEIVED', '<unclosed@x.example');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000012', NULL, 'email', 'inbound', 'RECEIVED', '<"a b"@x.example>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000013', NULL, 'email', 'inbound', 'RECEIVED', '< >  <real@x.example>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000009', NULL, 'email', 'inbound', 'RECEIVED', repeat('a', 495) || '@x.ex');
-- Same letter through two doors, inbound (index does not apply): both become "<d@x>".
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000010', NULL, 'email', 'inbound', 'RECEIVED', '<d@x.example>');
SELECT pg_temp.row('f1000000-0000-4000-8000-000000000011', NULL, 'email', 'inbound', 'RECEIVED', 'd@x.example');

-- Sends inside the unique index.
-- M5: order A holds "<k@x>" and "k@x", both SENT: the bare one is left.
SELECT pg_temp.row('f5000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'email', 'outbound', 'SENT', 'k@x.example');
SELECT pg_temp.row('f5000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'email', 'outbound', 'SENT', '<k@x.example>');
-- M6: order B holds two bare spellings of one id: the lower id takes "<k2@x>".
SELECT pg_temp.row('f6000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b', 'email', 'outbound', 'AUTO_SENT', 'k2@x.example');
SELECT pg_temp.row('f6000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000b', 'email', 'outbound', 'SEND_UNCONFIRMED', ' k2@x.example ');
-- M7: the same bare id on two orders, both SENT: no collision, both rewritten.
SELECT pg_temp.row('f7000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'email', 'outbound', 'SENT', 'm7@x.example');
SELECT pg_temp.row('f7000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-00000000000c', 'email', 'outbound', 'SENT', 'm7@x.example');

DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.mail_message_ids_canonicalise();
  PERFORM pg_temp.ok(r.left_for_collision = 2, 'M1 two rows left for a collision (M5 + M6), got ' || r.left_for_collision);
END $$;

SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000001') = '<abc@x.example>', 'M2a bare id gains its brackets');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000002') = '<Sp@x.example>', 'M2b white space dropped, case kept');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000003') = '<First@x.example>', 'M2c first <...> token wins');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000004') = '<Already@X.example>', 'M2d canonical value untouched');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000005') = 'wamid.HBgLMTIzNDU2Nzg5MA==', 'M3 a WhatsApp wamid is never touched');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000006') IS NULL, 'M4a white space only is no id: NULL');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000007') IS NULL, 'M4b <> is no id: NULL');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000008') = '<unclosed@x.example>', 'M4c an unclosed bracket is repaired');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000012') = '<"a b"@x.example>', 'M4f a quoted id-left stays whole');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000013') = '<real@x.example>', 'M4g a blank <...> token is skipped');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000009') = repeat('a', 495) || '@x.ex', 'M4d a value that would outgrow varchar(500) is left');
SELECT pg_temp.ok(pg_temp.mid('f1000000-0000-4000-8000-000000000010') = '<d@x.example>'
                  AND pg_temp.mid('f1000000-0000-4000-8000-000000000011') = '<d@x.example>', 'M4e two doors, one stored value');
SELECT pg_temp.ok(pg_temp.mid('f5000000-0000-4000-8000-000000000001') = 'k@x.example'
                  AND pg_temp.mid('f5000000-0000-4000-8000-000000000002') = '<k@x.example>', 'M5 bare send beside its canonical twin is left');
SELECT pg_temp.ok(pg_temp.mid('f6000000-0000-4000-8000-000000000001') = '<k2@x.example>'
                  AND pg_temp.mid('f6000000-0000-4000-8000-000000000002') = ' k2@x.example ', 'M6 lower id takes the canonical value, the other is left');
SELECT pg_temp.ok(pg_temp.mid('f7000000-0000-4000-8000-000000000001') = '<m7@x.example>'
                  AND pg_temp.mid('f7000000-0000-4000-8000-000000000002') = '<m7@x.example>', 'M7 one id on two orders is no collision');

-- M8: idempotent. A second run rewrites nothing and still leaves the same two.
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM public.mail_message_ids_canonicalise();
  PERFORM pg_temp.ok(r.rewritten = 0 AND r.left_for_collision = 2,
                     'M8 second run rewrites 0 and leaves 2, got ' || r.rewritten || '/' || r.left_for_collision);
END $$;

-- M9: only the service role may run it.
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.mail_message_ids_canonicalise()', 'EXECUTE')
                  AND NOT has_function_privilege('anon', 'public.mail_message_ids_canonicalise()', 'EXECUTE'),
                  'M9 anon and authenticated cannot run the rewrite');

rollback;
