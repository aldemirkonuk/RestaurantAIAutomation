## /inventory rebuild (InventoryNext): what the walk-through found and left for other branches — OPEN (6 of 8 items; items 1 and 7 fixed) — 2026-10-08

Filed by `fix/review-inventory` ([ADR 0315](../decisions/0315-inventory-is-rebuilt-as-inventorynext-on-makeover-b.md)). Claims: `../decisions/claims.d/fix-review-inventory.jsonl:1-2`. Rows and evidence are in `.planning/06-pages/inventory.md` §14.

**Fixed on this branch** (each row approved by the founder unless marked): the page rebuild INV-W4..W37; URL state and the four deep links, INV-W38 (not asked); price-cell contrast and the book's table name, INV-W39 (not asked); the `/` hint on phones, INV-W40 (not asked).

**Open, not fixed here:**

1. **`RowDropdown.tsx` reads `record.data?.books.find` without a guard.** If a row-record body has no `books`, the whole page blanks, because nothing above it catches the error. The gateway sends `books` today, so this is latent. Found in P9 on 2026-10-01 and not re-checked since. [changed 2026-10-08: FIXED on this branch after the #677 gate. It now reads `books?.find`, and a test feeds a body with no `books`.]
2. **The three Tools overlays fail the P6 key check** (Scan a menu, Storage locations, Map POS buttons). Focus stays behind the backdrop, Escape does nothing, and the X has no name on two of them. These are shared components (`components/scanner`, `components/inventory`), so the live results sit in `p4-scratch/review-shared-queue.md`.
3. **The currency query key `['settings','currency']` carries no house id.** After a house switch, the cached currency could belong to the previous house. Not measured. [changed 2026-10-08, #677 gate: likely moot. A house switch calls `forgetHouseReads` (`AuthContext.tsx:57-66`, called at `:686`), which resets every cached query.]
4. **The day chart's hour tiles follow the viewer's clock, not the house's.** The page does not read the house's time zone (P5 g).
5. **`?filter=low-stock` and `?rec=` are sent to /inventory but read by no page,** the legacy page included (found in P7). The senders need either a target or removal.
6. **The shared shell reads twice on every load:** `auth/me` 3×, `auth/me/role` 2×, `organizations/branches` 2×, `users/:id/preferences` 2× (P9, 2026-10-08). Already queued from other pages, and repeated here as measured on /inventory.

7. **The mount line waits on three server fixes** (from the #677 security review, 2026-10-08; ADR 0315 Consequences): (a) the write-off role guard on the ledger `POST` (`inventory-ledger.controller.ts:39-50`, which has only `JwtAuthGuard`); (b) a retry with the same idempotency key and an edited amount confirms the new amount while the ledger keeps the first (`apply_stock_movement` and `record_glass_pour` look up by key alone; the sheet fields stay editable after an error); (c) `approveOrder` has no status check (`procurement.service.ts:4132-4200`), so a second approve reserves shadow stock again. (a) and (c) belong in the gateway F-10 PR. (b) is a page fix or a server refusal. [changed 2026-10-08: all three are in PR #685 (`fix/inventory-mount-line-server-guards`); (b) is the server refusal.] [changed 2026-10-30: resolved, #685 merged as 9914f5cbf.]
8. **A violet (reconcile) tile on the Cellar map loses its severity tint** in the side panel (INV-W19, live at merge on the legacy page). Disclosed, not fixed.

**Owed records:** the phone-first counting fork (INV-W11: barcode, level tap, voice) was meant for `OPEN-DECISIONS.md`. It is NOT filed on this branch, because a new row at the top of Open re-anchors about 173 citations across about 89 files. It needs its own docs branch.

**Owed to the founder (open):** the three departures flagged in INV-W7 (no voice in the count sheet, `$` in the owner price editor, CSV-only exports) and the mount line [changed 2026-10-30: the founder answered the go-live, "Flip now, port with wave (Recommended)", ADR 0315's last bracket]. [changed 2026-10-08: the founder answered the toolbar look (keep the compact `.iv-toolbar .mdv-select` patch) and said yes to opening the PR, #677.]

### Added 2026-10-31: five-act port (founder "Port all 5, then flip"). The open items are the same as on the legacy page, so the flip does not cause them. The two "now" bullets at the end are changes this branch makes.
- **Remove and Mark inactive are open to staff.** On legacy they are open to staff too, but Write off is manager-only. Whether to limit these two to managers is open, and needs a gateway guard as well as the UI.
- **Mark active cannot be reached.** The gateway list returns only active rows, which is also true on legacy.
- **`RemoveFromInventoryModal` and `ManualReceiptWorkspace` are still legacy framer-motion modals.** They are not yet the ADR 0112 Sheet, and Remove writes ledger rows without a sealed hold.
- **`RemoveFromInventoryModal` shows the server's raw text on failure.** It also deletes a row that holds only an open bottle without reconciling it first.
- ~~**Bulk remove was not ported.** Next has no row selection.~~ [resolved 2026-10-31, same branch: Next has row selection with Remove selected, Export selected and Copy names, and an "Export this row" item in More. Still different from legacy: exports are CSV only (the INV-W7 departure), Escape does not clear the selection, and the right-click Copy name / Draft PO items have no counterpart — Order more covers drafting (INV-W5).]
- **Retries with an unknown outcome are now named.** After a 5xx or no answer, a manual receipt or an auction-lot start says the outcome is unknown and re-reads the book, rather than claiming nothing was written. The bulk create still has no idempotency key, so the server-side fix is owed.
- **Mark inactive waits while stock is held.** This is stricter than legacy, which allowed it. It is disabled while live, shadow or open-bottle stock is above zero or unread. Marking a title inactive with stock still in it would leave `stock_live` out of step with its lots if the title were added again.
