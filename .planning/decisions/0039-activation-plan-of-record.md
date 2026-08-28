# 0039 — Activation plan of record: harden the spine, and every department writes its own agenda

- **Status:** Locked — founder, in-session 2026-08-28 (AskUserQuestion ×2): scope
  (all four hardening items + the department-activation wave), canvas form,
  sequencing, wave crew, and both deferral locks confirmed.
- **Date:** 2026-08-28
- **Decider:** Aldemir (founder)
- **Keywords:** plan-of-record, od-03, spend-spine, action-schema, skill-id, wave-3, agendas, canvases, activation
- **Links:** [[0029-p3-plan-of-record]] (P3 stays the product plan; its P3.0 gate closed 2026-08-27), [[0034-agent-stack-artifact]], [[0036-cost-routing-two-plans-in-harmony]], [[0038-cards-run-as-declared-scripts]], `foundation/GENERATION_BRIEF.md` §8

## Context

The card layer exists and runs (ADR 0034/0038): 102 declared agents, 8 mechanical
ones executing, first skills and memory landed. What the org still lacks is
(a) the four architecture debts every measurement points at, and (b) **work** —
198 agenda files still open with `PROVISIONAL — no work done yet`. The founder's
mandate for this plan: department-specific, creative, ambitious agendas authored
by each department's own agent, plus a canvas per department — *plan first,
build after*. This ADR is the plan of record, in the ADR-as-plan form P2 and P3
used (ADR 0018/0029). It does not touch P3: P3's unlocked lanes (mobile parity,
kitchen, Ask AI stage) run as product work alongside.

## The plan — two tracks, parallel (founder-picked; disjoint files, both async)

### Track A — architecture hardening (engineering; five items, each ends in an ADR or a migration+guard)

| # | Item | Owner (per existing charters/ADRs) | Deliverable | Done when |
|---|---|---|---|---|
| A1 | **OD-03 bake-off** — the reasoning layer on our messaging infra (OD-52's reframe) | aio/harness-runtime runs it; [[architecture-review-charter]] adversarial pass; RM-1 supplies methodology (ADR 0036 line) | A bake-off harness scoring candidates against `cards.json` (102 declared specs = the workloads), a scored run, and the resolving ADR | OD-03 is a Resolved row. The core/ diet holds throughout |
| A2 | **One spend/verdict spine** — the ledgers differ in grain (filed under OD-29) | eng/schema-migrations (migration) + aio-model-routing (producer per ADR 0036) | `api_spend` gains `task_type`; one joined cost-per-task view; a parity guard | Finance's `spend-ledger-auditor` card can read one number end-to-end |
| A3 | **The single action schema** — four conventions, one mechanism | aio/action-safety (the gate) + engineering (the executors, per FUTURES §8.1) | One typed propose→confirm→execute schema behind every mutation entry point; `recurring_order_agent` brought inside BaseAgent *and* the action center | `safety.schema_coverage` = measured 100%; the named highest-consequence gap is closed |
| A4 | **`nf_a.skill_id` + runner cron** | RM-3 nf-instrumentation (the column — OD-11 path; requested, never designed by Skills) + SRE (a `loop-watcher.yml`-sibling cron for `run_card.py`) | The column, the weekly tick, and `skills.firing_rate_30d` computable | staleness-reaper's rows stop reading "unmeasurable" |
| A5 | **First judgment rubric** — vendor-reply family | RM-2 evaluation-doneability defines; aio-evaluation-gates operates (TECH-F3 line, untouched) | A rubric + gate for the commercially load-bearing family extraction never covered | The family has a verdict basis better than `call_level_v0` |

Internal order: A2 and A4 are small — start immediately; A1 is the long pole —
start immediately, it unblocks the org; A3 mid-track; A5 as RM-2 staffs it.
Nothing in Track A may extend `core/` while A1 runs (the OD-03 diet).

### Track B — Wave 3: every department writes its own agenda, with a canvas

Contract in `GENERATION_BRIEF.md` §8 (amended alongside this ADR). Shape:

- **Scope:** all 21 department-level units + 3 advisory. Each department's agent
  (a dedicated opus subagent per department — the crew form waves 1 and 2 proved)
  rewrites its `agenda-full`/`agenda-board` from `PROVISIONAL` to a real,
  **department-specific, ambitious** first agenda — seeded per unit in §8.3,
  expanded by the agent from its own charter/directive/cards — and produces
  **one HTML canvas per department** in `.planning/sketches/` under the existing
  MANIFEST conventions (the founder-picked form; the atlas, ADR 0033, proves it).
- **Quality bar:** every agenda task names its doneability and a close_time,
  cites evidence per the §3.3 discipline (no speculative programs), feeds the
  unit's cards/loops (a task no card or loop can carry is a finding, not a task),
  and respects every lock: **the pricing model stays deferred and brand/landing
  visuals stay held** (founder re-confirmed 2026-08-28) — agendas may research
  payment rails and do brand-voice groundwork, and may *prepare the unlock case*,
  never act past a lock.
- **The agendas are the departments thinking** — design thinks brand voice and a
  sketch program, finance thinks payment options and unit-economics inputs,
  client-surfaces thinks per-page UI compatibility, security thinks the 40
  remaining unguarded endpoints — the founder's examples, generalized in §8.3's
  seed table.

## Options considered

1. **This plan** *(chosen)*.
2. **Hardening first, agendas later** — serializes docs behind engineering for no
   dependency reason; rejected by the founder.
3. **A standing session-handoff doc alongside** — rejected with the founder's
   agreement: STATE.md + the decision register + project memory + one-off
   `04-specs/HANDOFF-*.md` files *are* the handoff; a new standing doc would
   duplicate all four and rot (the register-rot lesson, learned twice).
4. **Doing nothing** — leaves 198 `PROVISIONAL` agendas and four measured debts
   exactly where they are.

## Decision

Run Tracks A and B in parallel as specified. Wave 3 executes as ~24 opus
subagents against §8 in a dedicated session (**plan first, build after** — this
ADR and §8 are the plan; no wave file is written under this ADR's commit).

## Consequences

- Easier: the org's task layer stops being provisional; the four debts get owners,
  order, and done-conditions; A1's resolution unblocks every agent-runtime question.
- Harder / owed: a wave-3 session (or several) to execute; canvas sprawl risk —
  bounded by one canvas per department, manifested, and the sketch conventions.
- Revisit when A1's bake-off reports — its ADR may reshape A3/A4 surfaces; and
  after wave 3 lands, the agenda-staleness watcher (`watch_loops.py`) becomes the
  live check that agendas do not re-rot into provisional.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-28 | Founder (AskUserQuestion, in-session) | Scope, canvas form (HTML sketches), parallel sequencing, subagent crew, both locks kept — all picked |
| 2026-08-28 | — | Created |
