-- A reply joins the thread of the letter it answers (migration
-- a_reply_joins_its_letters_thread; r39 walk-w6 F1).
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

-- An inbound letter of house A with no Gmail thread (it came through the
-- house's Mudavym address). The key is left for the trigger to choose.
CREATE OR REPLACE FUNCTION pg_temp.letter(p_id text, p_mid text, p_headers jsonb, p_text text, p_at timestamptz)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.procurement_conversations
    (id, restaurant_id, provider_id, direction, channel, message_text, gmail_thread_id,
     message_id, email_headers, thread_key, created_at)
  VALUES (p_id::uuid, 'a0000000-0000-4000-8000-00000000000a'::uuid,
          'd3000000-0000-4000-8000-000000000001', 'INBOUND', 'email', p_text, NULL,
          p_mid, COALESCE(p_headers, '{}'::jsonb), NULL, p_at) $$;

CREATE OR REPLACE FUNCTION pg_temp.key(p_id text) RETURNS text LANGUAGE sql AS $$
  SELECT c.thread_key FROM public.procurement_conversations c WHERE c.id = p_id::uuid $$;

-- ── T1: root, then a reply naming its Message-ID: one thread ──────────────
-- The root carries a Message-ID and no In-Reply-To or References, so it is
-- keyed by its subject; the reply names the root's Message-ID.
SELECT pg_temp.letter('21000000-0000-4000-8000-000000000001', '<root-1@vendor.example>',
                      '{"subject":"Octopus this weekend"}', 'Octopus is in', '2026-11-10 09:00+00');
SELECT pg_temp.ok(pg_temp.key('21000000-0000-4000-8000-000000000001') LIKE 'subj:%',
                  'T1a a root letter with a Message-ID and no references is keyed by its subject');
SELECT pg_temp.letter('21000000-0000-4000-8000-000000000002', '<reply-1@house.example>',
                      '{"subject":"Re: Octopus this weekend","in_reply_to":"<root-1@vendor.example>","references":"<root-1@vendor.example>"}',
                      'How much?', '2026-11-10 10:00+00');
SELECT pg_temp.ok(pg_temp.key('21000000-0000-4000-8000-000000000002') = pg_temp.key('21000000-0000-4000-8000-000000000001'),
                  'T1b the reply joins the root''s thread');
-- A reply to the reply, naming only the reply's Message-ID.
SELECT pg_temp.letter('21000000-0000-4000-8000-000000000003', '<root-2@vendor.example>',
                      '{"subject":"Re: Re: Octopus this weekend","in_reply_to":"<reply-1@house.example>"}',
                      'Twelve a kilo', '2026-11-10 11:00+00');
SELECT pg_temp.ok(
  (SELECT count(DISTINCT thread_key) FROM public.procurement_conversations
   WHERE id IN ('21000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000002',
                '21000000-0000-4000-8000-000000000003')) = 1,
  'T1c the root and both replies are one thread');

-- ── T2: an In-Reply-To no stored letter carries: the subject decides ─────
-- The reply answers a letter the house never stored. It has the root's
-- subject, so it falls back to the subject and meets the root there.
SELECT pg_temp.letter('22000000-0000-4000-8000-000000000001', '<root-3@vendor.example>',
                      '{"subject":"Lemons on Friday"}', 'Lemons are in', '2026-11-11 09:00+00');
SELECT pg_temp.letter('22000000-0000-4000-8000-000000000002', '<reply-3@vendor.example>',
                      '{"subject":"RE: Lemons on Friday","in_reply_to":"<never-stored@vendor.example>"}',
                      'Sorry, short', '2026-11-11 10:00+00');
SELECT pg_temp.ok(pg_temp.key('22000000-0000-4000-8000-000000000002') = pg_temp.key('22000000-0000-4000-8000-000000000001'),
                  'T2a an unknown In-Reply-To falls back to the subject and joins the root');
-- No subject to fall back on: the cited id is the key, as before.
SELECT pg_temp.letter('22000000-0000-4000-8000-000000000003', NULL,
                      '{"in_reply_to":"<never-stored@vendor.example>"}', 'no subject here', '2026-11-11 11:00+00');
SELECT pg_temp.ok(pg_temp.key('22000000-0000-4000-8000-000000000003') = 'mid:never-stored@vendor.example',
                  'T2b an unknown In-Reply-To with no subject keeps the cited id as its key');

-- ── T3: two different subjects are two threads ───────────────────────────
SELECT pg_temp.letter('23000000-0000-4000-8000-000000000001', '<root-4@vendor.example>',
                      '{"subject":"Eggs on Monday"}', 'Eggs', '2026-11-12 09:00+00');
SELECT pg_temp.letter('23000000-0000-4000-8000-000000000002', '<root-5@vendor.example>',
                      '{"subject":"Flour on Tuesday"}', 'Flour', '2026-11-12 10:00+00');
SELECT pg_temp.ok(pg_temp.key('23000000-0000-4000-8000-000000000001') <> pg_temp.key('23000000-0000-4000-8000-000000000002'),
                  'T3a two letters with different subjects are two threads');
-- An unknown In-Reply-To with a different subject does not join the others.
SELECT pg_temp.letter('23000000-0000-4000-8000-000000000003', '<reply-6@vendor.example>',
                      '{"subject":"Re: Salt on Wednesday","in_reply_to":"<never-stored-2@vendor.example>"}',
                      'Salt', '2026-11-12 11:00+00');
SELECT pg_temp.ok(
  pg_temp.key('23000000-0000-4000-8000-000000000003') <> pg_temp.key('23000000-0000-4000-8000-000000000001')
  AND pg_temp.key('23000000-0000-4000-8000-000000000003') <> pg_temp.key('23000000-0000-4000-8000-000000000002'),
  'T3b an unknown In-Reply-To with a third subject is a third thread');

-- ── T4: a Gmail thread still decides first ──────────────────────────────
SELECT pg_temp.letter('24000000-0000-4000-8000-000000000001', '<root-7@vendor.example>',
                      '{"subject":"Lemons on Friday"}', 'again', '2026-11-13 09:00+00');
UPDATE public.procurement_conversations SET gmail_thread_id = '19abc' WHERE id = '24000000-0000-4000-8000-000000000001';
INSERT INTO public.procurement_conversations
  (id, restaurant_id, provider_id, direction, channel, message_text, gmail_thread_id, message_id, email_headers, thread_key, created_at)
VALUES ('24000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
        'd3000000-0000-4000-8000-000000000001', 'INBOUND', 'email', 'in gmail', '19zzz', '<g-1@vendor.example>',
        '{"subject":"Re: Lemons on Friday","in_reply_to":"<never-stored@vendor.example>"}', NULL, '2026-11-13 10:00+00');
SELECT pg_temp.ok(pg_temp.key('24000000-0000-4000-8000-000000000002') = 'gm:19zzz',
                  'T4 a letter with its own Gmail thread keeps the Gmail key, not the subject');

rollback;
