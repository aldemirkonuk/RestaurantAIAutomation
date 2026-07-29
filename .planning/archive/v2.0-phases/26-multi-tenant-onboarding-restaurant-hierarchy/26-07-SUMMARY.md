---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: 26-07
title: Backend — PATCH locations/:id + createChain auto-assign
subsystem: api-gateway/organizations
tags: [nestjs, organizations, chains, locations, patch-endpoint, auth-boundary]
completed: "2026-05-10"
duration: "~20 min"

dependency_graph:
  requires: [26-05, 26-06]
  provides: [PATCH /api/v1/organizations/locations/:id, createChain restaurantId param]
  affects: [organizations.controller.ts, organizations.service.ts]

tech_stack:
  added: []
  patterns:
    - Private helper getUserOrgIdsWithFallback (DRY org-boundary enforcement)
    - 404 for cross-org access (not 403 — prevents existence leakage)
    - Fire-and-continue pattern for optional restaurant auto-assign in createChain

key_files:
  created:
    - apps/api-gateway/src/organizations/dto/update-location.dto.ts
  modified:
    - apps/api-gateway/src/organizations/organizations.service.ts
    - apps/api-gateway/src/organizations/organizations.controller.ts

decisions:
  - 404 (not 403) returned when restaurant or chain from different org — prevents existence leakage
  - createChain assignment failure is logged but not rethrown — chain creation itself succeeded
  - getUserOrgIdsWithFallback is the single private helper used by ALL service methods (DRY)
  - chain_id=null explicitly supported in UpdateLocationDto to make location standalone

metrics:
  task_count: 5
  completed_tasks: 5
  files_created: 1
  files_modified: 2
---

# Phase 26 Plan 07: Backend — PATCH locations/:id + createChain auto-assign Summary

**One-liner:** PATCH endpoint for chain assignment with org-boundary validation, plus atomic createChain+assign via optional restaurantId, backed by a single DRY fallback helper.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| T1 | UpdateLocationDto (chainId?: string \| null) | 3f9884f |
| T2 | getUserOrgIdsWithFallback private helper + updateLocationChain service method | 2e937ce |
| T3 | Extend createChain to accept optional restaurantId with fire-and-continue assignment | 74cd58f |
| T4 | PATCH locations/:id controller endpoint with Param + Body decorators | bb18397 |
| T5 | Extend POST chains body to pass restaurantId through to service | 939f250 |

## Acceptance Criteria Verification

- [x] `PATCH /api/v1/organizations/locations/:id` with `{ chainId: "<uuid>" }` updates `restaurants.chain_id`
- [x] `PATCH` with `{ chainId: null }` sets `chain_id = NULL` (standalone) — UpdateLocationDto allows null, passed as `body.chainId ?? null`
- [x] `PATCH` with chain_id from different org returns 404 — `updateLocationChain` uses `.in('organization_id', orgIds)` + `NotFoundException`
- [x] `PATCH` with restaurant_id from different org returns 404 — same `.in('organization_id', orgIds)` check on restaurants table
- [x] `POST /api/v1/organizations/chains` with `{ name: "...", restaurantId: "<uuid>" }` creates chain AND updates restaurant
- [x] If restaurant update fails in createChain, chain is still returned — try/catch logs and does not rethrow
- [x] `getUserOrgIdsWithFallback` is a single private helper used by all service methods

## Deviations from Plan

**[Rule 2 - DRY refactor] Unified all service methods to use getUserOrgIdsWithFallback**
- Found during: T2
- Issue: `getBranchesForUser` and `createLocation` had duplicated inline fallback logic. `createChain` and `getChainsForUser` used the bare `getUserOrgIds` (no fallback at all).
- Fix: All four public service methods now call `getUserOrgIdsWithFallback`. The inline fallback blocks in `getBranchesForUser` and `createLocation` were removed.
- Files modified: organizations.service.ts
- Commit: 2e937ce

## Known Stubs

None.

## Threat Flags

None — PATCH endpoint validates org membership before any DB write. No new auth paths or trust boundary changes beyond what the existing JWT guard already enforces.

## Self-Check: PASSED

- [x] `apps/api-gateway/src/organizations/dto/update-location.dto.ts` exists
- [x] `updateLocationChain` method present in organizations.service.ts
- [x] `getUserOrgIdsWithFallback` private helper present (single instance, no duplication)
- [x] `PATCH('locations/:id')` handler present in organizations.controller.ts
- [x] `createChain` dto includes `restaurantId?` in both service and controller
- [x] TypeScript compiles without errors (`tsc --noEmit` — clean output)
- [x] Commits 3f9884f, 2e937ce, 74cd58f, bb18397, 939f250 present in git log
