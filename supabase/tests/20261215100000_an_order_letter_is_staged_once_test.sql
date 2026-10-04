-- An order's vendor letter is staged once, and one draft waits per order
-- (ADR 0266, owner-quarter sim F-106; migration an_order_letter_is_staged_once).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything it writes is inside one transaction that is ROLLED BACK at the
-- end, so it leaves nothing behind. Each check raises 'FAIL <id>' or notices
-- 'PASS <id>'; the run stops at the first failure. Foreign keys to the parent
-- tables are dropped inside the transaction so the rows need no house, vendor
-- or order; the rollback restores them.
--
-- Measured 2026-10-02 (fix/f106-one-letter-per-order) on PostgreSQL 17 built
-- from all 283 migrations at e25ebf537 plus this one (applied twice, to show it
-- re-runs): 20/20 pass. Control, the same corpus WITHOUT the migration: the
-- first call errors (stage_order_letter does not exist), and two direct inserts
-- for one order leave 2 waiting rows. Mutations of the migration, each re-run:
--   no trigger                         -> P4 fails
--   the insert loses a created_at tie  -> P15 fails
--   p_kind ignored                     -> P4 fails
--   sent statuses do not block         -> P3 fails
--   a released row always waits again  -> P6 fails
--   a null status passes the door      -> P12 fails
--   EXECUTE granted to authenticated   -> the migration's own assert refuses to apply
--   no advisory lock in the door       -> the race below stages twice
--
-- Not in this file (it needs two sessions): session A stages a letter and
-- holds its transaction open 2s; session B calls the door for the same order
-- 0.5s later. B waits on the advisory lock, then answers staged=false naming
-- A's row, and one row waits. With the lock removed, both answer staged=true.
--
-- Fidelity: run as a superuser with no RLS and without the Supabase platform
-- roles' login path; production rows were not read.

\set ON_ERROR_STOP 1
begin;

ALTER TABLE public.procurement_conversations DROP CONSTRAINT IF EXISTS procurement_conversations_order_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_provider_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_restaurant_id_fkey,
  DROP CONSTRAINT IF EXISTS procurement_conversations_send_requested_by_fkey;

CREATE OR REPLACE FUNCTION pg_temp.letter(o uuid, st text DEFAULT 'PENDING_APPROVAL', kind text DEFAULT 'PRICE_INQUIRY', r uuid DEFAULT '11111111-1111-4111-8111-111111111111')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('order_id', o, 'restaurant_id', r,
    'provider_id', '22222222-2222-4222-8222-222222222222', 'direction', 'outbound',
    'channel', 'email', 'message_text', 'Dear vendor', 'content', 'Dear vendor',
    'ai_generated', true, 'status', st, 'outbound_email_type', kind,
    'disclaimer_appended', true, 'constraint_flags', '{"k":1}'::jsonb)
$$;
CREATE OR REPLACE FUNCTION pg_temp.pending(o uuid, r uuid DEFAULT '11111111-1111-4111-8111-111111111111')
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.procurement_conversations WHERE order_id = o AND restaurant_id = r AND status = 'PENDING_APPROVAL'
$$;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- P1/P2: the door stages once; the second call writes nothing and names the first
DO $$ DECLARE o uuid := gen_random_uuid(); a jsonb; b jsonb; BEGIN
  a := public.stage_order_letter(pg_temp.letter(o), NULL);
  b := public.stage_order_letter(pg_temp.letter(o), NULL);
  PERFORM pg_temp.ok((a->>'staged')::boolean, 'P1 first letter staged');
  PERFORM pg_temp.ok(NOT (b->>'staged')::boolean AND b->>'id' = a->>'id', 'P2 second call returns the first, writes nothing');
  PERFORM pg_temp.ok(pg_temp.pending(o) = 1 AND (SELECT count(*) FROM public.procurement_conversations WHERE order_id=o) = 1, 'P2 one row');
  PERFORM pg_temp.ok((SELECT constraint_flags->>'k' FROM public.procurement_conversations WHERE id=(a->>'id')::uuid) = '1'
     AND (SELECT email_headers FROM public.procurement_conversations WHERE id=(a->>'id')::uuid) = '{}'::jsonb
     AND (SELECT created_at IS NOT NULL FROM public.procurement_conversations WHERE id=(a->>'id')::uuid), 'P1 columns + defaults kept');
END $$;

-- P3: a sent letter blocks the approval-time letter too
DO $$ DECLARE o uuid := gen_random_uuid(); b jsonb; BEGIN
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'SENT');
  b := public.stage_order_letter(pg_temp.letter(o), NULL);
  PERFORM pg_temp.ok(NOT (b->>'staged')::boolean AND pg_temp.pending(o) = 0, 'P3 sent letter blocks');
END $$;

-- P4: p_kind narrows the block; the trigger keeps one waiting row (newest)
DO $$ DECLARE o uuid := gen_random_uuid(); a jsonb; b jsonb; BEGIN
  a := public.stage_order_letter(pg_temp.letter(o, 'PENDING_APPROVAL', 'PRICE_INQUIRY'), NULL);
  b := public.stage_order_letter(pg_temp.letter(o, 'PENDING_APPROVAL', 'ORDER_CONFIRMATION'), 'ORDER_CONFIRMATION');
  PERFORM pg_temp.ok((b->>'staged')::boolean, 'P4 another kind is staged');
  PERFORM pg_temp.ok(pg_temp.pending(o) = 1 AND (SELECT status FROM public.procurement_conversations WHERE id=(b->>'id')::uuid) = 'PENDING_APPROVAL', 'P4 newest waits');
  PERFORM pg_temp.ok((SELECT status = 'DISCARDED' AND discard_reason = 'Replaced by a newer draft for this order (' || (b->>'id') || ').'
     FROM public.procurement_conversations WHERE id=(a->>'id')::uuid), 'P4 older discarded with reason');
END $$;

-- P5: any other writer (direct insert) still leaves one waiting row; staff request named
DO $$ DECLARE o uuid := gen_random_uuid(); a uuid; b uuid; BEGIN
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status, send_requested_at, send_requested_sha256)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'PENDING_APPROVAL', now(), repeat('a',64)) RETURNING id INTO a;
  PERFORM pg_sleep(0.01);
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'y', 'PENDING_APPROVAL', clock_timestamp()) RETURNING id INTO b;
  PERFORM pg_temp.ok(pg_temp.pending(o) = 1, 'P5 one waiting');
  PERFORM pg_temp.ok((SELECT discard_reason LIKE '%The send request on it no longer applies.' FROM public.procurement_conversations WHERE id=a), 'P5 staff request named');
END $$;

-- P6/P7: a released claim returns to waiting only when nothing newer waits
DO $$ DECLARE o uuid := gen_random_uuid(); a uuid; b uuid; o2 uuid := gen_random_uuid(); c uuid; BEGIN
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'SENDING', clock_timestamp() - interval '1 minute') RETURNING id INTO a;
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'y', 'PENDING_APPROVAL', clock_timestamp()) RETURNING id INTO b;
  UPDATE public.procurement_conversations SET status = 'PENDING_APPROVAL' WHERE id = a;
  PERFORM pg_temp.ok((SELECT status = 'DISCARDED' AND discard_reason = 'A newer draft for this order was already waiting (' || b || ').' FROM public.procurement_conversations WHERE id=a)
     AND pg_temp.pending(o) = 1, 'P6 released older row closes, newer stands');
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o2, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'SENDING') RETURNING id INTO c;
  UPDATE public.procurement_conversations SET status = 'PENDING_APPROVAL' WHERE id = c;
  PERFORM pg_temp.ok((SELECT status = 'PENDING_APPROVAL' AND discard_reason IS NULL FROM public.procurement_conversations WHERE id=c), 'P7 released row waits again');
END $$;

-- P8: editing a waiting row is not a new draft
DO $$ DECLARE o uuid := gen_random_uuid(); a jsonb; BEGIN
  a := public.stage_order_letter(pg_temp.letter(o), NULL);
  UPDATE public.procurement_conversations SET content = 'edited', status = 'PENDING_APPROVAL' WHERE id = (a->>'id')::uuid;
  PERFORM pg_temp.ok((SELECT status = 'PENDING_APPROVAL' AND content = 'edited' FROM public.procurement_conversations WHERE id=(a->>'id')::uuid), 'P8 edit untouched');
END $$;

-- P9: the reason is scoped to DISCARDED
DO $$ DECLARE o uuid := gen_random_uuid(); a jsonb; refused boolean := false; BEGIN
  a := public.stage_order_letter(pg_temp.letter(o), NULL);
  BEGIN
    UPDATE public.procurement_conversations SET discard_reason = 'why' WHERE id = (a->>'id')::uuid;
  EXCEPTION WHEN check_violation THEN refused := true; END;
  PERFORM pg_temp.ok(refused, 'P9 reason refused on a waiting row');
END $$;

-- P10: AUTO_SEND_SCHEDULED is outside the rule (F6)
DO $$ DECLARE o uuid := gen_random_uuid(); a uuid; BEGIN
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'AUTO_SEND_SCHEDULED') RETURNING id INTO a;
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'inbound', 'email', 'y', 'PENDING_APPROVAL');
  PERFORM pg_temp.ok((SELECT status FROM public.procurement_conversations WHERE id=a) = 'AUTO_SEND_SCHEDULED', 'P10 scheduled untouched');
END $$;

-- P11: another house's row with the same order id is not touched
DO $$ DECLARE o uuid := gen_random_uuid(); a jsonb; b jsonb; BEGIN
  a := public.stage_order_letter(pg_temp.letter(o), NULL);
  b := public.stage_order_letter(pg_temp.letter(o, 'PENDING_APPROVAL', 'PRICE_INQUIRY', '33333333-3333-4333-8333-333333333333'), NULL);
  PERFORM pg_temp.ok((b->>'staged')::boolean AND pg_temp.pending(o) = 1 AND pg_temp.pending(o, '33333333-3333-4333-8333-333333333333') = 1, 'P11 house-scoped');
END $$;

-- P12: the door refuses what is not an order letter
DO $$ DECLARE n int := 0; BEGIN
  BEGIN PERFORM public.stage_order_letter(pg_temp.letter(NULL), NULL); EXCEPTION WHEN invalid_parameter_value THEN n := n + 1; END;
  BEGIN PERFORM public.stage_order_letter(pg_temp.letter(gen_random_uuid()) || '{"direction":"inbound"}', NULL); EXCEPTION WHEN invalid_parameter_value THEN n := n + 1; END;
  BEGIN PERFORM public.stage_order_letter(pg_temp.letter(gen_random_uuid()) - 'status', NULL); EXCEPTION WHEN invalid_parameter_value THEN n := n + 1; END;
  BEGIN PERFORM public.stage_order_letter(pg_temp.letter(gen_random_uuid(), 'DRAFT'), NULL); EXCEPTION WHEN invalid_parameter_value THEN n := n + 1; END;
  BEGIN PERFORM public.stage_order_letter(pg_temp.letter(gen_random_uuid()) || '{"scheduled_send_at":"2026-10-02T00:00:00Z"}', NULL); EXCEPTION WHEN invalid_parameter_value THEN n := n + 1; END;
  PERFORM pg_temp.ok(n = 5, 'P12 refuses no order, inbound, no status, DRAFT, an unknown key');
END $$;

-- P13: only service_role may call the door
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.stage_order_letter(jsonb, text)', 'EXECUTE'), 'P13 service_role only');

-- P14: an existing pair is not touched by the migration or by an edit
DO $$ DECLARE o uuid := gen_random_uuid(); BEGIN
  ALTER TABLE public.procurement_conversations DISABLE TRIGGER trg_proc_conv_one_pending_draft;
  INSERT INTO public.procurement_conversations (order_id, restaurant_id, provider_id, direction, channel, message_text, status)
  VALUES (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'PENDING_APPROVAL'),
         (o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'y', 'PENDING_APPROVAL');
  ALTER TABLE public.procurement_conversations ENABLE TRIGGER trg_proc_conv_one_pending_draft;
  UPDATE public.procurement_conversations SET content = 'e' WHERE order_id = o;
  PERFORM pg_temp.ok(pg_temp.pending(o) = 2, 'P14 existing pair left for the reconcile');
END $$;

-- P15: a tie on created_at (one transaction) never discards the row being inserted
DO $$ DECLARE o uuid := gen_random_uuid(); t timestamptz := clock_timestamp();
  hi uuid := ('ffffffff' || substr(gen_random_uuid()::text, 9))::uuid; lo uuid := ('00000000' || substr(gen_random_uuid()::text, 9))::uuid; BEGIN
  INSERT INTO public.procurement_conversations (id, order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (hi, o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'x', 'PENDING_APPROVAL', t);
  INSERT INTO public.procurement_conversations (id, order_id, restaurant_id, provider_id, direction, channel, message_text, status, created_at)
  VALUES (lo, o, '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'outbound', 'email', 'y', 'PENDING_APPROVAL', t);
  PERFORM pg_temp.ok((SELECT status FROM public.procurement_conversations WHERE id=lo) = 'PENDING_APPROVAL'
     AND pg_temp.pending(o) = 1, 'P15 insert wins a tie');
END $$;

rollback;
