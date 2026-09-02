---
type: agenda-full
division: applied-ai
department: ai-orchestration
status: active
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count, safety.schema_coverage, routing.routed_client_share, fleet.live_agent_ratio]
updated: 2026-08-28
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-premortem]]", "[[ai-orchestration-agenda-board]]", "[[ai-orchestration-directive]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-schedule]]", "[[ai-orchestration-agent-stack]]", "[[ai-orchestration-questions]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]", "[[architecture-review-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[decision-office-charter]]", "[[skills-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0034-agent-stack-artifact]]", "[[0038-cards-run-as-declared-scripts]]", "[[technology]]", "[[README]]"]
---

# AI Orchestration — Full Agenda

**Agenda of record — 2026-08-28.** Authored by this department under
[[0039-activation-plan-of-record]] Track B, against `foundation/GENERATION_BRIEF.md` §8.
It replaces the 2026-08-24 provisional forecast. Every task below names a
**doneability**, a **close_time**, and the **evidence** that makes it real; a task
that could not name all three was deleted rather than softened.

---

## 0. What changed between the forecast and this agenda

The provisional agenda's central claim — *"L4 emits nothing yet, four of six metrics
are uncomputable"* — **is no longer true**, and neither are four of its supporting
numbers. Measured this morning by running the card layer itself
(`python3 scripts/agents/run_card.py`, 2026-08-28, no flags — the runner reports and
never edits):

| Claim in the 2026-08-24 corpus | Measured 2026-08-28 | Consequence |
|---|---|---|
| 26 agent modules on disk, ≈18 can receive a message, 5 declared stubs | `fleet.modules_on_disk = 24`, `fleet.registered = 23`, `fleet.live_agent_ratio = 23/24`, **stub heuristic flags none** | The charter's fleet arithmetic no longer reconciles with disk. → **AIO-13** |
| 7 gateway call sites, each with its own `https://api.anthropic.com/v1/messages` constant, **0 of 7** metered | `routing.anthropic_url_constants = 0`, `routing.url_constants_outside_wrapper = 0` | P1's `common/model-client/` consolidation **holds**. Step 2 of the old agenda is done; the successor task is `task_type` on the ledger, not routing. → **AIO-11** |
| Merge-policy gate at `.github/workflows/ci.yml:226-230` | The gate still runs; it now lives at `.github/workflows/ci.yml:555` | Citation drift, not a regression. Recorded, not silently repaired — the charter is not this wave's to edit. |
| `nf_a.doneability_verdict_coverage` near zero | `check_task_types_are_graded.py` exits 0 — **every emitting task type is graded or knowingly exempt** | Coverage has a floor now. The uncovered half is *judgment* families. → **AIO-16** |

Two numbers that did **not** move, and both are this agenda's centre of gravity:

- `harness.agents_without_harness_guarantees = 1` and `fleet.orphan_modules = 1` — the
  same module, `recurring_order_agent`, still owning scheduled **purchasing** with no
  retry, no idempotency, no DLQ, no health check, no NF-A event, and no human gate.
- `skills.firing_rate_30d = unmeasurable — nf_a.skill_id does not exist`.

---

## 1. The spine — Track A1, the OD-03 bake-off

[[0039-activation-plan-of-record]] Track A1 assigns this department the bake-off:
*"aio/harness-runtime runs it; architecture-review adversarial pass; RM-1 supplies
methodology."* This agenda **owns running it, the adversarial pass, and the resolving
ADR**. It does **not** own designing the protocol — a Track-A1 agent is producing the
bake-off protocol and scoring skeleton in parallel at `scripts/bakeoff/`. Rewriting
that here would be exactly the duplication `technology.md:845` forbids.

> **The OD-03 diet holds through every task on this page.** While the fork is open,
> `services/agent-orchestrator/core/` takes bug fixes, instrumentation, and interface
> *narrowing* only ([[ai-orchestration-directive]] §The harness fork, node G).
> **No task in this agenda extends `core/`** — checked deliberately, task by task.
> `harness.core_total_lines = 6556` (measured 2026-08-28) is the meter; a rise in that
> number without a bug-fix or instrumentation justification is a breach, not a delta.

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-1** | **Freeze the workload set.** Choose the bake-off's workloads from `00-index/cards.json` — 102 declared agent specs across 100 units, `{mechanical: 36, extraction: 36, judgment: 30}` — and commit the selection as data, not prose. | A committed workload manifest where **every** row traces to a `cards.json` agent row by name, carries its `routing_class`, and states why it is in or out. A workload with no card is rejected at review. | **2026-09-04** | `.planning/00-index/cards.json` (`card_count: 102`, `routing_class_counts`); [[0038-cards-run-as-declared-scripts]] |
| **AIO-2** | **Carry OD-52's reframe into the scoring axes.** OD-52 records that `core/base_agent.py` has *zero* LLM integration — it is RabbitMQ/saga/DLQ infrastructure, while the two external candidates are *reasoning* harnesses. The comparison is therefore "which reasoning layer sits on our messaging infra", and the in-house arm must be defined as what it actually means after that reframe. | The protocol's scoring rubric names OD-52 explicitly, and each of the three arms has a written definition a reader can dispute. No axis compares a message bus to a reasoning loop. | **2026-09-04** | `decisions/OPEN-DECISIONS.md:41` (OD-52), `:26` (OD-03) |
| **AIO-3** | **The adversarial pass — before the run, not after.** Route the frozen protocol to [[architecture-review-charter]] and treat its findings as a gate. | Every AR finding lands as a dated row in [[ai-orchestration-questions]] with a written disposition: fixed, or accepted in writing with a named owner and a date. **The run may not start while an AR finding is Open.** | **2026-09-11** | ADR 0039 Track A1 row (*"architecture-review-charter adversarial pass"*); `GENERATION_BRIEF.md` §8.3 assigns architecture-review the same pass from its side |
| **AIO-4** | **Run it.** Execute the scored run over the frozen workloads. | A committed, re-runnable scored artifact: per-workload score, cost, and harness overhead per arm, produced by `scripts/bakeoff/`. **No arm may carry a score derived from repute** — an unrunnable arm is recorded as unrunnable, never estimated. | **2026-09-25** | OD-03, `decisions/OPEN-DECISIONS.md:27` — *"A scoped bake-off on this repo's actual workloads. No pick from repute."* **Reach item — see §6.1** |
| **AIO-5** | **Land the resolving ADR and close the row.** | An ADR in `.planning/decisions/` (next free number) citing the AIO-4 artifact, with the rejected arms argued rather than listed; OD-03 moves to the Resolved table with a dated line; `scripts/check_od_ids_exist.py`, `check_decision_claims.sh` and `check_citation_pairing.py` all pass afterwards. | **2026-10-02** | ADR 0039 A1 done-condition (*"OD-03 is a Resolved row"*); register-guard discipline per the two guards `claim-auditor` already wraps |
| **AIO-6** | **Make the diet a guard, not a sentence.** `harness-diet-check` is listed as a *candidate* skill in [[ai-orchestration-schedule]] and enforces nothing. Turn it into a blocking check on PRs that add a **new capability** to `core/` while OD-03 is open. | The guard is wired into CI, **exits 2 when it cannot check** rather than passing, and is proven against a pre-fix tree — a synthetic PR adding a `BaseAgent` method must fail it. It deletes itself when OD-03 closes ([[ai-orchestration-schedule]] §Ownership seam). | **2026-09-11** | [[ai-orchestration-premortem]] #1; the five `check_*.sh` guards are the shape; the guard is a script, not a `core/` extension — diet-safe |

**Why the spine is the spine.** [[ai-orchestration-premortem]] #1 is not "we pick
wrong", it is "the fork stays open by ordinary gravity while `base_agent.py`
accumulates work a later decision throws away". AIO-6 is the counter-pressure that
works even if AIO-4 slips; AIO-1/2/3 are the counter-pressure against the *other*
failure, running a misconceived bake-off fast enough to look decisive.

---

## 2. Track A3 — the single action schema (co-owned)

ADR 0039 A3: *"aio/action-safety (the gate) + engineering (the executors)"*, done when
`safety.schema_coverage` is a **measured** 100% and the named highest-consequence gap
is closed. Today the guarantee is upheld by **four independent conventions, not one
mechanism** (`technology.md:441`).

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-7** | **Implement `gate-auditor` — the last unimplemented aio mechanical card.** `run_card.py` declares 36 mechanical cards and implements 8; of the six aio-department cards, `gate-auditor` is the only mechanical one still unimplemented. | `python3 scripts/agents/run_card.py --agent gate-auditor` runs, emits `safety.schema_coverage` and `safety.unconfirmed_mutation_count`, and — per its own card's quality bar — prints **`unmeasured`, never `0`**, for any family with no instrumentation. `--write-memory` lands one fact per durable finding. | **2026-09-11** | `run_card.py:333-342` (`IMPLEMENTED`), `:390` (`mechanical_unimplemented`); `cards.json` — `gate-auditor`, `routing_class: mechanical`, 0 declared gaps |
| **AIO-8** | **Census every mutation entry point.** Enumerate every write path to stock, money, or an outbound channel across the gateway and the orchestrator, and classify each as inside or outside the typed propose→confirm→execute schema. | `safety.schema_coverage` is a **fraction with a numerator and a denominator that a reader can recount** — not a claim. Every path outside the schema is named, with an owner. The census is generated by `gate-auditor`, so it re-runs; a hand-written list does not close this. | **2026-09-18** | `.planning/FUTURES.md` §8.1 (the principle) and §8.2 (the allowlisted families); `one-tap-actions.service.ts:230` `executeAction`, `:245-246` `executed_at`/`executed_by`; `technology.md:441` (four conventions) |
| **AIO-9** | **`recurring_order_agent` — resolve it to a binary.** It is registered nowhere, subclasses nothing, and owns scheduled purchasing. Either it comes inside `BaseAgent` **and** the action center with a confirm step, or it is deleted with an ADR line. There is no third state, and "wire it up later" is the third state. | `fleet.orphan_modules` and `harness.agents_without_harness_guarantees` both read **0** on the next `run_card.py` run — or the module is gone and the ADR says why. If it survives, a purchase it schedules produces a row with `executed_by` set. | **2026-10-02** | Measured 2026-08-28: `fleet.orphan_modules = 1`, `harness.agents_without_harness_guarantees = 1`, both naming `recurring_order_agent`; charter §Evidence correction #2 calls it *"the single highest-consequence gap in the department"*. **Diet note:** subclassing an existing base is *use*, not extension — no new `core/` capability. |
| **AIO-10** | **Instrument time-to-confirm before the volume arrives.** | `safety.median_time_to_confirm` and `safety.rejection_rate` computable from `one_tap_actions`, with a dated first readout — and the **distribution published, not only the median**, because premortem #3's signal is the collapse of the long tail, which a median hides. | **2026-09-25** | [[ai-orchestration-premortem]] #3; the timestamps already exist (`one-tap-actions.service.ts:245-246`), so this is a query, not a migration; `loop-gate-integrity` and `loop-attention-budget` carry it |

---

## 3. Tracks A2 and A4 — this department's half

Neither item is ours outright; both have an aio-side half that stalls without us.

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-11** | **A2 — write `task_type` on every metered call.** Under [[0036-cost-routing-two-plans-in-harmony]], RM-1 owns the methodology and `aio-model-routing` owns the operation. eng/schema-migrations adds the `api_spend` column; **our half is that the wrapper populates it.** | `spend-sentinel` reports `nf_a.cost_per_task` **by task type** instead of the current silence, and one joined view answers cost-per-task end to end for Finance's `spend-ledger-auditor`. | **2026-09-18** *(blocked on the A2 migration; the wrapper-side work starts now and is testable against a local column)* | ADR 0039 A2; ADR 0036 (methodology/operation line); OD-29 resolution note on the `api_spend`/NF-row grain divergence |
| **AIO-12** | **A4 — make `run_card.py` cron-safe for SRE's tick.** SRE owns the `loop-watcher.yml`-sibling cron; we own the runner being safe to schedule. | A card that raises does not silently vanish from the report — the run exits non-zero and names the card; `--json` output is diffable week over week so a changed number is visible without reading prose. | **2026-09-25** | ADR 0039 A4; `.github/workflows/loop-watcher.yml` is the working sibling (Monday 07:00 UTC, reports and never edits the corpus) |
| **AIO-13** | **Reconcile the fleet census with the charter, then make the reconciliation a guard.** The charter says 26 modules / ≈18 live / 5 stubs; `fleet-census-agent` measures 24 / 23 / 0-flagged. One of the two is wrong, and quoting either without the split is exactly premortem #2. | A written reconciliation naming which figure moved and why (deletions, registrations, or a heuristic that no longer detects the stub shape), **plus** a check that fails when an agent count is stated anywhere outside `services/agent-orchestrator/` without the live/stub split. | **2026-09-18** | Charter §Evidence vs `run_card.py` 2026-08-28; `core/orchestrator.py:214-217` — *"Registered is not the same as running"*; premortem #2's counter-pressure (c) asked for exactly this check |

---

## 4. Per-team agendas

Five teams, five different questions about one agent action. Each row is carried by
an existing card or loop; where it is not, it is in §5 as a finding instead.

> Task IDs are stable and never reused. **AIO-15 does not exist** — it was withdrawn
> during authoring for naming a pointer to §1 rather than a task with its own
> doneability. The gap is left rather than closed so the IDs already cited on
> [[ai-orchestration-agenda-board]] and in sketch 056 stay valid.

### 4.1 [[harness-runtime-charter]] — *can it run?*

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-14** | **Name the DLQ consumer.** `technology.md:802`: *"the DLQ is a well-engineered place where problems go to be forgotten."* Nothing reads `dead_letter_queue`. | `loop-dlq-triage` moves from `proposed` to `active`: a daily read with a named owner, `dlq.entries_unassigned` and `dlq.oldest_entry_age` emitted, and a first triage with a disposition per entry. | **2026-09-25** | `base_agent.py:804-806` writes the table; `loop-dlq-triage` (close_time `daily`, `status: proposed`) has no consumer |

This team also **executes AIO-1 → AIO-6** (§1) as the ADR 0039 A1 owner; those rows
are not restated here.

### 4.2 [[agent-fleet-charter]] — *did it do the job?*

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-13** | Fleet reconciliation + the count guard (listed in §3). | see §3 | **2026-09-18** | see §3 |
| **AIO-17** | **Close the subscription-coverage question while it reads clean.** `fleet.subscribed_topics_without_publisher = 0` today — a green number produced by a grep-level heuristic, which is premortem #2's exact shape. Prove the heuristic can fail. | A deliberately broken subscription (a topic with no publisher, in a test fixture) makes `fleet-census-agent` report non-zero. A checker that cannot go red is not a checker. | **2026-09-11** | Measured 2026-08-28: `fleet.subscribed_topics_without_publisher = 0`; `loop-subscription-coverage` evidence records the three-defect incident at `core/orchestrator.py:198-206` |

### 4.3 [[model-routing-inference-economics-charter]] — *at what cost, on which model?*

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-11** | `task_type` on every metered call (listed in §3). | see §3 | **2026-09-18** | see §3 |
| **AIO-18** | **Produce the evidence OD-04's registry needs — without picking the roster.** A generated table mapping every metered `task_type` to the model it currently resolves to. | The table is generated from the wrapper and `SpendLogger`, re-runs, and covers `routing.model_pin_sites_gateway = 10` and `routing.model_pin_sites_orchestrator = 53`. **It names no preferred roster** — OD-04 stays open; this is its input, not its answer. | **2026-09-18** | Measured 2026-08-28: `routing.distinct_model_pins_gateway = 3` (`claude-haiku-4-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-8`); OD-04 (`OPEN-DECISIONS.md:28`) — 127 literals, *"no place in the repo that says which model does which job"* |
| **AIO-19** | **The substitution gate.** No model-ID change merges citing cost without a benchmark run attached. | `loop-model-substitution-gate` goes `active`: a CI check in the shape of the merge-policy gate, with `routing.substitutions_without_benchmark` emitted and a proven red case. | **2026-10-02** | [[ai-orchestration-premortem]] #4; `scripts/benchmark_haiku_vs_sonnet.py` exists and has run essentially once; the directive's gate order forbids trading cost against unmeasured quality |

### 4.4 [[agent-evaluation-gates-charter]] — *how do we know it worked?*

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-16** | **Per-family coverage, with the zero-coverage families named on the board.** The graded-task-type gate passes today; that is a floor, not coverage. | A per-family table where extraction and judgment families are listed separately and **every zero-coverage family is named rather than omitted**. Reporting one aggregate number closes nothing. | **2026-09-25** | `check_task_types_are_graded.py` exits 0 (measured 2026-08-28); [[ai-orchestration-premortem]] #5 — an aggregate number hides exactly this |
| **AIO-20** | **Operate A5's rubric the day RM-2 delivers it; do not author it.** The vendor-reply family is the commercially load-bearing one and has no verdict basis better than `call_level_v0`. | The gate is wired and idle, waiting on the rubric: when RM-2's rubric lands, running it is a config change, not a build. If it has not landed by close_time, **that is the finding to file**, not a reason to write the rubric here. | **2026-10-09** | ADR 0039 A5 (*"RM-2 defines; aio-evaluation-gates operates"*); TECH-F3 — the escalation is merge, never duplicate |
| **AIO-21** | **Stand up D-25, the weekly AI eval workflow `e2e-prod.yml:7` reserves.** | A workflow that runs weekly, emits `nf_a.doneability_verdict_coverage` per family, and fails loudly rather than reporting empty when a family has no set. | **2026-10-09** | [[ai-orchestration-schedule]] D-25 row, state **NEW — not built** |

### 4.5 [[action-safety-the-human-gate-charter]] — *was it allowed to run at all?*

Carries **AIO-7, AIO-8, AIO-10** (§2) and co-owns **AIO-9** with harness-runtime.
One addition:

| ID | Task | Doneability | close_time | Evidence |
|---|---|---|---|---|
| **AIO-22** | **Make the audit trail reconstructable, not merely present.** Premortem #3's failure has a truthful audit trail and a useless one: `executed_by` is set, and nobody can say what the proposal *said*. | `safety.confirmations_with_proposal_snapshot_pct` is computable and published; a confirmed action can be replayed to the proposal text the human saw. | **2026-10-09** | `loop-audit-reconstructability` (`close_time: monthly`, `status: proposed`); [[ai-orchestration-premortem]] #3 |

---

## 5. Findings — things no card or loop can carry

Per `GENERATION_BRIEF.md` §8.1.2: *a task no card or loop can carry is a finding to
record, not a task to list.* These are recorded here and mirrored as rows in
[[ai-orchestration-questions]].

1. **`aio-orchestrator` is declared `extraction` and its job is mechanical.** Its own
   card says *"reading boards and counting is not judgment"*, and `run_card.py`
   defines mechanical as *"a disk census, a grep, or a wrapped guard — no model call"*.
   The runner therefore refuses to execute it, and the department board has **no
   producer**. Fixing this means amending a card, which wave 3 forbids
   (`GENERATION_BRIEF.md` §8.4). → a card amendment through the ADR-0034 path, not a
   task on this page.
2. **`loop.close_time_breached` has no publisher** — the card's own declared gap.
   `scripts/watch_loops.py` and `.github/workflows/loop-watcher.yml` exist and run
   Mondays; nothing binds them to this topic. The pieces are one wiring step apart
   and the wiring belongs to [[reliability-sre-charter|reliability-charter]] and
   [[decision-office-charter]], not here.
3. **`nf_a.skill_id` does not exist**, so `skills.firing_rate_30d` reads
   `unmeasurable` for all four registered skills — neither stale nor fresh. The
   column is RM-3's under Track A4; carried as a question row, not a task we can close.
4. **Citation drift is systematic, not incidental.** The merge-policy gate moved from
   `ci.yml:226-230` to `ci.yml:555`; the fleet numbers moved; the gateway URL-constant
   finding is now empty. Three of this department's nine artifacts cite the old values.
   The corpus has a guard for register citations (`check_citation_pairing.py`) and none
   for charter citations. → [[decision-office-charter]].

---

## 6. Reach, graded honestly

`GENERATION_BRIEF.md` §8.6 asks for ambition **and** for saying plainly which tasks
are aspiration pending a decision. Three are:

1. **AIO-4 (run the bake-off) is contingent on `scripts/bakeoff/` landing.** If the
   Track-A1 protocol agent's skeleton is not runnable by 2026-09-11, AIO-4 slips and
   **AIO-6 becomes the whole of the OD-03 work** for the period — the diet guard holds
   the line while the decision waits. That is a stated fallback, not a hope.
2. **AIO-8's 100% is a target, not a forecast.** The denominator is unknown until the
   census runs; the honest close condition is *"the fraction is measured and the
   outside-schema paths are named"*, and ADR 0039's 100% is what the fraction must
   eventually reach, not what it will read on 2026-09-18.
3. **AIO-9 is the one task here that could produce a deletion.** Deleting a module
   that owns scheduled purchasing is a founder-visible decision, so the binary includes
   an ADR either way — we are not authorised to quietly retire a purchasing path.

Everything else on this page is work with an existing mechanism and a measurable
end state.

---

## 7. Locks this agenda respects

- **The pricing model stays deferred.** AIO-11 and AIO-18 produce *cost-per-task* and
  a *job → model* input table. Neither implies a price to a customer, and no task here
  schedules pricing work of any kind.
- **Brand/landing visuals stay held.** Nothing on this page touches a visual surface.
- **No open fork is resolved by this agenda.** OD-03, OD-04, TECH-F3, TECH-F5 and
  TECH-F6 all stay open. AIO-5 closes OD-03 *through an ADR with a scored run behind
  it* — the register's own resolution path — not by preference.
- **The OD-03 diet holds.** Restated in §1 with a per-task check.
- **`mutate_stock_money_outbound: confirm` is a constant.** AIO-9 brings a purchasing
  path *inside* that constant; it does not tune it.

---

## 8. Questions

Carried into [[ai-orchestration-questions]]; the founder arbitrates.

1. **AIO-9's binary — wire or delete?** `recurring_order_agent` owns scheduled
   purchasing with no harness guarantees and no human gate. Wiring it is real work;
   deleting it removes a capability someone may believe exists. This department's
   position is that either is acceptable and the current state is not.
2. **Does the `aio-orchestrator` card get reclassified to `mechanical`** (finding 1),
   so the department board has a producer? Wave 3 cannot amend it.
3. **TECH-F3 remains open** — methodology (R&M) vs operations (here). ADR 0036 drew
   the analogous line one seam over for cost. The department would rather take a
   merge now than discover a duplicate in six months; the escalation is never
   "build it in both places".
4. **A5's rubric has no delivery date.** AIO-20 is wired-and-idle by design; if RM-2's
   rubric has not landed by 2026-10-09, does the vendor-reply family stay unmeasured,
   or does the seam move?
