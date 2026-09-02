---
type: charter
division: applied-ai
department: ai-orchestration
status: exists
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.retries, nf_a.dlq_depth, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count]
updated: 2026-08-24
links: ["[[ai-orchestration-premortem]]", "[[ai-orchestration-agenda-full]]", "[[ai-orchestration-agenda-board]]", "[[ai-orchestration-directive]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-schedule]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]", "[[skills-charter]]", "[[engineering-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[ORG_STRUCTURE]]", "[[technology]]", "[[README]]"]
---

# AI Orchestration — Charter

Parent division: **Applied AI** ([[ORG_STRUCTURE]] §2). Sibling in-division: [[skills-charter]].

## Mandate

AI Orchestration owns **L3** — the layer between a model and the product
([[README]] §1). It is accountable for the substrate agents run on, the agents
themselves, which model runs which task at what price, whether a task was
*actually* done, and whether the agent was *allowed* to do it. Engineering builds
the thing an agent acts on; this department builds the agent, the harness under it,
the meter beside it, and the gate in front of it.

The department's centre of gravity is a single asymmetry: **an agent that is
registered, healthy, retried, and cheap can still be doing nothing, doing it wrong,
or doing something nobody approved.** Four of the five teams exist because "it ran"
and "it worked" and "it was permitted" are three different questions with three
different owners.

## Boundaries

Owns outright:

- **The harness** — `services/agent-orchestrator/core/` (11 modules, 6,375 lines):
  `base_agent.py` (1,053), `message_bus.py` (1,008), `orchestrator.py` (688),
  `agent_registry.py` (491), `connection_pool.py` (409), `observability.py` (383),
  `outbox_publisher.py` (112), `notifications.py` (143), `pos_provider.py` (28),
  `database.py` (2,046).
- **The fleet** — `services/agent-orchestrator/agents/` (26 modules; 25 subclass
  `BaseAgent`, 1 does not).
- **Model access and its cost** — `services/agent-orchestrator/services/model_clients.py`,
  `spend_logger.py`, `jobs/spend_tasks.py`, `jobs/haiku_tasks.py`, and the routing
  policy that does not yet exist.
- **Doneability in operation** — the CI eval gates, gold sets, shadow-vs-live runs.
- **The human gate** — the `ask → propose → confirm → execute` boundary
  (`.planning/FUTURES.md` §8.1) and everything that enforces it.

Structured as **five teams, which are five different questions about one agent action**:

| Team | The question it owns |
|---|---|
| [[harness-runtime-charter]] | *Can it run?* — lifecycle, retry, DLQ, sagas, registry |
| [[agent-fleet-charter]] | *Did it do the job?* — behavior, prompts, subscriptions |
| [[model-routing-inference-economics-charter]] | *At what cost, on which model?* |
| [[agent-evaluation-gates-charter]] | *How do we know it worked?* — gates in CI and prod |
| [[action-safety-the-human-gate-charter]] | *Was it allowed to run at all?* |

Harness/Fleet is the sharpest internal split and is deliberate: a harness bug
degrades all agents identically, an agent bug degrades one
(`.planning/foundation/teams/technology.md:316-317`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| L1 domain core, L2 modules, L6 surfaces, the schema | [[engineering-charter]] | We build the agent; they build what it acts on |
| L0 substrate, corpora, telemetry ingest | [[data-charter]] | We consume rows; Data makes them fit to use |
| Running it in production — observability, release, resilience | [[reliability-sre-charter|reliability-charter]] | We author the harness; SRE operates the deployment |
| **NF-A metric methodology and the definition of doneability** | [[research-math-charter|research-and-math-charter]] *(Intelligence)* | They define what a verdict *means*; [[agent-evaluation-gates-charter]] enforces it in CI and prod. **This line is contested — see below.** |
| The `SKILL.md` contract, registry, lifecycle | [[skills-charter]] | Whether a skill *can* be loaded is harness mechanics; whether it *should exist* is theirs |
| Findings and alert thresholds of guardian agents | `[[state-integrity-invariants-charter|sre-state-integrity]]` | We own `state_invariant_enforcer` / `drift_agent` / `inequality_detector` **code**; SRE owns their **findings** (fork TECH-F6) |
| That a message *arrived* once | `[[messaging-delivery-charter|eng-messaging-delivery]]` | We own what it says; they own that it is delivered exactly once (`technology.md:861`) |
| Grading data rows | `[[substrate-quality-coverage-charter|dat-substrate-quality]]` | Task outcome ≠ row quality (`technology.md:862`) |
| Finding and classifying security gaps | [[security-charter]] *(Intelligence)* | Security classifies; [[action-safety-the-human-gate-charter]] owns the mutation gate specifically |

### The non-goal that is not settled — TECH-F3, carried forward unsoftened

[[agent-evaluation-gates-charter]] overlaps **Research & Math** in the Intelligence
division, which [[README]] §2.2 already assigns NF-A and task-doneability. The line
this department draws is **methodology (R&M) vs. operations (here)**:
R&M defines what a doneability verdict means and how NF-A is computed; this
department runs the gates that emit and enforce those verdicts in CI and production.

**If that line proves unworkable, the correct fix is to merge
[[agent-evaluation-gates-charter]] into Research & Math — not to duplicate it.**
That instruction is `technology.md:406` verbatim in intent and is repeated here so it
survives the copy. Duplication is the worse outcome than either answer
(`technology.md:845`).

> ✅ **ID collision resolved — this fork is `TECH-F3`.** `technology.md:845` originally
> numbered it **OD-21**, but `.planning/decisions/OPEN-DECISIONS.md:144` already uses
> **OD-21** for the Obsidian structural workflow (locked in [[OBSIDIAN_VAULT]]). The
> Decision Office renamespaced the evaluation-seam fork to **TECH-F3**
> ([[FORK-REGISTRY]]). Raised in [[ai-orchestration-agenda-full]] §Questions.

## Metrics it moves

This department is the primary producer of **NF-A** ([[README]] §4.2) and therefore
of the metric spine every other department is judged by. That is a dependency worth
stating: **L4 emits nothing yet** ([[README]] §1), so most numbers below have no
value, not a bad value. *Corrected 2026-08-25: L4 emits since P1
(`model-client.service.ts:413`). What is still near zero is **verdict coverage**,
not emission ([[0017-doneability-verdicts-are-sidecar-claims]]).*

| Metric | Owner team | Today |
|---|---|---|
| `nf_a.retries`, `nf_a.dlq_depth` per agent-hour | [[harness-runtime-charter]] | fields exist in the NF-A schema; not emitted |
| `nf_a.task_success_rate` per agent, **stubs reported separately** | [[agent-fleet-charter]] | not emitted |
| `nf_a.cost_per_task` by task type | [[model-routing-inference-economics-charter]] | not emitted; see below |
| `routing.routed_client_share` — share of model calls through one routed client | [[model-routing-inference-economics-charter]] | **well under 100%**, verified |
| `nf_a.doneability_verdict_coverage` — share of tasks emitting a machine-checkable verdict | [[agent-evaluation-gates-charter]] | near zero outside the merge-policy gate |
| `safety.unconfirmed_mutation_count` — agent write to stock/money/outbound without recorded human confirmation | [[action-safety-the-human-gate-charter]] | **target hard zero**; unmeasured |
| `fleet.live_agent_ratio` — modules that can receive a message ÷ modules on disk | [[agent-fleet-charter]] | ≈18/26, verified below |

**No roll-up number.** Retries, cost, doneability and unconfirmed mutations are not
commensurable, and averaging them would let a green cost number hide a red safety
number. The department metric is the **set**, on one board
([[ai-orchestration-agenda-board]]).

## Evidence today

Graded per `technology.md:33-35`: **EXISTS** = running with an artifact ·
**PARTIAL** = stub or fraction of mandate · **NEW** = proposal only.

**Roll-up: EXISTS, and this is the most mature L3 asset in the repo** — with the
measurement layer above it missing entirely.

- **EXISTS — the harness.** `core/base_agent.py` 1,053 lines: lifecycle
  `start/stop/pause/resume/restart` (`:348-436`), `_process_with_retry` (`:543`),
  idempotency (`:704`), DLQ (`:791`), sagas (`:823-905`), event append (`:944`),
  health (`:985-1035`). `core/agent_registry.py`: `AgentTier` (`:27`),
  `LazyAgentProxy` (`:162`), `AgentRegistry` (`:299`), `get_startup_order` (`:401`).
  `core/message_bus.py`: `CircuitBreaker` (`:188`), DLQ declaration (`:524`).
  80 pytest files.
- **EXISTS / PARTIAL — the fleet.** 26 modules on disk. 25 declare
  `class …(BaseAgent)`. **5 are declared stubs** whose `process_message()` only logs:
  `auto_pilot_agent.py`, `compliance_agent.py`, `ghost_inventory_agent.py`,
  `negotiation_playbook_agent.py`, `shrinkage_detective_agent.py`.
- **EXISTS, fragmented — model access.** `services/model_clients.py:52,73,93`
  (`get_gemini_client`, `get_haiku_client`, `get_haiku_semaphore(5)`);
  `services/spend_logger.py` is the single insertion point into `api_spend`
  (`supabase/migrations/20260805000000_baseline_from_production.sql:2231`).
- **EXISTS, scattered — evaluation.** `scripts/eval_merge_policies.py` **is already a
  CI gate** (`.github/workflows/ci.yml:226-230`); `scripts/eval_guest_merge_policies.py`
  runs in `.github/workflows/schema-parity.yml:149`. Plus
  `scripts/benchmark_haiku_vs_sonnet.py`, `scripts/claude_vision_benchmark.py`,
  `datasets/scripts/eval_model.py`.
- **EXISTS as pattern / NEW as one schema — the human gate.**
  `apps/api-gateway/src/one-tap-actions/` (9 routes, `@UseGuards(JwtAuthGuard)` at
  controller level `:64`), `executeAction` at `one-tap-actions.service.ts:230` with
  `executed_at`/`executed_by` (`:245-246`) and an `action_executed` event (`:267`).
  Tiered autonomy already written into `agents/drift_agent.py:8-12` —
  *"Money / stock → `drift_findings` with status `open` (never auto-applied)"*.
- **NEW — L4.** No NF-A event is emitted anywhere ([[README]] §1). Every metric in
  the table above except `routing.routed_client_share` and `fleet.live_agent_ratio`
  is currently uncomputable.

### Three corrections to the evidence brief, verified this session

1. **The fleet's live count is lower than 21.** `technology.md:344-345` lists 21 live
   agents. On disk, `core/orchestrator.py:174-211` registers **23** agent classes —
   and **3 modules are registered nowhere and referenced by nothing but their own
   tests**: `book_scraper_agent.py`, `dataset_creator_agent.py`,
   `recurring_order_agent.py`. Of the 23 registered, 5 are the gated-off stubs. So
   the number of modules that can actually receive a message is **≈18 of 26**, not 21.
   The repo says this about itself at `core/orchestrator.py:214-217`:
   *"Registered is not the same as running… which is how 'registered' came to be
   mistaken for 'live.'"* → [[agent-fleet-charter]].
2. **`recurring_order_agent.py:14` is a plain class**, not a `BaseAgent` subclass. Its
   own docstring is honest about it (*"Standalone scheduler — not a message-bus
   agent"*), but the consequence is that it gets **no retry, no idempotency, no DLQ,
   no health check, and no NF-A event** — while owning scheduled *purchasing*. That
   is the single highest-consequence gap in the department.
   → [[harness-runtime-charter]] + [[action-safety-the-human-gate-charter]].
3. **The gateway model call sites are 7, not 8 — and zero of them meter.**
   `technology.md:379` says 8 files. Seven issue real calls
   (`analytics/consultants.service.ts:28,159`, `common/orchestrator/inbound-responder.service.ts:16,338`,
   `inventory/photo-count.service.ts:9,60`, `menus/parsers/scan-parser.service.ts:10,261`,
   `procurement/documents/document-extractor.service.ts:27,117`,
   `ux-optimizer/ux-optimizer.service.ts:44,266`,
   `vendor-intel/vendor-page-extractor.service.ts:13,179`); the eighth,
   `common/orchestrator/health-proxy.controller.ts:48`, only reads the key for a
   health readout. **All 7 declare their own `https://api.anthropic.com/v1/messages`
   constant, and none of the 7 writes to `api_spend`.** `SpendLogger` is Python-only.
   → [[model-routing-inference-economics-charter]].

## Open forks touching this department

- **OD-03 — the harness choice is open.** `NousResearch/hermes-agent` vs
  `deepseek-ai/deepseek-harness` vs extending in-house
  `services/agent-orchestrator/core/base_agent.py`
  (OD-03, `.planning/decisions/OPEN-DECISIONS.md:27`). **This charter does not pick one.**
  The resolution path named in the decision log is *"a scoped bake-off on this repo's
  actual workloads. No pick from repute"* — and this department owns running it. See
  [[ai-orchestration-directive]] §The harness fork.
- **OD-04 — external model roster.** No longer stated as downstream of OD-03: the row's
  unblocker is now a **job → model registry** (OD-04, `OPEN-DECISIONS.md:28`).
  → [[model-routing-inference-economics-charter]].
- **The evaluation seam** (**TECH-F3**; numbered OD-21 in `technology.md:845`, collision noted
  above) — methodology vs. operations, or one team in Intelligence.
- **TECH-F6 — guardian-agent co-ownership.** Fleet owns the code, SRE owns the findings
  (`technology.md:848`).
- **TECH-F5** — does the team layer get all 7 artifacts, or 3? This vault answers "7";
  the fork is not closed (`technology.md:847`).
