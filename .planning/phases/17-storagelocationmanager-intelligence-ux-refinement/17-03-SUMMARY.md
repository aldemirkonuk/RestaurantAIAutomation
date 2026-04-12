---
phase: 17-storagelocationmanager-intelligence-ux-refinement
plan: "03"
subsystem: inventory-ui
tags: [ux, storage-locations, auto-locate, modal-refactor]
dependency_graph:
  requires: [17-01, 17-02]
  provides: [contextual-auto-locate-in-slm-footer]
  affects: [apps/web/src/components/inventory/StorageLocationManager.tsx, apps/web/src/pages/Inventory.tsx]
tech_stack:
  added: []
  patterns: [optional-callback-prop, conditional-render, modal-close-on-action]
key_files:
  modified:
    - apps/web/src/components/inventory/StorageLocationManager.tsx
    - apps/web/src/pages/Inventory.tsx
decisions:
  - "Auto-Locate button calls onClose() alongside onAutoLocate() so StorageLocationManager closes before AutoLocatePreviewModal opens — avoids two stacked modals"
  - "Zap import removed from Inventory.tsx (no longer needed there after button removal)"
metrics:
  duration: ~5 minutes
  completed: "2026-04-08"
---

# Phase 17 Plan 03: Move Auto-Locate Button to StorageLocationManager Footer Summary

**One-liner:** Relocated Auto-Locate from Inventory toolbar into StorageLocationManager modal footer via `onAutoLocate` optional callback prop.

## What Was Built

- `onAutoLocate?: () => void` added to `StorageLocationManagerProps` interface
- `Zap` icon added to lucide-react import in `StorageLocationManager.tsx`
- Auto-Locate button rendered conditionally in the modal footer when `onAutoLocate` prop is provided (emerald-600 styling, Zap icon, calls both `onAutoLocate()` and `onClose()`)
- Auto-Locate button block removed from Inventory.tsx toolbar (including comment)
- `Zap` import removed from Inventory.tsx (unused after removal)
- `onAutoLocate={handleAutoLocate}` wired to the `StorageLocationManager` JSX in Inventory.tsx

## Tasks

| # | Name | Status | Commit |
|---|------|--------|--------|
| 1 | Add onAutoLocate prop to StorageLocationManager + render button in footer | ✅ Complete | `67568e5` |
| 2 | Remove Auto-Locate button from Inventory toolbar + wire onAutoLocate prop | ✅ Complete | `779a9dc` |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — changes are purely UI/prop wiring with no new network endpoints or security-relevant surfaces.

## Self-Check: PASSED

- `apps/web/src/components/inventory/StorageLocationManager.tsx` — modified and committed at `67568e5`
- `apps/web/src/pages/Inventory.tsx` — modified and committed at `779a9dc`
- `grep -n "onAutoLocate" apps/web/src/components/inventory/StorageLocationManager.tsx` → 4+ matches ✅
- `grep -n "Zap" apps/web/src/components/inventory/StorageLocationManager.tsx` → import + JSX usage ✅
- `grep -c "Auto-Locate Button" apps/web/src/pages/Inventory.tsx` → 0 ✅
- `grep -n "onAutoLocate" apps/web/src/pages/Inventory.tsx` → 1 match (prop wired) ✅
- TypeScript: zero new errors introduced by these changes ✅
