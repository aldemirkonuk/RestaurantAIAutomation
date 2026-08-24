---
type: premortem
division: platform
department: engineering
team: procurement-vendor-network
status: provisional
metrics: [procurement.order_to_delivery_reconciliation_rate, procurement.unguarded_money_moving_routes]
updated: 2026-08-24
links: ["[[procurement-vendor-network-charter]]", "[[procurement-vendor-network-loops]]", "[[procurement-vendor-network-directive]]", "[[engineering-premortem]]", "[[platform-api-premortem]]", "[[red-team-charter]]", "[[security-charter]]"]
---

# Procurement & Vendor Network — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:147-150`): *the `recurring-orders`
controller stays unguarded because it is "internal," `TenantGuard` passes unauthenticated
requests through by design (`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`),
and a scripted caller places real orders against a real vendor.*

This is the only premortem in the department whose worst case involves money leaving the
company, so it is written with that weight.

## It is 2027-08. This team has failed. What happened?

### M1 — Six unguarded routes placed real orders

`procurement/recurring-orders` is 6 endpoints, **all unguarded** ([[ENDPOINTS]]:428). The
justification was that it is internal — called by `recurring_order_agent.py`, not by a
browser. `TenantGuard` returns `true` with no authenticated user by design
(`tenant.guard.ts:38-46`), so "internal" was never enforced by anything; it was a
convention. Someone — a scanner, a misconfigured integration, a curious contractor —
posts to the endpoint. Orders go to a real vendor. The first person to notice is the
vendor.

**Earliest observable signal.** A recurring-order creation whose request carries no
authenticated principal and no known internal caller signature. This is loggable
**today**, before any guard exists — and the absence of that log is itself the earliest
signal that nobody is watching.

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
[[action-safety-the-human-gate]] (Applied AI), not to this team's own judgement. This team
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

M1, today, without waiting for the charter to be adopted. Six unguarded endpoints on the
module that places automated orders is not a forecast — it is the current state of the
repo, and [[security-charter]]'s classification of the 137 unguarded routes should rank it
first on consequence rather than on count.
