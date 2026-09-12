---
type: premortem
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-09-01
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-loops]]", "[[procurement-vendor-network-directive]]", "[[engineering-premortem]]", "[[platform-api-premortem]]", "[[red-team-charter]]", "[[security-charter]]"]
---

# Procurement & Vendor Network — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:147-150`): *the `recurring-orders`
controller stays unguarded because it is "internal," `TenantGuard` passes unauthenticated
requests through by design (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`),
and a scripted caller places real orders against a real vendor.*

**Seed status, 2026-09-01: the `recurring-orders` half of that seed is closed.** A
class-level `@UseGuards(JwtAuthGuard)` has covered all six routes since 2026-08-25
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
OD-20); [[ENDPOINTS]]:464-473 marks all six ✅. The seed is kept verbatim because M1 below
is the record of what was true at founding. What the seed says about `TenantGuard` is
still true, and so is the default that produced the exposure — see M1's closure note.

This is the only premortem in the department whose worst case involves money leaving the
company, so it is written with that weight.

## It is 2027-08. This team has failed. What happened?

### M1 — Six unguarded routes placed real orders — **CLOSED 2026-08-25**

> **Closure.** The exposure this scenario forecast is gone. `procurement/recurring-orders`
> is 6 endpoints, **all guarded** since 2026-08-25 by a class-level
> `@UseGuards(JwtAuthGuard)`
> (`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, commit `fdaa7fa0`,
> landed under OD-20); no `@Public()` appears in the file, and [[ENDPOINTS]]:464-473 marks
> all six ✅. The scenario is kept, not deleted: its counter-pressure (2) is still
> unbuilt, and the *mechanism* it names survives the fix — guarding is opt-in per
> controller, so the next money-moving route added without the decorator reproduces M1
> exactly. Read what follows as the founding forecast, in past tense.

At founding, `procurement/recurring-orders` was 6 endpoints, **all unguarded**. The
justification was that it is internal — called by `recurring_order_agent.py`, not by a
browser. `TenantGuard` returns `true` with no authenticated user by design
(`tenant.guard.ts:38-46`), so "internal" was never enforced by anything; it was a
convention. Someone — a scanner, a misconfigured integration, a curious contractor —
posts to the endpoint. Orders go to a real vendor. The first person to notice is the
vendor.

**Earliest observable signal.** A recurring-order creation whose request carries no
authenticated principal and no known internal caller signature. On this cluster the guard
now rejects such a request before it lands, so the signal has moved: what is still
unlogged — and still worth logging — is the same request arriving at a money-moving route
that nobody has guarded yet. The absence of that log remains the earliest signal that
nobody is watching.

**Counter-pressure.** Two independent moves, because either alone fails. (1) Log and
alert on unauthenticated writes to money-moving routes now, without waiting for
[[platform-api-charter]]'s global mechanism — a log is cheap and does not require an
architecture. (2) Money-moving routes are the **first** population moved behind the global
guard, and they are explicitly excluded from the `@Public()` allowlist that
[[engineering-premortem]] M2 warns will otherwise absorb everything. "Internal" is not a
security property; a verified caller identity is.

---

### M2 — The reconciliation rate measured eventual success, not silent success

The metric is "ordered lines that resolve to a received lot at the agreed price
**without human repair**". The easy implementation drops the last clause, because human
repairs are hard to detect: someone edits a received quantity, adjusts a price, closes a
line manually. Measured loosely, the rate reads 96% while a person spends two hours a week
fixing procurement. The team optimises a number that says the system works.

**Earliest observable signal.** The metric's *definition* being written without a
`manual_intervention` field on the reconciliation record. Catch it in the spec, not in the
data — once the field is missing, the history is unrecoverable.

**Counter-pressure.** Reconciliation records carry an explicit repaired-by-human flag, set
by the edit path rather than inferred. Publish **two** numbers: raw reconciliation rate and
no-touch reconciliation rate. The team's metric is the second. The gap between them is the
labour the system is generating, which is the thing worth watching.

---

### M3 — Price observations drifted from the agreed price

`supabase/migrations/20260805154027_vendor_price_observations.sql` records observed vendor
prices; `…20260811010000_vendor_catalogue_match.sql` matches catalogue lines. Reconciliation
compares received price to *agreed* price. If the agreed price is re-derived from the
current catalogue rather than snapshotted at order time, every price change silently
becomes agreement: the vendor raises a price, the catalogue updates, reconciliation
compares new-to-new and passes. The system loses the ability to detect being overcharged,
which is the main financial risk it exists to catch.

**Earliest observable signal.** A reconciliation that passes on a line whose price changed
between order and delivery. Detect it by asserting the invariant directly — every order
line must store its own price at creation and reconciliation must read *that* field, never
a join to the live catalogue.

**Counter-pressure.** Price-at-order is snapshotted onto the order line, immutably. A
reconciliation query that joins to `vendor_catalogue` for price is rejected in review by
[[procurement-vendor-network-directive]]. Price *observations* are evidence about the
world; the order line is the contract.

---

### M4 — RFQ and negotiation logic quietly gained authority to commit

`rfq_agent.py` and `procurement_agent.py` are agents. The boundary between "draft an RFQ",
"recommend accepting a quote", and "place the order" is a code path, not a wall. It erodes
in the obvious direction: an approval step gets a sensible default, the default gets a
timeout, the timeout gets auto-accept for small amounts, and a threshold that started as
€50 is €5,000 eighteen months later. Note the repo already has a `negotiation_playbook`
agent declared as a **stub** whose `process_message()` only logs
(`technology.md:41-42`) — the shape exists and is currently inert.

**Earliest observable signal.** The first auto-accept path of any kind, at any threshold.
Also: any change that raises an existing threshold, which is a different and more
dangerous event than creating one.

**Counter-pressure.** Committing spend is a **human-gated action** and belongs to
[[action-safety-the-human-gate-charter|action-safety-the-human-gate]] (Applied AI), not to this team's own judgement. This team
builds the order mechanics; the gate on committing is owned by a unit that does not
benefit from procurement throughput. Thresholds, if any exist, are recorded in
`OPEN-DECISIONS.md` with their value — never in code alone.

---

### M5 — The vendor portal became an unowned second front door

`vendor-portal` is 2 routes and **unguarded**
(`supabase/migrations/20260805155901_vendor_portal.sql`, [[ENDPOINTS]] cluster). It is the
only outward-facing surface in the product — external companies, not our restaurants. It
is small, so it gets no attention; it is external, so it carries the most risk per line of
code. A year later it has grown features because vendors asked, and it is still the
smallest, least-reviewed module with the widest audience.

**Earliest observable signal.** Route count on `vendor-portal` increasing without a
corresponding entry in this team's agenda. Growth without a plan is the tell.

**Counter-pressure.** The portal is treated as a **third-party-facing integration
surface**, sharing [[integration-engineering-charter]]'s correctness criterion —
signature or token verification, not `TenantGuard` — even though the routes live here.
Every portal route change is reviewed against that criterion. If the portal grows past a
handful of routes, its ownership is re-opened as a seam decision rather than absorbed
silently.

---

## What [[red-team-charter]] should attack first

Not M1 — it is closed
(`apps/api-gateway/src/procurement/recurring-orders.controller.ts:35`, 2026-08-25,
[[ENDPOINTS]]:464-473). The six endpoints on the module that places automated orders are
guarded, so the standing invitation to attack them first is withdrawn; what is worth
attacking in its place is the **default**, not the cluster — find the next money-moving
route that carries no explicit guard decision, since guarding is opt-in per controller.
[[security-charter]]'s classification of the 137 unguarded routes should still rank on
consequence rather than on count.
