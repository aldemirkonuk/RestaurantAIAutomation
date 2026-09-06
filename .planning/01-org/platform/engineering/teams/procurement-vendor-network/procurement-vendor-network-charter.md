---
type: charter
division: platform
department: engineering
team: procurement-vendor-network
status: exists
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-09-01
links: ["[[engineering-charter]]", "[[procurement-vendor-network-premortem]]", "[[procurement-vendor-network-agenda-full]]", "[[procurement-vendor-network-agenda-board]]", "[[procurement-vendor-network-directive]]", "[[procurement-vendor-network-loops]]", "[[procurement-vendor-network-schedule]]", "[[procurement-vendor-network-charter|eng-procurement-vendor-network]]", "[[inventory-ledger-charter]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[ENDPOINTS]]"]
---

# Procurement & Vendor Network — Charter

Division **Platform** → Department [[engineering-charter]] → Team
`procurement-vendor-network` (§2.3 of
`.planning/foundation/teams/technology.md:129-150`).

## Mandate

Own the money path outward: **orders, RFQs, receiving, credits, recurring orders, vendor
catalogues, price observations, and the distributor graph.** This team decides what gets
bought, from whom, at what price, and whether what arrived matches what was agreed.

## Boundaries

Owns outright — the largest single endpoint cluster in the gateway, **≈97 routes**:

| Module | Routes |
|---|---|
| `apps/api-gateway/src/procurement/procurement` | 26 |
| `procurement/documents` | 6 |
| `procurement/documents/credits` | 3 |
| `procurement/receiving` | 3 |
| `procurement/recurring-orders` | 6 — **all guarded** since 2026-08-25 ([[ENDPOINTS]]:464-473) |
| `providers/providers` | 29 |
| `providers/provider-intelligence` | 17 |
| `vendor-catalogue` | 4 |
| `vendor-intel` | 4 |
| `vendor-portal` | 2 |
| `distributor-discovery` | 3 |

Plus the procurement agents: `services/agent-orchestrator/agents/procurement_agent.py`,
`rfq_agent.py`, `recurring_order_agent.py`.

## Distinct from siblings because

It is **the only Engineering team whose defects move money to third parties**
(`.planning/foundation/teams/technology.md:134-136`). Every other team's worst case is a
wrong number, a missing message, or a broken screen — recoverable inside the system. This
team's worst case leaves the system: a real order, against a real vendor, for real money.
It also owns the **only outward-facing portal**, which means it has a second class of
user the rest of Engineering does not have.

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| Stock arithmetic once a lot exists | [[inventory-ledger-charter]] — we own the order, they own the lot it becomes |
| The auth mechanism that should protect these routes | [[platform-api-charter]] — we are the loudest *consumer* of that mechanism, not its builder |
| Vendor webhook wire protocol and signature verification | [[integration-engineering-charter]] |
| The commercial relationship with a distributor | [[partnerships-integrations-charter|partnerships-charter]] *(Product)* and [[sales-charter]] *(Commercial)* |
| What a good price *is* — margin, unit economics | [[unit-economics-pricing-charter|unit-economics-pricing]] *(Commercial)* |
| Drafting vendor emails and negotiation language | [[ai-orchestration-charter]] — they draft, [[messaging-delivery-charter]] delivers |
| Legal terms of a purchase agreement | [[legal-charter]] *(Corporate)* |

## Metrics it moves

**Primary: `procurement.order_to_delivery_reconciliation_rate`** — ordered lines that
resolve to a received lot **at the agreed price, without human repair**
(`technology.md:144-146`).

The "without human repair" clause is the whole metric. A procurement system where every
order eventually reconciles because a person fixes it by hand is not working; it is
generating labour. The metric counts silent successes, not eventual ones.

Secondary: `procurement.unguarded_money_moving_routes` — **0 across the `recurring-orders`
cluster**, which is the only sub-module this charter ever counted into it. The six routes
were closed on 2026-08-25 by a class-level guard
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`), landed under OD-20 (`OPEN-DECISIONS.md:121`);
[[ENDPOINTS]]:464-473 marks all six ✅. The **team-wide** value is no longer withheld: the
E0 auth census merged 2026-09-01 (`ECOSYSTEM-PLAN.md:83`, method at
[[ECOSYSTEM-E0-MEASUREMENTS]] §2) and measured **468 route handlers, 444 authenticated, 23
deliberately public with evidence, 0 unauthenticated by omission, 1 unclear** — repo-wide,
so this team's other ~91 routes contribute **zero**. Take that number from the census; do
not re-derive it in passing — re-derivation is how the competing repo-wide counts this
charter inherited were produced in the first place. **And read the zero with its second
half: the defect count is zero while the defect generator is fully intact.**

The metric outlives the fix because what it measures is a **default, not a backlog**. There
is no global `JwtAuthGuard`: the only `APP_GUARD`s are `RateLimitGuard` and `TenantGuard`
(`apps/api-gateway/src/app.module.ts:130-137`), so authentication is opt-in per controller
and the *next* money-moving route this team adds — endpoint 469 — is unguarded until
someone remembers the decorator. That is the generator, and the census did not touch it. Read it as a regression counter on money-moving routes carrying no explicit
guard decision, and expect it to sit at 0 rather than to trend downward. This number is
tracked here, not only in [[platform-api-charter]], because the consequence lands on this
team.

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:138-142`).

**Gateway modules** — the ≈97-route table above, transcribed from [[ENDPOINTS]].

**Migrations**
- `supabase/migrations/20260805154027_vendor_price_observations.sql`
- `supabase/migrations/20260805155901_vendor_portal.sql`
- `supabase/migrations/20260811010000_vendor_catalogue_match.sql`
- `supabase/migrations/20260807001452_search_distributors_rpc.sql`

**Agents**
- `services/agent-orchestrator/agents/procurement_agent.py`
- `services/agent-orchestrator/agents/rfq_agent.py`
- `services/agent-orchestrator/agents/recurring_order_agent.py`

**The named exposure, closed — and the default that produced it, still open:**
`procurement/recurring-orders` is 6 endpoints on the one module that places orders
*automatically*, and until 2026-08-25 every one of them was reachable unauthenticated.
A class-level `@UseGuards(JwtAuthGuard)` now covers all six
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
OD-20 (`OPEN-DECISIONS.md:121`)). Checked route by route: no `@Public()` anywhere in the
file, no per-route `@UseGuards` displacing the class one, and the class is declared and
registered exactly once (`procurement.module.ts:34`). The guard authenticates and then
asserts tenant match in the same pass
(`apps/api-gateway/src/auth/guards/jwt-auth.guard.ts:60`), so isolation applies here too.
`TenantGuard` does still pass unauthenticated requests through by design
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:47-52`), but it is now a backstop
behind that guard rather than the only thing in the path.

So this team's premortem is **no longer live on this cluster**. What remains live is the
mechanism that made it possible: guarding is per-controller and opt-in, so the exposure
returns silently the next time a money-moving controller is added without the decorator.
The fix was one line; the default that cost us six routes is unchanged.

**What is *not* in evidence:** any reconciliation measurement. The primary metric has no
cited implementation — see [[procurement-vendor-network-agenda-full]].
