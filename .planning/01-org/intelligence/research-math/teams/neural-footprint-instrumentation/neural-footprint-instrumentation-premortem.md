---
type: premortem
division: intelligence
department: research-math
team: neural-footprint-instrumentation
status: provisional
metrics: [nf_a.event_completeness, nf.private_telemetry_tables]
updated: 2026-08-24
links: ["[[neural-footprint-instrumentation-charter]]", "[[neural-footprint-instrumentation-loops]]", "[[neural-footprint-instrumentation-directive]]", "[[research-math-premortem]]", "[[data-charter]]", "[[security-charter]]", "[[analytics-bi-charter]]", "[[0006-neural-footprint-architecture]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Neural Footprint Instrumentation (RM-3) — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. RM-3 has failed. What happened?

The inherited premortem line (`intelligence.md:178-181`) supplies M1 and M2. Three more
follow, and one of them is the failure where the instrumentation *works* and is still
useless.

---

### M1 — OD-11 stalled, and five private footprints appeared

The column-level contract needed a dedicated schema session, and every week had something
more urgent. Meanwhile teams needed to see *something*, so each instrumented
"temporarily" against its own table. By the time the schema landed there were five private
footprints, each with a consumer and a dashboard, and no appetite to migrate any of them.
NF-A became a directory rather than an object — exactly what
[[0006-neural-footprint-architecture]] and [[README]] §4.1 were written to prevent.

**Earliest observable signal.** The **second** table in the repo holding token counts.
There is one today (`api_spend`). Not the fifth — the second. Also: a PR adding a column
that duplicates a field already present in `decision_log`.

**Counter-pressure.** A **freeze with an escape hatch**, not a ban. Temporary tables are
allowed; **undated** temporary tables are not. No new telemetry table lands without a line
in [[neural-footprint-instrumentation-loops]] naming the date it folds into the contract.
Second and stronger: **the join key ships before the schema.** `correlation_id` already
exists at `base_agent.py:743-784`; propagating it into `api_spend` costs one column and
turns two footprints into one footprint with a bad shape. Two tables that can be joined
are recoverable; two that cannot are the failure. Do not wait for OD-11 to close to do the
one thing that makes waiting survivable.

---

### M2 — `subject_type` shipped with two values, and the first real question had nowhere to land

The schema went live with `agent` and `guest`. Then Analytics & BI asked the first
operator-behaviour question — *which recommendations do managers act on?* — and the answer
was already being collected (`recommendation_actions`: act / dismiss / snooze / done /
pin) with nowhere to put it. The restaurant manager is **neither an agent nor a guest**
(fork F-3, `intelligence.md:519`). Adding a fourth `subject_type` after launch is a
migration plus a backfill plus an index strategy; before launch it is a line in an enum.

**Earliest observable signal.** The first analytics query that joins
`recommendation_actions` to anything NF-shaped through a hand-written mapping. Earlier
still: F-3 still open on the day the OD-11 session is scheduled.

**Counter-pressure.** **F-3 is decided inside the OD-11 session, not after it** — an
agenda item, not a follow-up. And the argument is already made in
[[0006-neural-footprint-architecture]]: the `bio` slot was reserved for a subject that
emits nothing today precisely so NF-C would need no migration later. The same reasoning
applies with more force to a subject that **already emits**. If the answer is "route
operator signal outside NF", that is fine — but it must be *decided*, because the default
of not deciding produces the migration.

---

### M3 — The footprint recorded the choice and lost the reasoning

Cost is easy to instrument: a wrapper, a token count, a dollar figure. Verdicts are
medium. **Reasoning is hard**, and it is the only part that makes this a *neural
footprint* rather than a billing log. Under delivery pressure the event ships with model,
tokens, latency, retries, cost and verdict — six of eight fields, an impressive
`event_completeness` — while `internal_state` (confidence, alternatives considered,
reasoning-trace reference) is "phase two". The org ends up with excellent economics
telemetry and no ability to model *why* anything was chosen, which is the definition it
adopted ([[0006-neural-footprint-architecture]]).

**Earliest observable signal.** A completeness metric climbing while every event has a
null `internal_state`. Concretely: the first NF event schema draft where `internal_state`
is optional and `cost` is required.

**Counter-pressure.** The hard half **already exists** — `log_decision()` writes
`reasoning`, `confidence` and `inputs` today (`base_agent.py:743-784`). So the correct
framing is not "add reasoning later"; it is **"do not lose what we already have."** The
completeness metric counts **all eight fields or the event is incomplete** — six of eight
is not 75%, it is a fail — and a proposal to make `internal_state` optional is escalated
to the founder, because it changes the definition of the term, not the schema.

---

### M4 — The research store was never built, and the compensation became rhetorical

The production store shipped because live personalization needed it. The wide,
append-only research store had no immediate consumer, so it stayed a paragraph in an ADR.
A year later the department that was promised research independence in exchange for not
being a separate company has a production telemetry table and no research corpus. The
compensation was honoured on paper and not in the schema —
[[0001-mudavym-single-entity]]'s consequence clause inverted.

**Earliest observable signal.** The OD-11 session producing a production column list and
**no research-log shape**. One deliverable instead of two.

**Counter-pressure.** The research store is the **cheapest** thing in this charter:
append-only, never migrated, no index strategy, no latency budget. It ships **in the same
change** as the production store, even if the first month it holds a copy of the same
events. And it is on the department's non-preemptible lane
([[research-math-schedule]]) because it is precisely the item with no urgent consumer —
which is the definition of what a protected lane is for.

---

### M5 — Instrumentation failed soft, everywhere, and the zeroes looked like good news

`SpendLogger` never re-raises (`spend_logger.py:83-86`) — correct: a telemetry failure must
not crash a pipeline. Applied uniformly to the new emitter, every dropped event becomes a
silent absence. Supabase credentials go missing in one environment (`:66-70` already
returns early when unconfigured), a deploy misses an env var, and `event_completeness`
reads high because the denominator is also computed from emitted events. Cost looks like
it fell.

**Earliest observable signal.** Model spend on the provider's invoice diverging from the
sum of NF events for the same period. That reconciliation is the only external check
available and it should exist from week one.

**Counter-pressure.** Fail soft, **count loudly**: every suppressed emission increments a
counter that is itself emitted through a different path, and `event_completeness` is
computed against **model calls attempted** (known at the wrapper) rather than events
written. Plus a monthly reconciliation against the provider invoice — an outside number
this team cannot influence, which is the only kind that catches a self-referential metric.

---

## Cross-cutting counter-pressure

- **Join key before schema.** M1's antidote and the cheapest action in this document.
- **Completeness is all-or-nothing across eight fields.** M3 dies here.
- **Two stores or neither.** M4 dies here.
- **[[data-charter]] is the counterpart, not the owner.** OD-11 names both or the schema
  ships twice.
- **[[security-charter]] SEC-3 is a downstream customer with a hard dependency**
  (`intelligence.md:488`) — its primary metric is unmeasurable until we emit. That makes
  our slippage someone else's blindness, which is a useful thing to feel.
- **[[red-team-charter]]** attacks the contract — especially whether `subject_type` and
  `internal_state` survive first contact.
- **Anti-sprawl.** Nothing revisited in 60 days is fiction ([[README]] §3.3).
