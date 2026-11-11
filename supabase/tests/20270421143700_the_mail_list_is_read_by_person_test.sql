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

-- ---------------------------------------------------------------------------
-- Round 21 (QA on #942): the first nine checks left a page free to leak another
-- thread, tie on the wrong side, borrow another house's order, or ignore its
-- cap. Each check below fails a named change to mail_thread_letters.
-- All ids and times are synthetic; V1 = ...0001, V2 = ...0002, house H.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;   -- no FKs for the order rows; reset below
INSERT INTO public.procurement_orders
  (id, order_number, restaurant_id, inventory_id, provider_id, quantity, bottles_total, final_price, total_cost, status) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'PO-OWN',   '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000001', 1, 1, 1, 1, 'SENT'),
  ('d2000000-0000-4000-8000-000000000002', 'PO-OTHER', '99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000001', 1, 1, 1, 1, 'SENT');
SET LOCAL session_replication_role = origin;

INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers, order_id, order_number_snapshot) VALUES
  -- t-other: V1's letter under a DIFFERENT key (must never ride along with gm:shared)
  ('a3000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Another thread', 'DELIVERED', 'gm:other', '2027-01-04 07:00+00', NULL, '2027-01-04 07:00+00', '{}', NULL, NULL),
  -- t-own: only V2 wrote under gm:own, but V1's earlier gm:other letter is the house's first from any vendor
  ('b3000000-0000-4000-8000-0000000000b3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'V2 alone here', 'DELIVERED', 'gm:own', '2027-01-08 09:00+00', NULL, '2027-01-08 09:00+00', '{}', NULL, NULL),
  -- t-tie: two vendors, same instant: the smaller id owns the bare key
  ('d3000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Tie V1', 'DELIVERED', 'gm:tiekey', '2027-01-09 09:00+00', NULL, '2027-01-09 09:00+00', '{}', NULL, NULL),
  ('d3000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'Tie V2', 'DELIVERED', 'gm:tiekey', '2027-01-09 09:00+00', NULL, '2027-01-09 09:00+00', '{}', NULL, NULL),
  -- t-page: four letters, three sharing one instant (ids c1 < c2 < c3), one older (c0)
  ('c1000000-0000-4000-8000-0000000000c0', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'older', 'DELIVERED', 'gm:page', '2027-01-10 08:00+00', NULL, '2027-01-10 08:00+00', '{}', NULL, NULL),
  ('c1000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'tie 1', 'DELIVERED', 'gm:page', '2027-01-10 11:00+00', NULL, '2027-01-10 11:00+00', '{}', NULL, NULL),
  ('c1000000-0000-4000-8000-0000000000c2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'tie 2', 'DELIVERED', 'gm:page', '2027-01-10 11:00+00', NULL, '2027-01-10 11:00+00', '{}', NULL, NULL),
  ('c1000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'tie 3', 'DELIVERED', 'gm:page', '2027-01-10 11:00+00', NULL, '2027-01-10 11:00+00', '{}', NULL, NULL),
  -- t-ordx: the letter names an order that belongs to ANOTHER house: only its own snapshot may speak
  ('e1000000-0000-4000-8000-0000000000e1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'foreign order', 'DELIVERED', 'gm:ordx', '2027-01-11 09:00+00', NULL, '2027-01-11 09:00+00', '{}',
   'd2000000-0000-4000-8000-000000000002', 'SNAP-X'),
  -- t-ordh: the letter names this house's own order: the live number and status speak
  ('e2000000-0000-4000-8000-0000000000e2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'own order', 'DELIVERED', 'gm:ordh', '2027-01-11 10:00+00', NULL, '2027-01-11 10:00+00', '{}',
   'd1000000-0000-4000-8000-000000000001', 'SNAP-STALE'),
  -- t-ordn: two letters name different (unknown) orders; the NEWEST one's order and snapshot are the thread's
  ('e3000000-0000-4000-8000-0000000000e3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'old order', 'DELIVERED', 'gm:ordn', '2027-01-12 08:00+00', NULL, '2027-01-12 08:00+00', '{}',
   'd4000000-0000-4000-8000-000000000004', 'S-OLD'),
  ('e3000000-0000-4000-8000-0000000000e4', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'new order', 'DELIVERED', 'gm:ordn', '2027-01-12 09:00+00', NULL, '2027-01-12 09:00+00', '{}',
   'd5000000-0000-4000-8000-000000000005', 'S-NEW'),
  -- t-subj: the first letter has no subject; the thread's subject is the first one that names one
  ('f1000000-0000-4000-8000-0000000000f1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'no subject here', 'DELIVERED', 'gm:subj', '2027-01-13 08:00+00', NULL, '2027-01-13 08:00+00', '{}', NULL, NULL),
  ('f1000000-0000-4000-8000-0000000000f2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'x', 'DELIVERED', 'gm:subj', '2027-01-13 09:00+00', NULL, '2027-01-13 09:00+00', '{"subject":"First named"}', NULL, NULL),
  ('f1000000-0000-4000-8000-0000000000f3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'y', 'DELIVERED', 'gm:subj', '2027-01-13 10:00+00', NULL, '2027-01-13 10:00+00', '{"subject":"Later named"}', NULL, NULL);

-- t-big: 520 letters under one key, one a minute
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, created_at, email_headers)
SELECT ('ab000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
       'inbound', 'email', 'bulk ' || i, 'DELIVERED', 'gm:big',
       timestamptz '2027-02-01 00:00+00' + (i || ' minutes')::interval,
       timestamptz '2027-02-01 00:00+00' + (i || ' minutes')::interval, '{}'::jsonb
FROM generate_series(1, 520) AS i;

-- T10: a page holds only its own thread, never the vendor's other threads.
DO $$ DECLARE ids uuid[]; n int; BEGIN
  SELECT array_agg(id) INTO ids FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:other');
  PERFORM pg_temp.ok(ids = ARRAY['a3000000-0000-4000-8000-0000000000a3'::uuid], 'T10 a thread page holds that thread only');
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:shared', 'c0000000-0000-4000-8000-000000000001', true)
   WHERE id = 'a3000000-0000-4000-8000-0000000000a3';
  PERFORM pg_temp.ok(n = 0, 'T10b a named vendor still reads one thread, not all their mail');
END $$;

-- T11: the vendor of a bare key is chosen among that key's letters, not the house's first mail.
DO $$ DECLARE vs uuid[]; BEGIN
  SELECT array_agg(DISTINCT provider_id) INTO vs FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:own');
  PERFORM pg_temp.ok(vs = ARRAY['c0000000-0000-4000-8000-000000000002'::uuid], 'T11 the owner is found among this key''s letters');
END $$;

-- T12: two vendors at the same instant: the smaller letter id owns the key, every time.
DO $$ DECLARE vs uuid[]; BEGIN
  SELECT array_agg(DISTINCT provider_id) INTO vs FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:tiekey');
  PERFORM pg_temp.ok(vs = ARRAY['c0000000-0000-4000-8000-000000000001'::uuid], 'T12 a tie for the key goes to the smaller id');
END $$;

-- T13: keyset paging through a tie: each letter once, none repeated, none skipped, in both directions.
DO $$ DECLARE ids uuid[]; BEGIN
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:page') WITH ORDINALITY AS t;
  PERFORM pg_temp.ok(ids = ARRAY['c1000000-0000-4000-8000-0000000000c3'::uuid, 'c1000000-0000-4000-8000-0000000000c2'::uuid,
                                 'c1000000-0000-4000-8000-0000000000c1'::uuid, 'c1000000-0000-4000-8000-0000000000c0'::uuid],
                     'T13 a tie reads newest id first');
  SELECT array_agg(id ORDER BY ordinality) INTO ids FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:page',
    NULL, true, '2027-01-10 11:00+00', 'c1000000-0000-4000-8000-0000000000c2') WITH ORDINALITY AS t;
  PERFORM pg_temp.ok(ids = ARRAY['c1000000-0000-4000-8000-0000000000c1'::uuid, 'c1000000-0000-4000-8000-0000000000c0'::uuid],
                     'T13b after a tie letter come the smaller ids, then older time, never a bigger id');
  SELECT array_agg(id) INTO ids FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:page',
    NULL, true, '2027-01-10 08:00+00', 'c1000000-0000-4000-8000-0000000000c0');
  PERFORM pg_temp.ok(ids IS NULL, 'T13c the oldest letter is the end of the thread');
END $$;

-- T14: another house's order never names a thread; the letter's own snapshot does.
DO $$ DECLARE r record; BEGIN
  SELECT order_number, order_status INTO r FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:ordx') LIMIT 1;
  PERFORM pg_temp.ok(r.order_number = 'SNAP-X' AND r.order_status IS NULL, 'T14 a foreign house''s order is not read');
  SELECT order_number, order_status INTO r FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:ordh') LIMIT 1;
  PERFORM pg_temp.ok(r.order_number = 'PO-OWN' AND r.order_status = 'SENT', 'T14b this house''s order speaks live, over its snapshot');
END $$;

-- T15: the thread's order is the newest letter's that names one.
DO $$ DECLARE r record; BEGIN
  SELECT order_id, order_number INTO r FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:ordn') LIMIT 1;
  PERFORM pg_temp.ok(r.order_id = 'd5000000-0000-4000-8000-000000000005'::uuid AND r.order_number = 'S-NEW',
                     'T15 newest letter''s order and snapshot name the thread');
END $$;

-- T16: the subject is the first letter's that names one, skipping an earlier blank.
DO $$ DECLARE s text; BEGIN
  SELECT DISTINCT thread_subject INTO s FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:subj');
  PERFORM pg_temp.ok(s = 'First named', 'T16 subject is the first one named');
END $$;

-- T17: the page size: 51 by default, at most 501 whatever is asked, at least 1.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:big');
  PERFORM pg_temp.ok(n = 51, 'T17 default page is 51 letters');
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:big', NULL, true, NULL, NULL, NULL);
  PERFORM pg_temp.ok(n = 51, 'T17b a null limit is the default');
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:big', NULL, true, NULL, NULL, 100000);
  PERFORM pg_temp.ok(n = 501, 'T17c the cap is 501');
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:big', NULL, true, NULL, NULL, 0);
  PERFORM pg_temp.ok(n = 1, 'T17d a limit of 0 still returns one letter');
  SELECT count(*) INTO n FROM public.mail_thread_letters('11111111-1111-4111-8111-111111111111', 'gm:big', NULL, true, NULL, NULL, 7);
  PERFORM pg_temp.ok(n = 7, 'T17e a limit inside the range is honoured');
END $$;

rollback;
