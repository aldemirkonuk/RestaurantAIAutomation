---
type: charter
division: product
department: product-vision
team: service-floor
status: new
metrics: [floor.kitchen_ready_to_waiter_p95_seconds, floor.misroute_rate, floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready]
updated: 2026-08-24
links: ["[[service-floor-premortem]]", "[[service-floor-agenda-full]]", "[[service-floor-agenda-board]]", "[[service-floor-directive]]", "[[service-floor-loops]]", "[[service-floor-schedule]]", "[[product-vision-charter]]", "[[pos-bridge-charter]]", "[[inbound-understanding-charter]]", "[[design-charter]]", "[[guest-identity-consent-charter]]", "[[PAGE_MAP]]"]
---

# Service Floor (Floor Checker) — Charter

Parent: [[product-vision-charter]] (Product division). Siblings:
[[inbound-understanding-charter]], [[supply-discovery-charter]],
[[surface-portfolio-charter]], [[ask-ai-charter]].

> **This team is NEW.** Nothing in the repo backs it yet. Stated plainly rather than dressed
> up: there is no `floor` or `floor-checker` module, service, or route anywhere in `apps/`,
> `services/`, or `supabase/`. Three documentation mentions exist and no code
> (`.planning/foundation/teams/product.md:116-119`).

## Mandate

Define **Floor Checker**: confirm that waiters check in on their tables inside the right
time window, confirm the check-in was real engagement rather than a walk-past, and —
added by the founder, and the part that changes the product's shape — **personally notify
the specific waiter the moment their table's order leaves the kitchen.** A direct
individual alert to one person's device, not a general kitchen-ready board that everyone
glances at.

**Its commercial purpose is more sales and better service, not compliance monitoring.**
That distinction is load-bearing and belongs in the charter, not in a later clarification:
a system that a floor staff reads as surveillance gets defeated in a week (phones in
aprons, check-ins tapped from the pass), and a defeated system produces confident, false
compliance data. The product being sold is *the plate arriving hot at the right table
because the right person knew first*.

## Boundaries

Owns outright:

- **The three joins Floor Checker needs and nothing else in the product needs together:**
  `table → server`, `server → device`, `kitchen-ready → ticket`.
- **The check-in definition** — what window counts as timely, and what counts as real
  engagement rather than proximity.
- **The person-routing contract** — which single human gets this alert, on which device,
  within what latency budget, and what happens when routing is ambiguous.
- **The input audit** — per POS provider, whether the required fields and events exist at
  all. This is the team's *first* deliverable and currently its only unblocked one.

**Why this is not part of [[inbound-understanding-charter]].** It is the only named module
with a **real-time constraint and a person-level routing requirement**. Everything in
Inbound Understanding is asynchronous and tolerates minutes. Floor Checker tolerates
seconds, has **no undo** — a late ping is worthless and a wrong-waiter ping is noise — and
needs three data joins the rest of the product does not. Housed under a team whose metric is
extraction quality, its latency budget would be traded away in the first sprint that had to
choose (`teams/product.md:108-114`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| POS adapters, normalizers, `CanonicalCheck` shape | [[pos-bridge-charter]] *(Partnerships)* | We **consume** the canonical shape and state what fields we need; we never write a normalizer |
| Getting a POS vendor to emit a kitchen-ready event | [[partner-alliance-development-charter]] *(Partnerships)* | Nine registry providers need a signature, not engineering |
| Push and websocket infrastructure | [[engineering-charter]] *(Platform)* | `apps/api-gateway/src/push/expo-push.service.ts`, `websocket/websocket.gateway.ts` exist; we specify the routing, not the transport |
| The waiter-facing screen and its motion | [[design-charter]] | We own *who is notified and how fast*; they own what it looks and feels like |
| Guest identity on the check | [[guest-identity-consent-charter]] | We route to staff. A table is not a guest, and we never resolve one to the other |
| Staff performance management | — **nobody, deliberately** | Check-in data is a service signal, not an HR record. See below |

**The explicit non-goal that protects the mandate:** this team does **not** produce staff
performance scores, rankings, or disciplinary evidence. If check-in timing becomes a
management stick, the data becomes adversarial and the product stops working. That is a
design constraint, not a nicety.

## Metrics it moves

**Primary — `floor.kitchen_ready_to_waiter_p95_seconds`**: time from kitchen-ready to the
alert landing on the right waiter's device.

**Paired hard gate — `floor.misroute_rate`**: pinged the wrong server. **Zero is the only
acceptable target during service.** A mis-route is not a small error here; it is the
mechanism by which staff learn to ignore the alert, after which the p95 is irrelevant.

**Entry metrics — the two that actually matter today**, because the primary pair cannot be
read at all:

- `floor.providers_emitting_table_and_server` — **0 verified**
- `floor.providers_emitting_kitchen_ready` — **0 verified**

Neural-footprint tie: minimal. This is not an agent-decision surface, so NF-A rows are
incidental (the routing decision itself). Deliberately claiming an NF tie it does not have
would be padding.

## Evidence today

**NEW.** Named at foundation [[README]]:78 as an L2 module in state *unbuilt*. Grepped
across `apps/`, `services/`, `supabase/`: no `floor`/`floor-checker` module, service, or
route. The only mentions are documentation — foundation [[README]]:65 and
`.planning/decisions/0001-mudavym-single-entity.md:6,22`.

**PARTIAL adjacencies it must build on, not re-invent:**

| Adjacency | Path | Note |
|---|---|---|
| Tables + servers in the canonical shape | `apps/api-gateway/src/pos-hub/pos-types.ts` | `CanonicalCheck` carries `tables`, `employees` capability flags — `pos-provider.registry.ts:17-23` (`CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL`) |
| Push | `apps/api-gateway/src/push/expo-push.service.ts` | Transport exists |
| Realtime | `apps/api-gateway/src/websocket/websocket.gateway.ts` | Transport exists |
| Simulator | `apps/api-gateway/src/simpos/` | 11 routes incl. `/simpos/:restaurantId/tables`; **a development target, not evidence** |

**⚠️ The blocker, measured.** In the only POS corpus that exists, `server_name`, `covers`,
`table_id` and `total` are **0 of 47 rows**
(`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`). Those 47 rows
are `source='generic_webhook'` simulator output from a single 43-minute window. Floor
Checker's entire input is currently null.

**⚠️ A second blocker, verified this session and not previously written down.** There is no
kitchen-ready concept in the canonical model at all: grepping
`apps/api-gateway/src/pos-hub/pos-types.ts` for `ready` / `fired` / `course` / `ticket` /
`kitchen` returns one unrelated comment about mis-fired voids (`:29`). The "food is up"
event is not merely unpopulated — it is **unmodelled**. Adding it to `CanonicalCheck` is a
[[pos-bridge-charter]] change this team must commission, and it is upstream of everything
else here.

## Entry trigger

This team is **gated**. It stands up in two stages, each with an explicit trigger:

1. **Stage 0 — input audit (unblocked, start now).** Per provider in
   `apps/api-gateway/src/pos-hub/pos-provider.registry.ts`, does it emit `table_id` and
   `server_name`, and does it emit any kitchen-ready signal? Deliverable is a table. No
   product code.
2. **Stage 1 — check-in timing.** Trigger: **one non-simulator provider emitting
   `table_id` + `server_name` for a real restaurant.** This slice needs no kitchen-ready
   event and is the honest v0.
3. **Stage 2 — the personal food-up alert.** Trigger: **a kitchen-ready event modelled in
   `CanonicalCheck` and emitted by at least one non-simulator provider.** Until then, the
   notification layer is not built — building it first is
   [[service-floor-premortem]] M1 happening on schedule.
