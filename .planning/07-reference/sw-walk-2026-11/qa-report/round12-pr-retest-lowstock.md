# Round 12 PR re-test: low stock said one way (#842, on #814 and #813), 2026-11-07

Verdict: **PARTIAL.** The three QA 9c symptoms are FIXED and their tests fail without the fix. The umbrella claim "the numbers can no longer disagree" is still false for two kinds of row, and I reproduced it.

## Method

- Read-only on the shared checkout: `gh pr view/diff`, and a `git fetch` into a temporary ref that I deleted afterwards.
- Tests ran in the detached worktree `/private/tmp/claude-501/qa-wt-r12-1`, head `459910066` (#842, which stacks #814 and #813). node_modules were symlinked. I removed the worktree afterwards, and the `qa-wt-r12-20..23` and `-71..73` worktrees are other sessions', untouched.
- The fixture house is built in PGlite from all 302 migrations of the #842 tree (`01-build-fixture.mjs`). The view, the stock figures and the movements come from the real SQL: `apply_stock_movement`, `record_stock_count`, `v_low_stock_items`.
- The surfaces are the real code over a fake PostgREST: filters, the `max_rows = 1000` cap, injectable read failures.
  - **Inbox alert:** `LowStockAlertsService.getLowStockByRestaurant` and `mapRow`.
  - **Dashboard:** `DashboardService.getAlerts` and `getInventorySummary`.
  - **Inventory API:** `InventoryService.getInventorySummary` and `getRestaurantInventory` (the list).
  - **Page:** the web `toRow`, `chipMatch`, `severity`, `readSentence`, `sortRows`, over that list.
- Probes are in `round12-probes-lowstock/`. Run output is in the `out-*.json` files there.
- **PGlite is one session.** No real Supabase, no browser, no real `max_rows` (a fake cap).

## 1. One house, every state, every surface

PGlite fixture, 15 wines. Columns: inbox severity, dashboard alert severity, on the `/inventory` list, page standing.

| Wine (stock/par) | Inbox | Dashboard alert | On list | Page standing |
|---|---|---|---|---|
| U1 uncounted, received 10 sold 8 (2/3) | low | warning | y | below |
| U2 uncounted, received 5 sold 5 (0/3) | critical | critical | y | uncounted |
| U3 uncounted, never moved (0/3) | none | none | y | uncounted |
| C1 counted 2/5 | critical | critical | y | below |
| C2 counted 4/5 | low | warning | y | below |
| P0 par 0, counted 0 | none | none (an "out of stock" alert instead) | y | out |
| Z counted 0/3 | critical | critical | y | out |
| NEG stock -1/3 | critical | critical | y | out |
| RC counted 6/3 recently | none | none | y | above |
| AR archived (`is_active` false), 1/3 | none | none | **n** | not listed |
| CB closed bottle only 1/3 | critical | critical | y | below |
| OB open bottle only: lot qty 0, 400 ml open (0/3) | critical | critical | y | out |
| AT at par 3/3 | none | none | y | at |
| **IT** `IN_TRANSIT`, counted 1/3 | **none** | **none** | y | **below** |
| **DL** `deleted_at` set, counted 1/3 | **none** | **none** | y | **below** |

- **Par null is not a database state.** `threshold_min` is NOT NULL (insert refused). The client turns a null par into 0 (`normalizeInventoryItem`: `thresholdMin ?? 0`), and the page reads that as `nopar` (probe `syn`).
- **No CHECK on `stock_live >= 0`.** A direct update to -1 was accepted, and all surfaces call it critical.
- **Open bottle:** a lot with `qty 0` and `open_bottle_ml` 400 gives `stock_live` 0. Every surface counts bottles only, so it is "0 bottles, critical" everywhere. They agree with each other, though the liquid is ignored.

Counts, same rows:

| Surface | Low | Critical |
|---|---|---|
| Inbox (sweep rows) | 8 | 6 |
| Dashboard alert list | 8 alerts | 6 critical |
| `GET /inventory/summary` | **10** | **8** |
| Dashboard card (`getInventorySummary`) | **10** | **8** |
| Page "Low-stock alerts" chip | 8 | n/a |
| Page: Out 4, Below par 6, Not counted yet 2 | | |

- **The original symptom is closed.** The dashboard card and `/inventory/summary` now give identical figures, 8 and 8 for critical, from the shared `summarizeStock`. The inbox and the dashboard alert list agree row for row, and the chip holds exactly the 8 view ids.
- **The remaining disagreement (R1):** the card and the summary say 10 low and 8 critical. The inbox and the dashboard's own alert list say 8 and 6. The extra two rows are IT and DL.
  - **Cause:** `database.service.ts:42-53` (`getRestaurantInventory`) filters only `is_active = true`. The view (`20270325100000_...sql:77-85`) also requires `deleted_at IS NULL` and `inventory_state <> 'IN_TRANSIT'`.
  - **Evidence:** the PR's own guard logs it: `Low-stock count disagreement ... v_low_stock_items says 8, classifyStock over restaurant_inventory says 10`.
  - **Page effect:** the page lists IT and DL and calls them Below par (chip 6), while the alerts chip does not hold them.
  - **Reach:** I did not find a gateway writer of `inventory_state = 'IN_TRANSIT'` or of `deleted_at` on inventory rows. Only the Python agents write `inventory_state`, and I did not trace them. So it is dormant but real.
  - **Why it is the PR's to fix:** `stock-status.ts:143-151` says "so they cannot disagree".
  - **Fix:** add `deleted_at IS NULL` and the state filter to `getRestaurantInventory`, or classify only rows the view could hold.

## 2. The #814 PARTIAL items, re-tested

- **"Nothing is out or below par" while the alert fires: FIXED.**
  - I built a one-wine house for each of the 15 states and read `readSentence`. Every wine in the view reads as a low state (`None is out; 1 is below par`, `1 is out`) or as "not counted yet" (the two uncounted zeros). The "Nothing is out or below par" sentence appears only for RC and AT, which no surface alerts. No in-view wine is ever denied.
  - This is **not** from #842: `readSentence` and `standingFor` are not in its diff. It comes from the #814 head (`useInventoryNextData.ts:162-164, 287, 581-586`).
- **Dashboard and `/inventory` disagree on criticalCount: FIXED for every row the view holds.** Both go through `summarizeStock`. U2 (received 5 sold 5, par 3) is critical in the inbox, the dashboard alert, the dashboard card and `/inventory/summary`.
  - This was also already unified in the #814 base (`dashboard.service.ts:636`). What #842 adds is the **dashboard alert list** severity (`dashboard.service.ts:1462-1476`, `alertBandOfViewRow`).
- **Pre-fix mutant:** with `stock_live === 0 ? "critical"` restored, C1 (2/5), NEG and CB read **critical in the inbox and warning on the dashboard**. With #842 they read critical in both.

## 3. Does a test fail without the fix? Yes.

I restored `severity: item.stock_live === 0 ? "critical" : "warning"` and removed the `restateCountedAlerts()` call, then ran `low-stock-one-voice.spec.ts`: **2 of 5 failed**.
- `the dashboard's alert list and the alert service give every view row the same severity`
- `the edge sweep rewrites the stored row's message and metadata before it evaluates`

This matches the PR's own revert proof. The worktree was restored afterwards.

## 4. Item 3: restate on count

- A read failure on `notifications`, or on the counted-wines read, returns 0 and does not throw (probe `out-restate.json`).
- A digest row has its `wines[]` restated and its message left alone.
- A count back above par reads "Counted since: 6 bottles (par: 3). The alert's 2 was by receipts and sales." The inbox row stays, with an accurate sentence.
- **Minor (R4):** a restated entry keeps its old `severity`, and the row keeps its old `priority` and title. 2/3 uncounted ("low") counted at 1/3 (critical) still carries `severity: low`. The message makes no band claim, so nothing contradicts on screen, but the metadata is stale.

## 5. Item 4: `?filter=low-stock`

- The chip is backed by `GET /inventory/:id/low-stock`, the view. Its 8 ids equal the inbox's 8 rows.
- Until the list is read, or if it fails, the chip is disabled with the dash and the page shows every title (`InventoryNext.tsx`, `activeChip` fallback). The footer line names the unread read.
- The aliasing is read-only, so alerts and emails already stored keep working.

## 6. One read fails

| Failed read | Inbox sweep | Dashboard alert list | Card | `/inventory/summary` | List |
|---|---|---|---|---|---|
| `v_low_stock_items` | empty map, warns only | throws, so no false all-clear | throws | throws | 14 rows |
| `restaurant_inventory` | unaffected, 8 rows | throws | throws | throws | throws |

- **Good:** none of the user-facing surfaces turns a failed read into an empty list. This is the ADR 0067 behaviour.
- **R5, pre-existing, not in #842:** when the view read fails, `getLowStockByRestaurant` returns an empty map (`low-stock-alerts.service.ts:1275-1278`). `runEdgeSweep` then calls `reconcileRecoveries` with that empty map (`:1227-1263`), and I reproduced it writing `last_alert_level = 'ok'` for **both** stale states.
  - The next healthy sweep sees every wine as a fresh crossing, so one blip re-fires every instant alert.
  - #842's `restateCountedAlerts` runs before that and fails soft, so it does not make this worse.

## 7. 1000-row cap

I simulated 1100 wines, 1050 low and critical, with `max_rows = 1000` (`supabase/config.toml:18`).
- Card and `/inventory/summary` both read **1000 titles, 950 low, 950 critical** (truth 1100, 1050, 1050).
- The list is also 1000 rows, and the footer reads "All 1000 of 1000 titles are listed". The select has no order, so *which* 1000 is the database's pick.
- The inbox's all-house view read is also capped at 1000 rows, and the capped-off wines would be marked recovered by R5's path.
- The surfaces agree with each other on the capped data. The gateway warning fires only by accident (view 1000 vs 950).
- Pre-existing and unreachable at today's size: one tenant, about 183 wines (per a comment at `dashboard.service.ts:1456-1459`). Not in #842.

## 8. Turkish names sort

`sortRows(..., 'name')` and `needsYouFirst` use `localeCompare` with no locale (`useInventoryNextData.ts:329, 359`).

| Locale | Order of the names that differ |
|---|---|
| `en` and the default (`en-US`) | İsmail Şarabı, Ismet; Öküzgözü, Okuzgozu IT |
| `tr` | Ismet, İsmail Şarabı; Okuzgozu IT, Öküzgözü |

- The same house's list order depends on the viewer's browser locale.
- Cosmetic. No surface disagrees about low stock because of it, and the alert surfaces do not sort by name.
- Ç, Ş, Ğ, Ö sort beside C, S, G, O in both locales.

## Findings

| # | Severity | Finding |
|---|---|---|
| R1 | Medium-low (dormant states) | Card and `/inventory/summary` count `IN_TRANSIT` and `deleted_at` rows as low or critical. The inbox, the dashboard alert list and the chip do not, and the page calls them Below par. |
| R4 | Low | A restated entry keeps its old `severity`, `priority` and title. |
| R5 | Medium, pre-existing | A failed view read silently resets every alert state to `ok`, so the next sweep re-alerts. |
| R6 | Low, pre-existing | The 1000-row cap is silent on the list and the summaries. |
| R7 | Cosmetic | `localeCompare` has no locale, so the Turkish sort order varies with the browser. |

## Not verified

- No real database (PostgREST filters and the cap are a fake), no browser, no two-connection concurrency.
- eslint and the full gateway and web suites were not run, only the PR's new spec and my probes.
- The Python agents' writes of `inventory_state` were not traced, so R1's reach is unproven.
- Whether `deleted_at` on inventory is ever set in production was not checked.
