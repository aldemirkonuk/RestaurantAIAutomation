---
status: partial
phase: 27-vendor-search-discovery
source: [27-VERIFICATION.md]
started: 2026-05-10T00:00:00Z
updated: 2026-05-10T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Providers page empty state renders and Browse Catalogue CTA opens VendorSearchModal
expected: Navigate to /providers with a restaurant that has zero providers — empty state shows BookOpen+Truck icon, headline 'No vendors yet', two CTAs (Browse Vendor Catalogue, Add Custom Vendor). Clicking Browse opens the VendorSearchModal with US vendors auto-searched on first load.
result: [pending]

### 2. VendorSearchModal search, add, and close flow
expected: Typing 'southern' in the modal within 300-500ms shows Southern Glazer's in results. Clicking 'Add to My Providers' shows a loading spinner, displays a sonner toast 'Added Southern Glazer's Wine & Spirits to your providers', closes the modal, and the new provider appears in the Providers list.
result: [pending]

### 3. Add Location dialog triggers BranchProviderTransferModal with pre-checked providers
expected: In Settings > Locations, add a new location when the current restaurant has >=1 provider. After location is created and toast shows, BranchProviderTransferModal appears with the new branch name in the title, all existing providers listed with checkboxes checked. Clicking 'Skip for now' closes without API calls.
result: [pending]

### 4. Order creation with zero providers shows OrderGuardModal
expected: With zero providers configured, open Orders page and attempt to create an order (click 'Contact Providers' step). OrderGuardModal appears with 'Add a vendor to place orders' title, 'Go to Providers' button navigates to /providers and closes modal, 'Back to Order' dismisses modal.
result: [pending]

### 5. Backend 403 no_vendors response triggers OrderGuardModal as safety net
expected: If the pre-flight check is somehow bypassed (or tested directly), a 403 response with reason='no_vendors' from POST /procurement/orders should surface OrderGuardModal (not an error toast).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
