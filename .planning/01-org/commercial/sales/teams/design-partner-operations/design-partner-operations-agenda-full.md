---
type: agenda-full
division: commercial
department: sales
team: design-partner-operations
status: provisional
metrics: [sales.time_to_first_connection, sales.verified_dollars_recovered, sales.unprompted_sessions_7d, sales.design_partner_touch_streak]
updated: 2026-08-24
links: ["[[design-partner-operations-charter]]", "[[design-partner-operations-premortem]]", "[[design-partner-operations-directive]]", "[[design-partner-operations-loops]]", "[[design-partner-operations-schedule]]", "[[design-partner-operations-agenda-board]]", "[[sales-agenda-full]]", "[[outbound-engine-charter]]", "[[pos-bridge-charter]]", "[[analytics-bi-charter]]", "[[media-brand-charter]]", "[[customer-relationship-research-charter]]", "[[guest-experience-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Design Partner Operations — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The account has never
> been connected, never been instrumented, and has never produced a dollar.

## What

Four outcomes, in order, and the order is the plan:

1. **Connected.** `DEP-06` checked, real Toast data arriving, verified by one successful
   `getSalesData` call against the live restaurant.
2. **Observed.** Unprompted sessions measurable, so we can tell usage from politeness.
3. **One landed credit.** A single real discrepancy, claimed, and the credit **watched
   onto a later invoice**.
4. **Referenceable.** Written permission to name them, a real quote, and a
   sixty-second demo built from what actually happened.

That is the entire remit for the next two quarters. Notably absent: features, feedback
programmes, expansion, and anything resembling a second account.

## How

- **Connected — a visit, not a ticket.** Everything needed already exists.
  `apps/api-gateway/src/toast/` holds `toast.service.ts` (33KB, with `getSalesData`,
  `getMenus`, `processWebhook`), `toast-auth.service.ts` (OAuth,
  `TOAST_MACHINE_CLIENT`, `:54-72`), a controller, DTOs, and a spec. The five config keys
  are already named in `env.example:49-56`: `TOAST_API_URL`, `TOAST_CLIENT_ID`,
  `TOAST_CLIENT_SECRET`, `TOAST_RESTAURANT_GUID`, `TOAST_WEBHOOK_SECRET`,
  `TOAST_ENVIRONMENT`. Start in `sandbox`, move to production once one call returns real
  data. **Go in person.** A request that needs the other party's attention does not survive
  being asked for over text ([[design-partner-operations-premortem]] M2).
- **Observed — one event, requested not built.** Session start carrying
  `seconds_since_last_founder_contact`. Under 24 hours means prompted. This is an ask into
  [[analytics-bi-charter]] and it is the highest-value dependency this team has. Nothing
  else on this list produces evidence the founder can trust about himself.
- **One landed credit — manual and small on purpose.** The four-way match's headline
  verdict `overbilled_vs_ship` (`.planning/YC_WEDGE_PLAN.md:342`) needs a machine-read
  invoice, and today the invoice half is hand-typed per line item
  (`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:400,438`). So: **the
  founder types the first month's invoices, not the kitchen.** Take one week of real
  invoices and packing slips, run the match, find one genuine discrepancy, help the owner
  claim it, and then — the part everyone skips — **read next month's invoice to confirm
  the credit landed** (`.planning/YC_WEDGE_PLAN.md:31-33`). One landed credit unlocks the
  evidence gate for the whole division.
- **Referenceable — asked once, in the right order.** Permission, quote, and demo come
  *after* the credit lands, because a reference given before a result is a favour, and a
  favour is exactly the thing this relationship must stop trading in
  ([[design-partner-operations-premortem]] M1).

**Method note — the one front door.** Every other unit's request to this account routes
through this team and is sequenced: connection → recovery evidence → reference permission →
[[customer-relationship-research-charter]] sessions → [[guest-experience-charter]] guest
data. Cap: **one substantive ask per week.** Not bureaucracy — an organisation of one
person that behaves like an organisation of six will exhaust its only customer in a month
([[design-partner-operations-premortem]] M4).

## Why now

1. **Five environment variables gate the only real data this company has.** Nothing else
   in the repo has that ratio of value to cost.
2. **NF-B has no other source.** [[README]] §4.2 makes the guest track a priority; guest
   events need a live restaurant; there is exactly one candidate
   (`.planning/PROJECT.md:127`). This team's checkbox is a hard blocker on another
   division's priority track.
3. **The politeness clock is running.** Every unmeasured warm week makes the friendship
   harder to read. Instrumentation is worth more before opinions form than after.

Against: the founder does two to three focused things per week
(`.planning/PROJECT.md:134`), and this competes with product work that feels more
productive. It is not more productive. It is the only work that produces evidence.

## Next steps

1. **Book the restaurant visit.** A date, this month.
2. **Enter the five Toast keys** (`env.example:49-56`), verify one live `getSalesData`
   response, tick `DEP-06`.
3. **Request the unprompted-session event** from [[analytics-bi-charter]].
4. **Start the contact log** — one row per interaction: what was asked, what was observed,
   what blocker it produced. This is also M4's only defence.
5. **Run one week of invoices by hand.** Find one discrepancy. Help claim it.
6. **Reconcile next month's invoice.** Landed or not landed — record both.
7. **Only then** ask for permission, a quote, and the demo.

## Questions for the founder

1. **When is the visit?** [[design-partner-operations-premortem]] M2 is a date problem, not
   a work problem. A named day converts it from a five-minute task that survives a year
   into a task.
2. **Recovery first, or NF-B first?** They pull the account in different directions —
   recovery needs receiving discipline and invoice entry; NF-B needs guest-choice data off
   Toast checks. Both are real, the owner's patience is not infinite, and choosing badly
   costs the relationship. This team's view: **recovery first**, because it produces the
   number the division is blocked on. Yours to overrule.
3. **Will you type the invoices for the first month?** It does not scale and that is the
   point. The alternative is discovering that receiving discipline decayed and mistaking it
   for indifference to overbilling ([[design-partner-operations-premortem]] M5).
4. **Does this account ever pay, and does he know that?** Pricing is deferred and not ours,
   but the *relationship* answer must be known before the question is asked at a table. A
   friend who has never been asked to pay is not evidence anyone will.
5. **Do you accept the one-front-door rule?** Every unit's ask on this account routes
   through here, capped at one substantive request per week. It slows other teams down. It
   is the only thing standing between one willing restaurant and six simultaneous requests.
