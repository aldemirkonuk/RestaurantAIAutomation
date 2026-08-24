---
type: charter
division: platform
department: engineering
team: procurement-vendor-network
status: exists
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[procurement-vendor-network-premortem]]", "[[procurement-vendor-network-agenda-full]]", "[[procurement-vendor-network-agenda-board]]", "[[procurement-vendor-network-directive]]", "[[procurement-vendor-network-loops]]", "[[procurement-vendor-network-schedule]]", "[[eng-procurement-vendor-network]]", "[[inventory-ledger-charter]]", "[[platform-api-charter]]", "[[integration-engineering-charter]]", "[[ENDPOINTS]]"]
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
| `procurement/recurring-orders` | 6 — **all unguarded** ([[ENDPOINTS]]:428) |
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
| The commercial relationship with a distributor | [[partnerships-charter]] *(Product)* and [[sales-charter]] *(Commercial)* |
| What a good price *is* — margin, unit economics | [[unit-economics-pricing]] *(Commercial)* |
| Drafting vendor emails and negotiation language | [[ai-orchestration-charter]] — they draft, [[messaging-delivery-charter]] delivers |
| Legal terms of a purchase agreement | [[legal-charter]] *(Corporate)* |

## Metrics it moves

**Primary: `procurement.order_to_delivery_reconciliation_rate`** — ordered lines that
resolve to a received lot **at the agreed price, without human repair**
(`technology.md:144-146`).

The "without human repair" clause is the whole metric. A procurement system where every
order eventually reconciles because a person fixes it by hand is not working; it is
generating labour. The metric counts silent successes, not eventual ones.

Secondary: `procurement.unguarded_money_moving_routes` — currently **at least 6**, the
`recurring-orders` cluster ([[ENDPOINTS]]:428). This number is tracked here, not only in
[[platform-api-charter]], because the consequence lands on this team.

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

**The named exposure, stated plainly:** `procurement/recurring-orders` is 6 endpoints,
**all unguarded** ([[ENDPOINTS]]:428), on the one module that places orders
*automatically*. `TenantGuard` passes unauthenticated requests through by design
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`). That combination is this
team's premortem, and it is live today rather than hypothetical.

**What is *not* in evidence:** any reconciliation measurement. The primary metric has no
cited implementation — see [[procurement-vendor-network-agenda-full]].
