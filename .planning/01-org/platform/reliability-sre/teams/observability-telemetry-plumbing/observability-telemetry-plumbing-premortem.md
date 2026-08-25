---
type: premortem
division: platform
department: reliability-sre
team: observability-telemetry-plumbing
status: provisional
metrics: [nf_a.emission_coverage, obs.metrics_with_liveness_twin_pct, obs.decision_log_join_rate]
updated: 2026-08-24
links: ["[[observability-telemetry-plumbing-charter]]", "[[observability-telemetry-plumbing-loops]]", "[[reliability-sre-premortem]]", "[[neural-footprint-instrumentation-charter]]", "[[red-team-charter]]"]
---

# Observability & Telemetry Plumbing — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

---

### M1 — Zero looked like calm

The seed mechanism, stated in the evidence pass: `observability.py` silently degrades to
`NoopMetric` (`:53`) when `prometheus_client` is absent — logged at INFO (`:50`), which
means it scrolls past. A dependency resolution changes on a Railway rebuild, the Prometheus
client is no longer in the image, every counter becomes a method that does nothing, and
every dashboard reads **zero**. Zero is what a healthy error counter reads. The team spent
the quarter reassured by a system that had stopped speaking.

This is the department's characteristic failure ([[reliability-sre-premortem]] M1) in its
purest form, and it lives in this team's code.

**Earliest observable signal.** A counter that was non-zero last week reading **exactly
zero for a full close-time** — not a spike, an absence. Precisely: `agent_tasks_total` flat
at zero across a deploy boundary while `decision_log` rows continue to be written by
`base_agent.py:743`. The two disagreeing is the tell, because they have independent paths.

**What would have prevented it.** A **liveness twin**: a `build_info`-style gauge set to 1
by construction at start-up, alerting on *absence* rather than on a threshold. Plus three
cheap changes to existing code: the no-op fallback logs at **WARNING**, not INFO; an
`observability_degraded` boolean is exposed on `health-proxy.controller.ts` so
`AdminHealth.tsx` renders it; and a board-admission rule — a metric with no liveness twin
is not admitted to [[observability-telemetry-plumbing-agenda-board]] at all.

---

### M2 — Two writers, no join key, so NF-A never became one event

Today the NF-A tuple is split: `decision_log` (written by `base_agent.py:743`) holds the
decision; `api_spend` holds the cost. They **cannot be joined per task**
(`technology.md:745-746`). The team, reasonably, ships a decision dashboard and a cost
dashboard. Both are useful. Neither is NF-A. A year later the question "what did this task
cost and did it succeed" still requires a human with a spreadsheet, and L4 — which the
whole org's metric story depends on ([[README]] §1) — has not started.

**Earliest observable signal.** The **first** NF-A question answered by a manual join.
Not the tenth. Concretely: any analysis where someone exports two tables and matches on
timestamp proximity. Timestamp-proximity matching is the visible symptom of a missing key.

**What would have prevented it.** The join key is the **first** deliverable, before any
new dashboard: one correlation/task id threaded from task acceptance through model call
through decision write. And the migration target is `decision_log` itself, not a green-field
`neural_footprint_event` table — `technology.md:739` says so explicitly, because a new
table strands the only decision trail the system has and doubles the writers instead of
unifying them. [[neural-footprint-instrumentation-charter]] defines the event shape; this
team refuses to build a second pipe for it.

---

### M3 — Incident command ate the team it was folded into

A dedicated Incident Response team was rejected at this scale — correctly
(`technology.md:712-714`) — and command folded here. The predictable cost arrives on
schedule: this is the team that gets pinged when anything looks wrong, because it owns the
dashboards. Triage is urgent, instrumentation is not, and urgent wins every week. Twelve
months on, the team is the org's on-call function and `nf_a.emission_coverage` is where it
started.

**Earliest observable signal.** **Three consecutive close-times where triage volume moves
and emission coverage does not.** That exact pair sits on the board specifically so the
divergence is visible before it is a year old.

**What would have prevented it.** Emission coverage is the **primary** metric and triage is
time-boxed with a named ceiling; [[reliability-sre-directive]] routes any multi-team
incident to the department rather than to whoever noticed. If the pair diverges for three
close-times the department reallocates — and if it diverges for three more, the Incident
Command entry trigger in [[reliability-sre-charter]] has effectively fired, and the right
response is to re-argue the rejection, not to keep absorbing it silently.

---

### M4 — We instrumented what was easy, and coverage rose while NF-A stayed empty

`instrument_fastapi` (`observability.py:341`) makes HTTP surfaces trivially observable.
Agent-internal decisions — which model was chosen, which alternatives were considered,
which tool calls fired, whether the task was *done* — are the hard half and the half NF-A
needs ([[README]] §4.2). The number labelled "coverage" climbs into the nineties on the
back of request instrumentation, the team declares the prerequisite met, and L4 unblocks on
a metric that measured the wrong denominator.

**Earliest observable signal.** The coverage denominator being **requests** rather than
**agent tasks** in any dashboard, report, or query — visible the first time it is written
down. Also: coverage above 80% while `obs.decision_log_join_rate` is still near zero.

**What would have prevented it.** The denominator is fixed in the metric's definition in
[[observability-telemetry-plumbing-charter]] and repeated on the board: **agent tasks, not
requests.** And the tuple is graded as *complete or not* — an event missing `cost` or
`doneability` counts as zero, not as 0.75. Partial credit is what lets an easy 90% exist.

---

### M5 — Traces and error capture carried guest data, and the fix was to turn them off

`TracingManager` (`:267`) and Sentry both capture context by default; the system handles
guest identity (`check_no_raw_guest_channels.sh`, `check_no_guest_name_matching.sh` exist
because this is a live concern). A payload with a guest email lands in a third-party trace
store. The remediation under time pressure is to strip context aggressively — and the
traces become useless at exactly the moment they are needed.

**Earliest observable signal.** The first Sentry event or span whose attributes contain a
raw email, phone, or guest name. Greppable at the boundary, and cheaper to prevent than to
retract from a vendor.

**What would have prevented it.** A **redaction allowlist at the emission boundary** —
attributes are opt-in, not opt-out — reviewed with [[compliance-privacy-charter|compliance-charter]] before the first
trace leaves the process, so the choice is never "leak or blind". The existing guest-channel
guard scripts are the precedent: the invariant is enforced at the wire, not by intention.

---

## Cross-cutting

- **[[red-team-charter]] should attack M1 first.** This team's entire value is that its
  green is trustworthy; that claim is the org's largest single point of self-deception.
- Every mechanism above has a loop with a close-time in
  [[observability-telemetry-plumbing-loops]]. A counter-pressure without a close-time is
  M1 one level up.
