---
type: scenario
id: S16
slug: staff-misses-a-table-window
class: problem
actors: [assigned-waiter, table, manager, pos, floor-routing]
modules: ["[[service-floor-charter|service-floor]]", "[[pos-bridge-charter|pos-bridge]]"]
signals: [checkin-window-timing, real-engagement-vs-walkpast, kitchen-ready, table-server-join]
insights_class: [missed-window-rate, ready-to-waiter-latency, slow-pickup-sales-impact]
tier: core
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[service-floor-charter]]", "[[pos-bridge-charter]]"]
---

# S16 — Staff misses a table window

## 1. Trigger
A table's check-in window elapses without a **real** check-in, or the order leaves the kitchen
and no waiter is alerted. Bounded: from window-open → window-missed → the individual alert → the
sales/service consequence. This is Floor Checker's core, and it is **unbuilt** — no `floor`
module, service, or route anywhere in `apps/`, `services/`, `supabase/` ([[service-floor-charter|service-floor]]
charter, Evidence).

## 2. Actors
The **assigned waiter** (routed to individually) · the table (guest present, but **never**
resolved to a guest identity — explicit non-goal) · manager (reallocates) · POS (`table → server`
and `kitchen-ready → ticket`) · the service-floor routing contract. Commercial purpose: **more
sales and better service, not compliance monitoring** — that distinction is load-bearing.

## 3. Signals — **both absent today**
- **Check-in window timing** and **real-engagement vs walk-past** discrimination. This is Stage 1,
  and it needs `table_id` + `server_name`, which are **0 of 47 rows** in the only corpus
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`).
- **Kitchen-ready → ticket** ("food is up"). This is Stage 2, and the event is **not merely
  unpopulated — it is unmodelled**: grepping `apps/api-gateway/src/pos-hub/pos-types.ts` for
  `ready`/`fired`/`kitchen` returns one unrelated comment ([[service-floor-charter|service-floor]] Evidence). Adding it
  to `CanonicalCheck` is a [[pos-bridge-charter|pos-bridge]] change this scenario must commission.
- `table → server → device` — the routing join. Transports exist (`push/expo-push.service.ts`,
  `websocket/websocket.gateway.ts`); the routing does not.

## 4. Queries the product must answer
- "Whose table is this?" — single-answer `table → server`.
- "Did the check-in happen, and was it **real** engagement or a walk-past?"
- "Has the window elapsed?" — timing vs the restaurant's window definition.
- "Is the food up, and which one person must know now?"
- "What did this miss cost in sales?" — the commercial read that justifies the alert.

## 5. Outputs (in the moment)
- The **individual waiter alert the moment food is up** — one person, one device, seconds of
  latency, not a general kitchen board ([[service-floor-charter|service-floor]] mandate).
- A missed-window nudge before the plate sits.
- One-tap acknowledge / hand-off. Aspirational until Stage 2's kitchen-ready event exists.

## 6. Insights the owner sees (the payoff)
- **Missed-window rate** by section and shift.
- **Kitchen-ready-to-waiter latency** (`floor.kitchen_ready_to_waiter_p95_seconds`).
- **Slow-pickup sales impact** — plates sitting → quality drop → downrating / lost turns.
- **Satisfiability check:** all three need the `table→server` join **and** a modelled kitchen-ready
  event — neither exists, so the owner sees none today. And by charter this is **not a staff
  performance score** ([[service-floor-charter|service-floor]] non-goals): check-in data is a service signal, and the
  moment it becomes disciplinary evidence the floor produces confident, false compliance data.

## 7. Decisions
Human decides — the waiter acts on the alert, the manager reallocates a section. System
**proposes** (ask→propose→confirm→execute): a reassignment or a nudge. It never disciplines,
never scores a person, never silently records a miss against a name.

## 8. Failure modes
- Mis-route to the wrong waiter → `floor.misroute_rate` must be **0**; a wrong-waiter ping trains
  everyone to ignore the alert.
- Late ping → **no undo**; a food-up alert after the plate went cold is worthless.
- **Walk-past counted as a check-in** → false compliance, the exact failure the "real engagement"
  definition exists to catch.
- Surveillance framing → the system is defeated in a week and the data lies.
- Plate sits silently → guest downrates, turn slows, sales lost with no visible cause.

## 9. Simulation & deploy gate
Synthetic engine generates: missed windows, walk-past vs real check-in, kitchen-ready fired vs
not, ambiguous routing (shared section). SimPOS (`apps/api-gateway/src/simpos/`) emits
`table_id` + `server_name` and a modelled kitchen-ready event. Gate: `misroute_rate` = 0, the
latency budget met, and walk-past correctly **not** counted, all in sim before any floor change
ships. **Simulated before live — locked.**

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**Nothing ships at any tier today — both of this scenario's signals are absent**, and one of
them is absent from the *type system*, not just from the data.

- **Core (operate):** the missed-window nudge before the plate sits, the **individual waiter
  alert the moment food is up** (one person, one device, seconds of latency — not a kitchen
  board), and one-tap acknowledge / hand-off. 🚧 **signal not built** — check-in timing and the
  real-engagement-vs-walk-past discrimination have no capture path, and **kitchen-ready is
  unmodelled**: grepping `pos-hub/pos-types.ts` for `ready`/`fired`/`kitchen` returns one
  unrelated comment. Adding it to `CanonicalCheck` is a pos-bridge change this scenario must
  commission. Also ⛔ **needs POS** — `table → server` is POS-sourced and **0 of 47 rows**.
- **Plus (understand):** missed-window rate by section and shift, and kitchen-ready-to-waiter
  p95 latency. 🚧 + ⛔ — derived wholly from the two absent signals, so there is no partial
  version to ship.
- **Pro (optimize):** staffing and section proposals from observed patterns, and
  **slow-pickup sales impact** (plates sitting → quality drop → downrating and lost turns) —
  the commercial read that justifies the alert in the first place. 🚧 on the floor side and
  ⛔ **needs POS** on the sales side.

**Boundary that outranks the tier cut:** the commercial purpose is **more sales and better
service, not compliance monitoring**, and that distinction is load-bearing. The moment
check-in data becomes disciplinary evidence, the floor produces confident, false compliance
data and every tier above Core is measuring a fiction. No pricing decision relaxes this.

## 11. Evolution feedback
Where windows are missed teaches staffing and section sizing; where routing is ambiguous teaches
the `table→server` join model; whether faster pickup measurably lifts ratings and turn time builds
the sales case that separates this from surveillance.

**Flex points:** window length by service type (fine dining vs high-turn), what counts as **real
engagement**, routing when a section is shared, and whether kitchen-ready comes from the POS or a
manual pass tap.
