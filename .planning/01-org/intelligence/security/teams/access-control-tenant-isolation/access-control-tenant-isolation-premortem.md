---
type: premortem
division: intelligence
department: security
team: access-control-tenant-isolation
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.public_decorator_count, sec.cross_tenant_write_paths]
updated: 2026-08-24
links: ["[[access-control-tenant-isolation-charter]]", "[[access-control-tenant-isolation-loops]]", "[[access-control-tenant-isolation-directive]]", "[[security-premortem]]", "[[perimeter-ingress-integrity-charter]]", "[[platform-api-charter]]", "[[red-team-charter]]", "[[ENDPOINTS]]"]
---

# Access Control & Tenant Isolation — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

Four mechanisms. The first is the one the division doc predicted
(`intelligence.md:247-249`) and it is also the one with four historical precedents in this
repo, so it is written first and at length.

---

### M1 — The 94 were classified in one heroic pass and the CI check was deferred

Someone spent two focused days adding `@UseGuards(JwtAuthGuard)` to six controllers.
`sec.unguarded_authenticated_surface` went 94 → 0. OD-19 closed. The CI assertion was
deferred to "after the fix", because the fix was the visible work and the guard felt like
paperwork on a solved problem. Six weeks later a new controller shipped without a guard —
written by someone who never read this charter, plausibly an agent working from a nearby
file — and the count was 3 with nobody counting.

**This is not speculation. It is the repo's documented behaviour four times over:**
`/ux/*` (closed by hand), `one-tap-actions` (closed by hand), `ManualOverrideModal`
(closed by hand), `analytics` (closed by hand, on a branch). Four correct fixes. Zero
mechanisms. The team would become the fifth instance of the pattern it was founded to end,
and — worse — the *last* one, because after the count reaches 0 nobody funds a guard for a
solved problem.

**Earliest observable signal.** Not the regression, which arrives months late. **The
ordering.** The first PR that adds a guard to a controller *without* touching an allowlist
file or a CI script. Stated as a metric relation: any week in which
`sec.unguarded_authenticated_surface` falls while `sec.recurrence_guard_present` is still
`false`. L-ACT-1 treats that week as a **failed** week even though the number improved,
which is the only way this signal survives contact with a burn-down chart.

**Counter-pressure.** Ship the CI check **first, red**, with an allowlist containing all
94 routes, before a single guard is added. Remediation then *is* deleting lines from a
reviewed file. The number cannot fall outside the mechanism and cannot rise silently at
all. The repo has four working precedents for exactly this shape
(`scripts/check_no_direct_stock_writes.sh:1-13` and siblings), so this is a half-day of
scripting, not a project. [[access-control-tenant-isolation-directive]] makes "guard
without allowlist change" a team-level rejection, not a discussion.

---

### M2 — `@Public()` became the escape hatch and the exposure never moved

The competent version of M1's fix creates this one. A global guard is installed with
`@Public()` as the opt-out. The 43 genuinely-public routes legitimately need it. Within
two sprints `@Public()` is the copy-paste cure for anything that 401s in local dev — it is
one line, it is in the codebase already, and it makes the error go away. Coverage reads
100%. `sec.public_decorator_count` has gone from 12 to 40 and nobody plotted it.
Reachable-unauthenticated is flat. The team reports the problem solved.

The gap between the two numbers is not theoretical here: **every one of the 311 currently
guarded routes is guarded because a human remembered**, so protection-by-default is 0% and
the entire safety of the system currently rests on a habit.

**Earliest observable signal.** The **first** `@Public()` decorator on a controller
outside the known set — `toast/`, `simpos/`, `pos-hub/`, `vendor-portal/`,
`common/orchestrator/inbound-email.controller.ts`, `communications/test/e2e/*`. Not the
tenth. By the tenth, `@Public()` is the convention and the escalation is an argument.

**Counter-pressure.** Two numbers in one table, always, with no exception
([[security-directive]] rule 3). Make `@Public()` structurally expensive: it may only be
added by editing the allowlist file, which CI diffs, so it is a reviewed one-line change
rather than a decorator inside a forty-file PR. And measure the metric as *unguarded
reachable routes* — never as *routes carrying the global guard*, because the second can
reach 100% while the first is flat.

---

### M3 — Guards were added and the tenant still came from the URL

The subtlest of the four, and the one that produces a green board with live cross-tenant
access. A controller gets `@UseGuards(JwtAuthGuard)`. It now requires *a* valid token. Its
handlers still read `@Param("restaurantId")` and query on it. Any authenticated user of
any restaurant reads and writes any other restaurant's data by editing the URL. The census
metric — which counts *guards*, not *derivations* — reports the route as fixed.

`TenantGuard` does not save this: it only sets `request.tenantId` when a user is present
(`tenant.guard.ts:49-50`); it does not compare that to the path. And 94 of the routes in
scope are `/:restaurantId`-shaped, so this is the default shape of the work, not an edge
case. The `one-tap-actions` fix shows the team already knows the answer —
`assertOwnRestaurant` 403s when the path names another tenant (`:80`) — which means the
failure here is not ignorance but a metric that cannot see the difference.

**Earliest observable signal.** A PR that adds `@UseGuards` and touches **no handler
body**. If the diff is decorators only on a `/:restaurantId` controller, the tenant is
still coming from the URL. Second signal: `sec.cross_tenant_write_paths` has never been
given a first reading — an unmeasured metric on a live shape is a blind spot with a name.

**Counter-pressure.** The verdict template requires **two** things, not one: guard
present **and** tenant derived from the token. A route is not classified `guard`-complete
until both hold. Extend the CI script to assert the pair — flag any handler that reads
`@Param("restaurantId")` on a guarded controller without an ownership assertion, exactly
the way `check_no_direct_stock_writes.sh` flags a forbidden call shape. Give
`sec.cross_tenant_write_paths` a first reading in week one, before any remediation, so the
baseline exists to be measured against.

---

### M4 — The classification was correct and the verdicts were never checked

94 routes get a verdict. Some are wrong — that is unavoidable and fine. What is not fine
is that nobody looked. The team that classified is the only team that ever read the
classification, and a route marked `public` because its consumer was unknown stays public
forever, now with a written verdict giving it the appearance of a decision.

The department's census has already been wrong twice at the module level (`vendor-portal`
labelled a webhook when it is public content; `simpos` still labelled a webhook when it is
an unauthenticated simulator control surface), which is direct evidence that a
classification pass over this codebase produces errors at a measurable rate.

**Earliest observable signal.** `sec.verdicts_reversed` = 0 at the end of the campaign. A
94-route classification with zero reversals was not checked; it was asserted.
Second signal: a verdict whose written justification is "unused" or "internal" rather than
naming the consumer.

**Counter-pressure.** Every verdict names its **consumer** — which client, which job,
which integration calls this route — and `unknown` is not a verdict, it is an escalation
([[access-control-tenant-isolation-directive]]). Hand the completed verdict list to
[[red-team-charter]] quarterly with one question: *which of these is most likely wrong?*
That is precisely the independent-attacker function ORG_STRUCTURE §3 put outside the line,
and using it here costs us nothing but a meeting.

---

## Signal summary

| # | Mechanism | Earliest signal | Watched by |
|---|---|---|---|
| M1 | Heroic pass, deferred CI | Guard added with no allowlist change | L-ACT-1 · weekly |
| M2 | `@Public()` escape hatch | First `@Public()` outside the known set | L-ACT-2 · weekly |
| M3 | Guarded route, URL tenant | `@UseGuards` PR touching no handler body | L-ACT-3 · weekly |
| M4 | Unchecked verdicts | `sec.verdicts_reversed` = 0 at campaign end | L-ACT-4 · quarterly |

**The one-sentence version.** Three of these four mechanisms end with the metric reading
**0** while the system is still reachable — so this team's real product is not the zero,
it is the mechanism that makes the zero mean something.
