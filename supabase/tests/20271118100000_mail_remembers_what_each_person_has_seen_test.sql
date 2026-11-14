-- What each person has seen in Mail (migration
-- mail_remembers_what_each_person_has_seen; r36 mail gap 6).
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
ALTER TABLE public.mail_thread_seen DROP CONSTRAINT IF EXISTS mail_thread_seen_restaurant_id_fkey;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- House H, vendor V1 with threads t:one and t:two, vendor V2 with t:one too.
--   a1  V1 t:one inbound  09:00
--   a2  V1 t:one outbound 10:00
--   a3  V1 t:one inbound  11:00.123456   (the newest letter of t:one)
--   a4  V1 t:one draft    12:00          (not a letter: never counts as seen)
--   c1  V1 t:two inbound  08:00
--   b1  V2 t:one inbound  13:00
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, status, thread_key, received_at, sent_at, created_at, email_headers) VALUES
  ('a0000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Prices attached', 'DELIVERED', 't:one', '2027-01-05 09:00+00', NULL, '2027-01-05 09:00+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000a2', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'outbound', 'email', 'Thank you', 'SENT', 't:one', NULL, '2027-01-05 10:00+00', '2027-01-05 10:00+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000a3', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'One more thing', 'DELIVERED', 't:one', '2027-01-05 11:00:00.123456+00', NULL, '2027-01-05 11:00:00.123456+00', '{}'),
  ('a0000000-0000-4000-8000-0000000000a4', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'outbound', 'email', 'Draft', 'HOUSE_DRAFT', 't:one', NULL, NULL, '2027-01-05 12:00+00', '{}'),
  ('c0000000-0000-4000-8000-0000000000c1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'inbound', 'email', 'Older thread', 'DELIVERED', 't:two', '2027-01-05 08:00+00', NULL, '2027-01-05 08:00+00', '{}'),
  ('b0000000-0000-4000-8000-0000000000b1', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000002',
   'inbound', 'email', 'Other vendor', 'DELIVERED', 't:one', '2027-01-05 13:00+00', NULL, '2027-01-05 13:00+00', '{}');

-- S1: a mark is never later than the thread's newest letter, even when the
-- caller names a later time (and the draft at 12:00 is not a letter).
DO $$ DECLARE kept timestamptz; BEGIN
  kept := public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 't:one', '2027-02-01 00:00+00');
  PERFORM pg_temp.ok(kept = '2027-01-05 11:00:00.123456+00'::timestamptz, 'S1 kept at the newest letter, microseconds and all');
END $$;

-- S2: an earlier mark never moves a kept time back.
DO $$ DECLARE kept timestamptz; BEGIN
  kept := public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 't:one', '2027-01-05 09:00+00');
  PERFORM pg_temp.ok(kept = '2027-01-05 11:00:00.123456+00'::timestamptz, 'S2 an earlier mark keeps the later time');
END $$;

-- S3: a letter the screen did not show stays unseen: marking through 10:00
-- on a fresh person keeps 10:00, not the 11:00 letter.
DO $$ DECLARE kept timestamptz; BEGIN
  kept := public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000002',
            'c0000000-0000-4000-8000-000000000001', 't:one', '2027-01-05 10:00+00');
  PERFORM pg_temp.ok(kept = '2027-01-05 10:00+00'::timestamptz, 'S3 kept at the letter shown, not the newer one');
END $$;

-- S4: a thread this vendor does not have in this house, or another house,
-- or no person: nothing kept.
DO $$ BEGIN
  PERFORM pg_temp.ok(public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000002', 't:two', now()) IS NULL, 'S4a another vendor''s thread key');
  PERFORM pg_temp.ok(public.mail_thread_mark_seen('99999999-9999-4999-8999-999999999999', 'eeeeeeee-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 't:one', now()) IS NULL, 'S4b another house');
  PERFORM pg_temp.ok(public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', NULL,
            'c0000000-0000-4000-8000-000000000001', 't:one', now()) IS NULL, 'S4c no person');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mail_thread_seen
                                  WHERE restaurant_id = '99999999-9999-4999-8999-999999999999'
                                     OR provider_id = 'c0000000-0000-4000-8000-000000000002'), 'S4d no row written');
END $$;

-- S5: per vendor, the latest time over its threads, for that person only.
DO $$ DECLARE n int; v timestamptz; BEGIN
  PERFORM public.mail_thread_mark_seen('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001',
            'c0000000-0000-4000-8000-000000000001', 't:two', now());
  SELECT count(*), max(s.seen_through) INTO n, v
    FROM public.mail_seen_through_by_person('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000001',
           ARRAY['c0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid]) s;
  PERFORM pg_temp.ok(n = 1, 'S5a one row per vendor with a mark; none for a vendor never opened');
  PERFORM pg_temp.ok(v = '2027-01-05 11:00:00.123456+00'::timestamptz, 'S5b the latest over the vendor''s threads');
  SELECT max(s.seen_through) INTO v
    FROM public.mail_seen_through_by_person('11111111-1111-4111-8111-111111111111', 'eeeeeeee-0000-4000-8000-000000000002',
           ARRAY['c0000000-0000-4000-8000-000000000001'::uuid]) s;
  PERFORM pg_temp.ok(v = '2027-01-05 10:00+00'::timestamptz, 'S5c another person reads their own marks');
END $$;

-- S6: browsers cannot reach the table or the functions.
DO $$ BEGIN
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.mail_thread_seen', 'SELECT'), 'S6a no table read for authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('authenticated',
    'public.mail_thread_mark_seen(uuid, uuid, uuid, text, timestamp with time zone)', 'EXECUTE'), 'S6b no mark for authenticated');
  PERFORM pg_temp.ok(NOT has_function_privilege('anon',
    'public.mail_seen_through_by_person(uuid, uuid, uuid[])', 'EXECUTE'), 'S6c no read for anon');
END $$;

rollback;
