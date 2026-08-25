---
phase: 28-onboarding-reform-menu-import
plan: "02"
subsystem: api-gateway
tags: [menus, onboarding, wine-library, inventory, nestjs]
dependency_graph:
  requires: [28-01]
  provides: [POST /api/v1/menus/import, GET /api/v1/onboarding/progress, PATCH /api/v1/onboarding/progress]
  affects: [master_wine_library_submissions, inventory, menu_items, user_onboarding_progress]
tech_stack:
  added: []
  patterns:
    - NestJS module with dual controllers (MenusController + OnboardingController)
    - Axios direct call to Anthropic Messages API (no SDK — @anthropic-ai/sdk absent from package.json)
    - Fire-and-forget async side effects (wine library + inventory) with non-fatal catch
key_files:
  created:
    - apps/api-gateway/src/menus/wine-extract-item.interface.ts
    - apps/api-gateway/src/menus/dto/import-menu.dto.ts
    - apps/api-gateway/src/menus/dto/update-onboarding-progress.dto.ts
    - apps/api-gateway/src/menus/parsers/csv-parser.service.ts
    - apps/api-gateway/src/menus/parsers/scan-parser.service.ts
    - apps/api-gateway/src/menus/menus.service.ts
    - apps/api-gateway/src/menus/menus.controller.ts
    - apps/api-gateway/src/menus/menus.module.ts
  modified:
    - apps/api-gateway/src/app.module.ts
decisions:
  - "Used axios + Anthropic REST API directly (not @anthropic-ai/sdk) — SDK not in package.json"
  - "Dual controller pattern: MenusController (@Controller menus) + OnboardingController (@Controller onboarding) in same file, both registered in MenusModule"
  - "ScanParserService detects image media type from base64 header bytes (JPEG /9j/, PNG iVBORw, WebP UklGR)"
  - "Manual items beyond 25 get status=flagged with review_notes='Free tier: exceeds 25 item limit' per plan spec"
  - "submitToWineLibrary and addToInventory are fire-and-forget; failures logged as WARN, never block the response"
metrics:
  duration: "~18 minutes"
  completed_date: "2026-05-11"
  tasks_completed: 6
  files_created: 8
  files_modified: 1
---

# Phase 28 Plan 02: Backend — Menu Import API + master_wine_library Bridge Summary

**One-liner:** NestJS MenusModule with unified 3-method import pipeline (scan→Anthropic LLM, CSV→header-mapped parser, manual→direct) feeding menu_items, master_wine_library_submissions, and inventory tables.

---

## What Was Built

### Task 1: WineExtractItem Type
`wine-extract-item.interface.ts` — shared interface used by parsers, service, and DTO:
`name, category, vintage, region, grape_variety, by_glass_price, bottle_price, raw_text`

### Task 2: ScanParserService
Calls Anthropic `claude-3-5-haiku-20241022` via direct axios POST to `https://api.anthropic.com/v1/messages`. Sends base64 image as a vision message with structured wine extraction prompt. Parses LLM JSON array response. Throws `ServiceUnavailableException` on failure (per plan spec — no silent empty array).

**Deviation note:** `@anthropic-ai/sdk` is not in `package.json`. Used axios + raw Anthropic REST API instead. Requires `ANTHROPIC_API_KEY` env var.

### Task 3: CsvParserService
Manual CSV parser — no external library. Detects headers case-insensitively via alias map (`wine_name`→`name`, `appellation`→`region`, `glass_price`→`by_glass_price`, etc.). Handles double-quoted fields containing commas. Extracts numeric prices, skips rows without a name column.

### Task 4: MenusService.importMenu()
Orchestrates all three paths:
1. Parses input → `WineExtractItem[]`
2. `upsertMenu()`: finds existing active `restaurant_menus` row or creates one (`name='Wine List', type='beverage'`)
3. Bulk inserts to `menu_items` with `source=method`, `status='approved'`; manual items > 25 get `status='flagged'`
4. Fire-and-forget: `submitToWineLibrary()` → `master_wine_library_submissions` with `source_type='menu_scan'`
5. Fire-and-forget: `addToInventory()` → `inventory` with `source='menu_import', quantity=0`
6. `markMenuUploaded()` → updates `user_onboarding_progress.menu_uploaded=true`
Returns `{ menuId, itemsExtracted, submissionsCreated }`.

### Task 5: Onboarding Progress Endpoints
Added to `OnboardingController` (same file, `@Controller('onboarding')`):
- `GET /api/v1/onboarding/progress` → selects `user_onboarding_progress` by `user_id`
- `PATCH /api/v1/onboarding/progress` → updates boolean fields; auto-sets `completed_at` when all 3 done

### Task 6: MenusModule Registration
`MenusModule` added to `AppModule` imports array. Module registers `MenusController` + `OnboardingController` and provides `MenusService`, `CsvParserService`, `ScanParserService`.

---

## Deviations from Plan

### Auto-fixed: Anthropic SDK Pattern

**Rule 1 (deviation) — Missing SDK, used HTTP fallback:**
- **Found during:** Task 2 (ScanParserService)
- **Issue:** `@anthropic-ai/sdk` is NOT in `apps/api-gateway/package.json`
- **Fix:** Used axios to call Anthropic's REST API directly (`POST https://api.anthropic.com/v1/messages`) with proper `x-api-key` and `anthropic-version` headers. Functionally equivalent; requires `ANTHROPIC_API_KEY` env var.
- **Files modified:** `scan-parser.service.ts`

### Dual-Controller Pattern

**Rule 2 (missing critical functionality) — Route prefix separation:**
- **Found during:** Task 5 planning
- **Issue:** A single `@Controller('menus')` would produce `/api/v1/menus/onboarding/progress`, not `/api/v1/onboarding/progress` as required by must_haves
- **Fix:** Added `OnboardingController` class with `@Controller('onboarding')` in the same `menus.controller.ts` file. Both registered in `MenusModule`. The PLAN.md artifact says `menus.controller.ts` provides all 3 endpoints — this satisfies that while hitting the correct routes.

---

## Known Stubs

None — all three import paths are wired to real parser implementations and DB inserts.

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: input_validation | `dto/import-menu.dto.ts` | `data.imageBase64` is not validated for size — a very large base64 payload could cause OOM or excessive Anthropic API cost. Rate limiting (global RateLimitGuard) partially mitigates. |

---

## Self-Check

### Created files exist:
- [x] `apps/api-gateway/src/menus/wine-extract-item.interface.ts`
- [x] `apps/api-gateway/src/menus/dto/import-menu.dto.ts`
- [x] `apps/api-gateway/src/menus/dto/update-onboarding-progress.dto.ts`
- [x] `apps/api-gateway/src/menus/parsers/csv-parser.service.ts`
- [x] `apps/api-gateway/src/menus/parsers/scan-parser.service.ts`
- [x] `apps/api-gateway/src/menus/menus.service.ts`
- [x] `apps/api-gateway/src/menus/menus.controller.ts`
- [x] `apps/api-gateway/src/menus/menus.module.ts`

### Commits exist:
- [x] `ba67120` feat(28-02): add WineExtractItem types + CSV/scan parsers
- [x] `0142557` feat(28-02): implement MenusService with all 3 import methods + progress endpoints
- [x] `33f8cfa` feat(28-02): register MenusModule in AppModule

### TypeScript compile: PASSED (`tsc --noEmit` exit code 0)
### Linter: PASSED (no errors in menus/ or app.module.ts)

## Self-Check: PASSED
