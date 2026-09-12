---
type: loops
division: intelligence
department: security
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.public_decorator_count, sec.unverified_public_ingress, sec.injection_corpus_size, nf_a.unauthenticated_inference_spend, sec.fail_open_defaults]
updated: 2026-08-24
links: ["[[security-charter]]", "[[security-premortem]]", "[[security-directive]]", "[[security-agenda-board]]", "[[access-control-tenant-isolation-loops]]", "[[perimeter-ingress-integrity-loops]]", "[[ai-surface-security-loops]]", "[[neural-footprint-instrumentation-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_ids: ["sec-exposure-burndown", "sec-exposure-vs-coverage", "sec-build-vs-comment", "sec-injection-corpus", "sec-inference-spend-attribution"]
loop_close_times: ["weekly", "weekly", "quarterly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "blocked"]
---

# Security — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Five department loops. Each is tied to a numbered mechanism in [[security-premortem]] —
a loop with no premortem mechanism behind it is a status meeting.

---

## L-SEC-1 — Exposure burn-down with a lid

```yaml
type: loop
id: sec-exposure-burndown
owner: security
measures: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.routes_classified, sec.verdicts_reversed]
changes: [ci.endpoint_guard_allowlist, platform.guard_coverage]
inputs_from: [access-control-tenant-isolation, perimeter-ingress-integrity, platform-api]
outputs_to: [engineering, decision-office, red-team]
close_time: weekly
status: proposed
```

Counters **M1**. The burn-down of 94 → 0, reported **only** as a diff to the CI allowlist
file. A week in which the count falls and the allowlist did not change is recorded as a
**failed** week, not a good one — the count moved outside the mechanism.

`sec.verdicts_reversed` is the honesty term: verdicts that had to be changed after the
fact. A campaign that never reverses a verdict is not being checked.

---

## L-SEC-2 — The two numbers, side by side

```yaml
type: loop
id: sec-exposure-vs-coverage
owner: security
measures: [sec.unguarded_authenticated_surface, sec.public_decorator_count, sec.unverified_public_ingress, sec.fail_open_defaults]
changes: [security.classification_policy, ci.public_route_allowlist, platform.control_defaults]
inputs_from: [access-control-tenant-isolation, perimeter-ingress-integrity, integration-engineering]
outputs_to: [engineering, platform-api, decision-office]
close_time: weekly
status: proposed
```

Counters **M2**. Publishes exposure and coverage in one table, never separately. Fires an
escalation on the **first** `@Public()` outside the known set — `toast/`, `simpos/`,
`pos-hub/`, `vendor-portal/`, `inbound-email.controller.ts`, `communications/test/e2e/*` —
not the tenth ([[security-directive]], first-instance rule).

Also tracks `sec.fail_open_defaults`, today **4**. That number has no natural downward
pressure from anywhere else in the org: nothing breaks when a JWT secret silently falls
back to a public string, which is precisely why it needs a loop.

---

## L-SEC-3 — Controls shipped versus findings written

```yaml
type: loop
id: sec-build-vs-comment
owner: security
measures: [sec.controls_merged, sec.findings_written, sec.metrics_moved_this_quarter]
changes: [security.team_allocation, security.agenda_full]
inputs_from: [access-control-tenant-isolation, perimeter-ingress-integrity, ai-surface-security]
outputs_to: [intelligence, decision-office]
close_time: quarterly
status: proposed
```

Counters **M5** — the drift into being a second Red Team. Quarterly, because the failure
takes a quarter to become visible and a monthly cadence would just produce noise.

The alarm state is specific and easy to read: **every artifact's `updated` field moved and
no `sec.*` metric did.** [[security-agenda-board]]'s Dataview staleness query is one half
of the reading; the standing counters are the other.

---

## L-SEC-4 — Adversarial corpus growth and firing rate

```yaml
type: loop
id: sec-injection-corpus
owner: security
measures: [sec.injection_corpus_size, sec.corpus_detection_rate, sec.autonomous_send_rate, sec.doc_code_divergences_open]
changes: [orchestrator.injection_policy, orchestrator.guardrail_set, ci.injection_suite]
inputs_from: [ai-surface-security, evaluation-doneability, red-team]
outputs_to: [engineering, ai-orchestration, decision-office]
close_time: monthly
status: proposed
```

Counters **M3**. Two measures that must be read together: corpus **size** and corpus
**detection rate**. A growing corpus with a rising detection rate is progress; a growing
corpus with a flat rate means we are adding cases the model already passes.

`sec.autonomous_send_rate` is here rather than in the AI team's own loop because it is the
number that makes the doc-versus-code divergence undeniable:
`inbound-responder.service.ts:156-157` says the service never sends, and `:509-513`
schedules a send after a two-minute undo window. Until that reconciles, the rate is the
only honest description of the system.

Boundary note: [[evaluation-doneability-charter]] grades whether output was *good*; this
loop grades whether output was *attacker-steered*. They share the corpus format, not the
pass condition.

---

## L-SEC-5 — Inference spend attribution (blocked, deliberately visible)

```yaml
type: loop
id: sec-inference-spend-attribution
owner: security
measures: [nf_a.unauthenticated_inference_spend, sec.tenants_with_inference_budget, sec.model_callsites_emitting_cost, sec.days_dependency_open]
changes: [security.inference_budget_policy, orchestrator.spend_ceiling]
inputs_from: [neural-footprint-instrumentation, ai-surface-security, analytics-bi]
outputs_to: [research-math, engineering, decision-office, strategy]
close_time: monthly
status: blocked
```

Counters **M4**. `status: blocked` is set deliberately rather than `proposed`, and
`sec.days_dependency_open` is a measure rather than a note — **the point of this loop is
to make a blocked dependency accrue a visible number** instead of quietly becoming
someone's excuse.

`sec.model_callsites_emitting_cost` was **0 of 7**. It is **25 of 25** as of 2026-08-24 —
7 gateway sites routed through `common/model-client/`, 18 Python sites through
`SpendLogger`, with `scripts/check_model_calls_logged.sh` failing the build if a new one
skips the ledger. The hard dependency on
[[neural-footprint-instrumentation-charter]] (`intelligence.md:488`) is discharged.

`sec.tenants_with_inference_budget` was **0**; it is **10 of 10**. Every restaurant now
resolves to an allowance through `restaurants.subscription_tier`, and an unrecognised tier
resolves to the *most* restrictive one rather than to none — all 10 live tenants read
`pilot`, which maps to core. The ceilings themselves are placeholders pending OD-23.

**Still blocked, and now on one thing rather than three.**
`nf_a.unauthenticated_inference_spend` remains unreadable: the NF-A event records *who the
agent was*, never *whether the caller that triggered it was authenticated*. The route
census can bound it — every model-calling route is guarded after #31/#32 — but bounding is
not measuring, and this loop exists to hold a real number. That is the remaining
dependency, and `sec.days_dependency_open` should keep counting against it.

---

## Close-time summary

| Loop | Close-time | Counters | Status |
|---|---|---|---|
| L-SEC-1 exposure burn-down with a lid | weekly | M1 | proposed |
| L-SEC-2 two numbers side by side | weekly | M2 | proposed |
| L-SEC-3 controls vs findings | quarterly | M5 | proposed |
| L-SEC-4 adversarial corpus | monthly | M3 | proposed |
| L-SEC-5 inference spend attribution | monthly | M4 | **blocked** on RM-3 |

**One loop is blocked and says so.** Per [[ORG_STRUCTURE]] §5 a loop must name its
close-time; nothing says it must be unblocked. A blocked loop with a close-time and a day
counter is a functioning escalation. A blocked loop quietly marked `proposed` is a lie
with a cadence.
