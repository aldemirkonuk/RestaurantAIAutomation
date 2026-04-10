---
status: partial
phase: 16-auto-locate-wines-storage-intelligence
source: [16-VERIFICATION.md]
started: 2026-04-08T05:30:00Z
updated: 2026-04-08T05:30:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. StorageLocationManager real-time refresh
expected: Assign a wine to a location via the LocationPickerCell dropdown → StorageLocationManager (expandable location card) shows that wine in its list immediately, without page refresh
result: [pending]

### 2. Location filter chip works
expected: Click a storage location chip in the Inventory toolbar → table rows filter to show only wines assigned to that location; clicking again (or "All") shows all wines
result: [pending]

### 3. LocationPickerCell visual rendering
expected: Assigned wines show a colored pill badge with a dot matching the location color + location name; unassigned wines show a dashed "Assign location" placeholder with MapPin icon
result: [pending]

### 4. Full location guard
expected: A location at full capacity (currentCount >= capacity) appears grayed out with a "Full" badge in the dropdown and cannot be clicked/selected
result: [pending]

### 5. Auto-Locate modal open + animation
expected: Clicking "Auto-Locate" button in the Inventory toolbar opens a modal with framer-motion animation; modal shows summary stats (N wines to assign · M locations · K skipped) and a table of proposed assignments with score badges and reasons
result: [pending]

### 6. Include-already-assigned toggle
expected: In the Auto-Locate modal, checking "Include already-assigned wines" re-computes the plan and adds previously-assigned wines to the table rows
result: [pending]

### 7. Confirm batch-assign E2E
expected: In the Auto-Locate modal, uncheck some wine rows, click "Confirm Selected (N)" → only the checked wines receive location pill badges; unchecked wines remain "Assign location"; Inventory table reflects assignments immediately
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
