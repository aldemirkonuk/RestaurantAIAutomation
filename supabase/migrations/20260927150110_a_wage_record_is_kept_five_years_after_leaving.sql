-- A person's wage record is kept five years after they leave the roster, then
-- deleted. ADR 0215.
--
-- THE FOUNDER, 2026-09-21, picked "Take all five" -- the options he picked, of
-- which this is the second: a person's wage-change history is kept 5 years
-- after they leave the roster, then deleted. Five years is how long a wage
-- claim can be brought; after it, KVKK's "no longer than needed" applies.
--
-- `team_member_wage_changes` (20260925180000) is append-only and has no
-- foreign key to `team_members`, on purpose: removing a person must not take
-- their pay record with it. So nothing knew WHEN they left, and nothing could
-- ever delete the record. This file adds both halves:
--
-- 1. `team_member_departures` -- one row per person WITH a wage record, written
--    by the database when their `team_members` row is removed (the roster is
--    `team_members`; a person marked inactive is still on it). `left_at` is
--    stamped by the database, never taken from a writer, so no writer can
--    backdate a departure and have a record purged early. A person with no
--    wage record gets no row: there is nothing to keep, so nothing to time.
--
-- 2. The append-only guard learns one exception: a DELETE of a change row
--    whose person left the roster more than `wage_record_retention()` ago
--    (5 years) and is not on it now. Everything else stays refused. The rule
--    is the table's, so a bug in the job that calls the purge can fail to
--    delete but cannot delete early.
--
-- 3. `purge_expired_wage_records()` -- deletes the change rows past their five
--    years, then the departure rows with nothing left to time, and returns the
--    two counts. Called nightly by the gateway (`WageRecordRetentionService`,
--    @nestjs/schedule, the scheduler every other gateway job uses). SECURITY
--    INVOKER; EXECUTE for service_role only.
--
-- ADDITIVE AND IDEMPOTENT. One table, four functions (one replaced: the guard
-- from 20260925180000, which only gains the exception above), four triggers,
-- RLS on the new table in this file. The backfill below writes a departure only
-- for a wage record whose person is already off the roster -- expected 0 rows,
-- since the record itself is new -- stamped now, so it is kept at least five
-- years from today: the error, if any, is on the side of keeping.
SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- The one number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wage_record_retention()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$ SELECT interval '5 years' $function$;

COMMENT ON FUNCTION public.wage_record_retention() IS
  'How long a person''s wage record is kept after they leave the roster: 5 years (founder, 2026-09-21, ADR 0215). Read by the append-only guard, the departure guard and the purge, so the three cannot disagree.';

-- ---------------------------------------------------------------------------
-- 1. When a person with a wage record left the roster.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_member_departures (
  -- The house's record goes with the house.
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,
  -- No foreign key, for the same reason as team_member_wage_changes.member_id:
  -- the row this points at is the one whose removal this records.
  member_id UUID NOT NULL,
  -- Stamped by trg_tmd_stamp; a supplied value is ignored.
  left_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, member_id)
);

CREATE OR REPLACE FUNCTION public.tmd_stamp_left_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.left_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_tmd_stamp ON public.team_member_departures;
CREATE TRIGGER trg_tmd_stamp
  BEFORE INSERT ON public.team_member_departures
  FOR EACH ROW EXECUTE FUNCTION public.tmd_stamp_left_at();

-- A departure is a fact about the past: never edited. It is deleted only by a
-- referential action (the house deleted) or once its five years have run AND
-- nothing of the person's wage record is left to time.
CREATE OR REPLACE FUNCTION public.tmd_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF pg_trigger_depth() > 1 THEN
      RETURN OLD;
    END IF;
    IF OLD.left_at <= now() - public.wage_record_retention()
       AND NOT EXISTS (
         SELECT 1 FROM public.team_member_wage_changes w
          WHERE w.restaurant_id = OLD.restaurant_id
            AND w.member_id = OLD.member_id)
    THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION
    'team_member_departures: % is not permitted. A departure is deleted only after its five years have run and its wage record is gone.',
    TG_OP;
END
$function$;

DROP TRIGGER IF EXISTS trg_tmd_guard ON public.team_member_departures;
CREATE TRIGGER trg_tmd_guard
  BEFORE UPDATE OR DELETE ON public.team_member_departures
  FOR EACH ROW EXECUTE FUNCTION public.tmd_guard();

DROP TRIGGER IF EXISTS trg_tmd_no_truncate ON public.team_member_departures;
CREATE TRIGGER trg_tmd_no_truncate
  BEFORE TRUNCATE ON public.team_member_departures
  FOR EACH STATEMENT EXECUTE FUNCTION public.tmd_guard();

ALTER TABLE public.team_member_departures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmd_service_role ON public.team_member_departures;
CREATE POLICY tmd_service_role
  ON public.team_member_departures
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_member_departures FROM anon, authenticated;

COMMENT ON TABLE public.team_member_departures IS
  'When a person with a wage record left the roster (their team_members row removed), stamped by the database (ADR 0215). It exists only to time the five years their wage record is kept; it holds no name, no figure and no reason (KVKK: the minimum), and it is deleted with the record.';

-- The roster removal writes the departure. A house being deleted is not a
-- departure: its records go with it by cascade, so nothing is timed.
CREATE OR REPLACE FUNCTION public.team_member_departure_recorded()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
       SELECT 1 FROM public.team_member_wage_changes w
        WHERE w.restaurant_id = OLD.restaurant_id
          AND w.member_id = OLD.id)
     AND EXISTS (
       SELECT 1 FROM public.restaurants r WHERE r.id = OLD.restaurant_id)
  THEN
    INSERT INTO public.team_member_departures (restaurant_id, member_id)
    VALUES (OLD.restaurant_id, OLD.id)
    ON CONFLICT (restaurant_id, member_id) DO NOTHING;
  END IF;
  RETURN OLD;
END
$function$;

COMMENT ON FUNCTION public.team_member_departure_recorded() IS
  'Writes the team_member_departures row when a person with a wage record is removed from the roster, so the five years their record is kept can be timed (ADR 0215).';

DROP TRIGGER IF EXISTS trg_team_member_departure_recorded ON public.team_members;
CREATE TRIGGER trg_team_member_departure_recorded
  AFTER DELETE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.team_member_departure_recorded();

-- ---------------------------------------------------------------------------
-- 2. The append-only guard, with its one exception.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tmwc_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE'
       AND NEW.changed_by IS NULL
       AND (NEW.id, NEW.restaurant_id, NEW.member_id, NEW.old_wage,
            NEW.new_wage, NEW.currency, NEW.changed_by_role, NEW.changed_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.restaurant_id, OLD.member_id, OLD.old_wage,
            OLD.new_wage, OLD.currency, OLD.changed_by_role, OLD.changed_at)
    THEN
      RETURN NEW;
    END IF;
  END IF;
  -- The retention exception (ADR 0215): the person left the roster more than
  -- five years ago and is not on it now. Nothing else is ever deleted.
  IF TG_OP = 'DELETE'
     AND EXISTS (
       SELECT 1 FROM public.team_member_departures d
        WHERE d.restaurant_id = OLD.restaurant_id
          AND d.member_id = OLD.member_id
          AND d.left_at <= now() - public.wage_record_retention())
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = OLD.member_id)
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION
    'team_member_wage_changes is append-only: % is not permitted. A corrected wage is a NEW change, not an edit to the record of the last one; a record is deleted only five years after its person left the roster.',
    TG_OP;
END
$function$;

COMMENT ON FUNCTION public.tmwc_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on the wage record, except the referential actions its own foreign keys perform and, from 20260925180110, the DELETE of a row whose person left the roster more than wage_record_retention() (5 years) ago (ADR 0215). A history the application can rewrite records what the application currently believes.';

-- ---------------------------------------------------------------------------
-- 3. The purge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_expired_wage_records()
RETURNS TABLE (wage_rows_deleted BIGINT, departures_deleted BIGINT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_rows BIGINT;
  v_departures BIGINT;
BEGIN
  DELETE FROM public.team_member_wage_changes w
   USING public.team_member_departures d
   WHERE d.restaurant_id = w.restaurant_id
     AND d.member_id = w.member_id
     AND d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_members m WHERE m.id = w.member_id);
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  DELETE FROM public.team_member_departures d
   WHERE d.left_at <= now() - public.wage_record_retention()
     AND NOT EXISTS (
       SELECT 1 FROM public.team_member_wage_changes w
        WHERE w.restaurant_id = d.restaurant_id
          AND w.member_id = d.member_id);
  GET DIAGNOSTICS v_departures = ROW_COUNT;

  RETURN QUERY SELECT v_rows, v_departures;
END
$function$;

COMMENT ON FUNCTION public.purge_expired_wage_records() IS
  'Deletes every wage change row whose person left the roster more than wage_record_retention() (5 years) ago, then the departure rows with nothing left to time; returns both counts (ADR 0215). Called nightly by the gateway. Cannot delete early: the append-only guard refuses any row whose five years have not run.';

REVOKE ALL ON FUNCTION public.purge_expired_wage_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_wage_records() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_wage_records() TO service_role;

-- ---------------------------------------------------------------------------
-- Backfill: a wage record whose person is already off the roster.
-- ---------------------------------------------------------------------------
INSERT INTO public.team_member_departures (restaurant_id, member_id)
SELECT DISTINCT w.restaurant_id, w.member_id
  FROM public.team_member_wage_changes w
 WHERE NOT EXISTS (
   SELECT 1 FROM public.team_members m WHERE m.id = w.member_id)
ON CONFLICT (restaurant_id, member_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grants BIGINT;
  untimed BIGINT;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.team_member_departures'::regclass) THEN
    RAISE EXCEPTION 'RLS is off on team_member_departures';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'team_member_departures'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'anon/authenticated still hold % grant(s) on team_member_departures', grants;
  END IF;

  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.team_member_departures'::regclass
         AND tgname IN ('trg_tmd_stamp', 'trg_tmd_guard', 'trg_tmd_no_truncate')
         AND NOT tgisinternal) <> 3 THEN
    RAISE EXCEPTION 'the departure triggers are not all present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.team_members'::regclass
       AND tgname = 'trg_team_member_departure_recorded'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_team_member_departure_recorded is not on team_members';
  END IF;

  IF has_function_privilege('anon', 'public.purge_expired_wage_records()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.purge_expired_wage_records()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon/authenticated can still execute purge_expired_wage_records()';
  END IF;

  -- Every wage record of a person off the roster is timed.
  SELECT count(*) INTO untimed
    FROM (SELECT DISTINCT w.restaurant_id, w.member_id
            FROM public.team_member_wage_changes w
           WHERE NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.id = w.member_id)
             AND NOT EXISTS (SELECT 1 FROM public.team_member_departures d
                              WHERE d.restaurant_id = w.restaurant_id
                                AND d.member_id = w.member_id)) u;
  IF untimed > 0 THEN
    RAISE EXCEPTION '% person(s) off the roster have a wage record with no departure to time it', untimed;
  END IF;

  RAISE NOTICE 'team_member_departures (RLS on, anon/authenticated revoked), the retention exception and purge_expired_wage_records() are in place.';
END
$$;
