-- sim_scenario_runs — one scenario run's expectation, written before it is checked
-- (ADR 0093 D2).
--
-- WHAT THIS IS FOR
-- ----------------
-- `python3 -m scripts.simulate oracle` already prints the depletion a service
-- should produce; nothing has ever read the database back and compared. Of the 17
-- scenario §9 simulation gates, two execute (`DELIVERY-AUDIT.md` §2, §5); S04's —
-- "a SimPOS close produces the correct ledger delta and a replay is a no-op" —
-- has never run as a check. This table is the missing half: the run persists what
-- it EXPECTS at the moment it posts, and the verifier compares actuals against
-- that one stored expectation. One comparison, one vocabulary of check ids, no
-- second oracle to drift.
--
-- `expected` is `not null` on purpose, but an EMPTY expectation is not a pass:
-- the verifier returns `unverifiable` for a run whose expectation says nothing
-- (ADR 0020 — unknown renders as unknown, never as "all clear").
--
-- WHY NOT sim_ground_truth_runs
-- -----------------------------
-- Measured, not assumed (ADR 0093 D2 option 3): that table is
-- `UNIQUE (restaurant_id)` — one row per tenant, where a scenario harness writes
-- many — and its sibling `sim_ground_truth_facts.fact_type` is CHECK-limited to
-- six seed facts. A scenario run is neither.

create table if not exists public.sim_scenario_runs (
  id uuid primary key default gen_random_uuid(),

  restaurant_id uuid not null references public.restaurants(id) on delete cascade,

  -- Which archetype the tenant was seeded from (datasets/sim/archetypes/*.json)
  -- and which named scenario ran. Text, not enums: the scenario library is a
  -- dataset that grows, and adding a value to a shipped enum is a lock this
  -- table does not need to take.
  archetype_id text not null,
  scenario text not null,

  -- The seed that makes the run reproducible. Same seed + same scenario + same
  -- menu snapshot = the same service.
  seed integer not null,

  -- The LOCAL service date and the zone it is local to, copied onto the run so a
  -- later change to restaurants.timezone cannot silently re-interpret a stored
  -- expectation.
  service_date date not null,
  timezone text not null,

  -- The hours the run was placed inside, as they were at post time. Nullable
  -- because a run against a venue with unknown hours is a legitimate scenario —
  -- and NULL here means unknown, never "open all day".
  operating_hours jsonb,

  params jsonb not null default '{}'::jsonb,
  expected jsonb not null,

  -- When the run actually reached the hub. NULL means generated-but-not-posted:
  -- a dry run, or a post that failed. It is a result, not missing data, and the
  -- verifier must not read a NULL here as "posted fine".
  posted_at timestamptz,

  created_at timestamptz not null default now()
);

-- "This tenant's runs, newest first" — the /simpos/:restaurantId/scenarios list.
create index if not exists sim_scenario_runs_restaurant_created_idx
  on public.sim_scenario_runs (restaurant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Protection: exactly the shape sim_ground_truth_runs carries, verified on
-- production 2026-09-02 — RLS on, no policies, no client grants.
--
-- Service-role only. The gateway reads and writes this with the service key,
-- which carries rolbypassrls and is unaffected by RLS; no browser and no mobile
-- client touches it. Rows are torn down with the sim tenant
-- (scripts/synth/teardown.py) and cascade from restaurants besides.
--
-- The REVOKE is redundant after OD-72's `alter default privileges ... revoke all
-- ... on tables from anon, authenticated`
-- (20260825210000_od72_revoke_client_grants.sql:183) — anything created after it
-- already arrives with no client grant. It is written anyway because it is the
-- belt that makes RLS-with-no-policies safe: OD-72's finding was that 142 tables
-- were closed by ABSENCE alone, so a future permissive policy could open them on
-- its own. With the grant gone it cannot.
-- ---------------------------------------------------------------------------

alter table public.sim_scenario_runs enable row level security;

revoke all on public.sim_scenario_runs from anon, authenticated;

comment on table public.sim_scenario_runs is
  'One scenario run''s expectation, persisted at post time and compared by the verifier (ADR 0093 D2). Service-role only, like sim_ground_truth_runs — RLS on, no policies, no client grants. Torn down with the sim tenant (scripts/synth/teardown.py). An empty `expected` is verified as `unverifiable`, never as a pass.';

comment on column public.sim_scenario_runs.expected is
  'What this run expects the product to contain afterwards — per-check, keyed by check id. NOT NULL, but emptiness is not agreement: a run with nothing to check verifies as unverifiable (ADR 0020).';

comment on column public.sim_scenario_runs.posted_at is
  'When the run reached the hub. NULL means generated but never posted (a dry run, or a failed post) — a result, not missing data.';

comment on column public.sim_scenario_runs.operating_hours is
  'The venue''s hours as they stood when the run was placed, so a later edit to restaurants.operating_hours cannot re-interpret a stored expectation. NULL means the hours were unknown at post time.';

comment on column public.sim_scenario_runs.timezone is
  'The IANA zone service_date is local to, copied from restaurants.timezone at post time for the same reason.';
