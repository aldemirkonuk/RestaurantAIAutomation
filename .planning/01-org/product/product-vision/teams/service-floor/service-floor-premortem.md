---
type: premortem
division: product
department: product-vision
team: service-floor
status: provisional
metrics: [floor.misroute_rate, floor.kitchen_ready_to_waiter_p95_seconds, floor.providers_emitting_kitchen_ready]
updated: 2026-08-24
links: ["[[service-floor-charter]]", "[[service-floor-loops]]", "[[service-floor-directive]]", "[[product-vision-premortem]]", "[[pos-bridge-charter]]", "[[partner-alliance-development-charter]]", "[[design-charter]]", "[[red-team-charter]]"]
---

# Service Floor (Floor Checker) — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

### M1 — It was built against `simpos` fixtures and died on contact with a real kitchen

The team's own named premortem (`teams/product.md:136-138`), and the most likely outcome by
a distance. The simulator is good (`apps/api-gateway/src/simpos/`, 11 routes including
`/simpos/:restaurantId/tables`), push works
(`apps/api-gateway/src/push/expo-push.service.ts`), websockets work
(`apps/api-gateway/src/websocket/websocket.gateway.ts`). So the notification layer gets
built first — it is the satisfying part, it demos beautifully, and it is unblocked. Only
afterwards does anyone check whether a shipped POS emits a "food is up" event. It does not:
there is no kitchen-ready concept in `apps/api-gateway/src/pos-hub/pos-types.ts` at all.
The module is complete, demoable, and cannot run anywhere real.

**Earliest observable signal.** Any Floor Checker artifact that is not the input audit.
Concretely: the first commit touching push/websocket routing while
`floor.providers_emitting_kitchen_ready` is still **0**.

**Counter-pressure.** The charter's entry gate is **an input audit, not a build**, and it is
staged: Stage 0 produces a table (provider → fields emitted); Stage 1 is check-in timing,
which needs only `table_id` + `server_name`; Stage 2 — the personal alert — cannot start
until a kitchen-ready event is *modelled in `CanonicalCheck` and emitted by a non-simulator
provider*. [[service-floor-directive]]'s null-input rule makes `simpos` a development
target and never evidence. If the input audit comes back empty for every `available`
provider, the honest product is Stage 1 alone, and that is a smaller thing that can be true.

---

### M2 — Staff read it as surveillance and defeated it in a week

The founder's framing is explicit: the commercial purpose is **more sales and better
service, not compliance monitoring**. But a system that records *did the waiter check in
within N minutes* is one dashboard away from being a performance report, and the first
manager who asks for that dashboard has an entirely reasonable request. Once check-in data
is management evidence, staff optimize the measurement: tap check-ins from the pass, leave
the phone in an apron on a station, check in for each other. The system then produces
**confident, false compliance data**, which is worse than none — the restaurant now
believes tables are being covered.

**Earliest observable signal.** Check-in compliance approaching 100% while table-level
outcomes (course timing, add-on sales) do not change. Also, and earlier: the **first**
request for a per-staff ranking or export.

**Counter-pressure.** Three, and they are design decisions made now rather than policy made
later. **(a)** The charter names a deliberate non-goal — no staff performance scores,
rankings, or disciplinary exports — and that is a founder-level decision to reverse
([[service-floor-directive]]). **(b)** "Real engagement" is defined by a **signal the staff
member benefits from producing**, not one that only indicts them: an alert acknowledged
because it was useful, not a proximity beacon. **(c)** Aggregate before it leaves the team:
service-level views by shift or section, not by name, unless the founder explicitly
reverses.

---

### M3 — Mis-routes taught everyone to ignore the alert

`floor.misroute_rate` has a target of zero for a reason. This module has **no undo**: a late
ping is worthless and a wrong-waiter ping is noise. Staff calibrate fast. Three wrong pings
in one service and the alert is background — after which the p95 latency number, however
good, measures nothing. The routing joins are exactly where this breaks: `table → server`
changes mid-service (sections get covered, breaks happen, a section is split), and
`server → device` is stale the moment someone borrows a tablet or a shift changes.

**Earliest observable signal.** Any mis-route at all, in any environment including staging —
and separately, the alert acknowledgment rate falling over a single service. Acknowledgment
decay within one shift is the tell that trust broke.

**Counter-pressure.** **Ambiguous routing does not guess.** When `table → server` cannot be
resolved with confidence — after a section change, a split, an unmapped table — the system
falls back to the *section* or the expo screen and says so, rather than picking the most
likely waiter. A degraded honest alert keeps trust; a confident wrong one spends it. Second:
`table → server` is re-read at alert time, never cached from check-open; the whole class of
mid-service reassignment bugs comes from caching that join.

---

### M4 — The team waited on a blocker it never commissioned anyone to remove

Stage 2's trigger is a kitchen-ready event in `CanonicalCheck`. That is not this team's code
— [[pos-bridge-charter]] owns the canonical shape, and nine registry providers need a
partner agreement before anything can be asked of them at all
(`pos-provider.registry.ts:119,171,192,222,232,242,254,264,298`). The failure mode is
politeness: the team reports "blocked" every close-time for a year, correctly, and never
files the change request that would unblock it. This is the same shape as
`teams/product.md:474-478`'s warning about a burn-down team that cannot commission
endpoints.

**Earliest observable signal.** Two consecutive close-times where the status is *blocked* and
no artifact exists naming who was asked, for what, and by when.

**Counter-pressure.** "Blocked" is only a valid status with a **named counterparty and a
dated ask**. The Stage 0 input audit exists precisely to produce that ask: it converts
"no POS emits this" into a specific, citable request to [[pos-bridge-charter]] (model the
event) and [[partner-alliance-development-charter]] (get the provider to send it). A
blocked loop in [[service-floor-loops]] carries `unblocked_by` as a required field.

---

### M5 — Latency was measured end-to-end and the slow part was never in our code

The p95 target is a service-level promise, but the path is: POS → webhook →
normalization → our routing → push provider → device → notification shade. Expo push and
carrier delivery are outside this team, outside this repo, and can add seconds
unpredictably — especially on a phone in a pocket in a basement dining room with poor
signal. A team measuring only its own hop reports a beautiful number while the waiter still
finds out from the expo.

**Earliest observable signal.** Any p95 reported without a stated measurement boundary. If
the number cannot say *from which event to which observable*, it is not a latency
measurement.

**Counter-pressure.** The metric is defined **event-to-device-acknowledgment**, not
event-to-dispatch, and it is broken into published segments so the slow hop is visible:
POS→ingest, ingest→route, route→push-accepted, push-accepted→acknowledged. If the final
segment dominates, the product answer may be a floor-mounted screen or an in-venue
websocket path rather than push — which is a design conversation with
[[design-charter]] and [[engineering-charter]], and it should be triggered by data rather
than discovered after launch.

---

## Cross-cutting counter-pressure

- **The staging gate is the whole strategy.** Stage 0 (audit) → Stage 1 (check-in timing) →
  Stage 2 (personal alert), each with a named trigger in [[service-floor-charter]]. Skipping
  to Stage 2 is M1.
- **Mis-route target is zero and is never traded for latency.** Two errors that are not
  commensurable are never summed ([[service-floor-directive]]).
- **The surveillance non-goal is a founder-level decision to reverse**, not a team
  preference. That is what makes M2 survivable.
- **[[red-team-charter]] should attack the "real engagement" definition** specifically — it
  is the single place where a reasonable-looking design choice turns this into a monitoring
  product. Findings-only ([[ORG_STRUCTURE]] §3).
- **Anti-sprawl:** a NEW team with a provisional agenda unchanged in 60 days is not
  "waiting", it is fiction (foundation §3.3).
