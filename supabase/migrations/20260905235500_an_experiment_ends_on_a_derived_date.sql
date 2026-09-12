-- An experiment ends on a DERIVED date, and its winner is written once.
-- (2026-09-05. Additive: one new table, one trigger function, nothing altered,
--  nothing dropped. Companion to 20260905220000_a_house_sees_one_arm_of_an_experiment.sql.)
--
-- WHY THIS TABLE EXISTS
-- --------------------
-- ADR 0127 left two questions open and named them as the founder's: who may
-- read BOTH arms, and what ends the experiment. On 2026-09-05 the founder
-- answered both. The end is:
--
--     one quarter after the experiment's FIRST EXPOSURE.
--
-- Not a sample-size rule, and not a date somebody types. Both were considered
-- and both are recorded as rejected in ADR 0127's addendum. What matters here
-- is the shape of the storage, and it is the same argument the assignments
-- table already turns on:
--
--   * The quarter is a CONSTANT in a source file (EXPERIMENT_QUARTER_DAYS = 91,
--     apps/api-gateway/src/ux-optimizer/experiments.ts), and a constant can be
--     edited. If the end date were re-derived on every read, editing 91 would
--     move the finish line under a running experiment — extending an experiment
--     that had already closed, or closing one that was still open — with every
--     individual row still correct and nothing anywhere reporting a problem.
--   * The FIRST EXPOSURE is a MIN over a ledger, and a ledger can be added to.
--     A backfill, a replayed migration, or a deleted row moves a re-derived MIN.
--
-- So the window is derived ONCE, from the ledger, and then frozen here. The row
-- wins over the recomputation, exactly as `ux_experiment_assignments.ratio`
-- wins over the source constant. This is the `absence-reported-as-health`
-- shape again in its other coat: a system that re-derives its own history and
-- serves the derivation as the record.
--
-- THE ARITHMETIC, WRITTEN DOWN
-- ----------------------------
-- One quarter is 91 days: 13 weeks exactly (13 * 7 = 91). A calendar quarter is
-- 90, 91 or 92 days and the mean Gregorian quarter is 365.2425 / 4 = 91.31
-- days, so 91 is within a day of every reading of "a quarter". 13 whole weeks
-- was chosen over 90 or 92 for a reason that is about restaurants and not about
-- calendars: covers are strongly weekly-periodic, so a window that is not a
-- whole number of weeks gives one weekday an extra turn and weights the counts
-- by whichever day that happens to be. `quarter_days` is stored on the row so
-- the window can be checked against the constant rather than believed.
--
-- WHAT A ROW MEANS
-- ----------------
-- A row exists ONLY once the first exposure is known. That is deliberate: the
-- existence of the row IS the statement "this experiment has started and its
-- window is fixed", so there is no nullable column that has to be interpreted
-- and no state in which a reader has to guess whether an absent date means
-- "not started" or "we failed to read it". No row means nothing has been shown
-- to anybody yet; a failed READ of this table is an error the caller raises
-- with its reason, and is never reported as "no experiment".
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not a kill switch and it decides nothing. It records when the window
-- closes, and — after it closes — the arm a person named. Naming the winner is
-- a separate, deliberate act by the platform admin (X-Admin-Key, ADR 0099); no
-- code path here or in the service picks an arm, and there is no default
-- winner. Until somebody names one, an ended experiment reports that it has
-- ended and that no winner is recorded.

create table if not exists public.ux_experiment_state (
  -- Matches ExperimentSpec.key. Not a foreign key and not an enum, for the same
  -- reason `ux_experiment_assignments.experiment_key` is neither: the register
  -- of experiments lives in source, beside the founder's words that set the
  -- ratio, and a second copy in the database would be a second place to drift.
  experiment_key    text not null primary key
                    check (length(experiment_key) between 1 and 120),

  -- The earliest exposure across ALL houses, taken from neural_footprint_event
  -- at the moment the window was first stamped. NOT NULL: a row that could not
  -- name its first exposure would be a window with no start.
  first_exposure_at timestamptz not null,

  -- The constant in force when the window was stamped, so `ends_at` is
  -- auditable against the source file instead of trusted.
  quarter_days      smallint not null check (quarter_days between 1 and 3650),

  -- first_exposure_at + quarter_days. Stored, not computed on read — see the
  -- header. A generated column was rejected: it would recompute from the
  -- stored inputs, which is fine, but it would also make the interval
  -- unchangeable by any future correction that the founder DID authorise, and
  -- an explicit column that a trigger freezes says the same thing while
  -- leaving that door where a person can see it.
  ends_at           timestamptz not null,

  -- The arm the founder named after the window closed. NULL means no winner is
  -- recorded — never "plain by default". Nothing in the schema or the service
  -- fills this in on its own.
  winner_arm        text
                    check (winner_arm is null or length(winner_arm) between 1 and 60),
  winner_named_at   timestamptz,
  -- The founder's own words alongside the arm, so the decision is never read
  -- without them. Same rule as ExperimentSpec.founderWords.
  winner_words      text check (winner_words is null or length(winner_words) <= 2000),

  created_at        timestamptz not null default now(),

  -- A window that ends before it starts is not a window.
  constraint ux_experiment_state_window_runs_forward
    check (ends_at > first_exposure_at),

  -- A winner is an arm AND the moment it was named, or it is neither. Half a
  -- winner would let a report print an arm with no date, or a date with no arm,
  -- and both read as a decision that was never made.
  constraint ux_experiment_state_winner_is_whole
    check (
      (winner_arm is null and winner_named_at is null)
      or (winner_arm is not null and winner_named_at is not null)
    )
);

comment on table public.ux_experiment_state is
  'When a UX experiment''s window closes, and the arm a person named after it did. '
  'One row per experiment, created only once the first exposure is known. The '
  'window is DERIVED once (first exposure + quarter_days) and then frozen: the row '
  'wins over a recomputation, so editing the constant cannot move the finish line '
  'under a running experiment. No default winner (ADR 0127 addendum).';
comment on column public.ux_experiment_state.first_exposure_at is
  'Earliest exposure across ALL houses, from neural_footprint_event, at the moment '
  'the window was stamped. Frozen by trigger.';
comment on column public.ux_experiment_state.quarter_days is
  'The interval constant in force at stamping (91 = 13 whole weeks). Stored so '
  'ends_at is auditable against apps/api-gateway/src/ux-optimizer/experiments.ts.';
comment on column public.ux_experiment_state.ends_at is
  'first_exposure_at + quarter_days. After this instant no new exposure is recorded '
  'and the assignment rows are kept as history.';
comment on column public.ux_experiment_state.winner_arm is
  'The arm a platform admin named AFTER the window closed. NULL means no winner is '
  'recorded — it never means the first-declared arm won.';

-- ---------------------------------------------------------------------------
-- Written once. The trigger is the rule; the service is only its first caller.
-- ---------------------------------------------------------------------------
-- The whole value of this table is that the window cannot move. A service that
-- promises not to move it is a promise; a trigger that refuses is a rule. The
-- winner is frozen by the same trigger for the same reason: a decision that can
-- be silently rewritten is not a decision, and a second, different arm arriving
-- later must fail loudly rather than overwrite the first.
create or replace function public.ux_experiment_state_is_written_once()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'ux_experiment_state rows are the record of a window that has already run (%): delete then re-insert would silently re-derive it',
      old.experiment_key;
  end if;

  if new.experiment_key is distinct from old.experiment_key then
    raise exception 'ux_experiment_state.experiment_key cannot be changed (% -> %)',
      old.experiment_key, new.experiment_key;
  end if;
  if new.first_exposure_at is distinct from old.first_exposure_at then
    raise exception
      'ux_experiment_state.first_exposure_at is frozen for % — the window may not be re-derived',
      old.experiment_key;
  end if;
  if new.quarter_days is distinct from old.quarter_days then
    raise exception
      'ux_experiment_state.quarter_days is frozen for % — editing the constant must not move a running window',
      old.experiment_key;
  end if;
  if new.ends_at is distinct from old.ends_at then
    raise exception
      'ux_experiment_state.ends_at is frozen for % — the finish line may not move under a running experiment',
      old.experiment_key;
  end if;

  -- A winner may be written once. Re-writing the SAME arm is allowed through
  -- so a retried request is idempotent rather than an error; a DIFFERENT arm,
  -- or an attempt to unname one, is refused.
  if old.winner_arm is not null and new.winner_arm is distinct from old.winner_arm then
    raise exception
      'ux_experiment_state.winner_arm for % is already "%" — a named winner is not rewritten to "%"',
      old.experiment_key, old.winner_arm, coalesce(new.winner_arm, 'null');
  end if;
  if old.winner_named_at is not null
     and new.winner_named_at is distinct from old.winner_named_at then
    raise exception
      'ux_experiment_state.winner_named_at for % is frozen once a winner is named',
      old.experiment_key;
  end if;

  return new;
end $$;

comment on function public.ux_experiment_state_is_written_once() is
  'Freezes an experiment window (first_exposure_at, quarter_days, ends_at) and a '
  'named winner. Refuses DELETE: deleting the row would let the window be '
  're-derived from a ledger that has grown since. ADR 0127 addendum.';

revoke all on function public.ux_experiment_state_is_written_once() from public;
revoke all on function public.ux_experiment_state_is_written_once() from anon, authenticated;

drop trigger if exists trg_ux_experiment_state_is_written_once
  on public.ux_experiment_state;
create trigger trg_ux_experiment_state_is_written_once
  before update or delete on public.ux_experiment_state
  for each row execute function public.ux_experiment_state_is_written_once();

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.ux_experiment_state enable row level security;

drop policy if exists ux_experiment_state_service_role
  on public.ux_experiment_state;
create policy ux_experiment_state_service_role
  on public.ux_experiment_state
  for all to service_role using (true) with check (true);

-- No `authenticated` policy. The browser reaches this only through the gateway,
-- and the both-arms report behind it is deliberately NOT a tenant read — it is
-- gated by the platform-admin service key (ADR 0099). Granting the client role
-- SELECT here would hand every logged-in house the winner and the window
-- through PostgREST, around the one gate that decides who may see them.
--
-- The REVOKE is belt as well as braces, for OD-94's reason: the default-privilege
-- ratchet runs as `postgres` and cannot reach `supabase_admin`'s defaults, so a
-- new table arriving ungranted is ordering luck rather than a control.
revoke all on public.ux_experiment_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls     boolean;
  grants  int;
  pk_cols text;
  trg     int;
BEGIN
  IF to_regclass('public.ux_experiment_state') IS NULL THEN
    RAISE EXCEPTION 'ux_experiment_state was not created';
  END IF;

  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.ux_experiment_state');
  IF NOT rls THEN
    RAISE EXCEPTION 'ux_experiment_state has row level security OFF';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'ux_experiment_state'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION
      'ux_experiment_state still holds % client grant(s) for anon/authenticated',
      grants;
  END IF;

  -- One row per experiment. Asserted by its exact definition rather than by
  -- "a primary key exists": a key that also carried, say, first_exposure_at
  -- would pass an existence check and permit two windows for one experiment,
  -- which is precisely the thing this table is for.
  SELECT pg_get_constraintdef(c.oid) INTO pk_cols
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.ux_experiment_state')
     AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM 'PRIMARY KEY (experiment_key)' THEN
    RAISE EXCEPTION
      'ux_experiment_state primary key is (%), not (experiment_key) — an experiment could hold two windows',
      coalesce(pk_cols, 'none');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.ux_experiment_state')
       AND contype = 'c'
       AND conname = 'ux_experiment_state_winner_is_whole'
  ) THEN
    RAISE EXCEPTION
      'ux_experiment_state has no winner_is_whole constraint — an arm with no date, or a date with no arm, would read as a decision nobody made';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.ux_experiment_state')
       AND contype = 'c'
       AND conname = 'ux_experiment_state_window_runs_forward'
  ) THEN
    RAISE EXCEPTION
      'ux_experiment_state has no window_runs_forward constraint — an experiment could end before it started';
  END IF;

  -- The freeze. Asserted because without it every comment above is a wish: the
  -- table would accept an UPDATE moving ends_at and a DELETE re-deriving it.
  SELECT count(*) INTO trg
    FROM pg_trigger
   WHERE tgrelid = to_regclass('public.ux_experiment_state')
     AND NOT tgisinternal
     AND tgname = 'trg_ux_experiment_state_is_written_once';
  IF trg <> 1 THEN
    RAISE EXCEPTION
      'ux_experiment_state has no write-once trigger — the window and the winner could be rewritten';
  END IF;

  RAISE NOTICE 'an experiment ends on a derived date: ux_experiment_state exists, RLS on, no client grants, one window per experiment, window and winner frozen.';
END
$$;
