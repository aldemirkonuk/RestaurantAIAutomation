---
type: charter
division: commercial
department: sales
team: design-partner-operations
status: partial
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak, sales.time_to_first_connection, nf_b.source_count]
updated: 2026-08-24
links: ["[[design-partner-operations-premortem]]", "[[design-partner-operations-directive]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-schedule]]", "[[design-partner-operations-agenda-full]]", "[[design-partner-operations-agenda-board]]", "[[sales-charter]]", "[[outbound-engine-charter]]", "[[pos-bridge-charter]]", "[[media-brand-charter]]", "[[customer-relationship-research-charter]]", "[[analytics-bi-charter]]", "[[guest-experience-charter]]", "[[product-vision-charter]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]", "[[PROJECT]]"]
---

# Design Partner Operations — Charter

> **`partial`. EXISTS as a relationship, NEW as an operation.** There is a real
> restaurant, a real friendship, and a real grant of API access. There is no cadence, no
> connection, no instrumentation, and no number. A relationship is not an operation, and
> this team exists to make it one.

## Mandate

Own the **single Toast restaurant end to end**: get it connected, keep it running,
maintain weekly contact, and extract the evidence the rest of the division depends on —
the verified recovery number, the case study inputs, and the sixty-second demo. It is the
only real sales surface that exists today. Everything [[media-brand-charter]] wants to
write, everything [[outbound-engine-charter]] would eventually claim, and everything
Corporate would put on a traction slide originates here or does not exist.

**Why distinct from [[outbound-engine-charter]].** Operational relationship work with one
named counterparty. Its craft is *being present, unblocking, and observing* — showing up,
noticing what the owner actually does at 4pm on a Tuesday, and removing whatever stopped
them. That has nothing in common with building a sending machine, and the two failure
modes are opposites: this team fails by being too welcome, S2 fails by being unwelcome at
scale.

## Boundaries

Owned outright:

- **The account.** The friend's Turkish restaurant in San Francisco, on Toast, with full
  API access already granted (`.planning/PROJECT.md:127`). One counterparty, named.
- **The connection handshake.** Getting `DEP-06` from unchecked to checked
  (`.planning/PROJECT.md:101`) — the conversation, the credential exchange, and the
  verification that real data arrived. Not the adapter code; see non-goals.
- **The weekly touch, and the honesty of it.** Contact counts only when it produced an
  observed usage moment or a named blocker.
- **Blocker removal.** Whatever is between the restaurant and using the product is this
  team's queue, whoever has to fix it.
- **Observation.** What they actually do, versus what they say. This team owns the gap.
- **Evidence extraction** — verified recovery figures, permission to reference, a real
  quote, the demo narrative's raw material.
- **The relationship's honesty budget.** How much of the friendship can be spent on asks,
  and the discipline not to spend it on the wrong ones.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **The Toast adapter itself** | [[pos-bridge-charter]] | `apps/api-gateway/src/toast/` is Engineering's code — `toast.service.ts` (33KB), `toast-auth.service.ts`, controller, DTOs, spec. We own the credential conversation and the "is data arriving?" check. If the adapter is broken, we file it; we do not fix it. |
| **Invoice ingestion / OCR** | Engineering → procurement | The hand-typed invoice half (`ReceivingWorkspace.tsx:400,438`) blocks our primary metric. We own the escalation, not the pipeline. |
| **Writing the case study** | [[media-brand-charter]] → [[narrative-collateral-charter]] | We supply verified facts and a real quote. A team that writes its own case study writes a better story than happened. |
| **Structured customer research** | [[media-brand-charter]] → [[customer-relationship-research-charter]] | **A live seam** — see below. |
| **Defining the recovery number** | [[analytics-bi-charter]] | We report it; they define it. |
| **Guest-level analysis of their data** | [[guest-experience-charter]] | We own getting the tap open. What NF-B does with the stream is theirs. |
| **Roadmap promises** | [[product-vision-charter]] | We relay needs. We never commit a build at a table. |
| **Price** | [[finance-pricing-charter]] | Deferred and not ours. Including the question of whether this account ever pays. |
| **Cold outbound of any kind** | [[outbound-engine-charter]] | One counterparty. If we are emailing someone who does not know us, we are in the wrong team. |

### The seam with Customer Relationship Research

[[customer-relationship-research-charter]] (M4, Media & Brand) does structured research
with customers, under a consent gate. This team talks to the same single restaurant every
week. Two units, one counterparty, finite patience.

**Proposed line, offered rather than asserted:** *this team owns unstructured, operational
contact — showing up, unblocking, observing. M4 owns structured, consented research
sessions with a protocol and a written output.* And a scheduling rule that matters more
than the definition: **M4 books through this team.** Not for approval, but so that one
account does not receive two independent requests in the same week from an organisation of
one person. The relationship is the scarce resource, not the research slot.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `sales.time_to_first_connection` | Days until `DEP-06` is checked | **day 0**, uncapped |
| `sales.verified_dollars_recovered` | **Primary.** Credits that landed on a later invoice (`.planning/YC_WEDGE_PLAN.md:31-33`) | **$0** |
| `sales.unprompted_sessions_7d` | Sessions not preceded within 24h by a founder message | **unmeasurable** |
| `sales.design_partner_touch_streak` | Consecutive weeks of a real, qualifying contact | **0** |
| `sales.blocker_age_max` | Oldest open blocker, in days | undefined |
| `nf_b.source_count` | Restaurants emitting guest events | **0**, gated entirely on this team |

**Primary metric: verified dollars recovered.** Not credits requested. Until an X12 812
credit memo lands on a later invoice, "dollars recovered" means *"we asked"*
(`.planning/YC_WEDGE_PLAN.md:31-33`). The whole division's honesty rests on this team
holding that distinction when it would be easier not to.

## Evidence today

- **EXISTS — the customer.** *"First user: Friend's Turkish restaurant in SF using Toast
  POS. Full API access available."* (`.planning/PROJECT.md:127`). Named, willing, and
  holding the rarest asset in restaurant software: granted API access.
- **NEW — the connection.** `DEP-06: Toast API credentials configured for friend's
  restaurant` — **unchecked** (`.planning/PROJECT.md:101`).
- **EXISTS — the connector waiting on it.** `apps/api-gateway/src/toast/`:
  `toast.service.ts` (33KB — `getSalesData`, `getMenus`, `getMenu`, `refreshMenuCache`,
  `createOrder`, `getOrder`, `processWebhook`, `getStatistics`), `toast-auth.service.ts`
  (OAuth via `TOAST_MACHINE_CLIENT`, `toast-auth.service.ts:54-72`), `toast.controller.ts`,
  DTOs, and `toast.service.spec.ts`. Config placeholders already written:
  `env.example:49-56`. **The blocker is five environment variables and one conversation,
  not an integration project** — a correction upward on [[commercial]] §3.
- **EXISTS — the value to demonstrate.**
  `apps/api-gateway/src/procurement/invoice-match.ts` — a real three-way match, pure and
  unit-tested (`.planning/YC_WEDGE_PLAN.md:129`; that document says 256 lines, the file is
  now **406**).
- **PARTIAL — and the headline verdict cannot fire.** `overbilled_vs_ship` outranks every
  verdict but a missing invoice (`.planning/YC_WEDGE_PLAN.md:342`) and needs a
  machine-read invoice. The invoice half is typed by hand, per line item:
  `apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400` (`aria-label="Quantity
  invoiced"`) and `:438` (`aria-label="Invoice unit price"`). *(The YC plan's `:233,:265`
  are stale; these are the live lines.)*
- **NEW — every operational artifact.** No cadence, no blocker queue, no usage
  instrumentation (`env.example`, 187 lines, has no analytics key; Sentry is the only
  telemetry SDK — `.planning/foundation/EXTERNAL_CONNECTIONS.md`), no demo script, no
  case study, no reference permission, no signed anything.

**Roll-up: `partial`, resting almost entirely on the word "relationship".** The
strongest true sentence available is: *a real restaurant has agreed in principle and has
never been connected.*
