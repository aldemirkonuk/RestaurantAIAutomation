---
type: premortem
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-charter]]", "[[harness-runtime-loops]]", "[[harness-runtime-directive]]", "[[ai-orchestration-premortem]]", "[[agent-fleet-charter]]", "[[action-safety-the-human-gate-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[decision-office-charter]]", "[[technology]]"]
---

# Harness & Runtime — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this team has failed. What happened?

### 1. A year of hardening on the layer most likely to be replaced

The seed premortem, `technology.md:330-332`: *"The harness choice fork (OD-03) stays
open for another six months, so this team keeps hardening a bespoke `BaseAgent` that a
framework decision later throws away."*

Expanded: nobody decided to keep OD-03 open. It stayed open because an open fork with
a named method and no date has no forcing function, and because this team had real
work in front of it either way. Retry policy got smarter. The registry got a fourth
tier. Sagas got ordered compensation. `base_agent.py` went from 1,053 lines to
1,600. In month nine the bake-off finally ran on real workloads, `hermes-agent` won,
and the write-off was not the 1,053 lines that existed at founding — it was the 550
added after the fork was already known to be open.

**Earliest observable signal.** The first commit adding a *new capability* to `core/`
— not a bug fix, not instrumentation — while `OPEN-DECISIONS.md:24` still reads OD-03
as open. That commit is the signal, not the line count three months later.
Instrumented as `harness.core_lines_added_since_od03_opened`.

**What would have prevented it.** Two things, and the second matters more:
(a) **The diet** — while OD-03 is open, `core/` takes bug fixes, instrumentation, and
interface *narrowing*. Narrowing `BaseAgent`'s surface pays under all three outcomes;
widening it is a bet on one. Enforced as `harness-diet-check`
([[harness-runtime-schedule]]).
(b) **A dated bake-off**, scheduled, with missing the date as an explicit escalation
to [[decision-office-charter]]. The decision log already names the method; what it
lacks is a date, and a method without a date is how forks age.

---

### 2. The DLQ became a well-engineered place where problems go to be forgotten

`technology.md:802-805` says this about `[[runtime-resilience-charter|sre-resilience]]` and it is at least as
true here, because **this team builds the DLQ and does not read it**:
retries work, circuit breakers work, failures land in `queue.dead_letters` exactly as
designed — and nothing consumes it. The system reports healthy *because* the
resilience machinery is working. Twelve months of correctly-dead-lettered vendor
emails, procurement messages, and POS events sit in a queue with an accurate name.

**Earliest observable signal.** DLQ depth that only ever increases. Not its
value — its **monotonicity**. A queue that never drains has no consumer, and that is
visible on the first week of `nf_a.dlq_depth` data, long before the depth is alarming.

**What would have prevented it.** A **daily** close-time on
`loop-harness-health` ([[harness-runtime-loops]]) — a DLQ read once a day cannot
become a place things are forgotten. And a named owner for the *reading*: the DLQ
sweep classifies each entry and assigns it to [[agent-fleet-charter]] (agent bug),
this team (harness bug), or [[reliability-sre-charter|reliability-charter]] (infrastructure). A queue whose
entries are unassignable is the failure mode; a triage rule is the counter-pressure.

---

### 3. `recurring_order_agent` kept buying wine outside the harness, and nobody noticed because it never failed loudly

`agents/recurring_order_agent.py:14` is a plain class. No retry, no idempotency, no
DLQ, no health check, no NF-A event — and it owns scheduled purchasing with
*"auto-execution with manager approval"* in its own feature list. It stayed that way
because it works, because its tests pass, and because it is invisible to every
dashboard this team builds: `fleet.live_agent_ratio` counts it as not-live, harness
health does not see it at all.

Then it double-fired after a restart — the exact class of bug `base_agent.py:704`
idempotency exists to prevent — and placed a duplicate recurring order. The
reconciliation took a week and the audit trail could not say whether a human had
approved the second one.

**Earliest observable signal.** Available **today**, before any failure:
`harness.agents_without_harness_guarantees = 1`. The signal is not an incident; it is
a census. Any module doing agent work outside `BaseAgent` is the signal, and there is
one right now.

**What would have prevented it.** Publishing that census as a metric rather than
leaving it as a fact discoverable by grep, and forcing a decision: bring it under
`BaseAgent`, or delete it, or document explicitly why a scheduled purchaser needs no
idempotency. All three are acceptable answers. Leaving it undiscussed is not — and it
has been undiscussed long enough to acquire a passing test suite.

---

### 4. The harness got a fourth abstraction that only one agent uses

Three tiers (`AgentTier.CORE` / `ON_DEMAND` / `OPTIONAL`, `agent_registry.py:27-32`)
became four, then five, because each new agent had one requirement the existing tiers
did not express. Each addition was locally correct. Collectively they made
`BaseAgent`'s contract impossible to reimplement — which meant the OD-03 bake-off had
no fair comparison to make, because "extend in-house" was the only option that could
express what the fleet already depended on. **The fork resolved itself by
accretion**, which is failure #1 arriving by a quieter route.

**Earliest observable signal.** A registry tier, lifecycle hook, or `BaseAgent`
extension point with exactly one caller. Countable with one grep, and worth running as
part of the diet check.

**What would have prevented it.** A rule with a number in it: **an abstraction in
`core/` with one caller is a feature of that caller, not of the harness.** Two callers
is the floor for a harness concept. This is the same anti-sprawl logic
[[README]] §3.3 applies to skills, moved one layer down.

---

### 5. Retry masked a defect for a year

`_process_with_retry` (`base_agent.py:543`) did its job perfectly. A parsing agent
failed on ~8% of vendor emails and succeeded on retry roughly half the time. Net
success rate: fine. Retries: elevated but not alarming, and nobody had a baseline to
be alarmed against because NF-A was not emitting. The underlying defect — a format
this parser never handled — was invisible for a year, and the cost showed up as
inference spend rather than as an error.

**Earliest observable signal.** `nf_a.retries` **per agent**, not in aggregate. One
agent retrying constantly while the fleet average looks healthy is the shape. It is
invisible in any rolled-up number, which is why [[ai-orchestration-charter]] refuses
to roll up.

**What would have prevented it.** Per-agent retry rate with a per-agent baseline, and
a standing rule that a **sustained** retry rate is an [[agent-fleet-charter]] ticket
rather than harness tuning. The harness's job is to make failure survivable, not to
make it quiet. Where those two conflict, this team owns saying so out loud.
