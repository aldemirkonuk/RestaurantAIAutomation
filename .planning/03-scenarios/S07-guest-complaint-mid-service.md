---
type: scenario
id: S07
slug: guest-complaint-mid-service
class: problem
actors: [guest, assigned-waiter, manager, pos, floor-routing]
modules: ["[[service-floor-charter|service-floor]]", "[[pos-bridge-charter|pos-bridge]]", "[[design-charter|design]]"]
signals: [complaint-event, table-server-join, service-window-timing]
insights_class: [recovery-rate, complaint-by-section, time-to-recovery]
tier: undecided
sim_harness: simpos
status: proposed
updated: 2026-08-24
links: ["[[SCENARIO-CONTRACT]]", "[[service-floor-charter]]", "[[pos-bridge-charter]]", "[[design-charter]]"]
---

# S07 — Guest complaint mid-service

## 1. Trigger
Mid-service, a guest signals dissatisfaction — flags the waiter, or a table rating drops
below threshold. Bounded: from the complaint signal to a **recovery action on the floor**
and what the owner learns after. This carries Floor Checker's defining constraint: real-time,
person-level routing, **no undo** — a late response is worthless. Nothing backs it yet: there
is no `floor` module, service, or route ([[service-floor-charter|service-floor]] charter, Evidence).

## 2. Actors
Guest · the **specific waiter** assigned to the table (routed to, individually) · manager
(recovery authority) · POS (the `table → server` join) · the service-floor routing contract.
A table is never resolved to a guest identity — that boundary is explicit
([[service-floor-charter|service-floor]] non-goals; [[guest-identity-consent-charter|guest-identity-consent]] owns the who).

## 3. Signals — **not captured today**
- Complaint event (in-app flag, or a live table rating dropping). **No complaint-capture
  surface exists.**
- `table → server → device` joins — the routing substrate. In the only POS corpus,
  `server_name` / `table_id` are **0 of 47 rows**
  (`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:11-14`).
- Timestamp vs service window — derived, but only once the joins exist.
- Transports **do** exist and must be reused, not reinvented:
  `apps/api-gateway/src/push/expo-push.service.ts`,
  `apps/api-gateway/src/websocket/websocket.gateway.ts`. What is missing is the routing that
  turns a complaint into one person's alert — the whole of §5 depends on it.

## 4. Queries the product must answer
- "Whose table is this?" — the `table → server` resolution, single-answer.
- "Is this inside a recoverable window, or already lost?"
- "Does the manager need to be pulled in?" — escalation threshold.
- "Is this a pattern for this table / section tonight?" — repeat-signal read.

## 5. Outputs (in the moment)
- A **direct individual alert to the assigned waiter's device** — one person, not a general
  board everyone glances past ([[service-floor-charter|service-floor]] mandate).
- Escalation to the manager on threshold breach.
- A one-tap recovery prompt (revisit / comp proposal / manager) — the waiter has one thumb free.
All aspirational until the routing contract is built.

## 6. Insights the owner sees (the payoff)
- **Recovery-rate**: share of complaints resolved on the floor before the guest left.
- **Complaint-by-section / by-shift**, and **time-to-recovery**.
- Repeat-complaint patterns (same table, same dish, same section).
- **Satisfiability check:** these need the `table→server` join + a complaint feed, **neither of
  which exists** — so the owner sees none today. And by charter this is a **service signal, not
  a performance score** ([[service-floor-charter|service-floor]] non-goals): the moment it becomes a management stick,
  the floor defeats it and the data goes adversarial.

## 7. Decisions
Human decides the recovery — waiter acts, manager authorizes a comp. System **proposes**
(ask→propose→confirm→execute): revisit, comp, escalate. It **never auto-comps** and never
silently records a service failure against a person.

## 8. Failure modes
- Mis-route to the wrong waiter → the alert gets ignored; `floor.misroute_rate` must be **0**
  during service (it is the mechanism by which staff learn to tune the alert out).
- Late ping — **no undo**; a recovery alert after the guest paid is noise.
- Read as surveillance → phones in aprons, complaints never surfaced → false-clean data.
- Complaint with no `table → server` join → uninterpretable, un-routable.

## 9. Simulation & deploy gate
Synthetic engine generates complaint variants: early vs late window, right vs wrong routing,
threshold escalation, ambiguous ownership. SimPOS (`apps/api-gateway/src/simpos/`) emits
`table_id` + `server_name`. Gate: `misroute_rate` = 0 and the kitchen-ready-to-waiter latency
budget met in sim before any floor change ships. **Simulated before live — locked.**

## 10. Tier cut (proposed — OD-48)
Core: the individual complaint alert + one-tap recovery (operate). Plus: recovery scorecard +
digest (understand). Pro: repeat-pattern detection + staffing/section proposals (optimize).
Price points open.

## 11. Evolution feedback
Where recovery works vs stalls teaches the recovery playbook; where routing is ambiguous
teaches the `table→server` join model; which §6 story the owner opens after a bad night tells
us which one earns the subscription.

**Flex points:** what counts as a complaint (explicit flag vs inferred low rating), recovery
authority (waiter vs manager-only), escalation threshold, window length by service type.
