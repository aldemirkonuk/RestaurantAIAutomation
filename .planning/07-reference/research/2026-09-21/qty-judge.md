# qty-judge — what an order line's "quantity received" should mean

Final judge over qty-owner, qty-multi, qty-exec, qty-code. Read-only. Code re-checked by me in
`/Users/[founder]/Projects/wt-r5-E` (r5/E) and `/Users/[founder]/Projects/wt-r5-cellar`,
2026-09-21. Every `path:line` below is measured in wt-r5-E unless it names the cellar lane.

## Verdict

**Quantity received = what the stock ledger booked onto the shelf for this order line, in the
item's own stock unit (bottles, for wine). Screens show it as "5 cases + 5 bottles" and never
round it. The `procurement_orders.quantity_received` column is no longer read or written by the
app.**

This is the *strong* form of Option 1. The *weak* form, which three of the four researchers
recommended ("keep the column as a labelled display cache, fix the desk, add a guard"), did not
survive the adversarial pass. That weak form is what the code does today, and it already corrupts
stock through the desk screen (section 2, finding A).

## 1. The question is really three questions

The researchers treated it as a question about the unit. The code shows the column is ambiguous
on three separate axes:

1. **Unit.** Three writers store the order's unit and one stores bottles (all four reports agree).
2. **Gross or net. Nobody named this one.** The door stores *accepted* bottles, i.e. counted
   minus rejected (`receiving.service.ts:579-585`, written at `:528`). `verifyReceipt` stores
   *accepted + rejected*, i.e. everything that arrived, broken bottles included
   (`procurement.service.ts:5466`). `markDelivered` stores the ordered quantity, which assumes
   nothing was rejected (`:4425-4426`, `:4485`). So "12 received, 1 broken" is 12 in one writer
   and 11 in another.
3. **Completeness.** The canonical delivery path books stock with `p_order_id` but never writes
   the column (`procurement/canonical/delivery-stock.service.ts:455-467`). `markDelivered` writes
   the column when the delivery path already owns the stock (`:4609-4613`, write at `:4485`). It
   also writes it when its own stock movement fails silently: the live `apply_stock_movement`
   result at `:4694` is never checked, and the column was already set at `:4476-4489`. The door
   refuses exactly this ("Only claim the shelf when the shelf actually moved", `receiving.service.ts:514-528`).
   `markDelivered` does not.

Only one record is correct on all three axes. **All four stock-booking paths write the ledger
with the order id:** door `receiving.service.ts:448-469` (`p_order_id` at `:466`), markDelivered
`:4694-4707`, verify corrections `:4904-4930` (inside `applyReceiptAdjustment`, `:4859`), and the
canonical delivery `delivery-stock.service.ts:466`. Receipt rows stay on the ledger after the
wine is sold (`booked-order-quantity.ts:3`, `procurement.service.ts:5161-5163`).

## 2. Adversarial pass on the leading answer (weak Option 1)

**A. It already fails the owner, today, at the desk. Code read, not executed.**
1. The door writes bottles and sets `PARTIALLY_RECEIVED` (`receiving.service.ts:521`, `:528`).
2. Those orders are exactly the ones in the desk's verify queue (`InventoryCommandPage.tsx:309-317`).
3. For case orders the gateway refuses to state a unit, but it still sends the raw number
   (`procurement.service.ts:5885`, `:5931` sends `received.quantity` even when `uom` is null).
4. The desk ignores the unit. It pre-fills the "accepted" count from that number
   (`ReceivingWorkspace.tsx:177`, `:204`), and the screen treats every number as the order's unit (`:472`).
5. A 5-case order (12 bottles per case) that went through the door therefore pre-fills "60".
6. Submitted unedited, "60" means 60 cases = 720 bottles. The ledger holds 60 bottles, so
   `ledgerDelta` is +660 (`invoice-match.ts:774`).
7. `applyReceiptAdjustment` books that correction (`procurement.service.ts:5338-5350`). Only price
   has an override gate, not quantity.

This is TECH-DEBT's old −660 defect (`.planning/v3.0-TECH-DEBT.md:2213-2215`) with the sign flipped
and moved from the server to a screen default. A "display-only cache" that the API serves raw is
not display-only.

**B. It hides the received count on the most common wine order.** For case, pack and split-case
orders the reader refuses (`quantity-received-unit.ts:73-77`, `:139-141`). The phone falls back
with a sentence (`apps/mobile/src/lib/receivingCountBasis.ts:16-22`), and the 409 summary leaves
the count out. The owner never sees "what came in" for a case order anywhere except the door.

**C. It fails the executive's audit test.** `updateOrder` still lets any caller overwrite the
column with no stock movement (`procurement.service.ts:2927-2933`). An auditor will not accept a
"received" figure that can be edited with no trace. No client sends it today (only `Orders.tsx:681`,
and that goes to `/deliver`), so closing this path costs almost nothing.

**D. The same rounding the owner fears already exists in the door screen.** "Earlier truck" boxes
are computed as `Math.round(bottles / packSize)` (`receiving.service.ts:626`) and rounded again in
`DoorModel.ts:155`. That rounded figure feeds the match line and the vendor credit letter
(`DoorNext.tsx:354-372`). Five cases plus seven loose bottles reads as "6 earlier". The rule
"never round, show cases + bottles" belongs in the decision, not only in the storage.

**E. The unit is the item's, not always bottles.** ADR 0070 (Locked) says the canonical unit
belongs to the item (`0070-a-quantity-states-its-own-unit.md:76-78`, `:129-133`).
`restaurant_inventory.uom` exists (`supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql:275-280`).
qty-multi says the ledger "carries no unit column". That misreads 0070. The meaning should say
"the item's stock unit", which is bottles for wine. This also weakens Option 3, whose wording
hard-codes bottles.

**What survives.** Every failure above is in the *column*, not the ledger. Change the answer from
"the column is a cache" to "the ledger answers the question and the column goes dark" and attacks
A-E are all fixed. That strong form passes every role:
- **Owner.** Sees the shelf-true count as cases + bottles. A second truck adds to the first (it is
  a sum of rows). A booking that failed shows as not on the shelf yet instead of a false "received".
- **Multi-site.** Gets one unit that compares across sites. Case size varies per order line (from
  `resolveOrderMatchUnits`, `procurement.service.ts:2103-2143`), so only a stock-unit number compares.
- **Executive.** Every received bottle traces to an append-only row with who, when and which
  idempotency key.

**Residual risks that strong Option 1 does not remove. State them in the ADR:**
- **Ledger immutability is asserted, not proven.** Whether the gateway's service credential can
  UPDATE or DELETE `inventory_transactions` is unverified (qty-exec §2).
- **The ledger holds net accepted only.** Rejected or broken bottles must be shown next to it,
  taken from `procurement_receipt_events.rejected_qty_bottles` and `rejected_quantity`, not
  subtracted invisibly.
- **Counted but not booked.** When a door count is recorded but the movement failed
  (`stockBooked:false`), the screen must say so from the events. Ledger alone would show 0.

## 3. Kill attempts on the alternatives

- **Option 2 (door writes cases).** Killed. A part case rounds away, and verify already has to
  refuse a back-derived part case in its integer columns (`procurement.service.ts:5286-5304`).
  Case size is per order line, so "5 cases" is not comparable across orders. It contradicts
  locked ADR 0070's single-unit ledger.
- **Widen the column to numeric cases.** This is the third option ADR 0168 lists
  (`wt-drops/.planning/decisions/0168-three-codex-lanes-dropped.md:295-296`). Killed by ADR 0070's
  own locked argument #3 (`0070:111-118`): 1/12 has no finite decimal representation, so 65
  bottles would become 5.4167 cases forever.
- **Option 3 (every writer stores bottles).** Killed as a source of truth. The column is still a
  second copy, and it drifts from the ledger in at least four ways:
  1. `updateOrder` can write it without moving stock.
  2. The canonical delivery path never writes it.
  3. `markDelivered` writes it when the stock movement failed (`:4694` unchecked) or when the
     delivery path owns the stock.
  4. Gross versus net still differs by writer.

  It also breaks the row's arithmetic unless the siblings move too: `accepted_quantity` and
  `rejected_quantity` are in the counted unit (`:5467-5468`), `backorder_quantity` is in bottles
  (`:5472`, from `invoice-match.ts:715`), and `invoice_quantity` is in the invoice unit. Its screen
  cost is the widest of all the options (qty-code §6). It delivers nothing strong Option 1 does not.
- **A database-maintained bottle copy, refreshed inside `apply_stock_movement`.** Not killed, but
  not needed: it is a speed-up for later, at one tenant. It remains a second copy, so defer it
  until a list screen measurably needs it.

## 4. Options for the founder (recommended first)

1. **Shelf count from the ledger.** "Received" means what the stock ledger put on the shelf for
   this order, in bottles for wine, shown as "5 cases + 5 bottles". The old column goes dark. Cost:
   one new gateway read, three screens changed, and a guard.
2. **Keep the column, labelled.** This is today's state plus a desk fix: the column stays mixed-unit,
   and every screen must check its unit before showing it. Cost: the smallest build, but case orders
   keep showing "can't tell", and the next screen that forgets reopens the +660 bug.
3. **Every writer stores bottles.** The column itself becomes bottles, written by four places plus
   the delivery path that skips it today. Cost: the widest screen and API change, and it still drifts
   from the ledger when a booking fails.
4. **The door writes cases.** Everyone writes the order's unit, so a part case is rounded or refused
   at the door. Cost: broken and short bottles vanish from the number, and it contradicts locked ADR 0070.

## 5. Why, in plain words

The stock ledger is the only record that sees every delivery: the door, the one-tap "delivered",
the delivery paperwork and the desk's corrections. It counts bottles. The old column cannot be
trusted: one path writes cases, one writes bottles, one skips it, and it can say "delivered" when
nothing reached the shelf. So "received" should be the ledger's bottle count, shown the way you
talk to a rep: "5 cases + 5 bottles".

## 6. What gets built if he takes option 1

1. **ADR** (number from the guard). It defines received as the sum of `inventory_transactions.quantity_change`
   for (order, order's item, `stock_type='live'`), in the item's stock unit, never rounded. The case
   view is computed from the order's pack size, or bottles only when the pack size is unknown.
   Rejected bottles and counted-but-not-booked bottles are shown separately. It supersedes ADR 0062's
   "given up" line (`0062:185-192`) and closes the TECH-DEBT fork (`v3.0-TECH-DEBT.md:2180-2271`).
2. **Gateway.** Order responses get a ledger-derived received block: quantity, unit, cases, loose
   bottles, pack size and pending-at-door. `readBookedOrderBottles` is batched for lists. The raw
   `quantityReceived` is no longer sent, with the old phone clients handled deliberately
   (`memory/verify-receipt-unit-safety.md` alias rule).
3. **Desk (`ReceivingWorkspace.tsx:177`).** Pre-fill from the ledger block. When the count is not
   a whole number of cases, the desk counts in bottles (`countedUom='bottle'`), so a part case can
   be verified instead of refused at `:5296-5304`.
4. **Door and phone.** Replace `Math.round` (`receiving.service.ts:626`, `DoorModel.ts:155`) with
   cases + loose bottles, and give the credit draft bottles. `receivingCountBasis` reads the new block.
5. **Stop the app writing the column.** The four write sites are `procurement.service.ts:4485`,
   `:2927-2933` (refuse the field clearly), `:5466` and `receiving.service.ts:528`. The column stays
   in the schema, with no migration now; dropping it is a later ADR.
6. **Blocking guard plus a CLAIMS row.** No app code reads or writes `quantity_received` outside an
   allow-list. It must be mutation-tested.
7. **Adjacent fix the truth depends on.** Check the `apply_stock_movement` result in `markDelivered`
   (`procurement.service.ts:4694`), so a failed booking is not reported as delivered.
8. **Records.**
   - Correct TECH-DEBT 2180: its `stockedQtyInCountedUom` code path no longer exists in r5/E
     (`procurement.service.ts:5161-5170`, `:5265`).
   - Resolve the dangling "ADR 0168 D5/D6" citations (`procurement.service.ts:4767`, `:5294`).
     Two *different* 0168 files exist, both unmerged: `wt-drops/.../0168-three-codex-lanes-dropped.md`
     and `wt-fin-D/.../0168-codex-lane-d-inventory-overlay-port-dropped.md`. That is an ADR-number
     collision for the guard.
   - Retire the dead legacy email template that labels the number "bottles"
     (`communications/email-templates-legacy.ts:406`; its only caller is `tests/email-e2e.spec.ts:224`).
9. **Cellar lane before it merges.** It still treats the column as stock input
   (`wt-r5-cellar/.../receiving.service.ts:370-372`, `procurement.service.ts:4462`, `:4969`, `:5063`),
   and it has no `booked-order-quantity.ts`. It must be rebased past r5/E's ledger read.
10. **Open fork to file, not decide.** The sibling columns (`accepted_quantity`, `rejected_quantity`,
    `backorder_quantity`, `invoice_quantity`) have the same mixed-unit problem. `managerQueue` shows
    a bottle `backorderQty` with no unit (`receiving.service.ts:800`). The same rule probably applies,
    but that is the founder's call.

## 7. Corrections to the researcher reports

- **qty-exec** says ADR 0168 does not exist. It exists, but only on unmerged branches, twice under
  different titles.
- **qty-multi** says ADR 0070 gives the ledger "no unit column". 0070 decided `uom NOT NULL` with
  an item-canonical unit (`0070:76-78`).
- **All four** missed: the gross/net split, the canonical delivery path, the unchecked RPC at
  `:4694`, the sibling columns, the door's box rounding, and the fact that the gateway sends the
  raw number next to its own refusal (`:5931`).
- r5/E's switch to reading the ledger in `verifyReceipt` is correct under every option, so it does
  not decide the fork on the founder's behalf.

## 8. What I could not verify, and shortcuts taken

- I ran no tests and no app. Finding A (+660 at the desk) and the unchecked RPC are static reads,
  not reproductions.
- I could not tell whether r5/E's ledger-read changes are on `origin/main` (79dfea023) or only on the
  lane. I ran no git history commands. I used `git grep` once, which is a read-only search, and say so.
- No production or DB access: current row counts, and whether the service credential can bypass RLS
  on `inventory_transactions`, are unmeasured.
- I did not check whether `inventory_transactions` itself carries a `uom` column yet. I confirmed it
  only on `restaurant_inventory`.
- **Web sources.**
  - Craftable's red-line for a part-case receipt was confirmed only through a search snippet
    ([support.craftable.com](https://support.craftable.com/hc/en-us/articles/360007848393-Creating-an-Invoice-from-an-Order));
    the direct fetch failed with an SSL error.
  - The MarketMan help page returned 403
    ([marketman.zendesk.com](https://marketman.zendesk.com/hc/en-us/articles/206819195-Inventory-Items-The-backbone-of-your-MarketMan-account)).
  - The R365 page confirms a separate reporting unit used to compare locations, but does not show
    how receiving converts ([docs.restaurant365.com](https://docs.restaurant365.com/docs/unit-of-measure-conversions)).
  - Supy confirms "one base ingredient" per item across pack sizes
    ([supy.io](https://supy.io/blog/learn-restaurant-inventory-unit-conversion)).
  - The accounting sources in qty-exec were not re-fetched by me.
