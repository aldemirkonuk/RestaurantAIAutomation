---
type: scenario
id: S05
slug: service-runs-floor-is-checked
class: happy-path
actors: [server, table-guests, kitchen-expo, floor-router, pos]
modules: ["[[service-floor-charter|service-floor]]", "[[pos-bridge-charter|pos-bridge]]"]
signals: [table-server-join, check-in-tap, engagement, kitchen-ready, device-route, nf_a]
insights_class: [check-in-coverage, food-up-latency, misroute-rate]
tier: core
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[service-floor-charter]]", "[[pos-bridge-charter]]", "[[SCENARIO-MAP]]"]
---

# S05 — Service runs; the floor is checked

> **Largely NEW.** The owning team is unbuilt: there is no `floor`/`floor-checker` module,
> service, or route anywhere in `apps/`, `services/`, or `supabase/`
> (`service-floor-charter.md:18-21,97-100`). This scenario is written as the target
> ritual, and every section grades honestly against what the repo backs today — which,
> for the signals that matter, is nothing.

## 1. Trigger
Service is on. A party is seated; a waiter owns that table; the kitchen fires and finishes
their order. Bounded: from seating to the moment the assigned waiter is *personally* told
their food is up — and, in parallel, the check that the waiter touched the table inside its
timing window. Two clocks, one table.

## 2. Actors
Server (owns the table, phone in an apron) · table guests (external, no account, never
resolved to an identity — `service-floor-charter.md:68`) · kitchen/expo (fires the "food is
up") · the floor router (decides *which one human* is pinged, on which device) · POS
(source of `table → server` and, if it ever emits it, `kitchen-ready`).

## 3. Signals
- **`table → server` join** — which waiter owns which table right now. Lives in the
  canonical shape as capability flags (`CanonicalCheck.tables`/`.employees`,
  `pos-provider.registry.ts:17-23` — `CAP_FULL`/`CAP_NO_TABLES`/`CAP_PULL`). **Measured
  reality: `server_name`, `covers`, `table_id`, `total` are 0 of 47 rows**
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`) — simulator
  output from one 43-minute window. The input is currently null.
- **Check-in tap + timing** — a real touch on the table, inside the window vs a walk-past.
  The *definition* of "timely" and "real engagement" is the team's to own; no capture exists.
- **Kitchen-ready event** — the "food is up" signal. **Not merely unpopulated — unmodelled:**
  grepping `pos-types.ts` for `ready`/`fired`/`course`/`ticket`/`kitchen` returns one
  unrelated void comment (`service-floor-charter.md:117-123`). Adding it to `CanonicalCheck`
  is a [[pos-bridge-charter|pos-bridge]] change this scenario must commission; it is upstream of everything else.
- **Device route** — `server → device`, so a ping reaches one person. Transport exists
  (`push/expo-push.service.ts`, `websocket/websocket.gateway.ts`); the routing contract does not.
- **NF-A** — floor routing is *not* an agent-decision surface, so NF-A rows are incidental
  at best (`service-floor-charter.md:91-93`). And the org-wide gap still holds: **NF-A emits
  nothing in the gateway today**, so even the incidental row would be invisible.

## 4. Queries the product must answer
- "Who owns table 12 this minute?" (the `table → server` resolution)
- "Did that waiter actually check in on their table, inside the window?"
- "Table 12's food just left the pass — whose phone do I ring, and how many seconds do I have?"
- "When routing is ambiguous (section handoff, split table), who gets it?"

## 5. Outputs (in the moment)
- A **direct, individual** alert to the one assigned waiter's device — *not* a shared
  kitchen-ready board everyone glances at (`service-floor-charter.md:26-30,136-138`).
- A quiet nudge if a table's check-in window is about to lapse — nudge, never a scorecard.

## 6. Insights the owner sees (the payoff)
Gated, and honestly so — none is readable until §3's signals arrive:
- **Food-up → waiter latency** (`floor.kitchen_ready_to_waiter_p95_seconds`), the primary
  metric; **0 providers emitting kitchen-ready today** (`service-floor-charter.md:88-89`).
- **Check-in coverage** — share of tables touched inside window. Needs `table_id` +
  `server_name`, **0 verified providers**.
- **Misroute count** (`floor.misroute_rate`) — pinged the wrong server; **zero is the only
  acceptable target during service** (`service-floor-charter.md:81-83`).
- Explicitly **not** a staff ranking or disciplinary record — that framing defeats the
  system in a week (`service-floor-charter.md:69-74`).

## 7. Decisions
Human: the waiter decides how to work the table; the manager decides the check-in window
and the engagement definition. System **proposes only** (ask→propose→confirm→execute): it
*routes* a ping and *flags* a lapsing window. It never auto-assigns tables, never disciplines,
never resolves an ambiguous route silently — an ambiguous route surfaces to a human.

## 8. Failure modes
- Wrong-waiter ping → staff learn to ignore the alert → the p95 becomes meaningless
  (`service-floor-charter.md:81-83`). This is the failure that matters most; there is no undo.
- Check-ins tapped from the pass → confident, false compliance data (`:34-37`).
- Kitchen-ready never modelled → Stage 2 built on a signal that does not exist → premortem
  M1 on schedule (`service-floor-charter.md:136-139`).
- `table → server` null (today's state) → the whole scenario is invisible; §5 fires nothing.

## 9. Simulation & deploy gate
Harness: **SimPOS** — `/simpos/:restaurantId/tables` already exists as a development target
(`service-floor-charter.md:109`). Synthetic engine generates: clean check-in-in-window ·
late check-in · walk-past-not-engagement · food-up-then-routed · ambiguous-route (split
table). Gate: no floor-router change ships until the five variants route to the correct
single device with **zero misroutes** in the recorded run. Per the locked rule, `simulated`
precedes `live` with no exception — and here there is no `live` path at all until a
non-simulator provider emits the fields.

## 10. Tier cut (OD-48 locked — Core/Plus/Pro; prices open, OD-23)

**Nothing in this scenario ships at any tier today, and the reason is structural, not a
backlog item.** The owning module does not exist (no `floor` service or route anywhere in
`apps/`, `services/`, `supabase/`), `table → server` is **0 of 47 rows** in the only corpus,
and `kitchen-ready` is **unmodelled** in `CanonicalCheck` — not unpopulated, absent from the
type. Transports (`expo-push`, `websocket.gateway`) exist; the routing contract does not.

- **Core (operate):** the **personal food-up ping** to the one assigned waiter's device, and
  the quiet check-in-window nudge. This is the founder's headline feature and it belongs in
  Core. 🚧 **signal not built** (kitchen-ready unmodelled; no check-in capture) + ⛔ **needs
  POS** (the `table → server` join is POS-sourced, and 0 providers verified today).
- **Plus (understand):** the weekly check-in-coverage scorecard (share of tables touched
  inside window) and food-up → waiter p95 latency. 🚧 + ⛔ — **0 providers emit kitchen-ready**,
  0 verified providers supply `table_id` + `server_name`.
- **Pro (optimize):** cross-shift routing intelligence — which sections and handoffs generate
  misroutes, and staffing the floor against measured latency. 🚧 + ⛔, and it needs the
  **fullest signal set of any scenario in the library**: it is downstream of a POS change
  (adding kitchen-ready to `CanonicalCheck`), a new routing contract, and a shipped floor
  module. This is the furthest-from-buildable Pro in the catalogue.

**Boundary, not a satisfiability note:** none of these tiers may be sold or built as a staff
ranking or disciplinary record. That framing defeats the system in a week and the data goes
adversarial — a Pro tier marketed as floor-performance analytics destroys its own input.

## 11. Evolution feedback
Where routes go ambiguous teaches the routing contract its real edge cases (splits,
handoffs, sections). Whether staff keep the alert on — or defeat it — is the single truest
signal of whether this was built as *service* or as *surveillance*; the product only works
on the first reading.

**Flex points:** the check-in window (5 vs 10 min; per section vs per cover), what counts as
real engagement, who owns a split table, and whether a house even runs an expo/kitchen-ready
step at all (many do not — then Stage 2 simply does not apply).
