-- r109 (DD-r108-21/69): the database holds ONE return_glass_pour.
--
-- #1263's sale-keyed function (20270307121700) gives back what the named
-- sale BOOKED, at most once across its voids (QA 8c). #2063's ml-based
-- 10-argument overload (20271201200000, now a no-op) is dropped wherever an
-- earlier body applied it. The gateway voids each r57 part, whole and
-- fraction, under its own sale key (pos-hub.service.ts).

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
