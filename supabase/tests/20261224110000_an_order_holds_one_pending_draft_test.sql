-- An order holds one waiting draft (ADR 0266, F-106 PR-3; migration
-- an_order_holds_one_pending_draft).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything it writes is inside one transaction that is ROLLED BACK. Each
-- check raises 'FAIL <id>' or notices 'PASS <id>'.
--
-- What this file can test is the state AFTER the migration: the index, and
-- that the PR-1 trigger still settles without meeting it. The reconcile itself
-- runs only over pairs that exist BEFORE the migration, which a database built
-- from the migrations cannot hold once the index is there. It was proved
-- separately, 2026-10-08, in PGlite (PostgreSQL 18.3) built from all 295
-- earlier migrations, with pairs seeded before this one applied (re-run twice):
--   a pair            -> the older waits, the newer is DISCARDED naming it,
--                        with the send-request tail when it carried one
--   a triple + NULL created_at -> the oldest dated row waits; NULL sorts last
--   a created_at tie  -> the lower id waits
--   one order id in two houses, one waiting row each -> both untouched
--   no order_id, two waiting -> untouched; AUTO_SEND_SCHEDULED -> untouched
-- Mutations, each caught: newest survives (DESC) -> 8 checks fail; rank filter
-- dropped -> 7; no index -> 8; partition by order_id only -> 1 (two houses).
-- Production dry run (scripts/f106_reconcile_dry_run.sql, 2026-10-08): no
-- order had two waiting drafts, so the reconcile changes no production row.

\set ON_ERROR_STOP 1
begin;

ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;

DO $$
DECLARE
  r  uuid := '11111111-1111-1111-1111-111111111111';
  p  uuid := '22222222-2222-2222-2222-222222222222';
  o  uuid := '33333333-3333-3333-3333-333333333331';
  a  uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b  uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  v_def text;
  v_status text;
BEGIN
  -- I1: the index exists, is unique and valid, and has the agreed shape
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = 'public.uniq_proc_conv_one_pending_draft_per_order'::regclass
     AND i.indisunique AND i.indisvalid;
  IF v_def IS NULL OR v_def NOT LIKE '%(restaurant_id, order_id)%' OR v_def NOT LIKE '%PENDING_APPROVAL%' THEN
    RAISE EXCEPTION 'FAIL I1: %', v_def;
  END IF;
  RAISE NOTICE 'PASS I1';

  -- I2: the trigger path still settles newest-wins, and never meets the index
  INSERT INTO public.procurement_conversations (id, order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (a, o, r, p, 'outbound', 'email', 'first', 'PENDING_APPROVAL', now() - interval '1 hour');
  INSERT INTO public.procurement_conversations (id, order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (b, o, r, p, 'outbound', 'email', 'second', 'PENDING_APPROVAL');
  SELECT (status)::text INTO v_status FROM public.procurement_conversations WHERE id = a;
  IF v_status <> 'DISCARDED' THEN RAISE EXCEPTION 'FAIL I2: first row is %', v_status; END IF;
  RAISE NOTICE 'PASS I2';

  -- I3: a writer that bypasses the trigger is refused by the index
  BEGIN
    ALTER TABLE public.procurement_conversations DISABLE TRIGGER trg_proc_conv_one_pending_draft;
    INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
    VALUES (o, r, p, 'outbound', 'email', 'bypass', 'PENDING_APPROVAL');
    RAISE EXCEPTION 'FAIL I3: a second waiting row got in';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS I3';
  END;
  ALTER TABLE public.procurement_conversations ENABLE TRIGGER trg_proc_conv_one_pending_draft;

  -- I4: the same order id in another house may still wait
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o, '11111111-1111-1111-1111-111111111112', p, 'outbound', 'email', 'other house', 'PENDING_APPROVAL');
  RAISE NOTICE 'PASS I4';

  -- I5: rows with no order are not covered
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (NULL, r, p, 'outbound', 'email', 'x', 'PENDING_APPROVAL'), (NULL, r, p, 'outbound', 'email', 'y', 'PENDING_APPROVAL');
  RAISE NOTICE 'PASS I5';
END
$$;

rollback;
