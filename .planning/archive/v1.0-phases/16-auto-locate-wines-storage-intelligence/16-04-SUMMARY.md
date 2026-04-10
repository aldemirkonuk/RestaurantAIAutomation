---
phase: 16-auto-locate-wines-storage-intelligence
plan: "04"
subsystem: frontend/inventory
tags: [auto-locate, scoring-engine, modal, typescript]
dependency_graph:
  requires:
    - 16-01 (useStorageLocations types — StorageLocation, WineLocationMapping)
    - 16-02 (LocationPickerCell — same inventory component directory)
  provides:
    - computeAutoLocatePlan pure scoring function
    - AutoLocatePreviewModal component
  affects:
    - 16-05 (will wire autoLocateEngine + AutoLocatePreviewModal into Inventory.tsx)
tech_stack:
  added: []
  patterns:
    - Pure TypeScript scoring engine (no React, no hooks, fully testable in isolation)
    - Composite scoring (4 signals, 100pt max)
    - Greedy capacity-aware allocation with running count tracker
    - framer-motion AnimatePresence modal animation
    - Type-only imports (import type)
key_files:
  created:
    - apps/web/src/lib/autoLocateEngine.ts
    - apps/web/src/components/inventory/AutoLocatePreviewModal.tsx
  modified: []
decisions:
  - "Import InventoryItem directly from ../pages/inventory/useInventoryPage (not the index.tsx re-export) — TS2724 was thrown when using the barrel export path"
  - "accessibility signal includes 'rack' keyword per critical_scoring_spec in addition to bar/floor/service"
metrics:
  duration_minutes: 12
  completed_date: "2026-04-08"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
---

# Phase 16 Plan 04: Auto-Locate Engine + Preview Modal Summary

**One-liner:** Pure 4-signal composite scoring engine (temperature/type/capacity/accessibility, 100pt max) with operator review modal (per-row checkbox, location override dropdown, score badge, animated framer-motion shell).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create autoLocateEngine.ts — pure scoring engine | a2892b6 | apps/web/src/lib/autoLocateEngine.ts |
| 2 | Create AutoLocatePreviewModal.tsx — review modal | 9b3c969 | apps/web/src/components/inventory/AutoLocatePreviewModal.tsx |

## What Was Built

### autoLocateEngine.ts

Pure TypeScript module (no React, no hooks). Exports:

- `WineInput` — extends `InventoryItem` with optional `salesVelocity?: number` placeholder
- `WineLocationScore` — per-wine assignment result (wineId, wineName, wineType, locationId, locationName, locationColor, score, reasons[], quantity)
- `AutoLocateOptions` — `{ skipAssigned?: boolean }` (default `true`)
- `AutoLocateResult` — `{ assignments: WineLocationScore[], skipped: WineInput[] }`
- `computeAutoLocatePlan(wines, locations, mappings, options)` — main exported function

**Scoring algorithm (4 signals, 100pt max):**

| Signal | Max | Logic |
|--------|-----|-------|
| Temperature match | +40 | parseTempF() regex → °F/°C → compare against wine type range |
| Wine type grouping | +30/+15 | 50%+ same-type wines in location → +30; location name contains type → +15 |
| Capacity availability | +20 | Math.round((available/capacity) * 20); skip if full |
| Accessibility | +10 | name includes bar/floor/service/rack AND saleType is glass/both |

`parseTempF()` handles `"55°F"`, `"13°C"`, empty string, and `undefined` without crashing.

Greedy allocation: candidates scored vs all non-full locations → highest scorer wins → `runningCount[locationId] += wineQty` → sort output descending by score.

`salesVelocity` placeholder: field in `WineInput` + commented-out scoring block with `// FUTURE:` comment.

### AutoLocatePreviewModal.tsx

React component with framer-motion `AnimatePresence` backdrop + panel animation (same pattern as ManualOverrideModal).

**Props:** `isOpen`, `onClose`, `result: AutoLocateResult`, `allLocations: StorageLocation[]`, `includeAssigned: boolean`, `onToggleIncludeAssigned: (val: boolean) => void`, `onConfirm: (selected: WineLocationScore[]) => void`

**Features:**
- Summary stats header: "N wines to assign · M locations utilized · K skipped (no valid match)"
- "Include already-assigned wines" toggle — passes state to parent via `onToggleIncludeAssigned`
- Full table: select-all header checkbox, per-row checkbox, wine name+type, location override `<select>` dropdown, score badge (green ≥70 / amber ≥40 / gray <40), reasons column
- Deselected rows visually dimmed (opacity-60)
- "Confirm Selected (N)" button (disabled when 0 selected) calls `onConfirm` with checked rows only
- Cancel button

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed InventoryItem import path**
- **Found during:** Task 1 verification (tsc)
- **Issue:** `import type { InventoryItem } from '../pages/inventory'` threw TS2724 — barrel re-export via `export type { ... }` in index.tsx was not resolving
- **Fix:** Changed import to `'../pages/inventory/useInventoryPage'` (direct source file)
- **Files modified:** apps/web/src/lib/autoLocateEngine.ts
- **Commit:** a2892b6

**2. [Rule 2 - Critical] Added 'rack' to accessibility keywords**
- **Found during:** Task 1 implementation (comparing CONTEXT.md vs PLAN.md interfaces vs critical_scoring_spec)
- **Issue:** The `<critical_scoring_spec>` in the task prompt explicitly listed 'rack' as an accessibility keyword alongside bar/floor/service, matching the D5 decision in CONTEXT.md
- **Fix:** Added `'rack'` to `accessKeywords` array in Signal 4
- **Files modified:** apps/web/src/lib/autoLocateEngine.ts

## Known Stubs

None — both files are complete implementations. No hardcoded empty values or placeholder data flows to UI rendering. The `salesVelocity` field is an intentional placeholder documented in D6 (CONTEXT.md); it does not affect scoring and is not displayed in the UI.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Engine runs entirely client-side on already-fetched data. Modal is display-only; location dropdown is bounded to the `allLocations` prop (cannot inject arbitrary locationId).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| apps/web/src/lib/autoLocateEngine.ts | FOUND |
| apps/web/src/components/inventory/AutoLocatePreviewModal.tsx | FOUND |
| .planning/phases/16-auto-locate-wines-storage-intelligence/16-04-SUMMARY.md | FOUND |
| commit a2892b6 (autoLocateEngine.ts) | CONFIRMED |
| commit 9b3c969 (AutoLocatePreviewModal.tsx) | CONFIRMED |
