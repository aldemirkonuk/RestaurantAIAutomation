---
type: agenda-full
division: product
department: product-vision
team: service-floor
status: provisional
metrics: [floor.providers_emitting_table_and_server, floor.providers_emitting_kitchen_ready, floor.misroute_rate]
updated: 2026-08-24
links: ["[[service-floor-charter]]", "[[service-floor-premortem]]", "[[service-floor-agenda-board]]", "[[service-floor-directive]]", "[[service-floor-loops]]", "[[service-floor-schedule]]", "[[product-vision-agenda-full]]", "[[pos-bridge-charter]]", "[[partner-alliance-development-charter]]", "[[design-charter]]"]
---

# Service Floor (Floor Checker) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

**Stage 0 only, until a trigger fires.** The team's entire current deliverable is a table
and two change requests. That is not a placeholder for real work; it *is* the work, because
the module's input does not exist yet and everything built before the input is built twice.

| Stage | Deliverable | Trigger to start |
|---|---|---|
| **0 — Input audit** | Per provider in `pos-provider.registry.ts`: does it emit `table_id`? `server_name`? any kitchen-ready signal? Through what mechanism (webhook / poll / not at all)? | **Unblocked. Start now.** |
| **1 — Check-in timing** | Definition of the check-in window, the "real engagement" signal, and the honest v0 product | One **non-simulator** provider emitting `table_id` + `server_name` for a real restaurant |
| **2 — Personal food-up alert** | The person-routing contract: who is notified, on what device, in what budget, and what happens when routing is ambiguous | A kitchen-ready event **modelled in `CanonicalCheck`** and emitted by a non-simulator provider |

Two change requests fall directly out of Stage 0 and are the team's real output this
quarter:

- **To [[pos-bridge-charter]]:** model a kitchen-ready / course-fired event in
  `apps/api-gateway/src/pos-hub/pos-types.ts`. It does not exist — grepping for
  `ready` / `fired` / `course` / `ticket` / `kitchen` returns one unrelated void comment
  (`:29`). This is upstream of everything in Stage 2.
- **To [[partner-alliance-development-charter]]:** for whichever provider Stage 0 identifies
  as closest, what does it take to have it emit that event? Nine registry providers carry
  `authModel: "partner_agreement"` and cannot be unblocked by engineering at all.

## How

**Audit → commission → smallest true slice.** In that order, with no exceptions, because
the failure mode here is not building badly — it is building the fun part first.

- **The audit is per-provider and mechanical.** `pos-provider.registry.ts` already carries
  capability flags per provider (`CAP_FULL` / `CAP_NO_TABLES` / `CAP_PULL` across
  `checks, items, tables, employees, webhooks`, `:17-25`). The audit extends that model with
  the two fields this team needs and the one event nobody has modelled.
- **`simpos` is a development target, never evidence.** The 47 rows that exist are
  `source='generic_webhook'` simulator output from a single 43-minute window, and
  `server_name`, `covers`, `table_id`, `total` are **0 of 47**
  (`20260819000000_guest_identity_minimal_slice.sql:11-14`).
- **Design the routing joins before the transport.** `table → server` is re-read at alert
  time and never cached from check-open — mid-service reassignment is the entire bug class
  ([[service-floor-premortem]] M3). `server → device` needs an explicit staleness rule.
- **Latency is specified end-to-end with published segments** (POS→ingest, ingest→route,
  route→push-accepted, push-accepted→acknowledged) so the slow hop is visible before launch
  rather than after (M5). If the last segment dominates, the answer may be an in-venue
  websocket or a floor screen, not push — and that is a conversation with
  [[design-charter]] and [[engineering-charter]], triggered by data.
- **The engagement signal is designed to be one the staff member benefits from producing.**
  This is the mechanism that keeps M2 from turning the product into surveillance, and it is
  a design constraint, not a policy note.

## Why now

- **Because the audit is cheap and the alternative is expensive.** Stage 0 is a table. Not
  doing it means the notification layer gets built against fixtures, which is the team's
  own named premortem.
- **Because "blocked" needs a counterparty.** [[service-floor-premortem]] M4 is the failure
  where a team reports blocked for a year and never files the ask. Stage 0 is precisely what
  converts "no POS emits this" into a dated, citable request.
- **Because the canonical shape is being extended anyway.** [[pos-bridge-charter]] is active
  and early in the department activation order; adding an event class now is far cheaper
  than retrofitting one across 30 adapters later.
- **Because the founder's addition changes the product, not just a feature.** A general
  kitchen-ready board is a screen. A direct individual alert is a routing system with a
  latency budget and a person-level correctness gate. The difference should be designed
  deliberately, once.

## Next steps

- [ ] Stage 0 audit table: provider × {`table_id`, `server_name`, kitchen-ready} × mechanism
      · [[service-floor-schedule]]
- [ ] File the `CanonicalCheck` kitchen-ready modelling request · [[pos-bridge-charter]]
- [ ] Identify the single closest provider and file the outreach ask ·
      [[partner-alliance-development-charter]]
- [ ] Write the person-routing contract (ambiguity fallback first, happy path second) ·
      [[service-floor-directive]]
- [ ] Define the latency measurement boundary and its four segments · [[service-floor-loops]]
- [ ] Define "real engagement" as a staff-beneficial signal; record the rejected
      alternatives · [[service-floor-premortem]] M2
- [ ] Record the no-performance-scores non-goal as a founder-level decision, not a team
      preference
- [ ] Do **not** build push routing until Stage 2's trigger fires. This is a listed
      non-action on purpose.

## Questions for the founder

1. **Is check-in timing alone an acceptable v0?** Given `server_name` and `table_id` are
   0 of 47 rows and no POS models a kitchen-ready event, Stage 1 is reachable much sooner
   than Stage 2. Is the food-up alert *the* point — in which case this team is entirely
   downstream of [[pos-bridge-charter]] and should say so — or is check-in timing a product
   on its own?
2. **The surveillance line.** The charter names "no staff performance scores, rankings, or
   disciplinary exports" as a deliberate non-goal, because the alternative is a system staff
   defeat. The first manager to ask for a per-waiter report will have a reasonable case.
   Confirm this is a founder-level decision to reverse, not a team preference.
3. **What is "real engagement"?** A proximity beacon indicts; an acknowledged alert informs.
   The second is weaker evidence and a better product. Which are we building?
4. **What is the latency promise?** p95 to *device acknowledgment* is honest and partly
   outside our control (push provider, carrier, a phone in an apron). p95 to *dispatch* is
   fully ours and means less. The first is the right metric and it will look worse.
5. **Is an in-venue path acceptable if push is too slow?** A floor-mounted screen or a
   venue-local websocket would meet the latency budget but changes the hardware story and
   the "personal" framing. Worth deciding before, not after.
