-- One conversation is one thread (migration one_conversation_is_one_thread;
-- r28 mail audit, gap 1).
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

-- A letter. house: 'A' or 'B'; key NULL lets the trigger choose.
CREATE OR REPLACE FUNCTION pg_temp.letter(p_id text, p_house text, p_dir text, p_gm text,
                                          p_mid text, p_headers jsonb, p_text text, p_key text,
                                          p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.procurement_conversations
    (id, restaurant_id, provider_id, direction, channel, message_text, gmail_thread_id,
     message_id, email_headers, thread_key, created_at)
  VALUES (p_id::uuid,
          CASE p_house WHEN 'A' THEN 'a0000000-0000-4000-8000-00000000000a'
                       ELSE 'b0000000-0000-4000-8000-00000000000b' END::uuid,
          'd3000000-0000-4000-8000-000000000001', p_dir, 'email', p_text, p_gm,
          p_mid, COALESCE(p_headers, '{}'::jsonb), p_key, p_at) $$;

CREATE OR REPLACE FUNCTION pg_temp.key(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT c.thread_key FROM public.procurement_conversations c WHERE c.id = p_id::uuid $$;

-- ── T1: the r28 probe lifecycle ────────────────────────────────────────────
-- The order letter is stored unsent, then the send writes its Gmail thread
-- and Message-ID; the vendor answers once through the house reader (same
-- Gmail thread) and once through the Mudavym address (no Gmail thread).
SELECT pg_temp.letter('11000000-0000-4000-8000-000000000001', 'A', 'OUTBOUND', NULL, NULL, '{}',
                      E'Subject: Order PO-12\nPlease send', NULL, '2026-11-01 10:00+00');
SELECT pg_temp.ok(pg_temp.key('11000000-0000-4000-8000-000000000001') LIKE 'subj:%',
                  'T1a an unsent order letter is keyed by its subject, as before');
UPDATE public.procurement_conversations
   SET gmail_thread_id = '18c0ffee', message_id = '<out-1@mail.gmail.com>'
 WHERE id = '11000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok(pg_temp.key('11000000-0000-4000-8000-000000000001') = 'gm:18c0ffee',
                  'T1b the send gives a key nobody else carries its Gmail thread');
SELECT pg_temp.letter('11000000-0000-4000-8000-000000000002', 'A', 'INBOUND', '18c0ffee', '<in-1@vendor.example>',
                      '{"subject":"Re: Order PO-12","in_reply_to":"<out-1@mail.gmail.com>","references":"<out-1@mail.gmail.com>"}',
                      'Confirmed', NULL, '2026-11-01 11:00+00');
SELECT pg_temp.letter('11000000-0000-4000-8000-000000000003', 'A', 'INBOUND', NULL, '<in-2@vendor.example>',
                      '{"subject":"Re: Order PO-12","in_reply_to":"<out-1@mail.gmail.com>","references":"<out-1@mail.gmail.com>"}',
                      'Confirmed by relay', NULL, '2026-11-01 12:00+00');
SELECT pg_temp.ok(
  (SELECT count(DISTINCT thread_key) FROM public.procurement_conversations
   WHERE id IN ('11000000-0000-4000-8000-000000000001', '11000000-0000-4000-8000-000000000002',
                '11000000-0000-4000-8000-000000000003')) = 1,
  'T1c the letter and both answers are one thread');

-- The vendor answers the relay answer's own Message-ID: still the same thread.
SELECT pg_temp.letter('11000000-0000-4000-8000-000000000004', 'A', 'INBOUND', NULL, NULL,
                      '{"in_reply_to":"in-2@vendor.example"}', 'And one more', NULL, '2026-11-01 13:00+00');
SELECT pg_temp.ok(pg_temp.key('11000000-0000-4000-8000-000000000004') = 'gm:18c0ffee',
                  'T1d an answer to an answer joins too, and a bare In-Reply-To is read');

-- ── T2: two houses never share a thread through this rule ─────────────────
SELECT pg_temp.letter('12000000-0000-4000-8000-000000000001', 'B', 'INBOUND', '18c0ffee', NULL, '{}',
                      'House B, same Gmail id', NULL, '2026-11-01 14:00+00');
SELECT pg_temp.letter('12000000-0000-4000-8000-000000000002', 'B', 'INBOUND', NULL, NULL,
                      '{"in_reply_to":"<out-1@mail.gmail.com>"}', 'House B answers house A''s id',
                      NULL, '2026-11-01 14:30+00');
SELECT pg_temp.ok(pg_temp.key('12000000-0000-4000-8000-000000000002') = 'mid:out-1@mail.gmail.com',
                  'T2a a letter of house B does not join house A''s thread by Message-ID');
UPDATE public.procurement_conversations SET thread_key = 'own:b1'
 WHERE id = '12000000-0000-4000-8000-000000000001';
SELECT pg_temp.letter('12000000-0000-4000-8000-000000000003', 'B', 'INBOUND', '18c0ffee', NULL, '{}',
                      'House B again', NULL, '2026-11-01 15:00+00');
SELECT pg_temp.ok(pg_temp.key('12000000-0000-4000-8000-000000000003') = 'own:b1',
                  'T2b a Gmail thread is joined inside the house: house B''s earliest, not house A''s');

-- ── T3: a key the writer sets is kept ─────────────────────────────────────
SELECT pg_temp.letter('13000000-0000-4000-8000-000000000001', 'A', 'INBOUND', '18c0ffee', NULL, '{}',
                      'Explicit key', 'manual:x', '2026-11-01 16:00+00');
SELECT pg_temp.ok(pg_temp.key('13000000-0000-4000-8000-000000000001') = 'manual:x',
                  'T3a an insert that sets a key keeps it');
SELECT pg_temp.letter('13000000-0000-4000-8000-000000000002', 'A', 'OUTBOUND', NULL, NULL, '{}',
                      'Staged, then sent with a key of its own', NULL, '2026-11-01 16:10+00');
UPDATE public.procurement_conversations SET gmail_thread_id = '18c0ffee', thread_key = 'manual:y'
 WHERE id = '13000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok(pg_temp.key('13000000-0000-4000-8000-000000000002') = 'manual:y',
                  'T3b an update that sets a key keeps it');

-- ── T4: a letter sent into a Gmail thread the house already holds ─────────
-- The question already joined an older thread, so its key is not gm:aa11.
SELECT pg_temp.letter('14000000-0000-4000-8000-000000000001', 'A', 'INBOUND', 'aa11', '<q-1@vendor.example>', '{}',
                      'A vendor question', 'k:q', '2026-11-02 09:00+00');
SELECT pg_temp.letter('14000000-0000-4000-8000-000000000002', 'A', 'OUTBOUND', NULL, NULL, '{}',
                      'Our answer, staged with no headers', NULL, '2026-11-02 09:05+00');
SELECT pg_temp.ok(pg_temp.key('14000000-0000-4000-8000-000000000002') LIKE 'msg:%',
                  'T4a a staged letter with nothing to join keys itself');
UPDATE public.procurement_conversations SET gmail_thread_id = 'aa11'
 WHERE id = '14000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok(pg_temp.key('14000000-0000-4000-8000-000000000002') = 'k:q',
                  'T4b sent into the vendor''s Gmail thread, it joins that thread');

-- ── T5: a subject is not a link; an answer is ──────────────────────────
-- Two order letters to one vendor share a subject key while staged.
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000001', 'A', 'OUTBOUND', NULL, NULL, '{}',
                      E'Subject: Price list\nfirst', NULL, '2026-11-03 09:00+00');
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000002', 'A', 'OUTBOUND', NULL, NULL, '{}',
                      E'Subject: Price list\nsecond', NULL, '2026-11-03 09:01+00');
SELECT pg_temp.ok(pg_temp.key('15000000-0000-4000-8000-000000000002') = pg_temp.key('15000000-0000-4000-8000-000000000001'),
                  'T5a staged, the two share their subject key, as before');
UPDATE public.procurement_conversations SET gmail_thread_id = 'bb22'
 WHERE id = '15000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok(pg_temp.key('15000000-0000-4000-8000-000000000002') = 'gm:bb22'
                  AND pg_temp.key('15000000-0000-4000-8000-000000000001') LIKE 'subj:%',
                  'T5b sent, the second leaves the shared subject for its own Gmail thread');
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000003', 'A', 'INBOUND', 'bb22', NULL, '{}',
                      'Their answer', NULL, '2026-11-03 10:00+00');
SELECT pg_temp.ok(pg_temp.key('15000000-0000-4000-8000-000000000003') = 'gm:bb22',
                  'T5c the answer in that Gmail thread joins it');
-- The house answers a relay letter (no Gmail thread) and its send opens a new
-- Gmail thread: it stays with the letter it answers.
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000004', 'A', 'INBOUND', NULL, '<relay-q@vendor.example>', '{}',
                      E'Subject: Delivery day\nThursday?', 'k:relay', '2026-11-03 11:00+00');
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000005', 'A', 'OUTBOUND', NULL, NULL,
                      '{"in_reply_to":"<relay-q@vendor.example>"}', 'Thursday is fine', NULL, '2026-11-03 11:05+00');
UPDATE public.procurement_conversations SET gmail_thread_id = 'ee55', message_id = '<ans@mail.gmail.com>'
 WHERE id = '15000000-0000-4000-8000-000000000005';
SELECT pg_temp.ok(pg_temp.key('15000000-0000-4000-8000-000000000005') = 'k:relay',
                  'T5d a sent answer stays in the thread of the letter it answers');
SELECT pg_temp.letter('15000000-0000-4000-8000-000000000006', 'A', 'INBOUND', 'ee55', NULL, '{}',
                      'Their reply in the new Gmail thread', NULL, '2026-11-03 12:00+00');
SELECT pg_temp.ok(pg_temp.key('15000000-0000-4000-8000-000000000006') = 'k:relay',
                  'T5e and the reply in that new Gmail thread joins it too');

-- ── T6: In-Reply-To is nearer than References ─────────────────────────────
SELECT pg_temp.letter('16000000-0000-4000-8000-000000000001', 'A', 'OUTBOUND', NULL, '<r-1@house.example>', '{}',
                      'one', 'k:one', '2026-11-04 09:00+00');
SELECT pg_temp.letter('16000000-0000-4000-8000-000000000002', 'A', 'OUTBOUND', NULL, 'r-2@house.example', '{}',
                      'two, stored bare', 'k:two', '2026-11-04 09:01+00');
SELECT pg_temp.letter('16000000-0000-4000-8000-000000000003', 'A', 'INBOUND', NULL, NULL,
                      '{"in_reply_to":"<r-2@house.example>","references":"<r-1@house.example> <r-2@house.example>"}',
                      'answers two', NULL, '2026-11-04 10:00+00');
SELECT pg_temp.ok(pg_temp.key('16000000-0000-4000-8000-000000000003') = 'k:two',
                  'T6a the letter it answers, found though stored without brackets');
SELECT pg_temp.letter('16000000-0000-4000-8000-000000000004', 'A', 'INBOUND', NULL, NULL,
                      '{"references":"<r-1@house.example> <r-2@house.example> <gone@nowhere.example>"}',
                      'references only', NULL, '2026-11-04 10:01+00');
SELECT pg_temp.ok(pg_temp.key('16000000-0000-4000-8000-000000000004') = 'k:two',
                  'T6b References are read newest first, past one not stored');

SELECT pg_temp.ok(public.mail_answered_message_ids(
    '{"in_reply_to":"<b@x>","references":"<a@x> <b@x> <c@x>"}') = ARRAY['b@x','c@x','a@x'],
  'T6c answered ids: In-Reply-To, then References newest first, no repeats');

-- ── T7: letters already split are joined, once ───────────────────────────
-- Old rows, keyed the way the old trigger keyed them (keys set explicitly).
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000001', 'A', 'OUTBOUND', 'cc33', '<old-1@mail.gmail.com>', '{}',
                      'old letter', 'subj:old', '2026-10-01 09:00+00');
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000002', 'A', 'INBOUND', 'cc33', NULL,
                      '{"in_reply_to":"<old-1@mail.gmail.com>"}', 'old answer, house reader', 'gm:cc33', '2026-10-01 10:00+00');
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000003', 'A', 'INBOUND', NULL, '<old-in@vendor.example>',
                      '{"in_reply_to":"<old-1@mail.gmail.com>"}', 'old answer, relay', 'mid:old-1@mail.gmail.com', '2026-10-01 11:00+00');
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000004', 'A', 'INBOUND', NULL, NULL,
                      '{"in_reply_to":"<old-in@vendor.example>"}', 'answer to the relay answer', 'mid:old-in@vendor.example', '2026-10-01 12:00+00');
-- House B row answering house A's old letter: stays its own.
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000005', 'B', 'INBOUND', 'cc33', NULL,
                      '{"in_reply_to":"<old-1@mail.gmail.com>"}', 'house B', 'b:own', '2026-10-01 12:30+00');
-- An unrelated single letter.
SELECT pg_temp.letter('17000000-0000-4000-8000-000000000006', 'A', 'OUTBOUND', 'dd44', NULL, '{}',
                      'alone', 'subj:alone', '2026-10-01 13:00+00');

CREATE TEMP TABLE t7_run AS SELECT * FROM public.mail_threads_rejoin();
SELECT pg_temp.ok(
  (SELECT count(DISTINCT thread_key) FROM public.procurement_conversations
   WHERE id::text LIKE '17000000-%' AND restaurant_id = 'a0000000-0000-4000-8000-00000000000a'
     AND id <> '17000000-0000-4000-8000-000000000006') = 1
  AND pg_temp.key('17000000-0000-4000-8000-000000000001') = 'gm:cc33',
  'T7a the split letters are one thread, under the earliest letter''s Gmail thread');
SELECT pg_temp.ok(pg_temp.key('17000000-0000-4000-8000-000000000005') = 'b:own',
                  'T7b house B''s letter is not joined to house A''s');
SELECT pg_temp.ok(pg_temp.key('17000000-0000-4000-8000-000000000006') = 'subj:alone',
                  'T7c a letter with one key is not touched');
SELECT pg_temp.ok(pg_temp.key('13000000-0000-4000-8000-000000000001') = 'gm:18c0ffee'
                  AND pg_temp.key('13000000-0000-4000-8000-000000000002') = 'gm:18c0ffee',
                  'T7d letters set apart by hand in a Gmail thread are joined too');
SELECT pg_temp.ok((SELECT letters_rekeyed FROM t7_run) >= 4 AND (SELECT threads_joined FROM t7_run) >= 2,
                  'T7e the run says what it joined');
SELECT pg_temp.ok((SELECT letters_rekeyed FROM public.mail_threads_rejoin()) = 0,
                  'T7f a second run finds nothing to join');

-- ── T8: the function is for the service role only ────────────────────────
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.mail_threads_rejoin()', 'EXECUTE'),
                  'T8a a signed-in person cannot run the rejoin');

rollback;
