# 0055 — Order status is an enum, not a string

- **Status:** Proposed
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** procurement_orders, status, ProcurementOrderStatus, enum, case sensitivity, structural zero, vendor scorecard, lead time, spend, guard, absence-reported-as-health
- **Links:** [[0053-analytics-cost-unknown-not-invented]], [[0054-order-capture-and-unit-arithmetic]], `scripts/check_order_status_literals.py`, `apps/api-gateway/src/procurement/order-status.ts`

## Context

`procurement_orders.status` is written from `ProcurementOrderStatus`
(`apps/api-gateway/src/procurement/dto/procurement.dto.ts:15-29`) — twelve
UPPERCASE members. Production holds `APPROVED` ×1 and `PENDING` ×1, measured
2026-09-01; there has never been a lowercase row.

Nine read sites compared that column to the lowercase string `"delivered"`:

| Site | What it feeds |
|---|---|
| `advanced-analytics.service.ts:290` | vendor scorecard, lead time mean/median/p90/stdev, on-time rate |
| `advanced-analytics.service.ts:437` | cashflow, spend pacing, projection |
| `goals.service.ts:320` | the `purchase_spend` goal series |
| `analytics.service.ts:154` | `loadDeliveredOrders` → HHI, spend concentration |
| `insights/insight-generator.service.ts:239` | the entire purchasing insight family |
| `dashboard.service.ts:322,438,569,832` | spend total, spend-by-month, bottles delivered, spend trend |

Every one returned a **structural zero** — not "no data yet", but a number that
could never have been anything else, rendered to the founder as though it had
been measured. This is the `absence-reported-as-health` fault with an extra
twist: the absence wears the costume of a measurement. A vendor scorecard
showing zero lead time looks like a vendor with no deliveries, not like a
broken query.

**The sweep found the defect is wider than the nine.** Same class, same table,
not previously catalogued:

- `dashboard.service.ts:141,145,548,704` — `"pending"`, `"awaiting_approval"`,
  `"in_transit"`, `"ordered"`. Note that `awaiting_approval` and `ordered` were
  never members under *any* casing, so a pure case fix would not have saved
  them. The dashboard's "pending orders" and "in transit" counts were zero for
  the same reason the spend was.
- `ask-ai.service.ts:187,835` — `.not("status","in",'("delivered","cancelled")')`.
  This one **failed open**, which is worse than a zero: nothing matched, so
  `NOT IN` matched *everything*, and closed orders were served as live
  candidates — including to the gate at `:835` that decides whether to draft a
  vendor reply. A mis-cased filter is not uniformly conservative; its direction
  depends on the operator.
- `scheduled-tasks.service.ts:474,546` — `"SHIPPED"` and `"INVOICED"`. Correct
  casing, nonexistent values. Delivery reminders and payment-due reminders have
  never sent.
- `scheduled-tasks.service.ts:398` — `"RECURRING"`. Same shape, but see
  *Consequences*: this one is left tracked rather than fixed.

Two **writers** inserted the wrong case, so any repaired history would have
been mixed: `providers.service.ts:959` and `provider-intelligence.service.ts:626`
(both retroactive-order backfills). Production has no lowercase rows only
because those paths have not run in production yet — the bug was latent, not
absent.

Four **test fixtures** locked in the wrong case
(`dashboard.spend.spec.ts:59,68`, `order-schema-drift.spec.ts:221,234`). They
were green for a reason worth recording: both harnesses stub the Supabase
builder with *passthrough* filters, so `.eq()` is never applied and every
fixture row comes back regardless of what was filtered on. The fixtures then
spelled the case the **reader** expected rather than the case the **writer**
writes. Two wrongs agreed, and the suite reported health. A fixture that
matches the reader cannot fail on a reader/writer mismatch — the defect was
reproduced inside the test harness.

## Options considered

1. **Case-insensitive comparison everywhere** — `ilike`, or `.toLowerCase()` on
   both sides. Cheap and fixes today's nine sites. Rejected: it treats the
   symptom as the rule. It legitimises "status is a string you can spell how
   you like", so the next author writes `"Delivered"` and it works, and the one
   after writes `"ordered"` — which no casing rule can save, because it is not
   a member at all. Four of the sites found here (`awaiting_approval`,
   `ordered`, `SHIPPED`, `INVOICED`) are exactly that failure and would survive
   this fix untouched. It also costs the index on every query and cannot be
   enforced.

2. **A database `CHECK` constraint on `status`** — pin the column to the twelve
   members in Postgres. Genuinely attractive, and *complementary rather than
   competing*: it is the strongest possible guarantee for **writers**, and it
   would have caught the two backfills at the point of insert. Rejected **as
   the fix** because it is blind to the actual defect: this bug is overwhelmingly
   in **readers**, and a `CHECK` constraint does not fire on a `SELECT`.
   `.eq("status","delivered")` against a CHECK-constrained column is not an
   error — it is a valid query that legally matches zero rows, which is
   precisely the silence being diagnosed. It also cannot see
   `awaiting_approval`/`ordered`/`SHIPPED`/`INVOICED` in a `WHERE`, cannot see
   the in-memory `.filter()` sites at all, and — per the `schema-parity` and
   `auth.users` memories — a migration that CI cannot exercise against real
   rows is a weak place to put a guarantee. Worth adding later for the writer
   half; it is not a substitute for the reader half.

3. **Leave it** — the numbers are only wrong, not crashing. Rejected: this is
   the most expensive option, because the output is *confident*. A zeroed
   vendor scorecard is indistinguishable from a well-behaved vendor, so the
   founder makes purchasing decisions against fabricated calm. And the ask-ai
   gate fails open, so "leave it" is not even safe in the passive direction.

4. **Shared vocabulary + a blocking guard** *(chosen)* — one module exports the
   named status sets; a CI guard fails the build when application code spells a
   status literal at all.

## Decision

**The enum is the vocabulary. Application code never spells a
`procurement_orders.status` literal; it imports a named set from
`apps/api-gateway/src/procurement/order-status.ts`, and
`scripts/check_order_status_literals.py` blocks the build when it does.**

The nine edits are cleanup. **The guard is the decision** — without it this
recurs on the next call site, exactly as it recurred nine times before anyone
noticed. That is the `solve-it-once-means-add-a-guard` rule: sweep, blocking
CI guard, ADR.

### "Delivered" is not one question

The sets differ **only** in how they treat `PARTIALLY_RECEIVED`, and that
difference is the substance of this decision, not a detail:

- **`ORDER_ARRIVED_STATUSES`** = `DELIVERED`, `PARTIALLY_RECEIVED`, `COMPLETED`.
  *A delivery physically happened; `delivered_at` is real.* Includes
  `PARTIALLY_RECEIVED` because a short delivery still arrived — the door event
  happened and its timing is exactly what a lead-time or punctuality question
  asks about. Excluding it would silently drop a vendor's *worst* deliveries
  from its own on-time score, which is the subset most worth measuring.
  → lead time, on-time rate, delivery-timing scorecards, payment-due reminders.

- **`ORDER_SPEND_STATUSES`** = `DELIVERED`, `COMPLETED`.
  *The money and quantity columns are final.* **Excludes**
  `PARTIALLY_RECEIVED` — this is the genuine judgement call the founder
  flagged. A partially-received order has arrived, so it is in the *arrived*
  set; but its `final_price`, `total_cost`, `bottles_total` and `quantity`
  still describe the **purchase order**, because the remainder stays open as a
  backorder (the enum member says so itself). Counting it here would add the
  full PO value for a partial shipment and overstate every spend, cashflow and
  bottle figure by the backordered remainder. The choice is between
  understating by goods-received-on-open-backorders and overstating by
  goods-ordered-but-never-delivered; for a money figure the founder reads as
  fact, **understating is the safer error**, and it self-corrects — the order
  becomes `COMPLETED` when the three-way match closes it, and then it counts.
  → spend totals, spend-by-month, cashflow, bottles delivered, purchase-spend goals.

- **`ORDER_CLOSED_STATUSES`** = `DELIVERED`, `COMPLETED`, `CANCELLED`,
  `REJECTED`, `FAILED`. *Nothing further will happen.*
  → the ask-ai "is this still actionable" gates, which previously failed open.

- `ORDER_IN_FLIGHT_STATUSES`, `ORDER_AWAITING_APPROVAL_STATUSES`,
  `ORDER_OPEN_WITH_VENDOR_STATUSES`, `ORDER_OUTSTANDING_STATUSES` — the
  dashboard and reminder groupings that replace `awaiting_approval`, `ordered`,
  `SHIPPED`.

**These are proposed, not settled.** The `PARTIALLY_RECEIVED`-out-of-spend call
is the one most likely to be wrong, and it is the founder's to lock.

### Why the guard is not the rule the brief first described

The brief specified: *fail when any TS file compares `status` to a non-member
literal.* Measured against the tree, that rule fires on **~80 legitimate
sites** — `status` is a column on at least a dozen unrelated tables
(`menus`→`active`, `notifications`→`unread`, `prospects`→`new`,
`wines`→`pending`, simpos checks→`open`/`voided`,
`recommendation_actions`→`snoozed`, `calendar_events`→`dismissed`,
`procurement_conversations`→`PENDING_APPROVAL`), and JavaScript's own
`Promise.allSettled` yields `.status === "fulfilled"`. A guard nobody can keep
green is deleted or blanket-ignored within a week, so the literal rule would
have produced *less* enforcement than none.

The shipped guard is **table-scoped**, in two arms:

- **Arm 1 (attributed):** the site is inside a chain rooted at
  `.from("procurement_orders")`. The table is proven, so the rule is strict —
  every literal must be an exact member. This is what catches `SHIPPED`,
  `INVOICED`, `awaiting_approval`, `ordered`.
- **Arm 2 (unattributed):** `o.status === "delivered"` on an array fetched
  earlier, where no `.from()` is in reach. The table cannot be proven, so the
  rule is the high-confidence subset — a literal matching a member
  *case-insensitively* but not exactly. Arm 2 runs only in files that
  demonstrably touch `procurement_orders`, which removes every false positive
  in the tree (`calendar.service.ts` and the email templates compare
  `"cancelled"`/`"delivered"` and mention the table nowhere).

The member list is **parsed** from `procurement.dto.ts`, never hardcoded, so
the guard learns new members and exits 2 rather than checking against an empty
set if the parse breaks. Per `absence-reported-as-health`, every found-nothing
path is a failure: missing tree, unparsable enum, fewer than 8 members, fewer
than 5 `procurement_orders` chains, fewer than 20 comparison sites, or a stale
allowlist entry.

## Consequences

**Easier.** Adding a status question means picking a named set, and the name
carries the semantics — the `PARTIALLY_RECEIVED` reasoning above lives in one
place instead of being re-derived (or silently guessed) per call site. The
guard makes the whole class non-recurring rather than fixed-once.

**Harder / given up.**
- Ad-hoc status filters now need a named set, which is friction by design.
- Arm 2 is a heuristic. A brand-new invented value (`"backordered"`) in a file
  with no `.from()` in reach is **not** caught. Arm 1 catches it the moment it
  appears in a real query, which is where it would do damage.
- `scripts/check_order_status_literals.py` must be maintained alongside the
  Supabase query style; a radically different client wrapper would need the
  chain extractor updated, and it exits 2 (not 0) if that happens.

**One site is tracked, not fixed.** `scheduled-tasks.service.ts:398` filters on
`status = 'RECURRING'`, which is not a member and never has been — the
recurring-order reminder has never sent an email. Unlike the others it has no
obvious enum equivalent: the enum has no recurring concept at all, and the
query also keys on `next_order_date`. Whether recurrence is a status, a
separate table, or an abandoned feature is a **product** question, and guessing
would silently start mailing real tenants. It is recorded in the guard's
shrink-only `KNOWN_BROKEN` list (green-on-arrival so the guard can block the
*next* one) and left failing-closed, which is what it does today. **This needs
the founder's call.**

**Production needs no repair.** `select status, count(*) from
procurement_orders group by status` returned `APPROVED` 1, `PENDING` 1 on
2026-09-01 — zero lowercase rows. The two mis-cased writers are retroactive
backfills that have not run in production. Had they run, history would now be
mixed and this PR would have needed a data migration.

**Revisit when:** the founder rules on `PARTIALLY_RECEIVED` in spend; or the
`RECURRING` question is answered; or a `CHECK` constraint is added for the
writer half (option 2 above, which this decision does not preclude).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-01 | — | Created. Sweep of 21 violations across 8 files, guard, and the three named status sets. Three items await the founder: the `PARTIALLY_RECEIVED`-excluded-from-spend call, the `RECURRING` product question, and whether to add the writer-side `CHECK` constraint. |
