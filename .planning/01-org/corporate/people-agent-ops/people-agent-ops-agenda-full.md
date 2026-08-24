---
type: agenda-full
division: corporate
department: people-agent-ops
status: provisional
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, nf_a.doneability_verdict_coverage, nf_a.cost_per_completed_task]
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-premortem]]", "[[people-agent-ops-agenda-board]]", "[[people-agent-ops-directive]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-schedule]]", "[[roster-lifecycle-charter]]", "[[performance-doneability-charter]]", "[[research-math-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[evaluation-doneability-charter]]", "[[ai-orchestration-charter]]", "[[decision-office-charter]]", "[[corporate]]", "[[ORG_STRUCTURE]]"]
---

# People & Agent Ops — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Get the roster to say something true, and get one honest doneability number to exist.
Two teams, two numbers, and a deliberate refusal to let the easy one stand in for the
hard one.

| Metric | State today | First target |
|---|---|---|
| `roster.unregistered_module_count` | **3** — `book_scraper_agent`, `dataset_creator_agent`, `recurring_order_agent` | 0, or 3 *declared* exclusions |
| `roster.silent_default_spec_count` | **4** — `provider_conversation_agent`, `email_intel_agent`, `email_parsing_agent`, `provider_communication_agent` | 0 |
| `roster.truth_pct` | **≤ 73%** (≥7 defects / 26) | First reading published, then 100% |
| `roster.maturity_level_evidenced_pct` | **0%** — the ladder is prose at `.planning/PROJECT.md:33` | A ladder with machine-checkable predicates |
| `nf_a.doneability_verdict_coverage` | **0%** | Still 0% — plus a *written definition of what would move it* |
| `nf_a.cost_per_task` / `nf_a.cost_per_completed_task` | **Not derivable** | Dependency filed, not worked around |
| `nf_a.verified_task_success_rate` | **Unmeasurable** | Named as empty in every artifact |

Four different headcounts are currently defensible from the repo — **19** declared specs,
**23** registered classes, **24** claimed in `PROJECT.md:33`, **26** modules on disk. No
artifact reconciles them. Producing the reconciliation is the department's first output,
and it is a day of work, not a quarter.

## How

**Sequence: count → declare → gate → verdict.** In that order, because each step is the
precondition for the next and because the last one is blocked on somebody else.

1. **Count (week 1).** [[roster-lifecycle-charter]] publishes the census: 26 modules
   against `core/orchestrator.py:174-211` against `core/agent_registry.py`
   `DEFAULT_AGENT_SPECS`. The output is a table with one row per module and a verdict per
   row, not a percentage.
2. **Declare (weeks 2–4).** Every diff from step 1 is resolved into one of exactly two
   states: **registered**, or **declared out of scope with a reason**. `recurring_order_agent`
   is the interesting case — its docstring (`:17-21`) already says *"Standalone scheduler
   — not a message-bus agent"*, so the fix may be a register entry rather than a
   `BaseAgent` port. That is a decision, and it gets recorded as one.
3. **Gate (weeks 3–6).** The census becomes a **CI check**, not a habit. A PR that adds a
   file to `services/agent-orchestrator/agents/` without touching the orchestrator's class
   map fails. This is the direct counter-pressure to premortem M2, and its whole value is
   that it fires *before* an agent is dark in production rather than after.
4. **Verdict (blocked).** [[performance-doneability-charter]] cannot start step 4 until
   NF-A can name a worker. What it does instead, from week 1, is written below.

**What the blocked team does while blocked.** Not nothing, and not a substitute metric:

- **File the dependency precisely.** OD-C5 (`corporate.md:496`) plus the join-key question
  — `decision_log` and `api_spend` share no key today. One escalation, with the exact
  signature change and the exact column.
- **Write the doneability criteria for the three task types we already run** — invoice
  understanding, inbound email classification, wine enrichment — as *specifications*
  handed to [[evaluation-doneability-charter]], whose methodology it is. Applying criteria
  is ours; defining them is theirs; writing down what we need graded is the handoff.
- **Publish 0% weekly, with a blocker age.** A number that does not move, next to a
  blocker that gets older, is a working measurement of an organisational failure.

## Why now

- **Because the fleet is already the workforce.** 26 modules exist and run product
  behaviour. The department is not creating a workforce; it is admitting one exists
  without a record.
- **Because the repo already paid for this defect class and did not build the check.**
  `core/orchestrator.py:200-205` documents two fully-implemented agents that consumed
  nothing because nobody registered them. Three more are unregistered right now. The
  second instance of a known failure is the cheap one to prevent.
- **Because NF-A's schema is open, and this is the last moment the ask is free.**
  [ADR 0006](../../../decisions/0006-neural-footprint-architecture.md) locked the
  architecture and left columns to OD-11. Asking for an `agent` field *now* is a column;
  asking after the table has a year of rows is a backfill nobody can do.
- **Because "cost per task per agent" is already a named field in a locked design**
  ([[README]] §4.2) that no query can return. Either the field is real or the design is
  aspirational; this department is the one that finds out.

## Next steps

- [ ] Publish the roster census — one row per module, three sources, a verdict per row —
      [[roster-lifecycle-charter]]
- [ ] Resolve all 3 unregistered modules to *registered* or *declared out of scope*;
      `recurring_order_agent` is a decision, not a bug fix
- [ ] Give all 4 silent-default agents a real `DEFAULT_AGENT_SPECS` entry, and make
      `core/agent_registry.py:337`'s empty-dict fallback **loud** rather than silent
- [ ] Ship the census as CI — a new agent module without a registry entry fails the build
- [ ] Reconcile 19 / 23 / 24 / 26 and correct `.planning/PROJECT.md:33,121` to the number
      that survives
- [ ] Draft the maturity ladder as **predicates over the repo**, and stop at the number of
      levels the evidence supports — [[roster-lifecycle-charter]]
- [ ] File **OD-C5** into `OPEN-DECISIONS.md` with the exact signature diff for
      `SpendLogger.log()` — [[decision-office-charter]]
- [ ] File the join-key question: what connects `decision_log:2687` to `api_spend:2231`? —
      [[neural-footprint-instrumentation-charter]]
- [ ] Hand doneability criteria specs for the three live task types to
      [[evaluation-doneability-charter]]
- [ ] Publish `nf_a.doneability_verdict_coverage = 0%` with a blocker age, every week
- [ ] Rename the liveness number in every department artifact so `success_rate` never
      appears unqualified (premortem M3)

## Questions for the founder

1. **OD-C5 — does `SpendLogger.log()` gain an `agent` parameter?** Everything this
   department's second team does is downstream of that one argument. If the answer is no,
   [[performance-doneability-charter]] should be told plainly that per-agent cost is out
   of scope, rather than left to be permanently blocked.
2. **`recurring_order_agent` — port it to `BaseAgent`, or bless it as a non-agent?** Its
   docstring already argues for the second. If it stays a standalone scheduler it still
   needs *some* health surface, because today it has none.
3. **How many maturity levels do you actually want?** `PROJECT.md:33` says Level 0→4.
   Five levels over 26 agents, with predicates for each, may be three levels of real
   distinction and two of ceremony. This department would rather ship three honest ones.
4. **Is the human-review rubric genuinely deferred to the second hire?** The charter says
   yes and the ordering consequence is on the record: agents get a review rubric before
   people do. Confirm that reads as intended rather than as an oversight.
5. **When the roster and the pitch disagree, which one changes?** `PROJECT.md` says 24
   agents; the disk says 26 and the orchestrator says 23. The first time this department
   corrects a number that appears in a deck, it needs to already know the answer.
