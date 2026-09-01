---
type: charter
division: platform
department: engineering
team: platform-api
status: exists
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, platform.public_decorator_count]
updated: 2026-09-01
links: ["[[engineering-charter]]", "[[platform-api-premortem]]", "[[platform-api-agenda-full]]", "[[platform-api-agenda-board]]", "[[platform-api-directive]]", "[[platform-api-loops]]", "[[platform-api-schedule]]", "[[platform-api-charter|eng-platform-api]]", "[[security-charter]]", "[[integration-engineering-charter]]", "[[procurement-vendor-network-charter]]", "[[messaging-delivery-charter]]", "[[ENDPOINTS]]"]
---

# Platform & API — Charter

Division **Platform** → Department [[engineering-charter]] → Team `platform-api`
(§2.6 of `.planning/foundation/teams/technology.md:213-237`).

## Mandate

**The request path itself**: authn/authz, tenancy, idempotency, caching, rate limiting,
crypto, the OpenAPI surface, and NestJS module wiring. This team owns the cross-cutting
mechanisms that every one of the 448 routes passes through, whether or not the route's
owner thought about them.

## Boundaries

Owns outright:

- **Cross-cutting middleware** — `apps/api-gateway/src/common/{tenant,idempotency,rate-limit,cache,crypto,error-tracking}/`
- **`apps/api-gateway/src/common/tenant/tenant.guard.ts`** — including the decision at
  `:38-46` that it **returns `true` with no authenticated user, by design**. That single
  design choice is why auth is per-controller opt-in across the whole gateway.
- **Identity and org surfaces** — `apps/api-gateway/src/auth/` (28 endpoints),
  `team/` (33), `organizations/` (8), `restaurants/members` (6), `settings/` (4),
  `user-preferences/` (2)
- **API description and wiring** — `apps/api-gateway/src/openapi.ts`, `app.module.ts`
- **The gateway's test surface** — 64 `.spec.ts` files

## Distinct from siblings because

It owns cross-cutting concerns **no domain team can own**. The 137 unguarded endpoints are
not any one domain's bug — they are **the absence of a platform-level default**
(`technology.md:218-220`). A domain team can forget a decorator; only this team can make
forgetting impossible.

**The split with [[security-charter]] (Intelligence division)** is deliberate and stated:
Security **finds and classifies** the gap; this team **builds the mechanism** — a global
guard, a CI check — that makes the class impossible (`technology.md:220-222`; seam at
`technology.md:864`). Finder and fixer are different units for the same reason author and
auditor are elsewhere.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Finding and classifying security gaps | [[security-charter]] *(Intelligence)* — they find, we build |
| Which routes are *legitimately* public, and their signature verification | [[integration-engineering-charter]] — ~51 public routes with a different correctness criterion |
| Domain logic behind any endpoint | The owning domain team |
| Consequence ranking of an exposure | The team that bears it — [[procurement-vendor-network-charter]] for money, [[messaging-delivery-charter]] for sends |
| Runtime resilience, rate-limit capacity planning under load | [[runtime-resilience-charter|sre-runtime-resilience]] |
| Schema-level RLS policies | [[schema-migrations-charter]] |
| Agent action authorisation | [[action-safety-the-human-gate-charter|action-safety-the-human-gate]] *(Applied AI)* |

## Metrics it moves

**Primary: `platform.endpoints_protected_by_default_pct`** — the share of the 448 routes
whose protection comes from a **global mechanism rather than a remembered decorator**.

**Today that number is 0%: all protection is opt-in** (`technology.md:230-232`).

Reported permanently alongside `platform.unguarded_reachable_routes`, because the first
number can reach 100% while the second stays flat — that is precisely the premortem
([[platform-api-premortem]] M1). And `platform.public_decorator_count`, which is the
erosion counter.

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:224-228`).

- `apps/api-gateway/src/common/{tenant,idempotency,rate-limit,cache,crypto,error-tracking}/`
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` — returns `true` with no
  authenticated user, **by design**; the reason auth is per-controller opt-in
- `apps/api-gateway/src/auth/` (28), `team/` (33), `organizations/` (8),
  `restaurants/members` (6), `settings/` (4), `user-preferences/` (2)
- `apps/api-gateway/src/openapi.ts`, `apps/api-gateway/src/app.module.ts`
- 64 `.spec.ts` files

**The state, without euphemism**, as measured in the 2026-08-24 evidence pass. 448 routes;
137 unguarded; protection-by-default 0%. The unguarded set as measured then included
routes that place orders (`procurement/recurring-orders`, 6), send messages
(`notifications` 24, `communications` 18), and read contact lists (`contacts` 8). Roughly
51 of the 137 are **legitimately** public integration endpoints owned by
[[integration-engineering-charter]] — so the remediable population is closer to 86, and
knowing which is which is a prerequisite, not a detail.

**One of those has since closed.** The 6 `recurring-orders` routes have carried a
class-level `@UseGuards(JwtAuthGuard)` since 2026-08-25
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
OD-20); no `@Public()` appears in the file, and [[ENDPOINTS]]:464-473 marks all six ✅.
The counts above are **superseded, not re-derived here.** The corrected census is the E0
auth reconciliation, merged 2026-09-01 (`ECOSYSTEM-PLAN.md:83`, method at
[[ECOSYSTEM-E0-MEASUREMENTS]] §2): **468 route handlers, 444 authenticated, 23 deliberately
public with evidence, 0 unauthenticated by omission, 1 unclear.** The 137/86 figures above
stand only as their 2026-08-24 measurement and must not be quoted as current. **The zero
does not close this charter, because the defect count is zero while the defect generator is
fully intact:** `JwtAuthGuard` is per-controller, not a global `APP_GUARD`
(`app.module.ts:130-137` registers only `RateLimitGuard` and `TenantGuard`), so a
controller that declares nothing is unauthenticated by default and **endpoint 469 arrives
unguarded**. Nothing about the *default* changed: guarding is still opt-in per controller,
which is the mandate above. The cluster closed, the backlog closed; the class did not.
