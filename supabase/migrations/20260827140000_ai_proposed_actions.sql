-- ai_proposed_actions — Ask AI's proposal ledger (P3.C, FUTURES §8).
--
-- THE PRINCIPLE THIS TABLE ENFORCES
-- ---------------------------------
-- FUTURES §8.1: "Ask → propose → confirm → execute. AI never silently mutates
-- stock, money, or outbound vendor email. Confirmation is the gate; existing
-- services are the executors."
--
-- That sentence is a rule, and a rule that lives only in application code is one
-- a future call site forgets. The CHECK constraint below makes it structural:
-- a row cannot reach `executed` without carrying a `confirmed_by` and a
-- `confirmed_at`. Not a convention, not a code review — the database refuses.
--
-- This repo has found the same shape too many times to leave it to prose: a
-- spend cap whose join key matched zero rows, a revoke that reported success on
-- a 404, a "never auto-send" comment beside code that auto-sends. The gate has
-- to be somewhere it cannot be walked around.
--
-- WHY A DEDICATED TABLE AND NOT recommendation_actions
-- ----------------------------------------------------
-- Founder call 2026-08-27. `recommendation_actions` models "the system noticed
-- something and the user reacted"; this models "the user asked for something
-- and the system proposed". They share a lifecycle vocabulary and nothing else:
-- overloading one table would make both harder to query and to reason about,
-- and the act/dismiss/snooze semantics do not fit a proposal that must be
-- executed exactly once.

create table if not exists public.ai_proposed_actions (
  id                uuid primary key default gen_random_uuid(),

  restaurant_id     uuid not null,
  created_by        uuid,

  -- The ask, VERBATIM. Kept because a proposal that turns out wrong can only be
  -- judged against what was actually said — not against a normalised intent the
  -- parser already decided. This is the evidence half of an auditable action.
  utterance         text not null,

  -- Typed and allowlisted (FUTURES §8.2). The MVP families are procurement and
  -- communications: both have executors that ALREADY exist and are already
  -- human-gated, so the new machinery here is only the proposal layer.
  -- Widening this CHECK is a deliberate edit, which is the point.
  family            text not null check (family in ('procurement', 'communications')),
  action_type       text not null,

  -- What the executor will be handed, already validated against the action's
  -- schema. Never free text for the executor to re-parse.
  payload           jsonb not null default '{}'::jsonb,

  -- One line for the confirm card. Written by the proposer, shown to the human,
  -- and stored so the record says what the person was actually agreeing to
  -- rather than what a later reader reconstructs from the payload.
  summary           text not null,

  status            text not null default 'proposed'
                    check (status in ('proposed', 'confirmed', 'executed', 'discarded', 'failed')),

  confirmed_by      uuid,
  confirmed_at      timestamptz,
  executed_at       timestamptz,

  -- What the executor created — an order id, a conversation id. The link back
  -- into the product, so "what did this action actually do" is answerable.
  execution_ref     text,
  failure_reason    text,

  -- Retry-safe by construction, same reasoning as spot counts (decision E43):
  -- a confirm retried over flaky signal must not execute twice. Client-supplied
  -- so a retry carries the SAME key rather than minting a new one.
  idempotency_key   text not null unique,

  -- Gradable from day one (OD-59). This is the reason P3.C sat behind P3.0:
  -- an action-creating agent whose success signal is "HTTP 200" is this repo's
  -- signature defect promoted to a product surface.
  --
  -- ON DELETE SET NULL, deliberately NOT cascade. A verdict is a claim ABOUT an
  -- event and dies with it (see nf_verdict); a proposed action is a thing a
  -- PERSON asked for, and deleting an instrumentation row must never delete it.
  nf_event_id       uuid references public.neural_footprint_event(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- THE GATE, in the database.
  constraint ai_proposed_actions_execution_requires_confirmation check (
    status <> 'executed'
    or (confirmed_by is not null and confirmed_at is not null and executed_at is not null)
  ),

  -- A confirmed row must say who confirmed it. Splitting this from the rule
  -- above keeps the failure message specific about which half is missing.
  constraint ai_proposed_actions_confirmation_is_attributed check (
    status not in ('confirmed', 'executed')
    or (confirmed_by is not null and confirmed_at is not null)
  )
);

-- The open queue for one restaurant: what has been proposed and not yet
-- resolved. Partial, because resolved rows are history and are never read this
-- way — they only accumulate.
create index if not exists ai_proposed_actions_open
  on public.ai_proposed_actions (restaurant_id, created_at desc)
  where status = 'proposed';

comment on table public.ai_proposed_actions is
  'Ask AI proposals (FUTURES §8). Ask → propose → confirm → execute; the execution_requires_confirmation CHECK makes the confirm gate structural rather than a convention. Executors are the existing services; this table only records what was asked, what was proposed, and what a human decided.';

comment on column public.ai_proposed_actions.utterance is
  'The ask verbatim. A wrong proposal can only be judged against what was actually said, not against the intent the parser already settled on.';

comment on column public.ai_proposed_actions.idempotency_key is
  'Client-supplied so a confirm retried over flaky signal carries the SAME key and cannot execute twice (same reasoning as spot counts, decision E43).';

comment on column public.ai_proposed_actions.nf_event_id is
  'The footprint row for the model call that produced this proposal, so proposal quality is gradable (OD-59). SET NULL on delete: an action a person asked for must not disappear because an instrumentation row was pruned.';

-- ---------------------------------------------------------------------------
-- RLS in the SAME migration that creates the table (the OD-73 house rule: a
-- table arrives locked or it does not arrive). This one carries restaurant_id
-- and user ids — it is tenant data, and it records intent to spend money.
alter table public.ai_proposed_actions enable row level security;

drop policy if exists ai_proposed_actions_service_role on public.ai_proposed_actions;
create policy ai_proposed_actions_service_role on public.ai_proposed_actions
  for all to service_role using (true) with check (true);

-- No `authenticated` policy: the browser reaches this only through the gateway,
-- which is the posture ADR 0012 settled for generated_reports. When a direct
-- client read is wanted, that is a decision with an ADR and a
-- restaurant-isolation policy — not a bare `using (true)`.
--
-- No REVOKE: OD-72's `alter default privileges` ratchet (20260825210000:183)
-- means anything created after it arrives with no client grants already.
