-- a_month_close_keeps_its_tax_basis — a closed month says which tax basis
-- its net was on (F-1606, wave 52 sim; ADR 0341 F2 "reports mark the switch
-- date").
--
-- WHY
-- ---
-- ADR 0341 (founder S218, F2 "only from now") makes a house's till net
-- pre-tax from the day it says its prices include tax, and rewrites nothing
-- before that day. A Turkish house that switches in October therefore has
-- closes whose net holds KDV for January to September and not after, and
-- nothing on the close said so. The close now keeps the house's stated basis
-- beside its figures; the gateway keeps the switch day and the month's tax
-- figure inside `figures`.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   - month_closes.tax_basis: the house's `restaurants.tax_basis` when the
--     month was closed, one of the four ADR 0341 values. NULL only on a close
--     kept before this column: the basis was not recorded then, and it is not
--     guessed now. Additive; no closed month is backfilled.
--   - The append-only trigger's foreign-key exception names the new column,
--     so the one UPDATE it lets through (closed_by nulled by its FK) still
--     cannot change anything else.
--
-- The table stays as 20270105600000 locked it (OD-72 / OD-73): RLS on,
-- service_role only, no anon/authenticated grant. Asserted below.
BEGIN;

SET LOCAL statement_timeout = '120s';

ALTER TABLE public.month_closes
  ADD COLUMN IF NOT EXISTS tax_basis TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'month_closes_tax_basis_is_one_of_four'
       AND conrelid = to_regclass('public.month_closes')
  ) THEN
    ALTER TABLE public.month_closes
      ADD CONSTRAINT month_closes_tax_basis_is_one_of_four
      CHECK (tax_basis IS NULL
             OR tax_basis IN ('unset', 'prices_include_tax', 'prices_exclude_tax', 'not_vat_charging'));
  END IF;
END
$$;

COMMENT ON COLUMN public.month_closes.tax_basis IS
  'The house''s restaurants.tax_basis when the month was closed (ADR 0341). NULL = closed before a close recorded the basis (2027-01-14); never backfilled. F-1606.';

CREATE OR REPLACE FUNCTION public.month_closes_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.closed_by IS NULL
       AND (NEW.id, NEW.restaurant_id, NEW.month, NEW.version, NEW.closed_at,
            NEW.zone, NEW.figures, NEW.till_csv, NEW.tax_basis)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.restaurant_id, OLD.month, OLD.version, OLD.closed_at,
            OLD.zone, OLD.figures, OLD.till_csv, OLD.tax_basis)
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION
    'month_closes is append-only: % is not permitted. A month closed again is a new version, never an edit to the last one.',
    TG_OP;
END
$function$;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
  trg     int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'month_closes'
       AND column_name = 'tax_basis'
  ) THEN
    RAISE EXCEPTION 'month_closes.tax_basis was not added';
  END IF;
  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.month_closes');
  IF NOT rls THEN
    RAISE EXCEPTION 'month_closes has row level security OFF';
  END IF;
  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'month_closes'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'month_closes still holds % client grant(s) for anon/authenticated', grants;
  END IF;
  SELECT count(*) INTO trg
    FROM pg_trigger
   WHERE tgrelid = 'public.month_closes'::regclass
     AND tgname IN ('trg_month_closes_append_only', 'trg_month_closes_no_truncate');
  IF trg <> 2 THEN
    RAISE EXCEPTION 'month_closes is missing its append-only triggers';
  END IF;
END $$;

COMMIT;
