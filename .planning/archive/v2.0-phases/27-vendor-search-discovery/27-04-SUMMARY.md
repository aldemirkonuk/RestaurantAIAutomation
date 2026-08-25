---
phase: 27-vendor-search-discovery
plan: "04"
subsystem: frontend
tags: [branch-transfer, order-guard, modal, react, radix-dialog, framer-motion]
dependency_graph:
  requires: [27-01, 27-02, 27-03]
  provides:
    - BranchProviderTransferModal (provider copy flow for new branches)
    - OrderGuardModal (pre-order vendor gate)
    - AddLocationDialog wired to BranchProviderTransferModal (post-save hook)
    - Orders.tsx wired to OrderGuardModal (pre-flight + 403 safety net)
    - providers.ts extended with catalogueVendorId, isCustom, bulkCreateProvidersForBranch
  affects:
    - apps/web/src/components/locations/AddLocationDialog.tsx
    - apps/web/src/pages/Orders.tsx
tech_stack:
  added: []
  patterns:
    - Radix Dialog with framer-motion overlay + content animations
    - Per-request X-Restaurant-Id header override for branch-scoped API calls
    - Pre-flight provider count guard before order submission
    - Dual-mode transfer (catalogue re-link vs custom copy)
key_files:
  created:
    - apps/web/src/components/providers/BranchProviderTransferModal.tsx
    - apps/web/src/components/orders/OrderGuardModal.tsx
  modified:
    - apps/web/src/components/locations/AddLocationDialog.tsx
    - apps/web/src/pages/Orders.tsx
    - apps/web/src/services/api/providers.ts
decisions:
  - BranchProviderTransferModal uses direct apiClient.post with X-Restaurant-Id header override (not bulkCreateProvidersForBranch helper) for per-provider progress tracking
  - Transfer modal renders before Dialog.Root in JSX fragment so it stays visible after the location form closes
  - Order guard uses pre-flight check (providers.length===0) as primary; 403 reason=no_vendors as safety net
  - catalogueVendorId and isCustom added to frontend Provider type to align with backend ProviderResponseDto
metrics:
  duration: "18 minutes"
  completed: "2026-05-10"
  tasks_completed: 5
  tasks_total: 5
  files_created: 2
  files_modified: 3
---

# Phase 27 Plan 04: Frontend — Branch Provider Transfer Modal + Order Guard Popup Summary

## One-liner

BranchProviderTransferModal (checkbox copy of providers to new branch) + OrderGuardModal (block orders when zero vendors configured), both wired into AddLocationDialog and Orders.tsx respectively.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 + 5 | BranchProviderTransferModal + providers.ts update | 96e911b | apps/web/src/components/providers/BranchProviderTransferModal.tsx, apps/web/src/services/api/providers.ts |
| 2 | Wire BranchProviderTransferModal into AddLocationDialog | 770e3ba | apps/web/src/components/locations/AddLocationDialog.tsx |
| 3 | OrderGuardModal component | f118629 | apps/web/src/components/orders/OrderGuardModal.tsx |
| 4 | Wire OrderGuardModal into Orders.tsx | 71224a6 | apps/web/src/pages/Orders.tsx |

## What Was Built

### Task 1 — BranchProviderTransferModal.tsx (VENDOR-10)

New modal at `apps/web/src/components/providers/BranchProviderTransferModal.tsx`:

**Props:** `open`, `onClose`, `newBranchName`, `newRestaurantId`, `currentProviders: Provider[]`

**Behavior:**
- All provider checkboxes start pre-checked (user unchecks to exclude)
- "Transfer X Selected" button shows dynamic count
- On transfer: iterates checked providers, calls `POST /providers` with `X-Restaurant-Id: newRestaurantId` header override per request
- Dual-mode: if provider has `catalogueVendorId`, sends `{ catalogue_vendor_id }` (Mode A); otherwise sends `{ name, phone, email }` (Mode B / custom copy)
- Per-provider progress bar (transferred N / total)
- Success toast: "3 vendors added to [Branch Name]"
- Individual failures skip silently; summary toast shows skip count if any
- "Skip for now" immediately closes without any API calls

### Task 2 — AddLocationDialog wiring (VENDOR-10)

Changes to `apps/web/src/components/locations/AddLocationDialog.tsx`:

- New imports: `useAuth`, `useProviders`, `BranchProviderTransferModal`
- `currentProviders` fetched via `useProviders(user?.restaurantId || '')` on mount
- New `transferModal: TransferModalState` state (`{ open, newBranchName, newRestaurantId }`)
- `resetFormFields()` extracted from `handleClose()` for reuse
- In `handleSubmit` success path:
  - If `currentProviders.length > 0 && location.id`: set `transferModal.open=true`, call `resetFormFields()` (NOT `onClose()`)
  - If no providers: call `handleClose()` as before
- `BranchProviderTransferModal` rendered before `Dialog.Root` in a wrapping `<>` fragment — ensures the modal stays visible after the AddLocation dialog closes (component stays mounted in Settings.tsx)

### Task 3 — OrderGuardModal.tsx (VENDOR-10)

New modal at `apps/web/src/components/orders/OrderGuardModal.tsx`:

**Props:** `open`, `onClose`

**Structure:**
- Wine-600 ShoppingBag icon in a rounded wine-50/wine-200 badge
- Title: "Add a vendor to place orders"
- Body: "You don't have any wine vendors set up yet. Before you can place orders, add at least one distributor or supplier to your Providers list."
- "Go to Providers →" button: navigates to `/providers` (via `useNavigate`) and closes modal
- "Back to Order" ghost button: dismisses modal

**Design:** Non-destructive framing (helpful nudge, not error state). Wine-600 primary action.

### Task 4 — Orders.tsx wiring (VENDOR-10)

Changes to `apps/web/src/pages/Orders.tsx`:

- Import `OrderGuardModal`
- New `showOrderGuard` state
- **Pre-flight check** in `handleContactProviders` (Option A, preferred): if `providers.length === 0`, set `showOrderGuard=true` and return early — no network round-trip
- **403 safety net** in procurement order catch block (Option B, fallback): if `error.response.status === 403 && error.response.data.reason === 'no_vendors'`, show guard, close create order modal, return
- `<OrderGuardModal open={showOrderGuard} onClose={() => setShowOrderGuard(false)} />` rendered after `CreateOrderModal` in JSX

### Task 5 — providers.ts service update (VENDOR-10)

Changes to `apps/web/src/services/api/providers.ts`:

- `Provider` interface extended with `catalogueVendorId?: string | null` and `isCustom?: boolean` — aligns with backend `ProviderResponseDto`
- New `bulkCreateProvidersForBranch(providers: Provider[], newRestaurantId: string): Promise<number>` helper function for branch transfer (wraps per-provider POST loop with fail-open per-provider error handling)

## Deviations from Plan

### Auto-adjusted — Tasks 1 and 5 committed together

**Found during:** Task 1

**Issue:** `BranchProviderTransferModal` depends on `Provider.catalogueVendorId` which is not in the original `Provider` type. Both changes are in different files but are logically inseparable.

**Fix:** Both changes committed atomically in commit `96e911b`.

**Files modified:** `BranchProviderTransferModal.tsx`, `providers.ts`

---

### Auto-adjusted — Modal uses apiClient directly, not bulkCreateProvidersForBranch

**Found during:** Task 1

**Issue:** The plan spec calls `bulkCreateProvidersForBranch` from the modal, but the modal needs per-provider progress tracking (updating `transferProgress` after each individual success). The bulk helper returns a final count only.

**Fix:** The modal uses `apiClient.post` directly in a loop for granular progress. `bulkCreateProvidersForBranch` was still created in `providers.ts` per the plan spec (Task 5) and can be used by other callers that don't need progress UI.

---

### Auto-adjusted — Unused import removed from BranchProviderTransferModal

**Found during:** TypeScript check after Task 4

**Issue:** `addProviderFromCatalogue` was imported in `BranchProviderTransferModal.tsx` but not used (modal uses `apiClient` directly).

**Fix:** Import removed. TypeScript confirmed zero new errors in created files.

## Verification Checklist

- [x] `BranchProviderTransferModal.tsx` — exists, exports `BranchProviderTransferModal`, all checkboxes pre-checked, Transfer/Skip buttons, progress bar
- [x] `OrderGuardModal.tsx` — exists, exports `OrderGuardModal`, Go to Providers + Back to Order buttons
- [x] `AddLocationDialog.tsx` — imports `useAuth`, `useProviders`, `BranchProviderTransferModal`; shows transfer modal after successful location creation with existing providers
- [x] `Orders.tsx` — imports `OrderGuardModal`; pre-flight guard blocks order when `providers.length === 0`; 403 no_vendors handler shows guard
- [x] `providers.ts` — `Provider` type extended with `catalogueVendorId` and `isCustom`; `bulkCreateProvidersForBranch` exported
- [x] TypeScript: zero new errors introduced in created/modified files (7 pre-existing `recurrence` errors in Orders.tsx remain unchanged)

**Pending (requires live frontend):**
- [ ] Add location in Settings with existing providers → BranchProviderTransferModal appears immediately after
- [ ] Uncheck 1 provider → Transfer → only checked providers appear in new branch
- [ ] Click Skip → no providers transferred → modal closes
- [ ] Navigate to Orders with zero providers → click Create Order → progress to Contact Providers → OrderGuardModal appears
- [ ] Click "Go to Providers" from OrderGuardModal → navigates to /providers
- [ ] 403 no_vendors response from backend also triggers OrderGuardModal

## Known Stubs

None — all components are fully implemented and wired. The `bulkCreateProvidersForBranch` helper in `providers.ts` is a complete implementation (not a stub), created as a reusable utility for future callers.

## Threat Flags

None — no new network endpoints or auth surfaces introduced. All API calls use the existing `apiClient` with per-request `X-Restaurant-Id` header override (standard pattern for multi-tenant operations).

## Self-Check: PASSED

- apps/web/src/components/providers/BranchProviderTransferModal.tsx: FOUND
- apps/web/src/components/orders/OrderGuardModal.tsx: FOUND
- apps/web/src/components/locations/AddLocationDialog.tsx: FOUND (modified)
- apps/web/src/pages/Orders.tsx: FOUND (modified)
- apps/web/src/services/api/providers.ts: FOUND (modified)
- Commit 96e911b: FOUND (feat(27-04): create BranchProviderTransferModal + extend Provider type + bulkCreateProvidersForBranch)
- Commit 770e3ba: FOUND (feat(27-04): wire BranchProviderTransferModal into AddLocationDialog)
- Commit f118629: FOUND (feat(27-04): create OrderGuardModal component)
- Commit 71224a6: FOUND (feat(27-04): wire OrderGuardModal into Orders.tsx + fix unused import)
