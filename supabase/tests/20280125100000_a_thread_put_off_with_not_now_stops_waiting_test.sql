-- "Not now" (r110 mail): a thread put off is not waiting anywhere until its time or a newer letter.
-- Run: psql -v ON_ERROR_STOP=1 -f <this file>, against a database built from supabase/migrations.
-- One transaction, rolled back; synthetic rows only. now() is the transaction's, so times are fixed.
begin;
ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;
ALTER TABLE public.mail_thread_snoozes DROP CONSTRAINT IF EXISTS mail_thread_snoozes_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS mail_thread_snoozes_provider_id_fkey;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

INSERT INTO public.restaurants (id, name, slug, timezone) VALUES
  ('72000000-0000-4000-8000-000000000001', 'Not now house', 'not-now-house-test', 'UTC'),
  ('72000000-0000-4000-8000-000000000002', 'Other house', 'not-now-other-test', 'UTC');
-- House 1: vendors 1..6 each wrote two hours ago and wait; 5 and 6 share one Gmail thread key.
-- House 2: vendor 9 waits.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key,
   received_at, created_at)
SELECT gen_random_uuid(), ('72000000-0000-4000-8000-00000000000' || v.house)::uuid,
       ('7b000000-0000-4000-8000-00000000000' || v.n)::uuid, 'vendor', 'v' || v.n || '@v.example',
       'inbound', 'email', 'Can you confirm?', 'RECEIVED', v.k, now() - interval '2 hours', now() - interval '2 hours'
FROM (VALUES (1, 1, 'gm:1'), (1, 2, 'gm:2'), (1, 3, 'gm:3'), (1, 4, 'gm:4'),
             (1, 5, 'gm:shared'), (1, 6, 'gm:shared'), (2, 9, 'gm:9')) v(house, n, k);

CREATE FUNCTION pg_temp.v(p_n int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('7b000000-0000-4000-8000-00000000000' || p_n)::uuid $$;
CREATE FUNCTION pg_temp.waits(p_n int) RETURNS boolean LANGUAGE sql AS $$
  SELECT waiting FROM public.list_mail_people('72000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50)
  WHERE key = 'vendor:' || pg_temp.v(p_n)::text $$;
CREATE FUNCTION pg_temp.badge() RETURNS int LANGUAGE sql AS $$
  SELECT waiting_people FROM public.mail_inbox_summary('72000000-0000-4000-8000-000000000001', false, NULL) $$;
CREATE FUNCTION pg_temp.state(p_n int, p_k text) RETURNS text LANGUAGE sql AS $$
  SELECT state FROM public.mail_thread_snooze_rows('72000000-0000-4000-8000-000000000001', ARRAY[pg_temp.v(p_n)])
  WHERE thread_key = p_k $$;

CREATE TEMP TABLE before AS SELECT pg_temp.badge() AS n;
SELECT pg_temp.ok((SELECT n FROM before) = 6, 'six-wait-before');

SELECT public.set_mail_thread_snooze('72000000-0000-4000-8000-000000000001', pg_temp.v(k.n), k.key,
                                     now() + interval '1 day', NULL)
FROM (VALUES (1, 'gm:1'), (2, 'gm:2'), (3, 'gm:3'), (4, 'gm:4'), (5, 'gm:shared')) k(n, key);

-- 1: put off, and the letter it was put off over was already known: not waiting anywhere.
SELECT pg_temp.ok(pg_temp.waits(1) IS FALSE, 'put-off-is-not-waiting-on-the-list');
SELECT pg_temp.ok(pg_temp.state(1, 'gm:1') = 'on', 'put-off-reads-on');
SELECT pg_temp.ok((SELECT waiting_since FROM public.list_mail_people('72000000-0000-4000-8000-000000000001', false, false, NULL, NULL, 50)
  WHERE key = 'vendor:' || pg_temp.v(1)::text) IS NULL, 'put-off-has-no-waiting-since');
SELECT pg_temp.ok(NOT (SELECT waiting FROM public.list_mail_threads('72000000-0000-4000-8000-000000000001', pg_temp.v(1), false)
  WHERE thread_key = 'gm:1'), 'put-off-is-not-waiting-on-the-thread-row');
-- Staff read the same rule.
SELECT pg_temp.ok((SELECT waiting FROM public.list_mail_people('72000000-0000-4000-8000-000000000001', true, false, NULL, NULL, 50)
  WHERE key = 'vendor:' || pg_temp.v(1)::text) IS FALSE, 'staff-read-the-same-rule');

-- 2: its time came: waiting again, and it says it came back.
UPDATE public.mail_thread_snoozes SET until = now() - interval '1 minute'
WHERE restaurant_id = '72000000-0000-4000-8000-000000000001' AND provider_id = pg_temp.v(2);
SELECT pg_temp.ok(pg_temp.waits(2), 'its-time-came-it-waits');
SELECT pg_temp.ok(pg_temp.state(2, 'gm:2') = 'back', 'its-time-came-it-reads-back');

-- 3: the vendor wrote again after it was put off: waiting at once, not "back".
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at)
VALUES (gen_random_uuid(), '72000000-0000-4000-8000-000000000001', pg_temp.v(3), 'vendor', 'v3@v.example',
        'inbound', 'email', 'Hello again', 'RECEIVED', 'gm:3', now(), now());
SELECT pg_temp.ok(pg_temp.waits(3), 'a-newer-letter-ends-it');
SELECT pg_temp.ok(pg_temp.state(3, 'gm:3') = 'ended', 'a-newer-letter-reads-ended');

-- 4: a letter received before the click but stored after it (the mirror is late) was never
-- seen: it ends the wait too.
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, kind, from_address, direction, channel, message_text, status, thread_key, received_at, created_at)
VALUES (gen_random_uuid(), '72000000-0000-4000-8000-000000000001', pg_temp.v(4), 'vendor', 'v4@v.example',
        'inbound', 'email', 'Late copy', 'RECEIVED', 'gm:4', now() - interval '1 hour', now());
SELECT pg_temp.ok(pg_temp.waits(4), 'a-letter-the-mirror-brought-late-ends-it');

-- 5 and 6 share a Gmail thread key: putting 5 off never puts off 6.
SELECT pg_temp.ok(pg_temp.waits(5) IS FALSE AND pg_temp.waits(6), 'one-key-two-vendors-is-two-threads');

-- The badge (and the tab title, which reads it) dropped by exactly the two still put off: 1 and 5.
SELECT pg_temp.ok(pg_temp.badge() = (SELECT n FROM before) - 2, 'the-badge-drops-by-exactly-the-put-off');

-- Another house's thread, a key nobody holds, a vendor of the key's other thread: refused.
CREATE FUNCTION pg_temp.raises(p_sql text, p_code text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE = p_code; END $$;
SELECT pg_temp.ok(pg_temp.raises(format('SELECT public.set_mail_thread_snooze(%L, %L, %L, now() + interval ''1 hour'', NULL)',
  '72000000-0000-4000-8000-000000000001', pg_temp.v(9), 'gm:9'), 'P0002'), 'another-houses-thread-is-refused');
SELECT pg_temp.ok(pg_temp.raises(format('SELECT public.set_mail_thread_snooze(%L, %L, %L, now() + interval ''1 hour'', NULL)',
  '72000000-0000-4000-8000-000000000002', pg_temp.v(1), 'gm:1'), 'P0002'), 'another-house-cannot-put-off-ours');
SELECT pg_temp.ok(pg_temp.raises(format('SELECT public.set_mail_thread_snooze(%L, %L, %L, now() + interval ''1 hour'', NULL)',
  '72000000-0000-4000-8000-000000000001', pg_temp.v(1), 'gm:nobody'), 'P0002'), 'a-key-nobody-holds-is-refused');
SELECT pg_temp.ok(pg_temp.raises(format('SELECT public.set_mail_thread_snooze(%L, %L, %L, now() - interval ''1 minute'', NULL)',
  '72000000-0000-4000-8000-000000000001', pg_temp.v(6), 'gm:shared'), '22023'), 'a-time-already-past-is-refused');
SELECT pg_temp.ok(pg_temp.raises(format('SELECT public.set_mail_thread_snooze(%L, %L, %L, now() + interval ''9 days'', NULL)',
  '72000000-0000-4000-8000-000000000001', pg_temp.v(6), 'gm:shared'), '22023'), 'more-than-eight-days-is-refused');
-- House 2's own view is untouched by house 1's snoozes.
SELECT pg_temp.ok((SELECT waiting_people FROM public.mail_inbox_summary('72000000-0000-4000-8000-000000000002', false, NULL)) = 1,
  'other-house-badge-untouched');

-- Undo: cleared by house 1 only; another house's clear touches nothing.
SELECT pg_temp.ok(NOT public.clear_mail_thread_snooze('72000000-0000-4000-8000-000000000002', pg_temp.v(1), 'gm:1'),
  'another-house-cannot-clear-ours');
SELECT pg_temp.ok(public.clear_mail_thread_snooze('72000000-0000-4000-8000-000000000001', pg_temp.v(1), 'gm:1')
  AND pg_temp.waits(1), 'undo-makes-it-wait-again');

-- No client role reads or calls any of it.
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.mail_thread_snoozes', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.mail_thread_snoozes', 'SELECT')
  AND NOT has_function_privilege('authenticated', 'public.set_mail_thread_snooze(uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.mail_thread_snoozed(timestamptz, timestamptz, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.mail_thread_snooze_rows(uuid, uuid[])', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.set_mail_thread_snooze(uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.mail_thread_states(uuid, boolean, uuid)', 'EXECUTE'),
  'grants-service-role-only');
rollback;
