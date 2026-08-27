---
phase: 16-auto-locate-wines-storage-intelligence
plan: "02"
subsystem: frontend/inventory
tags: [component, ui, storage-locations, inventory]
dependency_graph:
  requires:
    - useStorageLocations hook (StorageLocation type, assignWineToLocation, removeWineFromLocation)
  provides:
    - LocationPickerCell component (consumed by Plan 03 Inventory.tsx wire-in)
  affects:
    - apps/web/src/components/inventory/
tech_stack:
  added: []
  patterns:
    - React controlled component with local isOpen/isLoading state
    - useRef + useEffect mousedown click-outside pattern
    - Lucide icons (MapPin, ChevronDown, Loader2, X, Check)
    - Tailwind utility classes matching existing inventory component conventions
key_files:
  created:
    - apps/web/src/components/inventory/LocationPickerCell.tsx
  modified: []
decisions:
  - "wineId prop kept in interface for explicitness even though parent passes pre-bound callbacks"
  - "isLoading is synchronous fire-and-forget (onAssign/onRemove are void); optimistic React Query update makes UI feel instant"
  - "Check icon added alongside font-semibold for selected location — better visual clarity than semibold alone"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-08"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 16 Plan 02: LocationPickerCell Component Summary

**One-liner:** Self-contained wine→location picker with pill badge, dashed placeholder, capacity-aware dropdown, and click-outside dismissal using Lucide icons and Tailwind.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Create LocationPickerCell.tsx component | c10262f | apps/web/src/components/inventory/LocationPickerCell.tsx |

## What Was Built

`LocationPickerCell.tsx` is a fully self-contained React component that replaces the existing `<select>` element in the Inventory table. It has four render states:

1. **Pill badge (assigned):** Colored dot matching `StorageLocation.color` + location name + ChevronDown icon. Rounded-full, white background, subtle shadow.
2. **Dashed placeholder (unassigned):** MapPin icon + "Assign location" text, dashed border — invites interaction.
3. **Loading state:** Loader2 spinner + "Saving..." text — shown while `isLoading` is true (synchronous fire-and-forget mutation).
4. **Dropdown (open):** Lists all locations with `{currentCount}/{capacity}` counts. Full locations have a red "Full" badge and are disabled (`opacity-50 cursor-not-allowed`). Currently-selected location shows a green Check icon + `font-semibold`. "Remove assignment" option at the bottom (only when a location is assigned).

**Click-outside:** `useRef<HTMLDivElement>` + `useEffect` with `mousedown` listener closes the dropdown when clicking outside.

**Props interface:**
```typescript
interface LocationPickerCellProps {
  wineId: string           // kept for interface clarity; parent passes pre-bound callbacks
  quantity: number
  locations: StorageLocation[]
  currentLocation: StorageLocation | null
  onAssign: (locationId: string, quantity: number) => void
  onRemove: () => void
}
```

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

One minor addition: imported `Check` from lucide-react to render a green checkmark alongside `font-semibold` for the currently-selected location in the dropdown. This was a quality improvement over semibold-only text for visual clarity. Not a deviation from plan intent.

## Known Stubs

None — component is fully implemented. `wineId` prop is unused inside the component body (renamed to `_wineId` with underscore prefix to suppress TypeScript unused-variable warning while keeping it in the public interface). The parent will pass pre-bound `onAssign`/`onRemove` callbacks when wiring in Plan 03.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| None | — | No new network endpoints or auth paths introduced. Client-side only component. |

The `isFull` capacity guard (T-16-02-01) is implemented: `loc.currentCount >= loc.capacity` disables selection at the UI level. Server enforces via upsert constraint.

## Self-Check: PASSED

- `apps/web/src/components/inventory/LocationPickerCell.tsx` — FOUND
- Commit `c10262f` — FOUND (`git log --oneline` confirms)
- `npx tsc --noEmit` — no errors for LocationPickerCell
- All acceptance criteria met:
  - `export function LocationPickerCell` ✅
  - `isFull` appears 3 times (definition + 2 usages) ✅
  - `Loader2` imported and used ✅
  - `Remove assignment` present ✅
  - `mousedown` click-outside handler present ✅
  - Zero TypeScript errors ✅
