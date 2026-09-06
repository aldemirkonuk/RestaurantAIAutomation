---
type: page
route: /orders
slug: orders
softwares: [orders, recurring-orders]
component: apps/web/src/pages/Orders.tsx
audience: owner
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 4
maturity: partial
status: documented
updated: 2026-09-05
links: ["[[PAGE-CONTRACT]]", "[[receiving-door]]", "[[providers]]"]
---

# /orders — Orders

> **Part of** [[08-softwares/orders|Orders]] · [[08-softwares/recurring-orders|Recurring Orders]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Create Order** → (modal on this page) → API `POST /api/v1/procurement/orders`
- **Approve** → API `POST /api/v1/procurement/orders/:id/approve`
- **Mark as delivered** → API `POST /api/v1/procurement/orders/:id/deliver`
- **Receive at the door** (row menu) → [[receiving-door]] `/receiving/:orderId/door`
- **Go to Providers** (no-vendor guard modal) → [[providers]] `/providers`
- **Export** → (in-page download via ExportMenu)
- **Draft email approval panel** → (panel on this page — approve/send vendor email)
- **The vendor's answers** (rebuilt ledger row) → (house Sheet on this page) → API `GET /api/v1/procurement/orders/:id/conversations`; its Confirm → `POST …/:id/approve`, its Reject → `DELETE /api/v1/procurement/orders/:id?reason=…`

## 1. Purpose

The procurement cockpit: draft, approve, cancel and track purchase orders through
delivery, plus the AI vendor-email layer — one-tap approval of AI-drafted replies,
active conversation threads, deal proposals, and delivered-order booking into
inventory. Sidebar tooltip: "Draft, approve, and track purchase orders through
delivery" (`apps/web/src/components/layout/Sidebar.tsx:75`).

## 1a. Features
- See the purchase-order list with filters and per-order status through delivery (draft → approved → delivered)
- Create an order: pick a vendor, build the item list, submit — then approve, edit, or cancel it
- Book a delivered order into inventory in one step
- AI vendor-email layer: one-tap approve an AI-drafted reply, write a manual reply, pause the AI, cancel a scheduled send
- See active vendor conversation threads and open the chat/message thread drawer per conversation
- Deal proposals extracted from vendor mail: confirm or dismiss
- View conversation attachments (invoices, price lists)
- Contextual insights rail; table export; pending-order count badge in the sidebar
- Live updates while the page is open (realtime order events)
- Approve behind a PROVEN seal: the hold mints a one-time, 120-second challenge bound to this manager, this order, and this order's own total and vendor; the approval carries it back and it is redeemed exactly once (2026-09-04, ADR 0116 addendum)
- Bulk approve mints one seal per selected order at gesture start and approves nothing at all if any of them fails to mint
- **The LEGACY desk holds too** (2026-09-04, founder's call in the ADR 0116 addendum) — the flag is OFF in production, so this is the approve control a house actually uses. Its bulk approve is now the same hold, through the same mint (`components/orders/SealedApproveDie.tsx`), and it is a real write: before this it changed local state and alerted "N order(s) approved!" without calling anything. Cmd/Ctrl+Shift+A moves focus to the hold rather than approving on one keystroke
- **Write down an agreement, stating the unit its price is in** (2026-09-04, ADR 0119 phase 1) — the rebuilt page's own composer: wine, vendor, quantity in the order's own unit with its pack, and separately the price with a **price-unit picker** (per bottle / per case / per keg / per pack / per split case / per each / per litre) and a pack field shown only for a unit that holds more than one. The two units may differ, and the page says that is ordinary. Behind the flag only; the legacy desk (`pages/Orders.tsx`) is unchanged and cannot state a price unit
- **The ORDER carries the currency it was placed in, and says where that came from**
  (2026-09-06, founder batch 65: *"we will use the currency from where we order it. We
  will show the user the currency the vendor always uses, and they have the ability to
  change it or not in the orders page"*). The composer's currency field is pre-filled from
  `providers.usual_currency` — what a person stated on the vendor's profile
  ([[providers]] §1a) — with the sentence "the currency this vendor usually uses", and the
  person may change it before placing. `createOrder` writes `procurement_orders.currency`
  and `procurement_orders.currency_source` as two explicit keys; the provenance is
  DERIVED ON THE SERVER by comparing the recorded code against the vendor's stated one,
  never taken from the client. **A vendor who has stated no usual currency pre-fills
  NOTHING** — the sentence says so, the house's currency and the vendor's last invoice are
  shown as evidence beside the field, and neither is put in it, because
  `currency_source` admits only `vendor_usual` and `typed` and a house-derived value
  submitted untouched would be recorded as a person's choice when nobody made one. This
  NARROWS ADR 0117 Q31's *"defaulted from the vendor's terms or the house"* for the order
  header; the agreement LINE's own chain (`agreementCurrencyDefault`) is unchanged, and
  the fork is filed in [[providers]] §13. Migration
  `20260906170000_a_vendor_states_its_usual_currency_and_an_order_carries_one.sql`
- **The agreement's total is drawn from the stated pair, with its working printed** — five cases of twelve at $420 per case reads $2,100, not the $25,200 the old per-bottle arithmetic gave; a quantity or price not yet typed leaves the total an em dash, never a zero
- **The price register's refusal is said on the page, before the save** — an agreement saved with no price unit shows, in the register's own words, that it will not enter the price register and why. It still saves (a NULL pair is an ordinary row); nobody saves one unknowingly. A price unit the order cannot be counted in (a keg order priced per bottle) blocks the save with the sentence the gateway would answer
- **Every ledger row states the unit its price is in, and shows the working in that unit** (2026-09-05, ADR 0119 phase 2) — `GET /procurement/orders` joins the line's pair in the same query and the expanded row prints "$420.00 per case (12 bottles)" above "60 bottles ÷ 12 = 5 cases × $420.00 = $2,100.00". A row whose unit is UNSTATED — every order placed before ADR 0119 — prints the price, the register's refusal in words, and **no working of the page's own**: the per-bottle convention would print a case price twelve times over, which is the error this ADR exists to end. A pairing the order cannot be counted in (per keg, counted in bottles) prints the refusal instead of a total, and a route that never read the line says exactly that rather than announcing a refusal about a line nobody looked at
- **Read the vendors' answers to one order, and act on them there** (2026-09-05, founder's call; closes §13.13) — every ledger row opens a house `Sheet` listing each inbound answer: who answered, when, which round, the delivery estimate the deal proposal was drawn from, the conditions the reading flagged, the **negotiation summary as the engine's own sentence with the engine and the time it read named beside it**, and the vendor's own words. Left/right arrows and Previous/Next step between answers, oldest first. A summary that was never written says so in a sentence; a read that FAILS says it is unknown rather than showing an empty sheet
- **Reject an order with a reason in words, behind a PROVEN seal** (2026-09-05, ADR 0125; the rejection-not-sealed note of that morning is retired) — the hold mints a one-time challenge for the act `cancel` at `POST /procurement/orders/:id/cancel-seal-challenge`, bound to this manager, this order, its total, its vendor **and its state**, and `DELETE /procurement/orders/:id?reason=…` redeems it exactly once. An approval's seal is refused here and this one is refused on an approval, each with its own sentence. The reason is now REQUIRED by the ROUTE, not only by the page: a blank one is a 400 in words
- **An order changes state only in ways this house has agreed to** (2026-09-05, ADR 0125) — `order-transitions.ts` holds one table for all twelve statuses; `cancelOrder` and `PATCH /procurement/orders/:id` both consult it and refuse with a whole sentence naming the state, the consequence and what to do instead. **An order whose wine has arrived cannot be cancelled at all** — cancelling one reversed nothing (the receipt event stood, the stock stayed booked) while removing its cost from every spend, cashflow, bottles-delivered, lead-time and vendor-scorecard figure in the house. The refusal points at a vendor credit or the receiving door instead
- **A cancellation leaves paper, and stops the vendor mail** (2026-09-05, ADR 0125) — `order_cancelled` in `system_audit_log` naming the actor, the state left, the act and the reason; and a conversation left `AUTO_SEND_SCHEDULED` is cancelled with the order, with the sender refusing a closed order independently. Before this, a reply staged a minute before a cancellation was emailed to the vendor on the next 30-second tick
- **The LEGACY desk rejects through the same die** (2026-09-05, ADR 0125) — its three Reject controls (two row buttons and the right-click menu) OPEN a ceremony rather than cancelling: `components/orders/SealedRejectDie.tsx`, a reason box that arms the hold, one mint, one redemption. It was `confirm('Are you sure?')` then a bare DELETE **with no reason argument at all**, so every rejection production ever made left `rejection_reason` null. Its bulk Reject is **removed**: it called no endpoint, rewrote local state and alerted "N order(s) rejected" — the twin of the bulk-approve defect ADR 0116's addendum removed — and a cancellation needs one reason per order, not one pasted over fourteen
- **Confirm from the sheet is the SAME sealed approve as the row** — `mintOrderSeal` at the moment the hold begins, the token carried onto `POST /orders/:id/approve`, the house's approval gate honoured, and the gateway's refusal printed verbatim
- **The agreement names the money outside the price of the wine** (2026-09-05, ADR 0119 Q3) — three more fields on the composer: an **allowance** that comes off, a **deposit** and **freight** that go on, each a positive amount for the whole line, each landing in its own column on `procurement_order_items` beside the invoice line's own `allowance`/`deposit`. Left empty they are not recorded at all, which is NOT the same as recording a zero: an empty field sends no key and the column keeps NULL, while a typed 0 travels, because "no deposit was agreed" and "a deposit of zero was agreed" are different claims about a vendor. The total shows the whole arithmetic — "60 bottles ÷ 12 = 5 cases × $420.00. Goods $2100.00, less allowance $100.00, plus deposit $30.00, plus freight $48.00" — and the ledger row prints the same sentence, so a deposit can never be read as the wine having gone up. There is **no split-case fee field and there is not going to be one**: Q6 makes a split case its own line
- **The order's header price can no longer disagree with its line** (2026-09-05, ADR 0119 Q2) — `procurement_orders.final_price` is maintained from `procurement_order_items.final_unit_price` by a database trigger, and a direct write to it that disagrees with the line is refused with a sentence naming both numbers. Confirming a deal at an edited price now writes the LINE — which is what the invoice matcher and the price register read — and the header follows. An order with no line yet may still take a price on the header, and the page and the log say so, because no invoice can be matched against a price that lives only on a unit-less header
- **A split case is its own agreement line** (2026-09-05, ADR 0119 Q6) — `split_case` stopped being a bare word in the unit picker and became a rule: the line IS the broken case, priced as its own trade item, with its pack field holding the bottles actually in the broken pack. Whole cases quoted at a split-case price, or a split case quoted at the full case price, are refused in words before the database refuses them by constraint
- **Every order route names the vendor** (2026-09-05, batch 40; closes `v3.0-TECH-DEBT` "The orders wire" item 1) — `GET /procurement/orders`, `/orders/history`, `/orders/pending` and `/orders/:id` select `provider:provider_id(name)` in the statement they were already making, and `OrderResponseDto.providerName` carries it with the three-state rule the price pair uses: a name; `null` (the join was made and answered nothing); the key ABSENT (this route does not join). Four surfaces that had been printing the literal word "vendor" or nothing at all now print the name — the dashboard's approvals queue and day detail, the receipts pairing line, the one-tap delivery card — and the receiving door's credit-note letter, which LEAVES THE BUILDING, is addressed to the distributor instead of "To the vendor". `apps/web/src/lib/mudavym/vendor.ts` is the one place the three states become words, so the surfaces cannot disagree about what a missing vendor means; `scripts/check_web_reads_gateway_dto_keys.py` pins the key
- **The received count travels with its unit, or says it cannot** (2026-09-05, batch 40, ADR 0070; closes item 3) — `quantityReceived` and `quantityReceivedUom` are one fact on the DTO and never travel apart. `procurement_orders.quantity_received` has four writers and two units — three write the order's own `unit_type`, the receiving door writes BOTTLES (`receiving.service.ts:504`) — and nothing on the row says which. So the unit is stated only where the arithmetic makes the two agree (`bottle`, `each`, `keg`, `liter`, or an absent unit) and is `null` on a case, pack or split-case order, which is a refusal and not a default. The two-units defect itself is NOT repaired; the wire now reports it instead of handing a screen a number with no unit on it
- **An order can be made to repeat, and the Recurring station fills from a real column** (2026-09-05, batch 40; ADR 0125's addendum; closes `v3.0-TECH-DEBT` "The orders wire" item 2) — a rule on the ORDER, not on a template, because an order carries the whole agreement (the price AND the unit it is stated in, the allowance, the deposit, the freight) and a recurrence repeats that. Nine additive columns on `procurement_orders`; the rule is one of the five frequencies `recurring_orders` already speaks plus an optional anchor (a weekday for weekly/fortnightly, a day 1-28 for monthly/quarterly — 28 so every month has one, and 29-31 are REFUSED rather than clamped silently). **The next date is derived, never typed**: the sheet takes a rule and a start, snaps the start onto the anchor, and every advance afterwards is one pure function the gateway re-derives before it writes. **A recurrence approves nothing** — each occurrence is raised as its own PENDING order that a person seals under the ADR 0116 gate and this ADR's `approve` act, and `order-recurrence.service.spec.ts` asserts a whole generator run never calls `approveOrder`. Pausing and ending are plain writes with an audit row naming who and when, deliberately NOT sealed: they commit no money. `procurement_orders.is_recurring` and `.cron_schedule` existed in the baseline and are **tombstoned unwritten** — measured zero writers and zero readers on this table in three languages, and a cron string can neither be read back by an operator nor clamp a month end.
- **The Recurring station says "none" only from a measured read** (2026-09-05, batch 40) — it is handed the row count and the count of rows that actually CARRIED a recurrence reading, and prints one of four sentences. It will not say "there are none" off a book that never answered: absent on the wire (this route does not read recurrence) stays distinct from null (it read, and this order does not repeat), which is the distinction whose absence made the station structurally empty for its whole life. A row that repeats reads "recurs weekly on Tuesday, next 12 Sep"; a paused one says "paused" instead of printing "next —"; a child occurrence says it is one occurrence of a recurring order rather than looking like an order somebody raised by hand.
- **The one-tap delivery card is reachable** (2026-09-05, batch 40, founder's call) — the Action Center asked for PENDING/APPROVAL_NEEDED and CONFIRMED while its own filter accepted `approved` and `in_transit`, two disjoint sets, so the card had **no reachable input from the API at all** and every delivery card on screen came from `localStorage`. It now fetches CONFIRMED and IN_TRANSIT and filters on exactly those two, so the sealed deliver path runs end to end from the wire. Double-delivery is refused at the gateway for every caller (`delivered-once.ts`), which is what made switching it on safe

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_orders`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.

Canonical source with curves: `apps/web/src/pages/orders/next/MOTIONS.md` —
this list is the note-side index (ADR 0044 §2).

| id | name | fires |
|---|---|---|
| `orders.spine.tally` | Station counts arrive | a stage count / month figure changes while open — never first paint, never from an em dash |
| `orders.spine.select` | Station select | stage press: background, count colour, 2px underline |
| `orders.row.settle` | Row expand | 0fr→1fr with the chevron on the same token; body carries "the working" |
| `orders.approve.pour` / `.tuck` / `.stamp` | Hold-to-approve → seal | pending rows, drafts, and the bulk bar's hold — real mutations; early release states what did not happen; the stamp is the only overshoot in the system |
| `orders.bulk.emboss` | The dry emboss | after a bulk run: ONE ink impression, no wax — fourteen approvals, one impression |
| `orders.draft.turn` | The draft turns in | drafted letter + thread reveal, slower than settle on purpose |
| `orders.draft.drain` | Auto-send countdown | scheduled sends drain linear over the exact remaining ms, cancel live |
| `orders.agreement.panel` | The composer opens | "Write down an agreement" opens the house `Panel` on `settle`; the composer adds NO motion of its own — a refusal is stated in place, never announced with movement |
| `orders.responses.sheet` / `.step` | The vendor's answers | the row's "The vendor's answers" opens the house `Sheet` on `tuck`; stepping moves only the position dot (`settle` width, `ink` colour) — the answers themselves do not slide, because three answers are three letters, not three pages of one |
| `orders.micro.ink` | Micro-states | hovers, chips, deliver button; ≤2px travel |

Not used, on purpose: no shake, no bouncing checkmarks, no skeleton shimmer for
unknowns.

### Third pass, 2026-09-04 — the agreed price states its unit (ADR 0119 phase 1)

**What the founder asked.** Presented with ADR 0119's Q1 — ship the price-unit
columns before `/orders` can set them, or hold everything until the page can —
the founder took neither half: **"Ship the columns and the /orders field
together."** One bounded build, so the schema never holds a column nobody can
state and the desk never states a unit the schema cannot store.

**What was built.**

- `supabase/migrations/20260905010000_an_agreed_price_states_its_unit.sql` —
  `procurement_order_items.price_uom` / `.price_pack_size`, both nullable, with
  three CHECKs (the seven-word vocabulary, both-or-neither, a non-multiplying
  unit's pack is exactly 1), a comment on `final_unit_price` saying to read the
  pair first, a comment demoting `procurement_orders.final_price` to an echo,
  and three in-file assertions. **No backfill** — an unstated unit stays
  unstated.
- `apps/api-gateway/src/procurement/agreed-price.ts` (new, pure) — the resolver,
  the total, the one per-bottle conversion, and the refusal sentences.
- `procurement.service.ts` — `createOrder` refuses a half-stated pair with a
  sentence before anything is written; `upsertOrderLine` writes the two columns
  as explicit keys; the order's value comes from `agreedOrderTotal` instead of
  `finalPrice × bottlesTotal`; `recordOwnPaperSighting` gets the PRICE's pair
  rather than the quantity's, so a case-priced agreement finally enters
  `vendor_price_observations`; `recordPriceHistory` converts once and says so in
  the row's `notes`, and refuses a per-keg price rather than filing it under a
  column that says BOTTLE; `describeConfirmedOrderTerms` states the price's own
  unit when the row has one.
- `apps/web/src/pages/orders/next/AgreementSheet.tsx` + `price-unit.ts` — the
  composer described in §1a.

**The structure that enforces it.** Two units, adjacent, each with its own
field: how much was bought, and what the price is per. The ambiguity ADR 0117's
Q6 named was only possible because the second was inferred from the first; two
fields that can legally disagree make the inference impossible to make.

**What stays open, and why.**

- The **ledger row still prints a bare price**. `GET /procurement/orders`
  returns the header (`mapOrderRow`), which carries no price unit; `LedgerRow`
  would need the list endpoint to join `procurement_order_items`. Filed in §13.
- **`final_price` is demoted by comment, not by construction** (ADR 0119 Q2) —
  it is still independently written by `confirmDeal`. Making it GENERATED is a
  second migration and four readers; it was not this dispatch's.
- **`price_history.unit` is still the hardcoded `'BOTTLE'`** (ADR 0119 Q4). A
  per-keg agreement is now REFUSED from that table in words rather than filed as
  a bottle price, which sharpens the question rather than answering it.
- The **legacy `/orders`** — what production shows, the flag being off — is
  untouched and cannot state a price unit.

**Two alternatives considered and not built.** (1) Putting the picker on the
LEDGER ROW as an inline edit, so an existing agreement could be told its unit
after the fact: rejected because ADR 0119 invariant 3 says a pack change is a
new agreement line, never an edit — restating an agreement's unit retroactively
restates every sighting already written from it. (2) A single "price is per
ordered unit / per bottle" toggle instead of the full vocabulary: rejected for
the same reason the ADR rejected it in the schema — it cannot say *per litre* or
*per kg*, so it dies the day ADR 0115 phase 2 widens the intake vocabulary.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/orders`** — Three house overlays are built. The manual 'new order' sheet and its guard are owed — the founder chose the sheet as the manual entry (F5, 2026-09-05); six legacy modals retire into what is built; two dead files are deleted.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/orders` | What was agreed | panel | Built | A question the house asks before it writes a price. | `pages/orders/next/AgreementSheet.tsx:349` |
| `/orders` | Make this order repeat | panel | Built | A commitment about the future — a question, answered once. | `pages/orders/next/RecurrenceSheet.tsx:222` |
| `/orders` | Vendor answers | sheet · wide | Built | One order's correspondence is one object, read at 640 because letters are prose — the wide case ADR 0112 anticipated. | `pages/orders/next/ResponsesSheet.tsx:353` |
| `/orders` | A new order | sheet | Owed · fork F5 | The order being written is one object. Decided 2026-09-05 (F5): this sheet is the manual entry; owed on OrdersNext. | `pages/orders/CreateOrderModal.tsx:123 and pages/Orders.tsx:2903 (wine config); OrdersNext has only DraftRail (AI drafts) — no manual create path was found` |
| `/orders` | Add a vendor first | panel | Owed | A question with two answers. Travels with the new-order sheet. | `components/orders/OrderGuardModal.tsx:27` |
| `/orders` | Wine config | — | Retires | What was agreed (unit · price · currency) on the ledger row. | `pages/Orders.tsx:2903` |
| `/orders` | Reject this order? | — | Retires | Vendor answers — 'Hold to reject', with the reason in words. | `pages/Orders.tsx:3359 (SealedRejectDie)` |
| `/orders` | Provider comms thread | — | Retires · fork F4 | Vendor answers reads the thread; the composer writes. **Pause / resume the AI on this thread** becomes a control in the responses sheet's head (decided 2026-09-05, F4) — a switch, not an overlay. | `components/orders/CommsThreadDrawer.tsx:436` |
| `/orders` | AI-detected deal | — | Retires | An answer kind inside Vendor answers; 'what the AI read' survives as the provenance line. | `components/orders/DealApprovalModal.tsx:45` |
| `/orders` | Active drafts | — | Retires | /communications lists threads with their drafts; approval is the panel drawn there. | `components/orders/ActiveConversationsPanel.tsx:65` |
| `/orders` | AI draft ready | — | Retires | Drawn on /communications as **The house's reply, drafted** (owed). | `components/orders/DraftEmailApprovalPanel.tsx:130` |
| `/orders` | Recurring order (page) | — | Delete | Recurrence lives on the order (Make this order repeat). Delete. | `pages/RecurringOrders.tsx:530 — nobody imports the page` |
| `/orders` | Record an auction purchase | — | Retires · fork F4 | Built as a fourth start of **Carry this bottle** on /inventory — 'An auction lot' (decided 2026-09-05, F4). The dead file is deleted once that start exists. | `components/orders/AuctionPurchaseModal.tsx:133 — nobody imports it` |

Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

### Overlays decided (2026-09-06)

> The table above is generated from `census.py`. This one is the **decision** — finder B's
> per-row spec judged against the adversary's verdicts and against what packets 0-2 built.
> Contract, shapes and the authority rule are
> [ADR 0112](../decisions/0112-one-modal-policy-three-shapes-one-primitive.md); the cross-page
> rules are [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md).

| Overlay | Shape | Contract sentence | Four states, denied included | Ceremony, under the authority rule | Phone form | Motion | Status |
|---|---|---|---|---|---|---|---|
| What was agreed | panel 620, scrim on | "Write down what was agreed, and say what unit the price is in. Saving writes the agreement to the vendor's row. Leaving writes nothing." | *empty* n/a · *loading* "Reading the vendor's row…" · *error* "The agreement was not written. The vendor's row is unchanged." · *denied* "You can see this, but only an owner or a manager may write an agreement. Ask {name}." | plain primary; `Cmd+Enter` fires it | half detent | `settle` 320 | **built** — `pages/orders/next/AgreementSheet.tsx:356` |
| Make this order repeat | panel 620 | "Set this order to repeat. Saving creates a recurrence that will *draft* future orders — it never sends one. Leaving writes nothing." | *error* "The recurrence was not set. This order still happens once." · *denied* as above | plain primary | half detent | `settle` 320 | **built** — `RecurrenceSheet.tsx:222` |
| Vendor answers | sheet **wide** 640, **seal** | "Read what the vendor said, and answer. Holding to reject writes the rejection and tells the vendor; reading writes nothing." | *error* "The rejection was not sent. The order is still open and the vendor has not been told." · *denied* names who may answer a vendor | **the hold comes off; a required reason stays.** A rejection is a send that redeems no seal and destroys nothing, so it takes a plain control with a mandatory reason (fork 6). The pause/resume switch is the head's `action` slot only if it is read as a mode; otherwise it belongs on the thread it governs | full detent; `up`/`down` steps answers and stepping does not re-animate | `tuck` 300, 28 px | **built**, spec corrected — `ResponsesSheet.tsx:353` |
| A new order | sheet 440 | "Write an order line by line. Saving keeps a draft; nothing reaches the vendor until it is approved and sealed. Leaving discards the draft." | *empty* the register's own · *loading* named read · *error* "The draft was not saved. Nothing was written and nothing was sent." · *denied* names who may open the order book | **none** — a draft is not a commitment. The policy check (the vendor's cutoff and the 10 %-over-agreement rule, ADR 0116) runs **while the line is typed**, naming the rule at the line | full detent, the search is the peek | `tuck` 300 | **built** — packet 2 `11a788c3` |
| Add a vendor first | panel 620 | "An order needs someone to send it to, and the book has none. Choosing takes you to the vendor book; leaving keeps your lines." | *error* "The vendor book could not be read — this is not proof that you have no vendors." | plain buttons | half detent | `settle` 320 | **built** — packet 2 `11a788c3` |

Two things carry across every row here. **SC 3.3.7 Redundant Entry** bites on "A new order": the
guard panel sends the reader to the vendor book and back, so the lines typed must survive the trip
— which is what packet 0's `dirty`/`onTear`/`Stub` is for, not a nicety. And the census files
"Vendor answers" as `seal: false` while its body draws a hold — **the flag and the drawing must be
made to agree, because a guard reads the flag**; under this page's decision the hold goes and the
flag stays false (census correction, listed in ADR 0133 for the census owner).

## 1c. Motions decided (2026-09-06)

> `Today` is measured on `feat/mudavym-design-p4`. This page carries the most complete motion map
> in the repo; only the deltas are listed as changes.

| Act | Today (`file:line`) | Decided | Rejected, and why it loses | Status |
|---|---|---|---|---|
| Row expand + chevron | `settle` 320 on `grid-template-rows: 0fr to 1fr` and on the chevron, one token — `pages/orders/next/LedgerRow.tsx:277,289-290` | keep. **This is the house's canonical row expand** and eight other pages are held to it | (a) `turn` 420 — the body is the row's own working, not a new document; (b) height in px — `0fr to 1fr` is the only interruptible form | no change |
| Station counts change | `tally` 840, never on first paint, never from an em dash | keep | (a) `ink` recolour only — loses that a count moved; (b) odometer — implies a meter | no change |
| Approve one | `pour` 620 to `stamp` 360, seal minted at hold start | keep, and add the consequence-scaled press on the same terms as the dashboard (no depth variation when the threshold is unknown, and the label says so) | (a) a swipe — a vertical swipe on a row is the same gesture as scrolling the list; (b) click plus a dialog — the whole reason the die exists | owed to **packet 5** |
| Approve fourteen | `orders.bulk.emboss` — one dry impression, `stamp` at about one third amplitude, scale 0.94 to 1 | keep, **and name it what it is: the plural rendering of the wax, not a lesser ceremony.** It appears only where the wax would have appeared, many times over, so it cannot dilute the ration | (a) fourteen seals — the rationing argument; (b) a counter ticking to 14 — a progress bar over a completed act; (c) promoting it to a general second ceremony for every non-wax act — then the wax stands against a smaller stamp instead of against nothing | no change, **but BUILD-PROMPT rule 3 ("Bulk gets a plain button") is false today and must be amended to name this** |
| Reject | the same die, the same `stamp`, with a sentence saying no seal is redeemed | **the wax comes off and the hold comes off.** A plain control with a **required** reason. Under the mechanical ration rule the server redeems nothing for a rejection, and it destroys nothing | (a) keep the wax — fails the ration rule on its own terms; (b) the dry emboss — a second stamp for an act whose honesty already lives in the required reason | owed to **packet 3** |
| Draft reveal | `turn` 420 | keep | (a) `settle` — the letter is a document, not a row's working; (b) a sheet — the thread belongs under the draft | no change |
| Auto-send countdown | `linear`, duration equals the milliseconds remaining (`orders.draft.drain`) | keep. The house rule this settles: **a machine's countdown drains un-eased; a grace the reader may spend ticks as a number.** This window is a machine's — the draft sends itself | (a) an eased drain — lies about how much time is left; (b) a number only — loses peripheral legibility; (c) copy `/communications`' ticking number — that window is a grace on an act the reader already committed, which is a different act | no change, rule now written |
| Composer opens | `Panel` `settle` 320 | keep | — | no change |
| Answers arrive, stepping between them | `Sheet` `tuck` 300; the dot widens 6 to 16 px on `settle`, colour on `ink`; **no horizontal slide** | keep, and the refusal is promoted to a house rule: stepping siblings inside an open surface does not re-animate the surface | (a) a carousel slide — implies pages of one letter; (b) a cross-fade — implies the same document in a new state | no change |
| Offline queue | none on this page | none — it belongs to `/receiving` | — | no change |

## 2. Entry

In-degree 4 ([PAGE_MAP](../foundation/PAGE_MAP.md):140): from `/`, `/inventory`,
`/providers`, `/receiving`. Sidebar item (`Sidebar.tsx:73`); pending-order count
badge (`Sidebar.tsx:409`). Eagerly loaded (`apps/web/src/App.tsx:73`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:257`.
- `apps/web/src/pages/Orders.tsx` (3,614 lines — largest page in the app).
- Co-located: `pages/orders/{useOrdersPage.ts, OrderSummary.tsx, OrderFilters.tsx, CreateOrderModal.tsx, index.tsx}`.
- Rendered components: `components/orders/{SealedApproveDie, OrderGuardModal, DraftEmailApprovalPanel, ActiveConversationsPanel, CommsThreadDrawer}.tsx`, `components/insights/ContextualInsights.tsx` (Orders.tsx:5-10). `OrderApprovalModal.tsx` was deleted 2026-09-05 (§13.13).
- Rebuilt page (flag `mudavym_design_orders`): `pages/orders/next/{OrdersNext, StageSpine, Tally, LedgerRow, BulkApproveBar, DraftRail, AgreementSheet, ResponsesSheet, RecurrenceSheet}.tsx` + `{format, price-unit, responses, recurrence, useOrdersNextData}.ts` + `MOTIONS.md`.
- Recurrence (2026-09-05, ADR 0125's addendum): gateway `procurement/{order-recurrence.ts, order-recurrence.service.ts, order-recurrence.controller.ts}` + `dto/order-recurrence.dto.ts`; migration `supabase/migrations/20260905235800_an_order_that_repeats_says_so_on_itself.sql`. `order-recurrence.ts` is PURE (no Nest, no database, no clock) for the same reason `order-transitions.ts` is: a statement about dates should be provable as one.

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):389 (`procurement`, 26), :249
(`inventory`), :461 (`providers`), :663 (`wines`), :10 (`analytics` — atlas's ⚠ unguarded
is stale; guarded at class level since 2026-08-24 (#31),
`apps/api-gateway/src/analytics/analytics.controller.ts:51`).

| Method | Path | Call site |
|---|---|---|
| GET | `/procurement/orders` (list) | `useOrders` → `services/api/orders.ts:53` |
| POST | `/procurement/orders` | `pages/Orders.tsx:966`; `pages/orders/next/AgreementSheet.tsx` (the rebuilt composer, via `apiClient` — it posts the gateway's own `CreateOrderDto`, including `priceUom`/`pricePackSize`, because `services/api/orders.ts::createOrder` still takes the older `{ wineId, unitPrice }` shape the gateway does not accept) |
| PATCH | `/procurement/orders/:id` | `pages/Orders.tsx:593`. **Can answer 422** since ADR 0125: a `status` in the body is checked against `order-transitions.ts` |
| DELETE | `/procurement/orders/:id?reason=` | `components/orders/SealedRejectDie.tsx` (the legacy desk's three call sites, via `useCancelOrder`) · `pages/orders/next/ResponsesSheet.tsx`, same hook. Carries `x-seal-challenge`. **Can answer 400** (no reason), **403** (the seal) or **422** (the state) since ADR 0125; each body's `message` is the whole sentence and is printed verbatim |
| POST | `/procurement/orders/:id/cancel-seal-challenge` | `services/api/orders.ts::mintOrderCancelSeal`, called from both dies' `onChallenge`. Mints act `cancel`; refuses 422 for a cancellation the house would not perform, so the reason arrives at the START of the hold |
| POST | `/procurement/orders/:id/approve` | `pages/Orders.tsx:514,3275`; `pages/orders/next/LedgerRow.tsx`, `BulkApproveBar.tsx`, `pages/dashboard/next/WaitingOnYou.tsx` — all via `services/api/orders.ts`. **Can answer 403** since ADR 0116 |
| GET | `/procurement/order-approval-gate` | `pages/orders/next/useOrdersNextData.ts` — one call per house, not per row |
| POST | `/procurement/orders/:id/recurrence` | `pages/orders/next/RecurrenceSheet.tsx`. Body is `{ frequency, anchorDay?, startsOn? }` and **there is no `nextDueOn` field** — the next date is derived. **400** on an order nobody has approved (`not_approved`), on an order that is itself an occurrence (`child_cannot_recur`), on an unknown rule or an anchor outside its frequency's range |
| POST | `/procurement/orders/:id/recurrence/{pause,resume,end}` | same sheet. Plain acts with an audit row, deliberately NOT sealed — they commit no money. A resume rolls the next date FORWARD past every date the series slept through, so a rule paused in March and resumed in September does not mint one order a day until it catches up |
| POST | `/procurement/orders/:id/deliver` | `pages/Orders.tsx:651` |
| POST | `/inventory/add-from-order` | raw axios, `pages/Orders.tsx:684` |
| GET/PATCH | `/procurement/orders/:id/draft` | `pages/Orders.tsx:417,1021`; `hooks/queries/useDraftEmailQueries.ts:57,404` |
| POST | `…/approve-draft`, `…/generate-ai-reply`, `…/discard-draft`, `…/manual-reply`, `…/ai-pause`, `…/cancel-scheduled-send` | `useDraftEmailQueries.ts:78,103,128,225,241,255` |
| GET | `…/conversations`, `…/attachments` | `useDraftEmailQueries.ts:186,212`; `pages/orders/next/ResponsesSheet.tsx` reads `…/conversations` per order — the ONLY source of the vendors' answers, and since 2026-09-05 it also carries `summaryModel`/`summaryAnalyzedAt` (`conversation_context.model` / `.analyzed_at`) so the summary is attributed |
| GET/POST | `…/deal-proposal`, `…/confirm-deal`, `…/dismiss-deal` | `useDraftEmailQueries.ts:352,367,388` |
| GET | `/providers` | `useProviders` → `services/api/providers.ts:201` |
| GET/POST | `/analytics/insights/:rid`, `/analytics/recommendations/:rid/action(s)` | `components/insights/ContextualInsights.tsx:118-192` |

## 5. Signals

**None.** No tracking, no `uxSignals` (reporter dark per `lib/uxSignals.ts:15`, zero
page importers), no `data-ux-key` markers in this tree. Guidance tips render here via
`useGuidanceOptional` (Orders.tsx:58) but `trackGuidance` has no sink
(`guidance/analytics.ts:29-39`).

## 6. Tier cut

**Core** — operate. Scenarios: S02 (PO-prefilled delivery flow starts from orders),
S03 (credit chase drafts), S08 (price context via insights), S13 (vendor add → first
order). S02/S03 Core are ✅ ships-today ([TIER-MAP](../03-scenarios/TIER-MAP.md):38-39).

## 7. Rebrand surface

**4 user-visible strings** — the AI-draft disclaimer "Sent via WineOps AI — This
message was generated with AI assistance." shown in email previews and appended to
outbound mail: `pages/Orders.tsx:430,1039,3457,3535`. Plus shared layout chrome
(see dashboard.md §7).

## 8. State & config

- Flag `mudavym_design_orders` (localStorage override `mudavym.design.orders`) —
  gates the rebuilt tree under `pages/orders/next/`, including the agreement
  composer that states a price's unit. OFF in production, so the legacy desk is
  what a house sees.
- `VITE_API_GATEWAY_URL` (`Orders.tsx:60`) — one call uses raw axios against it (:684).
- Realtime order updates via `useRealtimeDispatch` (`Orders.tsx:49`).
- Table export via `ExportMenu`/`exportTable` (`Orders.tsx:56-57`).
- Draft-email guardrails are server-side; the page only stages one-tap approvals
  (memory: autonomous-email-replies — never auto-send).

## 9. Gaps

**An order could be delivered twice, from every caller but one — FIXED 2026-09-05
(founder: "harden it in the procurement service for every caller").**
`POST /procurement/orders/:id/deliver` read the order, wrote `status = DELIVERED`,
`delivered_at`, `received_by` and `quantity_received`, and booked stock, with no
question asked about where the order already was. The only refusal in the house lived
in `one-tap-actions.service.ts` and covered exactly one caller — the dashboard's sealed
card. The desk's "Mark delivered" (`orders/next/LedgerRow.tsx`), the legacy desk's
`handleMarkAsDelivered`, the Action Center's locally-derived delivery card and the
mobile offline outbox all posted straight past it.

*Measured, not repeated.* A second `markDelivered` on the same order did **not**
double-book the live ledger: `apply_stock_movement` returns the existing transaction
for a `p_idempotency_key` it has seen
(`supabase/migrations/20260902150000_lot_cost_truth.sql:149`) and the key is
`order-delivered-live:{orderId}`, one per order. What it did do, every time, was
overwrite `delivered_at` and `received_by` — when the wine arrived and who signed for
it became whenever it was last tapped and whoever last tapped it — reset
`quantity_received` to the full ordered count, and write `status` **backwards**: a
COMPLETED order (invoice verified) and a PARTIALLY_RECEIVED one (backorder open) both
silently became DELIVERED again, a move `order-transitions.ts` forbids for `updateOrder`
and `markDelivered` never asked it about. The real double-book is the neighbouring one:
the receiving door books under `door-receipt:{eventId}` and this path under
`order-delivered-live:{orderId}`, different keys with nothing reconciling them, so a
door count of 3 followed by a tap booked 3 + 12 = **15 bottles on a twelve-bottle
order**.

*The fix.* `markDelivered` reads `status` in the same pre-read that already fetched
`quantity`, and refuses **before any write** when the order is in
`ORDER_GOODS_ARRIVED_STATUSES` (DELIVERED, PARTIALLY_RECEIVED, COMPLETED) — imported
from `order-transitions.ts` (ADR 0125), never restated, so the rule that stops a second
delivery and the rule that stops a cancellation cannot drift. The refusal is
`409 { reason: "order_already_delivered", orderId, status, deliveredAt, message }` and
the message names the order, when it was delivered and what to do instead — three
different sentences for the three states, because they have three different
consequences (`procurement/delivered-once.ts`). An unreadable stored status is a 422
refusal, not permission. The read's own failure is a 500 with words, never an absence.
The same exclusion is also the UPDATE's `status=not.in.(...)` WHERE clause, so of two
simultaneous confirmations the loser matches no row and is told it lost the race rather
than overwriting the winner. The controller now passes `HttpException`s through instead
of re-wrapping them, so the structured body survives; `markOrderDelivered`
(`services/api/orders.ts`) promotes the gateway sentence onto `error.message` the way
`approveOrder` and `cancelOrder` do, which is how it reaches `LedgerRow`'s alert, the
Action Center's toast and the legacy desk (whose catch said *"Please try again"* — the
one instruction that must not follow this refusal).

*Still open here:* the one-tap endpoints answer **400** for the same fact the deliver
route answers **409**, because widening `deliverableOrderFor`'s exception class would
change a contract shipped in `be80f8b5`. Founder question, §13.

**The shared `Order` type declared nine keys the route does not send — FIXED
2026-09-05.** `unitPrice`, `totalPrice`, `wineId`, `providerName`, `wineProducer`,
`notes`, `createdAt`, `updatedAt`, `recurrence`; `OrderResponseDto` declares none of
them. Twenty-three files read them and every reading type-checked: `formatMoney(
undefined)` is the string `"$0"`, so the dashboard's approval seal read
**"Hold to approve · $0"** over real orders; `undefined ?? undefined * n` is `NaN`, so
the provider card printed **"$NaN"**; and `useOrdersMetrics` defaulted both money keys
to `0`, so **every procurement-spend figure on /reports and the dashboard was a sum of
zeroes**. All three classes of `absence-reported-as-health` from one wrong word in a
type. Fixed by making `Order` exactly the DTO's key set and auditing each reader (the
table at the end of this file), and guarded by
`scripts/check_web_reads_gateway_dto_keys.py`.

**What the route still does not carry, now said rather than faked.** The list and
detail routes send `providerId` and **no vendor name**, so `/dashboard`'s queue, the
day panel, the receiving door's credit-note draft and the receipts pairing line all
dropped a clause that could never have rendered; the door's letter is addressed "To the
vendor" and cannot name them. ~~They send **no `recurrence`**, so the rebuilt page's
Recurring station has always been empty and every order fell into "one-time".~~ **CLOSED
2026-09-05 (batch 40, ADR 0125's addendum):** the founder's call was *"build recurrence on the
order"*, and both routes now send six recurrence keys off nine new columns. They send
**no `quantityReceived`** — `quantity_received` is a column `mapOrderRow` does not map —
so mobile receiving pre-fills the physical count from the ORDERED quantity on a
partially-received order. Each is a `v3.0-TECH-DEBT` row, not a silent fallback.

**A rejection is not sealed — CLOSED the same day, 2026-09-05, by ADR 0125.**
The founder was offered the three paths below and chose none of them: *"research
the current approach, find flaws and bulletproof ... and build the right option
for future scalabilty and quality"*. The research found ten flaws behind this
one, of which the largest was not the missing seal: **cancelling a DELIVERED
order reversed nothing and erased everything** — the receipt event stood, the
shelf stock stayed booked, and the row left `ORDER_SPEND_STATUSES` /
`ORDER_ARRIVED_STATUSES`, taking its cost out of every spend, cashflow,
bottles-delivered, lead-time, on-time, HHI and vendor-scorecard figure in the
house. What shipped is an explicit transition table (`order-transitions.ts`)
enforced by `cancelOrder` AND `updateOrder`, a `cancel` seal act bound to the
order's total, vendor and STATE, a required reason at the ROUTE, an
`order_cancelled` audit row, the `AUTO_SEND_SCHEDULED` cascade, and the legacy
desk's three Reject controls moved onto one held, sealed die. §13.14 is closed;
four founder questions are open in ADR 0125. What follows is the account as it
stood that morning, kept rather than deleted.

**A rejection is not sealed, and the page says so, 2026-09-05.** `POST
orders/:id/approve` redeems a one-time seal minted when the hold begins
(`procurement.service.ts redeemOrderSeal`, act `"approve"`; ADR 0116 addendum).
`DELETE orders/:id` — the only route that cancels an order — redeems **nothing**:
it reads the id and an optional `reason` query parameter
(`procurement.controller.ts:261`). So the responses sheet's Reject runs the same
hold gesture over an unproven write, and prints one line saying exactly that
rather than letting the wax imply a proof (`ResponsesSheet.tsx`
`REJECT_SEAL_NOTE`). **Not fixed here, deliberately:** `seal-subject.ts` already
names `cancel` as its own act, so the mechanism exists — but making the seal
REQUIRED would refuse the legacy desk's only Reject control
(`pages/Orders.tsx handleReject`, three live call sites, and the legacy desk is
what production shows with the flag off), and an OPTIONAL seal is decoration.
Which of the three (seal it and teach the legacy desk; a separate sealed
`POST orders/:id/reject`; leave it recorded-not-proven) is the founder's call —
filed as §13.14.

**`services/api/orders.ts::cancelOrder` posted to a route that does not exist —
FIXED 2026-09-05.** It sent `POST /procurement/orders/:id/cancel` with the reason
in a body. The gateway declares `@Delete("orders/:id")` with `@Query("reason")`
and no POST `cancel` route at all (`openapi.json`:
`/api/v1/procurement/orders/{id}` is `get, patch, delete`; the only `cancel`
path is `cancel-scheduled-send`). Every call through `useCancelOrder` was a 404
and every reason typed went nowhere — while the SERVICE has always recorded one
(`cancelOrder` → `updateOrder` writes `procurement_orders.rejection_reason`), so
only the caller was wrong. Now a DELETE with the reason as a query parameter,
with the gateway's sentence promoted onto `.message` the way `approveOrder` does
it. `useCancelOrder` had no reachable caller before this pass, which is why a
404 on every call went unnoticed.

**The confirmation mail states the order's own unit, 2026-09-04 — ADR 0119
phase 0 (the mail half).** `confirmDeal` used to mail the vendor
*"N bottles … at $X per bottle"* for every order, while `procurement_orders.quantity`
is a count in the order's `unit_type` and no price column names a unit at all —
so a five-case order of a twelve-pack told the vendor **five bottles** for a
sixty-bottle delivery and quoted a case price as a bottle price. The sentence is
now built by `describeConfirmedOrderTerms`
(`apps/api-gateway/src/procurement/procurement.service.ts:186-216`, used at
`:5005`): the quantity in the order's own unit word, the price as
`per <unit_type>`, the pack named only when `resolveOrderMatchUnits` resolved
one — *"5 cases (12 bottles each) … at $120.00 per case"* — and where it did
not, the mail says the pack is not on record and asks, rather than assuming one
bottle per unit. Pinned in
`apps/api-gateway/src/procurement/confirm-deal-states-its-unit.spec.ts` (11
cases: case/known pack, case/unknown pack, bottle, keg, each also run against
the pre-fix builder).

**The agreed price now states its unit, 2026-09-04 — ADR 0119 phase 1 (CLOSES
the paragraph above).** The founder's call was *"ship the columns and the
/orders field together"*, so the schema half and the desk half landed as one
build: `supabase/migrations/20260905010000_an_agreed_price_states_its_unit.sql`
gives `procurement_order_items` a `price_uom`/`price_pack_size` pair with three
CHECKs and no backfill; `apps/api-gateway/src/procurement/agreed-price.ts` is
the pure resolver; `createOrder` refuses a half-stated pair before writing
anything; `recordOwnPaperSighting` is handed the PRICE's pair instead of the
quantity's, so a case-priced agreement enters `vendor_price_observations` for
the first time; and `pages/orders/next/AgreementSheet.tsx` is the control that
states it. 42 jest + 14 vitest assertions, pre-fix behaviours transcribed from
`git show HEAD:` copies at `129fbfc6`.

**What is STILL open on this axis, each with a why-not-yet:**

- **This page's LEDGER rows still show a bare price.** `GET /procurement/orders`
  returns the header via `mapOrderRow`, and no price column on
  `procurement_orders` names a unit — the pair lives on the LINE. *Why not yet:*
  printing it needs the list endpoint to join `procurement_order_items`, which
  is a gateway read-shape change on a route four surfaces share, and this
  dispatch was scoped to the columns and the field. §13.10.
- ~~**`procurement_orders.final_price` is an echo by COMMENT, not by
  construction**~~ **CLOSED 2026-09-05 (ADR 0119 Q2).** It is an echo by
  CONSTRUCTION now: `20260905072000_the_header_price_echoes_the_line.sql`
  maintains it from the line and refuses a direct write that disagrees, with
  `23514` naming both numbers. `confirmDeal` and `InboundResponder.syncOrderState`
  write the LINE; either falls back to the header only when the order has no
  line, and says so. Postgres cannot express this as `GENERATED` — a generation
  expression may not read another table, and the column is `NOT NULL` on a row
  that exists before its line — which was measured rather than assumed and is
  recorded in the migration's header.
- ~~**`price_history.unit` is still the hardcoded `'BOTTLE'`**~~ **CLOSED
  2026-09-05 (ADR 0119 Q4).** The column is `NOT NULL` with no default and the
  seven-word CHECK; a case price enters as a case price and a keg price enters
  at all for the first time. The reversal that matters: an agreement stating NO
  unit used to enter the series anyway as `'BOTTLE'`, and is now refused in a
  sentence — the same refusal the register already made about the same event.
  **The obligation this moves:** any future reader of `price_history` must
  GROUP BY `unit` first; measured on this tree there is no reader yet, and the
  column comment carries the rule for the first one.
- **The invoice line's own `allowance`/`deposit` reach no comparison at the
  door** (ADR 0119 Q3 residue). `procurement_document_lines.allowance` and
  `.deposit` are written by the parser and read by nothing in `verifyReceipt`;
  only a caller-supplied `allocatedCharges` scalar reaches `computeMatch`. The
  AGREEMENT's side of that comparison now exists and is named in the verdict's
  notes, so a billed deposit no longer reads as a price variance — but the two
  sides are not yet compared to each other. `06-pages/receiving.md` §13 owns it.
- **The legacy desk cannot state a price unit.** `pages/Orders.tsx` offers
  `case | bottle`, sends no `bottlesPerUnit` — so `resolveOrderUnits` already
  refuses every case order it attempts — and sends no price unit at all.
  `mudavym_design_orders` is OFF in production, so the legacy desk is what a
  house sees today. *Why not yet:* the legacy page is explicitly out of this
  wave's scope and changing it unasked would edit a surface nobody reviewed.

**The awaiting state, added 2026-09-04 — ADR 0116.** Until now
`POST /procurement/orders/:id/approve` read neither a role nor an amount, so
anyone who could reach it could seal any figure, and this page rendered
`HoldToApprove` on every pending row. It now enforces the house's thresholds
(`/settings` `?tab=thresholds`). What this page does about it:

- **The ceremony is DISABLED, never hidden**, for a row the signed-in person's
  role cannot seal, with the rule, the number and who may sign printed beneath
  it. A control that disappears teaches nothing; a control that is visibly shut
  with the reason beside it teaches who to ask. The column label becomes
  *"Waiting on an owner"*.
- **The refusal is printed verbatim.** `services/api/orders.ts` promotes the
  403 body onto `error.message` — an axios error otherwise carries only
  "Request failed with status code 403" there, and all four call sites read
  `.message`. A 403 prints as itself; anything else keeps the old *"The gateway
  refused (…)"* framing, because a dropped connection is not an explanation.
- **A gate that has not answered leaves the ceremony ARMED.** An unread gate is
  not a permissive one and not a restrictive one; the page renders as it did
  before and lets the gateway decide. A gate that FAILED says so in words.
- **Rules that could not be tested are stated**, separately from rules that did
  not fire — "we could not tell whether this was a first order" is a different
  outcome from "it was not".
- **The bulk bar prints the distinct reasons**, not just a count: "3 refused"
  reads as a bug, and a bulk run over one house usually hits the same rule.

Pinned in `pages/orders/next/ApprovalGate.test.tsx` (9 cases). The gateway side
is `procurement/order-approval-gate.spec.ts` (21 cases) — the page is a
courtesy, the gateway is the gate, and both are tested as such.

**The legacy desk too.** `pages/Orders.tsx:549,3346` post to the same route
through `apiClient` directly rather than through `services/api/orders.ts`, so
they do not get that module's message promotion. Both used to
`alert('Failed to approve order')` on any failure — which would have replaced a
written explanation with a shrug. They now call `approvalRefusalText`
(`Orders.tsx:525`), which reads `response.data.message` on a 403 and keeps the
generic line for anything else.

- `v3.0-TECH-DEBT.md:495` — UX-catalog claim that `ActiveConversationsPanel` is
  unreachable is **stale**; `Orders.tsx:1512` sets its open state.
- The delivered-order booking path posts to `/inventory/add-from-order` with raw
  axios instead of `apiClient` (`Orders.tsx:684`) — skips the client's auth/refresh
  interceptors; works only because a token header is attached manually.
- 3,614 lines in one file; the co-located `pages/orders/` split is partial.

**The seal is redeemed, not asserted — added 2026-09-04 (ADR 0116 addendum).**
The gate above answers *may this role seal this figure*; it had no way to answer
*did a person do this*, because the hold lived entirely in the browser. Anything
holding a manager's session could seal an order by calling the endpoint. Now:

- `POST /procurement/orders/:id/seal-challenge` mints the proof when the hold
  BEGINS (`services/api/orders.ts:mintOrderSeal`, wired through
  `HoldToApprove`'s `onChallenge` in `LedgerRow.tsx` and `BulkApproveBar.tsx`);
  the approval carries it in `X-Seal-Challenge` and it is spent exactly once.
- The order's own total is hashed into the seal, so one minted at 2,000 cannot
  be spent after the order became 20,000.
- A mint that fails or returns null approves NOTHING and says so on the control
  ("The seal could not be issued — nothing sent."). That is the one failure the
  whole mechanism exists to prevent, and it must not arrive through the UI.

**CLOSED 2026-09-04 — the legacy sites hold too.** The founder chose the hold
gesture for both remaining call sites rather than a one-click mint-and-approve.
`components/orders/SealedApproveDie.tsx` is the one control they share: it mints
one seal per order when the gesture begins, approves nothing if any mint fails,
prints a 403 as itself and keeps the generic wrapper only for a failure that
carries no decision. `pages/Orders.tsx` now contains no `/approve` POST of its
own; `hooks/useOrdersData.ts` takes a challenge and exposes the mint.

Three things the note above said, corrected by measurement (2026-09-04):

- **Not "via `hooks/useOrdersData.ts`".** That hook has **no consumers** —
  `grep -rn useOrdersData apps packages` finds its definition and the barrel
  re-export at `hooks/index.ts:9`, nothing else. The legacy page posted through
  `apiClient` directly.
- **The legacy page did not "get refused"; it never asked.** The only REACHABLE
  approve control was the bulk bar's `handleBulkApprove`, and it called no
  endpoint at all — it rewrote local state to `approved` and alerted "N
  order(s) approved!". The two paths that did POST were unreachable: nothing in
  the repo set `showApprovalModal` or `showOrderApprovalModal` to true. All
  three are sealed now; the reachable one is the only behaviour change a house
  will see.
- **`finalPrice` was read by nothing.** `POST orders/:id/approve` takes no
  body (`procurement.controller.ts` `approveOrder`: id + `X-Seal-Challenge`).
  The modal's price input is disabled with one line saying so.

**The ground, measured rather than inferred.** A grep said `Orders.tsx` carries
zero `dark:` classes, which suggested the page was permanently light and the
control's own light fallbacks would always be right. In the running app the die's
inline styles were injected into the live page and the computed colours read
back: under `html.dark` the legacy page IS charcoal (`styles/globals.css:163-177`
repaints `.dark .bg-white → #1D1813`) while an unwrapped die stayed `#F3EFE6`.
So the control carries `mudavym` on its own root — tokens scoped to the control,
never `:root`. Captures and the probe JSON:
`$SP/shots-legacy-hold/{orders-legacy,orders-legacy-charcoal,dashboard-next,dashboard-next-charcoal}.png`
and `ground-probe*.json`.

**Still open here.** No live redemption has ever been exercised: the tenant the
local dev-bypass session reaches has zero orders (`GET /procurement/orders` →
`total: 0`) and the local gateway points at production, so nothing may be
approved from here. Both routes answer a non-existent id with the gate's 404
sentence; the seal's own refusal sentences remain proven only by the specs.

## 10. Maturity

**partial.** The procurement lifecycle genuinely persists end to end; one write posts to
a route that does not exist, and the insights rail is unauthenticated.

| Evidence | `path:line` |
|---|---|
| **Delivery books stock properly.** `markDelivered` releases shadow and receives live through two idempotent `apply_stock_movement` RPCs plus an `inventory_events` row keyed `order-delivered:{orderId}`. Real ledger writes, replay-safe. | `procurement.service.ts:903-1038` |
| **`POST /inventory/add-from-order` does not exist.** The delivered-order handler fires it with raw `axios`, then swallows the failure: `.catch(err => console.log('Inventory API endpoint not ready yet: …'))`. A repo-wide grep finds **one** occurrence of the string — this call site. It has always 404'd. | call `pages/Orders.tsx:686-696`; the inventory controller's full route list `inventory.controller.ts:35-429` contains no such route |
| The above is *harmless but dishonest*: the stock movement it appears to perform is already done server-side by `/deliver`. The code, its comment ("Also try API call for persistence") and its optimistic UI all imply otherwise. | `Orders.tsx:660-684` |
| **Silent skip inside `markDelivered`.** If the inventory row has no `master_wine_id`, no stock movement runs — but the `inventory_events` `order_delivered` row is still inserted and the API returns success. A delivery of an unmapped wine reports as booked and moves nothing. | `procurement.service.ts:974,1026-1038` (the `if (masterWineId)` guard sits inside, the event insert outside) |
| **Draft-email layer is real and server-guarded.** Every draft route carries `JwtAuthGuard`; guardrails, commitment-pattern checks and a 2-minute undo window live in `InboundResponderService`, not the client. | `procurement.controller.ts:279-635`; `common/orchestrator/inbound-responder.service.ts:129-146,30` |
| **The insights rail 401s** — `ContextualInsights` uses raw `fetch` with no `Authorization` against the analytics controller, which is class-guarded since #31; the JWT strategy accepts a bearer header only. Fails into `catch { /* fail quiet */ }`. | `components/insights/ContextualInsights.tsx:118,121,176`; `analytics.controller.ts:51`; `auth/strategies/jwt.strategy.ts:11` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/procurement/orders` | JWT (class) | `procurement.controller.ts:65` → `procurement.service.ts:454` | `{ orders, total, page, limit, hasMore }` — client unwraps `.orders` (`services/api/orders.ts:56`) |
| POST `/procurement/orders` | JWT | `:36` | created PO; reserves shadow stock (`procurement.service.ts:855`) |
| PATCH · DELETE `/procurement/orders/:id` | JWT | `:151`, `:174` | updated / cancelled; cancel also kills the linked calendar delivery event (`:689-699`) |
| POST `…/:id/approve` | JWT | `:197` | approved; publishes a conversation intent to RabbitMQ (`:880-897`) |
| POST `…/:id/deliver` | JWT | `:218` → `:903` | delivered + two ledger movements |
| POST `…/:id/verify-receipt` | JWT | `:244` | match verdict; opens `procurement_credits` claims (`:1104-1130`) |
| GET/PATCH `…/:id/draft`, POST `…/approve-draft`, `…/generate-ai-reply`, `…/manual-reply`, `…/discard-draft`, `…/ai-pause`, `…/cancel-scheduled-send` | JWT (per-route) | `:279-556,605` | draft lifecycle |
| GET `…/:id/conversations`, `…/attachments`, `…/deal-proposal`; POST `…/confirm-deal`, `…/dismiss-deal` | JWT | `:427-604` | thread + deal state |
| POST `/inventory/add-from-order` | raw axios, token attached by hand | **no controller — 404** | nothing |
| GET `/providers` | JWT via `apiClient` | `providers.controller.ts:215` | roster for the create-order picker |
| `/analytics/insights/:rid`, `…/recommendations/:rid/action(s)` | **JWT required, none sent** → 401 | `analytics.controller.ts:243,654,757` | nothing (§10) |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| The orders themselves | manual entry on this page; recurring-order generator | `Orders.tsx:966`; `procurement/recurring-orders.service.ts:225,271` (`@Cron` 08:00 and 06:00) |
| Vendor replies + AI drafts | Postmark inbound → RabbitMQ bridge → `InboundResponderService` (Claude Haiku 4.5) | `common/orchestrator/rabbitmq-bridge.service.ts`; `inbound-responder.service.ts:24,129` |
| Attachments on a thread | bridge persists bytes to Storage (`persistAttachments`, best-effort) | `rabbitmq-bridge.service.ts:781-788` |
| Deal proposals | commercial-terms parser over the same inbound lane | `common/orchestrator/commercial-terms.ts` |
| Auto-send undo queue | `AUTO_SEND_UNDO_MS` staging + ProcurementService cron | `inbound-responder.service.ts:30` |
| Delivered-order stock | this page's `/deliver` call → ledger | `procurement.service.ts:989-1011` |

All four producers exist and run. No orphan data on this page.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Create PO | `procurement_orders` + shadow reservation | [[inventory]] shadow column, dashboard pending count, Sidebar badge (`Sidebar.tsx:409`) |
| Approve | status + RabbitMQ conversation intent | the vendor-email agent starts a thread |
| Deliver | two ledger movements + `inventory_events` | [[inventory]] live stock, dashboard "revenue" (see [[dashboard]] §10) |
| Approve draft / manual reply | `procurement_conversations`, outbound mail | vendor thread, `sender_reputation` |
| Cancel | status + calendar event deletion | [[calendar]] |

## 12. Design intent

**Should be:** one place where a PO is drafted, approved, chased and closed — and where
the AI's proposed vendor reply is a one-tap yes, never an autonomous send.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags throughout |
| empty | ✅ | `OrderGuardModal` catches "no vendors yet" and routes to [[providers]] (§0) — a genuinely good empty state |
| error | ⚠️ partial | order mutations toast failures; the `add-from-order` call and the insights rail both fail silently |
| permission-denied | ❌ | no client-side role split; approval authority is server-side only |

**Where the UI misleads**

1. **The delivered-order flow claims a persistence step it never performs** (§10) — and
   the swallow comment says "not ready yet", which has been true since it was written.
2. **Unmapped wines deliver successfully and move no stock** (§10) — no warning surfaces
   to the user; the skip is a server log line.
3. **Contextual insights render empty rather than "signed out"** — a 401 and a quiet
   restaurant look the same.

## 13. Roadmap

### Motions and overlays — the rows this pass owes (2026-09-06)

From the decisions in §1c. Owner packets: **packet 3** the motion pass, **packet 4** the
states owed, **packet 5** the gestures; a *page pass* is this page's own next opening.
The reasoning is in §1c and in [ADR 0133](../decisions/0133-one-motion-per-act-across-every-page.md);
these are the rows.

1. `pages/orders/next/ResponsesSheet.tsx:353` and `pages/orders/next/LedgerRow.tsx` — reject loses the wax **and** the hold; the reason becomes a required field. **packet 3**
2. `components/mudavym/HoldToApprove.tsx` — the consequence-scaled press on approve, on the dashboard's terms. **packet 5**
3. `.planning/sketches/102-modal-census/BUILD-PROMPT.md` rule 3 says "Bulk gets a plain button" and the shipped bulk bar is a dry emboss — amend the rule to name it as the plural rendering of the wax. *census owner*
4. `census.py` — "Vendor answers" draws a `hold` and carries `seal: false`; the flag and the drawing must agree, because a guard reads the flag. *census owner*

1. **Delete the `add-from-order` call** (`Orders.tsx:686`) — or, if a separate booking
   step is genuinely wanted, build the endpoint. Leaving a permanently-404ing write with
   a "not ready yet" catch is exactly the pattern `v3.0-TECH-DEBT.md` §44.2 names.
2. **Surface the unmapped-wine skip.** `markDelivered` should return a flag when
   `master_wine_id` is null so the page can say "delivered, but stock not booked — this
   wine is not mapped". *Blocker: none.*
3. **Move `ContextualInsights` to `apiClient`** — same fix as [[inventory]] §13.1, fixes
   both pages at once.
4. Split `Orders.tsx` (3,614 lines) further into `pages/orders/`; the split started and
   stopped.
5. Rebrand the 4 "Sent via WineOps AI" disclaimer strings (§7) — user-visible, in
   outbound mail, so this one leaves the building.
6. Add a role gate for approval controls so staff do not see buttons the server will
   reject.

10. ~~**Print the unit beside the price on the LEDGER row.**~~ **DONE 2026-09-05**
    (ADR 0119 phase 2, `5432fb47`) — the list route joins the line and the row prints
    the unit and its working. The original text is kept below as the record of the
    blocker, not as a description of today. The composer states it;
    the rows still show a bare number, because `GET /procurement/orders` returns the
    header (`mapOrderRow`) and the pair lives on `procurement_order_items`. Needs the
    list endpoint to join the line and `OrderResponseDto` to carry
    `priceUom`/`pricePackSize`; `useOrdersNextData.toRow` and `LedgerRow`'s "working"
    block then read it. *Blocker: none — a gateway read-shape change on a route four
    surfaces share, deliberately not made in the dispatch that built the columns.*
11. **Decide ADR 0119 Q2 and, if it goes that way, make `final_price` GENERATED.**
    It is documented as an echo of the line and is still independently written by
    `confirmDeal`. *Blocker: founder — ADR 0119 Q2.*
12. **Teach the legacy desk the pair, or retire it.** `pages/Orders.tsx` is what
    production shows and it cannot place a case order at all (`unitType: 'case'` with
    no `bottlesPerUnit` is refused by `resolveOrderUnits`), let alone state a price
    unit. *Blocker: none technically; it is out of the Mudavym wave's scope by
    instruction.*

13. **The two legacy approval modals: purpose, what recreated them, what was deleted
    / what remains.** Both were unreachable — nothing in the repo set their open flag.
    *The inline "Approve Order" modal* (`showApprovalModal`) let a person confirm one
    order from the list and type a "Final Price per Bottle"; its last setter was removed
    in `7012cc7a` (2026-05-15), which re-pointed that click at the draft panel. Every act
    it offered exists on the rebuilt page — the approval is
    `pages/orders/next/LedgerRow.tsx:282` (`HoldToApprove`), and the price field wrote
    nothing at all (`approveOrder` reads the id and `X-Seal-Challenge` only). **Deleted
    2026-09-05** (render, `showApprovalModal` state, the `selectedOrder`/`setSelectedOrder`
    destructure it alone used, and its test case, replaced by an absence assertion in
    `pages/__tests__/OrdersLegacySeal.test.ts`).
    *`OrderApprovalModal`* (`showOrderApprovalModal`,
    `components/orders/OrderApprovalModal.tsx`) showed one vendor response — wine, vendor,
    quantity, agreed price, delivery estimate, the AI negotiation summary — and offered
    Confirm / Cancel / Edit order / Ask for more, plus Next-Previous across several
    vendors' responses to the same order. Its last setter went in `6778690b` (2026-07-05),
    which re-pointed the row "Approve" button at the comms drawer. **It REMAINS**, sealed
    and unreachable, because three of its acts are not on the rebuilt page: cancelling or
    rejecting an order (a real `DELETE /procurement/orders/:id`; on the legacy page it
    survives as "Reject", `Orders.tsx:567`), stepping through several vendors' responses
    to one order, and reading the AI negotiation summary (the rebuilt `DraftRail` shows
    the raw thread, not the rolling summary). Its Edit-order and Ask-for-more buttons
    wrote nothing (an `alert` and a `setTimeout` that fabricated a follow-up), so they are
    not acts to recreate. *Rework candidates for the founder: reject-an-order on the
    rebuilt page; the several-responses-per-order comparison; the negotiation summary.*
    **CLOSED 2026-09-05.** The founder's call was *"rebuild all three on the rebuilt
    /orders as a responses sheet"*, and that is
    `pages/orders/next/ResponsesSheet.tsx` (+ `responses.ts`, its pure half): one house
    `Sheet` per order, one section per inbound answer, keyboard stepping, the sealed
    confirm, and a reject that requires a reason in words. `OrderApprovalModal.tsx` is
    **DELETED** — with its import, its render, `showOrderApprovalModal`,
    `orderApprovalData`, `allProviderResponses`, `currentApprovalIndex`, the
    `OrderApprovalData` interface, and the `sealTarget` hand-over overlay, whose only two
    setters were that modal's Confirm handler. `pages/__tests__/OrdersLegacySeal.test.ts`
    asserts the absence of the FILE and of every reference to it (4 cases; 2 of them fail
    against a `git show HEAD:` copy of `Orders.tsx`). The gateway's four
    `OrderApprovalModal summary section visibility` cases went with it: they asserted
    that an absent summary HID the section, which is the rule the sheet deliberately
    reverses.
    *Measured while doing it:* the modal could not have been reached even in principle —
    `setAllProviderResponses` and `setOrderApprovalData` were called only from inside its
    own handlers, so `orderApprovalData` was permanently null and its render guard
    permanently false.

14. ~~**Decide how a rejection is proven.**~~ **DONE 2026-09-05, ADR 0125.** The founder
    took none of the three paths offered — (a) seal the DELETE, (b) a separate sealed
    route, (c) leave it recorded — and asked for the research first. What was built is
    (a) plus the thing the three options all missed: an explicit **order transition
    table** consulted by every gateway door that writes a status, so a cancellation of an
    order whose wine has arrived is refused outright rather than merely proven. The
    legacy desk's Reject holds through `SealedRejectDie`, the reason is required at the
    route, and the act is recorded in `system_audit_log`. **Four founder questions remain
    open in ADR 0125:** whether a cancellation should be role-gated like an approval; what
    to do about the Python orchestrator's two direct terminal writes (a database trigger
    is the strongest answer and the most work); whether a vendor's rejection should return
    an order to NEGOTIATING rather than kill it (Dynamics 365 keeps such a PO "In external
    review"); and whether bulk rejection should return as a real ceremony.
    **Three of the four were answered and built the same day** (ADR 0125's addendum):
    a cancellation is now a manager's or an owner's act through
    `assertCanManageRestaurant` on both the mint and the write, with the legacy control
    disabled and the reason said; the table is enforced as a `BEFORE UPDATE OF status`
    trigger generated from the TypeScript and held to it by a spec and
    `scripts/check_order_transition_sql.py`; and a vendor's decline returns the order to
    NEGOTIATING with the inbound conversation row as the record. **Only bulk rejection
    is still the founder's call.**

17. **A vendor's decline no longer closes the order** (2026-09-05, ADR 0125 Q3). The
    responses sheet marks a declined answer and says the order is still open. What is NOT
    built, and is the next thing somebody will want: a way to act on it from there — re-price
    and re-send to the same vendor, or send the same request to another. Today the manager
    reads the decline in the sheet and starts again from the composer.
    *Blocker: none — it is new work, not a defect.*

15. **Say on the LEDGER ROW which orders have an answer.** The row offers "The vendor's
    answers" unconditionally, because nothing on the page knows which orders have one:
    `GET /procurement/orders` returns the header and says nothing about correspondence,
    and `GET /procurement/conversations/history` is capped at 100 rows, so hiding the
    control on that basis would be a "no answer" claim the page cannot make. Needs either
    an inbound count on the list route or an uncapped per-house index.
    *Blocker: none — a gateway read-shape change on a route four surfaces share, the same
    blocker §13.10 named.*

16. ~~**The shared `Order` type declares keys the route does not send.**~~ **DONE
    2026-09-05** (founder: *"fix the shared type and audit every consumer now"*).
    Nine phantom keys removed, fourteen real ones added, twenty-three consumer files audited in
    the table at the end of this file, and `scripts/check_web_reads_gateway_dto_keys.py`
    added so the two files cannot drift apart again. Left open: `CreateOrderRequest` /
    `UpdateOrderRequest` are REQUEST types with the same disease (`wineId`, `unitPrice`
    against `CreateOrderDto`'s `inventoryId`) and zero live callers — filed in
    `v3.0-TECH-DEBT.md` rather than fixed, because the create DTO was being extended by
    a concurrent pass while this ran.

17. ~~**Nothing stops the first reader of `price_history` from averaging a case price
    with a bottle price.**~~ **DONE 2026-09-05** (founder decided ADR 0119 Q4:
    *`price_history` carries a stated unit; kegs and cases enter with their own unit;
    every comparison groups by unit first*, and asked for the guard now rather than at
    the first reader). The write half is the migration
    `20260905072500_the_price_series_states_its_unit.sql` — `unit` NOT NULL, the seven
    singulars as a CHECK, the `DEFAULT 'BOTTLE'` dropped — and `recordPriceHistory`
    (`procurement.service.ts`) states it. No constraint can enforce the read half, so
    `scripts/check_price_history_reads_group_by_unit.py` does: a supabase chain on
    `price_history` that selects, or raw SQL selecting from it, must filter on `unit`,
    `GROUP BY unit`, or aggregate keyed by `unit` in the code that follows; writes are
    ignored; an aggregation whose key the parse cannot follow is exit 2, never a pass.
    Landed at zero cost — measured on this tree, `price_history` has one writer and
    **zero readers** (the orchestrator's `_get_price_history` reads
    `procurement_orders.price_per_bottle`, another table). Proved FAIL against a copy of
    the tree carrying a planted unit-less read and PASS on the tree itself; wired into
    `ci.yml` beside `check_read_columns_exist` with a 16-case pytest in `scripts-tests`.

18. ~~**An order can be delivered twice.**~~ **DONE 2026-09-05** (founder: *"harden it in
    the procurement service for every caller"*). `markDelivered` refuses a second
    delivery in words, before any write, for every caller, with the same rule as the
    UPDATE's own WHERE clause so a race loses at the database. §9 carries what a second
    delivery actually did, measured. Pinned by
    `apps/api-gateway/src/procurement/tests/delivered-once.spec.ts` (14 cases; 8 of them
    fail against a `git show HEAD:` copy of the service) and
    `apps/web/src/services/api/orders.deliverOnce.test.ts`.
    **Left open, and it is a founder's call, not a defect:**
    - ~~**Two statuses for one fact.**~~ **ANSWERED 2026-09-05 (founder, batch 46):
      409 everywhere; 400 rejected.** *"The request is well-formed, the order's state
      conflicts with it, and the door and the one-tap rail must be able to tell 'already
      done' from 'you sent nonsense' and show the earlier delivery instead of an error."*
      The one-tap mint and execute now throw the same `409 { reason, orderId,
      orderNumber, status, deliveredAt, message, earlierDelivery }` as the deliver route,
      and every surface that can reach it renders "delivered on <date> by <person>" from
      that body and never retries — the Action Center, `OneTapPanel`, `LedgerRow`, the
      legacy desk's alert and the mobile outbox's failed-entry line (which now reads
      "already done", not "didn't go through"). One parser per app
      (`services/api/orders.ts` `alreadyDeliveredRefusal`, `api/delivered-once.ts` on
      mobile), so four screens cannot each render `undefined` as a person's name.
    - **`markDelivered` still does not enforce the whole transition table.** It asks
      only "have the goods arrived", deliberately: `ORDER_TRANSITIONS` forbids
      `PENDING → DELIVERED`, which the deliver route does today for real orders that
      were never formally approved, and permits `DELIVERED → DELIVERED`, which is the
      one move this pass exists to stop. Making delivery a full `assertStatusTransition`
      call would refuse work the house does and permit the thing it must not.
    - **A CANCELLED order can still be delivered.** `ORDER_TRANSITIONS` treats CANCELLED
      as terminal, so the table would refuse it; this guard does not, because
      cancel-then-deliver was explicitly left to its own decision by ADR 0073 and is a
      different question (goods that arrive against a cancelled order are a real event
      somebody has to be able to record).

### An agreed price has no unit — research 2026-09-04, phase 1 BUILT 2026-09-04, phase 2 BUILT 2026-09-05, CLOSED (ADR 0119)

The founder asked for the full graph behind ADR 0117's Q6 (*"a case-priced agreement has
no unit to state its price in"*). The research is
[[0119-an-agreed-price-states-its-unit]]; this page is where it lands, because `/orders`
is the surface that both creates the ambiguity and hides it. The research built nothing;
**phase 0 and phase 1 have since been built** — see §1b "Third pass, 2026-09-04" and the
§9 paragraph above for what landed and what is still open.

**What this page showed BEFORE phase 1 — kept as the record of the defect, not as a
description of today.** Measured at `HEAD` = `e8a7d6f5`; the first three bullets are
FIXED (the fourth's `logger.warn` still stands in the GATEWAY, but the row now prints the
refusal in words — phase 2, 2026-09-05):

- `procurement_orders` holds four price columns — `quoted_price`, `negotiated_price`,
  `final_price`, `invoice_unit_price` (`20260805000000_baseline_from_production.sql:4523-4525,
  :4559`) — and **not one of them names a unit**, while the row beside them states the
  unit of its *quantity* (`unit_type`, `:4521`). The invoice line one table over states
  both (`uom :4387`, `pack_size :4388`, `unit_price :4391`, plus `allowance :4393` and
  `deposit :4394` for the money that sits outside the unit price).
- The per-bottle reading is enforced by arithmetic, not by the schema:
  `totalCost = finalPrice × bottlesTotal` (`procurement.service.ts:469`) and
  `line_total = finalPrice × units.bottlesTotal` (`:819-821`) — the latter written onto a
  row whose column is called `final_unit_price` and whose `unit_type` may say `case`
  (`:842-843`). A person reading that row reads a case price; the code means a bottle
  price.
- **It leaves the building.** `confirmDeal` emails the vendor
  `` `${quantity} bottles of ${wineName}` `` (`:4810`) with `` ` at $X per bottle` ``
  (`:4804-4806`), where `quantity` is the order's count *in the order's own unit*
  (`:4701`). On an order of 5 cases of 12 that sentence says *"5 bottles"* for 60
  bottles, and asserts a price unit nothing has checked.
- Because of that, the price register refuses every case-priced agreement:
  `packSize: bottlesPerConfirmedUnit === 1 ? 1 : null` (`:4778`) into
  `decideOwnPaperSighting`'s pack-size refusal (`own-paper-sighting.ts:235-246`). **The
  refusal is a gateway `logger.warn` (`:1097`) — this page never says it happened.** A
  house that buys only by the case gets a permanently empty `quote` tier and no screen
  anywhere explains why. That is absence reported as health, one layer up from the
  register.

**Where the research came out.** Six options mapped; the recommendation is that the
agreed *price* carries its own `(uom, pack)` pair on `procurement_order_items`, exactly
as the *quantity* already does — the shape xtraCHEF, Restaurant365, Odoo and NetSuite all
converge on, and the shape the house already shipped for public postings the same day
(`price_index_postings.price_unit NOT NULL`,
`20260904200000_a_posted_price_names_its_state.sql:96`). The tempting no-migration option
— derive the bottle price from the case price and the pack — was killed on evidence, not
taste: Connecticut *defines* the posted bottle price as case ÷ pack **plus 2–8¢ by
bottle size** (<https://www.cga.ct.gov/2004/rpt/2004-R-0593.htm>), split-case fees break
linearity in the warehouse, and back-deriving pack size at this exact table is the
documented cause of the receiving door's pack-size defect
(`procurement.service.ts:1259-1268`).

**What this page owed, and what it now owes.** The three items below were written
while ADR 0119 was research. Two are DONE:

7. ~~**Print the unit beside the price.**~~ **DONE 2026-09-05 (phase 2).**
   `GET /procurement/orders` now joins the line's `(price_uom, price_pack_size)` in the
   SAME query (a PostgREST embed through `procurement_order_items_order_id_fkey`, not an
   N+1), `OrderResponseDto` carries them as `priceUom` / `pricePackSize`, and the ledger
   row prints "$420.00 per case (12 bottles)" with the working drawn from that unit
   (`pages/orders/next/LedgerRow.tsx`, `useOrdersNextData.ts` `toRow`,
   `agreed-price.ts` `foldOrderPriceUnit`; `LedgerUnit.test.tsx`, 9 cases).

   **Three DTO values, not two.** A stated unit; JSON `null` for "the line was read and
   states none"; and the KEYS ABSENT for "this route does not read the line". Only the
   list route (and `/orders/history`, the same method) carries them. Reading absence as
   "unstated" would be absence-reported-as-health, so the page keeps the third state and
   prints a different sentence for it.

   **Two defects found while building it, both fixed here.** (a) `toRow` read
   `o.unitPrice` / `o.totalPrice` — names the list route has NEVER sent; the DTO's are
   `finalPrice` / `totalCost`. Every live row therefore rendered an em dash in the money
   column, the working line AND the seal's label ("Hold to approve · —"). Measured on
   HEAD before the fix; see `$SP/p4ag-prefix-proof.txt`. (b) The first build of this
   change totalled an UNSTATED price on "the old per-bottle convention" and printed
   `60 × $420.00 = $25,200.00` in bold beside the ledger's own $2,100.00 — the
   twelve-times error this ADR exists to end, reprinted by the screen built to end it.
   Caught in the first capture. An unstated unit now yields NO working of the page's own
   and says why.
8. ~~**Say the refusal out loud.**~~ **DONE 2026-09-04.** The composer prints the
   register's own refusal before the save, so an agreement with no stated price unit
   is never saved unknowingly (`pages/orders/next/price-unit.ts`
   `UNSTATED_PRICE_UNIT_REFUSAL`, mirroring
   `apps/api-gateway/src/procurement/agreed-price.ts::unstatedPriceUnitSentence`).
   Said on an EXISTING row too since 2026-09-05 (`ROW_UNSTATED_PRICE_UNIT`), which
   closes the other half.
9. ~~**Fix the confirmation email.**~~ **DONE** — phase 0 (`f7ae750e`), and phase 1
   taught the same sentence to state the price's own unit when the line carries one.

**No longer "deliberately not proposed."** This section used to end: *"A unit control on
the order form. Until the founder rules on ADR 0119 Q1–Q2 … adding a picker would let
the desk state a unit the schema cannot store."* The founder ruled on Q1 on 2026-09-04
by refusing the fork's framing — *ship the columns and the field together* — so the
picker and the columns landed in one build and the objection never applied. ~~**Q2 is
still unanswered**~~ **Q2, Q3, Q4 and Q6 were all decided on 2026-09-05 and built the
same day (§13.14). Q7 alone remains open.**

### The money outside the price, and the header that could disagree — BUILT 2026-09-05 (ADR 0119 Q2/Q3/Q4/Q6), §13.14

The founder's four decisions, and what each one is on THIS page:

10. **The composer asks for the money outside the price of the wine.** Allowance off,
    deposit and freight on, each a positive amount for the whole line, each with its own
    column (`20260905073000_the_agreement_names_the_money_outside_the_price.sql`). The
    total prints the whole arithmetic, goods first, and the ledger row prints the same
    sentence. NULL and 0 stay different facts from the field to the column: an empty
    field sends no key, a typed 0 travels.
11. **The header price follows the line, enforced by the database.** Two triggers
    (`20260905072000_the_header_price_echoes_the_line.sql`), not a `GENERATED` column —
    Postgres cannot generate from another table, measured, and `final_price` is `NOT
    NULL` on a row inserted before its line exists. `confirmDeal` writes the line.
12. **`split_case` became a rule.** The line IS the broken case, priced as its own trade
    item; the pack field holds the bottles actually in the broken pack. There is no
    split-case fee field and there will not be one.
13. **The ledger row prints the fees inside the working, and on their own line only when
    there is no working to hold them** — an agreement whose price unit is unstated shows
    no arithmetic at all, and without that line its deposit would be invisible on the
    row a manager approves money from. Both defects that made this true were found by
    CAPTURING the row, not by reading it (`$SP/shots-price-unit-2/`): the first build
    printed the total twice, and the fees twice.

### The shared `Order` type said nine things the route does not send — FIXED 2026-09-05, §13.16

Founder, 2026-09-05: *"Fix the shared type and audit every consumer now."* ADR 0119
phase 2 had fixed `toRow` on this page and filed the rest: *"the shared `Order` type
still declares the two never-sent keys for every other consumer."* Measured, it was
**nine**, not two.

`apps/web/src/services/api/types.ts` `Order` declared `unitPrice`, `totalPrice`,
`wineId`, `providerName`, `wineProducer`, `notes`, `createdAt`, `updatedAt` and
`recurrence`. `OrderResponseDto`
(`apps/api-gateway/src/procurement/dto/procurement.dto.ts:699`) declares none of them,
and `mapOrderRow` (`procurement.service.ts:4119`) writes every key it sends by hand, so
the DTO is the whole wire. It goes the other way too: the DTO sent fourteen keys the
shared type never named — `unitType`, `bottlesTotal`, `quotedPrice`, `negotiatedPrice`,
`finalPrice`, `totalCost`, `completedAt`, `isEmergency`, `priorityLevel` and ADR 0119's
`priceUom` / `pricePackSize` among them — which is why three separate files carried a
widening cast to get at fields the server had been sending all along.

**Nothing about this failed loudly.** `formatMoney(undefined)` returns the string
`"$0"`. `a ?? b * c` with both absent is `NaN`. `x || q * (y || 0)` is `0`.
`typeof x === 'number'` is false, and the clause it guards disappears. All four
type-checked. The first two print a confident wrong number on screens a person
approves money from.

`Order` is now **exactly** `OrderResponseDto`'s key set, optional where the DTO is
optional, and `scripts/check_web_reads_gateway_dto_keys.py` fails CI on the next drift
(wired in `ci.yml` beside `check_read_columns_exist`; the mapping table is written out
by hand, because `Order` / `ProcurementOrder` / `OrderResponseDto` share no name and a
guard that paired by name would have found nothing and exited 0).

#### The consumer audit — every reader of `Order` or of the orders routes

"Printed" is the value each expression yields for one route row — the object
`mapOrderRow` emits for a five-cases-of-twelve agreement (`finalPrice: 420`,
`totalCost: 2100`, `quantity: 60`, `status: "APPROVED"`), run through each site's own
expression: `$SP/p4an-prefix-reads.mjs`, output in `$SP/p4an-prefix-reads.txt`. "Prints
now" is the same row through the same sites on the fixed tree
(`$SP/p4an-postfix-reads.mjs` / `.txt`), including a second row with no money on it so
the refusals are measured too, not asserted. Neither is
an HTTP capture — `GET /procurement/orders` and `/orders/history` both answer
**500, `column procurement_order_items_1.price_uom does not exist`** on this worktree,
because ADR 0119 phase 1's migration is unmerged and the local gateway reads
PRODUCTION; and the dev-bypass tenant has zero pending orders and zero conversations.

| File | Keys it read | Printed | Prints now |
|---|---|---|---|
| `dashboard/next/WaitingOnYou.tsx` | `totalPrice`, `unitPrice`, `providerName`, `createdAt` | `$0` in the money column, `60 × $0`, and **`Hold to approve · $0` on the seal itself** | `money(totalCost)` / `money(finalPrice)`, em dash when absent; the die reads `Hold to approve · $2,000`, or bare `Hold to approve` with no total (`approveLabel`). **2026-09-05, batch 40:** the row also names the vendor — `/orders/pending` joins `providers` — so the panel a manager approves money from says who is being paid; an unnamed one prints `Vendor not named`, never a blank |
| `dashboard/next/DayDetail.tsx` | `unitPrice`, `totalPrice`, `providerName` | `60 × $0 · $0`, and the literal word "vendor" on every delivery | `60 case × $420 · $2,100`; ~~the vendor clause is gone — the route sends `providerId` only~~ **the vendor clause is back and real (batch 40): `/orders/history` joins `providers`, and `vendorLine` prints `Vendor not named` where the join answered nothing** |
| `hooks/useOrdersMetrics.ts` | `unitPrice`, `totalPrice`, `wineId`, `providerName`, `createdAt` (+ snake aliases, all absent) | `0` and `0`, so **every spend figure on /reports and the dashboard was summed from zeroes**: `totalOrderValue`, `spendThisMonth`, `spendLastMonth`, month-over-month, spend-by-wine, spend-by-provider and the 30-day chart | `finalPrice` / `totalCost`, `null` when absent; `sumKnown` skips nulls, `unpricedOrders` counts them, and the average divides by the PRICED orders |
| `pages/Reports.tsx` | `StoredOrder.totalPrice` ×2 | `day.spend += 0` on every day; every wine's value `0` | guarded — an unpriced order adds nothing and does not read as a zero day |
| `pages/Dashboard.tsx` | `wineId` ×2, `wineProducer` ×2, `totalPrice`, `providerName` | top-wines `spend` always `0`; the group-by key fell through to the wine name; "Unknown provider" on every row | `inventoryId`, `totalCost`; the producer and vendor clauses are gone |
| `pages/dashboard/useDashboardPage.ts` | `wineId`, `wineProducer`, `providerName`, `totalPrice` | reminder subtitle `$0`, "Unknown provider" | `totalCost` or `no total on this order`; ~~`vendor not named by this route`~~ **the vendor's name, through `vendorLine` (batch 40)** |
| `components/notifications/OneTapActionCenter.tsx` | `totalPrice` ×2, `unitPrice` ×2, `providerName`, `createdAt`, `wineId`, **and `o.status === 'approved'`** | `$0` invoice price, `$0` negotiated — and `cost: 0` **dispatched onto the inventory-update event**, a zero WRITTEN not merely shown. The status compare was `false` for every order ever fetched (the wire is SCREAMING_SNAKE), so the branch produced no cards at all | `totalCost`, else `finalPrice × quantity` only when both are present, else `null` and the words `no total on this order`; the compare goes through `canonicalStatus`, the repo's one wire-to-UI mapper. **Batch 40:** the fetch was widened to CONFIRMED **and IN_TRANSIT** and the filter now names exactly those two, so the delivery card has a reachable input for the first time; the supplier line prints `providerName` |
| `components/providers/EditProviderModal.tsx` | `totalPrice`, `unitPrice`, `createdAt` | **`$NaN`** on every row of a provider's recent orders (`undefined ?? undefined * n`) | `totalCost` or `no total`; `requestedAt` or `no date` |
| `pages/receipts/next/ReceiptsNext.tsx` | `totalPrice` (through a cast), `providerName` | the `· ordered $X` clause **silently vanished** although the route carried the figure; the vendor clause never rendered | `totalCost` reads `· ordered $2,100.00`; ~~the vendor clause is gone~~ **the vendor clause is back (batch 40) — `vendorClause` appends the name and stays silent when there is none, because a running sentence has no slot to leave empty** |
| `pages/receiving/next/DoorModel.ts` | `providerName` (+ a cast for `unitType`/`bottlesTotal`) | the credit-note draft addressed "To the vendor" **without naming them**, on every order the door has ever opened | ~~`providerName: null`, said out loud~~ **the letter is ADDRESSED (batch 40): `getOrder` joins `providers` and the draft opens `To Vinifera Imports:`, or `To the vendor (not named on this order):` when the join answered nothing.** The cast is gone — the shared type now carries `unitType`/`bottlesTotal`. The two `DoorModel.test.ts` cases that pinned the ABSENCE now pin the name, and three more pin the unnamed sentence |
| `pages/orders/next/useOrdersNextData.ts` | `providerName`, `wineProducer`, `recurrence`, `notes`, `createdAt` (the price pair was fixed in `5432fb47`) | the vendor was already resolved from `providerId`, so that `??` never fired; producer and notes never rendered; **`recurring` was always false, so this page's RECURRING STATION has always been empty** and every order fell into "one-time" | reads none of them; `recurring` is a stated `false` about the route, not about the order. The local `OrderWire` intersection lost six keys to the shared type |
| `pages/orders/next/useOrdersNextData.ts` — **recurrence, 2026-09-05** | — | the `recurring = false` above is retired | reads `recurrenceFrequency`/`…AnchorDay`/`…NextDueOn`/`…Status`/`…ParentOrderId`/`…OccurrenceOn` through `readRecurrence` with the KEY test, so absent and null stay apart; `recurring` is a measured fact and `recurrenceReadCount` is what licenses the station to say "none". `scripts/check_web_reads_gateway_dto_keys.py` pins all six |
| `pages/Orders.tsx`, `pages/orders/useOrdersPage.ts` (legacy desk) | `providerName` | dead branch — `provider_name` fell through to `providerId`, which is the desk's own deliberate convention (`providerNameById` resolves a uuid at `useOrdersPage.ts:120`) | the dead branch is gone; the convention is named in a comment |
| `hooks/queries/useOrderQueries.ts`, `hooks/useOrdersData.ts`, `hooks/useDashboardData.ts`, `pages/calendar/next/useCalendarNextData.ts`, `pages/dashboard/next/useDashboardNextData.ts`, `services/api/orders.ts` | none — they carry `Order[]` and read no price key | nothing to print | unchanged |
| `apps/mobile` `components/supply/OrderRow.tsx`, `app/(tabs)/supply/[id].tsx` | `totalCost ?? finalPrice ?? negotiatedPrice ?? quotedPrice` | **`$2,100` — correct all along.** Mobile has read the DTO's own names since it was written | unchanged |
| `apps/mobile/app/(tabs)/cellar/receive/[orderId].tsx` | `quantityReceived` | `quantity_received` is a COLUMN, not a wire key: `mapOrderRow` does not map it, so the physical count pre-filled from the ORDERED quantity on every partially-received order | ~~reads `quantity` and says why; the gateway fix is a `v3.0-TECH-DEBT` row~~ **the gateway sends it (batch 40), WITH its unit.** The screen pre-fills from `quantityReceived` only when `quantityReceivedUom` is stated and is this order's — it counts in the order's unit — and otherwise falls back to `quantity` and prints the reason under the count |
| `apps/mobile/src/api/types.ts` `ProcurementOrder` | — | carried `[key: string]: any`, so `order.totalPrice` would have compiled there exactly as it did on the web | the index signature is gone; the guard refuses one, because a type that declares everything cannot be checked against anything |

**Three of the four gateway-shape gaps this audit filed are now closed (2026-09-05,
batch 40).** The founder decided items 1 and 3 of `v3.0-TECH-DEBT`'s "The orders wire"
and the one-tap fetch the same day: the orders routes join `providers` and the DTO
carries `providerName`; `quantityReceived` travels with `quantityReceivedUom`; the
Action Center fetches CONFIRMED and IN_TRANSIT. Items 2 (recurrence) and 4 (the write
side) are untouched and still open. The "Prints now" column above is amended in place
per row rather than rewritten, so the pre-fix measurement stays readable.

**What could NOT be captured live, and why.** No HTTP capture of `providerName` exists.
`GET /procurement/orders` and `/orders/history` still answer **500,
`column procurement_order_items_1.price_uom does not exist`** on this worktree — ADR
0119 phase 1's migration is unmerged and the local gateway reads PRODUCTION — and the
dev-bypass tenant measures **0 pending orders** (`GET /procurement/orders/pending` →
`[]`, `/orders/pending/count` → `{"count":0}`, both read-only, 2026-09-05). The one
thing that WAS measured live is the widened fetch: the browser now issues
`?status=CONFIRMED` and `?status=IN_TRANSIT` side by side on every poll of
`/dashboard` (Browser-pane network log, same date), where before it issued only the
first. The rest is proved by the render tests.

**Two things the guard still cannot see, said out loud.** A widening cast
(`raw as Order & { … }`) puts a key back beyond its reach — one such intersection is
live in `useOrdersNextData.ts`, added by a concurrent pass, and its own comment says it
is a no-op to delete now that the shared type has settled. And the guard compares key
EXISTENCE, not type: `status` was declared as the lowercase `OrderStatus` while the wire
sends `ProcurementOrderStatus` in SCREAMING_SNAKE. That one is fixed here — `Order.status`
is now `OrderWireStatus` — but the guard would not have caught it.

### A recorded price now names its own money (2026-09-05, ADR 0117 Q25)

Two writers on this page's path changed, and one of them changed BEHAVIOUR
rather than only shape.

`recordPriceHistory` (`procurement.service.ts`) takes a required `currencyClaim`
and writes `price_history.currency` explicitly — the column was added by
`20260905120000_a_house_names_its_money.sql`, nullable and with no default. A
confirmed order records `null`, because measured 2026-09-05 **neither
`procurement_orders` nor `procurement_order_items` has a currency column**, so
nothing on an agreement states one; the refusal is a logged sentence naming the
missing column, and the note goes on the row. That is Q31.

`verifyReceipt`'s DTO gains `invoiceCurrency` (ISO 4217 alpha-3, optional). The
receiving screen does **not** send it yet, so a verified receipt today records
its currency as NOT RECORDED — the document header already holds the real code
(`procurement_documents.currency`, and production carries two live `TRY` rows
against a house whose own row says `USD`). That is Q32, and it is one field on
the form or one read of the linked document.

**The behaviour change:** `own-paper-sighting.ts` used to read
`(input.currency ?? "USD")` and neither caller passed a currency, so every
class-A sighting was about to be stamped USD on no evidence. It is a refusal now,
with the same sentence the class-D sweep already used — *"A number without its
currency is not a price"*. `vendor_price_observations.currency` is NOT NULL, so
refuse and invent are the only two options that table allows. Until a caller
states a currency, **no class-A sighting is written at all**. The register holds
0 rows today and always has, so nothing existing was lost — but a confirmed order
that would have written a USD-stamped sighting now writes none, and says why.

### The agreement line names its money (2026-09-05, ADR 0117 Q31)

Founder, the same afternoon: *"A currency column on the agreement line,
defaulted from the vendor's terms or the house, stated on the sheet"*.

`procurement_order_items.currency` — nullable, no default, ISO 4217 CHECK
(`20260905200000_the_agreement_names_its_money.sql`). It denominates **all seven**
money columns on that line: the three prices, the line total, and the allowance,
deposit and freight that `20260905073000` added while saying they were "in the
agreement's currency" that nothing stated.

**The sheet asks, with the evidence.** `AgreementSheet` shows a currency field
whose default comes from `GET /procurement/agreement-currency` — the same chain
the writer uses, so the default a person confirms is the default the row would
have taken. The chain reads: what this vendor last billed this house in
(`procurement_documents.currency`, ordered by the document's own date), then
`restaurants.currency`, then nothing. The sentence under the field is the
gateway's, and it names the rung: *"Defaulted to TRY: that is what Anadolu Şarap
last billed this house in."* A person can check that; nobody can check "we
suggest TRY".

**One correction to the founder's sentence, measured rather than assumed:**
`restaurant_vendor_terms` has seven columns and none of them is a currency, so
"the vendor's terms" had no field to read. Whether a typed one should exist is
ADR 0117 Q34.

**What this restores.** ADR 0117 Q25 made an unstated currency a refusal in the
price register, which was right and which meant **no class-A sighting was written
for any confirmed order at all**. With the column, a line whose desk stated a
currency writes one again — proved in `price-currency.spec.ts`, which asserts the
sighting appears with `TRY` on it and still does not appear when the desk stated
nothing.
