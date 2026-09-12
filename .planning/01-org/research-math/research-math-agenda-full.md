---
type: agenda-full
division: research-math
department: research-math
status: active
metrics: [nf_a.event_completeness, nf_a.cost_per_completed_task, nf_a.verified_task_success_rate, nf_a.harness_overhead_ms]
updated: 2026-08-28
links: ["[[research-math-charter]]", "[[research-math-premortem]]", "[[research-math-agenda-board]]", "[[research-math-directive]]", "[[research-math-loops]]", "[[research-math-schedule]]", "[[research-math-agent-stack]]", "[[research-math-questions]]", "[[harness-model-routing-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[backtests-charter]]", "[[backtests-agent-stack]]", "[[0039-activation-plan-of-record]]", "[[0036-cost-routing-two-plans-in-harmony]]", "[[0017-doneability-verdicts-are-sidecar-claims]]", "[[0029-p3-plan-of-record]]", "[[0006-neural-footprint-architecture]]", "[[0008-nf-column-contract]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[harness-model-routing-charter|aio-model-routing]]", "[[harness-runtime-charter]]", "[[skills-charter]]", "[[architecture-review-charter]]", "[[data-charter]]", "[[engineering-charter]]", "[[decision-office-charter]]", "[[red-team-charter]]", "[[FORK-REGISTRY]]", "[[backtests-premortem]]", "[[backtests-directive]]", "[[SCENARIO-CONTRACT]]", "[[0001-mudavym-single-entity]]", "[[ORG_STRUCTURE]]"]
---

# Research & Math — Full Agenda

> **Agenda of 2026-08-28.** The first real agenda; it replaces the 2026-08-24
> forecast. Authored under [[0039-activation-plan-of-record]] Track B. Every task
> names a **doneability**, a **close_time** and the **evidence** that makes it real.
> A candidate that could not say how anyone would know it was done was deleted
> rather than softened — §6 records the two that were.

## 0. What changed since the provisional agenda — measured, not remembered

The provisional agenda's whole thesis was *move four metrics from unmeasurable to
measured*. Two of them moved, and one moved so far that the department's frontier
is now somewhere else. Re-measured on this branch, 2026-08-28:

| What the forecast said (2026-08-24) | What is true 2026-08-28 | How it was checked |
|---|---|---|
| `nf_a.event_completeness` **0%** on the gateway | Superseded — all gateway model calls emit `neural_footprint_event` | `apps/api-gateway/src/common/model-client/model-client.service.ts:413`; charter's own 2026-08-25 correction |
| Task types with written doneability criteria: **0** | **39 emit · 27 carry a verdict · 12 knowingly exempt · 0 ungraded** | `python3 scripts/check_task_types_are_graded.py` → `PASS`, run 2026-08-28 |
| `nf_a.harness_overhead_ms` — no instrument | **Still none.** `grep -rIn harness_overhead apps services scripts` → 0 hits | re-verified 2026-08-28 |
| The routing seam is an open fork | **Closed** — [[0036-cost-routing-two-plans-in-harmony]]: RM-1 owns methodology, `aio-model-routing` owns operation | OD-29 row, Resolved |
| Backtests dormant, trigger unmet | **Trigger MET**, recorded 2026-08-28 | [[backtests-agent-stack]] §6 |

**The consequence, stated plainly: coverage is closed, so coverage can no longer
move.** `0 ungraded` is a ceiling, not a score. Of the 16 `outcome_basis` literals
the Python runtime writes outside tests, **15 are `parse_v1`** — the basis whose own
definition calls it *"deliberately weak… nothing about whether the artifact is
RIGHT"* (`apps/api-gateway/src/common/model-client/verdict-bases.ts:31-39`). A
department that now reports "100% graded" and stops has replaced an honest blank
with a flattering number, which is [[research-math-premortem]] M2 arriving by the
front door. **The 2026-08-28 agenda is therefore about strength, cost and replay —
not coverage.**

---

## 1. Track A5 — judgment rubric #1, the vendor-reply family

ADR 0039's Track A5 is this department's spine: *RM-2 defines, `aio-evaluation-gates`
operates, the TECH-F3 line holds untouched.* The family is commercially load-bearing
and it is graded today by the weakest basis in the vocabulary.

**RM-01 · Define `approval_v1` — the deferred verdict for the vendor-reply family**
· owner [[evaluation-doneability-charter]] · close **2026-09-18**
- *Doneability:* a rubric committed to the repo **before any result exists**
  (independence clause 1) that states: the outcome mapping over the status
  vocabulary that already exists in code, the join key, and the pass condition.
  Done when a reader can grade a disputed row by hand from the rubric alone.
- *Evidence:* `apps/api-gateway/src/common/orchestrator/inbound-responder.service.ts:776`
  records `PARSE_BASIS` for `inbound_email_response`, and the comment immediately
  below it (`:790-796`) already names the honest verdict — *"what happened to the
  draft — a human approving it, or the autonomy gate releasing it. That is
  `approval_v1`, needs a deferred join against the approve/dismiss record, and lands
  as a second row beside this one."* The ground truth exists:
  `procurement_conversations.status` is written at `:522` and its vocabulary is
  already in the tree — `PENDING_APPROVAL` (18), `SENT` (19), `APPROVED` (12),
  `CANCELLED` (9), `AUTO_SEND_SCHEDULED` (9), `REJECTED` (4), counted 2026-08-28.
- *The methodological point the rubric exists to get right:* **`AUTO_SEND_SCHEDULED`
  elapsing without a cancel is not an approval — it is an absence of veto**
  (`:502-506`: auto-send fires when the per-restaurant switch is on and no guardrail
  trips, on a 2-minute undo). Scoring silence as success credits the model with the
  manager's inattention. It gets its own outcome value or the basis is dishonest —
  the same argument `verdict-bases.ts:102-115` makes for keeping `edit_v1` out of
  `confirmation_v1`.

**RM-02 · Census the family before grading it** · owner [[evaluation-doneability-charter]]
· close **2026-09-11**
- *Doneability:* one list naming every task type and call site in the vendor-reply
  family, and every member either grades on `approval_v1` or is on the shrink-only
  exemption list with a reason. Done when `check_task_types_are_graded.py` is the
  thing that would catch a member being dropped.
- *Evidence:* the family spans both runtimes and is not one task type — gateway
  `taskType: "inbound_email_response"` (`inbound-responder.service.ts:765`), the
  `vendor_reply` notification type at `:571` and `procurement.service.ts:1978, 2043,
  2081`, and on the Python side `provider_conversation_agent.py:1016` (`parse_v1`)
  and `provider_communication_agent.py:633` (`constraint_v1`).

**RM-03 · File the operating ask at `aio-evaluation-gates`** · owner
[[evaluation-doneability-charter]] · close **2026-09-25**
- *Doneability:* a written ask in that unit's `questions.md` carrying the rubric, the
  named join key, and a date — and this department writes no gate code. Done when the
  ask is answered or ages out at 42 days.
- *Evidence:* TECH-F3 ([[FORK-REGISTRY]]) draws the line *methodology here, operations
  there*, and `technology.md:406` names the remedy if it fails — **merge, never
  duplicate.** If RM-2 ships the gate itself, the seam has failed and the merge
  proposal is owed instead.

---

## 2. Track A1's other half — the bake-off **methodology** (ADR 0036)

[[0036-cost-routing-two-plans-in-harmony]] gives RM-1 the benchmark-design half of
Track A1: *what cost-per-task means, and the rules a substitution study must
satisfy.* `aio-harness-runtime` runs the bake-off; this department decides what
would count as winning. Scheduling it is this agenda's job.

**RM-04 · The benchmark specification** · owner [[harness-model-routing-charter]] ·
close **2026-09-25**
- *Doneability:* a spec naming the workload sample, the per-class metric, the
  tie-break rule and the pass condition — **committed before any candidate runs**,
  and passed to [[architecture-review-charter]] for the adversarial pass ADR 0039
  schedules *before* the bake-off, not after. Done when Architecture Review returns a
  finding or the word "clean".
- *Evidence:* ADR 0039 A1 names `cards.json`'s **102 declared specs across 100 units**
  as the workloads, and the index already carries the stratification a sample needs —
  `routing_class_counts`: **36 mechanical / 36 extraction / 30 judgment**
  (`.planning/00-index/cards.json`, read 2026-08-28). A benchmark that samples only
  the mechanical third measures the third of the org that needs a harness least.
- *The gate this task carries:* **OD-52 first.** OD-03's own row, re-verified
  2026-08-27, records `base_agent.py` with zero LLM integration — it is
  RabbitMQ/saga/DLQ infrastructure, and the candidates are *reasoning* harnesses. The
  spec either cites a founder answer to OD-52 or states in its first paragraph which
  question it is answering. It may not quietly answer the old one.

**RM-05 · The `harness_overhead_ms` instrument spec — and its first reading** ·
owner [[harness-model-routing-charter]] · close **spec 2026-09-11 · first reading
2026-10-02**
- *Doneability:* a written definition of overhead as `duration_ms − Σ provider_ms`,
  with `provider_ms` named at a specific boundary in the wrapper, plus a first value
  on [[research-math-agenda-board]]. **A blank is an acceptable reading; an inferred
  one is not.**
- *Evidence:* the wall-clock half already ships —
  `model-client.service.ts:430` writes `duration_ms`, measured `Date.now() - startedAt`
  at `:203`/`:295`, i.e. **across attempts**, so it already contains retry sleep,
  spend-ceiling checks and tier lookups. Nothing separates provider time from wrapper
  time, and `grep harness_overhead` over `apps services scripts` returns 0 hits
  (2026-08-28). This is the number the directive's rule 2 says must be read before
  OD-03 is scheduled.
- *ADR 0036 boundary, observed:* the definition is ours; **the wrapper edit is
  `aio-model-routing`'s operation** and lands as an ask, not as our commit.

**RM-06 · What `cost_per_completed_task` means** · owner
[[harness-model-routing-charter]] · close **2026-09-18**
- *Doneability:* one written definition fixing the denominator (tasks carrying a
  passing verdict at or above a named strength — see RM-08), the numerator (retries
  and cache tokens included, at the multipliers the wrapper already applies), and
  **which ledger is authoritative**. Done when Track A2's migration can be graded
  against this text rather than the text being revised to match the migration.
- *Evidence:* ADR 0036 assigns exactly this to RM-1; ADR 0035 and the OD-29 row
  record the live divergence — `api_spend` lacks `task_type` while the NF row carries
  it, so the two ledgers differ in grain. `model-client.service.ts:382-383` already
  computes cache-creation and cache-read tokens, so the numerator question is
  answerable today.

**RM-07 · Substitution-study rules** · owner [[harness-model-routing-charter]] ·
close **2026-10-09**
- *Doneability:* written rules a routing change must satisfy before it ships,
  including the rejection case: a candidate that wins on price and loses on verdict
  strength is **rejected, and the rejection is recorded**. Done when one real routing
  proposal has been passed through them.
- *Evidence:* the monthly loop `routing-policy-vs-verdict` already states *routing
  changes only against a verdict, never against price alone*
  ([[research-math-schedule]]); ADR 0036 makes the rules RM-1's deliverable. OD-04's
  row measures the surface these rules will govern — **127 model-id literals**,
  re-verified 2026-08-27.

---

## 3. Backtests — the first replay, now that the trigger is met

**RM-08 · First replay: re-grade the vendor-reply family's historical `parse_v1`
rows under `approval_v1`** · owner [[backtests-charter]] · close **2026-09-18**
(runs after RM-01, not after RM-03)
- *Doneability:* one written outcome — **survived**, **falsified**, or
  **unfalsifiable** — plus `bt.outcome_regrade_delta` reported *per outcome class*,
  never as one number. Done when the delta is published beside the original claim,
  whether or not it is flattering. A quarter of zero falsifications is written up as
  a finding about the suite, not as a clean bill ([[backtests-premortem]] M3).
- *Evidence:* the entry trigger is **MET**, checked and recorded 2026-08-28
  ([[backtests-agent-stack]] §6). This is a true replay rather than a confirmation
  under [[backtests-directive]]'s own test: the `parse_v1` verdict is written at
  response time, and the approval outcome arrives **after** — it is data the claim
  had not seen when it was made. The delta it measures is the exact quantity A5
  exists to produce: how often "the draft parsed" and "a human sent it" disagree.
- *Why this is the right first replay and not an easier one:* it is the only
  available replay whose target is a claim the org actually relies on commercially,
  and it hands RM-2 an empirical number instead of an opinion. Picking a cheaper
  target would be the tractable-corner drift [[backtests-premortem]] M1 names.

**RM-09 · Coverage report per scenario class — including the zero rows** · owner
[[backtests-charter]] · close **monthly, first 2026-09-25**
- *Doneability:* `bt.scenario_coverage_pct` published per scenario class with
  never-replayed classes shown as `0`, not omitted. Done when the report distinguishes
  *not replayed* from *replayed and survived*.
- *Evidence:* the card requires exactly this — *"reported per scenario class and never
  as one number"* (`cards.json`, `claim-replayer`); the 17 scenarios' §9 simulation
  gates are specified in [[SCENARIO-CONTRACT]] and **nothing executes them**, which is
  what a zero row is for.

---

## 4. Track A4's methodology half, and the standing instrumentation work

ADR 0039 A4 lands `nf_a.skill_id` and the runner cron in parallel. The column is
RM-3's; **what it means is also RM-3's, and that half has no owner named anywhere
else.** Owning the methodology is this agenda's addition to Track A4.

**RM-10 · The `skill_id` contract — written before the migration** · owner
[[neural-footprint-instrumentation-charter]] · close **2026-09-11**
- *Doneability:* four questions answered in writing before any DDL — (a) what a
  `skill_id` names (a `.claude/skills/<name>` path? versioned?), (b) nullable or
  not, and what a null means, (c) what counts as a *firing* — invoked, or produced an
  action, and (d) what `firing_rate_30d` divides by. Done when
  `skills.firing_rate_30d` is computable from the contract by hand, on paper, before
  a row exists.
- *Evidence:* `scripts/agents/run_card.py:254` currently returns the literal string
  `"unmeasurable — nf_a.skill_id does not exist"`, and `:263` explains that firing
  telemetry does not exist. A column shipped without those four answers produces a
  number nobody can interpret — [[research-math-premortem]] M2, and the directive's
  rule 2 says the instrument precedes the decision, not the column precedes the
  contract.

**RM-11 · One basis vocabulary across both runtimes, with a guard** · owner
[[neural-footprint-instrumentation-charter]] with [[evaluation-doneability-charter]] ·
close **2026-10-02**
- *Doneability:* one registry both runtimes read, plus a guard that fails on an
  unregistered basis string, **proven against the pre-fix tree** and exiting 2 when it
  cannot check. Done when a misspelled basis is a build failure on both sides.
- *Evidence:* the gateway already solved this and said why —
  `verdict-bases.ts:10-13`: *"the failure they guard against is a TYPO. A basis
  misspelled at one call site does not break anything — it writes a row nobody
  queries, and coverage silently reads as a gap forever."* The Python runtime carries
  precisely that exposure today: `"parse_v1"` is a bare literal in **10 non-test
  files** and `constraint_v1` appears once
  (`provider_communication_agent.py:633`), with **no constants module** — verified
  2026-08-28.

**RM-12 · Publish `nf_a.event_completeness`, and correct the stale baseline** ·
owner [[neural-footprint-instrumentation-charter]] · close **weekly, first
2026-09-04**
- *Doneability:* a measured value or the words *not measured* on the board every
  week, recomputed **from the table, never inferred from the callsite list** (the
  card's own quality bar); and [[research-math-loops]] L1's `baseline:` line, which
  still reads *"0% NestJS surface"*, corrected in the same close-time.
- *Evidence:* the emitters exist on both runtimes (`model-client.service.ts:413`,
  `spend_logger.py:387`); the loop's baseline predates P1 and is now false. A loop
  carrying a baseline the code disproves is the register-rot pattern this org has
  learned twice.

**RM-13 · Reconcile against a provider invoice, or downgrade the loop** · owner
[[neural-footprint-instrumentation-charter]] · close **monthly, first 2026-09-25**
- *Doneability:* the delta between `neural_footprint_event` cost and the actual bill
  is published, or — after 3 runs with no action — the loop is downgraded per the
  anti-sprawl rule, in writing. Done either way; *"still pending"* is not an outcome.
- *Evidence:* the card declares the gap outright — *"the provider invoice —
  publisher: NONE (gap — no feed; reconciliation depends on a human-fetched bill)"*.
  An unreconciled cost number is a number this department has told everyone else to
  trust and never checked.

---

## 5. The department's own standing work

**RM-14 · The verdict-strength ladder — the department's next real number** · owner
[[evaluation-doneability-charter]] · close **ladder 2026-09-18 · first board reading
2026-09-25**
- *Doneability:* (a) a written **partial order** over bases, committed before the
  first reading; (b) a per-task-type strength reading on the board; (c) a
  **shrink-only rule for downgrades**, mirroring the exemption list's. Done when a
  task type's strength can fall and the board says so.
- *Evidence:* coverage is closed (`0 ungraded`, 2026-08-28) so it can no longer move,
  while 15 of 16 Python basis literals are the basis whose docstring calls itself
  deliberately weak. `verdict-bases.ts` already contains the raw material for an
  order — `call_level_v0` proves an HTTP 200; `parse_v1` proves shape; `grounding_v1`
  adds *"the model's own declared references resolving against evidence that was
  actually supplied"*; `human_count_v1` is *"the only basis… that grades against
  ground truth from the world"*.
- *Graded honestly — the trap this task must not fall into:* a **total** order across
  unlike claims is a fabrication. `reconciliation_v1` and `confirmation_v1` are not
  comparable; one says arithmetic balanced, the other says a person acted. The
  deliverable is a partial order with incomparable pairs stated as incomparable, and
  a board that shows a **distribution**, not an average. If the honest answer turns
  out to be that no order exists, that finding publishes and the task closes as
  *rejected with the measurement that rejects it* — which is the only close this
  department's own directive allows.

**RM-15 · Publish verified beside self-reported, every week** · owner
[[evaluation-doneability-charter]] · close **weekly, first 2026-09-04**
- *Doneability:* `nf_a.verified_task_success_rate` and `base_agent.py:144`'s
  self-reported `success_rate` in the same row — **together or neither**
  (independence clause 4). Done when the gap has a first published value.
- *Evidence:* the charter calls the gap *"RM-2's actual product"*; it is computable
  for the first time since P3.0 shipped ([[research-math-agent-stack]] §6) and has
  never been published.

**RM-16 · Golden-set provenance labels** · owner [[evaluation-doneability-charter]] ·
close **2026-10-02**
- *Doneability:* every eval set carries `free-negatives` or `imagination-only`, and
  no `imagination-only` set sits behind a blocking gate. Done when the label is a
  field a reader can check, not a judgement in someone's head.
- *Evidence:* the department has exactly one set with a named source of free
  negatives — the beverage identity key, tested against **732,874 free known-distinct
  pairs** (`scripts/eval_guest_merge_policies.py:1-30`), a test that killed three
  designs, one of which committed 212 false merges. Everything else is unlabelled.
  The directive already grants RM-2 the right to mark a set `imagination-only`; this
  task is exercising it.

**RM-17 · Consume `model-pin-census` — do not build a second census** · owner
[[harness-model-routing-charter]] · close **2026-09-11**
- *Doneability:* wrapper share and the raw-callsite count publish weekly on this
  board **from the existing skill's output**, and RM-1 owns only the *definition* of
  what adoption means. Done when this department is reading a number it did not
  produce, and could not have produced without duplicating another unit's job.
- *Evidence, and a correction to this department's own first instinct:*
  `.claude/skills/model-pin-census/SKILL.md` already exists and states
  `owner: model-routing-inference-economics (applied-ai) — card 'spend-sentinel'`,
  with the job written as *"counts every hard-coded model id and every
  api.anthropic.com constant, comment-aware, with path:line… before quoting
  model-spend coverage."* That is the census RM-1 was about to write. Building it
  again is the exact failure [[0036-cost-routing-two-plans-in-harmony]] exists to
  prevent — **methodology here, operation there, and if the line fails, merge, never
  duplicate.** Recorded here so the decision is visible rather than quietly avoided.

**RM-18 · Run the Applied AI seam audit against the skills that now exist** · owner
department (`rm-board-warden`) · close **monthly, first 2026-09-25**
- *Doneability:* every `.claude/skills/*/SKILL.md` whose job or metric overlaps an RM
  team's is either named as *consumed, owned there* or carries a filed merge
  proposal. Output is a merge proposal or the single word **clean** — never a
  duplicate ([[research-math-agent-stack]] §3, `applied-ai-seam-audit`).
- *Evidence:* the reservoir is no longer empty and it is **entirely Applied AI's**.
  All four skills in `.claude/skills/` (`fleet-census`, `harness-contract-audit`,
  `model-pin-census`, `registry-index-refresh`, read 2026-08-28) declare an
  applied-ai owner, and two sit directly on RM territory — `model-pin-census` on
  RM-1's callsite census (see RM-17), `harness-contract-audit` on *"the OD-03 diet"*,
  which is the constraint RM-04's bake-off runs under. The audit's past instance is
  OD-29, found by hand; this is the first run with something real to audit. Note in
  passing: the charter and schedule both cite `.agents/skills/railway-config/SKILL.md`
  as the repo's one project skill — **that path no longer exists**, and the correction
  belongs in a charter edit this wave may not make.

---

## 6. Deleted, held, and not done — the honest column

- **Deleted for want of a doneability:** *"improve cost per task"* — no denominator
  exists until RM-06 fixes one, so the task could not state what would count as done.
  It is RM-06's consequence, not a task. *"Stand up the T4 skill registry"* — the
  entry trigger (~15 skills, or two overlapping in production) is unmet — **4 skills
  exist**, all Applied AI's (read 2026-08-28) — and this department enforces §3.3 on
  everyone, so it applies it to itself first ([[research-math-schedule]] §Skills
  owned). RM-18 audits the four rather than adding a fifth.
- **Locks observed.** The **pricing model is deferred** and **brand/landing visuals
  are held** (founder, 2026-08-28). RM-06 produces a cost definition Finance may
  consume as a unit-economics *input*; it schedules no pricing work, assumes no
  unlock, and its close condition does not mention one. Nothing in this agenda is
  brand-adjacent.
- **NF-C stays a quarterly check, not a programme.** [[0006-neural-footprint-architecture]]
  makes this department the one to declare the trigger met; the schedule's quarterly
  check *is expected to answer no, by design*. It is not a task here because there is
  no work to do until the answer changes.
- **NF-B is HELD** and this department schedules nothing against it.

## 7. Findings — things no card or loop can carry

Per §8.1's rule, these are recorded as findings rather than dressed up as tasks:

1. **`claim.published` has no publisher, so backtests is trigger-blind.** The
   `claim-replayer` card declares it (`cards.json`, publisher: NONE) and nothing in
   the org emits when it publishes a number. `rm-board-warden` publishes weekly and is
   the obvious emitter, but that is a **card change**, which wave 3 may not make. Filed
   here; the proposal goes to [[decision-office-charter]] with [[research-math-questions]].
2. **`protected_lane.item_slipped` has no publisher either.** Nothing measures whether
   a non-preemptible item moved, so the weekly publish bounds the blind spot at 7 days
   — and a slip with a product reason and no record is exactly
   [[research-math-premortem]] M1's tell. Same route as (1).
3. **No verdict basis grades an audit.** Three of this department's four cards carry
   `quality_bar: … NONE (gap)` because ADR 0017 defines bases for *tasks*, not for
   contract audits, censuses or replays. Either ADR 0017 grows an audit basis or these
   agents are permanently self-graded — the thing this department exists to forbid.

## 8. Questions for the founder

1. **What is the monthly cost cap on the weekly CI eval?** `v3.0-TECH-DEBT.md:326-330`
   specifies weekly evals *with cost caps* and names no number. The directive says
   overrunning it escalates rather than switching the suite off — but an unnamed cap
   means the suite gets disabled the first month it costs more than it visibly caught.
   This is a founder number and the only thing blocking RM-15 from running unattended.
2. **May a doneability verdict block a product release, or only a sibling's work?**
   Failing RM-1 is cheap. If a verdict cannot stop a **ship**, the department is
   advisory in fact and the charter should say advisory rather than implying a gate.
   Carried forward from the provisional agenda, still open.
3. **OD-52 before OD-03 — confirm the reframe.** RM-04 cannot write a benchmark spec
   without knowing whether the bake-off compares reasoning layers *on* our messaging
   infra, or compares that infra to reasoning layers. The spec is dated 2026-09-25 and
   will state its own reading if no answer arrives; that reading should not be ours to
   invent.
4. **Division or department?** [[0001-mudavym-single-entity]]'s review trail grants
   Research & Math *"its own division"*; ORG_STRUCTURE §2, locked the same day, makes
   it a department inside Intelligence. Both readings are defensible, only one can be
   written down, and this department's founding argument rests on that sentence.
   Carried forward, unanswered, and it is now the oldest open item on this board.
