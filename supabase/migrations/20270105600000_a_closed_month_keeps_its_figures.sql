-- a_closed_month_keeps_its_figures — an owner or manager closes a month, and
-- the month's figures are kept as they stood (F-1013, month-close half).
--
-- THE RULING
-- ----------
-- Founder, 2026-10-11 (sim ledger S195), option C of the S150 fork, "snapshot
-- close": closing a month stores immutable month-end figures as the record —
-- the till's month, the cellar's value, the purchases, the count variance.
-- Live data stays editable. A later change dated inside a closed month is
-- listed against the snapshot ("changed after close": who, what, by how
-- much) on /reports. There is no reopen: a snapshot is never edited, and
-- closing the same month again keeps a NEW version beside the old one.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- Creates public.month_closes, one row per close of one house-month:
--   - month: YYYY-MM on the house's own calendar (its house days, ADR 0296),
--     cut on `zone`, the clock the gateway read the month on;
--   - version: 1 for the first close of that month, 2 for the next, ...;
--     (restaurant_id, month, version) is unique, so two closes pressed at the
--     same moment cannot both claim one version;
--   - figures: the gateway's snapshot (an object, never empty);
--   - till_csv: the till's month written up as the export shelf writes it,
--     kept with the record (5 MB, the export store's own ceiling).
--
-- APPEND-ONLY. A row is never updated and never deleted by a statement. The
-- only exceptions are the database keeping its own foreign keys (the house
-- deleted; the closer's user row deleted, which nulls closed_by), which
-- arrive one trigger level down — the pattern of team_member_wage_changes
-- (20261201110000, ADR 0215). TRUNCATE is refused too.
--
-- Locked down in the same migration (OD-72 / OD-73): RLS on, service_role
-- only, no anon/authenticated grant. The browser reaches it through the
-- gateway, which scopes every statement to the house on the token.
SET local statement_timeout = '120s';

CREATE TABLE IF NOT EXISTS public.month_closes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  month         text NOT NULL,
  version       integer NOT NULL,
  closed_by     uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  closed_at     timestamptz NOT NULL DEFAULT now(),
  zone          text NOT NULL,
  figures       jsonb NOT NULL,
  till_csv      text,
  CONSTRAINT month_closes_month_is_a_month
    CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT month_closes_version_counts_from_one
    CHECK (version >= 1),
  CONSTRAINT month_closes_zone_named
    CHECK (length(btrim(zone)) > 0),
  CONSTRAINT month_closes_figures_are_an_object
    CHECK (jsonb_typeof(figures) = 'object' AND figures <> '{}'::jsonb),
  CONSTRAINT month_closes_till_csv_size
    CHECK (till_csv IS NULL OR octet_length(till_csv) <= 5242880),
  CONSTRAINT month_closes_one_version_each
    UNIQUE (restaurant_id, month, version)
);

CREATE INDEX IF NOT EXISTS idx_month_closes_house_month
  ON public.month_closes (restaurant_id, month DESC, version DESC);

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
            NEW.zone, NEW.figures, NEW.till_csv)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.restaurant_id, OLD.month, OLD.version, OLD.closed_at,
            OLD.zone, OLD.figures, OLD.till_csv)
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION
    'month_closes is append-only: % is not permitted. A month closed again is a new version, never an edit to the last one.',
    TG_OP;
END
$function$;

COMMENT ON FUNCTION public.month_closes_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on a closed month''s record, except the referential actions its own foreign keys perform (the house deleted, the closer''s user row deleted). F-1013, founder 2026-10-11: option C, snapshot close.';

DROP TRIGGER IF EXISTS trg_month_closes_append_only ON public.month_closes;
CREATE TRIGGER trg_month_closes_append_only
  BEFORE UPDATE OR DELETE ON public.month_closes
  FOR EACH ROW EXECUTE FUNCTION public.month_closes_append_only();

DROP TRIGGER IF EXISTS trg_month_closes_no_truncate ON public.month_closes;
CREATE TRIGGER trg_month_closes_no_truncate
  BEFORE TRUNCATE ON public.month_closes
  FOR EACH STATEMENT EXECUTE FUNCTION public.month_closes_append_only();

ALTER TABLE public.month_closes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS month_closes_service_role ON public.month_closes;
CREATE POLICY month_closes_service_role
  ON public.month_closes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.month_closes FROM anon, authenticated;

COMMENT ON TABLE public.month_closes IS
  'A closed month: the figures of one house-month as they stood when an owner or manager closed it (till, cellar value, purchases, count variance), kept unchanged. Live data stays editable; the gateway lists what changed inside the month after the close against this record. Closing again adds a new version. F-1013, founder 2026-10-11 (option C, snapshot close).';
COMMENT ON COLUMN public.month_closes.month IS
  'YYYY-MM on the house''s own calendar (its house days, ADR 0296), read on `zone`.';
COMMENT ON COLUMN public.month_closes.figures IS
  'The gateway''s snapshot of the month: till, valuation, purchases, variance, each with what it covers. Never edited.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
  trg     int;
BEGIN
  IF to_regclass('public.month_closes') IS NULL THEN
    RAISE EXCEPTION 'month_closes was not created';
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
