-- A wage is the owner's, every change to it is kept, and leave says whether it
-- is paid. ADR 0215.
--
-- THE FOUNDER, 2026-09-21, verbatim picks:
--   "Fix /team first"
--   wages and labour cost: "Owner only"   (managers see hours but not money)
--   payroll:               "Hand hours over" (no pay computed in Mudavym)
--   pay basis:             "Monthly and hourly" (the labour page, not this file)
--
-- What this file adds, and why each is here rather than in code alone:
--
-- 1. `time_off_requests.leave_type` -- 'unknown' | 'paid' | 'unpaid'.
--    Annual leave is paid (4857 Art. 53), but a request carried only dates, a
--    status and a free-text reason, so a person on paid leave had no shift and
--    the week's labour read them as costing nothing. The type is the minimum
--    that says otherwise. It is NOT a reason and NOT a kind of leave: a "sick"
--    type would be health data (KVKK special category) and nothing here needs
--    it. DEFAULT 'unknown' because every existing row, and every request filed
--    without the question being answered, is exactly that -- nobody said.
--
-- 2. `team_member_wage_changes` -- append-only: who, when, old, new.
--    `updateMember` overwrote `hourly_wage` in place, manager-gated, with no
--    row anywhere. Nobody could answer "what was the rate in March", or who
--    set it. The gateway now lets only an owner write a wage (code); THIS table
--    is what makes each write a record, and it is written by a trigger so that
--    a wage changed by ANY writer -- the gateway, a script, the SQL editor --
--    leaves a row. A writer that does not say who it is leaves a row with
--    `changed_by` NULL, which reads as "not recorded", never as nobody.
--
-- 3. `team_members.wage_changed_by` -- how a writer says who it is. It is a
--    PARAMETER, not state: the trigger copies it into the change row and then
--    clears it, so it is NULL at rest on every row, always. That is what stops
--    a later writer who does not name themselves from being attributed to the
--    previous one. The wage and its record are one statement, so they commit or
--    fail together -- no window where a wage moved and the record did not.
--
-- 4. A COMMENT retiring `team_settings.wage_visible`. The column stays (this
--    file only adds). The gateway no longer reads it: wages are the owner's by
--    ROLE, and the flag both failed to hide them from managers (`labor_cost /
--    hours` is the wage) and could hide them from the owner.
--
-- ADDITIVE AND IDEMPOTENT. Two columns, one table, two functions, three
-- triggers, one CHECK, one index, RLS on the new table in this same file.
-- Nothing dropped, no data written, no existing constraint changed.
SET local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Leave says whether it is paid.
-- ---------------------------------------------------------------------------
ALTER TABLE public.time_off_requests
  ADD COLUMN IF NOT EXISTS leave_type TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'time_off_requests_leave_type_known'
       AND conrelid = 'public.time_off_requests'::regclass
  ) THEN
    ALTER TABLE public.time_off_requests
      ADD CONSTRAINT time_off_requests_leave_type_known
      CHECK (leave_type IN ('unknown', 'paid', 'unpaid'));
  END IF;
END
$$;

COMMENT ON COLUMN public.time_off_requests.leave_type IS
  'unknown | paid | unpaid (ADR 0215). Whether the employer pays for these days, and nothing more: not a reason and not a kind of leave, because a kind such as sick would be health data (KVKK special category). unknown means nobody said, and it is the value of every row written before this column existed.';

-- ---------------------------------------------------------------------------
-- 2. The record of every wage change.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_member_wage_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The house's record goes with the house.
  restaurant_id UUID NOT NULL
    REFERENCES public.restaurants(id) ON DELETE CASCADE,

  -- NO foreign key, deliberately. A person removed from the roster deletes
  -- their `team_members` row, and the record of what they were paid must not
  -- go with it (a wage claim can be brought for five years). A cascade would
  -- delete the history; SET NULL would orphan it; RESTRICT would block the
  -- removal. How long it is kept after someone leaves is a founder question
  -- (ADR 0215), not a default this file picks.
  member_id UUID NOT NULL,

  -- NULL is "no wage on file" (ADR 0088), on either side.
  old_wage NUMERIC(10, 2),
  new_wage NUMERIC(10, 2),

  -- The house's currency at the moment of the change. A number without its
  -- money is not a wage, and the house may state a different currency later.
  -- NULL when the house had not stated one: "currency not recorded".
  currency CHARACTER VARYING(3)
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),

  -- `public.users(user_id)` -- the id the JWT carries. NOT `auth.users`: the
  -- two tables are disjoint in this database and an actor FK to auth.users
  -- fails on every write. NULL = the writer did not say who it was.
  changed_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  -- The role AS IT WAS, read from the access register at the moment of the
  -- change, because a person's role changes and `changed_by` can be nulled.
  changed_by_role CHARACTER VARYING(50),

  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A change that changes nothing is not a change.
  CONSTRAINT tmwc_a_change_changes_something
    CHECK (old_wage IS DISTINCT FROM new_wage)
);

CREATE INDEX IF NOT EXISTS idx_tmwc_member
  ON public.team_member_wage_changes (restaurant_id, member_id, changed_at DESC);

-- Append-only. The one exception is a referential action (the house deleted,
-- or the actor's user row deleted), which is the database keeping its own
-- foreign keys and arrives from inside the referential trigger, one level
-- down. A statement issued directly, by anyone, is refused.
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
  RAISE EXCEPTION
    'team_member_wage_changes is append-only: % is not permitted. A corrected wage is a NEW change, not an edit to the record of the last one.',
    TG_OP;
END
$function$;

COMMENT ON FUNCTION public.tmwc_append_only() IS
  'Refuses UPDATE, DELETE and TRUNCATE on the wage record, except the referential actions its own foreign keys perform (ADR 0215). A history the application can rewrite records what the application currently believes, which is what team_members.hourly_wage already is.';

DROP TRIGGER IF EXISTS trg_tmwc_append_only ON public.team_member_wage_changes;
CREATE TRIGGER trg_tmwc_append_only
  BEFORE UPDATE OR DELETE ON public.team_member_wage_changes
  FOR EACH ROW EXECUTE FUNCTION public.tmwc_append_only();

-- A row trigger does not see TRUNCATE; this one does.
DROP TRIGGER IF EXISTS trg_tmwc_no_truncate ON public.team_member_wage_changes;
CREATE TRIGGER trg_tmwc_no_truncate
  BEFORE TRUNCATE ON public.team_member_wage_changes
  FOR EACH STATEMENT EXECUTE FUNCTION public.tmwc_append_only();

ALTER TABLE public.team_member_wage_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tmwc_service_role ON public.team_member_wage_changes;
CREATE POLICY tmwc_service_role
  ON public.team_member_wage_changes
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.team_member_wage_changes FROM anon, authenticated;

COMMENT ON TABLE public.team_member_wage_changes IS
  'Append-only record of every change to team_members.hourly_wage: who (public.users id and role as they were), when, the old value, the new one, and the house currency at the time (ADR 0215; founder 2026-09-21: wages are "Owner only"). Written by trg_team_member_wage_recorded, so a change by any writer leaves a row; changed_by NULL means the writer did not say who it was. Read by the owner only.';

-- ---------------------------------------------------------------------------
-- 3. A writer says who it is, and the record is written in the same statement.
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members
  ADD COLUMN IF NOT EXISTS wage_changed_by UUID;

COMMENT ON COLUMN public.team_members.wage_changed_by IS
  'A parameter, not state (ADR 0215): the public.users id of whoever is writing hourly_wage in this statement. trg_team_member_wage_recorded copies it into team_member_wage_changes and clears it, so it is NULL at rest on every row. A writer that does not set it is recorded as not recorded, never as the previous writer.';

CREATE OR REPLACE FUNCTION public.team_member_wage_recorded()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_role CHARACTER VARYING(50);
  v_currency CHARACTER VARYING(3);
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.hourly_wage IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.hourly_wage IS DISTINCT FROM OLD.hourly_wage)
  THEN
    IF NEW.wage_changed_by IS NOT NULL THEN
      SELECT ura.role INTO v_role
        FROM public.user_restaurant_access ura
       WHERE ura.user_id = NEW.wage_changed_by
         AND ura.restaurant_id = NEW.restaurant_id
         AND ura.is_active
       LIMIT 1;
    END IF;
    SELECT r.currency INTO v_currency
      FROM public.restaurants r
     WHERE r.id = NEW.restaurant_id;

    INSERT INTO public.team_member_wage_changes
      (restaurant_id, member_id, old_wage, new_wage, currency,
       changed_by, changed_by_role)
    VALUES
      (NEW.restaurant_id, NEW.id,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.hourly_wage END,
       NEW.hourly_wage, v_currency, NEW.wage_changed_by, v_role);
  END IF;
  NEW.wage_changed_by := NULL;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.team_member_wage_recorded() IS
  'Writes one team_member_wage_changes row whenever team_members.hourly_wage is set on insert or changes on update, inside the same statement, then clears the wage_changed_by parameter (ADR 0215).';

DROP TRIGGER IF EXISTS trg_team_member_wage_recorded ON public.team_members;
CREATE TRIGGER trg_team_member_wage_recorded
  BEFORE INSERT OR UPDATE ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.team_member_wage_recorded();

-- ---------------------------------------------------------------------------
-- 4. The flag that no longer decides anything.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.team_settings.wage_visible IS
  'RETIRED 2026-09-21 (ADR 0215): not read by the gateway, and a write to it is refused. Wages and labour cost are the owner''s by role (founder: "Owner only"). Kept because migrations here only add; the flag hid wages only on the roster, never on the week''s labor_cost, and could hide them from the owner.';

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than reporting success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  grants BIGINT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'time_off_requests'
       AND column_name = 'leave_type' AND is_nullable = 'NO'
       AND column_default LIKE '''unknown''%'
  ) THEN
    RAISE EXCEPTION 'time_off_requests.leave_type is missing, nullable, or not defaulted to unknown';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'time_off_requests_leave_type_known'
  ) THEN
    RAISE EXCEPTION 'time_off_requests_leave_type_known was not created';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.team_member_wage_changes'::regclass) THEN
    RAISE EXCEPTION 'RLS is off on team_member_wage_changes';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'team_member_wage_changes'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION 'anon/authenticated still hold % grant(s) on team_member_wage_changes', grants;
  END IF;

  IF (SELECT count(*) FROM pg_trigger
       WHERE tgrelid = 'public.team_member_wage_changes'::regclass
         AND tgname IN ('trg_tmwc_append_only', 'trg_tmwc_no_truncate')
         AND NOT tgisinternal) <> 2 THEN
    RAISE EXCEPTION 'the append-only triggers on team_member_wage_changes are not both present';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.team_members'::regclass
       AND tgname = 'trg_team_member_wage_recorded'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'trg_team_member_wage_recorded is not on team_members';
  END IF;

  IF EXISTS (SELECT 1 FROM public.team_members WHERE wage_changed_by IS NOT NULL) THEN
    RAISE EXCEPTION 'team_members.wage_changed_by holds a value at rest; it is a parameter and must be NULL on every row';
  END IF;

  RAISE NOTICE 'leave_type, team_member_wage_changes (RLS on, anon/authenticated revoked, append-only) and the wage trigger are in place; 0 rows written.';
END
$$;
