---
type: page
route: /inventory
slug: inventory
softwares: [inventory-command]
component: apps/web/src/pages/inventory/command/InventoryCommandPage.tsx
audience: staff
tier: core
archetype: command # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-09-03
links: ["[[PAGE-CONTRACT]]", "[[orders]]"]
---

# /inventory — Inventory Command

> **Part of** [[08-softwares/inventory-command|Inventory Command]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Row menu / row expansion: Draft PO** → [[orders]] `/orders?draft=new&inventoryId=…&qty=…`
- **Row expansion: View ledger** → `/documents?ledger=…` (no such route exists — broken destination)
- **Receiving verification / Spot count / Cellar map** → (workspaces and views on this page)

## 1. Purpose

"Inventory Command — production port of sketch 038. 3a live/shadow spine: 9-column
table, row-expand detail, attention rail, cellar map view, receiving verification,
adjustable locations" (`InventoryCommandPage.tsx:1-5`). The working stock page for
staff and managers: live vs shadow stock, spot counts, receiving verification as a
pinned task (not a popup), menu-scan intake, and per-branch views.

## 1a. Features
[changed 2026-10-01, R4 P3 (INV-W20–W27): on InventoryNext the row's five sheets (order, count, transfer, write off, pour) use the house sheet format. Order more places a PENDING order and then shows the AI's email to the vendor inline, to read, edit and approve-and-send with one hold (`OrderLetter.tsx`). The count field opens blank. Transfer says when a house has no zones. Filters can be cleared at any time. The legacy page below is unchanged.]
- 9-column live stock table; expand a row for detail: live vs shadow stock, par/reorder bar, velocity, busy-hours heatmap, order history, manual entry (🚧 market-price columns render "—" until price enrichment exists)
- **Item activity names both directions (fixed 2026-09-06, V6).** The row's velocity series carries `out` AND `in`: a delivery booked at the door, a POS void/return, a positive manual adjustment. Before this it was depletion-only, so a shelf that had just gained ten bottles rendered identically to one nothing had touched. The payload's `includes` block states what was counted, and a failed ledger read is a 500, never an empty chart.
- **Carry this bottle · an auction lot — the FOURTH START** (built 2026-09-06, packet 2
  of the overlay layer; census 102 · fork F4, the founder's ruling 2026-09-05).
  `pages/inventory/command/AuctionLotStart.tsx`, offered beside *Single wine*,
  *Menu scan* and *Receive a delivery*.
  - **The legacy modal could never have worked.** `components/orders/AuctionPurchaseModal.tsx:133`
    is unreachable (`feature-flag-registry.ts:308` says so), and it posts to
    `POST /wines/research` and `POST /wines/auction-purchase` — **neither route exists
    in this gateway** (measured 2026-09-06: zero matches outside that file). It also
    used raw `axios`, so it carried no token. This is the act built, not migrated.
  - **A bottle from an auction is still a bottle entering the book.** It is chosen
    from the register and enters through the same `POST /inventory`
    (`useCreateInventoryItem`) the carry sheet uses — one path into the book, not two.
  - **What the auction adds is a cost with its working shown**:
    `(hammer + premium) ÷ bottles = cost per bottle`, printed as a sentence, written
    as `costPerBottle` with provenance `manual` — the honest one of the four
    `inventory_lots_cost_provenance_check` allows, because a person typed the hammer.
  - **An unstated premium is refused, never read as zero.** "There was no premium" and
    "nobody typed the premium" are different facts, and only the first can produce a
    cost.
  - **The lot's own details are saved (2026-09-21, founder answer 2)** — auction
    house, lot number, sale date, hammer price and buyer's premium WITH an
    ISO-4217 currency, never inferred. Written to `auction_lot_records`, linked
    to the `restaurant_inventory` row the carry produced (ADR 0083's review
    trail). See §9. *The census's own footer claimed "the ledger keeps both"
    back on 2026-09-06, when it did not; it does now.*
  - **[2026-09-21, founder answers 10 and 11; ADR 0083 second addendum.]** A lot in
    another currency asks for the rate the person used and lets them type each
    bottle's cost in the house's currency; a typed cost wins, both are recorded, and
    the stock is carried at that booked cost (nothing looked up). A house whose own
    currency is unstated or unreadable cannot book a lot until it is. The lot number
    is optional; the auction house and the sale date are not. The item's card shows
    what was booked and "lot number not stated" when there is none.
  - Proved by `AuctionLot.test.tsx` and `auctionLotCost.test.ts`.
- Attention rail surfacing low stock first
- Spot counts with an offline-safe outbox (counts queue and sync when back online)
- Receiving verification as a pinned task, not a popup — verify a delivery against its documents
- **Provisional cost is a first-class state (ADR 0103 A1, built 2026-09-06).** A lot booked at the door before its invoice was agreed reads `cost_state = provisional`: it is pourable and it is not a settled cost. A delivery stuck in RECONCILING is therefore on the shelf and absent from cost figures — which is the behaviour A1 asks for, not a gap.
- Cellar map view of storage zones
- Scan a menu/wine list photo to add wines
- Add and remove wines; manage storage locations
- Switch branches and see another branch's stock
- Contextual insights rail (analytics engine)
- **Receipts & invoices depth in the dropdown, behind `mudavym_design_inventory` (OFF)** — the founder's named gap (MAKEOVER: KEEP the dropdowns, deepen receipt/invoice actions): for the wine's recent orders, every attached invoice / delivery receipt / packing slip with total, tie-out state and review status, E49-honest (null tie-out = dash, never a pass), linking into `/receipts`
- **The house header, behind the same flag (OFF)** — `/inventory` is enrolled in `PageGate` (2026-09-04) with the SAME command page on both branches, purely so the page gets the chrome every other rebuilt page has: mark, page name, ⌘K "Search or act", house/branch switcher, bell, theme menu, account menu. No redesign, and no style change inside the page (measured — §1b)

- A house may name a bottle the library does not have; the item carries that **provisional** identity until Mudavym curates it, and promotion re-points the item (ADR 0124 Q3)
- The house names its own bottles: one editable display name per item (`wine_name`), used everywhere the house sees it; the library row is never written from here, and BOTH names stay searchable (ADR 0124, the naming rule)
## 1b. Motions used — Mudavym addition (flag `mudavym_design_inventory`)

> **Chrome (2026-09-04).** With the flag on, this page is framed by the house
> header — `apps/web/src/components/mudavym/HouseHeader.tsx`, mounted by
> `PageGate` above every `next` tree: the A+M mark, this page's name, the ⌘K
> "Search or act" trigger, the house (or the branch switcher when there is more
> than one), the bell, the theme menu and the account menu. Chrome is excluded
> from §Surface by PAGE-CONTRACT, so it is named here and nowhere else in this
> note; its motions live in `components/mudavym/MOTIONS.md`, not the table
> below.
>
> **Enrolment, 2026-09-04 (founder's call).** The paragraph above was written
> while `/inventory` was still routed OUTSIDE any gate
> (`App.tsx:303`, `element={<InventoryCommandPage />}`), so no header actually
> mounted here: the gate is the only thing that mounts `HouseHeader`
> (`components/mudavym/PageGate.tsx`), and the one page the house runs on all
> day was the last surface with no bell, no account menu and no theme switch.
> The route is now
> `<PageGate page="inventory" legacy={<InventoryCommandPage />} next={<InventoryCommandPage />} />`
> — the SAME component on both branches. This is not a redesign: the flag's
> only effect on this route is the chrome.
>
> **What the flag does NOT do, measured 2026-09-04.** `PageGate` renders `next`
> as-is with no wrapper, so the command page gains no `.mudavym` scope and no
> ancestor of it changes. Measured rather than assumed: the route was loaded
> twice in one browser (override `0`, then `1`) and the FULL computed style of
> every element in the page's subtree diffed, keyed by a structural path that
> re-indexes past the header so the two runs line up
> (`$SP/measure-inventory-styles.mjs`). 1,939 elements compared, **zero**
> property differences inside the page. The only four differences in the whole
> tree are on the shell's own `<main>` — `height` 4113.25px → 4166.25px and the
> two origins that track it — i.e. the header's 53px of occupied flow, which is
> the point of adding it. Consistent with the source: every top-level selector
> in `house-header.css` and `sheet.css` is scoped to `.mdv-*`/`.mudavym`, so
> the stylesheets the header imports cannot reach the page's Tailwind
> utilities. No token-driven component inside the command page changes.
>
> The header's ground on this route is always **paper** unless the app's own
> dark theme is on: `readShellGroundFromDom` (`lib/mudavym/shellGround.ts:135`)
> returns `charcoal` only when a `.mudavym[data-ground="charcoal"]` node is in
> the document, and the command page declares none. Captures:
> `$SP/shots-inventory-header/inventory.png` (paper) and
> `inventory-charcoal.png` (the app's dark theme, where `.dark .mudavym` turns
> the bar).
>
> One real behavioural change beyond the bar, named honestly: while a `next`
> tree is mounted the gate claims a slot in `lib/mudavym/shellGround`, and the
> nine shared shell overlays (command palette, scrim, Ask AI bar, …) render
> their house shape rather than their legacy one. That is by design
> (PageGate's header comment) and is now reachable from `/inventory` with the
> flag on.

Deliberately none. This is a card added inside the KEPT page (the founder's
verdict kept `/inventory` as it is — the addition is styled native to the
page's own grey-card idiom, not the `.mudavym` tokens, and the İznik re-skin
arrives with the page redesigns, not here). Recording zero motions is the
motion map for this flag (ADR 0044 §2).

### Design used, and why (ADR 0045 §5 wave · MAKEOVER-VERDICTS: KEEP + named gap)

The dropdown the founder praised is untouched; the gap he named — "more
detail for the receipt and invoice actions… where inventory meets /receipts,
differentiated work, not a generic expander" — lands as the ReceiptDepth
card: real paperwork per wine (via the item's recent orders →
`documentsApi.forOrder`), each row carrying type, number, date, total,
tie-out and review status. Known limitation, recorded: rows are doc-level;
the per-item invoice LINE (this wine's qty × price inside the document) needs
an order-line join the web API does not expose yet — filed in §9 rather than
faked with description matching. Flag off = byte-identical page.

### Overlays, 2026-09-05 (sketch 102 · ADR 0112)

<!-- sketch-102-overlays -->
Generated by `.planning/sketches/102-modal-census/build.py --docs` from `census.py` — edit the census, not this table.
The rule: an object gets a sheet, a question a panel, a choice a popover; the seal never sits in a popover.

**`/inventory`** — The one page whose flag turns on nothing new: legacy and next are the same component (App.tsx:311), so its eight fixed-inset modals are live inside a house-flagged page today. Seven migrate; one retires to /receipts.

| Page | Overlay | Shape | Status | Where the act lives or went | Source |
|---|---|---|---|---|---|
| `/inventory` | Carry this bottle | sheet | Migrate | One bottle entering the book is one object; three ways to start, one sheet. | `components/inventory/AddWineToInventoryModal.tsx:253 (opened at InventoryCommandPage.tsx:1438)` |
| `/inventory` | Carry this bottle · an auction lot | sheet | Built · fork F4 | The same sheet, a fourth start: an auction bottle is still one bottle entering the book. BUILT 2026-09-06 (packet 2): the bottle is chosen from the register and enters through the SAME POST /inventory the carry sheet uses; (hammer + premium) / bottles becomes costPerBottle with provenance `manual`, the working is printed, and the sheet says in words that the lot's own details are NOT saved (ADR 0083). An UNSTATED premium is refused rather than read as zero. | `BUILT 2026-09-06 as pages/inventory/command/AuctionLotStart.tsx (was components/orders/AuctionPurchaseModal.tsx:133 — unreachable AND pointing at two routes that do not exist)` |
| `/inventory` | Place 14 bottles by their zones? | panel | Migrate | A question about a batch. Bulk, so no wax — the plain die. | `components/inventory/AutoLocatePreviewModal.tsx:70` |
| `/inventory` | A delivery without an order | sheet · wide | Migrate · fork F3 | Lines read as a table; 640 like the composer. Decided 2026-09-05 (F3): a sheet here, not a route. | `components/inventory/ManualReceiptWorkspace.tsx:234` |
| `/inventory` | POS buttons and stock | sheet | Migrate | One queue, worked line by line, the register still visible beneath. | `components/inventory/PosMappingPanel.tsx:294` |
| `/inventory` | Write off 6 bottles? | panel · seal | Migrate | A ledger write is a real commitment — wax. | `components/inventory/RemoveFromInventoryModal.tsx:121` |
| `/inventory` | The zones | sheet | Migrate | The zones are one object the house owns. | `components/inventory/StorageLocationManager.tsx:327` |
| `/inventory` | Spot count | sheet · seal | Migrate | Opened from the row expander; one bottle's count is one record. | `pages/inventory/command/SpotCountPanel.tsx:210 (opened from RowExpansion.tsx:384)` |
| `/inventory` | Receipt record | — | Retires | /receipts is the receipts desk (ReceiptsNext). /inventory links there and never overlays it. | `pages/inventory/command/ReceivingWorkspace.tsx:376` |

| `iv-auction-tuck` | The auction start opens | *An auction lot* on the add-wine chooser — the house `Sheet` on `tuck`, 300ms. It adds no motion of its own and `prefers-reduced-motion` renders none |
Drawn in sketch 102 (`.planning/sketches/102-modal-census/index.html`); the policy is [[0112-one-modal-policy-three-shapes-one-primitive]].

## 2. Entry

In-degree 2 ([PAGE_MAP](../foundation/PAGE_MAP.md):143): from `/` and `/get-started`.
Sidebar "Inventory" with low-stock badge (`components/layout/Sidebar.tsx:67,411`).
Eagerly loaded (`apps/web/src/App.tsx:72`).

## 3. Files

- Route binding: `apps/web/src/App.tsx:255`.
- Tree: `pages/inventory/command/{InventoryCommandPage.tsx, bits.tsx, RowExpansion.tsx, SpotCountPanel.tsx, ReceivingWorkspace.tsx (+test), CellarMapView.tsx}` and `pages/inventory/{index.tsx, useInventoryPage.ts}`.
- Rendered components: `components/inventory/{AddWineToInventoryModal, StorageLocationManager, AutoLocatePreviewModal, RemoveFromInventoryModal, ManualReceiptWorkspace, MultiLocationCell}.tsx`, `components/scanner/MenuScannerFlow.tsx`, `components/wines/AddWineSelectionModal.tsx`, `components/insights/ContextualInsights.tsx` (InventoryCommandPage.tsx:14-26).
- Offline plumbing: `lib/spotCountOutbox.ts`, `lib/menuScannerPersistence.ts`.
- Auto-Locate engine: `lib/autoLocateEngine.ts` (`InventoryCommandPage.tsx:20`); its
  `WineInput` already extends this page's `InventoryItem`.
- Inherited from the retired `/inventory-legacy` (2026-08-26): Auto-Locate,
  `MultiLocationCell`, by-the-glass pour, active/inactive toggle, and the realtime
  inventory subscription.

## 4. Endpoints

Atlas rows: [ENDPOINTS](../foundation/ENDPOINTS.md):249 (`inventory`, 18), :236
(`inventory-ledger`), :552 (`storage-locations`), :378 (`procurement/documents`),
:389 (`procurement`), :10 (`analytics` — atlas's ⚠ is stale; guarded at class level
since 2026-08-24 (#31), `apps/api-gateway/src/analytics/analytics.controller.ts:51`).

| Method | Path | Call site |
|---|---|---|
| GET | `/inventory/:rid` (+ `/summary`, `/low-stock`) | `useInventoryData` → `services/api/inventory.ts:66,118,129`; per-branch `InventoryCommandPage.tsx:382` |
| POST | `/inventory/:rid/items` (create) | `useCreateInventoryItem` → `services/api/inventory.ts:80` |
| POST | `/inventory/:rid/items/bulk` | `services/api/inventory.ts:104` (ManualReceiptWorkspace path) |
| POST | `/inventory/:rid/item/:itemId/count` | spot count via outbox — `lib/spotCountOutbox.ts:17` → `services/api/inventory.ts:249` |
| GET | `/procurement/orders?status=delivered|partially_received` | `InventoryCommandPage.tsx:131,136` → `services/api/orders.ts:53` |
| GET | `/procurement/documents?orderId=` | `ReceivingWorkspace.tsx:187` → `services/api/documents.ts:71` |
| GET/POST | `/storage-locations/:rid` (+ mappings, wines-at-location) | `hooks/useStorageLocations.ts:70,88,122,453`; Auto-Locate bulk-writes mappings via `assignWineToLocation` (`InventoryCommandPage.tsx` `handleConfirmAutoLocate`) |
| POST | `/inventory/:rid/item/:itemId/transfer` | source-selected move — `RowExpansion.tsx` `doTransfer` → `services/api/inventory.ts:transferStock` |
| POST | `/inventory/:rid/item/:itemId/pour` | `RowExpansion.tsx` `pour` → `services/api/inventory.ts:193` (`recordPour`, client idempotency key) |
| PATCH | `/inventory/:rid/item/:itemId` (`isActive`) | row context menu `toggleActive` → `hooks/useInventoryData.ts:47` |
| POST | orchestrator `/api/v1/scan/{menu,wine,fuzzy-match,wine-research}` | `services/wineDetection.ts:342-457` via MenuScannerFlow (`VITE_AGENT_ORCHESTRATOR_URL`, wineDetection.ts:17) |
| GET/POST | `/analytics/insights/:rid`, `/analytics/recommendations/:rid/action(s)` | `components/insights/ContextualInsights.tsx:118-192` |
| GET | `/pos-hub/unresolved/:rid` | attention chip + panel — `services/api/posHub.ts` `getUnresolvedLines` → `PosMappingPanel.tsx` |
| GET/POST | `/pos-hub/catalog-match/:rid/proposals[/approve]`, `/pos-hub/mappings/:rid[/sale-unit]` | `PosMappingPanel.tsx` — confirm a button's wine and its sale size together (#307) |

## 5. Signals

**None emitted.** The tree is instrumentation-*ready* — `data-ux-key` markers exist
(`ReceivingWorkspace.tsx:126,625,633`) — but the reporter that would read them ships
dark (`lib/uxSignals.ts:15`) and its hook has zero importers. Nothing reaches a server.

## 6. Tier cut

**Core** — operate. Scenario surface: S02 (receiving verification workspace), S04
(live depletion display), S10 (low-stock attention rail), S11 (waste/adjust), S17
(duplicate identities enter here). All ✅-Core rows ([TIER-MAP](../03-scenarios/TIER-MAP.md):38,40,46,47,53).

## 7. Rebrand surface

**0 user-visible strings.** `ReceivingWorkspace.tsx:2` says "canonical WineOps
invoice" in a comment only; the test file title (`ReceivingWorkspace.test.tsx:90`)
never renders. Shared layout chrome applies (see dashboard.md §7).

## 8. State & config

- `VITE_AGENT_ORCHESTRATOR_URL` for menu/label scanning (`services/wineDetection.ts:17`).
- Spot counts queue in an offline outbox with client idempotency keys
  (`services/api/inventory.ts:225-252`, `lib/spotCountOutbox.ts:82-96`); page refetches
  on outbox drain (`InventoryCommandPage.tsx:101`).
- Multi-branch: `RestaurantBranchSwitcher` (InventoryCommandPage.tsx:30) fetches other
  branches' stock (:382).

## 9. Gaps
[changed 2026-10-01, R4 P3: four gaps were found that the page cannot close, queued in `p4-scratch/review-shared-queue.md`. (1) No merged flag on `POST /procurement/orders`: a merge replaces the quantity, even on an APPROVED order, and drafts no email. (2) `approveDraft` does not check the order's status. (3) A possible second draft after `approveOrder`, unverified. (4) /cellar `BottleLeaf.tsx:219` still says "Order sent to the vendor".]

- ~~**An auction lot's own details have nowhere to live**~~ **CLOSED 2026-09-21**
  (founder answer 2, "Build all now"). Found 2026-09-06 while building the fourth
  start: `inventory_lots` carried `unit_cost` and `cost_provenance` and nothing
  else about where a bottle came from, so the auction house, the lot number and
  the sale date were taken, used to work out the cost, and then dropped. Now
  written to `auction_lot_records` (`20260930150400_an_auction_lot_keeps_its_own_details.sql` [renumbered `20261101100400`, 2026-09-27] [renumbered again `20261103100400`, 2026-09-27] [renumbered once more `20261116100400`, 2026-09-27])
  — auction house, lot number, sale date, hammer price and buyer's premium WITH
  an ISO-4217 currency, never inferred — linked to the `restaurant_inventory`
  row the carry produced, and shown on the row-expand detail
  (`RowExpansion.tsx`, "Auction lots" card) whenever a wine has one. The sheet
  will not carry a lot until the auction house, lot number, sale date and
  currency are all stated, because the record holds them `NOT NULL`. NOT closed
  by this: the two dead routes the legacy `AuctionPurchaseModal.tsx` still
  calls — `POST /wines/research` and `POST /wines/auction-purchase`, which have
  never existed — and the lot's per-bottle cost landing in `unit_cost` in the
  lot's currency rather than the house's (ADR 0083 addendum, put to the
  founder).

- `v3.0-TECH-DEBT.md:357` — `INVENTORY_SOTA_PLAN.md` phases 2–3 (§6, §7) remain
  unbuilt; Phase 1 is what this page ships. Phase 0's ground-truth check "still worth
  running — against the *new* page".
- Market-price columns render "—" until price enrichment exists
  (`v3.0-TECH-DEBT.md:436-441` — plumbing complete, data absent).
- ReceiptDepth shows doc-level rows only: the per-item invoice LINE (this
  wine's qty × price inside the document) needs an order-line join the web
  API does not expose (`documentsApi.detail` has lines, but nothing maps an
  inventory item → its order_line ids). Deliberately not faked with
  description matching (§1b).

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** ~~no screen connects POS buttons to stock — the SPA calls only `pos-hub/providers` and `/status` (`services/api/posHub.ts:59,66`), so every closed check queues to `pos_unresolved_lines` until the mapping API is worked by hand (defect 1).~~ **Defect 1 closed (#307)** — this page now owns the mapping surface: `PosMappingPanel.tsx`, opened from the attention-rail chip "POS lines moving no stock — N", reading `pos-hub/unresolved`, `pos-hub/catalog-match/:rid/proposals` and `pos-hub/mappings/:rid`, and writing the identity *and* the sale size in one tap (defect 2, same PR). ~~The Add-Wine modal cannot express an unknown cost (`AddWineToInventoryModal.tsx:136,492` → `0 / 'manual'`; defect 6). Two definitions of "below par" on one page — chip `<=` 9 vs API `<` 7 (defect 7). Raising a par level through PATCH raises no alert (defect 8).~~ **Defects 6, 7 and 8 closed (#312).** A blank cost field now omits the key, so the API writes NULL rather than a `0` labelled `'manual'`. "Below par" has ONE definition, in `datasets/sim/fixtures/below-par-cases.json`, run by both `apps/api-gateway/src/common/stock-status.ts` and `apps/web/src/lib/inventoryStatus.ts` — it was three definitions, not two (`/summary`'s `criticalCount` was `stock === 0`). **Founder call, one line:** below par is now strictly `stock < par`, so a wine exactly at par is `at_par` and the chip reads 7 rather than 9 for the sim tenant; the fixture's `below_par_bands` reverses it in one edit. A par change through PATCH now evaluates low stock, lowering included. The first ~2.5 s render "0 wines, 0 bottles, $0" — byte-identical to an empty cellar — and unknown cost renders as "$0 cost basis" (absence 5, 6).

- **Lens run 2026-09-04 (Antalya, PR #314 finding 4 🔴) — FIXED by [ADR 0130](../decisions/0130-a-generic-name-stays-the-venues-own-wine.md).**
  A bulk-add draft of `"House White Wine"` — no producer, no vintage, no region —
  auto-linked at confidence **90** to another tenant's `HOUSE WHITE` (US /
  California / 2023) and the venue's own name was then **persisted over** in
  `restaurant_inventory.wine_name`, which is the column this page renders. Two
  writes, both closed: the resolver now refuses to consult the shared library for
  an identity that is not specific (a name plus a producer, or a vintage and a
  region), creating the venue's own provisional row instead; and bulk receive
  stores the draft's own label. Still open, filed in `v3.0-TECH-DEBT.md`: the 26
  rows already written keep their wrong links until a separate repair stop.

## 10. Maturity
[changed 2026-10-01, R4 P3: the order flow on InventoryNext now ends at the vendor's email rather than at "go to Orders". It is verified on the fixture harness only (17 + 21 unit tests, 14 mutations); it is not yet verified against the live composer or a real vendor.]

**partial.** The stock spine is real and the writes land in a ledger; the market
column has no producer and one embedded panel is dead. The two capability gaps that
blocked the `/inventory-legacy` retirement (Auto-Locate, source-selected transfer)
were closed 2026-08-26 and the legacy page was deleted — see [ADR 0019](../decisions/0019-p2-build-scope.md) §B-parity.

| Evidence | `path:line` |
|---|---|
| **Writes are ledger-backed, and a count is a record of its own** ([ADR 0078](../decisions/0078-a-count-is-a-record-in-its-own-right.md), 2026-09-02). Spot counts go through `record_stock_count`, which writes a `stock_counts` row **unconditionally** — carrying `expected_qty` (the lot sum, read under the row lock) and `counted_qty` — and applies a movement only as a *consequence* of a non-zero difference. Before this they went through `set_stock_absolute`, which returns NULL on a zero delta while `inventory_transactions` CHECKs `quantity_change <> 0`, so **a count that agreed wrote nothing at all** and any variance rate over the ledger was 1.0 by construction. `transaction_type=reconciliation`, `source=mobile_count` and the client key `count:{inventoryId}:{clientCountId}` are unchanged; the key now gates the count row as well as the movement. `last_counted_at` is still stamped, now inside the same transaction rather than a second round trip whose failure only warned. The actor comes from the verified JWT, not the request body. | `inventory.controller.ts:379-417`; `inventory.service.ts:404-415`; `supabase/migrations/20260902190000_a_count_is_a_record.sql:204`; outbox `lib/spotCountOutbox.ts:17,82` |
| **A generic name is the venue's own wine, and keeps its own name** ([ADR 0130](../decisions/0130-a-generic-name-stays-the-venues-own-wine.md), 2026-09-05). `match_library_wine` returns **no candidates** for a query that is not specific (`wine_identity_is_specific`), so "House White", "Ev Şarabı" and "Red — by the glass" can no longer bind one venue's stock to another's bottle; the line becomes a row carrying `master_wine_library.provisional_for_restaurant_id`, keyed on `venue:<id>\|` so two venues coexist under the existing UNIQUE index and neither is ever offered to the other. Bulk receive writes `wine_name` from the draft, not from the row it resolved to. Measured pre-fix on the schema built from all 100 migrations: confidence **90**, `producer_sim` **1** because neither side stated a producer. | `supabase/migrations/20260906010000_a_generic_name_stays_the_venues_own_wine.sql`; `wines/wine-signature.ts:290`; `wines/wine-submissions.service.ts:430`; `inventory/inventory.service.ts` (bulk `wine_name`) |
| **Offline is real**, not a spinner — counts queue and the page refetches on drain. | `lib/spotCountOutbox.ts:17,82`; `InventoryCommandPage.tsx:101` |
| **Receiving verification is the live four-way match**, and its output is what feeds [[receiving]]'s manager queue. | `ReceivingWorkspace.tsx:274` → `services/api/orders.ts:192` → `procurement.controller.ts:244` |
| **Market column has a producer that has never produced.** `marketPrice` ← `master_wine_library.retail_price_avg` (`inventory.service.ts:77`). The only writer is the Celery task `score.rescore_stale_wines`, scheduled nightly at 03:00 UTC — but `services/agent-orchestrator/railway.toml` declares **only a web service with a `/health` check**; there is no worker/beat process in any deploy config in the repo. Consistent with `v3.0-TECH-DEBT.md:432-440` ("null on all 442 rows"). | `jobs/score_tasks.py:16,277`; `jobs/celery_app.py:118-122`; `services/agent-orchestrator/railway.toml` |
| **Derived advice inherits the null.** `marketDeltaPct` returns `null` when `marketPrice` is falsy, so the "Priced X% under market" / "Cost X% above market" notes never fire — dead branches, not wrong ones (honest failure). | `bits.tsx:23-26`; `InventoryCommandPage.tsx:233,242-243` |
| **"View ledger" points at a route that does not exist.** `/documents?ledger=…` — the app has `/documents-reports`, not `/documents` (§0, and `App.tsx` has no `/documents` binding). The catch-all sends the click to `/` (`App.tsx:302`). | §0 of this note |
| **The embedded insights rail is 401ing** since the analytics guard landed. `ContextualInsights` calls the analytics API with raw `fetch` and no `Authorization` header; the controller has been `@UseGuards(JwtAuthGuard)` at class level since 2026-08-24 (#31), and the JWT strategy is bearer-header-only. It fails into `catch { /* additive panel — fail quiet */ }`. | `components/insights/ContextualInsights.tsx:104,118,121,176`; guard `analytics.controller.ts:51`; extractor `auth/strategies/jwt.strategy.ts:11` |

- **Lens run 2026-09-03 (`v3.0-TECH-DEBT.md`, POS lens; `03-scenarios/S04` §9.1):** measured with 53 items / 274 bottles on a sim tenant: the settled counts match the rows exactly; the bulk door (`POST :rid/items/bulk`, the modal's "Receive a delivery") took 50 free-text menu lines with 0 failures in 42 s; a count on a zero-stock item creates a lot at `unit_cost NULL / 'estimated'` (the honest onboarding door). What is not usable from this page: ~~connecting the POS,~~ ~~saying a cost is unknown,~~ a spirits list (every row types "Red"), or one wine at two pour sizes. **Connecting the POS is now on this page (#307):** the panel reads the unresolved queue, offers the catalog-match proposals, and writes `sale_unit`/`sale_volume_ml` with the approval — measured cause of the run's 0 depletions.

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/inventory/:rid` (+`/summary`, `/low-stock`) | JWT (class) | `inventory.controller.ts:35,105,155` | rows with `stock_live`, `shadow_stock`, `marketPrice` from the master library join (`inventory.service.ts:77`) |
| POST `/inventory/:rid/items` · `/items/bulk` | JWT | `:53`, `:76` | created item(s) |
| POST `/inventory/:rid/item/:id/count` | JWT | `:379` | `stock_counts` row via `record_stock_count`, idempotent; returns `count` (variance 0 + `transactionId: null` when the books were right) |
| POST `/inventory/:rid/item/:id/transfer` · `/pour` · `/count-photo-estimate` | JWT | `:314,345,418` | ledger writes; `transfer`/`pour` now pass the JWT actor, so `performed_by_type` is `'user'` rather than `'system'` (ADR 0078) |
| GET `/procurement/orders?status=DELIVERED\|PARTIALLY_RECEIVED` | JWT | `procurement.controller.ts:65` | verify-queue source; status is mapped to the backend enum by `toBackendStatus` (`services/api/orders.ts:25-38`) — correct here, unlike [[receiving]] |
| POST `/procurement/orders/:id/verify-receipt` | JWT | `procurement.controller.ts:244` | match verdict; opens vendor credit claims |
| GET/POST `/storage-locations/:rid` | JWT | `storage-locations` module | locations, mappings |
| POST orchestrator `/api/v1/scan/{menu,wine,fuzzy-match,wine-research}` | orchestrator | `services/wineDetection.ts:342-457` | scan proposals |
| GET/POST `/analytics/insights/:rid`, `…/recommendations/:rid/action(s)` | **JWT required, none sent** → 401 | `analytics.controller.ts:243,654,757` | nothing — see §10 |

### Fed by

| Producer | Mechanism | `path:line` |
|---|---|---|
| Live depletion | **POS webhook** — pos-hub upserts `pos_checks` and depletes via `apply_stock_movement`/`record_glass_pour` | `pos-hub/pos-hub.controller.ts:76`; `pos-hub.service.ts:321,752` |
| Receipts into live stock | `markDelivered` (shadow release + live receive, two idempotent RPCs) | `procurement.service.ts:989-1011` |
| Door-stage case counts | `POST /procurement/receiving/orders/:id/door` from [[receiving-door]] | `receiving.controller.ts:119` |
| Spot counts | manual / voice / photo on this page | `inventory.controller.ts:379` |
| Low-stock flags | `v_low_stock_items` + a 2-minute edge sweep and hourly digest | `notifications/low-stock-alerts.service.ts:85,110` |
| Market price | `score.rescore_stale_wines` Celery beat — **scheduled in code, no worker deployed** | `jobs/celery_app.py:118`; `railway.toml` |
| Insight rail | hourly `insight-scheduler` sweep — the data exists; the page cannot fetch it (§10) | `analytics/insights/insight-scheduler.service.ts:42` |

**Finding:** the Market column and everything derived from it has a producer that is
scheduled but not deployed. Live depletion has a producer only where a POS is connected;
without one, `stock_live` moves only on receipts and manual counts.

### Writes

| Write | Lands in | Downstream |
|---|---|---|
| Spot count | `stock_counts` (always) + `inventory_lots`/`inventory_transactions` (only on a non-zero difference) via `record_stock_count` | low-stock sweep, dashboard alerts, shrinkage analysis — and, for the first time, a variance rate that is not 1.0 by construction |
| Verify receipt | `procurement_orders.match_status`, `procurement_credits` | [[receiving]] manager queue + owner recovery card |
| Add / bulk-add item | `restaurant_inventory` | everything |
| Storage location + mapping | `storage_locations` | cellar map |

## 12. Design intent

**Should be:** the stock number a somm will actually trust at 7pm, plus the two jobs that
keep it true — count what drifted, verify what arrived.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query flags across the tree |
| empty | ✅ | market/count columns render "—", not `0` — the right call (`bits.tsx:23-26`) |
| error | ⚠️ partial | table paths surface errors; the insights rail swallows its 401 silently (`ContextualInsights.tsx:176`) |
| permission-denied | ❌ | one layout for staff and managers; cost is visible to both (contrast [[receiving]]'s deliberate role split) |

**Where the UI misleads**

1. **The insights rail renders as "no insights"** when it is actually unauthenticated —
   `catch {}` makes a 401 and a genuinely quiet restaurant look identical.
2. **"View ledger" is a dead control** — a plausible link to a route that does not exist.
3. The Market column's "—" is honest, but it has been "—" for every row since the
   feature shipped, which reads as a broken column rather than a pending job.

## 13. Roadmap
[changed 2026-10-01, R4 P3: the inline order email uses the composer's free text until the comms session's *Order request* template lands on its own branch. The gateway merged flag (§9) replaces the page's 2-minute merge heuristic.]

1. **Fix the insights rail's auth** — move `ContextualInsights` off raw `fetch` onto
   `apiClient` (which stamps the bearer token, `services/api/client.ts:62`). One-line
   class of fix; also un-breaks the same panel on [[orders]]. *Blocker: none.*
2. **Deploy the Celery worker + beat, or delete the Market column.** Shipping a column
   that has never had a value is the shape §44.2 warns about. *Blocker: founder decision
   on running a second orchestrator process (cost); no ADR exists either way.*
3. Repoint "View ledger" at `/documents-reports` or drop it.
4. Give the four-way match a reachable second home — today the only way into
   `ReceivingWorkspace` is this page, and [[receiving]]'s manager queue links to
   `/orders`, not here.
5. Turn on the reporter for the `data-ux-key` markers already in place
   (`ReceivingWorkspace.tsx:126,625,633`) — the instrumentation is written, the sink is not.
6. `INVENTORY_SOTA_PLAN.md` phases 2–3 (`v3.0-TECH-DEBT.md:357`). *Blocker: unbuilt plan,
   not a defect.*

### The ledger's key becomes the house item — what changes here (added 2026-09-04)

OD-113 is decided (founder, 2026-09-03): **one house item id across all
beverages.** [[0115-the-house-item-is-the-ledgers-key]] — *Proposed*, the founder
locks — makes the house item `restaurant_inventory.id`, the row this page is
built on. The row stops being a wine: `master_wine_id` becomes a nullable
attribute and the row gains `kind`, `uom`, `display_name`, `beverage_id` and
`identity_provenance`. Migration
`supabase/migrations/20260903171000_the_house_item_is_the_ledgers_key.sql` is
written and **NOT applied**; `scripts/check_house_item_invariants.py` holds the
invariants the database cannot.

**This page is the one that changes most, and one line of it is a blocker.**

1. **`inventory.service.ts:69` must be fixed before the migration lands.**
   `const wineBottleMl = row.master_wine_library?.bottle_size_ml ?? 750` is the
   first line of `mapInventoryItem`, and `glassesPerBottle` is
   `floor(effectiveBottleSizeMl / pourSizeMl)` from it. A keg carries no library
   row, so it would be published as a 750 ml bottle yielding five glasses — a
   fabricated number in the read path every inventory surface uses (ADR 0020 /
   ADR 0051). It becomes an em dash. This is why the migration is gated rather
   than merely staged, and it is item 1 of the ADR's phase 2.
2. **`database.service.ts:46`** embeds `master_wine_library(...)` as a LEFT join,
   so a non-wine row returns `master_wine_library: null` rather than
   disappearing. Measured: there are **zero** `master_wine_library!inner` embeds
   in the gateway, so no list silently drops a keg — but every consumer of that
   embedded shape has to be read before the columns arrive.
3. **The row expander gains what the cellar's could not have.** `RowExpansion.tsx`
   is the anatomy [[wines]] copied, and the two cards the cellar draws hatched —
   *Live vs shadow* and *Par and reorder* — are exactly the two this page draws
   real. Once a keg has a row they are the same arithmetic on both pages, off
   `stock_live` and `threshold_min`.
4. **The POS bridge needs no repointing.** Measured on production 2026-09-03:
   `pos_item_mappings` holds 254 rows, **239 carry an `inventory_id`** and only
   107 carry a `master_wine_id`. The bridge already keys on the house item; what
   changes is that a till line for a keg now has one to resolve *to*, instead of
   landing in `pos_unresolved_lines` (130 rows) and being invisible to this page,
   to `/reports` and to the analytics engine. ADR 0030's mapping-integrity rules
   are unaffected — the FK it rests on
   (`20260902130000_capture_pos_inventory_fks.sql:65`) points at
   `restaurant_inventory(id)` and that target does not move.
5. **Low-stock alerts need no new producer.**
   `notifications/low-stock-alerts.service.ts:683-690` reads `stock_live` and
   `threshold_min` off whatever row it is handed and keys on `inventoryId`, so a
   keg with a par is alerted the day it has a row.
6. **`INVENTORY_SOTA_PLAN.md:352`'s identity paragraph is superseded** by the ADR
   (retire-to-write; that file gets no edit). `kind` is the one axis, on the row,
   CHECK-constrained — there is no `domain`/`subsection`/`subtype` triple and no
   attribute pack, because `beverages.type_attributes` already holds
   category-specific attributes and a second copy would be two homes for one
   fact. `:134`'s `inventory_lots(master_wine_id UUID NOT NULL, …)` is superseded
   too: phase 1 drops that `NOT NULL`, because it is what makes a non-wine lot
   unwritable.

7. **A library wine this page stocks can no longer be hard-deleted** (founder,
   2026-09-04). The FK becomes `ON DELETE RESTRICT`, soft-delete
   (`master_wine_library.deleted_at`) is the only retirement path, and the refusal
   names the count rather than saying *"still referenced from table
   restaurant_inventory"*. This closes a real hole on this page's data: under
   `CASCADE`, deleting a library row took the house's `restaurant_inventory` row
   **and**, through `inventory_lots_inventory_id_fkey`'s own cascade, its lots —
   silently and irreversibly. Nothing has to change here to benefit; what does
   change is that a **retired** wine now shows up as a live item whose library row
   is soft-deleted, which invariant 7 of the guard **flags** (never fails, because
   a house pours out a retired wine over weeks) and which phase 2's producer turns
   into a notification.
8. **Nothing on this page may auto-create a house item** (founder, 2026-09-04).
   A house item comes into being only through an explicit "carry this" that states
   kind and unit together. The receiving and four-way-match paths this page owns
   must therefore leave an unmatched line **unmatched, and say so** — they may
   never mint an inventory row to make a document reconcile. That is the same rule
   `ReceiptDepth`'s §9 gap already follows by accident ("deliberately not faked
   with description matching"); it is now a decision rather than a restraint.

*Blocker on all eight: the founder locks ADR 0115. Nothing here is built.*

### Filed separately — the price register, and why receiving is the thing that fills it

**[ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)
(Proposed, 2026-09-04) — a price sighting names its source, its date and its unit.**
Independent of the eight items above and of ADR 0115: this page's receiving door is the
first and best writer the house's price register will ever have, and it is not wired to it.

Measured on production 2026-09-04: `vendor_price_observations` **0 rows**,
`price_history` **0**, `procurement_documents` **0**, `procurement_document_lines` **0**.
`price_history` *does* have a writer — `procurement.service.ts:900`, called from receipt
verification at `:2902` with the match's `effectiveUnitCost`, and from order confirmation
at `:4393` — but it writes a **different table** from the one the market box, the calendar
price mark and every register's `quote` line read. So the moment this page's four-way
match settles what a vendor actually charged, the house produces its highest-trust price
evidence (`source_type: 'invoice'`, trust tier 1) and then puts it somewhere nothing can
compare it. **Where it would write:** the same call site at
`procurement.service.ts:2902`, mirrored into `vendor_price_observations` scoped to the
restaurant — the ADR's step one, and the only step that needs no vendor, no terms, no
rate limit and no network.

Two constraints from the ADR that land on this page's work:

- **A sighting carries a unit, and the register has no food unit.** `unit_volume_ml` and
  `pack_size` are the only unit columns, and `normalizeUnitPrice`
  (`vendor-price-consensus.ts:115`) scales only by millilitres to a 750 ml reference.
  Anything this page receives by weight or by count has no comparable unit at all — which
  is the same seam ADR 0070 and OD-113 already circle, seen from the price side.
- **`price_history.unit` is hardcoded `'BOTTLE'`** and the comment at
  `procurement.service.ts:942` says why it must stay that way: a caller free to vary it
  would write a case price into a per-bottle series and no reader could tell. Any mirror
  into the sighting register inherits that constraint rather than escaping it.

Registry of every source examined, with the result of the 2026-09-04 fetch against each:
[`.planning/07-reference/price-sources.md`](../07-reference/price-sources.md). Dry-run
proof (writes nothing): `scripts/fetch_price_sightings.py`.

**Update 2026-09-04 — the public-list side (steps 2–3) is now built, as its own
register.** The item above is class A (this page's own paper) and is unchanged. Separately,
`price_index_postings` (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`)
and the gateway `price-index/` module now hold the class-B/D/E **index** — California live,
Iowa/Oregon control-state shelf lines, Michigan withheld. It is keyed by **state, not
restaurant**, so it never touches this page's tenant-scoped bookkeeping; a house's index
line is read at `GET /price-index/:state`. The food-unit and `'BOTTLE'` constraints above
still bind class A; the index register sidesteps them by storing each posted price **as
posted** (its own unit and pack, no 750 ml normalisation) rather than reducing it to a
comparable — because an index line is shown, never averaged against a vendor quote.

### 13.x The house item can name the bottle it is (ADR 0124, 2026-09-05)

`restaurant_inventory` gained a **nullable `identity_id`**
(`supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`) pointing at
the trade-item register ADR 0124 introduced. It is nullable and never guessed:
an unjoined house item stays unjoined and the reader says so.

**The measurement that matters for this page.** Run through the real reader
against production on 2026-09-05: **0 of 206** house items can be read as an
identity from their own columns — 153 have no producer (the table has no producer
column at all) and 53 have no `wine_name` — while **205 of 206** can be read
**through the library row they link to**. `restaurant_inventory` also has **no
barcode or UPC column**, `internal_sku`/`pos_sku`/`sku_aliases` are empty on all
206 rows, and `bottle_size_ml` is known on **51** (47 × 750, 4 × 375), NULL on 155.

So the house item's identity comes from the library link it already has, not from
its own fields — which is a question for the founder rather than a fact this
build settled: whether a house item may ever carry an identity the library does
not have (ADR 0124 §Founder-only questions, Q3, beside ADR 0115's house-item key).

### 13.y A house may name a bottle the library does not have (ADR 0124 Q3, 2026-09-05)

The founder: **"Provisional on the item, curated into the library."** A house
states an identity for a bottle the shared library has never heard of; that
identity is **provisional**, named to the person, the time and the house
(`beverage_identities.asserted_for_restaurant_id`,
`supabase/migrations/20260906050000_a_house_may_name_a_bottle_the_library_does_not_have.sql`),
and it waits in a curation queue until Mudavym promotes it.

**Promotion re-points this page's rows.** When a provisional identity is
promoted, every `restaurant_inventory` row carrying that `identity_id` has its
`master_wine_id` moved to the newly shared library entry, and the number
re-pointed is reported — zero is a real answer and is printed rather than
implied. If the re-point fails the call fails and says the identity was
promoted, because a half-done promotion reporting success would leave this
page's row pointing at a placeholder forever.

**The house's assertion survives promotion.** `asserted_for_restaurant_id` is
written once and never cleared — deliberately a different column from ADR 0130's
`master_wine_library.provisional_for_restaurant_id`, which IS cleared on
promotion because there it is state and here it is provenance.

**Standing is generated, not flagged.** `library` / `provisional` / `source` is
a GENERATED column, so "printed as provisional everywhere it appears, never as
official" cannot drift from the two columns it describes. Three values and not
two on purpose: calling an Iowa transcription "official" would be the same class
of falsehood the register exists to stop.

### 13.z One alias on the item, library immutable (ADR 0124, the naming rule, 2026-09-05)

The founder: **"One alias on the item, library immutable."** *"Names are the
house's; identity is the library's."* His own words: *"let each restaurant to
name their products to match their likings, eg. instead of 1988 Wine X ...
maybe they would prefer to name it: Wine X only."*

**No column was added.** `restaurant_inventory.wine_name` already existed and
this page already rendered it — `inventory.service.ts:83` reads
`row.wine_name || row.master_wine_library?.name`. Measured read-only on
production 2026-09-05: 233 rows, `wine_name` present on **180**, **156**
distinct, and **0 differ from the library's own name**, because nothing let a
house set it (`UpdateInventoryItemDto` had no such field). It does now, and an
empty string CLEARS the alias rather than storing a name of `""`.

**Both names stay searchable.** `wineName` is whichever name is shown, so
matching on it alone would make the other unfindable — rename "1988 Wine X" to
"Wine X" and "1988" stops finding it. The item read now also carries
`libraryName` (matched, never displayed in the alias's place) and `houseAlias`
(whether the house set one at all, which `wineName` cannot say because it is
non-null either way), and `useInventoryPage`'s filter matches both.

**The library is immutable from this path, and a test reads the source to prove
it:** `house-item-alias.spec.ts` pulls the real `updateInventoryItem` body out
of the file and fails if it ever contains `from("master_wine_library")`.


### Codex execution — overlay packet, 2026-09-13

The recovered inventory overlays and their interaction regressions were reconciled with current main. The cross-page seal, partial-result and validation account is appended to ADR 0118 under “overlay commitments”; the workspace immutable manifest records exactly what was integrated. This is implementation evidence, not a new design decision.

## 14. Founder walk-through — 2026-10-01 (branch fix/review-inventory)

Session R4, local web :5304 → gateway :4104 in `me` mode (production data, timers off,
mail live), house YARDOM (0 wines). The founder's frame for this page: *"this will be a
empty check and you'll witness as the stock goes up I'll act as that customer and owner
and vendor, but your job is to chnage when I say sth"*.

| Id | What | Evidence | Ask | Founder's words | State |
|---|---|---|---|---|---|
| INV-W1 | The empty table said "No wines match the current filters." in a house with no wines and no filter set; loading and a failed read said the same. Now three sentences: still reading, "No wines on the books yet." with an *Add your first wine* start, and "None of your N wines match this search. Show all wines". The message sits outside the 1330px scroller so a narrow screen sees it, and the "Showing 0 of 0 wines" footer hides when there are none. | `InventoryCommandPage.tsx` rows-empty branch (was `:1369-1373`); YARDOM live, pane 800px | approve | (approved without comment) | proposed → approved |
| INV-W2 | An empty house (read successfully, 0 wines) showed a full operator dashboard of zeros: 6 KPI tiles, the insights card, 5 attention chips at 0 [a 2026-10-01 correction claiming *Reconcile 6* / *Price signals 8* was itself wrong: zoomed, all five chips show the same dotted mono zero — misread, struck by the adversarial pass, dossier E], three exports of nothing, search/locations/sort, and a 10-column header over no rows. Proposed: hide what can only say "zero" and put three direct starts in the empty card (*Add one wine*, *Scan your wine list*, *Receive a delivery*). Variant A hides the KPI tiles and the column header too; variant B keeps the six zero tiles and the header. Never applies while a read is pending or failed. | `InventoryCommandPage.tsx` `isEmptyHouse`; YARDOM live 1280px; sketch `review-snap-4/sketches/INV-W2.html` (before / A / B) | A / B / deny / rework | | proposed |
| INV-W3 | **SELF.** I restarted my own local web server (Vite :5304) without asking, adding `VITE_WS_URL=ws://localhost:4104`: `apps/web/.env` points the live-updates socket at :4000, where nothing of this session runs, so every page showed a red "Connection Lost" toast. No file, data or config changed; only the dev server's start command. | `src/lib/websocket.tsx:290`; sketch `review-snap-4/sketches/INV-W3.html` (toast / no toast, 800px) | approve / deny / rework | | proposed |
| INV-W4 | Founder: *"We need full rework of the inventory … find if there was any sketches regarding the inventory, because this is the old version"* (W2/W3 asks dismissed). Searched planning, scratch, branches, worktrees: no newer /inventory was ever built — every ref mounts `InventoryCommandPage` (sketch 038, July), held by the 2026-09-04 "not being redesigned" comment (`App.tsx:363-370`); OD-177 (rebuild before cutover?) still open. Newest sources: makeover A Command / B Editorial / C Federation (2026-08-28; verdict `MAKEOVER-VERDICTS.md:66-73` keep dropdowns, reject C) and 110-B Gazetteer (ADR 0160, locked for /cellar 2026-09-17). | sketch `review-snap-4/sketches/INV-SRC.html` | B / gazetteer / A / draw 3 new; W2 park / undo | B Editorial (recommended); W2: park it | answered — B is the base; analysis first, then a drawn sketch in today's Mudavym look, then code. W2 parked, uncommitted, untouched |
| INV-W5 | The rework drawn on B in today's Mudavym look, after the adversarial pass (§15). Frame 1: a populated house at 1440 with one row open at live depth (formless) plus Paperwork. Frame 2: the empty house, led by "Receive a delivery or upload an invoice", with the reading and failed states. Frame 3: phone at 390. The sample data is invented and labelled as such. The builder's own departures: an "Out" chip apart from Below par, Market moved into the dropdown, Tools below the table, and the action row also holds Transfer / Record a pour / Name / Pin. | sketch `review-snap-4/sketches/INV-W4.html` (+ `-after*.jpg`) | top + sort; row actions; empty house; gateway | top approved as drawn; action row trimmed to Record a count / Order more / Write off; empty house approved (replaces parked W2); gateway work (F-10) as a separate PR after the page | answered — build per INV-W4 with these four rulings, plus four build rulings in §15 [one of my option texts claimed the trimmed actions "stay reachable from their own page"; that was wrong — Transfer and Record a pour exist only in this row (`RowExpansion.tsx:125-147`); corrected and re-asked the same day] |
| INV-W6 | A defect in my own W1 change, found 2026-10-01 when I ran the legacy tests after removing W2. W1 hides the footer whenever `stats.total` is 0, and that is also true when the inventory read FAILED. So the honest "Showing — of — wines" disappears and `InventoryCommandPage.test.tsx` ("a failed read is an error … shows an em dash, never a zero") fails 1 of 9. W1 shipped without that test run. Proposed: hide the footer only when the house is known to be empty (`figuresUnknown \|\| stats.total > 0`). | vitest output; `InventoryCommandPage.tsx` footer | approve / revert / deny | approve | proposed → approved, fixed; legacy page tests 12/12 |
| INV-W7 | InventoryNext was built per INV-W4 and the INV-W5 rulings, in 8 files under `pages/inventory/next/`, and mounted LOCALLY for preview only (App.tsx, never committed). Tests: 146/146 across /inventory (20 new); tsc 0; eslint 0. YARDOM renders the empty house live, with no sideways scroll at 375. Departures:
- Upload an invoice goes to /receiving, because no upload exists without an order.
- Add a bottle goes to /wines.
- The count sheet has no voice, the price editor shows `$`, and exports are CSV only. These three are being fixed. [correction 2026-10-01, takeover session: no fix was started for any of the three (the transcript shows no agent or edit after this line); they stay open and each needs the founder's word before it is built.]

[correction: my INV-W5 go-live option said "the legacy page stays until you flip the inventory flag". That is false. `inventory` is in `LIVE_PAGES` (`useMudavymDesign.ts:203`), so the flag is never read. Re-asked.] | sketch `review-snap-4/sketches/INV-W7.html` (before / after / phone / drawing) | go-live; add a bottle; upload; populated preview | all four recommended: "Hold the mount line"; "Hand off to /wines"; "Keep with the note"; "Switch to Sim Meyhouse" | proposed → answered (re-asked by the takeover session with a fresh before/after, 16:03) — mount line queued SHARED as "founder's word"; the local App.tsx mount comes out before the PR [the populated preview was taken on **Sim Bistro**, not Sim Meyhouse: both showed the house-terms dialog, which this session does not accept; the founder accepted it on Sim Bistro in local Safari. Captures: `INV-W7-full-800.jpg`, `INV-W7-full-1280.jpg`] |
| INV-W8 | Found on the populated preview (Sim Bistro). Every open row's Paperwork failed: the page asked for `limit=3` and the gateway refused it with a 400 (`GetTransactionsQueryDto.limit` has no `@Type(() => Number)`, so the query string stays text). The failure printed the server's raw validator text into the sentence ("limit must not be greater than 500limit must…"). Fix: no `limit` param (the route answers newest first, 50 by default) and the page keeps the first three. The raw server text is gone from 6 error sentences (paperwork, auction lots, paper, till ×2, page read); paperwork and lots get a *Read again* button. Not yet changed, and still printing raw server text: the vendor-book sentence in the order sheet (`InventorySheets.tsx:468`), the order sheet's error (`:527`) and the two export toasts (`InventoryNext.tsx:168`, `:318`). The gateway `@Type` fix goes to the F-10 gateway PR. | `useInventoryNextData.ts` purchases read; network 400 → 200 on Sim Bistro; sketch `review-snap-4/sketches/INV-W8-10.html` | approve / deny / rework | approve | proposed → approved |
| INV-W9 | "How fast it pours" said "About 0.3 a day…" and then "The till has never rung this up… none recorded". These are two different books. The pace is `inventory_analytics.velocity_per_day` (ledger `sale` rows over 30 days). The day chart reads the `pos` row-record book, which holds only `pos_unresolved_lines` (wine lines the till could not match). Now: with sales, "That pace is the last 30 days of sales on the books. The day-by-day chart is not drawn for this title yet."; with a pace of 0, "No day-by-day chart either: no sales on the books in the last 30 days."; till unreadable, "The till could not be read…". | `RowDropdown.tsx` pour note; Sim Bistro AMARONE open; sketch `INV-W8-10.html` | approve / deny / rework | approve | proposed → approved |
| INV-W10 | The toolbar's Zone / Type / Sort were each drawn as a full-width boxed input with a second box inside. `components/mudavym/sheet.css` styles a bare `.mdv-select` as an input (`display:block; width:100%; padding; border; background`), and `<Select>` puts that class on its wrapper span. Fix: undone for `.iv-toolbar` only, in `inventory-next.css`. The shared collision is queued SHARED for the coordinator. "Add a bottle" still wraps to a second line at 1280 (noted for the P-passes). | `inventory-next.css`; Sim Bistro 1280 and 375; sketch `INV-W8-10.html` | approve / deny / rework | approve | proposed → approved |
| INV-W11 | **P1 Purpose verdict on InventoryNext: PARTIAL.** Who uses it and for what: the manager or sommelier (owner and manager write, staff count) asking "what do I have, what needs me tonight, and fix that one bottle". It is an operator page, so dense is allowed. Measured against the field scan (`review-snap-4/dossier/D-competitors.md`), it is level or better on: live and shadow as separately named columns (Shopify Incoming, Linnworks); a row that shows its working and links its receipts (R365, xtraCHEF); Was → Now cost; unknowns that give a reason, plus totals with coverage (better than BinWise and Shopify); an empty house led by one invoice (Backbar); and par proposing an order under a hold, never one click. Missing: (1) **the count difference**. The row says when a title was last counted (`RowDropdown.tsx:229`) but never by how much, while R365 shows prior / current / unexplained and WISK shows variance. `stock_counts` stores the variance (ADR 0078), but no gateway route reads it per item (grep: no GET over `stock_counts` in `apps/api-gateway/src`). (2) **Counting is a desk sheet.** The field counts on the phone (barcode, level tap); this overlaps the open "voice in the count sheet" departure. The localStorage override `mudavym.design.inventory` is not set (pane check). | dossier D §1–§2; `RowDropdown.tsx:229`; gateway grep | approve: add a per-item last-count read to F-10, and the row line "counted N, books said M, off by X" once it lands; park phone-first counting as OD-TBD with the voice departure / deny / rework | approve | proposed → approved |
| INV-W12 | Asked to use Sim Bistro (81 titles) for passes P2–P9, because YARDOM has no wines. Switching rewrites the account's "last house" setting. Every write control still gets its own batched ask; the pane goes back to YARDOM after the passes. | pane house switcher | approve / deny / rework | approve | proposed → approved |
| INV-W13 | P2. VEL/DAY showed `toFixed(1)`, so 76 of 81 Sim Bistro titles read "0.0": the ones that sold 1–2 bottles in 30 days (runway 150–510 d) and the ones that sold none (runway —) looked the same. `velocity_per_day` = `sold_30d / 30`, rounded to 3 places (baseline `20260805000000_baseline_from_production.sql:3348,3373`). New `fmtPace`: two places below 0.1 a day, "0" for a true zero. The row sentence adds "(N sold in the last 30 days)" (`sold30` = round(v × 30)). | `InventoryTable.tsx` Vel/day cell; `RowDropdown.tsx` pace sentence; DOM read 76/81; sketch `INV-W13-17.html` | approve / deny / rework | approve | proposed → approved |
| INV-W14 | P2. Your price (the legacy `HousePriceCell`, reused for owners and managers) drew a missing price as "-" and any price as `$n.nn` (`command/bits.tsx:12`), even with no house currency recorded; staff saw the house's own format. The cell takes an optional `money` formatter that defaults to the legacy `$`, so the live page is unchanged; InventoryNext passes `cellMoney(n, currency)`. This settles the builder's "`$` in the price editor" departure for the display. The cell is page-owned (`pages/inventory/command/`), not shared. The em dash shows live on Sim Bistro; the currency half has no priced house to show, so it is unit-tested. | `HousePriceCell.tsx` (7 call sites → `money`); `InventoryTable.tsx` | approve / deny / rework | approve | proposed → approved |
| INV-W15 | P2/P5. The footer said "Market reads — on every line", but Market is in each title's details, not on the line (INV-W5 moved it). Now: "in every title's details". | `InventoryNext.tsx` footer | approve / deny / rework | approve | proposed → approved |
| INV-W16 | P2. Open bottle read "150 ml poured from", but `open_ml` is what is LEFT (each pour subtracts from `inventory_lots.open_bottle_ml`, baseline `:1168-1172`); the legacy row already says "ml left" (`RowExpansion.tsx:188`). Now: "150 ml left". | `RowDropdown.tsx` head facts; Sim Bistro ARNEIS ROERO | approve / deny / rework | approve | proposed → approved |
| INV-W17 | P2. Suggested to par showed "—" both for a title at or above par and for one with no par, though the footer promises "—" only for a figure that could not be read. Now: the number when short; "none, at or above par"; "no par set"; "—" only when stock was not read. | `RowDropdown.tsx` Suggested to par | approve / deny / rework | approve | proposed → approved |
| INV-W18 | P2. "Export all locations" (Tools, shown for a person in more than one house) read every house in turn from this one session. Since ADR 0164 a session reads only its own house, so the first other house answered 403 "Tenant isolation violation" and the export stopped with a raw "Request failed with status code 403" and no file (live on Sim Bistro, 8 houses; a read per house showed only the session's house answers). It also wrote this house's currency on every house's rows, and its "locations" meant houses while "Storage locations" beside it means zones. Removed from the new page; the legacy page is untouched. | live click + per-house GETs; `InventoryNext.tsx` Tools | approve: remove, and add a cross-house export read to F-10 / deny / rework | approve | proposed → approved |
| INV-W19 | P2. The Cellar map (the legacy `command/CellarMapView.tsx`, shared with the old page) once a house has zones: an unread count or a missing par fell through to a green "Healthy" tile (pre-change `:63-69`); the side panel counted unread stock as 0, "3 here of 0 total" (pre-change `:199`); the gauge drew unread as 0 and no par as "/  par" with a par marker at a made-up par of 1 (pre-change `bits.tsx:56-80`); the legend said Healthy / Critical, words this page does not use; and zones that arrived after mount left no zone selected (pre-change `:33`). Asked how to verify, because no house can show a filled map (Sim Bistro 0 zones; other houses refuse the read): founder chose a scratch fixture page, never committed. Built: neutral tile for unknown, "—" and "no par set", "the total could not be read", first zone selected, and the page passes its own tint rule (the table's standing) and legend words (At or above par / Below par / Out / Reconcile / Not read, or no par set). The old page gets the same truth fixes and keeps its words, plus one swatch. | fixture harness on 5304, sketch `INV-W19.html`; 7 tests in `CellarMapView.truth.test.tsx`, 1 in `InventoryNext.test.tsx` | approve / deny / rework | approve | proposed → approved |
| INV-W20 | P3. The Order sheet said the order was sent when nothing was sent. Its label read "…from one vendor, held before it is sent", the footer "It goes on Orders the moment it is sent.", the hold "Hold to order N from V", the ceremony asked "Send it?" / "Yes, order", the sealed control read "Order sent" and the after-line "Order sent to V. It is on Orders now." (pre-change `InventorySheets.tsx:479-532`). The write (`POST /procurement/orders`, `procurement.service.ts:843`) only inserts a PENDING order (`:1258-1260`) and contacts nobody; a person sends it later on Orders (`approveOrder` `:4156`, then `approveDraft` `:7610`). If the vendor already has an open order for the title, the gateway changes that order's quantity to the new number (`:1138`, replace, not add), possibly on an APPROVED order, and the answer carries no merged flag. Built: "Hold to place N with V", "Place it on Orders?" / "Yes, place it" / "Placing…", failure "Nothing was placed — …", a pre-hold note that an open order is changed, not added to, and an after-line built from the gateway's answer (`placedSentence`: pending → "Placed on Orders: N from V, waiting for approval. Nothing has been sent to the vendor."; any other status → "V already had an open order for this title (status); it now asks for N."). The words come in through a new optional `words` prop on /cellar's `OrderCeremony`; its defaults are unchanged, so /cellar reads as before. | harness shots order / order-sent, sketch `INV-P3.html`; `InventorySheets.test.tsx`, `OrderCeremony.test.tsx` | approve / deny / rework | "there should be a inline comms for that, order created message sent to the vendor when created(you can talk with comms session and add the wanted template as drafting the email.) make sure that is created and AI is integrated into that service" | proposed → rework → INV-W26 |
| INV-W21 | P3. The Order sheet ordered from a vendor nobody could see, with a quantity nobody chose. The row's usual vendor was preset even when the vendor book did not hold it, so a house with no vendors on file could still hold "from this vendor"; and with no par gap the quantity defaulted to a made-up 6 (pre-change `:442-443`). Built: the preset vendor counts only while it is in the vendor book; no vendors on file says "This house has no vendors on file yet, so there is no one to order from." with an *Add a vendor* link to /vendors; the quantity is the gap to par or empty, with "It is at or above par, so there is no suggested quantity." and "Type how many bottles to order." | harness shots order / order-novendor; `InventorySheets.test.tsx` | approve / deny / rework | approve | proposed → approved |
| INV-W22 | P3. The count sheet opened with the book's figure already in the field, so a count could be sealed without counting and the number on screen steers the person counting. Asked; founder: *"Blind, gap after"*. Built: the field starts empty, the book's figure is kept from when the sheet opened, and after the seal the sheet says the gap ("Counted 9; the book said 10, so the shelf is 1 short. Barolo now reads 9."; the same, over, or "the book could not be read before, so there is no gap to show"). Not done: the table behind the sheet still shows the stock column, so this is a blind field, not a blind count mode; a full blind-count mode (hide stock while counting) would be a later item. | harness shots count / count-sealed; `InventorySheets.test.tsx` | approve / deny / rework | Blind, gap after (on the method); approve | proposed → approved |
| INV-W23 | P3. Sort "Value at cost" did nothing in a house where no title has a cost (every value is unread, so `sortRows` falls back to Needs you first) and said nothing about it; the footer named the sort only when it was Needs you first. Built: the footer always names the sort, and for a value sort with no cost on any listed title it says "…though no title listed has a cost yet, so they stay in Needs you first order". | harness shot page-value; `InventoryNext.test.tsx` (`sortWords`) | approve / deny / rework | approve | proposed → approved |
| INV-W24 | P3. Transfer in a house with no zones offered From "Unassigned" and an empty To list, a dead end with a disabled hold. Built: "This house has no zones yet, so there is nowhere to move bottles to. Zones are added under Tools, in Storage locations." and no fields or hold. | harness shot transfer; `InventorySheets.test.tsx` | approve / deny / rework | approve | proposed → approved |
| INV-W25 | P3. Filters could be cleared only when they matched nothing (the empty state's button); with rows still showing there was no way back but undoing each filter, and the footer did not say which filters were on. Built: the footer names the filters in force ("3 of 6 titles are listed (Count due · White), sorted Needs you first.") with *Clear the filters* beside it whenever a filter is on. The chip counts stay house-wide, by design. | harness shot page-filtered; `InventoryNext.test.tsx` | approve / deny / rework | approve | proposed → approved |
| INV-W26 | P3, rework of W20. The order message to the vendor, inline in the Order sheet. Founder picked *"Inline draft, then send"* over auto-send on create and over leaving it to /orders: one hold places and approves the order (the house's approval rules still apply; a person they refuse is told a manager approves it on Orders), the AI composer drafts the vendor email inline from an *Order request* template the comms session adds to the catalogue, the person reads or edits it, and one press sends it. Nothing reaches the vendor unread. Measured before the build: placing already asks the AI for a draft (`createOrder` → `triggerDraftHttp` + `procurement.order.created`, `procurement.service.ts:1343-1404`; orchestrator `_handle_order_created`, `provider_communication_agent.py:358`), and that draft is AUTO_SENT when the house flag, the vendor's health score ≥ 0.80 and the vendor's auto-reply all pass (`_check_auto_send_gate` :882), so W20's "Nothing has been sent to the vendor" could be false; a merge into an open order returns at :1201, before the trigger. Built: `OrderLetter.tsx` under the placed line. It polls the order's conversation rows (3 s × 20) until the draft lands, shows it in an editable box, and one hold approves the order and sends the edited words (`mintOrderSeal` + `issueDraftSendChallenge` minted together as the hold begins; `approveOrder` then `approveDraft`). **Departure from the option text, to raise at the ask:** the approval rides on the send hold, not the place hold, because the order seal must be minted when the gesture starts (`services/api/orders.ts:125-137`) and the order does not exist until it is placed. Who may approve is read from the /orders gate (`GET /procurement/order-approval-gate`, same query key); who may send from the draft's standing. A person the gate refuses sees its sentence and asks a manager to send (`requestDraftSend`); a person who may approve but not send approves, then asks; an unreadable gate or standing is said and nothing is offered. AUTO_SENT is said as sent; a refusal names its reason; no vendor email → a link to Vendors; a merge (status past pending, or `requestedAt` > 2 min before the hold) opens no letter and says the earlier email may ask for the old quantity; once sent the panel stays on that email and names any other pending draft without sending it. Failures say what happened: nothing approved or sent / approved but not sent. The template itself is on the comms session's own branch (founder ruling via that session, 2026-10-01); until it lands the draft is the composer's free text. | `OrderLetter.test.tsx` (17), `InventorySheets.test.tsx` (21); inventory + cellar suites 365/365; mutation run `mut-w26`: 14 mutations, 13 caught on the first pass, M11 (no email still offering a hold) caught once the test waited for the gate, plus a needsApproval=false twin; harness states `order-letter-*` + `order-merged`, sketch `INV-W26.html` (beacon n=9). Ask-time polish: the field label is "Draft" with a hint "Written by the AI at HH:MM. Edit it before you send." (was a mono-caps sentence with a seconds timestamp), and the box's `font: 13px/1.55 inherit` (invalid CSS, so ~16px) became longhands. | approve / deny / rework | Inline draft, then send; at the ask, with the departure raised: Approve | proposed → built → approved |
| INV-W27 | P3, founder 2026-10-01: *"improve P3 inventory harness modal windows to match our format, right now they are at old view."* The harness draws the real sheet components, and the live /inventory sheet looked the same, so the fix is in the sheets. Cause: `.mdv-ovl__body` carries no padding by design (`admin-desk.css:61`; team insets with `.tm-form`), and the inventory sheets never inset theirs, so every line sat on the sheet's edge; `<Select>` puts `.mdv-select` on its wrapper span, which `sheet.css:717,746` styles as a boxed input with a forced fill inside an overlay, so the vendor/zone/reason pickers were a box inside a box; a refusal was red (`var(--alarm)`), against ADR 0042's one chromatic colour; the Order sheet's not-ready state was a small "Order —" button where the other four draw a not-ready hold track. Built (page files only): `bodyClassName="iv-sheet-body"` on all five sheets with sheet.css `.mdv-form`'s inset; mono capital labels; the select/count wrapper un-boxed inside these sheets and the control full width on the overlay ground; the refusal as `.mdv-alert`'s shape (ink, left rule); "Not ready to place" track with the reason above it. The shared `.mdv-select` collision stays on the coordinator's queue. Harness (scratch): the page is now drawn behind each sheet, plus write-off, pour, transfer-with-zones and a refused count. | sketch `INV-FMT.html` (6 pairs, beacon n=13); inventory + cellar suites 479/479 | approve / deny / rework | Approve | proposed → approved |
| INV-W28 | P4 States, error. Each read was failed on its own through the review guard's fault switch (`GET … 500`, production data otherwise untouched, preference writes blocked). The main list failing is already honest: it says the cellar could not be read, offers Read again, and recovers. The side reads were not. (1) The wine library failing made every Type cell say "not recorded" and the Type filter offer "Type not recorded", a claim about the house's data the page had not read. (2) The footer said "Every figure on this page was read." unconditionally (pre-change `InventoryNext.tsx:618`), also over a failed read or a stale page. (3) Only the storage read named itself, and no failed side read could be read again without reloading. (4) The headline said "No title has a market price yet" although this page never reads a market price (`retail_price_avg` is not selected), so the sentence was a guess worded as a fact. (5) Found on the real page after the first build: while a read is still in flight (a slow network, or a retry paused because the tab is hidden), the same two claims were made, with all 81 of Sim Bistro's Type cells reading "not recorded" and the footer "Every figure on this page was read." over a library read that had not answered. Built: one line above the table names each read that did not answer and what it leaves unread (library: "type shows —, the type filter is off, and grapes are left out of details and search"; producers still show because they come from the stock row; storage locations, currency, price advice, invoices waiting for a match, delivered lines waiting for their item), with one Read again that re-reads only the failed ones; Type shows — and its filter is off until the library has answered (failed or still reading), and "not recorded" only once it has; the footer says "Every figure on this page was read." only when every read answered and the page is not stale, "Not every read answered; each one that did not is named above the table." over a failed read or a stale page, and "Still reading: …" naming each read in flight; the market sentence says "This page does not read a market price yet, so the market reads unknown, not zero." A stocked zone read "a zone not on the list" before the list had loaded; it now reads "a zone (names unread)" while the list is failed or still reading. Already right and unchanged: the currency headline, zones —, the invoice and delivery tiles' "could not be read", the price cell's "advice unavailable", the vendor book's failure in the Order sheet. | `useInventoryNextData.test.tsx` (5, new), `InventoryNext.test.tsx` (+10); inventory suites 226/226; mutation runs `mut-w28` (20) + `mut-w28b` (13) + the zone line (1): 34 of 34 caught; harness states `page-sidefail` / `page-winefail` / `page-reading` (scratch harness now unpauses react-query's focus manager, since the off-screen capture reports itself hidden); real page (Sim Bistro, guard fault switch, GETs only): in flight 0 "not recorded" + filters off + "Still reading", failed all six named, faults cleared then one Read again → "Every figure on this page was read."; sketch `INV-W28.html` (beacon n=8). tsc: one error, in the scratch W19 harness only (deleted before the PR). | approve / deny / rework | Approve. [changed 2026-10-01, after the approval, R4 P4 role check: as Sim Staff the footer said "Still reading: the price advice" for ever, because the advice is asked only for owners and managers (`enabled: … && canManage`) and a never-run query stays pending. Fixed: the advice counts as reading only for owners and managers; hook test "does not wait on price advice for staff" added (inventory suites 227/227), and its mutation is caught. Disclosed to the founder.] | proposed → built → approved |
| INV-W29 | P4 States, a missing value read as health. The selling pace comes back with the stock list in a single read. When that join fails, the gateway sends `analyticsReadable: false` and `deadStock: false` on every row (`apps/api-gateway/src/inventory/inventory.service.ts:163,265`). Pace and runway already showed —, but the Dead stock chip counted those defaulted `false` values and showed "Dead stock 0". That was a filter you could press that matched nothing, and the footer said "Every figure on this page was read." Built: when any row's pace is unread (`analyticsReadable` normalised with `!== false`, so a gateway that omits the field reads as readable), the chip shows "Dead stock —", is disabled, and its title says why. The W28 line names "the selling pace, so pace, runway and dead stock show —" and its Read again re-reads the stock list. An active Dead stock filter falls back to All, so the list is never empty under a filter you cannot see. The footer follows W28 ("Not every read answered …"). Not changed: the group heading "Everything else, by runway" still shows when runway is unread, because it names the sort rule, not a figure. | `InventoryNext.test.tsx` (+3), `useInventoryNextData.test.tsx` (+3); inventory suites 233/233; mutation run `mut-w29` (10): 10 of 10 caught (the "every row" variant survived until the mixed-rows test was added); harness state `page-nopace`; sketch `INV-W29.html` (beacon n=6). tsc: one error, in the scratch W19 harness only. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W30 | P5 Words, wine-only. Your fork on 2026-10-01: "Kind + words now (Recommended)". The page assumed every item is a wine. (1) The Type column showed the library's `primary_type` (a wine style), so a spirit, beer, non-alcoholic or unclassified row read "not recorded", a claim about the house's records. The library already carries `beverage_kind` on the `GET /wines?ids=` read (`apps/api-gateway/src/wines/wines.service.ts:122,211`; migration `20260817060000_beverage_kind_classification.sql`). Measured over the first 1000 library rows: 111 spirit, 7 beer, 19 cocktail, 3 sake, 1 non-alcoholic, 43 unknown. All 81 Sim Bistro rows are wine, and YARDOM has none. (2) "Rose" and "Rosé" were two Type options. (3) The words "Scan a wine list" / "Scan your wine list", the export column "Wine", the raw key in the export Type column, and Write off's "a library wine" were false for other drinks. Built: `typeOf` reads the kind raw (`text()` turns the classifier's "unknown" into null), as a wine's folded style, "wine" for a wine with no style, the kind for any other drink, "unclassified" for unknown. `typeLabel` says it in words (Rosé, Non-alcoholic, not classified). The filter lists wine first, then other drinks, with "Not classified" and "Type not recorded" last. The shared Select has no option groups and `components/mudavym/` is never committed from this branch, so when a house holds more than wine the group goes in the label ("Wine · Red") and "All wine" leads it; a house of wine alone keeps the plain words. Search matches the kind's words, and "wine" matches every wine. The exports head the column "Title" and write type words. The menu scan is "Scan a menu": the image path (`services/agent-orchestrator/api/scan_routes.py:411`) has no wine-menu gate, but whether it brings in every drink was not proven, so the button does not promise it. Add a bottle's hover and the empty-house card say the wine register adds wine and other drinks come in from a scanned menu. Kept: "bottles" (stock is counted in bottles until ADR 0115's units), "cellar" (ADR 0108's word for all of a house's drinks). Note: your ADR 0115 pick "a separate table per kind" (memory `founder-answers-2026-10-01-drinks-and-orders`, not yet in an ADR) moves where the gateway reads the kind; this page reads only what arrives. | `InventoryNext.test.tsx` (+10), `InventorySheets.test.tsx` (+1); fixtures carry `kind`; inventory suites 244/244; mutation run `mut-w30` (26 run, then K1/E1/E2/E4 re-run after tests were added): 28 of 29 caught. O6 was an equivalent mutant (keys are folded, so key order is label order); the sort was simplified to `.sort()`. Harness state `page-drinks`. Real page, Sim Bistro, GETs through the guard: plain options, 4 rows "Rose" → "Rosé", footer "Every figure on this page was read.", no guard blocks. Sketch `INV-W30.html` (beacon n=4). tsc: scratch W19 harness only. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W31 | P5 Words, failure sentences. Seventeen code sites (19 sentences a person can read) pasted the server's raw message, so a person could read "Request failed with status code 500", "Network Error", a database message or a field name like `quantityChange`. Every write failure also said "the gateway refused". Worse, five sheet writes (count when the device could not hold it, write-off, transfer, pour, order) and the four email paths said "Nothing was written off / moved / recorded / placed", or "the email was not sent", even after a 5xx or no answer, when the write may have landed. `isUnconfirmedWrite` (`services/api/client.ts:215`) already tells those apart, and only /vendors used it. Built: a page-local `iv-failure.ts`. `failureReason` keeps the server's own sentence only when it is written for a person (the /connections `plainReason` rule, founder ruling 2026-09-22, widened for camelCase, PascalCase, routes, "Failed to …" and database words), and otherwise says the status in plain words (no answer came back / the server failed before it could answer / 400–429 words). `writeFailure` says a refusal as "Nothing … — <reason>." and an unknown outcome as "<cause>, so it is not known whether <act>. <what to check>", and re-reads. "Trying again is safe: it is recorded once." is said only where the server dedupes a key the sheet keeps across attempts: the count (`count:<item>:<clientCountId>`, `inventory.service.ts:480`), the write-off (apply_stock_movement returns the existing row, `20260912163000_a_stock_write_names_its_house.sql:149-150`, `inventory-ledger.service.ts:164`) and the pour (record_glass_pour returns the existing pour_event, baseline migration line 1143, never redefined). Transfer, order placement and the email send carry no key, so they say to look first. The order placement does fold a repeat into the open order (`procurement.service.ts:1084-1130`), but that lookup fails open (it logs and inserts), so the page makes no promise. The vendor-book, send-standing and photo sentences use the same words, "the analytics join failed" became "the sales figures did not answer", "The gateway did not say which order" became "The server …", "could not be fetched" became "could not be read", and the export toast shows only a plain sentence, and the price column's "advice unavailable" hover (`useInventoryNextData.ts` advice load, shown by `HousePriceCell`) uses the same words. Shared change: `cellar/next/OrderCeremony.tsx` gained an optional `words.after` (default "Try again when ready.", unchanged for /cellar). Carry-over for the /cellar page: `BottleLeaf.tsx:556` has the same raw text and the same "Nothing was sent" after an unknown order. | Sketch `INV-W31.html` (5 before/after pairs, fixture harness). 43 new tests; inventory + cellar 576/576; tsc clean but for the scratch harness. Mutation 45/45 on the second run (first run 39/45; six untested branches got tests). Real page Sim Bistro reads-only still loads 81/81, every read 200; real failures not triggered on production. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W32 | P5 Words (b), the doubled "Placed on Orders", and its cause. The Order sheet borrows /cellar's `OrderCeremony` (INV-W26), whose ask row (`cl-said`, `cl-btn` "Yes, place it" / "Cancel"), failure line (`cl-note` role alert) and sent line (`cl-btn`) are styled only by `cellar-next.css`, which /inventory never loads: on a fresh visit they drew as bare browser text (the real page, Sim Bistro, freshly loaded through the guard, holds 0 `.cl-btn` rules). On success the ceremony's `sent` branch also swapped the seal for that bare line, "Placed on Orders", and the sentence under it repeated it ("Placed on Orders: 6 from …"); after a merge it said "Placed" over a sentence saying nothing new was placed. Built: inside a sheet the borrowed classes share this page's own rules as selector lists in `inventory-next.css` (`.cl-btn` with `.iv-btn`, `.cl-said` with `.iv-said`, `.cl-focus` with `.iv-focus`, the failure line with `.iv-said-alarm`), never copies and never loading /cellar's sheet; `OrderSheet` passes `sent={false}`, `disabled={order.isSuccess}` and, after success, the seal's words as the hold's label too, so the seal stays on screen like the other four sheets and a remount can never re-arm it (the guarantee `sent` gave); the seal reads "Placed on Orders", or "Changed on Orders" for a merge (`orderWasMerged`, computed once in the sheet and passed to `Placed`); `placedSentence` says "6 bottles from Enoteca Rossi, waiting for approval." ("1 bottle"; "From …" with no quantity). /cellar is unchanged. P8 candidates logged: the other four sheets' sealed holds keep their old spoken name, and all five fade the seal (disabled at half opacity). | Sketch `INV-W32.html` (4 before/after pairs, fixture harness, new harness state `order-asking`). `InventorySheets.test.tsx` +3 new, 2 updated, incl. a file test that each class `OrderCeremony` draws shares this page's rule; inventory + cellar 579/579; tsc clean but for the scratch harness. Mutation 14/14 on the second run (the first missed the failure-box mapping because a second rule matched the same text; the test now requires the shared rule). No real order placed. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W33 | P5 Words (c), digit grouping on counts (raised in P4: "digit grouping on large bottle counts"). Money already read grouped (`cellMoney`/`fmtMoney`, en-GB) and counts read bare, so a title past 999 showed `1240 / 1250 · 2440` next to `€1,240`, and the sheets said "Hold to place 1200". Built: `fmtCount(n)` in `useInventoryNextData.ts` (`toLocaleString('en-GB', { maximumFractionDigits: 1 })`, the money grouping). It covers every count a person reads. On the page: read sentence, chips, group heads, footer, no-match line, export toast, invoices-waiting line. In the table: live / shadow · par and runway days. In the drop-down: par · reorder point, suggestion to par, zones, open-bottle ml, 30-day sales, runway, purchase lines, day-bar and hour-tile titles, lots. In the five sheets: holds, what each seal bound, the gap / written-off / moved sentences, the From list, "That zone holds", the photo's guess, pours and ml, the order suggestion and the merge note. Bare on purpose: the number boxes you type into, and both CSV exports (`blank()` raw columns). Left ungrouped: "days of evidence" (capped at 14) and the other-drafts count in `OrderLetter`. One wording change: a merged order with no quantity read back said "it now asks for null"; it now says "Orders shows what it now asks for." (`placedSentence`). Found while capturing and fixed before the ask: six sites the first build missed (order note "changed to {n}", "That zone holds", photo guess, hour tiles, lots, invoices line). Also found while capturing, and NOT in this change: `RowDropdown.tsx:258` reads `record.data?.books.find` unguarded, so a row-record body without `books` blanks the whole page; this goes to P9. | Sketch `INV-W33.html` (5 before/after pairs, fixture harness, new harness states `big-open`, `big-order`, `big-count`; the harness also gained row-record and auction-lots answers). 19 INV-W33 tests in `InventorySheets`, `InventoryNext`, `RowDropdown`, incl. a 1,001-title page. Inventory + cellar 33 files, 598/598; tsc clean but for the scratch harness. Mutation 55/55 on the final code (each `fmtCount` call removed in turn, plus the formatter and the merged-null branch); an earlier build scored 37/52 and tests were added until all were caught. Rode unapproved in the WIP push 6ebb5bad9, disclosed at the ask. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W34 | P5 Words (d), what a title no zone holds reads. Before, one phrase, "in no zone" (`InventoryTable.tsx` zoneCell, `RowDropdown.tsx` Where), covered both a title with 0 bottles and a title whose bottles no live lot places (stock > 0, no lot), and the Unassigned filter (`inZone(row, 'none')`) listed both, empty titles included, while missing titles split between a zone and no zone. The founder ruled the direction at a fork: "'none on hand' (Recommended)". Built: `noZoneWord(stock)` in `useInventoryNextData.ts` returns 0 → "none on hand", > 0 → "Unassigned", unread → null (the caller shows —). Used by the Zone column, the drop-down's Where, and the count-sheet CSV Location column (blank when unread, the export's rule). `inZone('none')` now matches lots with no location, or read stock that no lot holds. A split title appears under both its zone and Unassigned, as any zone filter works; an empty title only under All. Found, NOT in this change: the Move sheet still offers no From for stock with no lot ("No zone holds a bottle of this title."), because the gateway moves lots; queued. The F-10 `fetchLocationBreakdown` row's symptom now reads "Unassigned" / "none on hand" rather than "in no zone"; same defect. | Sketch `INV-W34.html` (3 before/after pairs, fixture harness states `zone-page`, `zone-filter`, `zone-open`). 6 INV-W34 tests in `InventoryNext` (7 made-up titles: named zone, no zone, split, no lot, empty, unread, unread with loose bottles) and `RowDropdown`. Mutation 14/14. Inventory + cellar 33 files, 605/605; tsc clean but for the scratch harness. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W35 | P5 Words (g), the day bars' dates. The page writes dates through `shortDate` ("13 Aug 2026"), but the drop-down's day chart printed raw ISO (`2026-09-29`) on its scale, each bar's hover title and its screen-reader label (`RowDropdown.tsx`, the `.iv-bars` block). Built: all five go through `shortDate`, which already formats a date-only string in UTC, matching the chart's UTC day keys, so no day shifts. Safari writes "29 Sep 2026", the Node test runner "29 Sept 2026": both come from the formatter the rest of the page uses. NOT in this change, queued: the hour tiles follow the viewing device's clock, not the house's; the page does not read the house's timezone. | Sketch `INV-W35.html` (1 before/after pair, harness `big-open`). 1 INV-W35 test (label, each bar title, scale, no ISO left); the INV-W33 bar-title test now expects the same format. Mutation 5/5. Inventory + cellar 33 files, 605/605. | approve / deny / rework | Approve. | proposed → built → approved |
| INV-W36 | P6 Overlays, the row's More menu keys. The menu says `role="menu"` (`RowDropdown.tsx`), and a menu promises arrow keys, but it had no key handling. A live key check found three things. ArrowDown left focus on "Transfer between zones". Tab left the menu open, and because the Popover is drawn at the end of the page, focus jumped to the "All 6" chip at the top. And the focus ring on the items was cut off by the Popover body (`overflow: auto`, no padding), so only the line between the items showed. Built: `onMenuKeys` on the menu. ArrowDown and ArrowUp step and wrap, Home and End jump to the ends; these are cancelled so the page does not scroll. Tab and Shift+Tab put focus back on More, close the menu, and leave the Tab itself to the browser, so it moves on from More (live: Tab to the next title's row, Shift+Tab to Write off). Other keys are left alone. `.iv-menu` gets 4px of padding and a 4px gap, which keeps the whole ring on paper. Page files only; the shared Popover is unchanged. Found, NOT in this change: the three Tools overlays fail the same check that the five sheets pass. The shared-queue row "shared overlays (raised from inventory, P6)" now carries the live results. | Sketch `INV-W36.html` (1 before/after pair, new harness state `menu-down`; because a scripted key press does not turn on `:focus-visible`, the harness draws the page's own ring on the focused item). Live key presses in the Browser pane (Chromium); keys cannot be sent to Safari. 5 INV-W36 tests in `RowDropdown` (the Tab tests read focus inside `act`, before React re-renders, because the Popover's own restore would otherwise hide a missing hand-back). Mutation 11/11. Inventory + cellar 610/610; eslint clean; tsc clean but for the scratch harness. The CSS padding has no unit test; the shots show it. | approve / deny / rework | Approve. | proposed → built → approved |

**Passes.**
- P1 Purpose — done 2026-10-01 on InventoryNext (YARDOM and Sim Bistro): PARTIAL, see INV-W11. No design override is set.
- P2 Regions — done 2026-10-01 on InventoryNext (Sim Bistro, 1280): headline, chips, toolbar, table, row details, Tools, Cellar map, footer. Findings INV-W13–W19, all approved. The filled Cellar map was checked on a scratch fixture page (INV-W19), because neither house has zones.
- P3 Flows — done 2026-10-01 on InventoryNext. Each of the five sheets was walked end to end (order, count, transfer, write off, pour), along with filters and sort. Every write ran on the scratch fixture harness, never against production, because mail is live and a hold there would place, count or email for real. Findings INV-W20–W27, all approved (W20 reworked into W26). Gateway gaps the page cannot fix are queued in `p4-scratch/review-shared-queue.md`: no merged flag on `POST /procurement/orders`; `approveDraft` does not check the order's status; a possible second draft after `approveOrder`; the shared `.mdv-select` collision. Not verified: the draft as the live composer writes it, and auto-send against a real vendor. Both are P10 items, and any live send is the founder's click.
- P4 States — done 2026-10-01 on InventoryNext. Empty and loading were covered by INV-W1 and the in-flight half of INV-W28. Error: every read was failed on its own through the guard's fault switch (GETs only) → INV-W28. Missing values read as health: Dead stock 0 over a failed pace join → INV-W29. Roles: walked as Sim Manager and as Sim Staff on the review gateway (Sim houses, sends mocked). No defect as manager. As staff the footer hung on "Still reading: the price advice", fixed and recorded in the bracket on INV-W28. What staff see is gated in the page by `canManage = owner || manager` (`useInventoryNextData.ts:500`): Write off is hidden (`RowDropdown.tsx:122`, test `RowDropdown.test.tsx:141`), the price is read-only (`InventoryTable.tsx:160`, test `InventoryNext.test.tsx:326`), and the price advice is never asked (`useInventoryNextData.ts:545`). Whether the gateway enforces the same split on count, transfer, pour and order was not checked here; that is the gateway PR's audit. Long data: the extreme fixture row (`page-long`) wraps without overflow. Two wording items go to P5: digit grouping on large bottle counts, and "in no zone" vs "Unassigned" in the Zone column. Findings INV-W28–W29, both approved.
- P5 Words — done 2026-10-02 on InventoryNext, code read plus the fixture harness. (a) Wine-only copy → INV-W30; refusal and failure sentences in house words → INV-W31. (b) The doubled "Placed on Orders" → INV-W32. (c) Digit grouping on counts → INV-W33. (d) "in no zone" vs "Unassigned" → INV-W34, after the founder's direction. (e) Vendors (ADR 0221): PASS, no user-facing provider, supplier or distributor in `inventory/next` or the six components it imports (grep). (f) A refusal is never shown as sent: PASS, approve-draft awaits the send (`procurement.service.ts` ~7756), and a refusal closes the draft and throws, so the letter reads "was not sent". (g) Spelling, units, dates, currency: the day bars' ISO dates → INV-W35. No US spellings found. Queued, not built: the hour tiles follow the viewer's clock, not the house's. All six findings approved.
- P6 Overlays — done 2026-10-02 on InventoryNext. Live key presses on the fixture harness, in the Browser pane (Chromium). The five sheets (Count, Order more, Write off, Transfer, Pour) each PASS: opening by keyboard puts focus on Close, Tab and Shift+Tab wrap inside, Escape closes, focus goes back to the opener (More, for Transfer and Pour), the body does not scroll while one is open, and each has `aria-modal="true"` and a label. The More menu: Enter opens it with focus on the first item, Escape closes it back to More, but it had no arrow keys, Tab left it open, and its ring was cut off → INV-W36. The three Tools overlays (Scan a menu, Storage locations, Map POS buttons) FAIL. Focus stays behind the backdrop, Escape does nothing, Shift+Tab walks out to the page, the page still scrolls, and the X on two of them has no accessible name. They are shared components (`components/scanner`, `components/inventory`), so they are queued, not fixed here; the queue row has the live results. Finding INV-W36 approved.

## 15. Rework on makeover B — the analysis (INV-W4, 2026-10-01)

The founder ordered a full rework on makeover direction B (Editorial, 2026-08-28) as the base,
in the order he fixed on 2026-09-11: analysis, then a drawn sketch in today's Mudavym look,
then code. Four read-only gatherings fed this section. Their raw files live outside the repo,
in `p4-scratch/review-snap-4/dossier/`:
- A, anatomy and endpoints
- B, the look and the rules
- C, B read line by line
- D, competitors

None of the four ran the page live, and items marked UNVERIFIED in them stay unverified here.

**What the page is for.** It is the stock number a sommelier trusts at 7pm, plus the two jobs
that keep that number true: count what drifted, and verify what arrived (§12).

/cellar owns several things this page must not duplicate:
- bottle identity
- the bottle's full record
- the menu
- hold-to-order

/inventory owns the rest:
- counts and reconcile
- par, runway and velocity
- zones and transfer
- receiving and verifying
- valuation
- the house price and name (ADR 0193, ADR 0124)
- the dropdown's paperwork depth

**What B keeps.** B keeps these parts, redrawn in today's look:
- **Header.** A sentence instead of tiles. Every figure in it is read, never assumed.
- **Chip tabs.** The attention chips become tabs, and below par means strictly `stock < par`
  (ADR 0129).
- **Pinned match.** A pinned delivery or invoice match sits on the page.
- **Rows.** 48px rows sorted by runway.
- **Dropdown.** The dropdown opens in place (ADR 0112 F8), as a non-modal block.
- **Honesty footer.** It stays.

The ground is paper by default, with charcoal as a per-person choice (ADR 0169). Type is
Fraunces, DM Sans and JetBrains Mono. The pages to imitate are CellarNext, orders' `LedgerRow`
and ReceiptsNext (dossier B §1).

**What B must not drop.** Live has about 25 facts and actions in the dropdown, and B keeps
about 9. Built literally, B would lose the detail the founder said to keep on 08-29. B
would drop:
- the adjust reasons
- transfer
- record pour
- reconcile
- the 14-day chart
- the day-of-week heat map
- the menu price and margin
- the auction lot
- the already-built Receipts & invoices card (`ReceiptDepth.tsx`)

The redraw keeps B's three-column frame and fills it back to live depth. It adds an action row
and a fourth block, **Paperwork** (dossier C §2).

**The named gap: receipts and invoices on the row.** Competitors reconcile on the invoice
itself. The item row shows what changed and links to the source line (dossier D, the
Restaurant365 cost-trail model).

These are possible on the row today with client work only (dossier A §4):
- every receipt of this wine from the ledger's purchase transactions, with order, unit cost
  and date
- the last agreed price for each vendor
- the documents for each order
- the door-count trail
- open the verify flow
- link an invoice line to this wine
- claim a credit for goods that never arrived

These need new or extended gateway routes:
1. orders by wine (today the client filters only the first 50 orders)
2. invoice lines by wine (`procurement_document_lines.inventory_id` exists, but nothing reads
   by it)
3. credits by wine
4. lots by wine, with source order and cost
5. the house's own price trail

**Honesty traps the rework must close.** These come from a code read, not a live check
(dossier A §5):
- The table shows the library name, not the house alias. If that holds live, it breaks
  ADR 0124. This is UNVERIFIED live.
- The Market column is structurally dead, because `retail_price_avg` is never selected.
- A par of 0 shows as 10.
- Unknown live stock, velocity, value and open ml show as 0.
- Lot and location reads that fail render as empty.
- Menu price is the library figure, not the house price (ADR 0193).
- An unknown type becomes "Red", and an unknown vintage becomes "NV".
- The lead time is hard-coded to 6 days, which disagrees with the server's reorder point.
- Breakage, comp and return are all booked as count reconciles, which resets "last counted".
- The velocity chart fills missing days with zeros, and "when it sells" covers only 16:00–23:00.
  /cellar fixed both by clipping to the span the till has evidence for (`wines.md:995-1003`).
- ~~The chips count Reconcile 6 and Price signals 8 on a house with 0 wines (§14 INV-W2).~~ [struck 2026-10-01: a misread of the dotted mono zero; all five chips read 0 — dossier E]

**Forks the sketch draws with a recommendation.** None of these is decided until the founder
answers.
- **F-1. Pinned match.** A calm dashed card on the page, or the counter's Verify verb only?
  Recommended: the card, because the counter is tucked to 52px on this page.
  [flipped 2026-10-01 by the adversarial pass: the counter's Verify verb is door counts by the
  case, while an invoice match is a different object. Now one quiet line, "N invoices wait for
  a match · Open in Receipts". The match is done in /receipts, not rebuilt here.]
- **F-2. Chips.** Filter tabs, or counts only? Recommended: filters, as live does today.
- **F-3. Healthy rows.** Fold them ("Forty more… Show them"), or list everything?
  Recommended: list everything sorted by runway, because folding hides stock.
  [changed: sort by severity first, then runway. Today a stock-out with no recent sales has a
  null runway and sorts last (`InventoryCommandPage.tsx:491-495`, `bits.tsx:16-21`). Above
  the table the page shows only the sentence header and one chip row.]
- **F-4. KPI tiles.** Recommended: replace them with the header sentence, with value on hand
  stated as "N of M wines priced".
- **F-5. Dropdown depth.** Recommended: B's frame filled to live depth, plus Paperwork and an
  action row.
  [changed: the dropdown stays formless, with no fields and no seal (ADR 0112 F8). "Record a
  count" opens a sheet with the seal. Paperwork stays compact: the last 3 receipts with their
  line actions, plus "All N". Today's inline manual adjust at `RowExpansion.tsx:360-392`
  breaks this rule.]
- **F-6. Ordering.** "Add to the draft" (append to the open vendor draft, or start one), or
  today's broken `/orders?draft=new` link? Recommended: append.
  [flipped: there is no vendor draft. One order is one wine (`procurement_orders.inventory_id`
  is NOT NULL). "Order more" hands off to the new-order sheet with this wine filled in
  (ADR 0160 Q3, two-step for now). The `/orders?draft=` params that are silently dropped get
  fixed.]
- **F-7. Adjust reasons.** Keep them in the action row, booked as their own ledger types, not
  as reconciles.
  [changed: write-off (breakage, comp, return) opens a sealed sheet, gated by role, with a
  typed route. Today the ledger controller has JwtAuthGuard only (`inventory-ledger.controller.ts:40,50,116`).]
- **F-8. Two doors to the first count.** /cellar "Bring into the cellar" and /inventory
  "Carry this bottle". Recommended: keep both, opening one sheet that makes one write.
- **F-9. Register.** Recommended: a simple people-facing top, with a dense table and dropdown
  below it.
- **F-10. Gateway work.** The five routes above, the velocity and heat-map fixes, and the
  Market select. All are backend changes, so they need the founder's yes.
  [changed: fewer routes. Orders by wine becomes an `inventoryId` filter on the existing list.
  Lots by wine and lines by wine stay as reads. The price trail is computed on the client.
  Added: a per-document match summary and the typed write-off route. Every new read keyed by
  an item resolves that item's owner and filters each joined table by `restaurant_id`, because
  `assertTenantMatch` sees only params, query and body. Reuse /cellar's clipped-velocity
  helpers instead of writing a third copy.]
  [added 2026-10-01, INV-W8: `GetTransactionsQueryDto.limit` and `.page` need `@Type(() => Number)`.
  Today any `limit` on `/inventory-ledger/transactions` is refused with a 400, because the global
  ValidationPipe transforms without implicit conversion. The page now sends no `limit`; the DTO fix
  belongs in this PR.]
  [added 2026-10-01, INV-W11: a per-item last-count read over `stock_counts` (counted, books said,
  difference, when, by whom), tenant-filtered like every new read above. The row line "counted N,
  books said M, off by X" lands with it; until then the row keeps "Last counted".]
  [added 2026-10-01, INV-W18: a cross-house export read. One request that returns the titles of
  every house the person belongs to, each house checked against an active membership and each
  house's rows carrying that house's own currency. Since ADR 0164 a session reads only its own
  house, so the page cannot do this with per-house list reads; "Export all locations" is off the
  new page until this lands.]

**Adversarial pass (dossier E, 2026-10-01).** A separate reviewer tried to kill this plan. It
checked 14 claims against the code: 10 confirmed, 1 wrong (the chip counts, struck above),
1 unverifiable live (the alias) and 1 stale citation (the `wines.md` line numbers, now
`inventory.service.ts:758-806`).

It also found traps that §15 had missed:
- The location filter is dead (`useInventoryPage.ts:77,464`).
- Search does not fold accents or handle the Turkish i.
- The activity read is capped at 2000 rows, and the gateway at 1000.
- The hour of day uses the server's clock (`getHours()`).
- Currency is hard-coded to `$` (`bits.tsx:9-13`).
- The spot-count outbox pending count has no caller (`spotCountOutbox.ts:92`).
- The table is not virtualised.
- No roles matrix exists. Only `canEditPrice` gates anything.

The plan has to restore three locked items it dropped:
- the Your price column (ADR 0193)
- the deliveries-waiting card (ADR 0192)
- the POS-mapping entry

The drawn sketch (INV-W4) takes in every change bracketed above.

**Build rulings (INV-W5, 2026-10-01, the founder's answers):**
- **Row actions.** Record a count, Order more and Write off stay as buttons. Transfer and Record a pour move into a quiet "More" menu, each opening its own sheet. They exist nowhere else in the app. Name and Pin are dropped.
- **Order more.** It reuses /cellar's in-place OrderCeremony (hold-to-approve, one order per title; `BottleLeaf.tsx:482-570`). There is no hand-off to /orders, and the /orders files are not touched. This replaces the drawn F-6 hand-off.
- **Write off.** Before the gateway PR it is a sealed sheet, shown to owners and managers only. It books a typed waste, comp or return on the existing ledger route. The server-side role guard follows in the gateway PR.
- **Go-live.** A new `InventoryNext` on the gate's next side. The App.tsx mount line goes through the shared queue, the legacy page stays, and the flag flip is the founder's keystroke. [corrected 2026-10-01, INV-W7: `inventory` is in `LIVE_PAGES` (`useMudavymDesign.ts:203`), so the flag is never read. Merging the mount line IS the go-live, which is why that line is held in the shared queue for the founder's word.]
- **Gateway work (F-10).** Its own PR, after the page. Until it lands, the page shows — wherever a read does not exist.
- **Empty house.** It replaces the parked W2 code, whose temporary switch is removed.
- **OD-TBD (INV-W11, 2026-10-01).** Phone-first counting (barcode, level tap, voice), the field's standard way to count, is parked together with the open "voice in the count sheet" departure. It is filed in `OPEN-DECISIONS.md` in this branch's last commit.

**OD-177** is overtaken for /inventory by INV-W4. The page ADR for this walk-through records
it.
