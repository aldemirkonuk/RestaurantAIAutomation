---
phase: 34-order-communications-hub-procurement-integrity
plan: "01"
subsystem: frontend/orders
tags: [procurement-integrity, side-effect-removal, calendar, inventory, orders]
dependency_graph:
  requires: [Phase 32 approveDraft backend]
  provides: [clean order creation — no premature inventory/calendar writes]
  affects: [handleContactProviders, procurement state machine]
tech_stack:
  added: []
  patterns: [surgical code removal, procurement state machine enforcement]
key_files:
  created: []
  modified:
    - apps/web/src/pages/Orders.tsx
decisions:
  - "createInventoryItem call preserved (stockLive:0 row only — not a stock_live mutation)"
  - "dispatchInventoryUpdate removed from handleContactProviders; kept in handleMarkAsOrdered (lines 554, 587)"
  - "approveDraft (procurement.service.ts:853) confirmed as sole calendar event creator"
  - "Pre-existing TS errors (order_number, recurrence) documented as out-of-scope deferred items"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-17"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 34 Plan 01: Remove Premature Side-Effect Blocks from handleContactProviders Summary

**One-liner:** Surgically removed 3 premature frontend side-effect blocks (inventory cache dispatch, calendar SSE dispatch, calendar DB insert) from handleContactProviders so order creation is a clean record-only operation — inventory and calendar writes now deferred exclusively to approveDraft backend.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Remove 3 premature side-effect blocks + clean unused imports/declarations | ed99aca | apps/web/src/pages/Orders.tsx |

## What Was Done

Six targeted edits applied to `apps/web/src/pages/Orders.tsx` in order to avoid line-number drift:

1. **Edit 1 — Import cleanup:** Removed `useCreateCalendarEvent` from `import { useWinesByIds, useCreateCalendarEvent } from '../hooks/queries'` → `import { useWinesByIds } from '../hooks/queries'`

2. **Edit 2 — Destructure cleanup:** Removed `dispatchCalendarEvent` from `useRealtimeDispatch()` destructure. `dispatchOrderUpdate` and `dispatchInventoryUpdate` kept (both still used in other handlers).

3. **Edit 3 — Hook declaration removed:** Deleted `const createCalendarEvent = useCreateCalendarEvent()` (line 265).

4. **Edit 4 — Variable removed:** Deleted `let inventoryJustCreated = false` tracking variable.

5. **Edit 5 — Assignment removed:** Deleted `inventoryJustCreated = true` inside the try block after `createInventoryItem` succeeds.

6. **Edit 6 — Block A + B+C removed:**
   - **Block A** (fire-and-forget): Entire `if (inventoryJustCreated && inventoryItem) { dispatchInventoryUpdate({type:'add'}) }` block removed including comment header.
   - **Block B** (SSE calendar dispatch): `const deliveryDate` + `dispatchCalendarEvent({...})` call removed.
   - **Block C** (DB calendar insert): `if (user?.restaurantId) { createCalendarEvent.mutateAsync({...}) }` with empty catch/else blocks removed.

## Verification Results

All done criteria passed:

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -c "dispatchCalendarEvent" Orders.tsx` | 0 | 0 ✓ |
| `grep -c "createCalendarEvent" Orders.tsx` | 0 | 0 ✓ |
| `grep -c "inventoryJustCreated" Orders.tsx` | 0 | 0 ✓ |
| `grep -c "useCreateCalendarEvent" Orders.tsx` | 0 | 0 ✓ |
| `grep -c "createInventoryItem" Orders.tsx` | ≥ 1 | 2 ✓ |
| `grep -c "dispatchInventoryUpdate" Orders.tsx` | ≥ 1 | 3 ✓ |
| `grep -c "dispatchOrderUpdate" Orders.tsx` | ≥ 1 | 4 ✓ |

TypeScript: no new errors introduced by these changes. Pre-existing errors on `order_number` (line 1018) and `recurrence` (lines 1443, 1908-1909, 2275-2276) are unrelated type gaps in untouched code sections — deferred.

## Deviations from Plan

None — plan executed exactly as written. All 6 edits applied in specified order.

## Threat Mitigation Verification

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-34-01-01 | mitigate | ✓ All 3 blocks removed; grep gates confirm 0 occurrences |
| T-34-01-02 | mitigate | ✓ dispatchCalendarEvent removed from handleContactProviders; approveDraft remains sole calendar path |
| T-34-01-03 | mitigate | ✓ dispatchInventoryUpdate({type:'add'}) removed from order creation; cache stays clean until server-driven refetch |

## Known Stubs

None introduced by this plan. No placeholder data or TODO markers added.

## Threat Flags

None. This plan only removed frontend side-effect code. No new network endpoints, auth paths, file access patterns, or schema changes were introduced.

## Deferred Items

Pre-existing TypeScript type errors in Orders.tsx (unrelated to this plan's changes):
- `order_number` property missing on `Order` type (line 1018)
- `recurrence` property missing on `Order` type (lines 1443, 1908, 1909, 2275, 2276)

These predate Phase 34 and are out of scope for this plan.

## Self-Check: PASSED

- [x] `apps/web/src/pages/Orders.tsx` exists and modified
- [x] Commit `ed99aca` exists: `git log --oneline | grep ed99aca`
- [x] All grep done criteria verified (0/0/0/0 for removed, 2/3/4 for kept)
