-- A closed order gets no letter (owner-quarter sim F-516; migration
-- a_closed_order_gets_no_letter).
--
-- Run against a database built from supabase/migrations:
--   psql -v ON_ERROR_STOP=1 -f <this file>
-- Everything it writes is inside one transaction that is ROLLED BACK at the
-- end. Each check raises 'FAIL <id>' or notices 'PASS <id>'. Foreign keys and
-- user triggers are skipped for the transaction (session_replication_role =
-- replica), so the orders need no house, wine or vendor and may be written
-- straight into a closed state; the door itself is what is under test.
--
-- Fidelity: run as a superuser with no RLS; production rows were not read.

\set ON_ERROR_STOP 1
begin;
SET LOCAL session_replication_role = replica;

CREATE OR REPLACE FUNCTION pg_temp.order_in(st text, r uuid DEFAULT '11111111-1111-4111-8111-111111111111')
RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.procurement_orders (order_number, restaurant_id, inventory_id, provider_id,
    quantity, bottles_total, final_price, total_cost, status)
  VALUES ('T-' || gen_random_uuid()::text, r, gen_random_uuid(), '22222222-2222-4222-8222-222222222222',
    1, 12, 10, 10, st)
  RETURNING id
$$;
CREATE OR REPLACE FUNCTION pg_temp.letter(o uuid, r uuid DEFAULT '11111111-1111-4111-8111-111111111111')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('order_id', o, 'restaurant_id', r,
    'provider_id', '22222222-2222-4222-8222-222222222222', 'direction', 'outbound',
    'channel', 'email', 'message_text', 'Dear vendor', 'content', 'Dear vendor',
    'ai_generated', true, 'status', 'PENDING_APPROVAL')
$$;
CREATE OR REPLACE FUNCTION pg_temp.rows(o uuid)
RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.procurement_conversations WHERE order_id = o
$$;
CREATE OR REPLACE FUNCTION pg_temp.ok(cond boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF cond IS NOT TRUE THEN RAISE EXCEPTION 'FAIL %', label; END IF; RAISE NOTICE 'PASS %', label; END $$;

-- C1-C3: a cancelled or turned-down order gets nothing written. FAILED was
-- here until F-669 (migration a_refused_truck_can_still_be_written_about): a
-- truck refused at the door now gets its credit or replacement letter.
DO $$ DECLARE st text; o uuid; a jsonb; BEGIN
  FOREACH st IN ARRAY ARRAY['CANCELLED', 'REJECTED', 'cancelled'] LOOP
    o := pg_temp.order_in(st);
    a := public.stage_order_letter(pg_temp.letter(o), NULL);
    PERFORM pg_temp.ok(a->>'id' IS NULL AND NOT (a->>'staged')::boolean
      AND a->>'order_status' = upper(st) AND pg_temp.rows(o) = 0,
      'C1 ' || st || ' order: nothing staged, status named');
  END LOOP;
END $$;

-- C4: an open order still gets its letter, once
DO $$ DECLARE st text; o uuid; a jsonb; b jsonb; BEGIN
  FOREACH st IN ARRAY ARRAY['PENDING', 'APPROVED', 'CONFIRMED', 'COMPLETED'] LOOP
    o := pg_temp.order_in(st);
    a := public.stage_order_letter(pg_temp.letter(o), NULL);
    b := public.stage_order_letter(pg_temp.letter(o), NULL);
    PERFORM pg_temp.ok((a->>'staged')::boolean AND NOT (a ? 'order_status')
      AND b->>'id' = a->>'id' AND NOT (b->>'staged')::boolean AND pg_temp.rows(o) = 1,
      'C4 ' || st || ' order: staged once');
  END LOOP;
END $$;

-- C5: the order is read in its own house; another house's closed order with
-- the same id is not this order (and an unknown order is not refused here)
DO $$ DECLARE o uuid; a jsonb; BEGIN
  o := pg_temp.order_in('CANCELLED', '33333333-3333-4333-8333-333333333333');
  a := public.stage_order_letter(pg_temp.letter(o), NULL);
  PERFORM pg_temp.ok((a->>'staged')::boolean, 'C5 the status read is house-scoped');
END $$;

-- C6: the existing guards still stand
DO $$ BEGIN
  BEGIN
    PERFORM public.stage_order_letter(pg_temp.letter(gen_random_uuid()) || '{"nope":1}'::jsonb, NULL);
    RAISE EXCEPTION 'FAIL C6 unknown key accepted';
  EXCEPTION WHEN invalid_parameter_value THEN RAISE NOTICE 'PASS C6 unknown key refused';
  END;
END $$;

-- C7: grants unchanged
DO $$ BEGIN
  PERFORM pg_temp.ok(
    has_function_privilege('service_role', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.stage_order_letter(jsonb, text)', 'EXECUTE'),
    'C7 service_role only');
END $$;

rollback;
