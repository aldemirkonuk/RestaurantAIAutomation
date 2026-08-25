---
phase: 27-vendor-search-discovery
verified: 2026-05-10T00:00:00Z
status: human_needed
score: 36/36 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Providers page empty state renders and Browse Catalogue CTA opens VendorSearchModal"
    expected: "Navigate to /providers with a restaurant that has zero providers — empty state shows BookOpen+Truck icon, headline 'No vendors yet', two CTAs (Browse Vendor Catalogue, Add Custom Vendor). Clicking Browse opens the VendorSearchModal with US vendors auto-searched on first load."
    why_human: "CSS/component rendering and interactive UX cannot be verified programmatically. Auto-load only fires once at component mount, not on every re-open."
  - test: "VendorSearchModal search, add, and close flow"
    expected: "Typing 'southern' in the modal within 300-500ms shows Southern Glazer's in results. Clicking 'Add to My Providers' shows a loading spinner, displays a sonner toast 'Added Southern Glazer's Wine & Spirits to your providers', closes the modal, and the new provider appears in the Providers list."
    why_human: "Full interactive flow with live backend search requires a running app."
  - test: "Add Location dialog triggers BranchProviderTransferModal with pre-checked providers"
    expected: "In Settings > Locations, add a new location when the current restaurant has >=1 provider. After location is created and toast shows, BranchProviderTransferModal appears with the new branch name in the title, all existing providers listed with checkboxes checked. Clicking 'Skip for now' closes without API calls."
    why_human: "Multi-step modal sequence triggered by location creation requires interactive testing."
  - test: "Order creation with zero providers shows OrderGuardModal"
    expected: "With zero providers configured, open Orders page and attempt to create an order (click 'Contact Providers' step). OrderGuardModal appears with 'Add a vendor to place orders' title, 'Go to Providers' button navigates to /providers and closes modal, 'Back to Order' dismisses modal."
    why_human: "Interactive order creation flow requires a running app."
  - test: "Backend 403 no_vendors response triggers OrderGuardModal as safety net"
    expected: "If the pre-flight check is somehow bypassed (or tested directly), a 403 response with reason='no_vendors' from POST /procurement/orders should surface OrderGuardModal (not an error toast)."
    why_human: "Edge-case backend error handling requires either direct API call or mocking."
---

# Phase 27: Vendor Search & Discovery Verification Report

**Phase Goal:** Solve the empty Providers page problem — give new users a way to discover and add wine vendors without leaving the app, guard order creation against zero-provider state, and auto-offer vendor transfer when a new branch location is added.
**Verified:** 2026-05-10T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | vendor_catalogue table exists with all 15 columns | VERIFIED | `20260509000001_vendor_catalogue.sql` line 5-21: CREATE TABLE IF NOT EXISTS with all 15 columns as specified |
| 2 | vendor_catalogue has no RLS restriction on SELECT for authenticated users | VERIFIED | RLS policy `vendor_catalogue_read` allows SELECT for `authenticated` where `is_active=TRUE`; no INSERT/UPDATE/DELETE policies defined |
| 3 | vendor_catalogue has RLS preventing INSERT/UPDATE/DELETE for non-admin users | VERIFIED | No INSERT/UPDATE/DELETE policies — only service_role bypasses RLS for writes |
| 4 | providers table has catalogue_vendor_id UUID nullable FK to vendor_catalogue ON DELETE SET NULL | VERIFIED | `20260509000002_providers_catalogue_link.sql` line 4: `ADD COLUMN IF NOT EXISTS catalogue_vendor_id UUID REFERENCES vendor_catalogue(id) ON DELETE SET NULL` |
| 5 | providers table has is_custom BOOLEAN NOT NULL DEFAULT TRUE | VERIFIED | `20260509000002_providers_catalogue_link.sql` line 5: `ADD COLUMN IF NOT EXISTS is_custom BOOLEAN NOT NULL DEFAULT TRUE` |
| 6 | vendor_catalogue is seeded with at least 20 US wine distributors | VERIFIED | `27_vendor_catalogue_seed.sql`: exactly 20 rows (PROV_001-PROV_020), all with fixed UUIDs for idempotent ON CONFLICT |
| 7 | All seed entries have is_active=TRUE | VERIFIED | All 20 INSERT rows explicitly set `TRUE` as is_active |
| 8 | GET /api/v1/vendor-catalogue/search returns paginated fuzzy results | VERIFIED | `vendor-catalogue.service.ts` line 36-71: ILIKE on name + wine_specialties, paginated via `.range()`, ordered by name; returns `{data, total, limit, offset}` |
| 9 | Search is case-insensitive and partial-match | VERIFIED | Line 49: `query.or('name.ilike.%${q}%,wine_specialties.ilike.%${q}%')` — ILIKE is case-insensitive |
| 10 | GET /api/v1/vendor-catalogue/:id returns a single vendor's full details | VERIFIED | `vendor-catalogue.service.ts` line 73-87: findById with `.single()`, throws NotFoundException on miss |
| 11 | POST /api/v1/providers accepts catalogue_vendor_id OR name/type/phone/email for custom | VERIFIED | `CreateProviderDto` has `catalogue_vendor_id?: string` (UUID optional); `providers.service.ts` Mode A/B dual-mode at line 49-103 |
| 12 | POST /api/v1/providers with catalogue_vendor_id copies vendor details automatically | VERIFIED | Mode A: fetches from vendor_catalogue, maps phone→contact_phone, email→contact_email, name→name, packs type/website/specialties into ai_personality_notes |
| 13 | POST /api/v1/providers sets is_custom=false when catalogue_vendor_id provided | VERIFIED | `providers.service.ts` line 76: `is_custom: false` in Mode A payload |
| 14 | Order creation guard: 403 with reason='no_vendors' when zero active providers | VERIFIED | `procurement.service.ts` lines 92-108: counts active providers; InternalServerErrorException if count fails (CR-03 fix applied); ForbiddenException with reason='no_vendors' if count===0 |
| 15 | VendorCatalogueModule is registered in AppModule | VERIFIED | `app.module.ts` line 28: import; line 78: `VendorCatalogueModule` in imports array |
| 16 | All endpoints are JWT-protected | VERIFIED | `vendor-catalogue.controller.ts` line 21: `@UseGuards(JwtAuthGuard)` at controller level |
| 17 | Providers page shows empty state with search bar + Browse Catalogue + Add Custom when providers.length===0 | VERIFIED | `Providers.tsx` line 392-396: `{providers.length === 0 && !isLoading && <EmptyProvidersState onBrowseCatalogue={() => setShowVendorSearch(true)} onAddCustom={() => setShowAddProviderModal(true)} />}` |
| 18 | Empty state has marketing copy explaining why vendors are needed | VERIFIED | `EmptyProvidersState` (Providers.tsx lines 52-88): "No vendors yet" + "Add wine distributors and suppliers to enable ordering and track relationships." |
| 19 | VendorSearchModal opens on 'Browse Catalogue' click | VERIFIED | `onBrowseCatalogue={() => setShowVendorSearch(true)}` → `<VendorSearchModal open={showVendorSearch} .../>` at lines 1118-1123 |
| 20 | VendorSearchModal has a search bar that debounces 300ms and calls GET /vendor-catalogue/search | VERIFIED | `VendorSearchModal.tsx` lines 82-98: debounce useEffect with 300ms setTimeout calls `runSearch()` → `searchVendorCatalogue()` → `GET /vendor-catalogue/search` |
| 21 | VendorSearchModal shows list of VendorCatalogueCard components | VERIFIED | Lines 274-280: `results.map((vendor) => <VendorCatalogueCard key={vendor.id} vendor={vendor} onAdd={handleAdd} />)` |
| 22 | Clicking 'Add to My Providers' calls POST /providers with catalogue_vendor_id | VERIFIED | `handleAdd` in VendorSearchModal calls `addProviderFromCatalogue(vendor.id)` → `POST /providers {catalogue_vendor_id}` (vendors.ts line 86) |
| 23 | After successful add, provider appears in list and modal closes | VERIFIED | `handleAdd` calls `onProviderAdded()` (→ `refetch()`) then `onClose()` (→ `setShowVendorSearch(false)`) |
| 24 | VendorSearchModal has 'Add Custom Vendor Instead' link | VERIFIED | Footer button (lines 291-296): "Add Custom Vendor Instead →" calls `handleAddCustom()` which calls `onClose()` + `onAddCustom()` |
| 25 | When providers.length > 0, normal list view with secondary 'Add Vendor' button | VERIFIED | `Providers.tsx` lines 400-423: `{providers.length > 0 && (<> ... <button onClick={() => setShowVendorSearch(true)}>Add Vendor</button> ...>)}` |
| 26 | All network calls go through services/api/vendors.ts | VERIFIED | `vendors.ts` exports `searchVendorCatalogue`, `addProviderFromCatalogue`, `addCustomProvider` — all use `apiClient` from `./client` |
| 27 | After location creation, BranchProviderTransferModal opens automatically | VERIFIED | `AddLocationDialog.tsx` line 102-104: `if (currentProviders.length > 0 && location?.id) { setTransferModal({ open: true, ... }) }` |
| 28 | BranchProviderTransferModal lists all current providers with checkboxes (all pre-checked) | VERIFIED | `BranchProviderTransferModal.tsx` line 33: `setSelectedIds(new Set(currentProviders.map((p) => p.id)))` on open — all pre-checked |
| 29 | Clicking 'Transfer Selected' calls POST /providers for each selected provider | VERIFIED | Lines 61-83: loops `selectedProviders`, calls `apiClient.post('/providers', ...)` with `X-Restaurant-Id` override per provider |
| 30 | Clicking 'Skip' dismisses without transferring | VERIFIED | Line 193-198: Skip button calls `onClose()` without any API calls |
| 31 | BranchProviderTransferModal shows new branch name in title | VERIFIED | Line 122: `<span>Add vendors to {newBranchName}?</span>` |
| 32 | CreateOrderModal checks for empty providers before submission | VERIFIED | `Orders.tsx` lines 787-790: `if (!providers \|\| providers.length === 0) { setShowOrderGuard(true); return }` in `handleContactProviders` |
| 33 | If providers empty, OrderGuardModal opens | VERIFIED | `showOrderGuard` state → `<OrderGuardModal open={showOrderGuard} .../>` at lines 2556-2559 |
| 34 | OrderGuardModal has a direct link to /providers page | VERIFIED | `OrderGuardModal.tsx` line 19-22: `handleGoToProviders` calls `navigate('/providers')` |
| 35 | OrderGuardModal has a 'Back to Order' button | VERIFIED | Lines 74-77: ghost Button with `onClick={onClose}`, text "Back to Order" |
| 36 | The no_vendors 403 response is handled gracefully | VERIFIED | `Orders.tsx` lines 924-931: catch block checks `error?.response?.status === 403 && error?.response?.data?.reason === 'no_vendors'` → setShowOrderGuard(true) |

**Score:** 36/36 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260509000001_vendor_catalogue.sql` | vendor_catalogue table with RLS | VERIFIED | 37 lines; CREATE TABLE, 3 indexes, RLS enable, SELECT policy |
| `supabase/migrations/20260509000002_providers_catalogue_link.sql` | providers FK + is_custom column | VERIFIED | ALTER TABLE with catalogue_vendor_id FK and is_custom; partial index; UPDATE backfill |
| `supabase/migrations/seed/27_vendor_catalogue_seed.sql` | 20+ seeded vendor rows | VERIFIED | 328 lines; 20 INSERT rows with fixed UUIDs; ON CONFLICT (id) DO NOTHING |
| `apps/api-gateway/src/vendor-catalogue/vendor-catalogue.module.ts` | VendorCatalogueModule | VERIFIED | 13 lines; imports DatabaseModule + AuthModule; registers controller and service |
| `apps/api-gateway/src/vendor-catalogue/vendor-catalogue.controller.ts` | GET search + GET :id | VERIFIED | @Get('search') and @Get(':id'); @UseGuards(JwtAuthGuard) at controller level |
| `apps/api-gateway/src/vendor-catalogue/vendor-catalogue.service.ts` | search() + findById() | VERIFIED | 89 lines; both methods fully implemented with Supabase queries |
| `apps/api-gateway/src/vendor-catalogue/dto/search-vendors.dto.ts` | SearchVendorsDto | VERIFIED | All 5 params (q, country, type, limit, offset) with class-validator decorators |
| `apps/api-gateway/src/providers/providers.service.ts` | Dual-mode createProvider | VERIFIED | Mode A (catalogue auto-fill) and Mode B (custom) fully implemented |
| `apps/api-gateway/src/providers/dto/providers.dto.ts` | catalogue_vendor_id in CreateProviderDto | VERIFIED | `catalogue_vendor_id?: string` with @IsUUID @IsOptional |
| `apps/api-gateway/src/procurement/procurement.service.ts` | Order creation guard | VERIFIED | providerCount check at entry of createOrder(); InternalServerErrorException on countError; ForbiddenException on zero count |
| `apps/api-gateway/src/app.module.ts` | VendorCatalogueModule in AppModule | VERIFIED | Line 28 import + line 78 in imports array |
| `apps/web/src/services/api/vendors.ts` | searchVendorCatalogue, addProviderFromCatalogue, addCustomProvider | VERIFIED | 106 lines; all 3 functions plus getVendorCatalogueEntry; all use apiClient |
| `apps/web/src/components/providers/VendorCatalogueCard.tsx` | VendorCatalogueCard component | VERIFIED | 179 lines; name + type badge (5 color variants) + location + wine_specialties + phone/website icons + Add button with loading state |
| `apps/web/src/components/providers/VendorSearchModal.tsx` | Full vendor search modal | VERIFIED | 305 lines; Radix Dialog, 300ms debounce, AnimatePresence (skeleton/idle/empty/results states), try/catch on add |
| `apps/web/src/pages/Providers.tsx` | Empty state + modal wiring | VERIFIED | EmptyProvidersState at lines 392-396; VendorSearchModal at lines 1118-1123; showVendorSearch state |
| `apps/web/src/components/providers/BranchProviderTransferModal.tsx` | Branch transfer modal | VERIFIED | 221 lines; all providers pre-checked; per-provider progress; dual-mode transfer (catalogue vs custom); Skip button |
| `apps/web/src/components/orders/OrderGuardModal.tsx` | Order guard modal | VERIFIED | 85 lines; ShoppingBag icon + title + description + Go to Providers (navigate) + Back to Order |
| `apps/web/src/components/locations/AddLocationDialog.tsx` | AddLocationDialog wired to transfer modal | VERIFIED | Imports BranchProviderTransferModal; useProviders hook; TransferModalState; post-location-creation trigger |
| `apps/web/src/pages/Orders.tsx` | Order guard wiring | VERIFIED | showOrderGuard state; pre-flight at handleContactProviders; 403 safety net in catch; OrderGuardModal rendered |
| `apps/web/src/services/api/providers.ts` | Provider type extended + bulkCreate | VERIFIED | catalogueVendorId, isCustom fields added to Provider interface; bulkCreateProvidersForBranch exported |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| providers | vendor_catalogue | catalogue_vendor_id FK (nullable, ON DELETE SET NULL) | WIRED | Migration 20260509000002 confirms FK definition |
| VendorCatalogueController | vendor_catalogue table | VendorCatalogueService (DatabaseService.supabase) | WIRED | service.ts uses `this.databaseService.supabase.from('vendor_catalogue')` |
| ProvidersController | vendor_catalogue + providers tables | ProvidersService createProvider() Mode A | WIRED | Fetches from vendor_catalogue, inserts into providers with is_custom=false |
| Providers.tsx | VendorSearchModal | showVendorSearch state prop | WIRED | `open={showVendorSearch}` + EmptyProvidersState.onBrowseCatalogue triggers setShowVendorSearch(true) |
| VendorSearchModal | VendorCatalogueCard | results.map() | WIRED | Line 275: `results.map((vendor) => <VendorCatalogueCard ... />)` |
| VendorSearchModal | services/api/vendors.ts | searchVendorCatalogue(), addProviderFromCatalogue() | WIRED | Imports at lines 8-11; called in runSearch() and handleAdd() |
| AddLocationDialog | BranchProviderTransferModal | onLocationCreated → setTransferModal.open=true | WIRED | Lines 102-104: provider-count check triggers setTransferModal |
| CreateOrderModal (Orders.tsx) | OrderGuardModal | 403 no_vendors response + pre-flight provider count | WIRED | handleContactProviders() pre-flight + 403 catch block |
| VendorCatalogueModule | AppModule | imports array | WIRED | app.module.ts line 78 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| VendorSearchModal | results: VendorCatalogueEntry[] | searchVendorCatalogue() → GET /vendor-catalogue/search → vendor_catalogue Supabase table | Yes — ILIKE query with is_active=TRUE filter | FLOWING |
| VendorCatalogueCard | vendor: VendorCatalogueEntry | Passed from VendorSearchModal results.map() | Yes — data from live DB | FLOWING |
| Providers.tsx EmptyProvidersState | providers.length === 0 | useProviders(restaurantId) → GET /providers → providers Supabase table | Yes — real providers query | FLOWING |
| BranchProviderTransferModal | currentProviders: Provider[] | useProviders(user?.restaurantId) in AddLocationDialog | Yes — real providers query | FLOWING |
| Orders.tsx pre-flight guard | providers.length | useProviders() or similar | Yes — same query used throughout | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED (requires running NestJS API and React frontend — no standalone entry point to check without starting services)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| VENDOR-01 | 27-01-PLAN | vendor_catalogue table with RLS | SATISFIED | Migration 20260509000001 creates table + RLS policies |
| VENDOR-02 | 27-01-PLAN | providers.catalogue_vendor_id FK + is_custom flag | SATISFIED | Migration 20260509000002 alters providers table |
| VENDOR-03 | 27-01-PLAN | 20+ seeded vendor rows | SATISFIED | 27_vendor_catalogue_seed.sql: 20 rows |
| VENDOR-04 | 27-02-PLAN | VendorCatalogueModule with search/detail endpoints | SATISFIED | vendor-catalogue.module/controller/service all exist and are wired |
| VENDOR-05 | 27-02-PLAN | Providers dual-mode create (catalogue or custom) | SATISFIED | ProvidersService.createProvider() Mode A and Mode B |
| VENDOR-06 | 27-02-PLAN | Order creation guard: 403 reason=no_vendors | SATISFIED | ProcurementService.createOrder() guard at line 92-108 |
| VENDOR-07 | 27-03-PLAN | services/api/vendors.ts with all 4 functions | SATISFIED | vendors.ts exports searchVendorCatalogue, getVendorCatalogueEntry, addProviderFromCatalogue, addCustomProvider |
| VENDOR-08 | 27-03-PLAN | VendorCatalogueCard + VendorSearchModal | SATISFIED | Both components exist and are fully implemented |
| VENDOR-09 | 27-03-PLAN | Providers page empty state + modal wiring | SATISFIED | EmptyProvidersState, showVendorSearch state, VendorSearchModal rendered |
| VENDOR-10 | 27-04-PLAN | BranchProviderTransferModal + OrderGuardModal wired | SATISFIED | Both components built; wired into AddLocationDialog and Orders.tsx |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/api-gateway/src/providers/providers.service.ts` | 146-151 | `listProviders()` has no `restaurant_id` scope — returns all providers across all tenants | WARNING | Multi-tenant data leak if endpoint is exposed; this is a pre-existing issue from before Phase 27 that the code review (WR-03) flagged but did not fix. Not introduced by Phase 27. |
| `apps/api-gateway/src/procurement/procurement.service.ts` | 257-271 | `updateOrder()` sends `undefined` values via `??  undefined` pattern — fragile Supabase serialization | WARNING | Pre-existing issue (WR-04 from code review); works but could behave unexpectedly on Supabase client changes. Not introduced by Phase 27. |
| `apps/web/src/pages/Orders.tsx` | 438 | `confirmApproval` sets `showApprovalModal(false)` but the newer OrderApprovalModal uses `showOrderApprovalModal` — wrong modal state closed | WARNING | Pre-existing bug in existing approval flow (WR-05 from code review); not introduced by Phase 27. The Phase 27 OrderGuardModal is correctly wired. |
| `apps/web/src/pages/Providers.tsx` | 151-153 | `_editingNote`, `_noteText`, `_expandedCards` — dead state variables with underscore prefix | INFO | Dead code, no functional impact (IN-03 from code review) |
| `apps/web/src/pages/Orders.tsx` | 316-319 | `console.log('Notification permission:', permission)` — debug log in production | INFO | Debug artifact; no functional impact (IN-02 from code review) |

**Note:** CR-01 (hardcoded telemetry endpoint) and CR-04 (localStorage access token) from the code review were confirmed FIXED — no `127.0.0.1:7243` URLs in Orders.tsx and no `localStorage.getItem('accessToken')` in AddLocationDialog.tsx. CR-02 (SQL injection in searchProviders) was fixed by sanitizing input (line 467: `params.q.replace(/[,().]/g, '')`). CR-03 (guard logic inverted on countError) was fixed — `countError` now throws InternalServerErrorException.

### Human Verification Required

All 36 must-have truths verified at code level. The following items require interactive testing with a running application:

**1. Providers Page Empty State and Browse Catalogue CTA**

**Test:** Log in with a restaurant account that has zero providers. Navigate to /providers. Verify: (a) empty state renders with BookOpen+Truck icons, (b) "No vendors yet" headline is visible, (c) "Browse Vendor Catalogue" button opens VendorSearchModal, (d) modal shows US vendors on first load.
**Expected:** Empty state visible; modal opens with pre-loaded US vendor list.
**Why human:** CSS rendering, animation transitions, and modal open/close behavior require interactive testing.

**2. VendorSearchModal Search and Add Flow**

**Test:** In VendorSearchModal, type "southern" in the search bar. Wait 400ms. Verify Southern Glazer's appears in results. Click "Add to My Providers". Verify: sonner toast shows "Added Southern Glazer's Wine & Spirits to your providers", modal closes, provider appears in the Providers list.
**Expected:** Debounced search works; add succeeds with toast; provider list updates via refetch().
**Why human:** End-to-end flow requires live Supabase DB with seeded data and running API.

**3. Add Location → BranchProviderTransferModal sequence**

**Test:** With >=1 existing provider, navigate to Settings > Locations > Add Location. Fill form and submit. Verify: (a) AddLocationDialog closes after location toast, (b) BranchProviderTransferModal appears with "Add vendors to [New Branch Name]?" title, (c) all existing providers listed with checkboxes checked. Click "Skip for now" to verify it closes without any API calls.
**Expected:** Transfer modal appears after successful location creation with existing providers.
**Why human:** Multi-step modal sequence with state handoff between components requires visual verification.

**4. Order Creation Guard (zero providers)**

**Test:** With zero providers, navigate to Orders. Click "Create Order". Add a wine item. Proceed to "Contact Providers" step. Verify OrderGuardModal appears with title "Add a vendor to place orders". Click "Go to Providers" and verify navigation to /providers. Separately test "Back to Order" dismisses modal.
**Expected:** Pre-flight guard intercepts before any API call; modal renders correctly; navigation works.
**Why human:** Interactive multi-step order creation flow.

**5. Backend 403 no_vendors safety net**

**Test:** With a restaurant that has providers in the pre-flight check, but zero at the time of the actual API call (race condition), or by directly calling POST /api/v1/procurement/orders on a restaurant with zero active providers via Postman/curl. Verify the response is HTTP 403 with body `{ reason: 'no_vendors', message: '...', redirect: '/providers' }`.
**Expected:** Backend returns 403; frontend catch block (Orders.tsx lines 924-931) intercepts and shows OrderGuardModal.
**Why human:** Requires direct API testing or ability to create race condition in frontend.

### Gaps Summary

No gaps found. All 36 must-have truths are verified in the codebase. All critical issues identified in the code review (CR-01, CR-02, CR-03, CR-04) have been fixed. The remaining code review findings (WR-03, WR-04, WR-05, IN-01 through IN-04) are pre-existing issues not introduced by Phase 27, and none of them block the Phase 27 goal.

The status is `human_needed` because interactive browser testing is required to confirm the full user flows (vendor search, add provider, branch transfer, order guard) work end-to-end with the live Supabase seed data.

---

_Verified: 2026-05-10T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
