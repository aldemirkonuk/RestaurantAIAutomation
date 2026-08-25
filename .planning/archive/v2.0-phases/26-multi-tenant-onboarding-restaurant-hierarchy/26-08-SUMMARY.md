---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: 26-08
title: "Frontend — Edit Location + Create Chain auto-assign + AuthContext refreshBranches"
completed_date: "2026-05-10"
status: complete
duration_minutes: 25
tasks_completed: 5
tasks_total: 5
key_files:
  created:
    - apps/web/src/components/locations/EditLocationChainDialog.tsx
  modified:
    - apps/web/src/contexts/AuthContext.tsx
    - apps/web/src/pages/Settings.tsx
decisions:
  - "fetchAndSetBranches uses userId param (not user.restaurantId closure) so fallback branch is correct in refresh context"
  - "T5 (AddLocationDialog refresh) implemented within T2 Settings.tsx commit since both touch the same file"
  - "EditLocationChainDialog derives chain list from locationsList in Settings rather than fetching separately — avoids extra API call"
  - "Chain-switching amber warning triggers only when isSwitchingChain=true (branch already in a chain AND user selected a different chain)"
---

# Phase 26 Plan 08: Frontend — Edit Location + Create Chain auto-assign + AuthContext refreshBranches Summary

## One-liner

AuthContext `refreshBranches()` + pencil-icon chain reassignment dialog + Create Chain auto-assign checkbox eliminate all page-reload requirements for chain/location management.

## What Was Built

### T1 — AuthContext: expose `refreshBranches()`

Extracted the branch-fetch logic from the `useEffect` into a `useCallback` named `fetchAndSetBranches(userId)`. This is reused by both the initial `useEffect` (on user change) and the new public `refreshBranches()` function. Key safety: `activeRestaurantId` is preserved across refreshes via the existing `validSaved` check — no reset happens on refresh.

Added `refreshBranches: () => Promise<void>` to `AuthContextType` interface and context value.

### T2 — Settings: pencil icon on each location row

- Imported `Pencil` from lucide-react, `EditLocationChainDialog`, and `RestaurantBranch` type
- Added `editingBranch: RestaurantBranch | null` state
- Added pencil button (`w-3.5 h-3.5`) to each branch row in both the chain-grouped and standalone sections
- Wired `EditLocationChainDialog` with `onSaved` calling `refreshBranches()` + close

### T3 — New component: EditLocationChainDialog

Small focused dialog at `apps/web/src/components/locations/EditLocationChainDialog.tsx`:
- Read-only header showing branch name + city
- `<select>` with "Standalone (no chain)" + all chains from props
- Pre-selects `branch.chain_id` on mount (resets when branch prop changes)
- Amber warning when switching from one chain to another
- `PATCH /api/v1/organizations/locations/:id` with `{ chainId: selectedId || null }`
- Calls `onSaved()` on success; caller calls `refreshBranches()` + closes dialog

### T4 — Settings: "Assign current restaurant" checkbox in Create Chain form

- Added `assignCurrentToChain` boolean state
- Checkbox rendered only when active restaurant has `chain_id === null` (standalone)
- Label: "Move [restaurant.name] into this chain"
- Amber warning if restaurant already has `chain_name` (defensive, since checkbox only appears for standalone restaurants)
- On submit with checkbox: includes `restaurantId: activeRestaurantId` in POST body
- On success: calls `refreshBranches()` so branch switcher updates immediately (no page reload)

### T5 — AddLocationDialog: auto-refresh on success

Replaced `"${location.name} added! Refresh to see it in the branch switcher."` toast + manual close with `toast.success(\`${location.name} added!\`) + await refreshBranches() + setShowAddLocation(false)`. Implemented within T2's Settings.tsx commit since both tasks edited the same file.

## Deviations from Plan

### Merged T5 into T2 commit

**Found during:** Planning the commit sequence

**Issue:** T5 and T2 both modify `Settings.tsx` at the same time. Splitting them into separate commits would require reverting and re-applying changes.

**Fix:** T5's `onLocationAdded` fix was implemented within the T2 Settings.tsx edit and committed together. Both tasks are fully implemented.

**Files modified:** `apps/web/src/pages/Settings.tsx`

**Commit:** 9f12c2a

### Chain list derived from locationsList rather than separate fetch

**Found during:** T3 implementation

**Issue:** The plan mentioned "fetch from /api/v1/organizations/chains same way AddLocationDialog does, or reuse the list". Since `locationsList` already contains `chain_id` and `chain_name` for all branches, we can derive a deduplicated chain list without an extra network request.

**Fix:** In Settings.tsx, chains passed to `EditLocationChainDialog` are derived from `locationsList` using `.filter` + `.map` + deduplication by `chain_id`. This is sufficient since the dialog only needs chains the organization already uses.

**Files modified:** `apps/web/src/pages/Settings.tsx`

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| T1 | f9abcae | feat(phase-26): T1 — AuthContext: expose refreshBranches() |
| T2+T5 | 9f12c2a | feat(phase-26): T2 — Settings: pencil icon on each location row |
| T3 | 06d27e3 | feat(phase-26): T3 — new component: EditLocationChainDialog |
| T4 | 9728206 | feat(phase-26): T4 — Settings: assign current restaurant checkbox in Create Chain form |

## Known Stubs

None — all data flows are wired to real API endpoints.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. All API calls use existing endpoints (`PATCH /organizations/locations/:id`, `POST /organizations/chains`) with existing Bearer token auth.

## Self-Check: PASSED

- [x] `apps/web/src/components/locations/EditLocationChainDialog.tsx` — created
- [x] `apps/web/src/contexts/AuthContext.tsx` — modified (refreshBranches in interface + value)
- [x] `apps/web/src/pages/Settings.tsx` — modified (editingBranch state, pencil buttons, dialogs)
- [x] Commits f9abcae, 9f12c2a, 06d27e3, 9728206 exist in git log
