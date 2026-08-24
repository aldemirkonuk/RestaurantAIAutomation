---
type: loops
division: intelligence
department: security
team: access-control-tenant-isolation
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.public_decorator_count, sec.cross_tenant_write_paths, sec.verdicts_reversed]
updated: 2026-08-24
links: ["[[access-control-tenant-isolation-charter]]", "[[access-control-tenant-isolation-premortem]]", "[[access-control-tenant-isolation-directive]]", "[[access-control-tenant-isolation-agenda-board]]", "[[security-loops]]", "[[perimeter-ingress-integrity-loops]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[LOOP-MAP]]"]
---

# Access Control & Tenant Isolation — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

Four loops, one per premortem mechanism. Three close weekly because the campaign is short
and the failure modes are all "the number moved for the wrong reason" — which is only
detectable at the same cadence as the number.

---

## L-ACT-1 — Allowlist-only burn-down

```yaml
type: loop
id: act-allowlist-burndown
owner: access-control-tenant-isolation
measures: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.routes_classified]
changes: [ci.endpoint_guard_allowlist, platform.guard_coverage]
inputs_from: [platform-api, perimeter-ingress-integrity]
outputs_to: [security, engineering, decision-office]
close_time: weekly
status: proposed
```

Counters **M1**. The 94 → 0 burn-down, reported **only** as a diff to
`.security/endpoint-allowlist.txt`.

**The unusual rule that makes this loop work:** a week in which
`sec.unguarded_authenticated_surface` falls while `sec.recurrence_guard_present` is still
`false` is recorded as a **failed week**, not a good one. The number improved outside the
mechanism, which is the exact shape of the failure this team was founded to end. Without
that rule, a burn-down chart rewards precisely the behaviour that killed the four previous
attempts.

---

## L-ACT-2 — Exposure versus coverage

```yaml
type: loop
id: act-exposure-vs-coverage
owner: access-control-tenant-isolation
measures: [sec.unguarded_authenticated_surface, sec.public_decorator_count]
changes: [ci.public_route_allowlist, security.classification_policy]
inputs_from: [platform-api, perimeter-ingress-integrity, integration-engineering]
outputs_to: [security, engineering, decision-office]
close_time: weekly
status: proposed
```

Counters **M2**. Two numbers, one table, never separately.

Fires on the **first** `@Public()` outside the known set (`toast/`, `simpos/`, `pos-hub/`,
`vendor-portal/`, `inbound-email.controller.ts`, `communications/test/e2e/*`) — not the
tenth. Baselines: **94** and **12**. If the first reaches 0 and the second has reached 40,
this loop reports a failure and L-ACT-1 reports success, which is the point of running both.

---

## L-ACT-3 — Tenant-derivation audit

```yaml
type: loop
id: act-tenant-derivation
owner: access-control-tenant-isolation
measures: [sec.cross_tenant_write_paths, sec.guarded_routes_with_url_tenant, sec.routes_with_ownership_assertion]
changes: [ci.endpoint_guard_allowlist, platform.tenant_derivation_policy]
inputs_from: [platform-api, engineering]
outputs_to: [security, compliance, decision-office]
close_time: weekly
status: proposed
```

Counters **M3** — the failure that produces a green board and live cross-tenant access.

Measures the thing the census metric structurally cannot see: routes that now *require* a
token and still take the tenant from the URL. Baseline is **unmeasured**, and taking that
first reading is deliberately sequenced **before** any remediation
([[access-control-tenant-isolation-agenda-full]] step 2) — once guards start landing, the
before-picture is gone.

Reference implementation for the target state:
`one-tap-actions.controller.ts:64,80,92`. Outputs to [[compliance-charter]] because a
cross-tenant read of `contacts` is a personal-data event, not only a bug.

---

## L-ACT-4 — Verdict review

```yaml
type: loop
id: act-verdict-review
owner: access-control-tenant-isolation
measures: [sec.verdicts_reversed, sec.verdicts_with_named_consumer, sec.verdicts_open_on_unknown_consumer]
changes: [security.classification_policy, ci.endpoint_guard_allowlist]
inputs_from: [red-team, perimeter-ingress-integrity, platform-api]
outputs_to: [security, decision-office]
close_time: quarterly
status: proposed
```

Counters **M4**. Quarterly, because a verdict review that runs weekly is just the
classification pass again.

Hands the completed verdict list to [[red-team-charter]] with one question: *which of
these is most likely wrong?* That is the independent-attacker function
[[ORG_STRUCTURE]] §3 placed outside the line, and it costs this team nothing but a meeting.

`sec.verdicts_reversed` = 0 at campaign end is the alarm, not the goal. The census has
already been wrong twice at module level (`vendor-portal`, `simpos`), so a 94-route pass
with zero reversals was asserted rather than checked.

---

## Close-time summary

| Loop | Close-time | Counters | Alarm state |
|---|---|---|---|
| L-ACT-1 allowlist-only burn-down | weekly | M1 | count falls while guard absent |
| L-ACT-2 exposure vs coverage | weekly | M2 | first `@Public()` outside the known set |
| L-ACT-3 tenant-derivation audit | weekly | M3 | guarded route, URL tenant, no assertion |
| L-ACT-4 verdict review | quarterly | M4 | zero reversals at campaign end |

**Handoff to the sibling charter.** `public-with-signature` and `public-content` verdicts
leave L-ACT-1 and enter [[perimeter-ingress-integrity-loops]]'s L-PII-1. Today that
crossing is internal to one team; the loops are written as if it were not, because that is
what makes the eventual split cost a day instead of a quarter.
