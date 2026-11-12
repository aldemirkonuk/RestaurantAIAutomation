# Round 15 PR re-test: low stock (#873), inventory CSV and base list (#874), photo note (#865), 2026-11-07

| PR | Targets | Verdict | Fails without the fix? |
|---|---|---|---|
| #873 `2c782165a` (on #842) | IN_TRANSIT/deleted mismatch, failed view read resets alerts, 1000-row cap, Turkish sort | **PARTIAL** | Yes: 3 of 4 gateway tests and the R7 web test fail on the base source |
| #874 `a55eb5521` (on #854) | CSV blank for an unread cost, unpaged base list | **PARTIAL** | Yes: 2 of 2 paging tests and 2 web tests fail on the base source |
| #865 `58f32000a` (on #833) | "confident count" wording | **PARTIAL** | Yes: 6 gateway tests and 2 web tests fail on the base source |

No REGRESSION found. **Not FIXED = 0, PARTIAL = 3, FIXED = 0, REGRESSION = 0.**

## Method and limits

- Read-only on the shared checkout: `gh pr view/diff`, a `git fetch` into temporary `refs/qa/*` refs (deleted afterwards).
- Tests ran in detached worktrees `/private/tmp/claude-501/qa-wt-r15-{873,874,865}` with node_modules symlinked. I removed all three. `qa-wt-r15-866..869` belong to other sessions and were not touched.
- Fixture house: 15 states plus a 16th (a house-declared beer), built in PGlite from all migrations of the #873 tree (`01-build-fixture.mjs`). The view, stock figures and movements come from the real SQL.
- Surfaces are the real code over a fake PostgREST (`fakepg.ts`). It does filters, `order`, `gt`, `limit`, `range`, `count: exact`, a server cap, and failures injected per request number.
- "Fails without the fix" means I restored the base version of the changed source files in the worktree and re-ran the PR's own specs. The worktree was restored afterwards.
- **Not done:** no real Supabase or PostgREST (cap, count header and keyset speed on the view are simulated). No browser; the web checks are vitest/jsdom. No Excel (the BOM point below is from the byte dump, not from opening a file). No `tsc`, lint, full suites, or `scripts/check_decision_claims.sh` (I started it, it ran past three minutes, and I stopped it).
- Probes and raw output are in `round15-probes-stock/`.

## #873: every low-stock read agrees; alert states kept on a failed read

### 1. 16 states across every surface (all must agree)

`out-873-surfaces.json`. A dash means no alert or not listed.

| Wine | Inbox | Dashboard alert | MCP low-stock | Chip read | On list |
|---|---|---|---|---|---|
| U1 uncounted, received 10 sold 8 (2/3) | low | warning | y | y | y |
| U2 uncounted, received 5 sold 5 (0/3) | critical | critical | y | y | y |
| U3 uncounted, never moved | - | - | n | n | y |
| C1 counted 2/5 | critical | critical | y | y | y |
| C2 counted 4/5 | low | warning | y | y | y |
| P0 par 0 | - | - | n | n | y |
| Z counted 0/3 | critical | critical | y | y | y |
| NEG -1/3 | critical | critical | y | y | y |
| RC counted above par | - | - | n | n | y |
| AR archived | - | - | n | n | n |
| CB closed bottle only | critical | critical | y | y | y |
| OB open bottle only | critical | critical | y | y | y |
| AT at par | - | - | n | n | y |
| **IT** `IN_TRANSIT` counted 1/3 | - | - | n | n | y |
| **DL** `deleted_at` set | - | - | n | n | **n** (now filtered) |
| **HD** house-declared beer, `master_wine_id` NULL, counted 1/3 | - | - | n | n | y |

| Surface | Low | Critical |
|---|---|---|
| Inbox (sweep rows) | 8 | 6 |
| Dashboard alert list | 8 | 6 |
| MCP low-stock, chip read | 8 | not given |
| `getStats.lowStockItems` | 8 | not given |
| **Dashboard card** | **9** | **7** |
| **`GET /inventory/summary`** | **9** | **7** |

- **IN_TRANSIT and deleted rows: FIXED.**
  - The card and the summary no longer count IT (the new `not_alerted` band, `common/stock-status.ts:110` `canRunLow`, `:145` in `bandOfRow`).
  - DL is dropped from the list read (`database.service.ts:48-60`).
  - Before: 10 low and 8 critical. Now: 9 and 7.
- **NEW residual H1 (the claim "cannot disagree" is still false): a house-declared row with `master_wine_id` NULL.**
  - `restaurant_inventory_one_catalogue_check` allows it (`master_wine_id IS NULL OR beverage_id IS NULL`). The migration `20260903171000_the_house_item_is_the_ledgers_key.sql:168` dropped the NOT NULL. The gateway's own error text for such a row names the beer case.
  - `v_low_stock_items` joins `master_wine_library` with an INNER JOIN, so the beer is never in the view.
  - `canRunLow` tests active, deleted and state, but not the join. It reads `true`, so the card and the summary count the beer low and critical (9 and 7). The inbox, the alert list, MCP and the chip say 8 and 6.
  - The PR's own guard fires: `Low-stock count disagreement ... v_low_stock_items says 8, classifyStock over restaurant_inventory says 9`.
  - On the page the beer sits in "Below par" (the sentence reads "None is out; 1 is below par") and is not in the alerts chip. IT stays "Below par" on the page too, but the card no longer counts it.
  - Reach: a counted non-wine house item. I did not check whether production has any. It is a schema-legal state and the product scope is "all beverages".
  - Fix: add `master_wine_id != null` to `canRunLow` (or widen the view); a beer below par never alerts anywhere today.
  - This PR's claim text in `claims.d/fix-low-stock-reads-agree.jsonl` ("every low-stock count shares the view's row filter") is false for this row.
- **Minor, page:** the page's own "Below par" chip still counts IT (6 rows, including IT and HD) while the card and alerts do not. That is arguably right for a physical shelf, but it is a third number.

### 2. Failed view read keeps the previous alert state (R5): FIXED

Stateful ledger plus the real `runEdgeSweep`, `reconcileRecoveries`, `evaluateInventoryItems` and `triggerDailyDigest` (`out-873-sweep.json`, `-sweep-midpage`, `-realtime-digest`). I stubbed the prefs, the state read and write, and `fireInstantAlert`, and cleared the instant-alert cooldown before every sweep so it could not hide a re-fire.

| Step | Result |
|---|---|
| Steady state (8 wines alerted), healthy sweep | 0 fired, 0 level changes |
| Whole view read fails | 0 fired, **0 writes**, all 8 levels kept (`low-stock-alerts.service.ts:324`, `:381`, `:527`, `:833` return on null) |
| Healthy read after the failure | 0 fired (only same-level upserts) |
| Outage in which AT crossed below par and C1 recovered | 0 fired, 0 writes during the outage |
| Healthy read after that outage | AT fires **once** (`[["AT_at_par_3of3"]]`), C1 is set to `ok`; a further sweep fires nothing more |
| 2500 low wines, **page 2 of the view fails** | 0 fired, 0 writes, 0 levels reset. Healthy: 3 pages, 1 grouped fire (the wines were not yet in the ledger in that probe), 2500 same-level writes |
| Real-time `evaluateInventoryItems` and the daily digest with the view failing | no state change, nothing sent |

- Both halves hold: a failure never reads as "all recovered", and recovery after it neither re-fires nor loses a crossing.
- The warning names the reason: `v_low_stock_items could not be read whole ... alert states kept, nothing sent`.

### 3. Pagination, 999 / 1000 / 1001 / 2500 / 5000 rows (all low), `out-873-n*.json`

| Rows | List | Card | Summary | Inbox | MCP, chip | Dashboard alert list |
|---|---|---|---|---|---|---|
| 999 | 999 | 999 | 999 | 999 | 999 | 999 |
| 1000 | 1000 | 1000 | 1000 | 1000 | 1000 | 1000 |
| 1001 | 1001 | 1001 | 1001 | 1001 | 1001 | **1000** |
| 2500 | 2500 | 2500 | 2500 | 2500 | 2500 | **1000** |
| 5000 | 5000 | 5000 | 5000 | 5000 | 5000 | **1000** |

- The list, the card, the summary, the inbox, the MCP read and the chip read the whole house (`readWholeWindow`, keyset on `id` with the exact count proving it whole). No duplicates in any size.
- **Residual H2 (silent cap): `DashboardService.getAlerts` (`dashboard.service.ts:1427`) and `getStats` (`:1188`) still make an unpaged select.** At 2500 wines `getStats` answers `totalWines 1000` and `lowStockItems 1000` against the card's 2500, and the alert list holds 1000. Neither says it stopped. Round 12 R6 named the "summaries"; these two were not touched. Dormant at today's size (one tenant, about 183 wines).
- **A page failing midway** (each surface alone, 2500 rows, page 2 fails):

| Failing table (page 2) | Throws, never partial | Other |
|---|---|---|
| `restaurant_inventory` | list, summary, card, MCP list | inbox and chip do not read it; **dashAlerts and dashStats still answer from the first 1000** (unpaged, so there is no page 2 to fail) |
| `v_low_stock_items` | summary, card, chip, MCP low-stock | inbox returns null and acts on nothing; **dashAlerts and dashStats answer 1000** |

  So the PR's reads are all-or-nothing; the two dashboard reads in H2 are the only ones that can answer from part of the house.
- Server cap lower than the page size (500 against 1200 rows): the list, the card and the inbox still read all 1200, because the helper adopts the server's page size from the count.
- A title landing mid-read: with a title sorting before the cursor the keyset read gives 2500 distinct rows; sorting after, 2501. No duplicate either way.
- Not tested: real PostgREST, and the speed of `ORDER BY id` keyset on the view's JOIN and EXISTS per page.

### 4. R7 Turkish sort: FIXED when the currency read worked

- `compareNames` uses `Intl.Collator(houseLocale(country))` (`useInventoryNextData.ts:321`, `:854`). With `tr` the order is Calka, Çalka, Ismet, İsmail, Okuz, Öküz; with `en` it is İsmail before Ismet.
- `locale` is undefined when `/settings/currency` is unreadable (`:854`), and then the browser's own order returns. Minor and cosmetic.

### 5. Does a test fail without the fix?

- `low-stock-reads-agree.spec.ts` on the base source: R1, R5 and R6 fail (3 of 4). `a-received-wine-not-counted-yet-runs-low.spec.ts` passes either way.
- `useInventoryNextData.test.tsx`: the R7 Turkish sort test fails on the base source (1 of 12).
- At head: 8 of 8 gateway tests and 12 of 12 web tests pass.
- No test covers the `master_wine_id` NULL row or the dashboard stats and alert reads, which is exactly where H1 and H2 sit.

### Verdict #873: PARTIAL

The IN_TRANSIT and deleted mismatch, the reset-on-failed-read bug and the 1000-row cap on the page, card, summary, inbox and MCP reads are fixed and tested. The house-declared (non-wine) row still splits the card and summary (9/7) from every alert surface (8/6), and the dashboard stats and alert list are still silently capped at 1000.

## #874: CSV says an unread cost; base list reads every page

### 1. CSV (`out-874-csv.csv`, `out-874-csv.json`): FIXED

- All four export paths now use `wacCell` and `valueCell` (`iv-export.ts:28-35`): the valuation file, the selection, "Export this row", and the count sheet (`InventoryNext.tsx:548-549`).
- A row whose cost read failed writes `could not be read` in WAC and Value at cost. A readable row with no cost on record still writes blank. The two are now different in the file.
- 29 rows with commas, quotes, newlines, Turkish letters and formula-start names parsed as 30 records of 13 columns each (header included), so no row split or merge.
- Formula starts (`=1+1`, `+90 212`, `-2+3`, `@SUM(A1)`, `=HYPERLINK(...)`) get a leading apostrophe from the existing `neutraliseFormula`. A plain `-5` name and `00123` pass as they are.
- Leading tab and space names are trimmed before they reach the file, so the formula test never sees them.
- Residuals, none new in this PR:
  - **Turkish letters and Excel:** the file has no byte-order mark. The first bytes are `"Ti` and the type is `text/csv;charset=utf-8` (`tableExport.ts:131-135`). Excel opens a BOM-less CSV in the ANSI code page, so `İsmail Şarabı` is expected to show as mojibake. Not opened in Excel.
  - The unread marker is text inside a numeric column, so a spreadsheet SUM skips those rows without saying so. It is stated in the file's own note on the page.

### 2. Base list, 999 / 1000 / 1001 / 2500 / 5000 (`out-874-n*.json`): FIXED for the count, with two flaws

- The list read 999, 1000, 1001, 2500 and 5000 rows exactly (offset `range`, `.order("id")`, page 1000; `database.service.ts:51-65`).
- A later page failing makes the whole read throw (the card, the summary and the MCP list threw in the probe); no partial list is returned.
- **Flaw A (duplicate row):** offset paging on a moving table. A title that sorts before the cursor and lands after page 1 shifts everything: the list returned 2501 rows with **1 duplicate** (`out-874-land-before.json`). The duplicate wine would be counted twice in the totals. #873's keyset read returns 2500 distinct for the same event. Rare (a title added during a three-request read) but real.
- **Flaw B (trusts the cap):** a short page ends the read (`data.length < PAGE`). With a server cap of 500 and 1200 titles the list returned 500 and the card reported 500 titles as if complete. `supabase/config.toml:18` and production both say 1000, so this is config drift only.
- **Residual H3 (the second unpaged read R13 named):** `fetchAnalytics` (`inventory.service.ts:258`) is still unpaged. With 1200 titles, 200 rows have no velocity or cover, and `analyticsReadable` is `true` for them (`out-874-analytics1200.json`: 1000 rows with velocity). So runway and pace go silently blank for rows past 1000. Dormant at about 183 wines.
- The unread-cost sort in the legacy page (`InventoryCommandPage.tsx:494`) puts an unread row last in both directions. Its test passes at head and fails on the base source.

### 3. Does a test fail without the fix?

- On the base source: `database.service.inventory-paging.spec.ts` 2 of 2 fail; `iv-export.test.ts` "the valuation CSV says when a cost could not be read" fails; `InventoryCommandPage.test.tsx` "sorts last by Value" fails (4 failures).
- At head: 2 of 2 gateway, 18 of 18 web.

### 4. Integration problem with #873

`git merge-tree` of #873 and #874 conflicts in `database.service.ts` (both rewrite `getRestaurantInventory`) and in `useInventoryNextData.test.tsx`. Whichever merges second must keep #873's version (keyset read, `deleted_at` filter, exact count), or flaws A and B come back and DL rows reappear.

### Verdict #874: PARTIAL

The CSV and the base-list count are fixed and tested. The list read can duplicate a row under a concurrent insert, the analytics read is still capped, and the branch conflicts with #873 on the same function.

## #865: photo note in plain house words, once

### 1. What the reader sees (`out-865-photo.json`; code `photo-count.service.ts:33`, `:198-215`; `InventorySheets.tsx:154-158`)

| Model reply | Count sheet text |
|---|---|
| no count, no note (or unparseable, or empty) | "The photo gave no count. Type the count, or take the photo again closer and in good light." |
| count, no note | "The photo suggests 6. It only fills the field - check it before you seal." (no duplicate sentence) |
| count and a note | the same, then the model's own sentence |
| spot-count panel, no count | red toast "The photo gave no count", and the note once under the thumbnail (the toast no longer repeats it) |

- The "confident" fallback is gone, and neither fallback sentence contains confidence, certainty, estimate, model or AI (checked by regex). The note is said once on both surfaces, and an empty note adds no empty sentence.
- Plain-word read for a non-technical owner: the no-count line is fine. Two older phrases stay: "It only fills the field" (screen language) and "seal". The "could not be read" line still ends in "JPEG or PNG" (from #833).

### 2. Residuals

- **P1 (the confidence word is not forced out):**
  - The fix is a prompt request ("with no word about confidence or certainty"). The service does not check the model's note.
  - A reply of `Low confidence: the label is hidden, I am not certain of the count.` goes through word for word, and so does `I estimate roughly 4, but the AI model cannot be sure.`
  - The sheet then reads "The photo suggests 4. ... Low confidence: ...". Only the fallback wording is guaranteed.
- **P2 (mixed languages in a Turkish house):**
  - The note language switches to Turkish for a TR house (`inventory.service.ts:662`), but every other word on the sheet is English (the web has no i18n).
  - A TR house reads "The photo gave no count. Sayıyı yazın ya da fotoğrafı daha yakından ve iyi ışıkta yeniden çekin." in one paragraph. This is a founder call (all English, or all Turkish), not just a bug.
- **P3 (the Turkish switch is unreliable):**
  - `countryCodeOf("Turkey")` returns `null`; only `TR`, `tr`, `Türkiye`, `Turkiye` and `TÜRKİYE` resolve. `Turkey` is the name the web country combobox lists (`apps/web/src/lib/countries.ts:254`), `Republic of Turkey` and `TUR` also fail, while Google Places writes `Türkiye`.
  - A house registered by picking Turkey from the list gets the English note. The gateway comment at `house-frame.ts:32` and ADR 0207 acknowledge this alias gap.
  - The fallback is English, so nothing breaks, but the feature is house-by-house inconsistent.
- **P4 (small, not new):**
  - `suggestedQty: "6"` (a string) gives no count with confidence "high" and the note "Six.", so the sheet reads "The photo gave no count. Six.".
  - The model's note is passed through unescaped and untruncated (a 800-character note reaches the sheet; React escapes `<script>` as text).
  - The item name still reaches the prompt raw (a newline and "Ignore previous" arrive as written).
- The `restaurants(country)` embed is safe: there is a single foreign key between `restaurant_inventory` and `restaurants` (checked in PGlite), so no ambiguous-embed error that would drop the wine name.

### 3. Does a test fail without the fix?

On the base source: 6 gateway tests fail (`photo-count.service.spec.ts` and `inventory.service.spec.ts`), plus `SpotCountPanel.test.tsx` "says the photo gave no count, and its note once, beside the photo" and an `InventorySheets.test.tsx` test fail (8 total). At head: 54 of 54 gateway, 64 of 64 web.

### Verdict #865: PARTIAL

The fallback wording is plain and once-only on both surfaces, and tested. The model's own note can still say "low confidence", and the Turkish note is mixed with an English page and does not resolve for `Turkey`.

## What to fix first

1. #873: make `canRunLow` require a wine-library row (or widen the view), so the beer stops splitting the card from the alerts (H1). Page the two dashboard reads, `getStats` and `getAlerts`, with `readWholeWindow` (H2).
2. #874: move to #873's keyset read when merging (flaw A), page `fetchAnalytics` (H3), and have a short first page check the count rather than trust 1000.
3. #865: filter confidence and estimate words out of the model's note, or drop the note when it has them; decide the language rule once (P2, P3).
