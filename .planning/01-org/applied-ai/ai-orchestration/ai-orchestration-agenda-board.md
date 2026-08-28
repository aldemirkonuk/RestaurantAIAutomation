---
type: agenda-board
division: applied-ai
department: ai-orchestration
status: active
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count, safety.schema_coverage, routing.routed_client_share, fleet.live_agent_ratio]
updated: 2026-08-28
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-agenda-full]]", "[[ai-orchestration-premortem]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-agent-stack]]", "[[ai-orchestration-questions]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]", "[[architecture-review-charter]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]"]
---

# AI Orchestration — Board

**Live board — 2026-08-28.** Tasks and their evidence live in
[[ai-orchestration-agenda-full]]; this page is the query surface and the metric set.
No roll-up number, ever ([[ai-orchestration-charter]] §Metrics).

## Unit status — live query, not a hand-written list

```dataview
TABLE status, type, updated
FROM "01-org/applied-ai/ai-orchestration"
SORT team ASC, type ASC
```

## Teams and their one question

```dataview
TABLE WITHOUT ID
  file.link AS Team,
  status AS Evidence,
  updated AS Updated
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter"
SORT file.name ASC
```

## Loops owned, by close-time

```dataview
TABLE close_time, status
FROM "01-org/applied-ai/ai-orchestration"
WHERE type = "loops"
SORT close_time ASC
```

## Agendas across the department — staleness watch

```dataview
TABLE status, updated
FROM "01-org/applied-ai/ai-orchestration"
WHERE type = "agenda-full" OR type = "agenda-board"
SORT updated ASC
```

## Metric set — measured 2026-08-28, no roll-up by design

Values below are from `python3 scripts/agents/run_card.py` run on 2026-08-28 (the
runner reports; it never edits). Rows that read "not emitted" are **no value**, not a
bad value.

| Metric | Owner | Value 2026-08-28 | Moved since 2026-08-24? |
|---|---|---|---|
| `fleet.live_agent_ratio` | [[agent-fleet-charter]] | **23 / 24** (`modules_on_disk = 24`, `registered = 23`) | Yes — the charter's 26 / ≈18 / 5-stub arithmetic no longer reconciles → **AIO-13** |
| `fleet.orphan_modules` | [[agent-fleet-charter]] | **1** — `recurring_order_agent` | No |
| `harness.agents_without_harness_guarantees` | [[harness-runtime-charter]] | **1** — `recurring_order_agent` | No → **AIO-9** |
| `harness.core_total_lines` | [[harness-runtime-charter]] | **6,556** — the OD-03 sunk-cost meter | Baseline for the diet guard → **AIO-6** |
| `routing.anthropic_url_constants` · `url_constants_outside_wrapper` | [[model-routing-inference-economics-charter]] | **0** · **0** — consolidation holds | Yes — the old "0 / 7 metered" row is superseded by P1's `common/model-client/` |
| `routing.distinct_model_pins_gateway` | [[model-routing-inference-economics-charter]] | **3** over **10** gateway sites, **53** orchestrator sites | → **AIO-18** (OD-04 input, not OD-04's answer) |
| `nf_a.cost_per_task` | [[model-routing-inference-economics-charter]] | **not emitted by task type** — `api_spend` has no `task_type` | Blocked on Track A2 → **AIO-11** |
| `nf_a.doneability_verdict_coverage` | [[agent-evaluation-gates-charter]] | graded-task-type gate **PASS**; per-family coverage **not published** | Yes — a floor exists now → **AIO-16** |
| `nf_a.retries` · `nf_a.dlq_depth` | [[harness-runtime-charter]] | **not emitted**; `dead_letter_queue` has no consumer | No → **AIO-14** |
| `nf_a.task_success_rate` (stubs separately) | [[agent-fleet-charter]] | **not emitted** | No |
| `safety.unconfirmed_mutation_count` | [[action-safety-the-human-gate-charter]] | target hard zero · **unmeasured** (`gate-auditor` unimplemented) | No → **AIO-7** |
| `safety.schema_coverage` | [[action-safety-the-human-gate-charter]] | **unmeasured** — four conventions, one mechanism owed | No → **AIO-8** |
| `skills.firing_rate_30d` | [[skills-charter]] *(consumed)* | **unmeasurable** — `nf_a.skill_id` does not exist | No → finding 3 |

## The spine — Track A1, OD-03

- [ ] **AIO-1** Freeze the workload set from `cards.json` — *2026-09-04*
- [ ] **AIO-2** Carry OD-52's reframe into the scoring axes — *2026-09-04*
- [ ] **AIO-3** Architecture-review adversarial pass, **before the run** — *2026-09-11*
- [ ] **AIO-4** Run the scored bake-off — *2026-09-25* · reach item, contingent on `scripts/bakeoff/`
- [ ] **AIO-5** Resolving ADR; OD-03 becomes a Resolved row — *2026-10-02*
- [ ] **AIO-6** `harness-diet-check` becomes a blocking guard (exit 2 when it cannot check) — *2026-09-11*

## Unblocked now — no dependency on anything outside this department

- [ ] **AIO-7** Implement `gate-auditor`, the last unimplemented aio mechanical card — *2026-09-11*
- [ ] **AIO-10** Instrument time-to-confirm **before** volume arrives — *2026-09-25*
- [ ] **AIO-13** Reconcile the fleet census with the charter; add the count guard — *2026-09-18*
- [ ] **AIO-17** Prove `subscribed_topics_without_publisher` can go red — *2026-09-11*
- [ ] **AIO-14** Name the DLQ consumer — *2026-09-25*

## Blocked, and on what

- [ ] **AIO-4 / AIO-5** — on `scripts/bakeoff/` (Track-A1 protocol agent) and on AIO-3's findings clearing
- [ ] **AIO-11** — on the Track A2 `api_spend.task_type` migration (eng/schema-migrations)
- [ ] **AIO-12** — on SRE's runner cron (Track A4)
- [ ] **AIO-20** — on RM-2 delivering the vendor-reply rubric; wired-and-idle by design
- [ ] `skills.firing_rate_30d` — on `nf_a.skill_id` (RM-3, Track A4)

## Open forks on this board — none resolved here

- [ ] **OD-03** — harness: hermes-agent · deepseek-harness · in-house `base_agent.py`. **Open. No pick.** Read **OD-52's reframe** first.
- [ ] **OD-04** — job → model registry. AIO-18 supplies its input, not its answer.
- [ ] **TECH-F3** — evaluation seam: methodology (R&M) vs operations (here); **merge, never duplicate**
- [ ] **TECH-F6** — guardian agents: Fleet owns the code, SRE owns the findings
- [ ] **TECH-F1 / TECH-F5** — team-layer granularity and 7-vs-3 artifacts

## Watch signals — from [[ai-orchestration-premortem]]

- [ ] `harness.core_total_lines` rises above **6,556** without a bug-fix or instrumentation justification
- [ ] Any agent count quoted outside `services/agent-orchestrator/` without the live/stub split
- [ ] Median time-to-confirm collapsing, or confirmation rate approaching 100%
- [ ] A model ID changed in a commit citing cost and not citing an eval run
- [ ] `doneability_verdict_coverage` reported as one number instead of per task family
- [ ] A checker that has never gone red — `fleet.subscribed_topics_without_publisher = 0` is currently unproven
