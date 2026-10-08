## /inventory rebuild (InventoryNext): what the walk-through found and left for other branches — OPEN (8 items) — 2026-10-08

Filed by `fix/review-inventory` ([ADR 0315](../decisions/0315-inventory-is-rebuilt-as-inventorynext-on-makeover-b.md)). Claims: `../decisions/claims.d/fix-review-inventory.jsonl:1-2`. Rows and evidence are in `.planning/06-pages/inventory.md` §14.

**Fixed on this branch** (each row approved by the founder unless marked): the page rebuild INV-W4..W37; URL state and the four deep links, INV-W38 (not asked); price-cell contrast and the book's table name, INV-W39 (not asked); the `/` hint on phones, INV-W40 (not asked).

**Open, not fixed here:**

1. **`RowDropdown.tsx` reads `record.data?.books.find` without a guard.** If a row-record body has no `books`, the whole page blanks, because nothing above it catches the error. The gateway sends `books` today, so this is latent. Found in P9 on 2026-10-01 and not re-checked since. [changed 2026-10-08: FIXED on this branch after the #677 gate. It now reads `books?.find`, and a test feeds a body with no `books`.]
2. **The three Tools overlays fail the P6 key check** (Scan a menu, Storage locations, Map POS buttons). Focus stays behind the backdrop, Escape does nothing, and the X has no name on two of them. These are shared components (`components/scanner`, `components/inventory`), so the live results sit in `p4-scratch/review-shared-queue.md`.
3. **The currency query key `['settings','currency']` carries no house id.** After a house switch, the cached currency could belong to the previous house. Not measured. [changed 2026-10-08, #677 gate: likely moot. A house switch calls `forgetHouseReads` (`AuthContext.tsx:57-66`, called at `:686`), which resets every cached query.]
4. **The day chart's hour tiles follow the viewer's clock, not the house's.** The page does not read the house's time zone (P5 g).
5. **`?filter=low-stock` and `?rec=` are sent to /inventory but read by no page,** the legacy page included (found in P7). The senders need either a target or removal.
6. **The shared shell reads twice on every load:** `auth/me` 3×, `auth/me/role` 2×, `organizations/branches` 2×, `users/:id/preferences` 2× (P9, 2026-10-08). Already queued from other pages, and repeated here as measured on /inventory.

7. **The mount line waits on three server fixes** (from the #677 security review, 2026-10-08; ADR 0315 Consequences): (a) the write-off role guard on the ledger `POST` (`inventory-ledger.controller.ts:39-50`, which has only `JwtAuthGuard`); (b) a retry with the same idempotency key and an edited amount confirms the new amount while the ledger keeps the first (`apply_stock_movement` and `record_glass_pour` look up by key alone; the sheet fields stay editable after an error); (c) `approveOrder` has no status check (`procurement.service.ts:4132-4200`), so a second approve reserves shadow stock again. (a) and (c) belong in the gateway F-10 PR. (b) is a page fix or a server refusal.
8. **A violet (reconcile) tile on the Cellar map loses its severity tint** in the side panel (INV-W19, live at merge on the legacy page). Disclosed, not fixed.

**Owed records:** the phone-first counting fork (INV-W11: barcode, level tap, voice) was meant for `OPEN-DECISIONS.md`. It is NOT filed on this branch, because a new row at the top of Open re-anchors about 173 citations across about 89 files. It needs its own docs branch.

**Owed to the founder (open):** the three departures flagged in INV-W7 (no voice in the count sheet, `$` in the owner price editor, CSV-only exports) and the mount line. [changed 2026-10-08: the founder answered the toolbar look (keep the compact `.iv-toolbar .mdv-select` patch) and said yes to opening the PR, #677.]
