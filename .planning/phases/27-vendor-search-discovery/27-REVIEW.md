---
phase: 27-vendor-search-discovery
reviewed: 2026-05-10T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - apps/api-gateway/src/app.module.ts
  - apps/api-gateway/src/procurement/procurement.controller.ts
  - apps/api-gateway/src/procurement/procurement.service.ts
  - apps/api-gateway/src/providers/dto/providers.dto.ts
  - apps/api-gateway/src/providers/providers.service.ts
  - apps/api-gateway/src/vendor-catalogue/dto/search-vendors.dto.ts
  - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.controller.ts
  - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.module.ts
  - apps/api-gateway/src/vendor-catalogue/vendor-catalogue.service.ts
  - apps/web/src/components/locations/AddLocationDialog.tsx
  - apps/web/src/components/orders/OrderGuardModal.tsx
  - apps/web/src/components/providers/BranchProviderTransferModal.tsx
  - apps/web/src/components/providers/VendorCatalogueCard.tsx
  - apps/web/src/components/providers/VendorSearchModal.tsx
  - apps/web/src/pages/Orders.tsx
  - apps/web/src/pages/Providers.tsx
  - apps/web/src/services/api/providers.ts
  - apps/web/src/services/api/vendors.ts
  - supabase/migrations/20260509000001_vendor_catalogue.sql
  - supabase/migrations/20260509000002_providers_catalogue_link.sql
  - supabase/migrations/seed/27_vendor_catalogue_seed.sql
findings:
  critical: 4
  warning: 7
  info: 4
  total: 15
fixed:
  critical: 4
  warning: 3
  info: 0
status: partially_resolved
fixed_at: 2026-05-10T00:00:00Z
fixed_findings:
  - CR-01
  - CR-02
  - CR-03
  - CR-04
  - WR-01
  - WR-02
  - WR-06
  - WR-07
remaining_findings:
  - WR-03
  - WR-04
  - WR-05
  - IN-01
  - IN-02
  - IN-03
  - IN-04
---

# Phase 27: Code Review Report

**Reviewed:** 2026-05-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

This phase adds a global vendor catalogue table, wires it into the provider creation flow (Mode A / Mode B), adds a `VendorSearchModal` for browsing and one-click provider addition, and introduces a `BranchProviderTransferModal` for copying providers to new locations. The database schema and seed are solid. The critical issues are: a hardcoded telemetry endpoint URL leaking an internal UUID into the front-end bundle, a SQL injection vector in `searchProviders` via unescaped `ilike` interpolation, a missing no-vendors guard when `countError` is set (the guard logic is inverted), and an access-token theft risk from `localStorage` in `AddLocationDialog`. Several warnings cover logic correctness, silent failure swallowing, and API/DTO mismatches.

---

## Critical Issues

### CR-01: Hardcoded internal telemetry endpoint with UUID leaks into production bundle

**File:** `apps/web/src/pages/Orders.tsx:536-553`, `567-579`, `582-596`, `603-616`, `633-653`, `661-674`

**Issue:** The file contains at least six `fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', ...)` calls wrapped in `// #region agent log` comments. This hardcoded `localhost` URL and UUID are committed to source and will ship to every client browser — where they silently fail because `127.0.0.1:7243` resolves to the *user's* machine, not the server. Beyond the debug-artifact problem, the UUID embedded in the URL is a recognizable internal identifier that should not appear in the production bundle. All six blocks must be removed before this ships.

**Fix:**
```typescript
// Remove all #region agent log / #endregion blocks entirely.
// If telemetry is still needed in development, gate it behind an env flag:
if (import.meta.env.DEV && import.meta.env.VITE_AGENT_LOG_URL) {
  fetch(`${import.meta.env.VITE_AGENT_LOG_URL}/ingest/...`, { ... }).catch(() => {})
}
```

---

### CR-02: SQL injection vector in `ProvidersService.searchProviders` via unescaped `ilike` interpolation

**File:** `apps/api-gateway/src/providers/providers.service.ts:465`

**Issue:** The search query `params.q` is interpolated directly into a Supabase filter string:
```typescript
query = query.or(`name.ilike.%${params.q}%,company_name.ilike.%${params.q}%,contact_name.ilike.%${params.q}%`);
```
Supabase's `.or()` method accepts raw PostgREST filter syntax. A value like `abc%,name.neq.` or a value containing commas can break out of the intended filter expression and inject arbitrary filter predicates. An attacker who can control `q` (it is an unauthenticated-style query param surfaced from the HTTP layer) can enumerate or bypass row-level filters for the `providers` table.

**Fix:**
```typescript
// Use individual, parameterised ilike calls with OR chaining instead of .or() string:
if (params.q) {
  query = query.or(
    [
      `name.ilike.${encodeURIComponent('%' + params.q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%')}`,
      `company_name.ilike.${encodeURIComponent('%' + params.q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%')}`,
      `contact_name.ilike.${encodeURIComponent('%' + params.q.replace(/%/g, '\\%').replace(/_/g, '\\_') + '%')}`,
    ].join(','),
  );
}
// Better yet: use full-text search or stored procedure to avoid string building entirely.
```

---

### CR-03: No-vendors guard in `ProcurementService.createOrder` silently allows order creation when the count query errors

**File:** `apps/api-gateway/src/procurement/procurement.service.ts:98`

**Issue:**
```typescript
if (!countError && providerCount === 0) {
  throw new ForbiddenException(...)
}
```
The guard only fires when there is **no error** AND the count is zero. If `countError` is truthy (e.g., a database timeout or connectivity hiccup), the condition is `false` — the guard is skipped and order creation proceeds against a restaurant that may have zero active providers. The intent is clearly to block orders when providers are absent; the current logic does the opposite when the DB call fails.

**Fix:**
```typescript
if (countError) {
  this.logger.error('Failed to count active providers', { restaurantId, error: countError.message });
  throw new InternalServerErrorException('Could not verify vendor availability. Please try again.');
}
if (providerCount === 0) {
  throw new ForbiddenException({
    reason: 'no_vendors',
    message: 'You must add at least one vendor before placing orders.',
    redirect: '/providers',
  });
}
```

---

### CR-04: Access token read from `localStorage` in `AddLocationDialog` — XSS-extractable secret

**File:** `apps/web/src/components/locations/AddLocationDialog.tsx:65`, `93-95`

**Issue:** The component calls `localStorage.getItem('accessToken')` directly to build `Authorization` headers for two separate `fetch` calls (chains load and location POST). Storing JWT access tokens in `localStorage` is a known XSS risk: any injected script can exfiltrate the token. The rest of the codebase uses `apiClient` (an Axios instance that presumably manages tokens via interceptors), but this component bypasses it entirely, also bypassing any token-refresh or error-handling logic.

**Fix:**
```typescript
// Replace both raw fetch calls with apiClient calls.
// Chain load:
const { data: chains } = await apiClient.get<Chain[]>('/organizations/chains')
setChains(Array.isArray(chains) ? chains : [])

// Location creation:
const location = await apiClient.post('/organizations/locations', { name: name.trim(), ... })
```

---

## Warnings

### WR-01: `VendorSearchModal` issues two simultaneous search requests on open (debounce and eager load race)

**File:** `apps/web/src/components/providers/VendorSearchModal.tsx:82-121`

**Issue:** Two `useEffect` hooks both call `runSearch` when the modal opens. The debounce effect (lines 82-98) fires because `query` is `''` and `country` is `'US'` — both truthy-check conditions pass so `runSearch('', 'US')` is scheduled after 300 ms. The eager-load effect (lines 117-121) fires the same call immediately. This causes two identical in-flight network requests on every modal open, and the two `setResults` calls race: whichever response arrives second wins, which could show stale data if latency differs.

**Fix:**
```typescript
// Remove the debounce effect's !query && !country early-return guard so it clears results
// only when BOTH are empty, and skip debounce firing when the eager-load already ran.
// Simplest fix: consolidate into a single effect and set hasSearched=true only when
// the user has actively typed, not on initial load.

// In the debounce effect, skip execution on initial mount:
const isInitialMount = useRef(true)
useEffect(() => {
  if (isInitialMount.current) { isInitialMount.current = false; return }
  // ... debounce logic
}, [query, country, runSearch])
```

---

### WR-02: `BranchProviderTransferModal` progress counter is wrong — it only counts successes, not attempts

**File:** `apps/web/src/components/providers/BranchProviderTransferModal.tsx:86`

**Issue:**
```typescript
succeeded++
// ...
setTransferProgress(succeeded)
```
`transferProgress` is displayed as `{transferProgress} / {selectedCount}` in the progress bar and label. Because `setTransferProgress` is only called after a successful API call (inside the try block before the catch), if a provider fails, the counter does not advance. The bar appears to stall. The denominator is `selectedCount` (total selected), so the UI will never reach 100% if any provider fails.

**Fix:**
```typescript
let attempted = 0
for (const provider of selectedProviders) {
  try {
    // ... API call
    succeeded++
  } catch {
    // skip
  }
  attempted++
  setTransferProgress(attempted)   // advance on every attempt, not just success
}
```

---

### WR-03: `listProviders` in `ProvidersService` returns all providers across all tenants — missing `restaurant_id` scope

**File:** `apps/api-gateway/src/providers/providers.service.ts:146-159`

**Issue:**
```typescript
async listProviders(): Promise<ProviderResponseDto[]> {
  const { data, error } = await this.databaseService.supabase
    .from('providers')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
```
There is no `.eq('restaurant_id', restaurantId)` filter. If any controller calls `listProviders()` without pre-filtering (for example, an admin endpoint), all restaurant providers are returned across tenant boundaries. Even if RLS is the last line of defence, the service-layer query should never be unscoped. Check the controller to ensure it always passes `restaurantId` to `searchProviders` instead of this method.

**Fix:**
```typescript
async listProviders(restaurantId: string): Promise<ProviderResponseDto[]> {
  const { data, error } = await this.databaseService.supabase
    .from('providers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  ...
}
```

---

### WR-04: `updateOrder` in `ProcurementService` sends `undefined` values in the Supabase update payload — may clear fields unintentionally

**File:** `apps/api-gateway/src/procurement/procurement.service.ts:253-267`

**Issue:**
```typescript
const updatePayload: Record<string, any> = {
  status: dto.status ?? undefined,
  quoted_price: dto.quotedPrice ?? undefined,
  ...
};
```
A `Record<string, any>` with `undefined` values is serialised by Supabase's JS client — keys with `undefined` values are stripped from JSON, but because the payload object is still sent, if any internal Supabase serialisation changes (or if the object is spread differently), the `undefined` values could arrive as `null` or as absent, causing partial updates to unexpectedly null out fields. More concretely, `dto.status ?? undefined` evaluates to `undefined` when `dto.status` is not provided, yet the key `status` still exists in the payload object. The Supabase client silently drops `undefined` properties, so this currently works, but it is fragile and should be cleaned up.

**Fix:**
```typescript
const updatePayload: Record<string, any> = {}
if (dto.status !== undefined) updatePayload.status = dto.status
if (dto.quotedPrice !== undefined) updatePayload.quoted_price = dto.quotedPrice
// ... same pattern for all fields
```

---

### WR-05: `confirmApproval` in `Orders.tsx` closes the wrong modal — `showApprovalModal` instead of `showOrderApprovalModal`

**File:** `apps/web/src/pages/Orders.tsx:438`

**Issue:**
```typescript
setShowApprovalModal(false)      // closes the OLD approval modal
setSelectedOrder(null)
```
The function is triggered from `OrderApprovalModal` (controlled by `showOrderApprovalModal`), but `confirmApproval` sets `showApprovalModal` (a different state variable) to `false`. `showOrderApprovalModal` is never set to `false` inside `confirmApproval`, so after approving, the `OrderApprovalModal` dialog stays open until the user manually dismisses it.

**Fix:**
```typescript
const confirmApproval = async (price: number) => {
  try {
    if (selectedOrder && isUuid(selectedOrder.order_id)) {
      await apiClient.post(`/procurement/orders/${selectedOrder.order_id}/approve`, { finalPrice: price })
    }
    setShowOrderApprovalModal(false)   // was setShowApprovalModal(false)
    setSelectedOrder(null)
    refetchOrders()
  } catch (error) {
    console.error('Approval failed:', error)
    alert('Failed to approve order')
  }
}
```

---

### WR-06: `VendorSearchModal.handleAdd` does not handle duplicate-provider errors — succeeds silently even if backend rejects

**File:** `apps/web/src/components/providers/VendorSearchModal.tsx:124-129`

**Issue:**
```typescript
const handleAdd = async (vendor: VendorCatalogueEntry) => {
  await addProviderFromCatalogue(vendor.id)
  toast.success(`Added ${vendor.name} to your providers`)
  onProviderAdded()
  onClose()
}
```
There is no try/catch. If `addProviderFromCatalogue` throws (e.g., unique constraint violation because the vendor was already added), the unhandled rejection bubbles up through the `VendorCatalogueCard.handleAdd` wrapper which does catch it — but only resets `adding` state. The error is silently swallowed; the user sees no feedback explaining why the add failed.

**Fix:**
```typescript
const handleAdd = async (vendor: VendorCatalogueEntry) => {
  try {
    await addProviderFromCatalogue(vendor.id)
    toast.success(`Added ${vendor.name} to your providers`)
    onProviderAdded()
    onClose()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to add vendor'
    toast.error(`Could not add ${vendor.name}`, { description: message })
  }
}
```

---

### WR-07: `vendor_catalogue` search only matches `name` with `ilike`; `wine_specialties` is excluded despite being advertised in the UI

**File:** `apps/api-gateway/src/vendor-catalogue/vendor-catalogue.service.ts:48-50` and `apps/web/src/components/providers/VendorSearchModal.tsx:193`

**Issue:** The search input placeholder in the modal reads "Search vendors by name or specialty..." but the backend query only filters on `name`:
```typescript
if (q) {
  query = query.ilike('name', `%${q}%`);
}
```
The GIN full-text index on `name` (migration line 24) is also unused here because `ilike` does not use GIN `to_tsvector` indexes — a full-table seq scan will occur on non-trivially sized catalogues. Searching by specialty is the primary use-case for a wine manager.

**Fix:**
```typescript
if (q) {
  query = query.or(`name.ilike.%${q}%,wine_specialties.ilike.%${q}%`);
}
// Also add a GIN index on wine_specialties, or use a combined tsvector column:
// CREATE INDEX idx_vendor_catalogue_search ON vendor_catalogue
//   USING gin(to_tsvector('english', coalesce(name,'') || ' ' || coalesce(wine_specialties,'')));
```

---

## Info

### IN-01: `providers.ts` `Provider` interface missing `phone` and `email` top-level fields used by `BranchProviderTransferModal`

**File:** `apps/web/src/services/api/providers.ts:4-25`

**Issue:** The `Provider` interface declares `phone: string` and `email: string` as required fields (lines 9-10). `BranchProviderTransferModal` accesses `provider.phone` and `provider.email` (lines 76-77) which is valid per the interface. However, the backend `mapProviderRow` maps `contact_phone` and `contact_email` from the DB row, but these columns are only set in Mode A (catalogue) or Mode B (custom) via `providers.service.ts`. The interface should mark them optional (`phone?: string`) since the underlying DB columns have no `NOT NULL` constraint, and mode A catalogue providers without contact info in the catalogue will have `null` values. As-is, TypeScript types say `string` but runtime values can be `undefined`, leading to silent `href="tel:undefined"` links in the UI.

**Fix:**
```typescript
export interface Provider {
  // ...
  phone?: string    // was: phone: string
  email?: string    // was: email: string
  website?: string  // was: website: string
  // ...
}
```

---

### IN-02: Unused `console.log` in `Orders.tsx` Notification permission handler

**File:** `apps/web/src/pages/Orders.tsx:318`

**Issue:**
```typescript
Notification.requestPermission().then(permission => {
  console.log('Notification permission:', permission)
})
```
Debug `console.log` left in production code.

**Fix:** Remove the `.then(...)` callback entirely, or replace with a silent no-op.

---

### IN-03: Dead `_editingNote`, `_noteText`, `_expandedCards` state variables in `Providers.tsx`

**File:** `apps/web/src/pages/Providers.tsx:151-153`

**Issue:**
```typescript
const [_editingNote] = useState<string | null>(null)
const [_noteText] = useState('')
const [_expandedCards] = useState<Set<string>>(new Set())
```
Three state variables are declared with the underscore-prefixed convention indicating intentional non-use, but they are never set or read. This is dead code that inflates the component.

**Fix:** Remove all three declarations.

---

### IN-04: `generateOrderNumber` in `ProcurementService` uses `Math.random()` — collisions possible under concurrent load

**File:** `apps/api-gateway/src/procurement/procurement.service.ts:645-652`

**Issue:**
```typescript
const suffix = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
return `ORD-${year}-${suffix}`;
```
With 100,000 possible values per year and `Math.random()` (not cryptographically unique), concurrent order creation can generate duplicate order numbers. There is no unique constraint on `order_number` visible in the reviewed files, so duplicates would silently persist. Even if a DB unique constraint exists, the error would surface as a raw Supabase error rather than a user-friendly message.

**Fix:** Use a database sequence or UUID-derived suffix:
```typescript
// Option A: use UUIDs directly as order references
// Option B: use a DB sequence:
// CREATE SEQUENCE procurement_order_seq;
// order_number: 'ORD-' + year + '-' + nextval('procurement_order_seq')

// Option C: at minimum, add a UNIQUE constraint on order_number and
// catch duplicate-key errors specifically to retry with a new suffix.
```

---

_Reviewed: 2026-05-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
