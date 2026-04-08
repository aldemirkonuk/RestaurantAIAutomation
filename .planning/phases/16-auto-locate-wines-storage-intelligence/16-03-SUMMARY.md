---
phase: 16-auto-locate-wines-storage-intelligence
plan: "03"
subsystem: frontend/inventory
tags: [location-picker, inventory-table, surgical-edit]
dependency_graph:
  requires: [16-02-PLAN.md]
  provides: [LocationPickerCell rendered in Inventory table]
  affects: [apps/web/src/pages/Inventory.tsx]
tech_stack:
  added: []
  patterns: [component-composition, optimistic-update]
key_files:
  created: []
  modified:
    - apps/web/src/pages/Inventory.tsx
decisions:
  - "Removed editingLocationItemId state entirely — replaced by LocationPickerCell's internal open/close state"
  - "Edit icon from lucide-react retained — used in Bulk Actions bar and manual override button, not removed"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-04-08T14:44:01Z"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 16 Plan 03: Wire LocationPickerCell into Inventory Location Column Summary

**One-liner:** LocationPickerCell pill-badge picker replaces old `editingLocationItemId` + raw `<select>` pattern in the Inventory table Location column.

## What Was Built

Three surgical edits to `apps/web/src/pages/Inventory.tsx`:

1. **Import added** (`line 40`): `import { LocationPickerCell } from '../components/inventory/LocationPickerCell'`
2. **State removed** (`line 145` before edit): `const [editingLocationItemId, setEditingLocationItemId] = useState<string | null>(null)` — fully deleted
3. **td content replaced** (`lines 1200–1255` before edit): The conditional `{editingLocationItemId === item.id ? <div><select autoFocus …> : <div onClick=setEditingLocation…>}` block replaced with `<LocationPickerCell wineId={item.id} quantity={…} locations={storageLocations} currentLocation={getWineLocation(item.id)} onAssign={…} onRemove={…} />`

The `onAssign` callback wires `assignWineToLocation(item.id, locationId, qty)` and updates optimistic `storageLocation` field via `setInventory`. The `onRemove` callback wires `removeWineFromLocation(item.id)` and clears the optimistic field.

## Verification Results

```
grep -n "LocationPickerCell|editingLocationItemId|setEditingLocationItemId|autoFocus" apps/web/src/pages/Inventory.tsx
40: import { LocationPickerCell } from '../components/inventory/LocationPickerCell'
1201:   <LocationPickerCell
```

- `import.*LocationPickerCell` → 1 result ✅
- `<LocationPickerCell` → 1 result ✅
- `editingLocationItemId` → 0 results ✅
- `setEditingLocationItemId` → 0 results ✅
- `autoFocus` → 0 results ✅

TypeScript: Zero new errors in `Inventory.tsx` or `LocationPickerCell`. Pre-existing errors in unrelated files (`App.tsx` casing, test setup, `AddWineToInventoryModal.tsx`) remain unchanged.

## Commits

| Task | Commit | Files |
|------|--------|-------|
| 1 — Wire LocationPickerCell | `c821c8f` | apps/web/src/pages/Inventory.tsx |

## Deviations from Plan

None — plan executed exactly as written.

The plan noted to remove `Edit` icon from lucide-react import if unused. Checked: `Edit` is still used at two other locations in the file (Bulk Actions bar `<Edit className="w-4 h-4" />` and the Manual Override action button), so it was correctly retained.

## Known Stubs

None. `LocationPickerCell` receives live data: `storageLocations` from `useStorageLocations()`, `getWineLocation(item.id)` returns the actual assigned `StorageLocation | null`, and `assignWineToLocation`/`removeWineFromLocation` are the real mutation functions.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. The `onAssign` callback delegates to the same `assignWineToLocation` function used by the previous select-based approach.

## Self-Check: PASSED

- [x] `apps/web/src/pages/Inventory.tsx` modified and committed at `c821c8f`
- [x] `grep -c "LocationPickerCell" apps/web/src/pages/Inventory.tsx` = 2 (import + usage)
- [x] `grep -c "editingLocationItemId" apps/web/src/pages/Inventory.tsx` = 0
- [x] TypeScript: zero errors in Inventory.tsx or LocationPickerCell
