---
type: agenda-full
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: provisional
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.silent_default_spec_count, roster.headcount_claim_variance, roster.maturity_level_evidenced_pct]
updated: 2026-08-24
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-premortem]]", "[[roster-lifecycle-agenda-board]]", "[[roster-lifecycle-directive]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-schedule]]", "[[people-agent-ops-charter]]", "[[people-agent-ops-agenda-full]]", "[[performance-doneability-charter]]", "[[ai-orchestration-charter]]", "[[agent-fleet-charter]]", "[[decision-office-charter]]"]
---

# Roster & Lifecycle — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make the record of the workforce match the workforce, and make it stay matched without
anyone remembering to check.

Three concrete deliverables, in dependency order:

1. **A census table** — 26 rows, four predicates each, a verdict per cell. Not a
   percentage.
2. **Zero unresolved diffs** — every module is either *registered* or *declared out of
   scope with a reason*.
3. **A gate** — the census running per PR, so the backlog cannot refill.

Then, and only then, a maturity ladder built from predicates rather than adjectives.

### The opening state, verified

| Predicate | Population | Failures |
|---|---|---|
| Extends `BaseAgent` | 26 modules | **1** — `agents/recurring_order_agent.py:14` `class RecurringOrderAgent:` |
| Registered in `core/orchestrator.py:174-211` | 26 modules | **3** — `book_scraper_agent`, `dataset_creator_agent`, `recurring_order_agent` |
| Has a `DEFAULT_AGENT_SPECS` entry | 23 registered | **4** — `provider_conversation_agent`, `email_intel_agent`, `email_parsing_agent`, `provider_communication_agent` |
| Stub flag accurate + refused at boot | 26 modules | **0** — 5 declared stubs, all correctly refused at `core/orchestrator.py:245` |

**≥7 defects across 26 modules → `roster.truth_pct` ≤ 73%.** The evidence source
(`corporate.md:474`) baselined this at "≥2 defects / 26"; the `≥` was doing real work.

And four headcounts are simultaneously defensible: **19** declared specs · **23**
registered · **24** in [`.planning/PROJECT.md`](../../../../PROJECT.md):33 · **26** on
disk. Nothing in the repo reconciles them.

## How

**Sequence: count → declare → gate → classify.** The first three are weeks of work; the
fourth is where the team could waste a year (premortem M4), so it comes last and it comes
with a rule.

### 1. Count (week 1)

A three-way diff, published as a table. The 26th row is as important as the first: the
five correctly-declared stubs are recorded as **passes**, because a census that only shows
defects teaches nobody what right looks like — and distinguishing "correctly absent" from
"forgotten" is the entire job.

### 2. Declare (weeks 2–4)

Each diff resolves to exactly one of two states, and the directive treats them as equal:

- **`recurring_order_agent`** — a *decision*, not a bug. Its docstring (`:17-21`) already
  argues the case: *"Standalone scheduler — not a message-bus agent. Lifecycle is managed
  through the explicit start() / stop() methods."* It has a factory (`:387-391`) and a
  test suite. The probable outcome is a **declared exclusion**, not a `BaseAgent` port —
  but it still has no health surface at all, and that is a separate open item, not
  something the exclusion closes.
- **`book_scraper_agent`, `dataset_creator_agent`** — `BaseAgent` subclasses (`:17`,
  `:26`) referenced from no other file in the repo. **Do not register them by reflex**
  (premortem M5): registering subscribes them to real events. They go through the
  onboarding gate — owner, task type, named doneability criterion — and failing it is a
  result. Retirement is a legitimate outcome here.
- **The four silent-default specs** — real `DEFAULT_AGENT_SPECS` entries with a declared
  tier and dependencies. Separately: make `core/agent_registry.py:337`'s
  `DEFAULT_AGENT_SPECS.get(name, {})` **loud**. Fixing the four without fixing the
  fallback fixes today and not tomorrow.

### 3. Gate (weeks 3–6, overlapping)

The census becomes CI. A PR adding a file to `services/agent-orchestrator/agents/` must
register it or add a declared exclusion; a registered agent with no spec entry fails.
**The gate ships in the same close-time as the fix, not after** — premortem M2 is the
prediction that it never ships once the backlog is empty, and the repo has already run
that experiment once (`core/orchestrator.py:200-205`).

### 4. Classify (quarter 2, gated by a rule)

The maturity ladder. **Every level is a machine-checkable predicate or it does not
exist.** Build the levels by classifying the 26 modules that exist, write the check
before the descriptor, and stop at the number of levels the evidence supports. Three
honest levels beat five with two of ceremony. `roster.maturity_level_evidenced_pct` only
counts an agent whose level a check reproduces — it starts at 0% and the 0% is honest.

Candidate predicates, offered as a starting point rather than a ladder:
registered · declared spec · not a stub · implements `process_message()` · has an
idempotency path · has a DLQ path · has a `decision_log` write · has a doneability
criterion named. Which of those cluster into levels is an empirical question, and the
answer is in the repo.

## Why now

- **Three agents are dark right now.** Two of them are complete `BaseAgent` subclasses
  with zero call sites. Nobody owns noticing that.
- **The recurrence is documented and unguarded.** `core/orchestrator.py:198-206` is the
  repo's own account of this defect class costing an entire inbound-email pipeline. It was
  fixed reactively and no check was built. The second instance of a known failure is the
  cheap one to prevent.
- **A wrong headcount is already in circulation.** `PROJECT.md:33` says 24. That number
  has a path to a deck, and [[positioning-fundraise-readiness-charter]]'s whole metric is
  claim-to-evidence coverage.
- **The `IS_STUB` precedent gives the team a mandate it did not have to argue for.** The
  orchestrator already refuses to run a worker that would look healthy while doing
  nothing. Extending that principle from *stubs* to *the roster* is a small step from an
  established position, not a new policy.

## Next steps

- [ ] Publish the census — 26 rows, 4 predicates, verdict per cell, passes included
- [ ] Decide `recurring_order_agent`: declared exclusion vs `BaseAgent` port — and open
      the separate question of its missing health surface
- [ ] Run `book_scraper_agent` and `dataset_creator_agent` through the onboarding gate;
      retirement is a permitted outcome
- [ ] Add `DEFAULT_AGENT_SPECS` entries for the four silent-default agents
- [ ] Make `core/agent_registry.py:337` loud — warn or fail on a missing spec
- [ ] Ship the census as CI (L-RL-2), in the same close-time as the fixes
- [ ] Stand up the declared-exclusion register; `recurring_order_agent` is entry #1
- [ ] Reconcile 19 / 23 / 24 / 26 and correct `.planning/PROJECT.md:33,121`
- [ ] Draft the maturity ladder predicate-first; publish the check before the descriptor
- [ ] Record the 5 `IS_STUB` modules as the roster's worked example of correct behaviour

## Questions for the founder

1. **`recurring_order_agent` — exclusion or port?** Its docstring argues exclusion. If it
   stays a standalone scheduler it has no metrics, no health check, no retry and no DLQ,
   and something has to cover that. Which?
2. **`book_scraper_agent` and `dataset_creator_agent` — alive or dead?** Complete
   `BaseAgent` subclasses, zero call sites. If they were superseded, retiring them is
   cheaper than onboarding them, and this team would rather delete than pretend.
3. **How many ladder levels?** `PROJECT.md:33` inherits five. This team's position is that
   the evidence may support three, and that three checkable levels beat five with two of
   ceremony.
4. **When the census contradicts external material, who corrects it?** `PROJECT.md:33`
   says 24 agents. The first correction that touches a deck is a boundary question with
   [[positioning-fundraise-readiness-charter]], and it is cheaper to answer now.
5. **Does registration require a named doneability criterion at the gate?** Saying yes
   couples this team to a blocked one ([[performance-doneability-charter]]) and could
   stall onboarding; saying no means agents onboard with no definition of done. The team
   proposes: the criterion must be **named and owned**, not yet **computable**.
