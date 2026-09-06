---
type: agent-stack
division: intelligence
department: security
team: access-control-tenant-isolation
status: designed
updated: 2026-08-27
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.public_decorator_count, sec.cross_tenant_write_paths]
links: ["[[access-control-tenant-isolation-charter]]", "[[access-control-tenant-isolation-schedule]]", "[[access-control-tenant-isolation-loops]]", "[[access-control-tenant-isolation-premortem]]", "[[access-control-tenant-isolation-agenda-full]]", "[[0034-agent-stack-artifact]]", "[[security-agent-stack]]", "[[perimeter-ingress-integrity-agent-stack]]", "[[skills-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# Access Control & Tenant Isolation — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> ⬦ This team holds two charters until the split trigger fires
> ([[perimeter-ingress-integrity-agent-stack]] is the other half of the same roster).
> Its agents **count and classify; they never add a decorator** — the department's
> read/propose-only rule ([[security-agent-stack]]), sharpened by the schedule's refusal
> of an `auto-guard-fixer`: the classification is the judgment, the decorator is trivial.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `guard-census` | Produce the two numbers together — routes reachable without a JWT, and the `@Public()` count — plus the diff against the allowlist, per PR and weekly | NEW |
| `route-classifier` | Turn each unclassified route into a five-field verdict with its `consumer` named and backed by `path:line`, and escalate rather than emit `unknown` | NEW |

**Two rows, and the split is the point.** Counting is mechanical; deciding whether a
route is public *by intent* is judgment, and merging them is how the number gets
optimised instead of the exposure ([[access-control-tenant-isolation-premortem]] M1, M3).

## 2. Agent cards

```yaml
agent: guard-census
unit: access-control-tenant-isolation
triggers:
  - topic: pr.controller_changed          # publisher: NONE (gap — ci.yml has seven grep-guards, none for this class)
  - schedule: "weekly — new-controller audit"    # mirrored in [[access-control-tenant-isolation-schedule]]
consumes:
  - "apps/api-gateway/src/**/*.controller.ts (disk census) + [[ENDPOINTS]]"   # publishers: the repo, the census scan
  - .security/endpoint-allowlist.txt      # publisher: NONE (gap — the file does not exist)
emits:
  - "sec.unguarded_authenticated_surface + sec.public_decorator_count, always as a pair"  # consumer: [[access-control-tenant-isolation-agenda-board]], rolled up by [[security-agent-stack|sec-orchestrator]]
  - "the unclassified-route list"         # consumer: route-classifier (below)
  - "census facts → memory PRs (§4); nf_a events (task_type: guard_census)"   # consumers: this team's semantic layer; NF-A tables (ADR 0006/0008)
routing_class: mechanical       # grep, count, diff — no judgment call anywhere in the loop
quality_bar: "both numbers or the run failed — the primary without sec.public_decorator_count is a failed run, because the primary can reach 0 by moving routes into the other ([[access-control-tenant-isolation-schedule]]); reproducible on the same commit. NONE (gap) — ADR 0017 has no verdict basis for audits"
autonomy:
  read: autonomous
  propose: autonomous           # numbers, diffs and the allowlist proposal land as PRs
  mutate_stock_money_outbound: confirm   # constant; and this agent never edits a controller
memory: access-control-tenant-isolation
escalates_to: "[[security-charter]]"
```

```yaml
agent: route-classifier
unit: access-control-tenant-isolation
triggers:
  - topic: route.unclassified             # publisher: guard-census (above) — named, in-team
  - schedule: "weekly classification sitting, one module per session"   # deletes itself when the backlog is drained, per [[access-control-tenant-isolation-schedule]]
consumes:
  - "the unclassified-route list; controller and service source by path:line"   # publishers: guard-census, the repo
  - "OD-19's enumeration ask"             # publisher: OPEN-DECISIONS.md:34
emits:
  - "five-field verdicts into [[access-control-tenant-isolation-agenda-full]]; sec.routes_classified; sec.cross_tenant_write_paths"   # consumers: this team's board, then [[platform-api-charter]] who authors the fix
  - "an escalation for every `unknown`"   # consumer: [[security-charter]]
  - nf_a events (task_type: route_classification)   # consumer: NF-A tables
routing_class: judgment         # "public by intent?" has been answered wrong twice out of five ingress modules
quality_bar: "a verdict is complete only with `consumer` named and a path:line behind it; `unknown` returns an escalation, not a verdict ([[access-control-tenant-isolation-schedule]]). Independent check: the quarterly verdict review with [[red-team-charter]] (L-ACT-4) — we do not grade our own verdicts"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: access-control-tenant-isolation
escalates_to: "[[security-charter]]"
```

**The cards' own hard rule:** neither agent adds `@UseGuards`, edits `tenant.guard.ts`,
or writes the allowlist without a human on the PR. A census that can close its own
findings drives the primary metric to zero while cross-tenant access stays live —
[[access-control-tenant-isolation-premortem]] M3, and why `auto-guard-fixer` is refused.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `endpoint-guard-census` | T2 | Per PR touching `**/*.controller.ts`, and weekly | Two numbers plus a diff against `.security/endpoint-allowlist.txt`; build fails when a route is unguarded and unlisted; one number without the other is a failed run | The `/analytics/consult` denial-of-wallet hole spanned 39 routes on a controller carrying zero `@UseGuards` and zero `@Public()`, and survived ordinary review until `ENDPOINTS.md` was generated by a scan; the fix was one file, +7 lines (`99da5eb`) | NEW |
| `route-classification-pass` | T2 | Any route in the census without a verdict; any new controller | Five-field verdict per route, `consumer` named, backed by `path:line`; `unknown` escalates | Two module-level misclassifications in our own census: `vendor-portal` labelled a webhook module when it is public-by-slug content (since corrected, `vendor-portal.controller.ts:6-13`), and `simpos` still labelled one at `ENDPOINTS.md:536` while being an unguarded simulator control surface (`simpos.controller.ts:23`) | NEW |

Consumed, owned elsewhere: `webhook-signature-audit` and `fail-open-audit`
([[perimeter-ingress-integrity-agent-stack]] — same team, other charter); registry
governance ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  §3.3 gate unchanged.
- **Episodic** — nf_a `task_type: guard_census` and `route_classification`, with
  `context.route` and `context.verdict` as jsonb keys so "which verdicts were later
  reversed" is a query, not a re-read of four quarters of PRs.
- **Semantic** — `memory/` beside this file, `access-control-tenant-isolation-MEMORY.md`
  as index. Founding facts, already known: the fail-open root cause
  (`tenant.guard.ts:38-46` returns `true` with no user, registered globally at
  `app.module.ts:124-126`); four recurrences closed four bespoke ways with zero recurrence
  guards (`/ux/*`, `one-tap-actions`, `ManualOverrideModal`, `analytics`); the dead check
  in the auth guard (`jwt-auth.guard.ts:48-59` computes two UUID flags and uses neither).
  Provenance per ADR 0034; every write a PR.
- **Working** — the card, the MEMORY index, charter §Mandate and §Metrics. Controllers,
  `ENDPOINTS.md` and migrations are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly: diff this month's census against last month's facts.
**Failures first** — a route that moved from ⚠️ to `@Public()` becomes a fact naming *who
decided and on what evidence*, since that is how the primary metric reaches zero without
the exposure moving (premortem M2); a reversed verdict becomes a fact naming the mechanism
that fooled the classifier. Expire facts unverified for 90 days; propose skill candidates.
One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction: board rows to the department (vault PR), NF-A events, loops in
[[access-control-tenant-isolation-loops]], skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `.security/endpoint-allowlist.txt` has no publisher | It does not exist, so "unguarded and unlisted" cannot be computed and the per-PR check ships red with the whole backlog listed |
| `pr.controller_changed` has no publisher | `ci.yml` runs seven grep-shaped guards, none for this class; today only human review notices a new controller. The weekly audit bounds the blind spot at 7 days |
| A filed verdict has no handoff to remediation | We classify, [[platform-api-charter]] authors; nothing tracks the interval. `.planning/v3.0-TECH-DEBT.md:62-75` still lists a defect the code closed — the register is already behind the code |
| `sec.cross_tenant_write_paths` has no measurement at all | Unmeasured in the charter; `simpos`'s 11 URL-tenant routes are the known candidates, and confirming them is OD-19's work, not this doc's |

## 6. Evidence today

- **NEW — both agents and both skills.** Every past instance above was found by hand, in
  review or in a generation session; nothing runs them on a schedule.
- **EXISTS — the defect and its root cause** (`tenant.guard.ts:38-46` plus global
  registration at `app.module.ts:124-126`: protection is opt-in across 448 routes), **and
  the working guard on 311 routes** (`auth/guards/jwt-auth.guard.ts`, honours `@Public()`,
  blacklist at `:30-42`) with the template already shipped
  (`one-tap-actions.controller.ts:64,80,92`). Neither needs designing.
- **PARTIAL — the primary metric's value.** The charter's 94 is stale as a present count:
  OD-19 recounted to **40** on 2026-08-26 (`OPEN-DECISIONS.md:34`) and
  `foundation/README.md` §2.3 records holes closed in PRs #31/#32. `guard-census`'s first
  run is that reconciliation; **OD-19 stays open here.** RLS is PARTIAL and not this
  stack's to settle — 182 policies, bypassed by the service-role key
  (`database/database.service.ts:15`).
- **NEW — everything in §4, and `sec.recurrence_guard_present` is still `false`.**
