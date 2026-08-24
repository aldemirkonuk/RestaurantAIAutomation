---
type: premortem
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: provisional
metrics: [roster.truth_pct, roster.unregistered_module_count, roster.maturity_level_evidenced_pct, roster.headcount_claim_variance]
updated: 2026-08-24
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-directive]]", "[[people-agent-ops-premortem]]", "[[performance-doneability-charter]]", "[[agent-fleet-charter]]", "[[ai-orchestration-charter]]", "[[strategy-fundraising-charter]]", "[[positioning-fundraise-readiness-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Roster & Lifecycle — Premortem

> Written at founding, before success is assumed.

The division agent's one-line prediction for this team (`corporate.md:353-355`):

> *The roster becomes a list of filenames rather than a list of workers, so "we have 26
> agents" is repeated in an investor conversation while 5 are declared stubs and 1 is not
> even wired in.*

Expanded below into five mechanisms. Verification has already made that line **worse**:
it is 5 stubs and **3** not wired in, and there are four defensible headcounts rather
than one.

---

## It is 2027-08. Roster & Lifecycle has failed. What happened?

### M1 — The roster became a list of filenames

`ls agents/*.py | wc -l` is the easiest census in the world to build and the least useful
one to have. It returns 26 today. It would also return 26 if every module were a stub,
if none were registered, and if half had no `process_message()`. Within a quarter the team
has a number, the number is on a board, and the board says 26 agents.

Then it is quoted. `.planning/PROJECT.md:33` already quotes **24** without anyone knowing
where 24 came from; the same mechanism produced that number and nobody caught it. The
failure completes when the count leaves the building — a deck, a YC application, a
customer call — and someone downstream asks which 26, and the honest answer is: 23
registered, 19 with declared specs, 5 refused at boot, 3 dark.

**Earliest observable signal.** The census reports a **single integer** rather than one
row per module with a per-predicate verdict. That is checkable on the census's first
publication, before any harm.

**Counter-pressure.** `roster.truth_pct` is defined over **four predicates per module** —
extends `BaseAgent`, registered, declared spec, stub flag accurate — and the artifact is
the **table**, never the percentage alone. The percentage is a summary of the table and
may not be published without it. The team's first output is explicitly *"a table with one
row per module and a verdict per row, not a percentage"*
([[people-agent-ops-agenda-full]]). And `roster.headcount_claim_variance` is itself a
tracked metric: as long as four numbers are live, the variance is 4 and the board says so.

---

### M2 — The census stayed a habit and never became a gate

The team runs the diff, finds `book_scraper_agent`, `dataset_creator_agent` and
`recurring_order_agent`, fixes all three, and the number goes to zero. Genuine progress,
visible, closed in a week. Nobody builds the CI check, because the backlog is now empty
and a gate guarding an empty backlog feels like process for its own sake.

Nine months later a new agent module lands, is fully implemented, is tested, is merged,
and consumes nothing. This is not speculation — it is a **replay**, and the repo holds the
first performance: `core/orchestrator.py:200-205` records two fully-implemented agents
absent from the registry, so *"nothing consumed inbound vendor email at all"*. That
instance was found reactively and no check was built. The team's founding condition is a
known recurrence with no recurrence guard.

**Earliest observable signal.** A PR that adds a file to
`services/agent-orchestrator/agents/` and does not touch `core/orchestrator.py`. That is a
one-line CI condition, and until it exists, the signal is instead: the census reaching
zero defects with no `.github/workflows` change in the same period.

**Counter-pressure.** The gate ships **in the same close-time as the fix**, not after it —
`L-RL-2` closes **per PR** and is the only loop in this department that can close before
the defect exists. Ordering matters: the fix without the gate is the exact state the repo
was in on the day this charter was written, and it took nine months to fail last time.

---

### M3 — "Registered" was treated as a boolean and hid four silent defaults

`core/agent_registry.py:337` — `defaults = DEFAULT_AGENT_SPECS.get(name, {})` — returns an
empty dict for four registered agents today, so their tier becomes `ON_DEMAND`, their
dependencies `[]`, their feature flag `None`, their idle timeout 300, and their
description `""`. Every one of those is a **real declaration** in `AgentSpec`'s API, and
every one is invisible in `get_all_statuses()`.

The failure: the team's census asks *is it registered*, gets `True` for all 23, and
declares the roster clean. Then an agent that genuinely needs `CORE` tier and a dependency
on `buffer_manager` starts lazily, out of order, and the resulting bug is diagnosed as a
race condition rather than a missing declaration — because from every dashboard the agent
is registered.

This is `IS_STUB`'s own lesson (`core/orchestrator.py:239-244`), occurring inside the
registry that enforces it. That irony is the tell: the team will be most blind to this
class of defect in exactly the code that taught it the class.

**Earliest observable signal.** Any registry status output in which an agent's
`description` is the empty string. Free to check, and it is a perfect proxy for the empty
`{}`.

**Counter-pressure.** Two mechanisms, because one is not enough. (a) The census predicate
is **"has a declared spec"**, not "is registered" — four defects today, publicly.
(b) The fallback is made **loud**: `register_from_defaults` logs a warning, or the
registration fails outright, when `DEFAULT_AGENT_SPECS` has no entry. Silence is the
defect; a fixed census does not fix silence, only a fixed fallback does.

---

### M4 — The maturity ladder became prose, and the prose became the review

`.planning/PROJECT.md:33` says *"Transform 24 Level 0-1 agents into Level 4 (Resilient)"*
and `:117` says *"all are Level 0-1 (prototype quality)"*. That is an inherited five-level
vocabulary with no per-agent evidence and no predicate for any level. The team, being the
HR function, adopts it — and HR has enormous gravity toward behavioural descriptors.
Level 2 becomes "handles errors gracefully". Level 4 becomes "resilient in production".

Twelve months on there is a ladder, agents have levels, the levels came from someone's
judgement, and no query can reproduce them. The ladder is then used in a quarterly review
and — worse — in external material, where "18 of 26 agents at Level 3" is exactly the kind
of number that sounds auditable and is not.

**Earliest observable signal.** The first level whose definition contains an adverb.
Concretely: any level in the ladder that cannot be expressed as a grep, a static check, or
a query — and the team should test each level by writing the check *first*.

**Counter-pressure.** **Every level is a machine-checkable predicate over the repo**, or
it does not exist. Level definitions are built by *classifying the 26 modules that exist*
and the ladder stops at the number of levels the evidence supports — which may be three,
not five, and shipping three honest ones is the stated preference
([[people-agent-ops-agenda-full]], founder question 3). `roster.maturity_level_evidenced_pct`
starts at **0%** and only counts agents whose level a check reproduces.

---

### M5 — The team fixed the roster and made the fleet worse

Roster truth is a metric that improves monotonically under one action: **register
everything**. Three dark modules become three registered agents; `roster.truth_pct` goes
to 100%; the board is green. But `book_scraper_agent` and `dataset_creator_agent` have
zero call sites for a reason nobody checked — they may be abandoned, superseded, or
half-finished. Registering them subscribes them to real events. The metric rewards
exactly the action that turns two inert files into two live workers of unknown quality,
and this team owns no doneability verdict with which to notice.

The generalized version: **an HR function whose only metric is headcount accuracy will
always prefer hiring to firing.** Retirement never happens, because deletion is scary and
registration scores.

**Earliest observable signal.** A census defect closed by registration where the
resolution note does not say what the agent does or who asked for it. Also: three
consecutive close-times with `roster.retirement_count` at zero while
`roster.unregistered_module_count` falls.

**Counter-pressure.** A census defect has **two** valid resolutions, and the directive
treats them as equal: *registered*, or *declared out of scope with a reason*
([[roster-lifecycle-directive]]). Registration additionally requires the onboarding gate —
an owner, a task type, a named doneability criterion — which `book_scraper_agent` may well
fail, and failing it is a **result**, not an obstacle. `recurring_order_agent` is the
model: its docstring already argues for exclusion, so the correct fix is a register entry,
not a `BaseAgent` port. And retirement is on the same board as registration, so a year of
zero retirements is legible as the anomaly it is.

---

## Cross-cutting counter-pressure

- **The team's artifact is the table, not the number.** Every mechanism above degrades
  into a single integer, and the integer is what leaves the building.
- **A pass is recorded as a pass.** The five `IS_STUB` modules are correct and enforced
  (`core/orchestrator.py:245`). A census that only shows defects teaches nobody what right
  looks like, and this team's whole job is making "correctly absent" distinguishable from
  "forgotten".
- **[[red-team-charter]] is asked to attack M1 and M5** — the count that leaves the
  building, and the incentive to register rather than retire. Findings-only
  ([[ORG_STRUCTURE]] §3); they land in `questions.md`.
- **Headcount corrections escalate on the first instance**
  ([[people-agent-ops-directive]] rule 3), including into
  [[positioning-fundraise-readiness-charter]]'s material. The first one, not the tenth.
