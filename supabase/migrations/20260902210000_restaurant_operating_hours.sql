-- restaurants.operating_hours — the product learns when its venues are open (ADR 0093 D1).
--
-- WHAT WAS MISSING
-- ----------------
-- Measured on production `exzueerziesmczwlhomd` 2026-09-02: `restaurants` carried
-- `timezone` (three distinct values) and NOTHING else about time. The founder's
-- first question — "do we know which hours it operates?" — had the answer no.
-- Everything downstream that needs a service day therefore invented one: the
-- simulator placed every cover on a hard-coded 17:00–23:30 UTC dinner curve
-- (`scripts/simulate/service.py:38-45,138-150`) whatever the venue's zone, and
-- OD-92 (crons ignoring timezone) has no fact to anchor on.
--
-- WHY A COLUMN AND NOT A TABLE
-- ----------------------------
-- ADR 0093 D1 weighed `restaurant_hours (weekday, open, close)` and rejected it
-- for now: it costs a join on every read and a second table for a fact that has
-- never been recorded once. The column sits beside the `timezone` it is
-- interpreted in, which is the coupling that matters. Seasonal and holiday
-- overrides are the named trigger to revisit (ADR 0093, Consequences).
--
-- NULL IS THE HONEST DEFAULT (ADR 0020)
-- -------------------------------------
-- The column is nullable and every existing row keeps NULL. NULL means "we do
-- not know this venue's hours", and no reader may coerce it to closed, to open,
-- or to a guessed default — `is_open_at` in both mirrors returns null with a
-- reason instead of false. A backfill of plausible hours would be a fabricated
-- answer written into the tenant.

alter table public.restaurants
  add column if not exists operating_hours jsonb;

-- The shape gate. `add constraint` has no `if not exists`, so the DO block makes
-- a re-run (a repeated `supabase db push`, a rebuilt shadow database) a no-op
-- rather than a 42710.
--
-- This checks only that the value is a JSON OBJECT. The seven-key / three-range /
-- HH:MM / ordering rules are NOT expressible here without a plpgsql helper that
-- would then be a third copy of the rule to keep in step with
-- `scripts/simulate/hours.py` and
-- `apps/api-gateway/src/common/operating-hours/operating-hours.ts`. The full
-- contract is enforced on the write path (`parseOperatingHours`, which rejects
-- with every fault listed) and pinned by the shared fixture
-- `datasets/sim/fixtures/operating-hours-cases.json` that both suites run. What
-- the database refuses is the class of value no reader could ever parse: a
-- string, a number, a bare array.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.restaurants'::regclass
       and conname  = 'restaurants_operating_hours_is_object'
  ) then
    alter table public.restaurants
      add constraint restaurants_operating_hours_is_object
      check (operating_hours is null or jsonb_typeof(operating_hours) = 'object');
  end if;
end
$$;

comment on column public.restaurants.operating_hours is
  'Weekly opening hours (ADR 0093 D1): {"mon".."sun": [{"open":"HH:MM","close":"HH:MM"}]} — all seven keys required, [] means closed that day, at most 3 non-overlapping ranges per day sorted by open, and close <= open means the range crosses midnight into the next local day and must be the day''s last. Times are wall-clock LOCAL to restaurants.timezone (IANA) and close is exclusive. NULL means the hours are UNKNOWN and must never be read as closed, open, or a default — see is_open_at in scripts/simulate/hours.py and apps/api-gateway/src/common/operating-hours/operating-hours.ts, which both return null with a reason. The two mirrors are held in lockstep by datasets/sim/fixtures/operating-hours-cases.json.';
