# 0125 — An order changes state through a sealed transition

- **Status:** Proposed — researched and built 2026-09-05 on the founder's instruction. **Q1, Q2 and Q3 were ANSWERED by the founder the same day and are built; see the addendum. Q4 remains open.** The founder locks.
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** procurement order, state machine, transition table, cancel, reject, seal,
  challenge-and-redeem, rejection_reason, audit log, auto-send, legacy desk, order-transitions
- **Links:** `[[0116-a-threshold-stops-an-order-and-a-default-is-not-an-answer]]` (the approval
  gate and the seal on approve, whose addendum recorded this fork), `[[0107-a-declared-server-is-not-a-reachable-one]]`
  (challenge-and-redeem), `[[0110-...]]` addendum (the money-route guard),
  `[[0020-no-fabricated-answers]]` (a page may not claim a write it never makes),
  `[[0058-...]]` / `order-status.ts` (the status vocabulary),
  `[[0067-a-failed-read-is-never-an-empty-one]]`,
  `apps/api-gateway/src/procurement/order-transitions.ts`,
  `apps/api-gateway/src/procurement/order-seal.ts`,
  `apps/api-gateway/src/procurement/procurement.service.ts`,
  `apps/api-gateway/src/procurement/procurement.controller.ts`,
  `apps/web/src/components/orders/SealedRejectDie.tsx`,
  `apps/web/src/pages/Orders.tsx`, `apps/web/src/pages/orders/next/ResponsesSheet.tsx`

## Context

The founder, 2026-09-05, on being offered three ways to seal a rejection:

> research the current approach, find flaws and bulletproof, then deploy agent sonnet to
> review. and build the right option for future scalabilty and quality

He chose none of the three (seal the DELETE; a separate sealed route; leave it recorded,
not proven) and asked for the research first. This is what the research found.

### The census — every path that ends an order

Measured on `feat/mudavym-design-p4` at `611f7682`, 2026-09-05. `procurement_orders.status`
has **twelve** members (`dto/procurement.dto.ts:19`). Eleven writers, in three languages:

| Writer | Writes | Reason | Actor | Seal | Audit row | From-state check |
|---|---|---|---|---|---|---|
| `DELETE /procurement/orders/:id` -> `cancelOrder` (service:2007) | CANCELLED | `?reason=`, **optional** | none recorded | **none** | **none** | **none** |
| legacy desk `Orders.tsx handleReject` (3 call sites) | via the above | **sends none at all** | — | none | none | none |
| legacy desk `handleBulkReject` | **nothing — no endpoint at all** | — | — | — | — | — |
| responses sheet `ResponsesSheet.tsx onReject` | via the DELETE | required in the page | — | none | none | none |
| `PATCH /procurement/orders/:id` -> `updateOrder` (service:1955) | **any of the 12** | n/a | — | none | none | **none** |
| `POST /orders/:id/approve` -> `approveOrder` | APPROVED | n/a | `approved_by` | **redeemed** | refusals only | none |
| `parkOrderAwaitingApproval` (service:2815) | APPROVAL_NEEDED | n/a | — | — | — | **only from PENDING** |
| `confirmDeal` (service:5455) | APPROVED | n/a | — | — | — | none |
| `syncOrderState` (inbound-responder:1161/1168/1174) | CONFIRMED / APPROVED / NEGOTIATING | n/a | — | — | — | a 7-status list + per-branch |
| `markDelivered` / receiving door / `verifyReceipt` | DELIVERED / PARTIALLY_RECEIVED / COMPLETED | n/a | `received_by` | one-tap path redeems `deliver` | — | none |
| `procurement_agent.py:780` (Python, direct Supabase) | REJECTED | none | — | — | — | none |
| `procurement_agent.py:813` (Python, direct Supabase) | CANCELLED | a hardcoded English string | — | — | — | none |

Not in the census, and worth saying: `dashboard/next/WaitingOnYou.tsx` has **no** reject
control (`grep -n -i 'reject\|cancel\|decline\|dismiss'` -> zero hits), and the **mobile app
has no cancel or reject path at all** (`grep -rn 'procurement/orders' apps/mobile` -> 10 hits:
approve, approve-draft, deliver, verify-receipt and reads). `one-tap-actions` cancels the
ACTION row, never the order.

### The flaws

1. **An unsealed destructive write beside a sealed approve.** `approve` redeems a one-time
   token bound to (actor, order, act, total, vendor). `DELETE` read an id.
2. **The reason was optional at the route and absent from the only desk production shows.**
   `@Query("reason") reason: string | undefined`, no DTO, no validation; and
   `handleReject` never passed one. `rejection_reason` — the one column recording why a
   house did not buy a wine — was left null by every rejection the legacy desk made.
3. **DELETE semantics for a state change.** Nothing is deleted; `cancelOrder` UPDATEs.
4. **No state machine anywhere.** One from-state check existed in the whole service
   (`parkOrderAwaitingApproval`). `PATCH` moved an order to any of the twelve from any
   other, including states **nothing ever writes**: `IN_TRANSIT` and `FAILED` have no
   writer in the codebase and are reachable only through that route.
5. **THE ONE WITH TEETH — a cancellation erases money the shelf still holds.**
   `cancelOrder` releases shadow stock only from APPROVED/CONFIRMED/IN_TRANSIT, so
   cancelling a DELIVERED order reverses **nothing**: the receipt event stands, the stock
   stays booked, the ledger movement is not undone. But `ORDER_SPEND_STATUSES` =
   {DELIVERED, COMPLETED} and `ORDER_ARRIVED_STATUSES` = {DELIVERED, PARTIALLY_RECEIVED,
   COMPLETED} (`order-status.ts:71,42`), so the row leaves every spend total,
   spend-by-month, cashflow figure, bottles-delivered count, lead-time statistic, on-time
   rate, HHI and vendor scorecard the moment it reads CANCELLED. Bottles on the shelf,
   money out of the books, no reason, no actor, one authenticated DELETE. This is
   [[absence-reported-as-health]] reached through the one door that touches money.
6. **Five divergent definitions of "terminal"** — `ORDER_CLOSED_STATUSES` (5),
   `procurement.service.ts:663` (7), `:5323` (8), `inbound-responder:1114` (7),
   `rabbitmq-bridge:692` (7). `check_order_status_literals.py` is green across all five:
   it requires exact enum SPELLING, not one vocabulary.
7. **A cancelled order still emailed its vendor.** `processScheduledAutoSends`
   (`@Interval(30000)`) selected `AUTO_SEND_SCHEDULED` conversations and read the order for
   `ai_autonomy_paused` and a provider email — it did not even SELECT `status`.
   `cancelOrder`'s cascade filtered `.eq("status","PENDING_APPROVAL")`, so a staged reply
   survived the cancel and went out on the next tick.
8. **No paper.** No `cancelled_at`/`cancelled_by` column exists anywhere in the repo
   (`grep -rn 'cancelled_at\|cancelled_by' apps services packages supabase` -> **zero**),
   and no `system_audit_log` row was written. The only procurement audit action is
   `order_approval_refused`.
9. **A live claim of a write never made.** `handleBulkReject` rewrote local state to
   `cancelled` and alerted "N order(s) rejected" **without calling any endpoint** — the
   exact twin of the bulk-approve defect ADR 0116's addendum removed on 2026-09-04, left
   standing because that pass's scope was approve. It sat beside `SealedApproveDie` in the
   same bulk bar.
10. **A vestigial second vocabulary in the table.** `procurement_orders.state_machine_state`
    (`varchar(50) DEFAULT 'DRAFT_LOW_STOCK'`, indexed) is written only by the Python
    orchestrator (`AI_NEGOTIATING`, `NEGOTIATION_REVIEW`, `COMPLETED`) and read by nothing.

### What comparable systems do (every URL fetched 2026-09-05)

Taken for the transition vocabulary and the guard shape only; no UI was copied.

- **Odoo 18** — [`purchase_order.py`](https://raw.githubusercontent.com/odoo/odoo/18.0/addons/purchase/models/purchase_order.py):
  six states, verbatim `('draft','RFQ') ('sent','RFQ Sent') ('to approve','To Approve')
  ('purchase','Purchase Order') ('done','Locked') ('cancel','Cancelled')`, with
  `tracking=True` so every change is logged on the record. `button_cancel` **refuses** when
  a related vendor bill exists in any state but `cancel`/`draft`, raising a UserError naming
  what to cancel first. Cancel is guarded by what is downstream of it.
- **NetSuite** — [PO status](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2408514.html):
  six statuses, eight with Advanced Receiving. "Closed — The purchase order has been
  canceled": cancel and close are ONE status, and a REJECTION is a separate one
  ("Rejected By Supervisor"). No reason required.
- **Restaurant365** — [approvals in workflows](https://docs.restaurant365.com/docs/approvals-in-workflows):
  a denial REQUIRES a reason ("If the workflow is denied, enter a reason for the denial"),
  the result is "Work Needed" rather than a terminal state, and "Each relevant event in the
  life of the workflow is logged on this tab" with the user and the timestamp.
- **Dynamics 365 Supply Chain** — [approve and confirm POs](https://learn.microsoft.com/en-us/dynamics365/supply-chain/procurement/purchase-order-approval-confirmation):
  Draft, In review, Rejected, Approved, Confirmed, Finalized. Two rules bear directly here:
  a confirmed PO may be cancelled **"provided that the quantity hasn't been received or
  invoiced"**; and under change management "any change, such as cancellation of the order …
  must be submitted to the workflow system and approved" — a cancel is an APPROVED act. A
  third is a finding about our own code: when a vendor rejects a PO "the status of the PO
  remains *In external review*" — D365 does not let a vendor's no kill the order, and
  `procurement_agent.py:780` writes terminal `REJECTED` for exactly that event.

## Options considered

**(a) Seal the existing DELETE and give the legacy Reject the hold.** Cheapest, and it
closes flaw 1 and 2 for both desks. It closes none of 4, 5, 6, 7, 9 or 10 — in particular
it would leave a *sealed* cancellation of a delivered order still erasing that order's
money, which is the flaw that costs the house something. Rejected as insufficient, not
wrong: it is a proper subset of what was built.

**(b) A separate sealed reject route for the rebuilt page only.** Leaves the legacy desk —
what production actually shows — unsealed and reasonless, which is the arrangement ADR
0116's addendum spent a pass removing on the approve side. Rejected.

**(c) Leave it recorded, not proven.** The honest option while the fork was open, and it is
what the responses sheet shipped that morning with `REJECT_SEAL_NOTE` saying so. Rejected
now that the fork is answered.

**(d) A generic `POST /orders/:id/transition` with the act in the body.** One route for
every transition is tidy, and it was the leading candidate until the adversarial pass:
every existing caller — three web call sites, the mobile app, the one-tap desk, the Python
orchestrator, `receiving.service.ts` — would have to move at once, and a body-dispatched
route makes the per-act seal binding (`approve` hashes money, `deliver` hashes stock,
`cancel` hashes both plus the state) a runtime switch instead of a signature. Rejected: the
value is in the TABLE, not in collapsing the routes, and the table can be enforced behind
the routes that already exist.

**(e) CHOSEN — an explicit transition table in the service, enforced at the doors that
write, with the cancellation sealed as its own act.**

## Decision

1. **`apps/api-gateway/src/procurement/order-transitions.ts`** — a pure module (no Nest, no
   database, no `async`) holding `ORDER_TRANSITIONS`, `canTransition`, `decideTransition`
   and `refuseTransition`. Same shape as `documents/credit-ledger.ts`, which already does
   this for a vendor credit claim; the house had the idiom one directory away.
   * **Every edge is one an existing writer performs**, read off the census. The table
     permits the whole of today's behaviour on purpose: a machine introduced by guessing at
     the graph does not make a system correct, it makes it broken somewhere new.
   * It forbids: any move out of a terminal state; a cancel out of DELIVERED,
     PARTIALLY_RECEIVED or COMPLETED (flaw 5, and Odoo's and D365's rule); and running back
     down the delivery chain.
   * A same-state write is allowed for OPEN states — the receiving door and `verifyReceipt`
     legitimately write PARTIALLY_RECEIVED twice — and refused for terminal ones. **This
     rule was wrong in the first draft and the test caught it**: cancelling an
     already-cancelled order changes no status but overwrites `rejection_reason` with a
     second account and files a second audit row naming a second person.
   * An UNREADABLE current state is a refusal, never a pass.
2. **`cancelOrder` requires a reason**, checks the transition, and **redeems a seal** for
   the new act `ORDER_CANCEL_ACT = "cancel"` (`order-seal.ts`), minted at
   `POST /procurement/orders/:id/cancel-seal-challenge`. Its arguments are the order's
   total, vendor **and status** — the status because whether a cancellation is allowed
   depends on it, so a seal held open while the truck arrives is refused with the seal's own
   words rather than by a race. This is the third act on the one `procurement_order` subject
   kind, after `approve` and `deliver`; **this pass edited no file under
   `common/seal/**`** — a new act needs no new machinery. (`seal-subject.ts` IS modified in
   this shared worktree, by a third builder adding a `price_index_upload` subject kind. Not
   mine, not reverted, and named here because a reader of the diff will see it.)
3. **`updateOrder` is held to the same table** whenever `dto.status` is present.
4. **A cancellation stops the vendor mail**, two ways: the cascade now includes
   `AUTO_SEND_SCHEDULED` (and clears `scheduled_send_at`), and `processScheduledAutoSends`
   independently DISCARDS a staged reply whose order is in a terminal state. Belt and
   brace, because the cascade is best-effort by design and a silent failure there must not
   put mail on the wire.
5. **A cancellation leaves paper**: `order_cancelled` in `system_audit_log`, in
   `recordApprovalRefusal`'s shape, naming the actor, the state left, the act, and the
   reason. Best-effort in the same sense: the act already happened, and a 500 because the
   log failed would tell the person something false.
6. **The legacy desk gets the hold through one control** —
   `components/orders/SealedRejectDie.tsx`, the sibling of `SealedApproveDie`. All three
   Reject call sites now OPEN the ceremony; none of them cancels. The die is disabled until
   a reason is typed; the mint happens when the hold begins; a failed mint cancels nothing.
7. **The fake bulk reject is removed**, not made real. A cancellation needs a reason, and
   one sentence pasted over fourteen orders is not an account of any of them — the same
   argument that makes `SealedApproveDie` mint one seal per order. The bulk bar now says so.
8. **The responses sheet mints and carries the cancel seal**, and `REJECT_SEAL_NOTE` is
   rewritten from "this records a decision rather than proving one" to what is now true.

### The role gate is deliberately NOT applied to a cancellation

**Superseded the same day.** The founder answered Q1 ("manager or owner, like approval") and the gate is built on both ends of the cancel; see the addendum below. The paragraph stands as the record of the draft's reasoning.

`assertApprovalAllowed` answers "may this role commit this much money". Refusing to let a
junior STOP a spend is that rule pointed backwards: it would leave an order live because
the only person at the desk could not have afforded to approve it. The seal proves a person
did it and the audit row names them. **Founder question Q1 below.**

## Consequences

### What becomes easier
- One place to answer "may this order move from X to Y", for every caller in every language.
- A future transition — dispute, return, partial cancellation, reopening a rejected order —
  is a row in one table plus a sentence, not a new check at each door.
- The receiving door and the desk cannot disagree about whether an order is over.
- A cancellation is answerable after the fact: who, from what state, why, and when.

### What becomes harder, or is given up
- **A cancellation now needs a reason.** A caller that sent none gets a 400. The web is
  updated; the mobile app has no cancel path to update.
- **A delivered order can no longer be cancelled at all.** The correct move is a vendor
  credit (`documents/credit-ledger.ts`) or a correction at the receiving door. If a house
  has been using cancellation as an "undo delivery", that habit breaks loudly.
- **`PATCH` with a status is now refusable.** Any client moving an order in a way the table
  does not name gets a 422 with a sentence.
- **The Python orchestrator is not covered.** `procurement_agent.py` writes REJECTED and
  CANCELLED straight to Supabase, bypassing the gateway, so no table, seal or audit row
  reaches it. **Stated, not fixed** — it is a service boundary and a separate pass.
  **Founder question Q2.**

### Known and named, not fixed
- `mintOrderSeal` (the APPROVAL mint) still drops the gateway's sentence on a refusal;
  `mintOrderCancelSeal` was given the promotion after a capture showed a 422 reaching the
  page as "Request failed with status code 422". The approval's consequence is smaller (the
  gate is re-checked at `POST /approve`, where the sentence does arrive).
- `DELETE` still names a deletion it does not perform. Renaming it would break the legacy
  desk mid-flight for no gain the seal does not already give.
- `state_machine_state` is still a dead second vocabulary in the table.
- When a mint is refused, `HoldToApprove` prints its own "The seal could not be issued —
  nothing sent." above the gateway's sentence. It reads as headline-then-reason and was
  left alone rather than adding a prop to a shared house component mid-flight.

## Verification

All counts from my own runs on this tree, with the command.

| What | Command | Result |
|---|---|---|
| The pure table | `cd apps/api-gateway && npx jest src/procurement/order-transitions.spec.ts` | **46 passed** |
| The sealed cancel | `... npx jest src/procurement/order-cancel-seal.spec.ts` | **15 passed** |
| Gateway, the touched modules | `... npx jest src/procurement src/one-tap-actions src/common/seal` | **825 passed, 3 skipped, 2 failed** — both failures in `sighting-dedup-read-error.spec.ts`, the price-sighting/currency path, in files another builder has modified in this shared worktree (`agreed-price.ts`, `own-paper-sighting.ts`, `price-currency`). Not mine and not touched by any hunk of mine. |
| Web, the touched suites | `cd apps/web && npx vitest run src/pages/orders/next src/pages/__tests__ src/components/orders src/pages/dashboard/next` | **209 passed, 5 failed** — all five in `Register.currencyStep.test.tsx`, another builder's untracked test against their modified `Register.tsx`. |
| The reject die | `... npx vitest run src/components/orders/__tests__/SealedRejectDie.test.tsx` | **13 passed** |
| The legacy contract | `... npx vitest run src/pages/__tests__/OrdersLegacyReject.test.ts` | **7 passed** |
| **Pre-fix, gateway** | probe copy of `git show HEAD:procurement.service.ts` at the same depth, renamed, run, deleted | **13 of 15 failed.** The two that pass are the two "this does not break what the house already does" cases. |
| **Pre-fix, web** | `ORDERS_SOURCE=<git show HEAD: copy> npx vitest run src/pages/__tests__/OrdersLegacyReject.test.ts` | **7 of 7 failed.** |
| tsc | `npx tsc --noEmit` in both apps, `-p tsconfig.spec.json` for the gateway | **gateway clean; web clean apart from 4 errors in `orders/next/AgreementFees.test.tsx`, another builder's untracked file.** |
| Guards | the eleven named in the standing brief plus `check_order_status_literals`, `check_money_routes_are_sealed`, `check_orders_column_writes` | **all exit 0** except `check_queried_tables_exist`, which exits 1 on **6 known-debt relations, 0 NEW** (pre-existing). `check_read_errors_not_swallowed` failed on a baseline row this pass FIXED (`preCancelRow`); the row was retired and it now passes at **191 found / 191 baselined**. |
| Boot | `bash scripts/check_gateway_boots.sh` | PASS |
| Claims | `bash scripts/check_decision_claims.sh` | **226 checked, 226 holding** |
| eslint | `npx eslint --quiet` on the touched gateway files | clean. **Web eslint could not run in this environment** (`eslint-plugin-jsx-a11y` is missing) — said, not skipped. |
| Captures | `node $SP/shoot-rejection.mjs` | 8 shots in `p4-scratch/shots-rejection/`, both grounds, every one labelled **STUB**: fixture-fed through `page.route`, because the tenant this gateway reaches holds zero orders and the gateway points at PRODUCTION. Measured live in the run: the die is `disabled: true` before a reason and `false` after, on both grounds; the 422 prints the gateway's whole sentence. |

## Founder questions

**Q1 — should a cancellation be role-gated like an approval?** Today it is not: any
authenticated member of the house may cancel any order that has not been delivered, and the
seal plus the audit row say who. The argument against gating: refusing to let a junior stop
a spend leaves money committed because the only person at the desk could not have approved
it. The argument for: an order at $20,000 is the same money going out whichever way it
moves, and a house that puts an owner in front of the approval may want one in front of the
un-approval too. Cheap either way — `assertApprovalAllowed` is already a function.

**Q2 — the Python orchestrator writes terminal states straight to the database.** Vendor
rejection -> `REJECTED`, out-of-stock -> `CANCELLED`, neither through the gateway. Three
paths: (a) leave it and accept that the table governs the desk only; (b) have the agents
call the gateway, which means a service token and a seal exemption for a machine actor; (c)
enforce the table in the DATABASE as a trigger, which covers every writer in every language
and nothing can bypass. (c) is the strongest and the most work.

**Q3 — a vendor's rejection is not the order's death.** D365 keeps such a PO "In external
review" so the house can re-negotiate; we mark it terminally REJECTED, which drops it out of
every open-order list. Should a vendor's no return the order to NEGOTIATING instead?

**Q4 — `handleBulkReject` is removed rather than rebuilt.** Confirm that rejecting one order
at a time, each with its own reason, is what you want at that desk — or say the word and it
becomes a bulk ceremony with one reason and N seals.

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-09-05 | Claude (p4ap, research + build) | Census of eleven writers, ten flaws, four fetched comparables; built the table, the `cancel` act, the two web controls, 81 new cases, the ADR. Sonnet review to follow, dispatched by the parent. |


---

## Addendum — 2026-09-05: three of the four questions, answered and built

The founder answered Q1, Q2 and Q3 within the hour. Q4 (bulk rejection) stands.

### Q1 — *"Manager or owner, like approval."*

The builder's draft left the cancellation ungated on the argument that refusing to let a
junior STOP a spend is the approval rule pointed backwards. The founder's answer: an order
is the house's money whichever way it moves, and the register that says who may commit it
says who may un-commit it.

Built with `OrganizationsService.assertCanManageRestaurant` — **the same helper** the
approval gate, the settings registers and the payment methods use, not a second copy of the
rule — on **both ends**: the mint (`POST orders/:id/cancel-seal-challenge`) and the write
(`DELETE orders/:id`). Twice for the reason the approval gate gives: a manager demoted
between the hold and the write must not spend a token they were legitimately given, and a
person who could never cancel this order must not be handed a seal that is refused two
seconds later. The role is checked **before** the state, so somebody who may not cancel
anything is told that rather than being told about this order and refused for a different
reason at the write.

`SealedRejectDie` renders **disabled with the reason** (ADR 0083: a control that disappears
teaches nothing). Three states, not two: `activeRole` comes from `/auth/me/role` and is
`null` **both** while it loads and when that read FAILED, so an unresolved role disables
too, with its own sentence — *"Your role at this restaurant has not been read yet, so
whether you may cancel an order is unknown. It is not assumed."* Collapsing `null` into
`staff` would accuse a manager; collapsing it into "allowed" would be
[[absence-reported-as-health]] on a destructive write.

### Q2 — *"Enforce the table as a database trigger."*

`supabase/migrations/20260905230000_an_order_changes_state_by_the_table.sql` — one function
and one `BEFORE UPDATE OF status` trigger. Additive: no column, no table, no RLS surface, no
backfill. `OF status` so an UPDATE that never mentions the column neither pays for the check
nor can be refused by it.

**ONE definition, two languages.** The migration's two `ARRAY` literals are GENERATED from
`ORDER_TRANSITIONS` by `renderOrderTransitionSqlArrays()`. Two independent things stop them
drifting, because drift here is asymmetric in the worst direction — an edge added to the
`.ts` leaves the DATABASE still refusing it, so the service reports a legal move and the
write fails underneath it, in production, where no TypeScript runs:
* `order-transition-sql.spec.ts` (9 cases) renders the arrays and matches the file
  character for character, then parses the SQL back out and compares SETS;
* `scripts/check_order_transition_sql.py` parses **both files itself, in Python**, so a bug
  in the renderer cannot make both halves agree on the wrong thing. Its `--self-test`
  proves it bites on a dropped edge, on an `AFTER` trigger, and on an unparsable table.

**What the SQL deliberately does NOT carry:** the same-state rule. `sameStateIsPermitted`
refuses re-entering a terminal state; Postgres cannot see that, because `SET status =
'CANCELLED'` on an already-cancelled row and an UPDATE that never mentions status are the
same event to a trigger, and refusing it would forbid editing the notes on a cancelled
order. The trigger returns early on a same-state write and the rule stays in the service,
where intent is visible. The enforced equality is over the EDGES.

**Proven by execution, not by parsing.** Docker is down, so
`$SP/pglite-probe/p4ap-transition-trigger.mjs` applies the migration to a real Postgres
(PGlite) and drives every branch. It reads the edge list back OUT of `pg_proc.prosrc`
rather than carrying its own copy. `node p4ap-transition-trigger.mjs` -> **17 ok, 0
failed**: the in-file assertions pass, **all 40 legal edges permitted, all 112 illegal
edges refused** each naming a rule, the three sentences name from/to/rule, an unrecognised
state is refused rather than guessed at, a same-state write passes, a notes-only UPDATE is
untouched, and — the point of the whole exercise — **`procurement_agent.py`'s
`CONFIRMED -> REJECTED` is refused at the database** while `CONFIRMED -> NEGOTIATING` is
permitted.

**What it costs production today: nothing.** Read-only against project
`exzueerziesmczwlhomd`, 2026-09-05, before the migration was written:

```sql
select status, count(*) from public.procurement_orders group by status;
-- APPROVED 1, PENDING 1
select count(*) filter (where status not in (<the twelve>))  as outside_vocabulary,
       count(*) filter (where status in ('COMPLETED','CANCELLED','REJECTED','FAILED')) as would_be_frozen,
       count(*) filter (where status in ('DELIVERED','PARTIALLY_RECEIVED','COMPLETED')) as goods_arrived
  from public.procurement_orders;
-- 0, 0, 0   (total_orders 2, order_audit_rows 0)
```

**Zero rows violate the table and zero are frozen by it.** No data was fixed and none needed
fixing. Stated plainly: there is no transition HISTORY in this database — `system_audit_log`
holds 0 rows for `procurement_order` — so a count "by status pair" of past moves **cannot be
made**, and this is a count of current states instead.

### Q3 — *"Return to NEGOTIATING, with the decline recorded."*

A vendor's no is not the order's death. `procurement_agent.py:780` wrote terminal
`REJECTED`, which dropped the order out of every open-order list, outstanding count and
reorder widget before a person decided anything. Corrected to `NEGOTIATING`, with a
notification that says the order is open again rather than "rejected". The gateway's own
inbound path never handled a decline at all; `syncOrderState` now checks it **first**, above
the acceptance branches, so a decline cannot fall through into a deal. `DECLINE_INTENTS` is
`rejection | declined | out_of_stock` — `counter_offer` deliberately excluded, because
haggling is not refusing.

**The decline is recorded where it already was, and is not copied.** `persistConversation`
writes the inbound row with the provider, its `created_at`, the vendor's own words and
`detected_intent`. That row IS who declined, when, and in what words; duplicating it onto
the order would create two accounts of one event that can disagree. The responses sheet
marks such an answer and prints the thing a manager would otherwise get wrong — *"The order
was returned to negotiation rather than closed, so it is still open."*

The table gained exactly one edge for this: **`CONFIRMED -> NEGOTIATING`**. Every other
from-state a decline can arrive in already had it.

### Q4 — *"No bulk; one at a time."*

Answered 2026-09-05 (batch 46). A rejection is its own hold with its own reason and its
own seal; there is no bulk act. The desk keeps the per-order path and the bulk bar says why
there is no bulk. Rejected: one hold over N selected orders with one typed reason and N
seals minted in a loop (the reason is genuinely shared only when the orders are alike, and
the sheet cannot know that); bulk only for PENDING / APPROVAL_NEEDED drafts (the same
argument, on the cheap case). Nothing to build: the bulk handler was removed in 71a6d9fd
and the one-at-a-time notice is what ships.

### Verification of this addendum (my runs, the commands named)

| What | Command | Result |
|---|---|---|
| the table, incl. the decline edge | `cd apps/api-gateway && npx jest src/procurement/order-transitions.spec.ts` | **54 passed** |
| the sealed cancel, incl. the role gate | `... npx jest src/procurement/order-cancel-seal.spec.ts` | **20 passed** |
| one table, two languages | `... npx jest src/procurement/order-transition-sql.spec.ts` | **9 passed** |
| the trigger, on real Postgres | `cd $SP/pglite-probe && node p4ap-transition-trigger.mjs` | **17 ok, 0 failed** |
| the drift guard | `python3 scripts/check_order_transition_sql.py` / `--self-test` | **exit 0** / self-test passed |
| gateway, all touched modules | `cd apps/api-gateway && npx jest src/procurement src/one-tap-actions src/common/seal src/common/orchestrator` | **1181 passed, 3 skipped, 0 failed; 65 suites passed, 1 skipped, of 66** — re-measured 2026-09-05 on the tree at `6c5a6510`. **The 1014 / 60 suites first written here was WRONG** and is corrected rather than deleted; see the review trail. |
| the CI-red spec, repaired, then the Q3 cases added | `... npx jest src/common/orchestrator/inbound-responder.service.spec.ts` | **33 passed** (25 after the repair, 8 added by the audit fix) |
| the Q3 cases against PRE-FIX sources | probe copies of `git show bdce73f4^:` and `git show bdce73f4:` for that file, at the same depth, renamed, run, deleted | **6 of 8 fail against BOTH.** The 2 that pass are the negative cases (a counter-offer is not a decline; no rewind from IN_TRANSIT/DELIVERED) — they assert something does NOT happen, and it did not happen before either. That `bdce73f4` itself fails 6 is the defect: the shipped Q3 could not reach a CONFIRMED order and told nobody. |
| the Python decline | `cd services/agent-orchestrator && /usr/local/bin/python3 -m pytest tests/test_procurement_agent_vendor_decline.py tests/test_procurement_agent.py -q` | **21 passed** (5 new here) |
| the Python cases against the PRE-FIX agent | `git show bdce73f4^:...procurement_agent.py` swapped in, run, restored | **3 of 5 fail.** The 2 that pass are "no reason is copied onto the order" (true before as well) and the out-of-stock branch, asserted so a later tidy-up does not fold a vendor with none left into a vendor refusing a price. |
| the reject die, incl. both role answers | `cd apps/web && npx vitest run src/components/orders/__tests__/SealedRejectDie.test.tsx` | **20 passed** |
| web, all touched suites | `... npx vitest run src/pages/orders/next src/components/orders src/pages/__tests__/OrdersLegacy*.test.ts src/pages/dashboard/next` | **15 files, 239 passed** |
| tsc | both apps, `-p tsconfig.spec.json` for the gateway | **0 errors** |
| guards | the twelve, plus prefix uniqueness | **all exit 0**; `check_decision_claims.sh` **231 checked, 231 holding**; `check_gateway_boots.sh` PASS |

## Review trail

| Date | Who | What |
|---|---|---|
| 2026-09-05 | Claude (p4ap, research + build) | Census of eleven writers, ten flaws, four fetched comparables; built the table, the `cancel` act, the two web controls, 81 new cases, the ADR. |
| 2026-09-05 | Claude (p4ap, follow-up) | Q1/Q2/Q3 answered by the founder and built: the role gate on both ends of the cancel, the transition table as a database trigger with a generated definition and two independent anti-drift checks, and a vendor's decline returned to NEGOTIATING in both the gateway and the Python agent. Also repaired `inbound-responder.service.spec.ts`, which commit `71a6d9fd` left red on CI. |
| 2026-09-05 | Sonnet (audit of `bdce73f4`) | Verified Q1-Q3 and every count but one. Raised three findings, all upheld: the web/gateway `DECLINE_INTENTS` pairing was asserted by a comment and held by nothing; Q3 shipped with no regression test in either language; and the sweep count in the table above was wrong. |
| 2026-09-05 | Claude (p4ap, audit fixes) | All three fixed. (1) The pairing is now a real claim — row `ADR-0125` in `CLAIMS.jsonl`, whose verify command extracts both arrays, sorts and compares, and fails on drift OR on either declaration disappearing; the comment in `responses.ts` names the row instead of a guard that did not exist. (2) Regression cases added in both languages, each proven against a pre-fix copy. **Writing them found a real defect in the shipped Q3 change**: `CONFIRMED -> NEGOTIATING` was added to the transition table and was UNREACHABLE from `syncOrderState`, because the terminal early-return fired before the decline branch was consulted — so the one case ADR 0125 Q3 is actually about, a vendor that confirmed and then went short, did nothing at all. `isDecline` now computes above that guard, `declineMayRewindFrom = ["CONFIRMED"]` is the only state a decline may rewind out of, and the gateway path now notifies a manager (it never did; only the Python path had). (3) **The sweep count was wrong by 167 tests and 6 suites** — the table said 1014 passed / 60 suites where the same command now reports 1181 passed / 66 suites. Part of that gap is the branch moving under it (`fb7248ec`, `0e4b67ed`, the `origin/main` merge `6c5a6510`) and part was wrong when written; the honest statement is that the figure was not re-measured on the tree it was published against, and the corrected one carries the commit it was measured on. |
| 2026-09-05 | Claude (p4ao, delivered-once) | Consumed this ADR's `ORDER_GOODS_ARRIVED_STATUSES` to refuse a second delivery for every caller; founder answered 409-not-400 (batch 46) and the refusal now carries the earlier delivery, rendered by the one-tap rail, the Action Center, both Orders desks and the mobile outbox. |
