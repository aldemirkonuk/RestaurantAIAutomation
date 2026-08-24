---
type: agenda-full
division: intelligence
department: security
team: access-control-tenant-isolation
status: provisional
metrics: [sec.unguarded_authenticated_surface, sec.recurrence_guard_present, sec.public_decorator_count, sec.cross_tenant_write_paths, sec.verdicts_reversed]
updated: 2026-08-24
links: ["[[access-control-tenant-isolation-charter]]", "[[access-control-tenant-isolation-premortem]]", "[[access-control-tenant-isolation-agenda-board]]", "[[access-control-tenant-isolation-directive]]", "[[access-control-tenant-isolation-loops]]", "[[access-control-tenant-isolation-schedule]]", "[[security-charter]]", "[[perimeter-ingress-integrity-charter]]", "[[platform-api-charter]]", "[[ENDPOINTS]]", "[[OPEN-DECISIONS]]"]
---

# Access Control & Tenant Isolation — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The numbers are readings
> taken on 2026-08-24; none of the steps below has been started.

## What

Close OD-19 in a way that cannot reopen. Three deliverables in a deliberately unusual
order:

1. **The lid** — a CI assertion plus an allowlist file, shipped **red**, listing all 94
   unguarded-by-omission routes and all 43 intentionally-public ones as two separate lists.
2. **The verdicts** — 94 routes, each with a written classification and a named consumer.
3. **The burn-down** — remediation expressed as deletions from the allowlist.

## How

**Why the lid ships first.** This is the one genuinely contestable choice in this agenda,
so the argument is written out rather than assumed. Shipping the check first, red, has
three effects that shipping it last does not:

- Remediation becomes a **reviewed diff to one file** instead of a decorator inside a
  large PR. The count cannot fall outside the mechanism.
- The count cannot **rise** during the campaign. Over a multi-week sweep, new controllers
  will ship; without the lid they land on the wrong side of a moving denominator.
- The mechanism gets built while it is still obviously necessary. After the count reaches
  zero, nobody funds a guard for a solved problem, and
  [[access-control-tenant-isolation-premortem]] M1 is exactly that story.

The cost is a red CI check for the duration, which is honest rather than embarrassing: it
is red because the system is exposed, and it turns green when the system is not.

**The verdict template.** Every route gets all five fields. Missing any one is not a
verdict.

| Field | Values | Note |
|---|---|---|
| `verdict` | `guard` · `public-with-signature` · `public-content` · `delete` | Per route, never per module |
| `consumer` | named client / job / integration | **`unknown` is an escalation, not a verdict** ([[access-control-tenant-isolation-premortem]] M4) |
| `tenant_source` | `token` · `url` · `n/a` | `url` on a guarded route is **not complete** (M3) |
| `writes` | yes / no | Drives severity ordering |
| `evidence` | `path:line` | The consumer claim must be checkable |

**Two verdicts require handoff, not action by us.** `public-with-signature` hands to
[[perimeter-ingress-integrity-charter]] (the same team today, a real handoff after the
split). `delete` hands to the founder via [[security-directive]] — removing a shipped
route is not ours to decide alone.

**Controls are copied.** `one-tap-actions.controller.ts:64,80,92` is the complete
reference implementation: class-level guard, identity from `@CurrentUser()`, and a 403
when the URL names another tenant. The CI script copies
`scripts/check_no_direct_stock_writes.sh:1-13`'s shape. Nothing here needs inventing.

## Why now

The class has recurred four times, each fix was correct, and none prevented the next.
That is the definition of a systemic defect, and the window to install the mechanism is
**before** the 94 are drained, not after — see the third bullet under "How".

There is also a live severity: `analytics`'s 39 routes are fixed on
`fix/analytics-endpoint-auth` (`99da5eb`) and **that branch is not merged to `main`**. The
highest-value action available to this team today costs one merge and does not require the
team to exist.

## Next steps

Ordered. Nothing started.

1. **Merge `fix/analytics-endpoint-auth`.** Closes OD-20 and takes the primary metric
   94 → 55 in one commit. Recommend standalone rather than folded into the sweep.
2. **`sec.cross_tenant_write_paths` — first reading, before any remediation.** Grep for
   handlers reading `@Param("restaurantId")` and writing. This baseline must exist before
   guards start landing or M3 becomes unobservable.
3. **Write `scripts/check_endpoint_guards.sh` red**, plus
   `.security/endpoint-allowlist.txt` (two sections: `unguarded-known` 94,
   `intentionally-public` 43). Wire into `.github/workflows/ci.yml` beside the four
   existing grep guards.
4. **Classify `procurement/recurring-orders` (6) first.** Smallest module, and it writes —
   a full pass through the template on a real module before committing to it for 94.
5. **Classify `contacts` (8).** CRUD on people; highest data-sensitivity per route in the
   backlog and the one most likely to interest [[compliance-charter]].
6. **Classify `dashboard` (8), `communications` (9), `notifications` (24).**
7. **Resolve `simpos` (11) jointly with the sibling charter.** Classified today as a
   webhook module; it is an unguarded simulator control surface whose `close` route has
   our own server sign a stock movement for an anonymous caller
   (`simpos.service.ts:489-520`). It sits on the charter boundary, which is why the two
   charters share a team.
8. **Resolve the RLS question.** Does `SUPABASE_SERVICE_ROLE_KEY`
   (`database.service.ts:15`) bypass the 182 RLS policies on the gateway path? If yes, RLS
   is not a control for these 448 routes and the charter should stop implying it is.
9. **Finish or delete `jwt-auth.guard.ts:48-59`.** The UUID check that computes two
   booleans and uses neither.

## Questions for the founder

1. **Merge OD-20 standalone today?** Recommendation: yes.
2. **`GET /analytics/health` and `GET /dashboard/health` are now behind a JWT** (class-level
   guard). If an external uptime monitor calls them, that is a break we caused. Which
   monitor, if any?
3. **`DELETE /contacts/:id` is currently unauthenticated.** Before we classify it: is
   `contacts` reachable from the public internet in the deployed topology, or only via an
   internal network? The answer changes severity by an order of magnitude and we should not
   guess it.
4. **What is the deployed instance count?** It sets whether the `ai: 20/60s` in-memory rate
   limit was ever a meaningful brake on the analytics hole, which changes how we describe
   the incident.
