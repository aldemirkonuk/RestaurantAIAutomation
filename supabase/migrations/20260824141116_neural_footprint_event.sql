-- Neural Footprint production store — ADR 0008 (Path C), P1 instrumentation.
--
-- Why this table exists
-- --------------------
-- 325 metric keys are named across the planning corpus and ZERO are produced by a
-- running instrument. "What did this agent's reasoning cost?" is currently not hard
-- but impossible: api_spend holds cost with no agent, decision_log holds reasoning
-- with no cost, and no key joins them.
--
-- This is the single production store from ADR 0006, implemented in the full shape
-- the founder chose (Path C) rather than as three added columns. It records, for any
-- decision-maker: stimulus -> internal state -> choice -> outcome.
--
-- Purely additive. api_spend and decision_log keep their writers and are NOT dropped;
-- migrating off them is a later decision, once this table has real volume.

create table if not exists public.neural_footprint_event (
  id             uuid primary key default gen_random_uuid(),

  -- 'bio' is reserved and unused: NF-C stays gated per ADR 0006 §4.3.
  -- 'operator' added 2026-08-24 — staff/owner product actions ride this same spine,
  -- so page analytics is NF rather than a second store.
  subject_type   text        not null
                 check (subject_type in ('agent','guest','operator','bio')),
  subject_id     text        not null,

  stimulus       text        not null,
  context        jsonb       not null default '{}'::jsonb,
  internal_state jsonb       not null default '{}'::jsonb,
  choice         text        not null,

  -- NULL means UNKNOWN, never success. Doneability is undefined and owned by
  -- People & Agent Ops; a call site that cannot honestly grade itself writes NULL.
  outcome        text        check (outcome in ('success','failure','partial')),

  cost_usd       numeric(10,6),
  input_tokens   integer,
  output_tokens  integer,
  duration_ms    integer,

  correlation_id text,
  restaurant_id  uuid,
  occurred_at    timestamptz not null default now()
);

-- Partial indexes per subject_type: the sparse columns must not cost the dense reads.
create index if not exists nfe_agent_cost
  on public.neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'agent';

create index if not exists nfe_guest_choice
  on public.neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'guest';

create index if not exists nfe_operator_action
  on public.neural_footprint_event (subject_id, occurred_at desc)
  where subject_type = 'operator';

create index if not exists nfe_correlation
  on public.neural_footprint_event (correlation_id)
  where correlation_id is not null;

create index if not exists nfe_restaurant_time
  on public.neural_footprint_event (restaurant_id, occurred_at desc)
  where restaurant_id is not null;

comment on table public.neural_footprint_event is
  'Neural Footprint production store (ADR 0008). One row per decision: stimulus -> internal_state -> choice -> outcome. outcome NULL = unknown, never success.';
