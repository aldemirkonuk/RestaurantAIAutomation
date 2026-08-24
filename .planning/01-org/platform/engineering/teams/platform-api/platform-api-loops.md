---
type: loops
division: platform
department: engineering
team: platform-api
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, platform.public_decorator_count]
updated: 2026-08-24
links: ["[[platform-api-charter]]", "[[platform-api-premortem]]", "[[platform-api-directive]]", "[[engineering-loops]]", "[[security-charter]]", "[[integration-engineering-charter]]", "[[LOOP-MAP]]"]
loop_count: 5
loop_count: 5
loop_ids: ["pa-route-census", "pa-escape-hatch-erosion", "pa-tenant-isolation", "pa-cross-cutting-default-drift", "pa-find-versus-fix-seam"]
loop_close_times: ["per-PR", "weekly", "weekly", "monthly", "fortnightly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Platform & API — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-PA-1 — Route census

```yaml
type: loop
id: pa-route-census
owner: platform-api
measures: [platform.total_routes, platform.guarded_routes, platform.intentionally_public_routes, platform.unguarded_reachable_routes, platform.endpoints_protected_by_default_pct]
changes: [ci.route_census_job, platform.guard_rollout_order]
inputs_from: [security, integration-engineering]
outputs_to: [engineering, security, red-team, decision-office]
close_time: per-PR
status: proposed
```

The prerequisite loop. Enumerates routes from Nest metadata — the same source
`apps/api-gateway/src/openapi.ts` uses — and classifies each into three buckets. Today's
figures are **448 total, 137 unguarded, 0% protected by default**, derived from
`tenant.guard.ts:38-46` rather than measured. **Fails CI on an increase in the
unguarded-and-shouldn't-be bucket.** Counters premortem M2, and everything else depends on
it existing first.

---

## L-PA-2 — Escape-hatch erosion

```yaml
type: loop
id: pa-escape-hatch-erosion
owner: platform-api
measures: [platform.public_decorator_count, platform.allowlist_entries, platform.allowlist_additions_per_close_time]
changes: [ci.public_route_allowlist, guard.public_resolution]
inputs_from: [integration-engineering, procurement-vendor-network, messaging-delivery, security]
outputs_to: [engineering, red-team, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M1. Watches the allowlist as a **rate**, not a level: additions per
close-time is the erosion signal, and the first addition outside the ~51 known-public
integration routes escalates immediately. Money-moving, message-sending, and
contact-reading routes are categorically excluded, so any request to add one is a finding
rather than a decision. Feeds [[engineering-loops]] L-ENG-5.

---

## L-PA-3 — Tenant isolation

```yaml
type: loop
id: pa-tenant-isolation
owner: platform-api
measures: [platform.queries_without_tenant_predicate, platform.cross_tenant_reads_observed, platform.multi_tenant_fixture_coverage]
changes: [platform.scoped_query_helper, test.fixtures, schema.rls_policies]
inputs_from: [schema-migrations, security, compliance]
outputs_to: [security, compliance, engineering, decision-office]
close_time: weekly
status: proposed
```

Counters premortem M4 — the quieter half of the mandate. `tenant.guard.ts` is named for
tenancy and passes requests through by design, so isolation currently rests on each domain
team remembering a predicate. Multi-tenant fixture coverage is tracked because single-
restaurant fixtures make cross-tenant reads untestable by construction. A cross-tenant read
in any environment escalates jointly to [[security-charter]] and [[compliance-charter]].

---

## L-PA-4 — Cross-cutting default drift

```yaml
type: loop
id: pa-cross-cutting-default-drift
owner: platform-api
measures: [platform.idempotency_key_derivations_distinct, platform.routes_without_declared_cache_policy, platform.routes_without_rate_limit_tier]
changes: [platform.published_defaults, common.idempotency, common.cache, common.rate_limit]
inputs_from: [inventory-ledger, integration-engineering, messaging-delivery]
outputs_to: [engineering, inventory-ledger, decision-office]
close_time: monthly
status: proposed
```

Counters premortem M5. Three distinct idempotency key derivations across modules is the
canonical finding, and it is checkable today. Directly upstream of
[[inventory-ledger-premortem]] M4: per-hop keys make a retry indistinguishable from a new
event, and stock moves twice for one pour. The **default** is the deliverable — deviations
must be declared, never inherited by omission.

---

## L-PA-5 — Find-versus-fix seam

```yaml
type: loop
id: pa-find-versus-fix-seam
owner: platform-api
measures: [platform.security_findings_open, platform.findings_without_mechanism, platform.mechanism_classes_closed]
changes: [platform.mechanism_roadmap, decisions.open_queue]
inputs_from: [security, red-team, architecture-review]
outputs_to: [security, engineering, decision-office]
close_time: fortnightly
status: proposed
```

Holds the seam at `technology.md:864`: **Security classifies the 137 unguarded routes; this
team builds the mechanism that makes the class impossible.** The metric that matters is
*findings closed by a mechanism* versus *findings closed one route at a time* — the second
number rising is the sign that this team has become a remediation queue instead of a
platform. Advisory input is findings-only ([[ORG_STRUCTURE]] §3); this loop is how findings
become mechanisms rather than tickets.

---

## Close-time summary

| Loop | Close-time | Counters |
|---|---|---|
| L-PA-1 route census | per-PR | M2 — prerequisite for all others |
| L-PA-2 escape-hatch erosion | weekly | M1 |
| L-PA-3 tenant isolation | weekly | M4 |
| L-PA-4 cross-cutting default drift | monthly | M5 |
| L-PA-5 find-versus-fix seam | fortnightly | M3, seam integrity |
