-- A truck refused at the door can still be written about; a phoned-in order
-- can say when it was placed (owner-quarter sim F-669; founder S198;
-- migration a_refused_truck_can_still_be_written_about).
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

-- R1: a truck refused at the door (FAILED) gets its letter, once
DO $$ DECLARE st text; o uuid; a jsonb; b jsonb; BEGIN
  FOREACH st IN ARRAY ARRAY['FAILED', 'failed'] LOOP
    o := pg_temp.order_in(st);
    a := public.stage_order_letter(pg_temp.letter(o), NULL);
    b := public.stage_order_letter(pg_temp.letter(o), NULL);
    PERFORM pg_temp.ok((a->>'staged')::boolean AND NOT (a ? 'order_status')
      AND b->>'id' = a->>'id' AND NOT (b->>'staged')::boolean AND pg_temp.rows(o) = 1,
      'R1 ' || st || ' order: credit or replacement letter staged once');
  END LOOP;
END $$;

-- R2: an order the house closed still gets nothing (F-516 stands)
DO $$ DECLARE st text; o uuid; a jsonb; BEGIN
  FOREACH st IN ARRAY ARRAY['CANCELLED', 'REJECTED', 'cancelled'] LOOP
    o := pg_temp.order_in(st);
    a := public.stage_order_letter(pg_temp.letter(o), NULL);
    PERFORM pg_temp.ok(a->>'id' IS NULL AND NOT (a->>'staged')::boolean
      AND a->>'order_status' = upper(st) AND pg_temp.rows(o) = 0,
      'R2 ' || st || ' order: nothing staged, status named');
  END LOOP;
END $$;

-- R3: grants unchanged
DO $$ BEGIN
  PERFORM pg_temp.ok(
    has_function_privilege('service_role', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.stage_order_letter(jsonb, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.stage_order_letter(jsonb, text)', 'EXECUTE'),
    'R3 service_role only');
END $$;

-- R4: the stated order day is a nullable date with its stater, and NULL is
-- "Don't know"
DO $$ DECLARE o uuid; BEGIN
  PERFORM pg_temp.ok(
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procurement_orders'
        AND column_name = 'placed_on_stated') = 'date'
    AND (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procurement_orders'
        AND column_name = 'placed_on_stated') = 'YES'
    AND (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procurement_orders'
        AND column_name = 'placed_on_stated_by') = 'uuid',
    'R4 placed_on_stated is a nullable date, placed_on_stated_by a uuid');
  o := pg_temp.order_in('DELIVERED');
  PERFORM pg_temp.ok(
    (SELECT placed_on_stated IS NULL FROM public.procurement_orders WHERE id = o),
    'R4 an order states no day unless told');
END $$;

-- R5: the stater is a public.users id, not an auth.users id
DO $$ BEGIN
  PERFORM pg_temp.ok(EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conname = 'procurement_orders_placed_on_stated_by_fkey'
       AND c.confrelid = 'public.users'::regclass),
    'R5 placed_on_stated_by references public.users');
END $$;

rollback;
