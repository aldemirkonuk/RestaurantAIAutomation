-- Self-learning UX optimizer (in-product runtime agent)
--
-- Backs apps/api-gateway/src/ux-optimizer: an agent that watches real UX
-- friction telemetry, PROPOSES SOTA-aligned interface improvements, and — only
-- after a human approves — serves gated runtime overrides the web applies,
-- then measures the outcome and writes what it learned back to a ledger.
--
-- GUARDRAIL (matches the app's "never auto-send" procurement ethos): the agent
-- never applies a change on its own. Proposals require human approval; approved
-- changes ship behind a rollout percentage and a global kill switch; every
-- change is reversible and every outcome is recorded.
--
-- Convention matches 20260717120000_analytics_insight_infra.sql:
-- service-role only (API gateway holds the key), RLS on, no anon policies.

-- ===========================================================================
-- 1. Raw UX friction telemetry (what real users struggle with)
-- ===========================================================================
create table if not exists ux_signals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,                          -- null = anonymous/aggregate
  page text not null,                          -- route key: 'recommendations', 'inventory', ...
  event text not null,                         -- rage_click | dead_click | abandon | slow_tti
                                               -- | task_success | task_fail | error | nav
  target_key text,                             -- stable slot key or element path
  value numeric,                               -- metric value (ms for timing, 1 for counts)
  session_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ux_signals_page
  on ux_signals (page, created_at desc);
create index if not exists idx_ux_signals_restaurant
  on ux_signals (restaurant_id, page, created_at desc);

-- ===========================================================================
-- 2. Agent-proposed UX changes — PROPOSED ONLY, never auto-applied
-- ===========================================================================
create table if not exists ux_proposals (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,                          -- null = global/default proposal
  page text not null,
  kind text not null,                          -- copy | default | surface | layout | affordance
  target_key text not null,                    -- stable slot the web knows how to render
  title text not null,
  rationale text not null,                     -- grounded in the signal summary + SOTA rubric
  change jsonb not null default '{}'::jsonb,   -- the concrete patch to apply IF approved
  evidence jsonb not null default '{}'::jsonb, -- signal summary that motivated the proposal
  confidence numeric(4, 3),                    -- 0..1
  source text not null default 'heuristic',    -- heuristic | llm
  status text not null default 'proposed',     -- proposed | approved | rejected | live | rolled_back
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ux_proposals_status
  on ux_proposals (status, created_at desc);
create index if not exists idx_ux_proposals_page
  on ux_proposals (page, status);

-- ===========================================================================
-- 3. Approved runtime overrides the web reads (gated by rollout + kill switch)
-- ===========================================================================
create table if not exists ux_overrides (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,                          -- null = applies to all restaurants
  page text not null,
  target_key text not null,
  kind text not null,
  patch jsonb not null default '{}'::jsonb,    -- what the web applies (copy/default/etc.)
  enabled boolean not null default true,
  rollout_pct int not null default 10,         -- 0..100 gradual rollout by session bucket
  proposal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT so global overrides (restaurant_id NULL) dedupe on the
  -- approve-upsert instead of inserting duplicates (Postgres 15+).
  constraint ux_overrides_rest_page_target_uniq
    unique nulls not distinct (restaurant_id, page, target_key)
);

create index if not exists idx_ux_overrides_active
  on ux_overrides (page) where enabled;

-- ===========================================================================
-- 4. Append-only learnings ledger — the agent's self-learning memory
-- ===========================================================================
create table if not exists ux_learnings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,
  page text,
  target_key text,
  proposal_id uuid,
  hypothesis text not null,                    -- what we believed would improve
  outcome text,                                -- improved | neutral | regressed | inconclusive
  metric text,                                 -- which friction metric was measured
  baseline numeric,
  observed numeric,
  lift_pct numeric(8, 4),
  verdict text,                                -- keep | revert | iterate
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ux_learnings_page
  on ux_learnings (page, created_at desc);

-- ===========================================================================
-- RLS — service-role only (API gateway mediates all access)
-- ===========================================================================
alter table ux_signals enable row level security;
alter table ux_proposals enable row level security;
alter table ux_overrides enable row level security;
alter table ux_learnings enable row level security;
