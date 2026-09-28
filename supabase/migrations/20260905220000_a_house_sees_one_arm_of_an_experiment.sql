-- A house sees one arm of an experiment, and the arm it saw is written down.
-- (2026-09-05. Additive: one new table, nothing altered, nothing dropped.)
--
-- WHY A TABLE AND NOT JUST A HASH
-- -------------------------------
-- The arm is chosen deterministically — sha256("<key>:<restaurant_id>") mod 100
-- against the arms' cumulative percentages (apps/api-gateway/src/ux-optimizer/
-- experiments.ts). A hash needs no storage to be repeatable, so the obvious
-- question is why this table exists at all.
--
-- Because the RATIO is a constant in a source file, and a constant can be
-- edited. The moment it is, a recompute moves houses between arms, and every
-- exposure already recorded in `neural_footprint_event` is attributed to an arm
-- that house was never actually shown. The report would then compare two
-- denominators that no longer mean what they say — and it would do so silently,
-- with every individual row correct.
--
-- That is the `absence-reported-as-health` shape wearing a different coat: the
-- system re-derives its own history and reports the derivation as the record.
-- So the row wins over the hash. `ratio` freezes the split that was in force at
-- assignment, and `bucket` freezes the draw, so the assignment stays auditable
-- against the source file rather than trusting it.
--
-- WHAT THIS IS NOT
-- ----------------
-- It is not a rollout gate. `ux_overrides.rollout_pct` already gates approved
-- UX overrides by a per-USER bucket, behind UX_OPTIMIZER_ENABLED; that answers
-- "does this user see the approved change yet". This answers a different
-- question — "which of two named arms is this HOUSE on" — and it is not gated
-- by that kill switch, because an experiment that stops recording when a flag
-- is off produces a gap that reads exactly like a period of no activity.
--
-- It applies nothing and decides nothing. Which arm completes more is a count a
-- person reads. See ADR 0127.

create table if not exists public.ux_experiment_assignments (
  restaurant_id  uuid not null
                 references public.restaurants(id) on delete cascade,

  -- Matches ExperimentSpec.key. Not an enum and not a foreign key: the register
  -- of experiments lives in source, where it is read alongside the founder's
  -- words that set the ratio, and a second copy in the database would be a
  -- second place for it to drift.
  experiment_key text not null check (length(experiment_key) between 1 and 120),

  -- The arm this house was shown. Free text with a length bound rather than a
  -- CHECK listing 'plain' and 'die': a per-experiment enum in a shared table
  -- would have to be ALTERed for every future experiment, and an ALTER on a
  -- CHECK is the kind of change that gets skipped and then silently rejects a
  -- write. The writing service validates against the arms its spec declares.
  arm            text not null check (length(arm) between 1 and 60),

  -- The draw, kept so the assignment can be re-derived and checked against the
  -- source constant rather than believed.
  bucket         smallint not null check (bucket >= 0 and bucket <= 99),

  -- The split in force AT ASSIGNMENT, e.g. {"plain": 80, "die": 20}. This is
  -- the column that stops an edited constant from rewriting history.
  ratio          jsonb not null,

  assigned_at    timestamptz not null default now(),

  -- One arm per house per experiment, forever. The primary key IS the rule: a
  -- house that could hold two rows could be counted in both arms, and no amount
  -- of care in the service would make that unrepresentable.
  primary key (restaurant_id, experiment_key)
);

comment on table public.ux_experiment_assignments is
  'Which arm of a UX experiment a house is on. Chosen deterministically by hash '
  'on first read and then FROZEN here: the row wins over a recompute, so editing '
  'the ratio constant cannot re-label exposures already recorded. Never applies '
  'anything — exposures and outcomes go to neural_footprint_event and a person '
  'reads the counts (ADR 0127).';
comment on column public.ux_experiment_assignments.arm is
  'The arm this house was actually shown. The service validates it against the '
  'arms its ExperimentSpec declares; the column only bounds the length.';
comment on column public.ux_experiment_assignments.bucket is
  'The 0-99 draw from sha256("<experiment_key>:<restaurant_id>"), kept so the '
  'assignment is auditable against the source constant.';
comment on column public.ux_experiment_assignments.ratio is
  'The arm percentages in force at the moment of assignment. Frozen on purpose: '
  'a later edit to the constant must not change what this house was shown.';

create index if not exists idx_ux_experiment_assignments_key
  on public.ux_experiment_assignments (experiment_key, arm);

-- ---------------------------------------------------------------------------
-- Locked down in the SAME migration that creates it (OD-72 / OD-73 house rule).
-- ---------------------------------------------------------------------------
alter table public.ux_experiment_assignments enable row level security;

drop policy if exists ux_experiment_assignments_service_role
  on public.ux_experiment_assignments;
create policy ux_experiment_assignments_service_role
  on public.ux_experiment_assignments
  for all to service_role using (true) with check (true);

-- No `authenticated` policy: the browser reaches this only through the gateway,
-- which scopes every read and write to the restaurant on the token. The same
-- posture ADR 0012 settled for generated_reports.
--
-- The REVOKE is belt as well as braces. OD-72's `alter default privileges`
-- ratchet means a table created now arrives with no client grants — but that
-- ratchet runs as `postgres` and cannot reach `supabase_admin`'s defaults, so
-- OD-94 records it as ordering luck rather than a control.
revoke all on public.ux_experiment_assignments from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Assert the outcome rather than report success.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rls      boolean;
  grants   int;
  pk_cols  text;
  parent   text;
BEGIN
  IF to_regclass('public.ux_experiment_assignments') IS NULL THEN
    RAISE EXCEPTION 'ux_experiment_assignments was not created';
  END IF;

  SELECT relrowsecurity INTO rls
    FROM pg_class WHERE oid = to_regclass('public.ux_experiment_assignments');
  IF NOT rls THEN
    RAISE EXCEPTION 'ux_experiment_assignments has row level security OFF';
  END IF;

  SELECT count(*) INTO grants
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND table_name = 'ux_experiment_assignments'
     AND grantee IN ('anon', 'authenticated');
  IF grants > 0 THEN
    RAISE EXCEPTION
      'ux_experiment_assignments still holds % client grant(s) for anon/authenticated',
      grants;
  END IF;

  -- The primary key is the "one arm per house" rule. Assert its exact columns,
  -- not merely that a primary key exists: a key on (restaurant_id) alone would
  -- pass an existence check and forbid a second EXPERIMENT, while a key on
  -- (restaurant_id, experiment_key, arm) would permit a house in both arms.
  -- Read the key's own definition text rather than enumerating conkey: the
  -- repo's fk-repoint guard (ADR 0076) refuses a bare unnest(conkey), and a
  -- primary key has no confkey to pair it with, so the definition string is
  -- the one shape that is both exact and guard-clean.
  SELECT pg_get_constraintdef(c.oid) INTO pk_cols
    FROM pg_constraint c
   WHERE c.conrelid = to_regclass('public.ux_experiment_assignments')
     AND c.contype = 'p';
  IF pk_cols IS DISTINCT FROM 'PRIMARY KEY (restaurant_id, experiment_key)' THEN
    RAISE EXCEPTION
      'ux_experiment_assignments primary key is (%), not (restaurant_id, experiment_key) — a house could be counted in two arms',
      coalesce(pk_cols, 'none');
  END IF;

  -- The tenancy parent. Named explicitly because an actor-shaped uuid column in
  -- this codebase has twice been pointed at auth.users, which shares zero ids
  -- with the table the JWT carries.
  SELECT confrelid::regclass::text INTO parent
    FROM pg_constraint
   WHERE conrelid = to_regclass('public.ux_experiment_assignments')
     AND contype = 'f';
  IF parent IS NULL THEN
    RAISE EXCEPTION 'ux_experiment_assignments.restaurant_id has no parent key';
  END IF;
  IF parent <> 'restaurants' AND parent <> 'public.restaurants' THEN
    RAISE EXCEPTION
      'ux_experiment_assignments.restaurant_id points at %, not the restaurants table',
      parent;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = to_regclass('public.ux_experiment_assignments')
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%bucket%'
  ) THEN
    RAISE EXCEPTION 'ux_experiment_assignments.bucket has no range constraint — a draw outside 0..99 falls in no arm';
  END IF;

  RAISE NOTICE 'a house sees one arm of an experiment: ux_experiment_assignments exists, RLS on, no client grants, one row per house per experiment.';
END
$$;
