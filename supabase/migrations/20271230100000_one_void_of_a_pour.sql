-- r109 (DD-r108-21/69): the database holds ONE return_glass_pour.
--
-- WHY. Two lineages each created a return_glass_pour (CREATE FUNCTION, so
-- both survive a merge as overloads):
--   20270307121700 (#1263): (restaurant, inventory, p_sale_key, pours, idem,
--     at). It gives back what the named sale BOOKED, in the unit it was booked
--     in, at most once across every void of that sale (QA 8c).
--   20271201200000 (#2063 via #1820): 10 arguments, ml-based. It gives back
--     p_pours * p_pour_ml, whatever the sale booked, capped only per void key.
-- Two meanings of "void" under one name, and a named call that matches both
-- is ambiguous. The gateway calls only the sale-keyed one (pos-hub.service.ts:
-- each r57 part, whole and fraction, is voided under its own sale key).
--
-- WHAT. Drop the 10-argument overload. Its behaviour test
-- (20271201200000_a_void_of_a_pour_gives_the_ml_back_test.sql) is retired
-- with it; 20271230100000_one_void_of_a_pour_test.sql pins the split.

DROP FUNCTION IF EXISTS public.return_glass_pour(
  uuid, integer, integer, uuid, uuid, text, uuid, text, text, timestamptz);

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour') <> 1 THEN
    RAISE EXCEPTION 'return_glass_pour: expected exactly one definition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'return_glass_pour'
                    AND 'p_sale_key' = ANY (p.proargnames)) THEN
    RAISE EXCEPTION 'return_glass_pour: the one left must be the sale-keyed one';
  END IF;
END $$;
