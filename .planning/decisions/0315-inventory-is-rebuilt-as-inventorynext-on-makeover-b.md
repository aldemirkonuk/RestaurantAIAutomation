# 0315 — /inventory is rebuilt as InventoryNext on makeover B, and goes live only by the mount line

- **Status:** Locked (the founder's rulings, INV-W4..W37), with three rows built by executor R4 under his 2026-10-07 delegation (INV-W38..W40) and open to his reversal at the PR
- **Date:** 2026-10-08
- **Decider:** Aldemir (founder), in the R4 walk-through, 2026-10-01..2026-10-03. Rows W38–W40 were decided by executor R4 under the founder's delegation of 2026-10-07T20:04:10Z: *"Do not ask me questions, I allow and approve for you to decide on your own. If its a decision question then research deep, find answers. While you can change decisions, you cannot change any feature we decided unless it breaks everything"*. They are not his picks.
- **Keywords:** inventory, InventoryNext, makeover B, editorial, row actions, order ceremony, write off, URL state, deep links, contrast, OD-177, go-live, mount line
- **Links:** `.planning/06-pages/inventory.md` §14 (rows INV-W1..W40 and the P1–P10 pass lines) and §15 (the analysis and the build rulings, INV-W5) · [[0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes]] (line 826, item 6: "the URL holds it") · [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] · [[0266-an-orders-vendor-letter-is-staged-once]] (F0: the kept letter, INV-W37) · OD-177 in `OPEN-DECISIONS.md` · makeover artboard `p4-scratch/makeover-artboards/B-Inventory.dc.html` · `p4-scratch/review-shared-queue.md` (the mount line) · branch `fix/review-inventory`

## Context

On 2026-09-04 the founder said `/inventory` was "not being redesigned". That word was recorded only in an `App.tsx` comment, and both sides of the page gate render `InventoryCommandPage` (sketch 038, July). OD-177 lists the page as the largest legacy surface still inside a live route. On 2026-10-01, walking the page with house YARDOM, he reversed the word: "We need full rework of the inventory … this is the old version" (INV-W4). A search found that no newer /inventory had ever been built. He picked makeover B, Editorial, as the base, since it is the only direction that keeps the row drop-down in place and shows the invoice match (MAKEOVER-VERDICTS.md:66-73). He set the order: a UX analysis (§15 and dossiers A–E), then a drawn sketch in today's Mudavym look, then code.

## Options considered

1. **Keep `InventoryCommandPage`, restyled.** It was the 2026-09-04 word. It keeps sketch 038's row of seven actions and the old look, and the founder rejected it at INV-W4.
2. **Makeover A or C.** Both were drawn on 2026-08-28. Neither keeps the drop-down beside the row, and the 08-29 verdict named the gap as "receipt and invoice actions".
3. **Makeover B, built as a new page behind the gate (chosen).** The page is new (`pages/inventory/next/`) and the legacy page stays whole until the mount line is merged.
4. *(Doing nothing leaves OD-177's biggest surface legacy and the 2026-09-04 exception unrecorded.)*

## Decision

`/inventory` becomes `InventoryNext`, makeover B in the Mudavym look, built on branch `fix/review-inventory` one approved row at a time. The founder's build rulings (INV-W5, verbatim in §15) carry it:

- **Row actions.** Record a count, Order more and Write off are buttons. Transfer and Record a pour sit in a quiet "More" menu, each with its own sheet. Name and Pin are dropped.
- **Order more** reuses /cellar's in-place OrderCeremony: one hold, one order per title, no hand-off to /orders. An inline draft is then sent (INV-W26). Approval moved onto the send hold, because the order seal must be minted when the gesture starts.
- **Write off** is a sealed, typed sheet (waste, comp or return) for owners and managers, on the existing ledger route. The server-side role guard comes in the gateway PR.
- **Go-live is the mount line.** `inventory` is in `LIVE_PAGES` (`useMudavymDesign.ts:203`), so no flag is read, and merging the `App.tsx` line that puts `InventoryNext` on the gate's next side IS the go-live (INV-W7). That line is held in the shared queue for the founder's word. The branch's PR ships the page dark, and `App.tsx` matches main.
- **The empty house** replaces the parked W2 variant.
- **The gateway work (F-10)** is its own PR after the page. Until it lands, the page shows — wherever a read does not exist and never invents a figure.

Rows W8–W37 refine these. Each one is in §14 with its evidence and the founder's verdict.

**Built under the delegation, not asked (INV-W38..W40):**
- **W38, URL state.** The view (chip, search, zone, type, sort, table or map, open row) is in the URL, and the links other pages already send are honoured: `?wine=`, `?highlight=` (a row id or a wine id), `?name-delivery=`, and `?verify=`, which goes to `/receiving?order=`. *Why:* ADR 0160 already rules that the URL holds page state, so this follows a locked decision. *Rejected:* keeping `useState`, which breaks four live deep links; a `?verify=` sheet on this page, which would rebuild verify outside Receiving, where deliveries are checked now.
- **W39, contrast and a name for the book.** The legacy price cell's grey units measured 2.83:1. They are lifted to `--ink-2` on this page only, and the table gets a screen-reader caption. *Rejected:* `--ink-3`, which measures 4.07:1 on the open row's `--paper-1`; editing `HousePriceCell` itself, which would change the legacy page that still renders with the flag off.
- **W40.** The `/` shortcut hint is hidden on touch-only screens.

**OD-177, for /inventory only:** overtaken. The 2026-09-04 "not being redesigned" exception is withdrawn by the founder's INV-W4 word. The other surfaces in OD-177 stay open.

## Consequences

- The page states only what it read. A pending or failed figure is "—", never 0 (W28, W29), and failures are said in the house's words (W31).
- Two inventory pages exist until the mount line merges, and fixes to shared pieces (`HousePriceCell`, `CellarMapView`) must keep both rendering. The legacy page is deleted once, after go-live (ADR 0149).
- Queued, not built here (each listed in §14 or the shared queue): the gateway F-10 PR (ledger DTO `@Type`, the write-off role guard, a merged flag on `POST /procurement/orders`, `approveDraft` checking the order's status), the three Tools overlays that fail the P6 key check, the shared shell's duplicate reads, `RowDropdown`'s unguarded `books`, the currency query key with no house id, and the hour tiles following the viewer's clock.
- Open with the founder: the three departures flagged in INV-W7 (no voice in the count sheet, `$` in the owner price editor, CSV-only exports); phone-first counting (OD-TBD, INV-W11); and the mount line. [changed 2026-10-08: the founder kept the compact toolbar patch after #567 and said yes to opening the PR, #677.]
- **Revisit if** the founder reverses W38–W40 at the PR, or the gate stops treating `inventory` as live (then the flag, not the mount line, becomes the go-live).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-08 | executor R4 | Created; rows W4–W37 approved by the founder in the walk-through, W38–W40 built under the delegation |
