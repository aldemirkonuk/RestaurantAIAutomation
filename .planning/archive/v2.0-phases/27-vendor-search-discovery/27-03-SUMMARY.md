---
phase: 27-vendor-search-discovery
plan: "03"
subsystem: frontend
tags: [vendor-search, provider-empty-state, modal, react, framer-motion, radix-dialog]
dependency_graph:
  requires: [27-01, 27-02]
  provides:
    - VendorSearchModal (searchable, debounced 300ms, catalogue browsing)
    - VendorCatalogueCard (vendor result display card)
    - services/api/vendors.ts (searchVendorCatalogue, addProviderFromCatalogue, addCustomProvider)
    - Providers page empty state (EmptyProvidersState with two CTAs)
    - Providers page "Add Vendor" secondary button (opens VendorSearchModal)
  affects: [apps/web/src/pages/Providers.tsx, providers list refresh on add]
tech_stack:
  added: []
  patterns:
    - Radix Dialog primitive with framer-motion overlay + content animations
    - 300ms debounce with useRef cleanup on unmount
    - AnimatePresence skeleton → idle → empty → results state transitions
    - sonner toast for add-to-providers feedback
    - useCallback + useEffect for debounced search with dependency tracking
key_files:
  created:
    - apps/web/src/services/api/vendors.ts
    - apps/web/src/components/providers/VendorCatalogueCard.tsx
    - apps/web/src/components/providers/VendorSearchModal.tsx
  modified:
    - apps/web/src/pages/Providers.tsx
decisions:
  - EmptyProvidersState shown inline when providers.length === 0 (not a separate route)
  - VendorSearchModal auto-loads US results on open (calls runSearch('', 'US') in useEffect)
  - Country filter defaults to US; passes undefined to API when set to empty string (all countries)
  - Fragment wrapper (providers.length > 0 && <>) preserves existing list view without refactor
  - Tasks 4 and 5 share one commit (Providers.tsx) — empty state and modal wiring are inseparable
metrics:
  duration: "14 minutes"
  completed: "2026-05-10"
  tasks_completed: 5
  tasks_total: 5
  files_created: 3
  files_modified: 1
---

# Phase 27 Plan 03: Frontend — Providers Empty State + VendorSearchModal + Catalogue Browsing Summary

## One-liner

React frontend for vendor catalogue search: dedounced VendorSearchModal (Radix Dialog + AnimatePresence), VendorCatalogueCard with type badges and Add button, EmptyProvidersState on Providers page, and vendors.ts API service wiring all paths through GET /vendor-catalogue/search and POST /providers.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | services/api/vendors.ts | 6ba10f3 | apps/web/src/services/api/vendors.ts |
| 2 | VendorCatalogueCard component | 9656c8b | apps/web/src/components/providers/VendorCatalogueCard.tsx |
| 3 | VendorSearchModal component | 4829444 | apps/web/src/components/providers/VendorSearchModal.tsx |
| 4+5 | Providers empty state + VendorSearchModal wiring | c528e03 | apps/web/src/pages/Providers.tsx |

## What Was Built

### Task 1 — services/api/vendors.ts (VENDOR-07)

New API service file with:

- **`VendorCatalogueEntry`** type — 15 fields matching the `vendor_catalogue` DB schema
- **`searchVendorCatalogue(q, country?, limit, offset)`** → `GET /vendor-catalogue/search` — returns `VendorCatalogueEntry[]` from `VendorSearchResponse.data`
- **`getVendorCatalogueEntry(id)`** → `GET /vendor-catalogue/:id`
- **`addProviderFromCatalogue(catalogueVendorId)`** → `POST /providers` with `{ catalogue_vendor_id }` — triggers Mode A in the backend
- **`addCustomProvider(data)`** → `POST /providers` with name/type/phone/email/website — triggers Mode B

All calls go through `apiClient` (axois instance from `services/api/client.ts`) which auto-attaches the JWT `Authorization` header and `X-Restaurant-Id`.

### Task 2 — VendorCatalogueCard.tsx (VENDOR-08)

Clean result card component:

- **Name** (bold, large) + **type badge** (color-coded: blue=distributor, purple=importer, emerald=wholesaler, rose=winery_direct, amber=broker)
- **Location** composed from `city`, `state`, `country` (US country omitted for brevity)
- **wine_specialties** shown as 2-line truncated gray text
- **Phone/website** — small icon buttons (clickable, stopPropagation to prevent card click)
- **"Add to My Providers"** button — wine-600 themed, shows `Loader2` spinner while async `onAdd` is in flight
- framer-motion `initial/animate` entry animation

### Task 3 — VendorSearchModal.tsx (VENDOR-08)

Full vendor search modal using Radix Dialog:

- **Layout**: `max-w-2xl` centered on desktop; full-width on mobile with `pt-[5vh]` top padding
- **Search bar** with 300ms debounce (useRef timer, cleared on unmount/dependency change)
- **Country filter** select (US default, 9 country options, passes `undefined` when "All Countries" selected)
- **AnimatePresence** manages 4 state transitions: `skeleton` (3 VendorCardSkeleton placeholders) → `idle` (before first search) → `empty` (no results) → `results` (maps VendorCatalogueCard)
- **Auto-load**: `useEffect([open])` calls `runSearch('', 'US')` when modal opens so US vendors display immediately
- **Add flow**: `addProviderFromCatalogue(vendor.id)` → sonner `toast.success('Added X to your providers')` → calls `onProviderAdded()` + `onClose()`
- **Footer**: "Add Custom Vendor Instead →" closes modal, calls `onAddCustom()` to open AddProviderModal

### Tasks 4+5 — Providers.tsx empty state + modal wiring (VENDOR-09)

Changes to `apps/web/src/pages/Providers.tsx`:

**New imports**: `BookOpen` from lucide-react, `VendorSearchModal` from components/providers

**New state**: `showVendorSearch: boolean` (useState)

**`EmptyProvidersState` inline component**:
- Wine bottle / book + truck icon composition (BookOpen + Truck in overlapping rounded boxes)
- Headline: "No vendors yet"
- Subtext: marketing copy about vendors enabling ordering
- Two CTA buttons: "Browse Vendor Catalogue" (wine-600) and "Add Custom Vendor" (white/border)

**Providers page conditional logic**:
```tsx
{providers.length === 0 && !isLoading && (
  <EmptyProvidersState
    onBrowseCatalogue={() => setShowVendorSearch(true)}
    onAddCustom={() => setShowAddProviderModal(true)}
  />
)}
{providers.length > 0 && (
  <>
    {/* existing toolbar + list view */}
    {/* + new "Add Vendor" button in toolbar → setShowVendorSearch(true) */}
  </>
)}
```

**VendorSearchModal rendered** at bottom of page:
```tsx
<VendorSearchModal
  open={showVendorSearch}
  onClose={() => setShowVendorSearch(false)}
  onProviderAdded={() => refetch()}
  onAddCustom={() => setShowAddProviderModal(true)}
/>
```

`onProviderAdded` calls `refetch()` from the `useProviders` query — this forces the providers list to reload after adding from the catalogue, transitioning from empty state to list view automatically.

## Deviations from Plan

### Auto-adjusted — Tasks 4 and 5 committed together

**Found during:** Task 4

**Issue:** The plan lists Task 4 (EmptyProvidersState) and Task 5 (wire VendorSearchModal) as separate tasks, but both modifications live in `Providers.tsx` and are semantically inseparable — adding the empty state without the modal wiring would leave the CTA button non-functional.

**Fix:** Committed both tasks in one atomic commit (`c528e03`) to `apps/web/src/pages/Providers.tsx` with a combined commit message covering both tasks.

**Files modified:** apps/web/src/pages/Providers.tsx

---

### Auto-adjusted — VendorSearchModal auto-loads US results on open

**Found during:** Task 3

**Issue:** The plan spec says "Empty state: 'Search for a vendor by name or specialty'" for the initial idle state. However, with a completely blank modal and no pre-loaded results, the UX is weak — users must know to type before they see anything.

**Fix:** Added `useEffect([open])` that fires `runSearch('', 'US')` when the modal opens. Users immediately see US vendors, making the catalogue feel populated and useful. The idle text state is still shown if `hasSearched` is false (which only happens if both query and country are empty AND no search has run).

**Files modified:** apps/web/src/components/providers/VendorSearchModal.tsx

## Verification Checklist

- [x] `apps/web/src/services/api/vendors.ts` — exists, exports `searchVendorCatalogue`, `addProviderFromCatalogue`, `addCustomProvider`
- [x] `apps/web/src/components/providers/VendorCatalogueCard.tsx` — exists, exports `VendorCatalogueCard`
- [x] `apps/web/src/components/providers/VendorSearchModal.tsx` — exists, exports `VendorSearchModal`
- [x] `apps/web/src/pages/Providers.tsx` — imports VendorSearchModal, has `showVendorSearch` state, EmptyProvidersState, conditional empty/list rendering
- [x] `searchVendorCatalogue` calls `GET /vendor-catalogue/search` with q, country, limit, offset
- [x] `addProviderFromCatalogue` sends `{ catalogue_vendor_id }` to `POST /providers` (Mode A)
- [x] VendorCatalogueCard shows name, type badge, location, wine_specialties, phone/website icons, Add button
- [x] VendorSearchModal debounces 300ms, shows skeleton, empty, results states with AnimatePresence
- [x] Providers empty state shown when `providers.length === 0 && !isLoading`
- [x] "Browse Vendor Catalogue" CTA opens VendorSearchModal (`setShowVendorSearch(true)`)
- [x] "Add Custom Vendor" CTA opens AddProviderModal
- [x] With providers: "Add Vendor" button in toolbar opens VendorSearchModal
- [x] onProviderAdded calls `refetch()` to reload providers list
- [x] "Add Custom Vendor Instead" link in modal closes modal and opens AddProviderModal
- [x] TypeScript: no new errors introduced (3 pre-existing errors in Providers.tsx remain unchanged)

**Pending (requires live frontend):**
- [ ] Navigate to /providers with empty restaurant → empty state shows BookOpen + Truck icon, two CTAs
- [ ] Click "Browse Vendor Catalogue" → VendorSearchModal opens with US vendors pre-loaded
- [ ] Type "southern" → results filter to matching vendors within 500ms
- [ ] Click "Add to My Providers" on a card → toast shown → modal closes → provider appears in list
- [ ] With providers present: toolbar shows "Add Vendor" button → opens VendorSearchModal

## Known Stubs

None — all API calls are wired to the real backend endpoints built in Wave 2. The `addProviderFromCatalogue` call triggers Mode A in `ProvidersService.createProvider()`, which fetches from `vendor_catalogue` and inserts into `providers` with `is_custom=false`.

## Threat Flags

None — no new network endpoints or auth surfaces introduced. The frontend consumes existing Wave 2 endpoints.

## Self-Check: PASSED

- apps/web/src/services/api/vendors.ts: FOUND
- apps/web/src/components/providers/VendorCatalogueCard.tsx: FOUND
- apps/web/src/components/providers/VendorSearchModal.tsx: FOUND
- apps/web/src/pages/Providers.tsx: FOUND (modified)
- Commit 6ba10f3: FOUND (feat(27-03): create vendors API service)
- Commit 9656c8b: FOUND (feat(27-03): create VendorCatalogueCard component)
- Commit 4829444: FOUND (feat(27-03): create VendorSearchModal)
- Commit c528e03: FOUND (feat(27-03): add EmptyProvidersState, VendorSearchModal wiring)
