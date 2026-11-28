-- The house's own notes on a Mail thread (migration
-- a_thread_keeps_the_houses_own_notes; r110 mail-gap g5).
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
ALTER TABLE public.mail_thread_notes DROP CONSTRAINT IF EXISTS mail_thread_notes_restaurant_id_fkey;

CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- A statement that must be refused by a CHECK (23514); anything else fails.
CREATE OR REPLACE FUNCTION pg_temp.refused(stmt text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL % (was accepted)', label;
END $$;

DO $$
DECLARE
  h constant uuid := 'a0000000-0000-4000-8000-0000000000a1';
  v constant uuid := 'b0000000-0000-4000-8000-0000000000b1';
  w constant uuid := 'c0000000-0000-4000-8000-0000000000c1';
  pc uuid;
  n uuid;
BEGIN
  -- N1 the access posture: RLS on, no client grant of any kind.
  PERFORM pg_temp.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mail_thread_notes'::regclass), 'N1a RLS on');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.mail_thread_notes', 'SELECT'), 'N1b anon cannot read');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.mail_thread_notes', 'SELECT'), 'N1c authenticated cannot read');
  PERFORM pg_temp.ok(NOT has_table_privilege('authenticated', 'public.mail_thread_notes', 'INSERT'), 'N1d authenticated cannot write');
  PERFORM pg_temp.ok(NOT has_table_privilege('anon', 'public.mail_thread_notes', 'UPDATE'), 'N1e anon cannot update');
  PERFORM pg_temp.ok(has_table_privilege('service_role', 'public.mail_thread_notes', 'INSERT'), 'N1f the gateway writes');
  PERFORM pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.mail_thread_notes'::regclass), 'N1g no policy opens it');

  -- N2 a note belongs to the house, not a letter or a grant: no foreign key
  -- points anywhere but the house.
  PERFORM pg_temp.ok(
    (SELECT array_agg(confrelid::regclass::text ORDER BY 1) FROM pg_constraint
      WHERE conrelid = 'public.mail_thread_notes'::regclass AND contype = 'f') IS NULL,
    'N2 no foreign key to a letter or a grant (the house key is dropped for this run)');

  -- N3 a letter and its note; the letters going (retention deletes the row,
  -- revoke-by-provenance re-points or deletes it) leaves the note as it was.
  INSERT INTO public.procurement_conversations (restaurant_id, provider_id, thread_key, direction, channel, message_text)
  VALUES (h, v, 'gm:t1', 'inbound', 'email', 'Six cases on Friday')
  RETURNING id INTO pc;
  INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES (h, 'vendor:' || v, 'gm:t1', 'They promised a credit on the phone', w)
  RETURNING id INTO n;
  DELETE FROM public.procurement_conversations WHERE id = pc;
  PERFORM pg_temp.ok(
    (SELECT body = 'They promised a credit on the phone' AND deleted_at IS NULL
       FROM public.mail_thread_notes WHERE id = n),
    'N3 the letters going leaves the note');

  -- N4 what a note may hold.
  PERFORM pg_temp.ok(
    (SELECT count(*) = 1 FROM public.mail_thread_notes WHERE id = n), 'N4a stored once');
  INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES (h, 'vendor:' || v, 'gm:t1', repeat('a', 1000), w);
  PERFORM pg_temp.ok(true, 'N4b 1000 characters is a note');
  INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES (h, 'team:ayse@house.test', 'mid:x', 'Covered Friday', w);
  PERFORM pg_temp.ok(true, 'N4c a team thread keeps a note');
END $$;

SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'vendor:b0000000-0000-4000-8000-0000000000b1', 'gm:t1', repeat('a', 1001), 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5a 1001 characters is refused');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'vendor:b0000000-0000-4000-8000-0000000000b1', 'gm:t1', '', 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5b an empty note is refused');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'vendor:b0000000-0000-4000-8000-0000000000b1', 'gm:t1', ' padded ', 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5c an untrimmed note is refused');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'Vendor:B0000000-0000-4000-8000-0000000000B1', 'gm:t1', 'x', 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5d a person key not in lower case is refused');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'b0000000-0000-4000-8000-0000000000b1', 'gm:t1', 'x', 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5e a bare id is not a person key');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'vendor:b0000000-0000-4000-8000-0000000000b1', '', 'x', 'c0000000-0000-4000-8000-0000000000c1')$q$,
  'N5f a note names its thread');
SELECT pg_temp.refused($q$INSERT INTO public.mail_thread_notes (restaurant_id, person_key, thread_key, body, written_by, created_at, deleted_at)
  VALUES ('a0000000-0000-4000-8000-0000000000a1', 'vendor:b0000000-0000-4000-8000-0000000000b1', 'gm:t1', 'x', 'c0000000-0000-4000-8000-0000000000c1', now(), now() - interval '1 minute')$q$,
  'N5g a note is not deleted before it was written');

rollback;
