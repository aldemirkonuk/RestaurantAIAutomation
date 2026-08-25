---
type: premortem
division: platform
department: engineering
team: platform-api
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, platform.public_decorator_count]
updated: 2026-08-24
links: ["[[platform-api-charter]]", "[[platform-api-loops]]", "[[platform-api-directive]]", "[[engineering-premortem]]", "[[security-charter]]", "[[integration-engineering-charter]]", "[[red-team-charter]]"]
---

# Platform & API — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:234-237`): *a global guard is added
with a `@Public()` escape hatch, the webhook modules legitimately need it, `@Public()`
becomes the copy-paste default for anything that 401s in local dev, and the team declares
the problem solved while the count of reachable-unauthenticated routes is unchanged.*

## It is 2027-08. This team has failed. What happened?

### M1 — The escape hatch ate the mechanism

The global guard shipped. It was good work. It needed `@Public()` because ~51 integration
routes are legitimately unauthenticated ([[integration-engineering-charter]]). Then a
developer hit a 401 in local dev on a route that should have been authenticated, saw
`@Public()` used on a webhook nearby, and copied it. Then the pattern was in the codebase,
which is where patterns come from. Eighteen months later
`platform.endpoints_protected_by_default_pct` reads 100% — every route carries the guard —
and the number of routes a stranger can reach is exactly what it was.

**Earliest observable signal.** The **first** `@Public()` on a controller outside
`toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`, and
`common/orchestrator/inbound-email.controller.ts`. Not a trend — the first instance, because
after the first the pattern is established and the argument becomes "we already do this".

**Counter-pressure.** Make `@Public()` **structurally expensive rather than socially
discouraged**: an allowlist file that CI diffs, so making a route public is a reviewed
change to one file rather than a decorator in a forty-file PR. Report two numbers forever —
routes carrying the guard, and **reachable unguarded routes** — because only the second one
can fail. Money-moving and message-sending routes are categorically excluded from the
allowlist ([[procurement-vendor-network-premortem]] M1, [[messaging-delivery-premortem]] M5).

---

### M2 — 0% was never actually measured, only quoted

"Protection-by-default is 0%" is a true statement derived from a design fact:
`tenant.guard.ts:38-46` returns `true` with no authenticated user. It is not a *reading*.
Nothing recomputes it, nothing recomputes the 137, and nothing distinguishes the ~51
legitimate public routes from the ~86 remediable ones. The team ships a guard, believes it
improved things, and cannot demonstrate it — and worse, cannot detect a regression when a
new unguarded route lands.

**Earliest observable signal.** A new controller merged without the route census changing.
If adding an endpoint cannot move a number, no number exists.

**Counter-pressure.** A **route census job** in CI: enumerate all routes from the Nest
metadata (the same source `openapi.ts` uses), classify each as guarded / intentionally
public / unguarded-and-shouldn't-be, and fail on an increase in the third category. This is
the team's first deliverable, ahead of the guard itself — a mechanism whose effect cannot be
measured is indistinguishable from a mechanism that does not work.

---

### M3 — The legitimate-public set was never enumerated, so everything looked legitimate

There are roughly 51 intentionally-public integration routes
(`technology.md:257`), owned by another team, with a different correctness criterion —
signature verification rather than `JwtAuthGuard`. If that set is never written down as a
list, every unguarded route has a plausible story: "that's a webhook", "that one's
internal", "the agent calls it". The `recurring-orders` cluster is exactly this — 6
unguarded routes justified as "internal" ([[ENDPOINTS]]:428).

**Earliest observable signal.** Any conversation about whether a specific route is
legitimately public that cannot be resolved by looking something up. If the answer requires
a person's memory, the enumeration does not exist.

**Counter-pressure.** The allowlist **is** the enumeration — one file, one line per public
route, each with a stated reason and a named owning team. A route not in the file is not
public, regardless of intent. Ownership of *entries* belongs to
[[integration-engineering-charter]] (they must verify signatures on them); ownership of the
*file's existence and CI enforcement* belongs here. That split matters: the team that wants
a route public should not be the only team that can add it.

---

### M4 — Tenancy was assumed rather than enforced, and the leak crossed restaurants

`tenant.guard.ts` is named for tenancy, not for authentication, and it passes requests
through by design. Authentication is the visible problem; **tenant isolation is the
quieter one**. An authenticated user from restaurant A calls an endpoint that reads by id
without scoping to their tenant. Every test passes — there is one restaurant in the test
fixtures. The failure is invisible until there are enough customers for it to matter, and
by then it is a disclosure event, not a bug.

**Earliest observable signal.** Any query in a domain module that filters by a resource id
without a tenant predicate. Detectable statically today, cheaply, and worth doing before
customer count makes it urgent. Second signal: test fixtures containing exactly one
restaurant.

**Counter-pressure.** Tenant scoping becomes a **platform mechanism** — a scoped query
helper or a row-level policy — not a convention each domain team remembers. Multi-tenant
fixtures in the shared test setup, so a cross-tenant read fails a test rather than a
customer. Row-level enforcement is co-owned with [[schema-migrations-charter]], since RLS
is DDL.

---

### M5 — Idempotency, cache, and rate limiting became per-module folklore

`common/idempotency/`, `common/cache/`, and `common/rate-limit/` exist as modules. Whether
a given endpoint uses them is a domain team's decision, made once, usually by copying a
neighbouring controller. So identical semantics are implemented three ways: one module
keys idempotency on a client-supplied header, another on a request hash, a third not at
all. [[inventory-ledger-premortem]] M4 describes the consequence — per-hop keys that make a
retry indistinguishable from a new event, and stock that moves twice for one pour.

**Earliest observable signal.** Two modules deriving idempotency keys differently. One
comparison, done once, surfaces it — and it is checkable today.

**Counter-pressure.** Publish an explicit **default** for each cross-cutting concern: the
key derivation, the cache policy, the rate-limit tier a route gets if it declares nothing.
Deviations are declared, not inherited by omission. The cross-hop key derivation is a seam
decision with [[inventory-ledger-charter]] and [[integration-engineering-charter]]; this
team owns the mechanism, not the domain policy.

---

## What [[red-team-charter]] should attack first

M2, then M1 — in that order, which is not the intuitive one. The instinct is to attack the
escape hatch, but an unmeasurable guard fails silently whether or not it has a hatch.
[[security-charter]] classifies the 137; this team must be able to **count** them
repeatedly before it starts closing them, or the closing cannot be shown to have happened.
