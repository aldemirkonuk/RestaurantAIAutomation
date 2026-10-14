-- a_check_keeps_why_its_net_was_not_recorded — a check whose net sales were
-- not recorded keeps the reason (F-1612 = F-1623, wave 53 sim; ADR 0341).
--
-- WHY
-- ---
-- For a house whose till prices include tax, ingest leaves a check's net NULL
-- when it cannot take the tax off (tax-basis-resolver rung 4 and its
-- refusals), and names the reason only in the ingest's errors[]. The
-- dashboard calendar and the registers then told every such check apart by
-- row shape alone and said "no tax rate of this house was in force" for all
-- of them, sending an owner with rates set to Settings for a cause that was
-- not true. The reason is now kept on the check as one of six codes:
--
--   no_rate            no tax rate of the house was in force on the day;
--   tax_unread         the till's tax, or a line's rate, could not be read;
--   tax_over_subtotal  the till's tax was more than the subtotal, or ran the
--                      other way from it;
--   no_zone            the house's time zone is not set;
--   mixed_rates        lines at different rates, not every one matched;
--   tax_on_top         the till adds tax on top, but the house said its
--                      prices include tax.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
--   - pos_checks.net_not_recorded_reason TEXT, NULL on every row written
--     before it (ADR 0341 F2: no backfill; a reader says "reason not kept").
--   - It holds one of the six codes, and only on a check made pre-tax whose
--     net is NULL.
-- Additive. pos_checks keeps its RLS and grants as they are.
BEGIN;

SET LOCAL statement_timeout = '120s';

ALTER TABLE public.pos_checks
  ADD COLUMN IF NOT EXISTS net_not_recorded_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pos_checks_net_not_recorded_reason_known'
       AND conrelid = to_regclass('public.pos_checks')
  ) THEN
    ALTER TABLE public.pos_checks
      ADD CONSTRAINT pos_checks_net_not_recorded_reason_known
      CHECK (net_not_recorded_reason IS NULL
             OR (net_not_recorded_reason IN ('no_rate', 'tax_unread', 'tax_over_subtotal',
                                             'no_zone', 'mixed_rates', 'tax_on_top')
                 AND subtotal IS NULL
                 AND tax_basis = 'prices_include_tax'));
  END IF;
END
$$;

COMMENT ON COLUMN public.pos_checks.net_not_recorded_reason IS
  'Why ingest left this check''s net (subtotal) NULL under prices_include_tax: no_rate, tax_unread, tax_over_subtotal, no_zone, mixed_rates or tax_on_top. NULL when net was recorded, and on every check written before 2027-01-15 (never backfilled). F-1612.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'pos_checks'
       AND column_name = 'net_not_recorded_reason'
       AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'pos_checks.net_not_recorded_reason was not added, or carries a default';
  END IF;
END $$;

COMMIT;
