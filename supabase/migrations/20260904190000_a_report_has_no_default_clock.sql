-- A report has no default clock.
--
-- The second half of ADR 0116's third decision. The founder named three column
-- defaults on 2026-09-03 and `20260903170000_a_default_is_not_an_answer.sql`
-- dropped them. This file drops the two the first pass FILED rather than
-- changed, after the reader sweep reported them on 2026-09-04:
--
--   public.manager_preferences.report_timezone    DEFAULT 'America/Los_Angeles'  (baseline:3692)
--   public.manager_report_profiles.timezone       DEFAULT 'America/Los_Angeles'  (baseline:3729)
--
-- Same fault, same argument: a house that was never asked which wall clock it
-- runs on had California answered on its behalf, and nothing downstream can
-- tell that from a choice.
--
-- ---------------------------------------------------------------------------
-- THE TWO ARE NOT THE SAME CASE, AND THE MEASUREMENT SAYS SO
-- ---------------------------------------------------------------------------
-- `manager_report_profiles.timezone` has **zero readers of the column** across
-- all four runtimes. The only code that touches that table is
-- `services/agent-orchestrator/demo/weekly_report_scheduler.py:104`, whose own
-- comment at `:96` records that the table holds **0 rows in production**.
-- Dropping its default is free.
--
-- `manager_preferences.report_timezone` is the opposite, and dropping the column
-- default ALONE would have been cosmetic, because the same fabricated answer was
-- hard-coded twice more in Python:
--
--   * `core/database.py` — `report_timezone: str = "America/Los_Angeles"` on the
--     `ManagerPreferences` model. Non-Optional, so after this migration a NULL
--     row would ALSO raise `pydantic.ValidationError` inside `model_validate`,
--     exactly as `Provider.lead_time_days` did (see that model's header for the
--     outage that caused). Now `Optional[str] = None`.
--   * `agents/reporting_agent.py` — `preferences.get("report_timezone",
--     "America/Los_Angeles")` in `_should_generate_report`, which decides
--     WHETHER A MANAGER'S REPORT FIRES NOW. It now refuses in words: no zone,
--     no schedule, logged, nothing sent, no zone assumed. A report on a guessed
--     clock is a 07:00 digest arriving at 17:00.
--
-- A third reader, `ManagerPreferencesRepository.is_quiet_hours`
-- (`core/database.py`), is **dead** — zero callers anywhere; the only other
-- `is_quiet_hours` in the tree is `NotificationAgent._is_quiet_hours`, a
-- different method reading a different table. It was made safe rather than
-- repaired, and is recorded as dead in ADR 0116.
--
-- ---------------------------------------------------------------------------
-- THE SNAPSHOT, SAME SHAPE AND SAME EXPIRY ARGUMENT
-- ---------------------------------------------------------------------------
-- As with the first migration, the pre-change values are photographed before
-- the UPDATE and the count is asserted per column. It is a record, not a restore
-- path — a value equal to a default is unattributable, which is the whole
-- premise — and it is TEMPORARY: drop it on 2026-10-04, filed in
-- `.planning/06-pages/settings.md` §13.33.
--
-- The Supabase CLI wraps each migration file in one transaction, so every
-- statement below lands together or not at all.

-- ── 1. The defaults go ──────────────────────────────────────────────────────
ALTER TABLE public.manager_preferences    ALTER COLUMN report_timezone DROP DEFAULT;
ALTER TABLE public.manager_report_profiles ALTER COLUMN timezone       DROP DEFAULT;

-- ── 2. A photograph of what is about to be erased ───────────────────────────
CREATE TABLE IF NOT EXISTS public.tmp_dropped_report_clocks_20260904 (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity      text NOT NULL,
  entity_id   uuid NOT NULL,
  -- No default on this column. A snapshot of a defaulted-column fault must not
  -- carry defaults of its own.
  timezone    text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tmp_dropped_report_clocks_20260904_entity_check
    CHECK (entity IN ('manager_preferences', 'manager_report_profiles'))
);

ALTER TABLE public.tmp_dropped_report_clocks_20260904
  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmp_dropped_report_clocks_20260904_service_role
  ON public.tmp_dropped_report_clocks_20260904;
CREATE POLICY tmp_dropped_report_clocks_20260904_service_role
  ON public.tmp_dropped_report_clocks_20260904
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.tmp_dropped_report_clocks_20260904
  FROM anon, authenticated;

COMMENT ON TABLE public.tmp_dropped_report_clocks_20260904 IS
  'TEMPORARY. The pre-change report timezones that migration 20260904190000 erased when it dropped two column defaults (manager_preferences.report_timezone, manager_report_profiles.timezone). A record of what was erased, NOT a restore path: a value equal to a default is unattributable. Scheduled for deletion 2026-10-04 — see .planning/06-pages/settings.md §13.33 and ADR 0116. RLS on, service_role only, anon/authenticated revoked. No application code reads this.';

-- ── 3. The rows that carry them are set back to unknown ─────────────────────
DO $$
DECLARE
  n_prefs    int;
  n_profiles int;
  s_prefs    int;
  s_profiles int;
BEGIN
  INSERT INTO public.tmp_dropped_report_clocks_20260904 (entity, entity_id, timezone)
  SELECT 'manager_preferences', m.id, m.report_timezone
  FROM public.manager_preferences m
  WHERE m.report_timezone = 'America/Los_Angeles';

  INSERT INTO public.tmp_dropped_report_clocks_20260904 (entity, entity_id, timezone)
  SELECT 'manager_report_profiles', r.id, r.timezone
  FROM public.manager_report_profiles r
  WHERE r.timezone = 'America/Los_Angeles';

  SELECT
    count(*) FILTER (WHERE entity = 'manager_preferences'),
    count(*) FILTER (WHERE entity = 'manager_report_profiles')
  INTO s_prefs, s_profiles
  FROM public.tmp_dropped_report_clocks_20260904
  WHERE captured_at >= now();

  UPDATE public.manager_preferences SET report_timezone = NULL
  WHERE report_timezone = 'America/Los_Angeles';
  GET DIAGNOSTICS n_prefs = ROW_COUNT;

  UPDATE public.manager_report_profiles SET timezone = NULL
  WHERE timezone = 'America/Los_Angeles';
  GET DIAGNOSTICS n_profiles = ROW_COUNT;

  -- Per column, for the same reason the first migration counts per column: a
  -- snapshot that silently caught fewer rows than the UPDATE cleared would be a
  -- photograph with people missing from it, and the apply log would read clean.
  IF s_prefs <> n_prefs OR s_profiles <> n_profiles THEN
    RAISE EXCEPTION
      'the snapshot does not match what was erased: manager_preferences snapshot=% cleared=%, manager_report_profiles snapshot=% cleared=%',
      s_prefs, n_prefs, s_profiles, n_profiles;
  END IF;

  RAISE NOTICE
    'a_report_has_no_default_clock: cleared report_timezone on % manager_preferences row(s) and timezone on % manager_report_profiles row(s). Each was equal to the column default and therefore unattributable.',
    n_prefs, n_profiles;
  RAISE NOTICE
    'a_report_has_no_default_clock: public.tmp_dropped_report_clocks_20260904 holds the pre-change values — % and % — matching the counts above exactly. TEMPORARY: drop it on 2026-10-04 (settings.md 13.33).',
    s_prefs, s_profiles;
END
$$;

-- ── 4. Assert the state this migration claims to have produced ──────────────
DO $$
DECLARE
  d text;
BEGIN
  FOR d IN
    SELECT format('%s.%s', c.table_name, c.column_name)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'manager_preferences'     AND c.column_name = 'report_timezone')
        OR (c.table_name = 'manager_report_profiles' AND c.column_name = 'timezone')
      )
      AND c.column_default IS NOT NULL
  LOOP
    RAISE EXCEPTION 'public.% still carries a column default', d;
  END LOOP;

  FOR d IN
    SELECT format('%s.%s', c.table_name, c.column_name)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND (
        (c.table_name = 'manager_preferences'     AND c.column_name = 'report_timezone')
        OR (c.table_name = 'manager_report_profiles' AND c.column_name = 'timezone')
      )
      AND c.is_nullable <> 'YES'
  LOOP
    RAISE EXCEPTION 'public.% is NOT NULL — an unrecorded clock has to be storable as nothing', d;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.manager_preferences WHERE report_timezone = 'America/Los_Angeles') THEN
    RAISE EXCEPTION 'a manager_preferences row still reads America/Los_Angeles after the sweep';
  END IF;
  IF EXISTS (SELECT 1 FROM public.manager_report_profiles WHERE timezone = 'America/Los_Angeles') THEN
    RAISE EXCEPTION 'a manager_report_profiles row still reads America/Los_Angeles after the sweep';
  END IF;

  IF to_regclass('public.tmp_dropped_report_clocks_20260904') IS NULL THEN
    RAISE EXCEPTION 'the pre-change snapshot table was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = to_regclass('public.tmp_dropped_report_clocks_20260904') AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'public.tmp_dropped_report_clocks_20260904 does not have RLS enabled';
  END IF;
  IF has_table_privilege('anon', 'public.tmp_dropped_report_clocks_20260904', 'SELECT')
     OR has_table_privilege('authenticated', 'public.tmp_dropped_report_clocks_20260904', 'SELECT') THEN
    RAISE EXCEPTION 'anon or authenticated can still read public.tmp_dropped_report_clocks_20260904';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tmp_dropped_report_clocks_20260904'
          AND column_name = 'timezone') IS NOT NULL THEN
    RAISE EXCEPTION 'the snapshot column carries a default — this migration''s own subject matter, repeated inside the record of it';
  END IF;

  RAISE NOTICE
    'a_report_has_no_default_clock: two defaults dropped, both columns still nullable, no row left carrying a default value, snapshot present with RLS on and anon/authenticated revoked.';
END
$$;
