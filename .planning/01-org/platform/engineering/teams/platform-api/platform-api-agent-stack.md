---
type: agent-stack
division: platform
department: engineering
team: platform-api
status: designed
updated: 2026-08-27
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, platform.public_decorator_count]
links: ["[[platform-api-charter]]", "[[platform-api-schedule]]", "[[platform-api-loops]]", "[[platform-api-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[security-charter]]", "[[integration-engineering-charter]]"]
---

# Platform & API — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team owns the mechanisms no domain team can own: the 137 unguarded endpoints are not
> anyone's bug, they are the absence of a platform-level default
> ([[platform-api-charter]] §Distinct from siblings). The card inherits that team's sharpest
> constraint — the agent may report a route as unguarded and may never allowlist one, because
> automated allowlisting is premortem M1 with no human in the diff. Mechanism references are
> [[engineering-agent-stack]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `route-guard-census` | Sort all 448 routes into guarded / intentionally-public / unguarded on every PR, publish protection-by-default beside unguarded-reachable so neither can hide the other, and never move a route between buckets | NEW |

## 2. Agent cards

```yaml
agent: route-guard-census
unit: platform-api
triggers:
  - topic: pr.opened                      # publisher: GitHub PR events (L-PA-1 runs per PR)
  - schedule: "weekly — escape-hatch erosion (L-PA-2) and tenant isolation (L-PA-3)"   # mirrored in [[platform-api-schedule]]
  - schedule: "monthly — cross-cutting default drift (L-PA-4), OpenAPI vs implemented routes"
consumes:
  - "Nest route metadata — the same source as apps/api-gateway/src/openapi.ts (publisher: the compiled app)"
  - "apps/api-gateway/src/common/tenant/tenant.guard.ts and assert-tenant-match.ts"
  - "the public-route allowlist file and every @Public() site"
  - "the ~51 legitimately-public route claims (publisher: [[integration-engineering-charter]]; this agent never adjudicates them alone)"
  - "the 64 .spec.ts results (publisher: .github/workflows/ci.yml)"
emits:
  - "endpoints_protected_by_default_pct, unguarded_reachable_routes and public_decorator_count → [[platform-api-agenda-board]] and L-ENG-5 (consumer: [[engineering-agent-stack|eng-board-keeper]] and [[security-charter]])"
  - "a blocking CI failure on any increase in unguarded routes (consumer: the PR author)"
  - "the guarded/public/unguarded split (consumer: [[integration-engineering-charter]], which owns the entries and their signatures)"
  - "nf_a events (task_type: route_census) — consumer: NONE (gap, see §5)"
routing_class: judgment          # enumeration is scriptable; classifying "should this be public?" needs the allowlist reason and the owning team's context ([[platform-api-schedule]])
quality_bar: "the per-PR census fails on any increase in unguarded routes ([[platform-api-schedule]] L-PA-1), and is reproducible: a rerun on the same commit yields the same four counts. Reporting protection-by-default without unguarded-reachable beside it is a failed run, not a partial one."
autonomy:
  read: autonomous
  propose: autonomous            # findings land as CI output and board rows
  mutate_stock_money_outbound: confirm   # constant
memory: platform-api
escalates_to: "[[engineering-charter]]"
```

**The card's own two hard rules.** `route-guard-census` may report a route as unguarded; it may
never **allowlist** one — automated allowlisting is the single change that would make the escape
hatch invisible ([[platform-api-schedule]] §Skills owned). And it may never **classify severity**:
[[security-charter]] finds and classifies the class, this team builds the mechanism
(`technology.md:864`). A census that started ranking exposures would collapse a deliberate
find/fix seam into one unit.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `endpoint-guard-census` | T2 | Per PR | Four counts — total / guarded / intentionally-public / unguarded — reproducible on the same commit, with the ~51 integration routes separated from the remediable remainder; the two headline numbers always reported together | The census was performed by hand in the 2026-08-24 evidence pass: 448 routes, 137 unguarded, protection-by-default **0%**, ~51 of the 137 legitimately public leaving ~86 remediable (`technology.md:224-232`; [[platform-api-charter]] §Evidence). It has not been re-derived since | NEW |
| `guard-claim-check` | T2 | Any PR touching `common/tenant/`, and any doc restating guard behaviour | Every claim about guard ordering or tenant enforcement cites live code at `path:line`, or is corrected in the same PR; stale line ranges are treated as findings, not typos | Recorded verbatim in the fix: "found 2026-08-26 — `TenantGuard` is registered as an `APP_GUARD` (`app.module.ts:129`) and `JwtAuthGuard` is not… the global TenantGuard executed BEFORE passport had populated `request.user`… on every authenticated route it saw no user and waved the request through" (`assert-tenant-match.ts:3-12`) | NEW |

`tenant-scope-audit` and `cross-cutting-default-diff` appear in [[platform-api-schedule]] and are
**deliberately not rows here**: no tenant-scope sweep and no idempotency-derivation diff has been
run, so neither has a past instance to cite.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); gap
classification ([[security-charter]]); the signature model for the public routes
([[integration-engineering-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: route_census` and `guard_claim_check`. Needs `context.route`,
  `context.bucket` (guarded / public / unguarded) and `context.allowlist_reason` as jsonb keys,
  so the erosion question — "which routes changed bucket, and on whose PR" — is a filter over
  history rather than a diff of two screenshots.
- **Semantic** — `memory/` beside this file, `platform-api-MEMORY.md` as index. Its founding
  facts: the 448 / 137 / 0% baseline and its date, the ~51-vs-~86 split and that knowing which is
  which is a prerequisite rather than a detail, and the 2026-08-26 guard-ordering finding with
  where the assertion now lives. Provenance frontmatter per ADR 0034; every write is a PR — and
  for allowlist facts the PR *is* the control, since the whole risk is a bucket changing without
  a human in the diff.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `openapi.ts`,
  `app.module.ts` and the `common/*` middleware are retrieval targets by `path:line`, never
  preloaded.

**Consolidation** — monthly, mirrored in [[platform-api-schedule]]: read the census slice since
the last run; distill durable facts, failures first — every route that moved into the unguarded
or public bucket becomes a fact naming the PR and the reason given, never "coverage changed";
a repeated reason becomes a candidate for a mechanism rather than another allowlist entry;
expire facts unverified for 90 days. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[platform-api-loops]], NF-A events, vault PRs, and skill
candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `platform.endpoints_protected_by_default_pct` has no producer | It is 0% by construction — all protection is opt-in (`technology.md:230-232`) — and there is no job that would notice it changing. The number is a baseline, not a reading |
| The allowlist has no single file this agent can watch | The ~51 legitimately-public routes are asserted across two charters and enumerated in [[EXTERNAL_CONNECTIONS]] and [[ENDPOINTS]]; the per-PR allowlist diff review in [[platform-api-schedule]] presumes a file whose existence is not cited. Named rather than assumed |
| `route_census` NF-A events have no declared consumer | Beyond this team's own board row and L-ENG-5 |
| The find/fix seam with [[security-charter]] is a fortnightly meeting, not a channel | L-PA-5 closes fortnightly; nothing notifies either side between closes |

## 6. Evidence today

- **EXISTS — the mechanisms.** `common/{tenant,idempotency,rate-limit,cache,crypto,error-tracking}/`,
  the identity and org surfaces (81 endpoints across six modules), `openapi.ts`, `app.module.ts`,
  and 64 `.spec.ts` files — all cited in [[platform-api-charter]] §Evidence.
- **Correction to the charter's own citation.** [[platform-api-charter]] cites
  `tenant.guard.ts:38-46` as the no-authenticated-user branch. The branch is now at
  `tenant.guard.ts:47-52` and **still returns `true`** — the substance holds, the line range has
  shifted. What changed is that the comparison was extracted to
  `apps/api-gateway/src/common/tenant/assert-tenant-match.ts` and is invoked from `JwtAuthGuard`,
  "which is where it can actually decide" (`tenant.guard.ts:36-46`), so the global guard is now a
  backstop rather than the only thing between two tenants. This is exactly the drift
  `guard-claim-check` exists to catch, and it is why that skill has an instance.
- **NEW — `route-guard-census` and both skills.** Nothing runs the census; the 448/137/0% figures
  are a hand-derived baseline from 2026-08-24 with no repeat reading.
