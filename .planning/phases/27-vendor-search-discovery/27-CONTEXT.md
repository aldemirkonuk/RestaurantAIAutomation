# Phase 27: Vendor Search & Discovery — CONTEXT

Created: 2026-05-09
Status: EXECUTED 2026-05-10 — gap closure required before UAT approval

## Execution Summary (2026-05-10)

All 4 plans executed and code review fixes applied. One blocking gap found post-execution:

**GAP-01 (blocking):** `ProvidersService.listProviders()` returns providers from ALL restaurants —
no `restaurant_id` filter. Each restaurant (including different branches of the same owner) must
only see its own providers. The `vendor_catalogue` table is intentionally global (browse/discover),
but `providers` (the restaurant's actual vendor relationships) must be strictly tenant-scoped.

**What to do next:**
1. `/gsd-plan-phase 27 --gaps` — creates a gap closure plan targeting providers.service.ts + controller
2. `/gsd-execute-phase 27 --gaps-only` — executes the fix
3. Run 5 human UAT tests in `27-HUMAN-UAT.md` — approve to mark phase complete

**Where the fix goes:**
- `apps/api-gateway/src/providers/providers.service.ts` — `listProviders()` line 146: add `.eq('restaurant_id', restaurantId)`, extract `restaurantId` from call signature
- `apps/api-gateway/src/providers/providers.controller.ts` — pass `restaurant_id` from `@CurrentUser()` decorator into service call
- Audit all other queries in `providers.service.ts` that touch the `providers` table for the same gap

---

## Problem Being Solved

New users who register have an empty Providers page with no guidance on what to do next. Currently:
1. `providers` table is restaurant-scoped but there is no curated starting list — users see a blank page
2. No way to discover vendors without leaving the app
3. Order creation has no guard — users can create orders with zero vendors configured, which will always fail
4. When an owner adds a branch restaurant, there is no prompt to transfer their existing vendor relationships
5. Every user names vendors differently ("Southern Wine", "SWS", "Southern Wine & Spirits"), making a
   crowd-sourced global catalogue unviable at this stage

---

## Decisions

### D-01: Per-Restaurant Now, Global Later
The vendor catalogue (`vendor_catalogue` table) is **admin-curated** — seeded by us from `providerData.ts`
(~20 US distributors), maintained by the WineOps team, and never polluted by user input.

When a user adds a vendor from the catalogue, it **copies** to their `providers` table. Their copy is theirs
to rename/edit — it does not affect the global catalogue. This preserves integrity.

Custom vendors created by users are stored in `providers` with `is_custom = true` and `catalogue_vendor_id = null`.
Over time, admins can review popular custom entries and promote them to the catalogue.

### D-02: Search-First Providers Empty State
When a restaurant has zero providers, the Providers page shows a search-first empty state:
- Prominent search bar: "Search wine vendors..."
- Two CTAs: "Browse Catalogue" and "Add Custom Vendor"
- Marketing copy explaining why adding vendors matters

This replaces the generic "no data" empty state currently shown.

### D-03: VendorSearchModal UX
A modal (or inline panel) that:
1. Shows a search bar with instant fuzzy results from `vendor_catalogue`
2. Shows vendor details on selection: name, type, address, specialties, phone, website
3. "Add to My Providers" button creates a row in `providers` pre-filled with vendor data
4. "Add Custom Instead" link opens the existing AddProviderModal

### D-04: Order Creation Guard (Tiered)
- **Free tier / all tiers for now**: Hard block — user cannot submit an order if `providers` is empty.
  A modal explains "You need at least one vendor to place orders" with a direct link to /providers.
- **Future (paid tier)**: LLM-powered vendor suggestion — when no vendors exist and user tries to order,
  the system searches online for vendors who supply that specific wine/item and presents a selection UI.
  This is **stubbed** in the architecture now (empty handler with TODO comment) but not implemented.

### D-05: Branch Provider Transfer
When a user adds a new location in Settings → Locations → Add Location:
After the location is created, a `BranchProviderTransferModal` appears:
- "Would you like to add your current vendors to [New Branch Name]?"
- Shows all providers with checkboxes — all pre-checked (user unchecks to exclude)
- "Transfer Selected" → creates duplicate `providers` rows scoped to the new `restaurant_id`
- "Skip" → dismisses without transfer

### D-06: Vendor Catalogue Structure
`vendor_catalogue` is a global read-only table (no RLS restriction on reads for authenticated users):
- `id` UUID
- `name` TEXT NOT NULL
- `type` TEXT (e.g., 'distributor', 'importer', 'wholesaler', 'winery_direct')
- `country` TEXT
- `state` TEXT (nullable — for US regional distributors)
- `city` TEXT
- `address` TEXT
- `phone` TEXT
- `email` TEXT
- `website` TEXT
- `wine_specialties` TEXT (e.g., 'Burgundy, Bordeaux, Champagne')
- `notes` TEXT
- `is_active` BOOLEAN DEFAULT TRUE
- `created_at`, `updated_at`

### D-07: Providers Table Updates
Add to existing `providers` table:
- `catalogue_vendor_id UUID REFERENCES vendor_catalogue(id) ON DELETE SET NULL` (nullable)
- `is_custom BOOLEAN NOT NULL DEFAULT TRUE`

---

## User Stories

1. **New user (empty providers)** opens Providers page → sees search empty state → searches "wine" →
   sees "Southern Wine & Spirits" in results → clicks → sees details → clicks "Add to My Providers" →
   provider appears in their list pre-filled
2. **User with providers** adds a new branch location in Settings → after location is saved, a modal
   appears asking which existing vendors to transfer → selects 3 of 5 → clicks "Transfer" → new branch
   now has 3 providers
3. **User tries to create an order** with zero providers → modal blocks them → "You have no vendors.
   Add vendors to continue." → link to /providers → user adds a vendor → creates order successfully

---

## Architecture Fit

- New `vendor_catalogue` table: global, admin-curated, read-only for restaurant users
- `providers` table: per-restaurant, writable by restaurant users, optionally linked to catalogue
- Backend: NestJS `VendorCatalogueModule` with `SearchController` + `ProvidersController` updates
- Frontend: `VendorSearchModal.tsx`, `BranchProviderTransferModal.tsx`, `OrderGuardModal.tsx`
- Existing `providerData.ts` becomes the seed SQL for `vendor_catalogue`
- Existing `AddLocationDialog.tsx` gets a post-save hook that triggers the transfer modal

---

## Future Extensions (Explicitly Out of Scope for Phase 27)
- LLM-powered vendor discovery (paid tier order guard)
- Auto-suggest vendors based on restaurant location
- Admin panel for promoting custom vendors to catalogue
- Vendor ratings / relationship history across restaurants
