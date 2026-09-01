---
type: agenda-full
division: platform
department: engineering
team: platform-api
status: provisional
metrics: [platform.endpoints_protected_by_default_pct, platform.unguarded_reachable_routes, platform.public_decorator_count]
updated: 2026-09-01
links: ["[[platform-api-charter]]", "[[platform-api-premortem]]", "[[platform-api-agenda-board]]", "[[platform-api-loops]]", "[[engineering-agenda-full]]", "[[security-charter]]", "[[integration-engineering-charter]]", "[[ENDPOINTS]]"]
---

# Platform & API — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Move protection from *remembered* to *structural*, in an order that makes each step
verifiable. Four deliverables:

1. **A route census in CI.** Enumerate all 448 routes from Nest metadata; classify each as
   guarded / intentionally public / unguarded-and-shouldn't-be; fail on an increase in the
   third. **This ships before the guard**, because an unmeasurable mechanism is
   indistinguishable from one that does not work (premortem M2).
2. **The public-route allowlist file.** One line per public route, a stated reason, a named
   owning team. It is simultaneously the escape-hatch brake (M1) and the enumeration of the
   legitimate ~51 (M3).
3. **The global guard**, with `@Public()` resolvable only against the allowlist.
4. **Tenant scoping as a mechanism** — a scoped query helper and multi-tenant test
   fixtures, so a cross-tenant read fails a test rather than a customer (M4).

## How

**Count before you close.** The 0% figure is a true derivation from
`tenant.guard.ts:38-46`, not a reading. Until a job recomputes it, the team cannot show
improvement or detect regression.

**Two numbers forever.** Routes carrying the guard, and **reachable unguarded routes**. The
first can reach 100% while the second is flat — that is M1 in one sentence, and it is why
the department watches both in [[engineering-loops]] L-ENG-5.

**Consequence sets the order, not count.** The remediable population is ~86 routes (137
minus ~51 legitimately public), as measured 2026-08-24 and not re-derived here — the
corrected census is E0 (`ECOSYSTEM-PLAN.md:80`). The first tranche is not the easiest
tranche: it is money-moving (`procurement/recurring-orders`, 6 — **guarded since
2026-08-25**: class-level `@UseGuards(JwtAuthGuard)` at
`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
OD-20; [[ENDPOINTS]]:464-473 marks all six ✅), message-sending (`notifications` 24,
`communications` 18), and contact-reading (`contacts` 8). Those are **categorically
excluded** from the allowlist — the closed one included, because the exclusion is a
standing rule about what the route does, not a task that a fix retires.

**We build; Security finds.** The seam is explicit (`technology.md:864`).
[[security-charter]] classifies the 137 and ranks them; this team makes the class
impossible. If this team starts doing its own classification, the seam has collapsed and
one unit is grading its own work.

## Why now

- **0% is not a metaphor.** All 448 routes are protected only by a remembered decorator,
  because `TenantGuard` passes unauthenticated requests through by design.
- **Three other teams have this as their premortem's top item.**
  [[procurement-vendor-network-premortem]] M1, [[messaging-delivery-premortem]] M5, and
  [[engineering-premortem]] M2 all resolve to a mechanism only this team can build.
- **Tenancy is cheap now and expensive later.** With few customers, cross-tenant reads are
  a static-analysis problem. With many, they are a disclosure event.
- **The window to design the escape hatch correctly is before the guard ships.** After, the
  hatch is load-bearing and constrained by whatever already uses it.

## Next steps

- [ ] Route census job in CI; publish guarded / public / unguarded counts per PR (M2)
- [ ] Author the public-route allowlist; seed it with the ~51 integration routes, each with
      an owner and a reason — with [[integration-engineering-charter]] (M3)
- [ ] Categorically exclude money-moving, send, and contact-read routes from the allowlist
- [ ] Ship the global guard; `@Public()` resolves only against the allowlist (M1)
- [ ] Publish first real readings for both protection numbers
- [ ] Static check: domain queries filtering by id with no tenant predicate (M4)
- [ ] Multi-tenant test fixtures in the shared test setup (M4)
- [ ] Publish defaults for idempotency key derivation, cache policy, rate-limit tier (M5)
- [ ] Take the cross-hop idempotency seam decision with [[inventory-ledger-charter]] and
      [[integration-engineering-charter]] — one close-time

## Questions for the founder

1. **Can the guard ship in tranches?** Full coverage in one change is the cleanest story
   and the riskiest deploy. Tranche one = money/send/contacts. Acceptable, or all at once?
2. **Who may add a line to the allowlist?** If the requesting team can self-approve, M1 and
   M3 both return. Proposal: the entry requires the owning team **and** this team, and it
   is visible in the PR diff. Confirm.
3. **Is `TenantGuard`'s pass-through changed, or wrapped?** Changing `:38-46` fixes the root
   but breaks everything relying on the current behaviour at once. Wrapping keeps the
   footgun in the codebase. Which risk?
4. **Tenant isolation — mechanism, RLS, or both?** RLS is DDL, so it is co-owned with
   [[schema-migrations-charter]]. Row-level enforcement is stronger and slower to change.
   Preference?
5. **TECH-F2.** Are [[schema-migrations-charter]] and [[messaging-delivery-charter]] separate
   teams, or functions inside this one (`technology.md:844`)? This vault says separate; if
   the answer flips, this team's scope roughly doubles.
