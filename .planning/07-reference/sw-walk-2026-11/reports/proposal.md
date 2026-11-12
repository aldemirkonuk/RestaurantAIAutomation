# /reports: build proposal (2026-11-07)

Read from `origin/main` at e26a5152d with `git show` and `git grep` only. Nothing was built, rendered or run, and production was not touched. The inputs were `audit.md`, `sota.md` and the verifier's verdicts. Where a verdict narrowed a gap, its corrected claim is used here. No verdict refuted a gap.

Short paths used below:
- `web/` = `apps/web/src/`
- `next/` = `apps/web/src/pages/reports/next/`
- `gw/` = `apps/api-gateway/src/`
- `adv` = `gw/analytics/advanced-analytics.service.ts`
- `svc` = `gw/analytics/analytics.service.ts`
- `ctl` = `gw/analytics/analytics.controller.ts`

The founder's /goal of 2026-11-07 delegated every fork, so every call in §4 is **the session's call**. None of them was asked.

---

## §1 Verdict

1. The sheet is well built for reading on a wide screen, but its one saved layout is unsafe. Arranging below 996 px writes 6-, 4- or 2-column coordinates over the desktop sheet (`next/Sheet.tsx:96`, `:99-107`; `next/rp-sheet.ts:166-172`). A cold load lets the default sheet be saved over the reader's own (`web/hooks/useUserPreferences.ts:133`; `next/useReportsNextData.ts:242,348`). "Ruled off." is shown before the save lands (`next/ReportsNext.tsx:165-171`). Together these are the "cards switched places" bug.
2. Several numbers are wrong or mislabelled:
   - Money prints as `$`/en-US for every house (`next/rp-format.ts:32-35`), although the exports already name the house currency (`gw/reports/exports/report-export-cuttings.ts:18`).
   - Spend and weekday figures bucket by UTC day (`adv:239-255`, `:585-594`).
   - The cashflow projection's newest point is a 5-day week (`adv:690-693`).
   - A failed purchase-order read becomes "no delivered purchase order" (`adv:221-222`, `svc:217-218`).
3. No chart can be opened full-screen, and phones get no layout of their own (`next/reports-next.css` has no width `@media` rule). The fix is 13 lanes. Server correctness goes first, then the sheet's save path, then chart truth. A laid-flat route and a till comparison come last.

---

## §2 Target experience

This is a people page, so it stays simple. Dense figures belong only in the exports and the API. It uses Mudavym tokens only (`web/styles/mudavym.css`):
- ground `--paper-0/1/2` (`:169-171`)
- ink `--ink-1…4` (`:174-177`)
- accent `--seal`, `--seal-deep`, `--seal-tint` (`:142-145`)
- states `--warn` and `--loss` (`:185-188`)
- dark mode via the same names (`:211-255`)

No new colour is introduced.

| Screen | What the reader sees |
|---|---|
| **Sheet, wide (container ≥ 768 px)** | Today's 12-column sheet, unchanged in look. Each cutting gains one quiet control in its head, "Lay out flat" (an ink-3 icon button with an aria-label naming the register). Money prints in the house's currency. When the house has no recorded currency, figures print bare and one sentence sits under the date line: "This house has not recorded its currency; figures are plain numbers." |
| **Sheet, phone (container < 768 px)** | A single column in sheet order (top-to-bottom, then left-to-right, from the wide layout). Each cutting is full width with a phone floor height of about 300 px. Tables and heat maps scroll sideways inside their cutting, not the page. "Arrange" opens a list mode: remove, swap the subject, change the drawing, add. Moving and resizing are not offered, and the list says why in one line: "Moving cuttings needs a wider screen." Nothing a phone does writes coordinates. |
| **Arranging, wide** | As today, plus two changes. "Rule it off" shows "Ruling off…" until the save lands. Then it shows "Ruled off." for 2.4 s, and a second rule-off restarts that timer. If the save fails, the sheet stays in arranging mode with the draft intact and says "The sheet was not saved. Try again." The Arrange control stays disabled until the account's saved sheet has answered. |
| **Loading (cold)** | Paper outlines of the sheet in `--paper-1`, so nothing jumps when the saved layout arrives. Each cutting's read starts as soon as its id is known. The default sheet's reads are prefetched in parallel so the cache is warm. |
| **Laid flat (`/reports/flat/:id`)** | One register at the full page width, with the same window and drawing controls, and the basis and working lines open. Changes here are the reader's view only and are never saved to the sheet. A line says so: "This view is not saved to your sheet." Back returns to the sheet at its scroll position. On a phone this is the readable form of a 90-day or scatter chart, and landscape works because it is a page. |
| **Empty** | Wording as today, for example "The till answered, and no check fell inside this window." (`next/rp-registers-trade.tsx:219`). A closed day is a gap in the line or area, never a zero. |
| **Partial or refused** | The gateway's own sentence is shown, such as "The consumption lines in this window could not be read whole". It never shows "Request failed with status code 500". There is a retry, and no figure is claimed. A spend register whose orders could not be read says so; it never says "no delivered purchase order". |
| **Withheld (ADR 0348)** | As today (`next/useReportsNextData.ts:264-271`). The flat route applies the same hold-back. |
| **Model quality** | The forecast and the waiters register say it in words, for example "held close in past weeks" or "has missed often; read it as a direction". The raw model identifier and the MAPE and R² numbers leave the page (`next/rp-registers-trade.tsx:585-589`, `next/rp-registers-house.tsx:546-547`). |
| **Till window** | 7, 30, 90 and 365 days (today: 7, 30 and 90 at `next/Cutting.tsx:87`; the API takes 1–365, `ctl:1197`). A toggle, "against the period before", draws the previous equal-length window as a dashed `--ink-3` line and gives one worded delta. |

---

## §3 Phased build plan

All lanes are branched from `origin/main`. Each PR touches at most 15 files and stays under a 30K diff. A test that "fails on main" means one written first and run red at e26a5152d before the fix.

### Phase A: server correctness

| # | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| S1 | `fix/reports-orders-read-whole` | G6, G11 (server half) | `adv` (`loadOrders` `:202-223`) · `svc` (`loadDeliveredOrders` `:203-224`) · `ctl` (the 500 wraps at `:200-203`, `:1234-1237` re-throw `HttpException` / `WholeReadError`) · new `gw/analytics/orders-read-whole.spec.ts` · `.planning/tech-debt.d/2026-10-03-fix-analytics-reads-past-row-cap.md` (strike the closed lines) | (a) Over a stub capped at 1,000 rows per unranged read, with 1,001 delivered orders, `getCashflow().last30` sums all 1,001. (b) A `procurement_orders` error makes `getCashflow` and `getFinancialSummary` reject with `WholeReadError`; on main they resolve with zeros. (c) The controller answers 503 with the refusal sentence; on main it answers 500. | Rebase over whichever of #725, #730, #722 and #619 merges first. All four edit `adv`, and #725 also edits `ctl`. They touch different functions, so the conflict is textual only. |
| S2 | `fix/reports-house-day-spend` | G7, G8, G20 | `adv` (`toDaily` `:239-255`, seasonality `:572-666`, `getCashflow` `:672-728`, the `loadOrders` filter) · uses `gw/common/house-day.ts` `houseDayOf` `:160` / `readHouseZone` `:91` (unchanged) · new `gw/analytics/cashflow-house-day.spec.ts` · new `gw/analytics/seasonality-house-day.spec.ts` | (a) A US/Eastern house with an order delivered at `2026-11-02T01:00Z` (Sun 20:00 local) counts it on Sunday; main counts it on Monday. (b) 180 days give weekly buckets that are all 7 days, newest-aligned, with the oldest remainder dropped; on main the newest bucket is 5 days. (c) An order created 200 days ago and delivered 10 days ago is in `last30`; main excludes it (`adv:220` filters `created_at`). (d) A house with no zone answers `zoneUnset: true` with null figures, as the till does (`ctl:1191-1192`). (e) Seasonality no longer reads `restaurant_inventory`, and `categoryProfiles` is gone; its only reference is `adv:626,663`. | S1 (same `loadOrders`). |
| S3 | `feat/reports-till-compare-server` | G19 (server half) | `ctl` (`getPosRevenue` `:1183-1239`, new `compare=previous` query) · the pos-revenue reader that `ctl:1190` says goal progress shares (**file to locate**; `goals.service.ts:1181` is the candidate) · `gw/analytics/pos-revenue.spec.ts` | `?days=30&compare=previous` returns `previous.dailySeries` for the 30 house days before `from`, net of voids. On main the parameter is ignored. | #615 first (owner sales read net), then #722, which also edits `pos-revenue.spec.ts`. |
| M1 | `docs/reports-read-latency` (measurement only) | G23, G9 (cost) | `.planning/tech-debt.d/2026-10-03-fix-analytics-reads-past-row-cap.md` | None. This lane runs `EXPLAIN ANALYZE` on local Postgres built from the migrations, with one synthetic house-year (`pos_checks`, `wine_consumption_log`). It times `pos-revenue?days=365` and `/overview`. It adds an index or RPC only if the time is over about 3 s, per the founder's 2026-10-06 answer recorded at `:32-33` of that note. | None. Local only; never against production. |

### Phase B: the sheet saves only what the reader meant

| # | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| U1 | `fix/reports-sheet-one-ruling` | G1, mobile | `next/rp-sheet.ts` (sm becomes 12 columns; a new `SHEET_FLOW_BELOW = 768`) · `next/Sheet.tsx` (derived flow layouts below 768, `handleChange` drops any change made at a column count other than 12) · `next/rp-arrange.ts` (`colsForWidth` `:133-137` refuses keyboard moves below 768) · `next/ReportsNext.tsx` (list-mode Arrange below 768) · `next/Cutting.tsx` (list-mode controls) · `next/reports-next.css` (phone flow, floor height, inner scroll) · `next/Sheet.test.tsx` · `next/rp-arrange.test.ts` · `next/ReportsNext.test.tsx` | (a) At width 500 while arranging, a drag or resize stop calls `onMove` 0 times; main calls it with 4-column slots. (b) The `xs` and `xxs` layouts are full-width single-column items in (y,x) order; main passes `lg` as is. (c) A keyboard move at 700 px is refused with the sentence, and no slot is written; main writes a 6-column slot. (d) At 900 px (sidebar open) arranging uses 12 columns. (e) Phone list-mode remove and swap keep every other cutting's `lg` slot byte-identical. | #619 and #615 both edit `ReportsNext.test.tsx`; rebase. |
| U2 | `fix/reports-sheet-saves-when-saved` | G2, G3, G18, G17 | `next/useReportsNextData.ts` (`sheetKnown` from `isPlaceholderData`, the hook's own advice at `useUserPreferences.ts:198-205`; prefetch of the default reads; `registers` memoised) · `next/ReportsNext.tsx` (outline paper until known; `ruleOff` awaits `updatePreferencesAsync` (`useUserPreferences.ts:193`); timer in a ref, cleared; `Cutting` bodies memoised with stable per-id callbacks) · `next/Cutting.tsx` (`React.memo`) · `next/ReportsNext.test.tsx` · `next/useReportsNextData.test.tsx` | (a) While preferences are placeholder data, Arrange is disabled and outlines render; on main Arrange is enabled and the default sheet renders. (b) A rejected save shows no "Ruled off.", keeps the draft and shows "The sheet was not saved"; on main the stamp shows and the draft is dropped. (c) Two rule-offs 1 s apart keep the stamp until 2.4 s after the second; on main it is hidden at 1.4 s. (d) A render spy shows that moving one cutting re-renders only that cutting's body; on main all of them re-render. | U1 (same files). |
| U5 | `perf/reports-bench-reads-its-siblings` | G9, G11 (client half) | `next/rp-registers-bench.tsx` (`:74-122`; drop `/overview` `:80`, derive from the pacing, week and goals reads) · `next/useReportsNextData.ts` (bench pulls those three ids into `active` as dependencies) · `next/rp-format.ts` (`failureOf` `:157-162` reads `response.data.message` first, sharing the shape of `reasonOf`, `next/useReportExports.ts:75`, imported rather than moved) · `next/rp-catalogue.tsx` · `next/rp-format.test.ts` · `next/useReportsNextData.test.tsx` | (a) With bench on the sheet, no request goes to `/analytics/overview`, and bench shares the query keys of pacing, week and goals; on main it calls `/overview`. (b) `failureOf` on a 503 whose body carries "…could not be read whole" returns that sentence; on main it returns "Request failed with status code 503". | U2 (`useReportsNextData.ts`), S1 (503 bodies). Do not move `reasonOf`, because #562 edits `useReportExports.ts`. |

### Phase C: charts tell the truth

| # | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| U3 | `fix/reports-house-currency` | G5 | `next/rp-spec.ts` (`ViewCtx` gains `currency: string \| null \| undefined`, `:59,:74`) · `next/rp-format.ts` (`money(v, currency, mode)`, built on `web/lib/mudavym/format.ts` `fmtMoney` `:70-98` semantics, with a compact axis form and no per-figure caveat) · `next/useReportsNextData.ts` (query on `settingsApi.houseCurrency`, `web/services/api/settings.ts:62`) · `next/ReportsNext.tsx` (ctx `:312-315` plus the one-line caveat) · `next/rp-registers-trade.tsx` (11 calls) · `next/rp-registers-house.tsx` (13) · `next/rp-registers-bench.tsx` (6) · `next/rp-registers-goals.tsx` (`:91-95`) · `next/rp-format.test.ts` · `next/ReportsNext.test.tsx` | (a) A TRY house prints `₺1,234`, never `$`. (b) A house with no currency prints `1,234` and the sheet caveat once. (c) A goal with a currency unit prints in house money; on main it prints a bare compact figure. | U2. #615 and #619 edit the trade and house registers; rebase. |
| U4 | `fix/reports-charts-say-only-what-is-true` | G12, G13, G10, G14, G15 | `next/rp-plot.tsx` (bars mode: one `<Bar>` with a `<Cell>` per point, projected points drawn `--seal-tint` with a `--seal-deep` dashed stroke, seam drawn once; line and area `connectNulls={false}`; heat null guard `:501-502`; working keys `:216-217` by index+text) · `next/rp-registers-trade.tsx` (`:161` keeps null; the till series filled from `from`..`to` with null; seam `:557`; forecast words in place of MAPE and model id `:585-589`) · `next/rp-registers-house.tsx` (R² `:546-547` to words) · new `next/rp-plot.test.tsx` · `next/rp-registers-trade.test.tsx` | (a) A till with no check on Tuesday plots Tuesday as null, and a line drawn over it has a gap; on main it is absent or 0 and joined. (b) Forecast in bars renders one bar per day, and the seam day appears once; on main it renders two `<Bar>` series. (c) The rendered forecast and waiters registers contain no "MAPE", "R²" or model identifier; they contain the worded band. (d) Two identical working lines both render. | U3 (same register files). |

### Phase D: new capability

| # | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| U6 | `feat/reports-cutting-laid-flat` | G4, G16 (moot at full size) | `web/App.tsx` (`:440`, new `<Route path="/reports/flat/:id">` under the same `PageGate`) · new `next/ReportsFlat.tsx` · `next/Cutting.tsx` ("Lay out flat" control while reading, and a `size="flat"` prop) · `next/rp-plot.tsx` (tick density by measured width) · `next/reports-next.css` · new `next/ReportsFlat.test.tsx` · `next/ReportsNext.test.tsx` | (a) Every register with a path shows "Lay out flat" while reading and none while arranging; on main there is no control. (b) `/reports/flat/till` renders the till with its window and drawing controls; changing the drawing calls `saveSheet` 0 times. On main the route does not exist. (c) A staff reader on `/reports/flat/seats` gets the withheld state and no request goes out (ADR 0348). (d) Back lands on `/reports` with the preferences untouched. | U4 (`rp-plot.tsx`), U2 (`Cutting.tsx`). |
| U7 | `feat/reports-till-compare` | G19 (client half) | `next/Cutting.tsx` (`TillWindowPicker` `:87` becomes `[7,30,90,365]` plus the compare toggle) · `next/rp-registers-trade.tsx` (till `:139-276`: dashed previous series and a worded delta) · `next/useReportsNextData.ts` (query key gains `compare`) · `next/rp-registers-trade.test.tsx` · `next/ReportsNext.test.tsx` | (a) 365 is offered. (b) With compare on, the till draws the previous series and says "against the 30 days before". On main neither exists. | S3, U4. |

### Phase E: cleanup and record

| # | Branch | Gaps | Files (≤15) | Tests that fail on main, pass after | Depends on |
|---|---|---|---|---|---|
| C1 | `chore/reports-drop-legacy-grid` | G21 | Delete `web/components/reports/{ChartArrangementModal,ChartConfigModal,DashboardGrid,EditLayoutPanel,WidgetSelector}.tsx`, 1,798 lines. **Keep `web/components/reports/preview/`**, which `web/components/documents/GmailTemplateBuilder.tsx:54` imports. | No red-first test is possible for a deletion. The proof is `git grep` finding 0 importers, plus `tsc` and the web build passing. | None. |
| D1 | `docs/reports-software-record` | G22, plus this proposal's calls | `.planning/08-softwares/reports-analytics.md` (owner, paths to `next/`, current controller lines) · `next/rp-catalogue.tsx` (`:67-70`, insights cite becomes `ctl:433`) · one new ADR for the §4 calls (number taken from the guard) · the decisions README row in its own PR (memory: README append is gate-released) | `scripts/check_decision_claims.sh`, with a CLAIMS row for "the sheet never writes coordinates below 768", checked by a grep on `SHEET_FLOW_BELOW` usage in `Sheet.tsx`. | All lanes, so the record says what shipped. |

**Order:**
1. S1 → S2 → S3, with M1 any time.
2. U1 → U2 → U5.
3. U3 → U4 → U6.
4. S3 + U4 → U7.
5. C1 any time.
6. D1 last.

That is **13 lanes**.

---

## §4 Forks and the session's calls

Each fork below gives the call, what was rejected, and one attempt to kill the call.

**F1. What arranging means on a narrow screen (G1).**
- **Call:** keep 12 columns down to 768 px. Below 768 the sheet auto-flows into one column in (y,x) order, writes no coordinates, and offers list-mode Arrange (remove, swap, drawing, add).
- **Rejected:**
  - Saving every breakpoint (RGL `allLayouts`): this triples the state, lets the phone sheet drift from the desktop one, needs a codec v4 migration, and puts drag-on-touch in conflict with scroll.
  - Blocking Arrange below `md` (996): a desktop with the sidebar open measures under 996, because the width is the container's.
  - Squeezing 12 columns onto a phone: 25 px columns.
- **Kill attempt:** "A phone-only owner can never move a cutting." That is true. But the owner can remove, swap and add, and a moved cutting on a phone has no stable meaning on the desktop. The second attempt: "At 768 px, a cutting 3 columns wide is about 180 px, too cramped." Laid flat (F2) answers that. **Survived, with the phone-move cost stated.**

**F2. The form of "full screen" (G4).**
- **Call:** a page route, `/reports/flat/:id`.
- **Rejected:**
  - A new overlay shape: ADR 0112 allows three shapes and two widths, and "a third needs an ADR" (`web/components/mudavym/Sheet.tsx:226`).
  - The browser Fullscreen API: element full-screen is unreliable on iPhone Safari (not verified here) and ends on navigation.
  - Maximising inside the grid: it mutates compaction, which is the very bug class of G1.
- **Kill attempt:** "A route remounts and refetches." The query keys `[ROOT,id,rid,window]` with a 60 s stale time (`next/useReportsNextData.ts:273-287`) serve from cache. Second attempt: "Back loses the scroll position." This is mitigated with scroll restoration, and U6 test (d) covers it. **Survived.**

**F3. Do changes made in the flat view save?**
- **Call:** no. They are view-only and say so (the Grafana view-mode pattern, `sota.md:17-18`).
- **Rejected:** a "keep on the sheet" button, which would be a second write path into `reportsSheet`.
- **Survived.**

**F4. Money with no recorded currency (G5).**
- **Call:** bare figures plus one sheet-level sentence. Never print `$`.
- **Rejected:**
  - Falling back to USD, which `fmtMoney`'s own comment forbids (`web/lib/mudavym/format.ts:75-81`).
  - A per-figure "(currency not recorded)", which is unreadable on axes and tooltips.
- **Kill attempt:** "The exports might still disagree." Exports already name the house currency (`report-export-cuttings.ts:18`), so this call brings the page into line with them. **Survived.**

**F5. A failed purchase-order read (G6).**
- **Call:** refuse whole. Answer 503 with the sentence "could not be read", which the page shows. This follows ADR 0292 and the founder's 2026-10-06 fork-3 answer recorded at `svc:237-242`.
- **Rejected:**
  - Today's degrade to `[]` (`adv:225-231`), which reports absence as health.
  - A `partial: true` flag, a new response shape every consumer must learn.
- **Kill attempt:** "A transient orders failure now blanks the whole ledger, although consumption was fine." That is true. But the ledger's COGS and ratios are meaningless without orders, retry is 1, and `/overview` already uses `allSettled` (`adv:824-869`). **Survived.**

**F6. Spend and weekdays in house days (G7).**
- **Call:** bucket with `houseDayOf`. When the house has no zone, answer `zoneUnset` with null figures, as the till does (`ctl:1191-1192`).
- **Rejected:** falling back to UTC with a caveat, which would leave two registers on one sheet using two day rules.
- **Kill attempt:** "Houses without a zone lose pacing and week." That is true, but the till already does this on the same sheet, and the count of zone-less houses is unmeasured (§6). **Survived conditionally.** If the count is large, D1 records a follow-up that asks the house for its zone, not a fallback.

**F7. Cashflow weekly buckets (G8).**
- **Call:** complete house weeks, newest-aligned and ending yesterday. Drop the oldest remainder. Select spend by `delivered_at` in the window, and select committed (undelivered) orders by `created_at`.
- **Rejected:**
  - Scaling the partial week by ×7/5, which invents spend.
  - Including today, which is partial.
- **Survived.**

**F8. How bench avoids `/overview` (G9).**
- **Call:** derive bench on the client from the pacing, week and goals reads, sharing their query keys. `/overview` stays on the server for the API and MCP.
- **Rejected:**
  - A new `/bench` endpoint, which is more server surface.
  - A server-side shared consumption cache, which "needs its own decision" (tech-debt note `:34`).
- **Kill attempt:** "With none of the three on the sheet, bench now makes 3 requests, not 1." But that is 3 lenses of work against 8, with five whole consumption windows not read. **Survived.**

**F9. Model-quality numbers (G10, narrowed).**
- **Call:** words on the page, and no MAPE, R² or raw model identifier. The numbers stay in the API.
- **Rejected:** keeping them for technical readers. /reports is an owner's page, and the memory "people pages simple" applies.
- **Kill attempt:** "Word bands are thresholds, so hidden numbers." That is true and acceptable, because the thresholds live in one function a test pins. **Survived.**

**F10. The cold-load window (G2).**
- **Call:** show outline paper until preferences answer, prefetch the default sheet's reads in parallel, and disable Arrange until the sheet is known.
- **Rejected:**
  - Rendering the default sheet first, which is today's jump.
  - Waiting for preferences before any read, which adds a serial round trip.
- **Kill attempt:** "First figures are slower." The prefetch makes the reads parallel, and the paper outline replaces a layout jump. **Survived.**

**F11. The till window and comparison (G19).**
- **Call:** offer 7, 30, 90 and 365, with "against the period before" (equal length, immediately preceding). "Same week last year" is deferred until a house holds a year of checks.
- **Rejected:**
  - A free date range, which is too much UI for a people page.
  - Switching to 28/91/364 for weekday alignment, which changes established windows.
- **Kill attempt:** "30 against the prior 30 can differ by a weekend day." That is true, and the words name the windows exactly; 7 and 365 are weekday-aligned. **Survived, with that caveat.**

**F12. Projection in bars mode (G13).**
- **Call:** one bar series. Projected days are tinted with a dashed stroke, each in the same slot as a measured bar would be.
- **Rejected:** a `ComposedChart` of bars plus a dashed line. It mixes two encodings, and the line drawing already exists as its own choice.
- **Survived.**

**F13. The consumption index (G23).**
- **Call:** no index and no column change now. Measure locally (M1), and act only if the time is over about 3 s, per the founder's 2026-10-06 rule (tech-debt note `:32-33`).
- **Rejected:**
  - Adding an index now: migrations auto-apply on merge, and the benefit is unmeasured.
  - Filtering on `recorded_at`, which changes which rows count.
- **Survived.**

**F14. Dead legacy grid (G21).**
- **Call:** delete the five files and keep `preview/`.
- **Survived.** `GmailTemplateBuilder.tsx:54` is the only live importer, and it is of `preview/`.

**F15. Records.**
- **Call:** one ADR for F1–F14 via D1. Update `reports-analytics.md` in place rather than adding a new doc, which satisfies retire-to-write.
- **Survived.**

---

## §5 Integration contract with neighbouring softwares

| Neighbour | Contract after this build |
|---|---|
| **Analytics gateway** (`ctl`, `adv`, `svc`) | Every lens route behaves the same way:<br>- 200 with figures<br>- 503 with a human sentence for a refused or failed whole read (`WholeReadError`, `gw/common/read-whole-window.ts:105`)<br>- 403 for a role refusal<br>- never 500 for a refusal<br><br>House-day lenses answer `zoneUnset: true` with null figures when the house has no zone. `/overview` stays available but is not read by /reports. |
| **Settings** (`GET /settings/currency`, `web/services/api/settings.ts:62`) | Returns an ISO 4217 code or null. /reports never assumes USD. |
| **Account preferences** (`reportsSheet` v3, `next/useReportsNextData.ts:87`) | /reports writes only 12-column coordinates, and only through `updatePreferencesAsync`. HouseShell and AskPanel read the same hook and see no change in shape. |
| **Goals** (`goals.service.ts`, `next/useGoalsDesk.ts`) | Unchanged writes. Money units print in house currency. The sales gate from #722, #725 and #730 is inherited and not touched. |
| **Exports** (`gw/reports/exports/*`) | Already in house currency. Because cuttings and exports read the same services, S1 and S2 change their figures too. A CSV may then refuse where it used to print zeros; this is intended, and unverified in the export service (§6). |
| **Roles** (ADR 0348; tech-debt note `2026-10-31-fix-analytics-money-routes-need-a-manager.md`) | The flat route honours `heldBack`. Closing the money routes stays that note's lane. |
| **Dashboard** (`dashboard.service.ts` `getSalesChart`) | It still degrades procurement to `[]` (tech-debt note `:22`). That is not this software's to fix, but it should adopt S1's pattern. |
| **Insights and AskTheBook** | Unchanged. The reading cutting keeps `/insights` (`ctl:433`). #725 and #730 own that route's sales gate. |

---

## §6 What stays unverified

- No chart was rendered. The RGL pointer path in G1, the tooltip clipping in G16 and Safari's full-screen behaviour are all inferred from code or general knowledge.
- Bundle size: no build was run.
- Latency of `pos-revenue?days=365` (about 4 s) and of `/overview` (about 60 page requests): both are estimates from the tech-debt note. M1 measures them locally only.
- Whether any house exceeds 1,000 purchase orders in a window (G6): not measured.
- How many houses have no time zone (F6): not measured. Production was not queried.
- Whether `GET /settings/currency` is scoped to the active house for multi-house managers: not checked.
- Which file holds the pos-revenue reader that S3 extends (`goals.service.ts:1181` is the candidate): not located.
- Whether the pos-revenue route can emit a null `revenue` row (G12, server side): not checked.
- The export service's behaviour once S1 refuses: not read.
- The goals register (about 900 lines) and AskTheBook were only skimmed in the audit.
- The open PRs were checked on 2026-11-07:
  - #730, #725 and #722 (drafts) and #619 edit `adv`.
  - #725 edits `ctl`.
  - #615 and #619 edit `rp-registers-house.tsx`, `rp-registers-trade.tsx` and `ReportsNext.test.tsx`.
  - #564 and #562 edit `useGoalsDesk.ts` and `useReportExports.ts`.
  - #597 is a sketch only.
  - #617 is closed.
  - Conflicts are expected to be textual; this was not test-merged.
