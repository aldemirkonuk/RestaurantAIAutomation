---
phase: 27-vendor-search-discovery
plan: "02"
subsystem: api-gateway
tags: [vendor-catalogue, providers, order-guard, nestjs, supabase]
dependency_graph:
  requires: [27-01]
  provides:
    - GET /api/v1/vendor-catalogue/search (paginated ILIKE search)
    - GET /api/v1/vendor-catalogue/:id (detail)
    - POST /api/v1/providers dual-mode (catalogue or custom)
    - POST /api/v1/procurement/orders no-vendor guard (403 reason=no_vendors)
  affects: [providers table, procurement_orders creation path]
tech_stack:
  added: []
  patterns: [NestJS module, DTO dual-mode validation, ForbiddenException guard, service_role Supabase client]
key_files:
  created:
    - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.module.ts
    - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.service.ts
    - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.controller.ts
    - apps/api-gateway/src/vendor-catalogue/dto/search-vendors.dto.ts
  modified:
    - apps/api-gateway/src/providers/dto/providers.dto.ts
    - apps/api-gateway/src/providers/providers.service.ts
    - apps/api-gateway/src/procurement/procurement.service.ts
    - apps/api-gateway/src/procurement/procurement.controller.ts
    - apps/api-gateway/src/app.module.ts
decisions:
  - website/type fields from vendor_catalogue stored in ai_personality_notes (no separate DB columns on providers)
  - catalogue-to-provider field mapping: phone→contact_phone, email→contact_email, name→name, notes built from type+website+wine_specialties
  - order guard fires only when providerCount===0 and no DB error (fail-open on count query failure)
  - ForbiddenException re-thrown as-is from controller (preserves 403 status code)
metrics:
  duration: "12 minutes"
  completed: "2026-05-10"
  tasks_completed: 6
  tasks_total: 6
  files_created: 4
  files_modified: 5
---

# Phase 27 Plan 02: Backend — Vendor Catalogue API + Providers CRUD + Order Guard Summary

## One-liner

NestJS VendorCatalogueModule with ILIKE search/detail endpoints, ProvidersService dual-mode create (catalogue auto-fill or custom), and ForbiddenException order guard (reason: no_vendors) when zero active providers exist.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1-3 | VendorCatalogueModule scaffold + search + detail | 0a58653 | vendor-catalogue.module.ts, vendor-catalogue.service.ts, vendor-catalogue.controller.ts, dto/search-vendors.dto.ts |
| 4 | Update ProvidersService.createProvider() dual-mode | 4bfabac | providers/dto/providers.dto.ts, providers/providers.service.ts |
| 5 | Order creation guard (no_vendors 403) | 92285bc | procurement/procurement.service.ts, procurement/procurement.controller.ts |
| 6 | Register VendorCatalogueModule in AppModule | fcfcc5c | app.module.ts |

## What Was Built

### Tasks 1-3 — VendorCatalogueModule (VENDOR-04)

Four files created under `apps/api-gateway/src/vendor-catalogue/`:

**`vendor-catalogue.module.ts`** — imports `DatabaseModule` + `AuthModule`, registers controller and service, exports `VendorCatalogueService`.

**`vendor-catalogue.service.ts`** — two methods:
- `search(dto)`: queries `vendor_catalogue` with ILIKE on `name`, filters `country` (default `US`), optional `type` filter, `is_active=true`, ordered by name, paginated via `.range()`. Returns `{ data, total, limit, offset }`.
- `findById(id)`: single row fetch with `NotFoundException` on miss.

**`vendor-catalogue.controller.ts`** — JWT-protected (`@UseGuards(JwtAuthGuard)`), two endpoints:
- `GET /vendor-catalogue/search` — query params from `SearchVendorsDto`
- `GET /vendor-catalogue/:id` — full row detail

**`dto/search-vendors.dto.ts`** — `q` (optional), `country` (optional, default US), `type` (optional), `limit` (1-50, default 20), `offset` (≥0, default 0) with class-validator decorators and `@Type(() => Number)` transformer.

### Task 4 — ProvidersService dual-mode create (VENDOR-05)

**`CreateProviderDto`** extended with:
- `catalogue_vendor_id?: string` (UUID, optional) — triggers Mode A
- `name?: string` — now optional (required only in Mode B)
- `type?`, `phone?`, `email?`, `website?`, `contactName?` — for custom vendor creation

**Mode A (catalogue-based):**
1. Fetches vendor from `vendor_catalogue` by `catalogue_vendor_id`
2. Maps `phone → contact_phone`, `email → contact_email`, `name → name`, `address → address`
3. Builds `ai_personality_notes` from `type | website | wine_specialties`
4. Sets `is_custom=false`, `catalogue_vendor_id=<id>`

**Mode B (custom):**
1. Validates `name` is present (throws `BadRequestException` if missing)
2. Uses all user-supplied fields
3. Sets `is_custom=true`, `catalogue_vendor_id=null`

**`ProviderResponseDto`** extended with `catalogueVendorId` and `isCustom` fields.
**`mapProviderRow`** now reads `catalogue_vendor_id` and `is_custom` from DB row.

### Task 5 — Order creation guard (VENDOR-06)

**`ProcurementService.createOrder()`** — at entry point, counts active providers:
```typescript
const { count: providerCount } = await this.databaseService.supabase
  .from('providers')
  .select('*', { count: 'exact', head: true })
  .eq('restaurant_id', restaurantId)
  .eq('is_active', true);

if (!countError && providerCount === 0) {
  throw new ForbiddenException({ reason: 'no_vendors', message: '...', redirect: '/providers' });
}
```
Guard is fail-open: if the count query errors, order creation proceeds normally.

**`ProcurementController.createOrder()`** — re-throws `ForbiddenException` directly to preserve 403 status; all other errors map to 500 as before.

### Task 6 — AppModule registration

`VendorCatalogueModule` imported and added to `imports` array in `app.module.ts`.

## Deviations from Plan

### Auto-adjusted — website/type stored in ai_personality_notes

**Found during:** Task 4

**Issue:** The plan's `CreateProviderDto` included `website` and `type` fields to copy from catalogue to providers row, but the `providers` table has no `website` or `type` column. Only `ai_personality_notes TEXT` is available for freeform text.

**Fix:** When creating a provider from the catalogue (Mode A), `type`, `website`, and `wine_specialties` from `vendor_catalogue` are packed into `ai_personality_notes` as a pipe-separated string: `"Type: distributor | Website: https://... | Specialties: Burgundy, ..."`. This preserves the data without a schema migration. A future plan can add flat columns if needed.

**Files modified:** apps/api-gateway/src/providers/providers.service.ts

## Verification Checklist

- [x] `GET /api/v1/vendor-catalogue/search?q=southern` — controller exists, ILIKE query on name
- [x] `GET /api/v1/vendor-catalogue/search?q=wine&country=US` — country filter applied, is_active=true guard
- [x] `GET /api/v1/vendor-catalogue/:id` — findById with NotFoundException on miss
- [x] `POST /api/v1/providers` with `catalogue_vendor_id` — Mode A copies name/phone/email, is_custom=false
- [x] `POST /api/v1/providers` without `catalogue_vendor_id` — Mode B requires name, is_custom=true
- [x] `POST /api/v1/procurement/orders` with zero active providers — ForbiddenException, reason: no_vendors, HTTP 403
- [x] All endpoints require valid JWT (`@UseGuards(JwtAuthGuard)`)
- [x] `VendorCatalogueModule` registered in `AppModule`
- [x] TypeScript compiles clean (`tsc --noEmit` exits 0)

**Pending (requires live API):**
- [ ] `GET /api/v1/vendor-catalogue/search?q=southern` returns Southern Glazers row
- [ ] `GET /api/v1/vendor-catalogue/search?q=wine&country=US` returns ≥5 results
- [ ] `POST /api/v1/providers` with valid catalogue_vendor_id creates row with pre-filled contact_phone/contact_email
- [ ] `POST /api/v1/procurement/orders` returns 403 `{ reason: 'no_vendors' }` when providers empty

## Known Stubs

None — all endpoints are fully wired to the database. No placeholder data or TODO-blocked paths.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: info_disclosure | vendor-catalogue.controller.ts | `GET /vendor-catalogue/:id` returns full vendor row including phone/email/address from a global catalogue — all authenticated users can read all vendors regardless of restaurant. This is by design (D-01: admin-curated, read-all). No sensitive PII beyond business contact info. |

## Self-Check: PASSED

- apps/api-gateway/src/vendor-catalogue/vendor-catalogue.module.ts: FOUND
- apps/api-gateway/src/vendor-catalogue/vendor-catalogue.service.ts: FOUND
- apps/api-gateway/src/vendor-catalogue/vendor-catalogue.controller.ts: FOUND
- apps/api-gateway/src/vendor-catalogue/dto/search-vendors.dto.ts: FOUND
- apps/api-gateway/src/providers/dto/providers.dto.ts: FOUND (modified)
- apps/api-gateway/src/providers/providers.service.ts: FOUND (modified)
- apps/api-gateway/src/procurement/procurement.service.ts: FOUND (modified)
- apps/api-gateway/src/procurement/procurement.controller.ts: FOUND (modified)
- apps/api-gateway/src/app.module.ts: FOUND (modified)
- Commit 0a58653: FOUND (feat(27-02): scaffold VendorCatalogueModule with search and detail endpoints)
- Commit 4bfabac: FOUND (feat(27-02): update ProvidersService.createProvider() with catalogue/custom dual-mode)
- Commit 92285bc: FOUND (feat(27-02): add no-vendors order creation guard returning 403)
- Commit fcfcc5c: FOUND (feat(27-02): register VendorCatalogueModule in AppModule)
