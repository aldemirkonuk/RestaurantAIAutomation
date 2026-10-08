## /inventory rebuild (InventoryNext): what the walk-through found and left for other branches — OPEN (6 items) — 2026-10-08

Filed by `fix/review-inventory` ([ADR 0315](../decisions/0315-inventory-is-rebuilt-as-inventorynext-on-makeover-b.md)). Claims: `../decisions/claims.d/fix-review-inventory.jsonl:1-2`. Rows and evidence are in `.planning/06-pages/inventory.md` §14.

**Fixed on this branch** (each row approved by the founder unless marked): the page rebuild INV-W4..W37; URL state and the four deep links, INV-W38 (not asked); price-cell contrast and the book's table name, INV-W39 (not asked); the `/` hint on phones, INV-W40 (not asked).

**Open, not fixed here:**

1. **`RowDropdown.tsx` reads `record.data?.books.find` without a guard.** If a row-record body has no `books`, the whole page blanks, because nothing above it catches the error. The gateway sends `books` today, so this is latent. Found in P9 on 2026-10-01 and not re-checked since.
2. **The three Tools overlays fail the P6 key check** (Scan a menu, Storage locations, Map POS buttons). Focus stays behind the backdrop, Escape does nothing, and the X has no name on two of them. These are shared components (`components/scanner`, `components/inventory`), so the live results sit in `p4-scratch/review-shared-queue.md`.
3. **The currency query key `['settings','currency']` carries no house id.** After a house switch, the cached currency could belong to the previous house. Not measured.
4. **The day chart's hour tiles follow the viewer's clock, not the house's.** The page does not read the house's time zone (P5 g).
5. **`?filter=low-stock` and `?rec=` are sent to /inventory but read by no page,** the legacy page included (found in P7). The senders need either a target or removal.
6. **The shared shell reads twice on every load:** `auth/me` 3×, `auth/me/role` 2×, `organizations/branches` 2×, `users/:id/preferences` 2× (P9, 2026-10-08). Already queued from other pages, and repeated here as measured on /inventory.

**Owed records:** the phone-first counting fork (INV-W11: barcode, level tap, voice) was meant for `OPEN-DECISIONS.md`. It is NOT filed on this branch, because a new row at the top of Open re-anchors about 173 citations across about 89 files. It needs its own docs branch.

**Owed to the founder (open):** the three departures flagged in INV-W7 (no voice in the count sheet, `$` in the owner price editor, CSV-only exports), the toolbar look now that #567 has merged, the mount line, and the PR.
