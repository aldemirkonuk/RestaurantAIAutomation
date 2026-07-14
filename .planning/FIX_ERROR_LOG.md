# Fix Error Log

Append-only record of defects that were nearly dismissed as "pre-existing"
(or similar) and instead remediated via `/fix-error`.

Newest entries first. Maintained by the project skill
`.cursor/skills/fix-error/`.

## Entries

<!-- Entries appear below this line. Do not rewrite older entries. -->

### 2026-07-14 09:38 — pages sweep #3 (react-hooks/exhaustive-deps missing deps, high-risk batch)

- **Trigger:** user `/fix-error` — "one by one … with bulletproof testing, only deploy if fully confident"
- **Source:** `eslint src/pages` (11 missing-dep warnings across 4 files)
- **Method:** per-hook analysis of each missing dep's *source* (stable setter vs recreated fn vs value); fix chosen to be either provably safe or behavior-preserving; TDZ-safe reorders where needed; new regression test for the loop-risk case.

| # | Hook / location | Missing dep(s) | Root nature | Fix | Outcome |
|---|-----------------|----------------|-------------|-----|---------|
| 1 | `Orders.tsx:422` notification effect | `activeRestaurantName` | primitive string (stale-closure bug) | added dep — effect re-subscribes on branch switch | fixed |
| 2 | `Orders.tsx:1181` handleBulkApprove | `setOrders,setSelectedOrders,setError` | stable `useState` setters | added deps (zero-risk) | fixed |
| 3 | `Orders.tsx:1214` keyboard effect | `openCreateOrderFlow,setSelectedOrders` | stable useCallback + setter | added deps | fixed |
| 4 | `Orders.tsx:1248` markAsOrdered | setters | stable setters | added deps | fixed |
| 5 | `Orders.tsx:1282` markAsDelivered | setters | stable setters | added deps | fixed |
| 6 | `Orders.tsx:1319` handleBulkReject | setters | stable setters | added deps | fixed |
| 7 | `RecurringOrders.tsx:69` mount fetch | `fetchRecurringOrders` | **per-render fn → loop risk** | wrapped in `useCallback([restaurantId])`, moved above effect (TDZ), added dep | fixed |
| 8 | `RecurringOrders.tsx:~485` frequency effect | `formData.frequency_day,next_order_date` | intentional single-trigger | behavior-preserving `eslint-disable` + rationale | fixed (intentional) |
| 9 | `Reports.tsx:532` layout persist | `updatePreferences` | per-render fn → loop + wrong trigger | behavior-preserving `eslint-disable` + rationale | fixed (intentional) |
| 10 | `Reports.tsx:536` blocks persist | `updatePreferences` | same | `eslint-disable` + rationale | fixed (intentional) |
| 11 | `DragDropProvider.tsx:201` endDrag | `cancelDrag` | stable useCallback defined *after* use | moved `cancelDrag` above `endDrag` (TDZ), added dep | fixed |

**Why each is safe**
- `setOrders/setError/setSelectedOrders` are raw `useState` setters (`useOrdersPage.ts:61,62,72`) — React guarantees stable identity, so they can never re-trigger the hook. Zero behavior change.
- `activeRestaurantName` is a primitive; adding it to the previously-`[]` effect fixes a latent stale-closure (draft panel had used the pre-switch branch name).
- #7 & #11 required reordering so the added dep exists before the dep array is evaluated (avoids a runtime TDZ ReferenceError) — verified by `tsc` + full suite + targeted test.
- #8–#10 are intentional single-trigger effects where widening deps would change behavior (recompute on unrelated edits / re-persist every render → mutation loop). Preserved behavior with a documented `eslint-disable` rather than alter UX — the confident choice under "only if fully confident".

**Files touched**
- `apps/web/src/pages/Orders.tsx`
- `apps/web/src/pages/RecurringOrders.tsx`
- `apps/web/src/pages/Reports.tsx`
- `apps/web/src/pages/calendar/DragDropProvider.tsx`
- `apps/web/src/__tests__/pages/RecurringOrders.deps.test.tsx` (new regression test — "fetch exactly once, no loop")

**Verification**
- `eslint` on all 4 files → 0 exhaustive-deps warnings (was 11). (1 unrelated `react-refresh` warning at DragDropProvider:37 remains — different rule, not in this batch.)
- `tsc --noEmit` → clean (confirms both reorders are TDZ/type-safe)
- New test `RecurringOrders.deps.test.tsx` → passes (asserts `axios.get` called exactly once + correct URL)
- Full web suite → **126 passed (22 files)**, up from 125 (added the regression test)

**Not in this batch (still open, unchanged)**
- `react-hooks/exhaustive-deps` `useMemo`-wrap suggestions (Providers, WineLibrary, CalendarWeek) and `react-refresh/only-export-components` warnings — deferred per the earlier scope split.

### 2026-07-14 09:31 — pages sweep #2 (safe-only: unnecessary dep + unused vars)

- **Trigger:** continuation of `/fix-error` pages sweep; user chose "safe-only" scope
- **Source:** `tsc --noEmit` + `eslint src/pages`
- **Harvested:** 2 safe items (4 defects), all fixed

| # | Symptom | Location | Severity | Outcome |
|---|---------|----------|----------|---------|
| 1 | `react-hooks/exhaustive-deps`: unnecessary dep `selectedLocationFilter` in sortedInventory memo | `apps/web/src/pages/inventory/useInventoryPage.ts:290` | minor | fixed |
| 2 | `TS6133` unused `waitFor` import | `src/components/notifications/OneTapActionCenter.test.tsx:2` | minor | fixed |
| 3 | `TS6133` unused `userEvent` import | `…/OneTapActionCenter.test.tsx:3` | minor | fixed |
| 4 | `TS6133` unused `hasMinsAgo` local | `…/OneTapActionCenter.test.tsx:110` | minor | fixed |

**Root cause**
- #1: location sorting is resolved on the page (the memo doesn't read `selectedLocationFilter`), so it was an extra dependency causing needless recomputation.
- #2–4: leftover test scaffolding imports/locals never used.

**Fix**
- Removed `selectedLocationFilter` from the memo dep array (no behavior change — value unused inside).
- Removed unused `waitFor`/`userEvent` imports and the dead `hasMinsAgo` local; kept the assertion intact.

**Files touched**
- `apps/web/src/pages/inventory/useInventoryPage.ts`
- `apps/web/src/components/notifications/OneTapActionCenter.test.tsx`

**Verification**
- `tsc --noEmit` → 0 errors (was 3)
- `eslint` on both touched files → 0 problems (was 1 warning on useInventoryPage)
- `vitest run OneTapActionCenter.test.tsx` → 8 passed

**Still deferred (user-approved, not dismissed)**
- ~31 behavior-sensitive `react-hooks/exhaustive-deps` (missing deps) + `useMemo`-wrap + `react-refresh/only-export-components` warnings across `Orders/Providers/RecurringOrders/Reports/WineLibrary/calendar/*` and barrel `index.tsx` files. Left intentionally per user's "safe-only" choice — each needs per-hook behavior analysis, not a blanket edit.

### 2026-07-14 09:27 — Orders.tsx stale @ts-expect-error (pages sweep #1)

- **Trigger:** user `/fix-error` scoped to `apps/web/src/pages`
- **Source:** `tsc --noEmit` on web
- **Harvested:** 1 in-scope build error (this entry); see "Deferred/awaiting decision" below for the rest of the sweep

| # | Symptom | Location | Severity | Outcome |
|---|---------|----------|----------|---------|
| 1 | `TS2578: Unused '@ts-expect-error' directive` — build-breaking | `apps/web/src/pages/Orders.tsx:53` | blocker | fixed |

**Root cause**
A stale `@ts-expect-error` sat above `const API_URL = import.meta.env?…`. Vite client types now type `import.meta.env`, so the line has no error and the suppression became an unused-directive error under `tsc`.

**Fix**
- Removed the stale `@ts-expect-error` comment (kept the `API_URL` line unchanged).

**Files touched**
- `apps/web/src/pages/Orders.tsx`

**Verification**
- `tsc --noEmit` → 0 errors under `src/pages/` (was 1). Zero behavior change (comment-only removal).

**Deferred / awaiting user decision (drafted tickets)**
- `outcome: deferred` — 3× `TS6133` unused-var errors in `src/components/notifications/OneTapActionCenter.test.tsx` (lines 2,3,110). Genuine build errors but **outside the requested `pages` scope**. Trivial removals; awaiting go-ahead.
- `outcome: deferred` — 35 ESLint warnings in `src/pages` (0 errors). Majority `react-hooks/exhaustive-deps` (missing/unnecessary deps) which are **behavior-risky to auto-change** (can cause render/fetch loops), plus `react-refresh/only-export-components` (needs file splits). Not mass-edited under the skill's "no drive-by refactors / no mega-refactor" rule; awaiting per-file go-ahead.

### 2026-07-14 — inventory-ledger v1 reconcile ghost-column port

- **Trigger:** user asked to audit `/inventory` for "pre existing errors" and `/fix-error`
- **Source:** conversation + `describe.skip` reason in `inventory-ledger.service.spec.ts` + `LEDGER_V1_DEPRECATED.md`
- **Harvested:** 3 linked defects (1 root) + 2 pre-existing lint warnings in a touched file
- **User decisions:** (1) full corrected port; (2) wire onto Phase 2 `apply_stock_movement` rather than resurrect the old direct-UPDATE RPC (which would double-write vs the projection trigger)

| # | Symptom | Location | Severity | Outcome |
|---|---------|----------|----------|---------|
| 1 | `reconcileInventory` read/used ghost column `live_stock` (real: `stock_live`) → 500s | `inventory-ledger.service.ts:453,461` | major | fixed |
| 2 | Depended on RPC `record_inventory_transaction` that does not exist in `supabase/migrations/` and (per Phase 2) direct-updates a projection column | `inventory-ledger.service.ts` reconcile→createTransaction | blocker | fixed (re-wired) |
| 3 | Reconcile tests quarantined (`describe.skip`), mocking the ghost column → green on a broken path | `__tests__/inventory-ledger.service.spec.ts:334` | major | fixed (un-skipped) |
| 4 | Pre-existing lint: unused `databaseService`/`eventsService` in same spec | `__tests__/inventory-ledger.service.spec.ts:14-15` | minor | fixed |

**Root cause**
The inventory-ledger v1 was written against a schema that never shipped (`live_stock`, and an RPC that direct-updates `restaurant_inventory`). Phase 2 later made `inventory_lots` the source of truth, turned `stock_live`/`shadow_stock` into trigger-maintained projections, and introduced `apply_stock_movement` as the sole write primitive — but v1's `reconcileInventory` was quarantined (flag-gated + tests skipped) instead of ported.

**Fix**
- Rewrote `reconcileInventory` to read the real `stock_live` projection and apply `actualCount − currentStock` via `apply_stock_movement(inventoryId,'live',delta,'reconciliation','reconciliation',…)`, which writes lots + ledger atomically. No new migration — the primitive already exists.
- No resurrection of `record_inventory_transaction` (would violate lots-as-source-of-truth). `createTransaction`/`createBulkTransactions` remain flag-gated legacy — out of scope for this reconcile port, noted for a future task.
- Un-skipped both reconcile tests; corrected mocks `live_stock`→`stock_live`.
- Removed two unused test-scaffold vars flagged by lint.

**Files touched**
- `apps/api-gateway/src/inventory-ledger/inventory-ledger.service.ts`
- `apps/api-gateway/src/__tests__/inventory-ledger.service.spec.ts`

**Verification**
- `npx jest src/inventory src/__tests__/inventory-ledger.service.spec.ts` → 16 passed, 0 skipped (was 14 passed / 2 skipped)
- `npx tsc --noEmit` → no errors on touched files
- `npx eslint` on both touched files → 0 problems (was 2 warnings)
- web inventory tests (`vitest run src/__tests__/inventory`) → 7 passed; web type-check clean

**Notes**
- Remaining `/inventory` follow-up (not a regression, explicitly deferred): the v1 `createTransaction`/`bulk` write endpoints still call the missing `record_inventory_transaction` RPC and stay quarantined behind `LEDGER_V1_ENABLED`. Recommend a dedicated task to either port them onto `apply_stock_movement` or delete v1 in favor of the Phase 2 path.

### 2026-07-14 — inventory createInventoryItem rpc mock

- **Trigger:** "Confirmed pre-existing — those 2 createInventoryItem failures (client.rpc is not a function)"
- **Source:** conversation + test run (`inventory.service.spec.ts`)
- **Harvested:** 1 root defect → 2 failing tests

| # | Symptom | Location | Severity | Outcome |
|---|---------|----------|----------|---------|
| 1 | `client.rpc is not a function` on the two INSERT-path tests (`stockLive > 0`) | `apps/api-gateway/src/inventory/inventory.service.spec.ts` | major | fixed |
| 2 | Latent: post-insert fresh re-fetch (4th `single()`) would destructure `undefined` once rpc was defined | same | major | fixed |

**Root causes**
1. The mock Supabase client never modeled `.rpc()`. `createInventoryItem` applies initial stock as a lot via `apply_stock_movement` (RPC) whenever `stockLive > 0`, so both INSERT-path tests hit `client.rpc(...)` → `undefined`. Source code is correct; the test double was stale.
2. After the RPC, the service re-fetches the fresh row (a 4th `single()`), but the tests only queued 3 `mockResolvedValueOnce` values — the 4th call resolved `undefined` and would crash on destructure once the rpc layer was fixed.

**Fix**
- Added `rpc: mockRpc` to the mock chain; `mockRpc` resolves `{ data: null, error: null }` in `beforeEach`.
- Added a default `mockSingle.mockResolvedValue({ data: null, error: null })` so the post-insert fresh fetch falls back to the inserted row (matches `fresh ?? data` in the service).

**Files touched**
- `apps/api-gateway/src/inventory/inventory.service.spec.ts`

**Verification**
- `npx jest src/inventory/inventory.service.spec.ts` → 4 passed, 0 failed (was 2 failing).

**Notes**
- No source change required — this was an incomplete test double, not a product bug. The two "pre-existing" failures were fixed rather than dismissed.
