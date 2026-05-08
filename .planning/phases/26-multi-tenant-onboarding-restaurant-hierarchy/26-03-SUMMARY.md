---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: "03"
subsystem: api-gateway/organizations
tags: [nestjs, organizations, multi-tenant, branch-switcher, rest-api]
dependency_graph:
  requires: [26-01]
  provides: [organizations-module, branches-endpoint, chains-endpoint]
  affects: [app-module, header-branch-switcher]
tech_stack:
  added: []
  patterns: [nestjs-module-pattern, supabase-relational-query, jwt-class-guard]
key_files:
  created:
    - apps/api-gateway/src/organizations/organizations.service.ts
    - apps/api-gateway/src/organizations/organizations.controller.ts
    - apps/api-gateway/src/organizations/organizations.module.ts
  modified:
    - apps/api-gateway/src/app.module.ts
decisions:
  - "Used DatabaseService.supabase (not .client) — both aliases exist per database.service.ts but .supabase is the canonical property"
  - "Fallback path added for users without org membership to return direct restaurant_id restaurant"
  - "Class-level @UseGuards(JwtAuthGuard) protects all 4 endpoints without per-route decoration"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 26 Plan 03: OrganizationsModule — Branches & Chains API Summary

OrganizationsModule with 4 JWT-guarded endpoints wired into AppModule, powering the frontend branch switcher via LEFT JOIN on restaurant_chains.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Create OrganizationsService + Controller + Module | `3014432` | organizations.service.ts, organizations.controller.ts, organizations.module.ts |
| 2 | Register OrganizationsModule in AppModule + build verify | `eac92c4` | app.module.ts |

## What Was Built

### OrganizationsService (`organizations.service.ts`)
- `getBranchesForUser(userId)` — fetches all restaurants for user's org memberships; LEFT JOINs `restaurant_chains` to populate `chain_id` and `chain_name`; fallback for pre-org users via `users.restaurant_id`
- `getChainsForUser(userId)` — returns chains scoped to user's orgs, ordered by name
- `createChain(userId, dto)` — inserts into `restaurant_chains`, scoped to user's owned org (falls back to first membership)
- `createLocation(userId, dto)` — inserts into `restaurants` with optional `chain_id` and inferred `organization_id`

### OrganizationsController (`organizations.controller.ts`)
- `GET /api/v1/organizations/branches` → `RestaurantBranch[]`
- `GET /api/v1/organizations/chains` → `RestaurantChain[]`
- `POST /api/v1/organizations/chains` → `RestaurantChain`
- `POST /api/v1/organizations/locations` → `{ id, name }`
- Class-level `@UseGuards(JwtAuthGuard)` protects all 4 endpoints

### OrganizationsModule (`organizations.module.ts`)
- Follows SettingsModule pattern: imports `[DatabaseModule, AuthModule]`
- Exports `OrganizationsService` for potential injection by other modules

### AppModule (`app.module.ts`)
- Added `OrganizationsModule` import and entry in `imports[]` array after `SettingsModule`
- Build: 155 files compiled successfully with SWC (0 errors)

## Interfaces Exported

```typescript
export interface RestaurantBranch {
  id: string;
  name: string;
  city: string | null;
  chain_id: string | null;   // null = standalone restaurant
  chain_name: string | null; // null = standalone; set = chain label for grouping
}

export interface RestaurantChain {
  id: string;
  name: string;
  cuisine_type: string | null;
}
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all service methods execute real Supabase queries against live tables created in plan 26-01.

## Threat Flags

No new threat surface introduced beyond what was modelled in the plan's STRIDE register. All endpoints require JWT authentication (T-26-03-01 mitigated via `getUserOrgIds` filtering).

## Self-Check: PASSED

- `apps/api-gateway/src/organizations/organizations.service.ts` — FOUND
- `apps/api-gateway/src/organizations/organizations.controller.ts` — FOUND
- `apps/api-gateway/src/organizations/organizations.module.ts` — FOUND
- `apps/api-gateway/src/app.module.ts` — FOUND (contains OrganizationsModule import + array entry)
- Commit `3014432` — FOUND
- Commit `eac92c4` — FOUND
- TypeScript build: 0 errors
