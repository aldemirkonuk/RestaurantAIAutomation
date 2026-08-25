---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: "04"
subsystem: frontend-auth-context
tags: [auth, multi-tenant, branch-switcher, type-change, react-context]
dependency_graph:
  requires: [26-02, 26-03]
  provides: [RestaurantBranch type, AuthContext branch API call, registerRestaurant(), joinViaInvite(), Header branch switcher]
  affects: [apps/web/src/contexts/AuthContext.tsx, apps/web/src/components/layout/Header.tsx]
tech_stack:
  added: []
  patterns: [useMemo for derived branch grouping, optimistic loading state, fallback pattern for pre-org users]
key_files:
  created: []
  modified:
    - apps/web/src/contexts/AuthContext.tsx
    - apps/web/src/components/layout/Header.tsx
decisions:
  - "RestaurantBranch includes chain_id/chain_name fields to support D-10 chain grouping in Header"
  - "fetchBranches() falls back to single-branch with user.restaurantId for pre-org users or API errors"
  - "BranchButton defined as named function above Header to keep JSX readable and avoid re-creation on render"
  - "branchGroups useMemo separates chains vs standalone to enable chain-section grouping without extra API calls"
  - "handleSwitch adds 300ms optimistic delay before clearing isSwitching — gives user feedback without blocking"
metrics:
  duration_minutes: 15
  completed_date: "2026-05-07"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 26 Plan 04: AuthContext + Header Branch Switcher Summary

**One-liner:** Breaking type change `string[] → RestaurantBranch[]` in AuthContext + chain-grouped Header switcher with name/city display, both updated atomically.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | AuthContext.tsx — RestaurantBranch type + branches API call + new methods | c2c92da | apps/web/src/contexts/AuthContext.tsx |
| 2 | Header.tsx — name+city display + ≥2 branches condition + loading state | c68c6ec | apps/web/src/components/layout/Header.tsx |

## What Was Built

### Task 1 — AuthContext.tsx

- **Exported `RestaurantBranch` interface** with `id`, `name`, `city`, `chain_id`, `chain_name` fields — aligns with `OrganizationsService` response shape from Plan 26-03
- **Added `RegisterRestaurantData` and `JoinViaInviteData` interfaces** for the new methods consumed by Plan 26-05 Register.tsx
- **Changed `availableRestaurants` from `string[]` to `RestaurantBranch[]`** — breaking type change coordinated with Header.tsx in same wave
- **Replaced hardcoded `[user.restaurantId]` array** with `fetchBranches()` async function calling `GET /api/v1/organizations/branches` after login; saves to localStorage as JSON
- **Fallback pattern**: if API fails or returns empty, creates single `RestaurantBranch` from `user.restaurantId` with `name: 'My Restaurant'` — preserves backward compatibility for pre-org users
- **Restores previously active branch**: checks `localStorage.getItem('activeRestaurantId')` against fetched branches before defaulting to first branch
- **Added `registerRestaurant()`** calling `POST /api/v1/auth/register/restaurant` with auto-timezone via `Intl.DateTimeFormat()` (D-08)
- **Added `joinViaInvite()`** calling `POST /api/v1/auth/join`
- Both new methods exposed on `AuthContextType` and the `value` object

### Task 2 — Header.tsx

- **Visibility condition**: `{activeRestaurantId && ...}` → `{availableRestaurants.length > 1 && ...}` — switcher hidden when user has only one location (D-06)
- **Active branch button**: replaced raw `activeRestaurantId` text with `branch.name` + `branch.city` (city hidden on small screens via `hidden lg:block`)
- **Optimistic loading**: `isSwitching` state shows spinner in button during 300ms switch delay
- **`branchGroups` useMemo**: splits branches into `{ chains: [...], standalone: [...] }` — chains grouped by `chain_id`/`chain_name`, standalone restaurants listed separately
- **`BranchButton` component**: renders branch row with name + city (MapPin icon), wine-50 background for active, dot indicator
- **Chain-grouped dropdown**: chain name rendered as `uppercase tracking-wide` section header; "Other Locations" separator shown only when both chains and standalone exist (D-10)
- **`handleSwitch`** function: calls `setActiveRestaurantId`, closes menu, waits 300ms, clears loading state
- **"Manage Locations →" footer link** navigating to `/settings`
- **`MapPin` icon** imported from `lucide-react`, `useMemo` added to React import, `RestaurantBranch` imported from AuthContext

## Deviations from Plan

None — plan executed exactly as written. Both files updated atomically in the same plan as required by RESEARCH.md Pitfall 2.

## Verification Results

```
grep "export interface RestaurantBranch" AuthContext.tsx         → ✅ found
grep "availableRestaurants: RestaurantBranch\[\]" AuthContext.tsx → ✅ found (in AuthContextType)
grep "useState<RestaurantBranch\[\]>" AuthContext.tsx            → ✅ found (state declaration)
grep "organizations/branches" AuthContext.tsx                    → ✅ found (API call)
grep "registerRestaurant|joinViaInvite" AuthContext.tsx | wc -l  → ✅ 6 matches
grep "timezone.*Intl.DateTimeFormat" AuthContext.tsx             → ✅ found (D-08 auto-timezone)
grep "availableRestaurants.*string\[\]" AuthContext.tsx | wc -l  → ✅ 0 (old type gone)

grep "availableRestaurants.length > 1" Header.tsx               → ✅ found (switcher condition)
grep "branch.name" Header.tsx                                   → ✅ found
grep "branch.city" Header.tsx                                   → ✅ found
grep "chain_name|branchGroups|chainName" Header.tsx             → ✅ found (chain grouping)
grep "isSwitching" Header.tsx                                   → ✅ found (loading state)
grep "MapPin" Header.tsx                                        → ✅ found
grep "restaurantId}" Header.tsx | wc -l                        → ✅ 0 (old raw ID display removed)
grep "Manage Locations" Header.tsx                              → ✅ found

pnpm build error TS count                                       → ✅ 0 TypeScript errors
```

## Known Stubs

None. `availableRestaurants` is populated from a real API call (`GET /api/v1/organizations/branches`) after login. The fallback to `user.restaurantId` is intentional for pre-org users, not a display stub.

## Threat Flags

No new security-relevant surface introduced. Changes are:
- `availableRestaurants` in localStorage: contains only restaurant names, cities, IDs — no secrets (T-26-04-01: accepted)
- `X-Restaurant-Id` header set client-side: backend validates restaurant_id from JWT/DB; wrong ID returns empty data, not cross-tenant data (T-26-04-02: accepted)

## Self-Check: PASSED

- [x] `apps/web/src/contexts/AuthContext.tsx` — modified (committed c2c92da)
- [x] `apps/web/src/components/layout/Header.tsx` — modified (committed c68c6ec)
- [x] Both commits exist in git log (`git log --oneline -4`)
- [x] TypeScript build: 0 errors
- [x] STATE.md NOT modified (as instructed by orchestrator)
- [x] ROADMAP.md NOT modified (as instructed by orchestrator)
