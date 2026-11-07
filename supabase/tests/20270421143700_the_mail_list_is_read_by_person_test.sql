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

rollback;
