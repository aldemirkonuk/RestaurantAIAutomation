---
type: charter
division: intelligence
department: security
team: access-control-tenant-isolation
status: partial
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.public_decorator_count, sec.cross_tenant_write_paths]
updated: 2026-08-24
links: ["[[security-charter]]", "[[access-control-tenant-isolation-premortem]]", "[[access-control-tenant-isolation-agenda-full]]", "[[access-control-tenant-isolation-agenda-board]]", "[[access-control-tenant-isolation-directive]]", "[[access-control-tenant-isolation-loops]]", "[[access-control-tenant-isolation-schedule]]", "[[perimeter-ingress-integrity-charter]]", "[[ai-surface-security-charter]]", "[[platform-api-charter]]", "[[engineering-charter]]", "[[red-team-charter]]", "[[compliance-privacy-charter|compliance-charter]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# Access Control & Tenant Isolation — Charter

Division **Intelligence** → Department [[security-charter]] → Team
`access-control-tenant-isolation` (SEC-1, `.planning/foundation/teams/intelligence.md:218-249`).

> ⬦ **Staffing note.** This charter and
> [[perimeter-ingress-integrity-charter]] are recommended to be held by **one team**
> until the endpoint campaign ships (INTEL-F4, `intelligence.md:190-199`). Two charters, one
> team, one written split trigger. See [[security-charter]] for the argument and the
> trigger.

## Mandate

Own **who is allowed to reach an authenticated route, and whose data they see**:
`JwtAuthGuard` coverage, `TenantGuard` semantics, `@Public()` policy, row-level security
posture, and — the part that makes this a team rather than a task — **the CI check that
makes the whole defect class non-recurring**.

## Boundaries

Owns outright:

- **The classification verdict** for every route that should require identity. Per route,
  never per module ([[security-directive]] rule 2).
- **`TenantGuard` semantics** — specifically whether "no user ⇒ allow"
  (`tenant.guard.ts:38-46`) remains the default, and what replaces it.
- **Tenant derivation** — the rule that `restaurantId` comes from the signed token and
  never from the URL path or a query parameter.
- **The recurrence mechanism** — the allowlist file, the CI script, and the policy that
  a guard change without an allowlist change is rejected.
- **RLS posture** — whether row-level security is a real control on the gateway path or
  only for direct-client access.

## Distinct from siblings because

**[[perimeter-ingress-integrity-charter]]'s answer to an unauthenticated request is
"accept it, and prove where it came from." This team's answer is "reject it."** The
controls do not overlap: a guard cannot secure a webhook and an HMAC cannot scope a
tenant. If this team absorbed the sibling charter permanently, the predictable outcome is
a webhook behind a JWT and a silently broken integration — which is why the merge is
recommended as *temporary*, with a trigger, rather than as a permanent structure.

**[[ai-surface-security-charter]]** is distinct in a sharper way: its attacker's request
is fully authenticated and fully authorised. No guard this team ships has any effect on
prompt injection.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Requests that legitimately carry no identity — webhooks, published content, CORS, rate limiting, secrets | [[perimeter-ingress-integrity-charter]] |
| Hostile *content* inside an authorised request | [[ai-surface-security-charter]] |
| Writing the guard code into the framework | [[platform-api-charter]] *(Engineering)* — we classify and specify; they author |
| Whether a user *should* have access to a data category at all (consent, lawful basis, retention) | [[compliance-privacy-charter|compliance-charter]] *(Corporate)* |
| Attacking our own verdicts | [[red-team-charter]] *(advisory)* — we hand them the list and ask which verdict is wrong |
| Role/permission *design* (what a "manager" may do) | [[platform-api-charter]] — we enforce the boundary that exists; we do not invent the role model |

## Metrics it moves

**Primary: `sec.unguarded_authenticated_surface`** — non-webhook routes reachable without
a JWT. **Baseline 94 → target 0.** The name is taken verbatim from `intelligence.md:242`
and namespaced.

The 94, by module, counted as ⚠️ rows rather than module headers:

| Module | Routes | Note |
|---|---|---|
| `analytics` | 39 | Fixed on `fix/analytics-endpoint-auth` (`99da5eb`), **unmerged** |
| `notifications` | 24 | |
| `communications` | 9 | Module total is 18; nine carry `@Public()` |
| `contacts` | 8 | `GET/POST/PATCH/DELETE /contacts/:id` — CRUD on people |
| `dashboard` | 8 | |
| `procurement/recurring-orders` | 6 | |

Secondary, and non-negotiable as a pair:

- **`sec.recurrence_guard_present`** — boolean. **`false` today.** Target `true` **before**
  the primary metric moves at all ([[access-control-tenant-isolation-premortem]] M1).
- **`sec.public_decorator_count`** — **12** today. Published beside the primary always;
  the primary can reach 0 by moving routes into this number.
- **`sec.cross_tenant_write_paths`** — routes taking `restaurantId` from the URL and
  writing. **Unmeasured**; `simpos`'s 11 are the known candidates.

**Neural-footprint tie.** An unauthenticated write is an action with no attributable
subject — NF-A's `subject_id` column has nothing to put in it. Every route on the 94 is a
hole in the footprint before it is anything else, which is why this team's metric feeds
`nf_a.*` indirectly rather than owning one.

## Evidence today

**PARTIAL — the mechanism exists and covers 311 routes; the lid does not exist at all.**
The division doc grades this *"EXISTS (the defect), NEW (the team)"*
(`intelligence.md:228`); `partial` is the honest single token for "the control is real,
the coverage is incomplete, and no unit owns it."

**EXISTS — the defect, and its root cause.**
- `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` returns `true` when there is
  no authenticated user, by design, logging a warning. `TenantGuard` runs globally
  (`app.module.ts:124-126`) and therefore protects nothing on its own. **Auth depends
  entirely on each controller remembering `JwtAuthGuard`.**
- 94 non-webhook routes currently do not remember it (`ENDPOINTS.md`, ⚠️ rows).

**EXISTS — the guard, working, on 311 routes.** `auth/guards/jwt-auth.guard.ts` honours
`@Public()`, checks the token blacklist (`:30-42`), and delegates to Passport. The
correct end-to-end pattern is already shipped in `one-tap-actions.controller.ts`:
class-level `@UseGuards(JwtAuthGuard)` at `:64`, identity from `@CurrentUser()`, and
`assertOwnRestaurant` 403-ing when the URL names another tenant (`:80`, `:92`). **That is
the template; it does not need designing.**

**EXISTS — the class has recurred four times, and been fixed four ways.**

| Instance | State | How it was closed |
|---|---|---|
| `/ux/*` | closed | Hand fix, v2.0 — `ux-optimizer.controller.ts:55` |
| `one-tap-actions` | closed | Hand fix — `one-tap-actions.controller.ts:64,80` |
| `ManualOverrideModal` fake `managerId` | closed | Hand fix — `:114-122` |
| `analytics` (39 routes) | **fixed on an unmerged branch** | Hand fix — `99da5eb` |

Four instances, four bespoke remediations, **zero recurrence guards**.
`.planning/v3.0-TECH-DEBT.md:62-75` still lists `one-tap-actions` as open, so the register
is now behind the code — which is its own small warning about tracking this by document.

**NEW — nothing exists.**
- **No endpoint-guard CI check.** The repo enforces four other invariants with exactly
  this mechanism (`scripts/check_no_direct_stock_writes.sh:1-13`,
  `check_no_guest_name_matching.sh`, `check_beverage_identity_parity.py`,
  `check_schema_parity.sh:6-11`, all wired into `.github/workflows/ci.yml`). **The
  mechanism is proven in this repo and has simply never been pointed here.**
- No allowlist file. No per-route verdict record.

**PARTIAL — RLS, with an open question.** 182 `ENABLE ROW LEVEL SECURITY` statements
across 9 migration files. But the gateway connects with `SUPABASE_SERVICE_ROLE_KEY`
(`database/database.service.ts:15`), which bypasses RLS. **Claim to resolve, not a finding
yet:** RLS may be a real control for direct-client access and no control at all on the
path 448 routes actually take. Resolving that is deliverable #4.

**One dead control, worth naming.** `jwt-auth.guard.ts:48-59` computes `userIdIsUuid` and
`restaurantIdIsUuid` and then uses neither — no `if`, no throw, no log. Not exploitable;
it is a "hollow feature that reports success" (`.planning/v3.0-TECH-DEBT.md:127`) living
inside the auth guard. Either finish it or delete it, but it should not sit there looking
like a check.

## Entry conditions and split trigger

**This team starts now**, merged with [[perimeter-ingress-integrity-charter]].

**Split trigger, testable:** `sec.unguarded_authenticated_surface` = 0 **and**
`sec.recurrence_guard_present` = true **and** the ingress baseline
(`sec.unverified_public_ingress`) has a first reading. At that point this charter becomes
steady-state — review new controllers, keep the allowlist honest — and the sibling becomes
its own campaign.
