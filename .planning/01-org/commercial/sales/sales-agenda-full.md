---
type: agenda-full
division: commercial
department: sales
status: provisional
metrics: [sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.time_to_first_connection, sales.sending_identity_isolated, sales.qualified_conversation_rate]
updated: 2026-08-24
links: ["[[sales-charter]]", "[[sales-premortem]]", "[[sales-directive]]", "[[sales-loops]]", "[[sales-schedule]]", "[[sales-agenda-board]]", "[[design-partner-operations-agenda-full]]", "[[outbound-engine-agenda-full]]", "[[growth-charter]]", "[[media-brand-charter]]", "[[finance-pricing-charter]]", "[[supplier-distributor-network-charter]]", "[[pos-bridge-charter]]", "[[analytics-bi-charter]]", "[[decision-office-charter]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]"]
---

# Sales — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Nothing below has been
> built, scheduled, sent, or decided. The department has zero customers, zero revenue,
> zero outbound sends, and its single connection checkbox is unticked.

## What

Three deliverables, in **strict order**, and the order is the entire plan:

1. **A connection.** `DEP-06` checked (`.planning/PROJECT.md:101`). The design partner's
   Toast credentials in the environment, data flowing, the product open on someone else's
   screen.
2. **A number.** `sales.verified_dollars_recovered > 0` — one credit memo that actually
   landed on a later invoice, not a credit requested
   (`.planning/YC_WEDGE_PLAN.md:31-33`).
3. **A machine that has not sent anything.** [[outbound-engine-charter]]'s isolation
   decision, qualification rubric, and reply routing — designed, gated, dormant.

**Explicitly not on this list:** a target list (founder-deferred), a price
([[finance-pricing-charter]]), a case study ([[media-brand-charter]] writes it; we supply
the facts), and any outbound send whatsoever.

## How

**Sequencing claim:** connection → usage signal → verified number → machine. Reversing any
two produces a named failure in [[sales-premortem]]. The department deliberately does the
least impressive thing first.

- **Connection.** This is not a build task. `apps/api-gateway/src/toast/` already holds a
  33KB `toast.service.ts` with `getSalesData`, `getMenus`, and `processWebhook`, plus an
  auth service, a controller, DTOs, and a spec. The config placeholders are already
  written: `env.example:49-56`. What is missing is **five values and one conversation**
  with the restaurant owner. Sales owns the conversation;
  [[pos-bridge-charter]] owns the adapter if anything breaks.
- **Usage signal, before the first demo.** [[sales-premortem]] M1 is the highest-probability
  failure in the division and its signal does not exist: no product analytics appear
  anywhere in `env.example` (187 lines) and Sentry is the only telemetry SDK
  (`.planning/foundation/EXTERNAL_CONNECTIONS.md`). One event — session start carrying the
  delta since last founder contact — separates real usage from politeness. Requested from
  [[analytics-bi-charter]] as a dependency, not built here.
- **Verified number — and the blocker in front of it.** The four-way match's strongest
  verdict, `overbilled_vs_ship` (`.planning/YC_WEDGE_PLAN.md:342`), needs a machine-read
  invoice. Today the invoice half is hand-typed per line item in the receiving UI
  (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438`). The honest
  v0 path is therefore **manual and small**: run one week of the design partner's real
  invoices by hand, find one genuine discrepancy, help them claim it, and **watch the
  credit arrive**. One landed credit is worth more than an ingestion pipeline, and it is
  available this quarter.
- **Machine, dormant.** Design only. The one decision worth making early is the sending
  identity, because it is cheap now and expensive after the first send: the seam already
  exists and is unused (`env.example:165` `EMAIL_BACKEND=gmail`; `SENDGRID_API_KEY` at
  `env.example:167`, read at `services/agent-orchestrator/config/settings.py:202`).

**Method note — what we sell while we have no number.** The mechanism, not the outcome.
The four-way document model (`.planning/YC_WEDGE_PLAN.md` §REVISION 3) is genuinely
differentiated: when the distributor's own ship notice says 22 and its own invoice says
24, there is nothing left to argue about. That story is true today and needs no dollar
figure to tell. Claiming a recovery amount we have not verified is [[sales-premortem]] M3.

## Why now

Three reasons, in decreasing strength:

1. **The connection is the cheapest unblocked thing in the company.** Five environment
   variables stand between a built connector and the only real data the product has ever
   had. Nothing else in this repo has that ratio of value to cost.
2. **NF-B has no source without it.** [[README]] §4.2 makes the guest track a priority.
   Guest events require a live restaurant, and there is exactly one candidate
   (`.planning/PROJECT.md:127`). This department's unchecked box is a hard blocker on
   another division's priority track — which is not obvious from either side and is why it
   is stated here.
3. **The politeness clock is already running.** Every week of warm, unmeasured contact
   makes the friendship harder to read honestly. The instrumentation is worth more before
   opinions form than after.

Against all three: the founder is one person doing two to three focused things per week
(`.planning/PROJECT.md:134`). Sales competes with everything. That is the argument in
§Questions.

## Next steps

Ordered, and nothing below step 3 starts before step 1 closes.

1. **Check DEP-06.** Book the restaurant visit. Enter `TOAST_CLIENT_ID`,
   `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`, `TOAST_WEBHOOK_SECRET`,
   `TOAST_ENVIRONMENT`. Verify one real `getSalesData` response.
   → [[design-partner-operations-agenda-full]]
2. **Request the unprompted-session event** from [[analytics-bi-charter]]. One event, one
   field. Blocking on [[sales-premortem]] M1's only signal.
3. **Establish the weekly touch** and record it — [[sales-loops]] `L2`. A streak that is
   not counted is not a cadence.
4. **Run one week of invoices by hand.** Find one discrepancy. Help claim it. Watch for
   the credit. → `sales.verified_dollars_recovered`
5. **Decide the sending identity** and write it into [[outbound-engine-directive]] as a
   pre-commitment. No sends either way.
6. **File CM-F3** (distributor connectivity) with [[decision-office-charter]] and diff this
   department's proposed line against [[supplier-distributor-network-charter]]'s.
7. **Set the 2026-11-24 review** on the department's own entry trigger
   ([[sales-premortem]] M5).

## Questions for the founder

1. **Is two teams more than this stage supports?** — *A finding, not a challenge to
   [OD-09](../../../decisions/OPEN-DECISIONS.md).* The overrule of "merge Sales into
   Growth" stands and this document respects it. The narrower observation: one of the two
   teams is **dormant by its own definition** — [[outbound-engine-charter]]'s primary
   metric is explicitly dormant until the list un-defers ([[commercial]] §3). So Sales
   today is operationally a **one-team department with a design document attached**. That
   is a defensible shape; it becomes a problem only if the dormant team is staffed, given
   a budget, or graded. **Ask:** do you accept the entry trigger in [[sales-premortem]] M5
   — S2 produces no sends and no spend until `verified_dollars_recovered > 0` and the list
   un-defers?
2. **Will you set a date on DEP-06?** Everything in this department, and NF-B in another,
   waits behind it. A date makes it a task; without one it is a five-minute job that
   survives a year ([[sales-premortem]] M2).
3. **CM-F3 — do you accept the proposed distributor line?** Partnerships owns the
   distributor relationship; Sales owns the moment a restaurant we are selling to must ask
   *its own* distributor on our behalf. `.planning/YC_WEDGE_PLAN.md:41` calls the
   connectivity a commercial problem; [[supplier-distributor-network-charter]] exists.
   Proposed, not claimed. *(Note: the brief for this session called this fork CM-F6; in
   [[commercial]] §6 it is CM-F3 and CM-F6 is the Social & Community fork.)*
4. **Which is the design partner's first job — recovery, or NF-B?** They pull in different
   directions. Recovery needs invoices and receiving discipline; NF-B needs guest-facing
   choice data from Toast checks. Both are real, the restaurant has limited patience, and
   choosing badly costs the relationship. This department's view is **recovery first**,
   because it produces the number the whole division is waiting on — but the call is
   yours.
5. **Does the design partner ever pay?** Pricing is not ours ([[finance-pricing-charter]])
   and is deferred, but *whether the first account is free forever* is a relationship
   decision Sales must know the answer to before it is asked at the table. A friend who
   has never been asked to pay is not evidence that anyone will.
