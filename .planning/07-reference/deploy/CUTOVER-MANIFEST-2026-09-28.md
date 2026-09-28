# Cutover manifest, 2026-09-28 — the legacy web pages as file groups, each awaiting his word

> **Status: awaiting the founder, group by group** ([ADR 0149](../../decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md) §Decision: *"option1 with my approval what to delete and not"*). Nothing here is approved. The draft PR on `feat/cutover-manifest-trial` deletes every group that passed its trial, so he can read the exact diff; it must not merge until each group below carries his answer, and groups he refuses are restored on that branch before it merges.
>
> **Tree measured:** `origin/main` `c8bbf95de` with PR #487 (`d3bfacb82`, flags-to-code for the desk, promotions and vendor prices) merged in, because #487 merges first. Web only (census Q12); no table, column, row, house, user or migration is touched (ADR 0149:75-77).
>
> **Retire-to-write (CLAUDE.md §4):** supersedes the census's legacy-inventory material, which is bracketed in place — [WEB-REBUILD-CENSUS-2026-09-25.md](WEB-REBUILD-CENSUS-2026-09-25.md) §1a's "Legacy still mounted" column, its §0 row G8 and its §3 row L17's hold on `ReceiptsPage.tsx` / `Providers.tsx`. It also supersedes the Wave 6 draft `scratchpad/deletion-manifest-draft.md` (session 6c6d8b93), which was never in the tree; its G0.3 and G8 answers survive in census §16 items 51-52 and are carried below.
>
> **Re-check it:** `python3 scripts/cutover_import_graph.py` rebuilds the import-graph half of this document from the tree it runs on and exits 1 if any group's root is imported by anything that stays live (mutation-tested: an `import '../../Help'` added to `HelpNext.tsx` makes it exit 1 naming `help`). The trial deletes below were run once, on the commit named above; they are not in CI.

## 1. How it was measured

1. **Import graph.** Every static import, re-export, `import()` and `require` under `apps/web/src`, resolved through relative paths and the `@/` alias, from `src/main.tsx` (plus `middleware.ts` and `.storybook/`). Removing App.tsx's edges to each group's legacy root, the files that stop being reachable are the deletion set; each is assigned to the group that alone reaches it, or to **shared** when several do. Tests and stories are not roots.
2. **Trial v1, per group:** delete the group's files and the tests that import only them, strip its slot from App.tsx, run `tsc --noEmit` and vitest on every test that names a deleted file, `App` or `PageGate`; record; restore (`git checkout HEAD -- apps/web/src`).
3. **Trial v2, per group:** v1 plus the two things v1 surfaced — files **already unreachable from `main.tsx`** that import the group (dead code that would stop compiling), and tests that read a deleted file by path or pin App.tsx's old route shape — each judged by hand and listed under the group.
4. **Combined trial:** every group at once, plus the shared files, the redirect slots, and the records the deletion touches (§6). **Web `tsc --noEmit`: 0 errors. Full vitest: 332 files, 4,754 passed, 11 skipped, 0 failed** (baseline on the same tree before deletion: 381 files, 5,223 passed, 11 skipped). The 49 fewer files and 469 fewer tests are the deleted groups' own tests; none of the remaining tests was skipped or weakened to pass except the edits named under each group.
5. **CI's own guards — missed by the trials above, found at review.** Trials v1, v2 and the combined trial ran web `tsc` and vitest only. The PR's CI then failed two Python guards the deletion broke: `check_windowed_figures.py` (exit 2, group `team`, §4) and `check_nightly_manifest.py` (exit 1, groups `arrival_book` and `recommendations`, §6). Fix round (2026-09-28, head after `1fefa23e0`): each guard `ci.yml` runs that needs no `gh`, database or gateway build was run on the branch, and on an export of `origin/main` `dcdb6d5e9` for comparison. That is 84 invocations, their `--self-test`s included. Two still fail on the branch. `check_windowed_figures.py` exits 2 — **not fixed**, see `team`. `check_no_direct_type_attributes_access.sh` exits 1, but that one is **pre-existing**: it flags only `pages/cellar/next/{RowExpander.tsx,cellar-columns.ts,CellarNext.test.tsx}`, which this branch does not touch. Every other invocation exits 0.
6. **Not measured:** a feature-by-feature capability audit of every legacy page against its Mudavym page. The 2026-09-26 draft did that audit (its G0.3); its three gaps were ruled "build, not waive" (census §16 item 51) and are **built and on `main`**: vendor branches `providers/next/BranchesSection.tsx` (#484), the held low-stock band `notifications/next/HeldBand.tsx` (#486), team coverage-rule delete and hand-entered sales `team/next/CoverageRulesSheet.tsx`, `team/next/SalesSheet.tsx` (#436). This pass found one more legacy-only feature by accident, the `/reports` check scanner (group `reports` below) — so the audit is not known to be complete.

## 2. The routes, re-measured (App.tsx on the tree above, 72 `path=` entries)

**Live for every house, on a Mudavym `next` page:** every `PageGate` key but one. `LIVE_PAGES` holds 28 of the 29 `MUDAVYM_PAGES` keys (`apps/web/src/lib/mudavym/useMudavymDesign.ts:196-225`); the one held back is `arrival` (`/get-started`), whose **legacy** slot is ADR 0213's plan of record — so every house already gets the Mudavym-era `GetStarted`, and the gated `next` slot is #414's dormant Arrival book (ON for 0 of 14, census J1).

**Routes that still render a legacy page for any house: none.** Every `legacy=` slot on a live key is reachable only by the per-browser QA override `localStorage["mudavym.design.<page>"] = "0"` (`useMudavymDesign.ts:6-11`).

**Live routes that are not rebuilt (G8, generalized — a live route is not a rebuilt route).** Found by a heuristic — files reached from each `next` page, outside `components/mudavym`, `lib`, `services`, `hooks`, `contexts`, whose Tailwind legacy classes (`bg-gray-*`, `text-gray-*`, `bg-white`, `rounded-xl`, `shadow-*`) outnumber Mudavym tokens (`.mudavym`, `var(--ink|paper|tuck|rule…)`). A heuristic, not a visual check: each needs a look before it is called a gap. **OD-177** asks which of these are in DONE's scope.

| Live page | Legacy-styled surface it renders | Where |
|---|---|---|
| `/inventory` | The whole page. The gate mounts only the house header; both slots are `InventoryCommandPage` (founder, 2026-09-04: *"the command page is not being redesigned"*, App.tsx comment above the route). 1,865 lines, 98 legacy markers to 2; 26 legacy-styled children (`AddWineToInventoryModal`, `StorageLocationManager`, `PosMappingPanel`, `BatchReceiveGrid`, `ManualReceiptWorkspace`, scanner, …) | `App.tsx:389` (pre-cutover numbering) |
| `/vendors` | The vendor sheet's lower half: `ProviderIntelligencePanel` and its Digital Twin / Promotions / Conversations tabs (4 files, 735 lines), wrapped in a `.mudavym` paper ground but styled legacy inside | `pages/providers/next/TwinSheet.tsx:42-46,202`; `components/providers/ProviderIntelligencePanel.tsx` |
| `/settings` | Locations: `AddLocationDialog`, `CreateChainDialog`, `AssignToChainDialog`, `EditLocationChainDialog` (+ `BranchProviderTransferModal`); Team: `InviteTeamDialog`, `TeamLaborSettings`, `TeamGoalsSettings` | `settings/next/LocationsSection.tsx:120-144`; `settings/next/TeamSection.tsx:184-192` |
| `/cellar` | The menu scanner: `MenuScannerModal` → `MenuScannerTab` (579 lines) → `WineValidationModal` (494 lines) | `cellar/next/WineRegister.tsx:73,451` |
| `/vendor-prices` | `IdentityDecisionLog` (327 lines) | `vendor-prices/next/VendorPricesNext.tsx:540,872` |
| `/promotions`, the house header | `RestaurantBranchSwitcher` (319 lines) | `promotions/next/PromotionsNext.tsx:166`; `components/mudavym/HouseHeader.tsx:124` |
| `/get-started` | Its three menu steps `MenuCsvUpload`, `MenuManualEntry`, `MenuScanUpload`, plus `PlacesAutocomplete`, `CountryCombobox` | `pages/GetStarted.tsx:5-9` |
| shell | Command palette, shortcuts sheet, recently viewed, the error boundary, `GuidanceStrip` | `components/command/CommandProvider.tsx:27-29`; `components/mudavym/HouseShell.tsx:60-63` |

Not counted as gaps: the nine public doors (`/login` … `/v/:slug`) and `/terms` wear `PublicShell`/`AuthShell` with legacy classes inside by design (#426, ADR 0133; census §1a row "Live Mudavym public doors"); the heuristic flags them and was overruled by that record. `/house`, `/house/menu`, `/studio/*`, `/simpos/*`, `/dev/truth`, `/dev-sandbox` are internal or ADR 0213 first-proof pages outside the manifest (census §1a).

**G8's three surfaces, re-measured — the reason `ReceiptsPage.tsx` and `Providers.tsx` can now be on the manifest (census §3 L17's hold):**
- **Credits** — rebuilt. `?tab=credits` renders the Mudavym `ReceiptsCredits`, not the legacy page (`receipts/next/ReceiptsNext.tsx:75-83`); nothing but App.tsx's slot imports `ReceiptsPage` (CLAIMS `ADR-0149-ROW22-RECEIPTS-CREDITS-LANE`).
- **Discovery** — rebuilt. `/distributors` → `/vendors?tab=discover` lands on the "Find new vendors" rung (`providers/next/vendor-scope.ts:42`, #484).
- **Sentiment** — the legacy chart is retired (ADR 0207; `components/providers/ProviderIntelligencePanel.tsx:10-16`), its reading lives in `providers/next/scorecard/MailTone.tsx`. **But the panel that hosted it is still rendered by the live sheet** (row above), so `ProviderIntelligencePanel` and its three tab components are **not** on the manifest: the graph proves it — they stay reachable from `ProvidersNext` after every legacy slot is gone.

## 3. Special cases

- **`/get-started` (R14, ADR 0213).** The one route where "delete the legacy slot" is backwards. Group `arrival_book` deletes the `next` slot (#414's Arrival book) and the route renders `GetStarted` directly — what every house already gets. `GetStarted` is not on any group. Left behind, stated: `arrival` stays in `MUDAVYM_PAGES` and `mudavym_design_arrival` stays an ACTIVE gateway flag (`apps/api-gateway/src/settings/feature-flag-registry.ts:83-92`) that now gates nothing; retiring it is a gateway change and is part of that group's fork.
- **`/inventory`.** Both slots are the same page; there is no legacy file to delete, so it is on no group. Whether the page itself must be rebuilt before DONE is OD-177.
- **Redirect-only slots.** Ten `legacy={<Navigate …/>}` slots on live keys (`/cellar` and its six category routes → `/wines`, `/menu` → `/cellar`, `/documents/:id` → `/receipts`, `/connections` → `/profile`) delete no file; they are group `redirect_slots` because removing them is still removing legacy behaviour.
- **What the gate does after a group goes.** `PageGate`'s `legacy` becomes optional: a page that passes none renders `next` whatever the gate resolves, so the QA override `"0"` shows the Mudavym page instead of a blank one (`components/mudavym/PageGate.tsx`, test `PageGate.noLegacy.test.tsx`). The gate stays on every route because it mounts the house header, the ground claim and the sheet stack. A page that keeps a `legacy` slot behaves exactly as before.

## 4. The file groups

Each group: its legacy root(s), the files only it reaches (with line counts on `d3bfacb82`), the importers of its root other than App.tsx's slot (the import-graph proof — **none** for every group), the tests that go with it, the hand-judged test edits, and both trials. **Every group passes trial v2** (web `tsc` + vitest). **One fails CI:** `team`, whose files a CI guard names (below; found at review, §1.5). Line counts are the file's lines, tests counted separately.

**What trial v1 caught — every failure, and what still referenced the group.** No failure was a live (reachable from `main.tsx`) source file importing a legacy file. Every one was one of three kinds: (a) a file **already unreachable from `main.tsx`** that imports the group, (b) the group's **own** test that v1's first cut kept because it also mocks a live module or reads the page by path, (c) a live test that **pins App.tsx's old route shape** or reads the deleted page as a source contract. Line numbers are on `d3bfacb82`.

| Group | v1 result | What still referenced it | Kind |
|---|---|---|---|
| dashboard | tsc 2 errors | `components/dashboard/AIDateExtractionAlert.tsx:9` → `utils/aiDateContext`; `hooks/index.ts:7` → `useDashboardData` | (a) |
| orders | 2 test files fail | `pages/__tests__/OrdersLegacySeal.test.ts:45`, `OrdersLegacyReject.test.ts:36` read `Orders.tsx` by path | (b); the Seal file's `ResponsesSheet` half is live, so it is trimmed, not deleted |
| receiving_desk | 1 test fails | `components/mudavym/PageGate.liveForEveryHouse.test.tsx:199` pins the old `/receiving` element | (c) |
| vendors | tsc 5, 1 test | `components/providers/index.ts:1-2` (barrel), `pages/distributors/index.tsx:1-3`; `lib/renamedRoute.test.tsx:120` | (a), (c) |
| communications | tsc 1 | `components/documents/TemplateLibrary.tsx:28` → `SavedSMSTemplates` | (a) |
| team | tsc 5, 1 test; **CI** `check_windowed_figures.py` exit 2 (found at review, not fixed) | `pages/team/command/TeamCommand.honesty.test.tsx:99-103`; `scripts/check_windowed_figures.py:417-420` | (b); a CI guard's anchors |
| receipts | tsc 1, 2 tests | `pages/ReceiptsPage.roles.test.tsx:52`; `pages/receipts/next/ReceiptsSeal.test.tsx:386` reads `ReceiptsPage.tsx` | (b), (c) |
| reports | tsc 9 | `components/reports/organisms/AIInsightsSection.tsx:8`, `ChartsGrid.tsx:6-8`, `KPISection.tsx:9`, `organisms/index.ts:6-13` | (a) |
| recommendations | tsc 2, 2 tests | `pages/Recommendations.test.tsx:39`, `pages/__tests__/InsightCatalog.honesty.test.tsx:20` | (b); the honesty file's command-palette case is live and kept |
| calendar | tsc 20, 1 test | `pages/calendar/index.tsx` (barrel), `pages/calendar/EventCard.tsx:2`; `CalendarPage.reminders.test.tsx:14` | (a), (b) |
| profile, logs | tsc 1, 1 test each | `pages/Profile.test.tsx:5`; `pages/LogsTimelinePage.test.tsx:42` | (b) |
| admin, authorize, promotions, vendor_prices | 1-2 tests each | `PageGate.liveForEveryHouse.test.tsx:133,138` / `:145` / `:219` / `:227` pin the old elements | (c) |
| receiving_door, documents, notifications, settings, cellar, ask, arrival_book, help | **pass** (arrival_book and recommendations also broke CI's `check_nightly_manifest.py`; found at review and fixed, §6) | `e2e/nightly/manifest.json` `arrival.source`, `pending_pages[0].file` | a CI guard's data |

### dashboard

- **Legacy slot root(s):** `pages/Dashboard.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 10 files, 4009 lines; plus 2 already-unreachable file(s), 232 lines, that import this group and would stop compiling: `components/dashboard/AIDateExtractionAlert.tsx`, `hooks/index.ts`.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=2 vitest=0  Test Files 48 passed (48) |  Tests 889 passed (889)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 105 passed (105) |  Tests 1713 passed (1713)`
<details><summary>Files</summary>

- `components/dashboard/AddImportantDateModal.tsx` (297)
- `components/dashboard/QuickActionsPanel.tsx` (485)
- `data/manualImportantDates.ts` (32)
- `data/quickActions.ts` (208)
- `hooks/useDashboardData.ts` (302)
- `hooks/useQuickActions.ts` (216)
- `pages/Dashboard.tsx` (1856)
- `pages/dashboard/index.tsx` (4)
- `pages/dashboard/useDashboardPage.ts` (297)
- `utils/aiDateContext.ts` (312)
- `components/dashboard/AIDateExtractionAlert.tsx` (202)
- `hooks/index.ts` (30)

</details>

### orders

- **Legacy slot root(s):** `pages/Orders.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 13 files, 7703 lines.
- **Tests/stories deleted with it:** 3 files, 492 lines.
- **Test edits:** deletes `components/orders/__tests__/CommsThreadDrawer.test.tsx`; rewrites `pages/__tests__/OrdersLegacySeal.test.ts` to keep only its live `ResponsesSheet.tsx` half.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 2 failed | 115 passed (117) |  Tests 2200 passed (2200)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 116 passed (116) |  Tests 2203 passed (2203)`
<details><summary>Files</summary>

- `components/orders/ActiveConversationsPanel.tsx` (219)
- `components/orders/CommercialTermsPanel.tsx` (280)
- `components/orders/CommsThreadDrawer.tsx` (1520)
- `components/orders/DealApprovalModal.tsx` (305)
- `components/orders/DraftEmailApprovalPanel.tsx` (615)
- `components/orders/OrderGuardModal.tsx` (83)
- `pages/Orders.tsx` (3490)
- `pages/orders/CreateOrderModal.tsx` (485)
- `pages/orders/OrderFilters.tsx` (158)
- `pages/orders/OrderSummary.tsx` (202)
- `pages/orders/index.tsx` (6)
- `pages/orders/useOrdersPage.ts` (203)
- `utils/deliveryDateUtils.ts` (137)

Tests:
- `components/orders/__tests__/DealApprovalModal.test.tsx` (103)
- `components/orders/__tests__/DraftEmailApprovalPanel.test.tsx` (296)
- `pages/__tests__/OrdersLegacyReject.test.ts` (93)

</details>

### receiving_desk

- **Legacy slot root(s):** `pages/receiving/ReceivingHome.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 469 lines.
- **Tests/stories deleted with it:** 1 file, 223 lines.
- **Test edits:** `PageGate.liveForEveryHouse.test.tsx:199` pins the post-cutover `/receiving` element.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 1 failed | 25 passed (26) |  Tests 1 failed | 510 passed (511)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 511 passed (511)`
<details><summary>Files</summary>

- `pages/receiving/ReceivingHome.tsx` (469)

Tests:
- `pages/receiving/ReceivingHome.test.tsx` (223)

</details>

### receiving_door

- **Legacy slot root(s):** `pages/receiving/DoorReceipt.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 543 lines.
- **Tests/stories deleted with it:** 1 file, 230 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 473 passed (473)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 473 passed (473)`
<details><summary>Files</summary>

- `pages/receiving/DoorReceipt.tsx` (543)

Tests:
- `pages/receiving/DoorReceipt.test.tsx` (230)

</details>

### vendors

- **Legacy slot root(s):** `pages/Providers.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 15 files, 8353 lines; plus 2 already-unreachable file(s), 10 lines, that import this group and would stop compiling: `components/providers/index.ts`, `pages/distributors/index.tsx`.
- **Tests/stories deleted with it:** 6 files, 722 lines.
- **Test edits:** deletes `pages/distributors/command/DistributorMap.test.tsx`; `lib/renamedRoute.test.tsx:120` pins the post-cutover `/vendors` element.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=5 vitest=1  Test Files 1 failed | 26 passed (27) |  Tests 1 failed | 495 passed (496)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 65 passed (65) |  Tests 1221 passed (1221)`
<details><summary>Files</summary>

- `components/providers/AddProviderModal.tsx` (974)
- `components/providers/EditProviderModal.tsx` (1780)
- `components/providers/SendMessageSlideOver.tsx` (904)
- `components/providers/VendorCatalogueCard.tsx` (192)
- `components/providers/VendorMatchModal.tsx` (222)
- `components/providers/VendorSearchModal.tsx` (324)
- `components/ui/RangeSlider.tsx` (116)
- `pages/Providers.tsx` (1611)
- `pages/distributors/command/DistributorDrawer.tsx` (339)
- `pages/distributors/command/DistributorMap.tsx` (519)
- `pages/distributors/command/DistributorMapPage.tsx` (373)
- `pages/distributors/command/bits.tsx` (260)
- `pages/distributors/command/customProvider.ts` (208)
- `pages/distributors/command/mapCamera.ts` (340)
- `pages/distributors/useDistributorsPage.ts` (191)
- `components/providers/index.ts` (7)
- `pages/distributors/index.tsx` (3)

Tests:
- `components/providers/__tests__/EditProviderModal.businessType.test.tsx` (127)
- `components/providers/__tests__/EditProviderModal.deliveryDays.test.tsx` (161)
- `components/ui/RangeSlider.test.tsx` (57)
- `pages/distributors/command/DistributorMap.stories.tsx` (116)
- `pages/distributors/command/bits.test.tsx` (152)
- `pages/distributors/command/mapCamera.test.ts` (109)

</details>

### communications

- **Legacy slot root(s):** `pages/Communications.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 7 files, 4280 lines; plus 1 already-unreachable file(s), 1018 lines, that import this group and would stop compiling: `components/documents/TemplateLibrary.tsx`.
- **Tests/stories deleted with it:** 2 files, 242 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=1 vitest=0  Test Files 28 passed (28) |  Tests 535 passed (535)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 28 passed (28) |  Tests 535 passed (535)`
<details><summary>Files</summary>

- `components/communications/ReportScheduler.tsx` (759)
- `components/communications/ReportTypeModal.tsx` (366)
- `components/documents/SMSTemplateBuilder.tsx` (982)
- `components/documents/SavedSMSTemplates.tsx` (719)
- `components/documents/SavedTemplates.tsx` (682)
- `data/reportDefaults.ts` (152)
- `pages/Communications.tsx` (620)
- `components/documents/TemplateLibrary.tsx` (1018)

Tests:
- `components/communications/__tests__/ReportScheduler.honesty.test.tsx` (112)
- `pages/Communications.test.tsx` (130)

</details>

### team

- **Legacy slot root(s):** `pages/team/command/TeamCommandPage.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 8 files, 2736 lines.
- **Tests/stories deleted with it:** 2 files, 533 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=5 vitest=1  Test Files 1 failed | 26 passed (27) |  Tests 482 passed (482)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 482 passed (482)`
- **Fails CI — not fixed on the draft PR.** `scripts/check_windowed_figures.py` (ADR 0051's guard) lists four of this group's files among /team's renderers: `ManagerShiftDesk.tsx`, `MyShifts.tsx`, `OpsRulesPanel.tsx` and `PerformancePanel.tsx` (`:417-420` on `main`). With them deleted, it exits 2: *"CANNOT CHECK … anchor file is missing: apps/web/src/pages/team/command/ManagerShiftDesk.tsx"*. That blocks like a violation, on purpose. The guard's header forbids the easy fix of dropping the anchors until it goes green. The group can only go with one reviewed change to that guard that does three things together: it drops the four; it adds the three rebuilt files that query and were never listed (`FormerStaff.tsx`, `SendGrantsSection.tsx`, `useHouseAreas.ts` — v3.0-TECH-DEBT.md, 2026-09-28; CLAIMS `TD-2026-09-28-TEAM-WINDOWED-GUARD-UNLISTED-QUERIES`); and it retargets the self-test cases that write into the legacy fixtures. The fix round tried two ways to make the branch green. Editing the guard was refused by the session's permission check, and so were the first steps toward restoring this group's files instead. So the draft branch still deletes the group and still fails that check. The coordinator or founder chooses (§7).
<details><summary>Files</summary>

- `components/team/ShiftImportModal.tsx` (268)
- `pages/team/command/ManagerShiftDesk.tsx` (1178)
- `pages/team/command/MyShifts.tsx` (206)
- `pages/team/command/OpsRulesPanel.tsx` (308)
- `pages/team/command/PerformancePanel.tsx` (278)
- `pages/team/command/TeamCommandPage.tsx` (40)
- `pages/team/command/bits.tsx` (154)
- `pages/team/command/editors.tsx` (304)

Tests:
- `components/team/ShiftImportModal.test.tsx` (81)
- `pages/team/command/TeamCommand.honesty.test.tsx` (452)

</details>

### receipts

- **Legacy slot root(s):** `pages/ReceiptsPage.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 532 lines.
- **Tests/stories deleted with it:** 1 file, 112 lines.
- **Test edits:** `receipts/next/ReceiptsSeal.test.tsx` loses its §4 (a source contract over the deleted page); `ReceiptsCredits.test.tsx` loses its throwing `vi.mock` of the deleted page.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=1 vitest=1  Test Files 2 failed | 25 passed (27) |  Tests 472 passed (472)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 483 passed (483)`
<details><summary>Files</summary>

- `pages/ReceiptsPage.tsx` (532)

Tests:
- `pages/ReceiptsPage.roles.test.tsx` (112)

</details>

### documents

- **Legacy slot root(s):** `pages/DocumentsPage.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 1107 lines.
- **Tests/stories deleted with it:** 1 file, 57 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
<details><summary>Files</summary>

- `pages/DocumentsPage.tsx` (1107)

Tests:
- `pages/__tests__/DocumentsPage.honesty.test.ts` (57)

</details>

### reports

- **Legacy slot root(s):** `pages/Reports.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 49 files, 9200 lines; plus 4 already-unreachable file(s), 498 lines, that import this group and would stop compiling: `components/reports/organisms/AIInsightsSection.tsx`, `components/reports/organisms/ChartsGrid.tsx`, `components/reports/organisms/KPISection.tsx`, `components/reports/organisms/index.ts`.
- **Tests/stories deleted with it:** 23 files, 1926 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=9 vitest=0  Test Files 125 passed (125) |  Tests 2349 passed (2349)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 125 passed (125) |  Tests 2349 passed (2349)`
<details><summary>Files</summary>

- `components/reports/DashboardBlock.tsx` (503)
- `components/reports/DashboardCanvas.tsx` (234)
- `components/reports/EditToolbar.tsx` (218)
- `components/reports/InlineBlockConfig.tsx` (277)
- `components/reports/ReportGenerator.tsx` (457)
- `components/reports/atoms/ChartHeader.tsx` (42)
- `components/reports/atoms/CollapsibleSection.tsx` (69)
- `components/reports/atoms/DragHandle.tsx` (22)
- `components/reports/atoms/InsightCard.tsx` (61)
- `components/reports/atoms/MetricDisplay.tsx` (36)
- `components/reports/atoms/TrendIndicator.tsx` (33)
- `components/reports/atoms/WineTypeBar.tsx` (66)
- `components/reports/atoms/index.ts` (14)
- `components/reports/dashboardMeta.ts` (177)
- `components/reports/dashboardTypes.ts` (101)
- `components/reports/molecules/BusyHoursHeatmap.tsx` (139)
- `components/reports/molecules/ChannelDonutChart.tsx` (130)
- `components/reports/molecules/CheckScannerSection.tsx` (101)
- `components/reports/molecules/DailyBreakdownTable.tsx` (92)
- `components/reports/molecules/DataTableBlock.tsx` (182)
- `components/reports/molecules/KPICard.tsx` (120)
- `components/reports/molecules/KPIChartBlock.tsx` (122)
- `components/reports/molecules/KPISpotlightView.tsx` (573)
- `components/reports/molecules/LaborSpendOverlay.tsx` (113)
- `components/reports/molecules/OrderFunnelChart.tsx` (61)
- `components/reports/molecules/OrdersByTypeChart.tsx` (135)
- `components/reports/molecules/PeriodCompareBar.tsx` (148)
- `components/reports/molecules/PurchasedWinesTable.tsx` (142)
- `components/reports/molecules/RevenueChart.tsx` (75)
- `components/reports/molecules/TopWinesChart.tsx` (78)
- `components/reports/molecules/WineDistributionChart.tsx` (66)
- `components/reports/molecules/index.ts` (24)
- `components/reports/organisms/AICommandPalette.tsx` (276)
- `components/reports/organisms/DataTablesSection.tsx` (66)
- `components/reports/organisms/EngineInsightsPanel.tsx` (707)
- `components/reports/organisms/HeadlineInsightsBar.tsx` (166)
- `components/reports/organisms/MonthlyReconciliation.tsx` (211)
- `components/reports/organisms/SeatingDensityPanel.tsx` (659)
- `components/reports/organisms/TopBar.tsx` (176)
- `components/reports/organisms/insightSearch.ts` (78)
- `hooks/useEngineInsights.ts` (205)
- `lib/reports-drag.ts` (25)
- `lib/reports/index.ts` (8)
- `lib/reports/layoutDiffer.ts` (147)
- `lib/reports/layoutEngine.ts` (109)
- `lib/reports/types.ts` (52)
- `lib/reportsDataGap.ts` (86)
- `pages/Reports.tsx` (1530)
- `services/api/analytics.ts` (88)
- `components/reports/organisms/AIInsightsSection.tsx` (75)
- `components/reports/organisms/ChartsGrid.tsx` (110)
- `components/reports/organisms/KPISection.tsx` (300)
- `components/reports/organisms/index.ts` (13)

Tests:
- `components/reports/__tests__/ReportGenerator.test.tsx` (41)
- `components/reports/__tests__/atoms/MetricDisplay.test.tsx` (38)
- `components/reports/__tests__/atoms/TrendIndicator.test.tsx` (39)
- `components/reports/__tests__/atoms/WineTypeBar.test.tsx` (53)
- `components/reports/__tests__/integration/LayoutDiffer.test.tsx` (113)
- `components/reports/__tests__/integration/LayoutPersistence.test.tsx` (84)
- `components/reports/__tests__/molecules/KPICard.test.tsx` (76)
- `components/reports/__tests__/organisms/AICommandPalette.test.tsx` (109)
- `components/reports/__tests__/organisms/insightSearch.test.ts` (109)
- `components/reports/__tests__/posRevenue.test.tsx` (157)
- `components/reports/atoms/CollapsibleSection.stories.tsx` (87)
- `components/reports/atoms/InsightCard.stories.tsx` (82)
- `components/reports/atoms/MetricDisplay.stories.tsx` (59)
- `components/reports/atoms/TrendIndicator.stories.tsx` (60)
- `components/reports/atoms/WineTypeBar.stories.tsx` (106)
- `components/reports/fabricated-figures.test.tsx` (149)
- `components/reports/molecules/KPICard.stories.tsx` (113)
- `components/reports/molecules/RevenueChart.stories.tsx` (66)
- `components/reports/molecules/TopWinesChart.stories.tsx` (53)
- `components/reports/molecules/WineDistributionChart.stories.tsx` (57)
- `components/reports/organisms/EngineInsightsPanel.test.tsx` (162)
- `components/reports/organisms/TopBar.stories.tsx` (60)
- `lib/reportsDataGap.test.ts` (53)

</details>

### notifications

- **Legacy slot root(s):** `pages/Notifications.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 2478 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 29 passed (29) |  Tests 585 passed (585)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 29 passed (29) |  Tests 585 passed (585)`
<details><summary>Files</summary>

- `pages/Notifications.tsx` (2478)

</details>

### recommendations

- **Legacy slot root(s):** `pages/Recommendations.tsx`, `pages/InsightCatalog.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 3 files, 1975 lines.
- **Tests/stories deleted with it:** 1 file, 407 lines.
- **Test edits:** `pages/__tests__/InsightCatalog.honesty.test.tsx` keeps only its live command-palette case (the catalogue honesty lives in `recommendations/next/rec-catalog.test.ts`, `CatalogView.test.tsx`).
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=2 vitest=1  Test Files 2 failed | 28 passed (30) |  Tests 601 passed (601)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 29 passed (29) |  Tests 602 passed (602) (re-run after a fixup correction; first run: tsc=2, the fixup had dropped the live staticCommands import)`
<details><summary>Files</summary>

- `components/layout/Breadcrumbs.tsx` (42)
- `pages/InsightCatalog.tsx` (665)
- `pages/Recommendations.tsx` (1268)

Tests:
- `pages/Recommendations.test.tsx` (407)

</details>

### calendar

- **Legacy slot root(s):** `pages/CalendarModular.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 12 files, 5015 lines; plus 2 already-unreachable file(s), 184 lines, that import this group and would stop compiling: `pages/calendar/EventCard.tsx`, `pages/calendar/index.tsx`.
- **Tests/stories deleted with it:** 1 file, 79 lines.
- **Test edits:** deletes `pages/calendar/CalendarPage.reminders.test.tsx` (the Mudavym reminders are covered in `calendar/next/CalendarNext.test.tsx`).
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=20 vitest=1  Test Files 1 failed | 26 passed (27) |  Tests 496 passed (496)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 59 passed (59) |  Tests 1273 passed (1273)`
<details><summary>Files</summary>

- `data/customEventTypes.ts` (72)
- `pages/CalendarModular.tsx` (26)
- `pages/calendar/CalendarAgenda.tsx` (235)
- `pages/calendar/CalendarDay.tsx` (437)
- `pages/calendar/CalendarMonth.tsx` (308)
- `pages/calendar/CalendarPage.tsx` (753)
- `pages/calendar/CalendarSidebar.tsx` (242)
- `pages/calendar/CalendarWeek.tsx` (537)
- `pages/calendar/DragDropProvider.tsx` (276)
- `pages/calendar/EventModal.tsx` (1592)
- `pages/calendar/MeetingMemoPrompt.tsx` (284)
- `pages/calendar/useCalendarPage.ts` (253)
- `pages/calendar/EventCard.tsx` (155)
- `pages/calendar/index.tsx` (29)

Tests:
- `pages/calendar/CalendarPage.realtime.test.tsx` (79)

</details>

### settings

- **Legacy slot root(s):** `pages/Settings.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 9 files, 3858 lines.
- **Tests/stories deleted with it:** 5 files, 708 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 37 passed (37) |  Tests 868 passed (868)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 37 passed (37) |  Tests 868 passed (868)`
<details><summary>Files</summary>

- `components/settings/AiAutonomySection.tsx` (327)
- `components/settings/ConsentDialog.tsx` (178)
- `components/settings/EmailSenderSettings.tsx` (121)
- `components/settings/IntegrationsAuth.tsx` (190)
- `components/settings/NotificationsSection.tsx` (304)
- `components/settings/OperatingHoursSection.tsx` (396)
- `components/settings/PosSettingsSection.tsx` (400)
- `components/settings/ServicesPermissions.tsx` (311)
- `pages/Settings.tsx` (1631)

Tests:
- `__tests__/settings/OperatingHoursSection.test.tsx` (269)
- `components/settings/AiAutonomySection.test.tsx` (159)
- `components/settings/ServicesPermissions.stories.tsx` (20)
- `pages/__tests__/Settings.calendar.test.tsx` (124)
- `pages/__tests__/Settings.currency.test.tsx` (136)

</details>

### profile

- **Legacy slot root(s):** `pages/Profile.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 909 lines.
- **Tests/stories deleted with it:** 1 file, 123 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=1 vitest=1  Test Files 1 failed | 26 passed (27) |  Tests 468 passed (468)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 468 passed (468)`
<details><summary>Files</summary>

- `pages/Profile.tsx` (909)

Tests:
- `pages/Profile.test.tsx` (123)

</details>

### logs

- **Legacy slot root(s):** `pages/LogsTimelinePage.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 390 lines.
- **Tests/stories deleted with it:** 1 file, 255 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=2 tsErr=1 vitest=1  Test Files 1 failed | 25 passed (26) |  Tests 465 passed (465)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
<details><summary>Files</summary>

- `pages/LogsTimelinePage.tsx` (390)

Tests:
- `pages/LogsTimelinePage.test.tsx` (255)

</details>

### help

- **Legacy slot root(s):** `pages/Help.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 198 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 468 passed (468)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 468 passed (468)`
<details><summary>Files</summary>

- `pages/Help.tsx` (198)

</details>

### cellar

- **Legacy slot root(s):** `pages/wine-library/index.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 6 files, 4637 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 469 passed (469)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 469 passed (469)`
<details><summary>Files</summary>

- `components/wines/AddToInventoryFromLibraryModal.tsx` (1102)
- `components/wines/DevManualWineEntry.tsx` (939)
- `components/wines/DevWinePhotoUpload.tsx` (329)
- `pages/WineLibrary.tsx` (1911)
- `pages/wine-library/index.tsx` (3)
- `pages/wine-library/useWineLibraryPage.ts` (353)

</details>

### admin

- **Legacy slot root(s):** `pages/AdminPanel.tsx`, `pages/AdminHealth.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 2 files, 1160 lines.
- **Tests/stories deleted with it:** 2 files, 158 lines.
- **Test edits:** `PageGate.liveForEveryHouse.test.tsx:133,138` pin the post-cutover `/admin`, `/admin/health` elements.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 1 failed | 24 passed (25) |  Tests 2 failed | 463 passed (465)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
<details><summary>Files</summary>

- `pages/AdminHealth.tsx` (278)
- `pages/AdminPanel.tsx` (882)

Tests:
- `pages/AdminHealth.test.tsx` (84)
- `pages/AdminPanel.test.tsx` (74)

</details>

### authorize

- **Legacy slot root(s):** `pages/AuthorizeIntegration.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 474 lines.
- **Tests/stories deleted with it:** 2 files, 498 lines.
- **Test edits:** `PageGate.liveForEveryHouse.test.tsx:145` pins the post-cutover element.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 1 failed | 24 passed (25) |  Tests 1 failed | 464 passed (465)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
<details><summary>Files</summary>

- `pages/AuthorizeIntegration.tsx` (474)

Tests:
- `pages/AuthorizeIntegration.retention.test.tsx` (286)
- `pages/AuthorizeIntegration.test.tsx` (212)

</details>

### ask

- **Legacy slot root(s):** `pages/SommelierAI.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 2 files, 981 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 473 passed (473)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 26 passed (26) |  Tests 473 passed (473)`
<details><summary>Files</summary>

- `lib/assistantMarkdown.ts` (57)
- `pages/SommelierAI.tsx` (924)

</details>

### promotions

- **Legacy slot root(s):** `pages/Promotions.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 795 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Test edits:** `PageGate.liveForEveryHouse.test.tsx:219` pins the post-cutover element.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 1 failed | 26 passed (27) |  Tests 1 failed | 512 passed (513)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 27 passed (27) |  Tests 513 passed (513)`
<details><summary>Files</summary>

- `pages/Promotions.tsx` (795)

</details>

### vendor_prices

- **Legacy slot root(s):** `pages/VendorPriceCompare.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 1 file, 605 lines.
- **Tests/stories deleted with it:** 0 files, 0 lines.
- **Test edits:** `PageGate.liveForEveryHouse.test.tsx:227` pins the post-cutover element.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=1  Test Files 1 failed | 24 passed (25) |  Tests 1 failed | 464 passed (465)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 25 passed (25) |  Tests 465 passed (465)`
<details><summary>Files</summary>

- `pages/VendorPriceCompare.tsx` (605)

</details>

### arrival_book

- **Legacy slot root(s):** `pages/arrival/Arrival.tsx`. Importers outside App.tsx's `legacy` slot, non-test: **none** (import graph, `src/main.tsx` as root).
- **Source deleted:** 6 files, 3061 lines.
- **Tests/stories deleted with it:** 2 files, 827 lines.
- **Trial v1** (group files + its obvious tests only): `tsc=0 tsErr=0 vitest=0  Test Files 40 passed (40) |  Tests 820 passed (820)`
- **Trial v2** (with dead importers, its own tests and the edits above): `tsc=0 tsErr=0 vitest=0  Test Files 40 passed (40) |  Tests 820 passed (820)`
<details><summary>Files</summary>

- `pages/arrival/Arrival.tsx` (1413)
- `pages/arrival/ArrivalField.tsx` (282)
- `pages/arrival/arrival-api.ts` (235)
- `pages/arrival/arrival-reading.ts` (263)
- `pages/arrival/arrival.css` (698)
- `pages/arrival/local-speech.ts` (170)

Tests:
- `pages/arrival/Arrival.test.tsx` (747)
- `pages/arrival/local-speech.test.ts` (80)

</details>

### shared (goes only when every group that uses it goes)

With both `settings` and `profile`, `GoogleLinkButton.tsx`'s going also takes the already-unreachable `components/onboarding/OptionalTail.tsx` (and its test `OptionalTail.calendar.test.tsx`); with both `communications` and `documents`, `sendRefused.test.ts` loses its one legacy-ledger case (the live `sendState` case stays). The shared files' own tests (`conversationFilters.test.ts`, `conversationGrouping.test.ts`, `ConversationFilterBar.test.tsx`) go with them.

- `components/auth/GoogleLinkButton.tsx` (97) — settings, profile
- `components/communications/ClassifiedConversationList.tsx` (834) — communications, documents
- `components/communications/ConversationFilterBar.tsx` (246) — communications, documents
- `components/communications/ConversationTimeFilter.tsx` (224) — communications, documents
- `hooks/useOrdersMetrics.ts` (370) — dashboard, reports
- `hooks/useTemplates.ts` (171) — vendors, communications
- `lib/calendar-dates.ts` (16) — dashboard, calendar
- `lib/conversationFilters.ts` (398) — communications, documents
- `lib/conversationGrouping.ts` (243) — communications, documents

### redirect_slots (App.tsx only, no file)

- **What goes:** the ten `legacy={<Navigate …/>}` slots named in §3.
- **Trial v2:** `tsc=0`, vitest on every test that names `App.tsx`, `PageGate` or a Navigate slot: 25 files, 465 passed.

## 5. Groups this manifest lists but the trial cutover does NOT perform

These are legacy branches **inside** files that stay, not files; a file-group trial cannot prove them, and removing them is a hand edit that needs its own review. **OD-178** asks whether they ride this PR or follow it.

- **G-shell — the legacy app shell.** `shell` is live in code for every house (row 36's 2026-09-25 bracket), so the off-branch renders only under `mudavym.design.shell = "0"`: `LegacyDashboardLayout` (`components/layout/DashboardLayout.tsx:59-143`) and the `Sidebar` it alone mounts (`components/layout/Sidebar.tsx`, 898 lines, + its story and `Sidebar.account.test.tsx`); the off-branches of `ShellCatchAll.tsx:22-25`, `AppOfflineBanner.tsx:32`, `AppToaster.tsx:22`, `DayLine.tsx:155`, `HousePageLoader.tsx:67`, `contexts/ToastContext.tsx:99`; and the `useMudavymShell().on ? … : …` false branches in 15 components, most of which become dead only once the page groups above are gone. `components/layout/Header.tsx` is **not** in it: `pages/DevSandbox.tsx:14` still mounts it.
- **G-public — the public doors' off-branch.** `isPublicDesignOn()` is `true` unless `localStorage["mudavym.design.public"] = "0"` (`lib/mudavym/publicDesign.ts:1-27`, ADR 0149 row 37 "permanent-on at cutover"); the old page survives as the `false` branch in `pages/Login.tsx:118`, `Register.tsx:77`, `ForgotPassword.tsx:17`, `ResetPassword.tsx:17`, `VerifyEmail.tsx:30`, `InviteLanding.tsx:65`, `NoAccess.tsx:10`, `ChooseHouse.tsx:71`, `Privacy.tsx:34`, `VendorPortal.tsx:96`, `authorize-integration/AuthorizeShell.tsx:152` and `components/brand/AuthShell.tsx:17`. `Register.tsx` alone has ~200 references to the switch, interleaved with the live branch — the largest single hand edit on the manifest. Line counts of the off-branches are **not measured**.

## 6. What the trial cutover commit changes besides deleting files

- `apps/web/src/App.tsx` — 26 legacy imports and 38 of its 39 `legacy=` slots removed (27 on component routes, the 10 redirects, and `/get-started`'s gate, which now renders `GetStarted` directly; the one left is `/inventory`'s, the same page in both slots); the comments the cutover made stale are bracketed, not rewritten.
- `components/mudavym/PageGate.tsx` — `legacy` optional (§3); new `PageGate.noLegacy.test.tsx`.
- **CLAIMS** — 24 rows read a deleted file or pinned an old route shape; each keeps its id and status, gains a dated bracket naming its group, and swaps the legacy half of its `verify` for the file's absence (`test ! -e`) or a live equivalent (`OD-86` → `settings/next/FeaturesSection.tsx`; `ADR-0100` → no `innerHTML` anywhere under `pages/ask`; `ADR-0175-SEND-REFUSED-CLOSES` → `communications/next/cm-format.ts`). `check_decision_claims.sh`: 736 checked, 736 holding.
- `scripts/check_adr_0140_door_outbox.py` — the deleted `DoorReceipt.tsx` leaves its screen list.
- `scripts/read_error_baseline.json` + `DELIVERY-AUDIT.md` §6 — `SeatingDensityPanel.tsx`'s row retired; the baseline's `total_sites` had drifted (159 recorded, rows summing to 152), re-measured to 151 across 37 files.
- `components/settings/inactiveFeatures.ts` and the gateway's `INACTIVE_FEATURE_FLAGS` entry for `enable_check_scanning` — both named the deleted `/reports` check scanner as the capability; corrected to say nothing reads a check. The gateway line is a string in a list the API never returns (the `INACTIVE_FEATURE_FLAGS` doc comment says so); gateway `tsc` 0, `jest src/settings` 11 suites / 179 tests passed.
- ~~Not changed, stated: `apps/web/e2e/nightly/manifest.json:608-615` lists `/recommendations/catalog` as a pending page whose `file` is the deleted `InsightCatalog.tsx`…~~ [Wrong, corrected 2026-09-28 in the fix round. The entry was stale for the *walk* before the cutover: the route has rendered `CatalogView` for every house since #483, so the nightly's pending check already failed. But `check_nightly_manifest.py` [5] passed on `main`, because the file existed. Deleting it with group `recommendations` is what broke CI.]
- **The nightly e2e manifest** (`apps/web/e2e/nightly/manifest.json`), changed in the fix round. The cutover broke CI's check and would have broken the nightly walk after deploy:
  - **`arrival`** — `source` was `pages/arrival`, which group `arrival_book` deletes (check [2]). `/get-started` now renders `GetStarted` with no gate and no `.mudavym` root. So the entry is now `legacy: "same"` with `source: "apps/web/src/pages"` (the page file's own directory). Its Arrival-book sentences are dropped: `GetStarted` renders no read-state sentence.
  - **23 pages, `legacy` from `page` to `none`** (a new value). The nightly's flag-off pass asserted *no* Mudavym root for `page`. With the legacy slot gone, the override `"0"` renders the Mudavym page, so every one of those pages would have gone red after deploy. `none` asserts the Mudavym root in **both** passes. `same` was not used because it records the root and does not assert it. The pages: dashboard, orders, receiving, receiving_door, providers, communications, team, receipts, documents_reports, reports, notifications, recommendations, promotions, calendar, settings, profile, cellar, authorize_integration, logs, help, admin, vendor_prices and ask.
  - **Redirects to `none`:** `document`, `connections` and `menu`, which were `redirect:/…`, and the `/cellar` alias. `/admin/health` keeps `redirect:/admin`, because its `next` slot is itself a `Navigate`.
  - **`/recommendations/catalog`** moved from `pending_pages` to an alias of `recommendations`. Its `file` was the deleted `InsightCatalog.tsx` (check [5]), and it is gated under that enrolled slug (`App.tsx`, `PageGate page="recommendations"`). `pending_pages` is now empty.
  - **Supporting edits:** `nightly.spec.ts` (the `none` branch), `lib.ts` (`PageEntry.legacy` doc) and `e2e/README.md` §6.
  - **Re-checkable:** `check_nightly_manifest.py` does not read `legacy`, so CLAIMS `ADR-0149-CUTOVER-NIGHTLY-LEGACY-VALUES-MATCH-APP` (resolved) holds each value against App.tsx. It was mutation-tested both ways. A group the founder refuses restores its slot, which turns the row STALE until its entry goes back to `page`.
  - **Verified:** `check_nightly_manifest.py` and its `--self-test` pass. `playwright test --config playwright.nightly.config.ts --list` loads the spec (6 tests). The walk itself was **not** run: it needs a deployed build and the simulator account.

## 7. His answers, group by group

Every row is a fork. The recommendation for every page group is **approve**: each passed its trial, each root has no live importer, and each page's Mudavym replacement is live for every house. The last column names what approving also costs.

| Group | Files / lines (source + tests) | Recommendation | Also note |
|---|---|---|---|
| dashboard | 12 files, 4,241 lines; no tests | Approve | Takes two already-dead files (`AIDateExtractionAlert.tsx`, the `hooks/index.ts` barrel) |
| orders | 13 files, 7,703 lines; tests 4 files, 856 lines | Approve | `OrdersLegacySeal.test.ts` keeps only its `ResponsesSheet` half |
| receiving_desk | 1 file, 469 lines; tests 1 file, 223 lines | Approve | |
| receiving_door | 1 file, 543 lines; tests 1 file, 230 lines | Approve | `check_adr_0140_door_outbox.py` loses one screen |
| vendors | 17 files, 8,363 lines; tests 7 files, 806 lines | Approve | Carries G8's world map (`distributors/command/*`, already ruled "delete" — item 52) and `Providers.tsx`; **keeps** `ProviderIntelligencePanel` and its tabs, which the live sheet renders |
| communications | 8 files, 5,298 lines; tests 2 files, 242 lines | Approve | Shares four conversation files with `documents` |
| documents | 1 file, 1,107 lines; tests 1 file, 57 lines | Approve | Shares the same four with `communications` |
| team | 8 files, 2,736 lines; tests 2 files, 533 lines | Approve, **but only after** a separate reviewed amendment to `check_windowed_figures.py`'s /team PageSpec lands first. That amendment drops the four legacy renderers, adds the three unlisted rebuilt files, and retargets the self-test (§4 `team`). Until then the draft's CI stays red on that guard. The other path is to hold the group, which means restoring its files on this branch | Its G0.3 gap is built on `main` (#436). Sub-fork: approve the guard amendment (a CI change, not a page deletion) |
| receipts | 1 file, 532 lines; tests 1 file, 112 lines | Approve | Credits are rebuilt (G8); `ReceiptsSeal.test.tsx` loses its legacy §4 |
| reports | 53 files, 9,698 lines; tests 23 files, 1,926 lines | Approve | Deletes the `/reports` check scanner — a stub that never read a check (`pages/Reports.tsx:554,926` at `c8bbf95de`: scans always `[]`, upload only logs the file name); Settings' "always available from Reports" copy corrected |
| notifications | 1 file, 2,478 lines; no tests | Approve | Its G0.3 gap is built on `main` (#486) |
| recommendations | 3 files, 1,975 lines; tests 1 file, 407 lines | Approve | The catalogue's ADR 0020 honesty lives on in `rec-catalog.test.ts` / `CatalogView.test.tsx` |
| calendar | 14 files, 5,199 lines; tests 2 files, 356 lines | Approve | Reminder coverage lives in `calendar/next/CalendarNext.test.tsx` |
| settings | 9 files, 3,858 lines; tests 5 files, 708 lines | Approve | Shares `GoogleLinkButton.tsx` with `profile`; both going also takes the already-dead `OptionalTail.tsx` |
| profile | 1 file, 909 lines; tests 1 file, 123 lines | Approve | See settings |
| logs, help, cellar, admin, authorize, ask, promotions, vendor_prices | logs: 1 file, 390 lines; tests 1 file, 255 lines; help: 1 file, 198 lines; no tests; cellar: 6 files, 4,637 lines; no tests; admin: 2 files, 1,160 lines; tests 2 files, 158 lines; authorize: 1 file, 474 lines; tests 2 files, 498 lines; ask: 2 files, 981 lines; no tests; promotions: 1 file, 795 lines; no tests; vendor_prices: 1 file, 605 lines; no tests | Approve each | |
| arrival_book | 6 files, 3,061 lines; tests 2 files, 827 lines | Approve — his F5 answer (A), 2026-09-25 | Sub-fork: retire `mudavym_design_arrival` (ACTIVE gateway key, `MUDAVYM_PAGES` entry) now or later. Recommend **later, in its own gateway PR**: this deploy is web-only, and the column stays either way |
| redirect_slots | 0 files | Approve | |
| shared | 9 files, 2,599 lines | — | Goes only with every group that uses it; no separate answer needed |
| G-shell, G-public | in-file, not trialled | OD-178 | §5 |


## 8. Not done, stated

- **Per-group vitest was targeted, not full.** Each group's trial ran vitest on the tests that name a deleted file, `App` or `PageGate` (25-125 files a group); the full suite ran once, on the combined cutover (§1.4). A group he refuses changes the combined tree, so the branch needs a fresh full run after his answers.
- **No capability audit was redone** (§1.6); the check scanner was found by accident.
- **The gap list in §2 is a heuristic** over class names, not a look at each surface in a browser.
- **G-shell and G-public were not trialled** and their line counts not measured (§5).
- **`check_migration_versions_unique.py` was not run** — it needs `gh`, which this environment lacks. No migration is touched.
- **Recorded rather than fixed:** ~~the nightly e2e manifest's stale `/recommendations/catalog` entry (§6)~~ [fixed 2026-09-28, §6]; `mudavym_design_arrival` left ACTIVE (§3).
- **`check_windowed_figures.py` still exits 2 on the draft branch** (group `team`, §4). Not fixed: both the guard edit and the group restore were refused by the session's permission check in the fix round. The founder or coordinator chooses (§7).
- **The CI guard sweep (§1.5) skipped the guards that need `gh`, a database or a gateway build**: `check_migration_versions_unique.py`, `check_migration_order.py --event`, `check_gateway_boots.sh`, `pr_audit_gate.py`, and the `test_*` / eval scripts. No migration or gateway boot path is touched.
- **The nightly walk was not run** (§6). Its manifest and spec changes are checked by the static guard, the new CLAIMS row and a Playwright `--list` load only.
