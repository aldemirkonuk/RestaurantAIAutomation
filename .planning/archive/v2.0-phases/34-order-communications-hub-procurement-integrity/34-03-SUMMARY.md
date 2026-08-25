---
phase: 34-order-communications-hub-procurement-integrity
plan: "03"
subsystem: frontend/orders
tags: [procurement, active-conversations, draft-review, orders-ui, panel, badge]
dependency_graph:
  requires:
    - 34-01 (Orders.tsx clean state — no premature side effects)
    - 34-02 (GET /procurement/conversations/active backend endpoint)
  provides:
    - Active Conversations slide-in panel (indigo-900, 480px)
    - useActiveConversations hook polling active drafts every 30s
    - activeConversationKeys query key factory + invalidation in approve/discard mutations
    - "AI Draft Ready" indigo pill badge on order rows
    - activeDraftsCount badge on Pending KPI card in OrderSummary
  affects:
    - apps/web/src/hooks/queries/useDraftEmailQueries.ts
    - apps/web/src/components/orders/ActiveConversationsPanel.tsx
    - apps/web/src/pages/Orders.tsx
    - apps/web/src/pages/orders/OrderSummary.tsx
tech_stack:
  added: []
  patterns:
    - framer-motion AnimatePresence + spring slide-from-right (matching DraftEmailApprovalPanel)
    - TanStack Query polling with staleTime/refetchInterval
    - useMemo Set derivation for O(1) badge lookup
    - e.stopPropagation() on nested interactive elements inside clickable cards
key_files:
  created:
    - apps/web/src/components/orders/ActiveConversationsPanel.tsx
  modified:
    - apps/web/src/hooks/queries/useDraftEmailQueries.ts
    - apps/web/src/pages/Orders.tsx
    - apps/web/src/pages/orders/OrderSummary.tsx
decisions:
  - "Quick Approve from ActiveConversationsPanel calls existing useApproveDraft.mutate (same backend path as DraftEmailApprovalPanel — T-34-03-02 accepted)"
  - "refetchInterval: 30_000 — conservative polling; stops on unmount (T-34-03-03 accepted)"
  - "pendingDraftOrderIds derived as useMemo Set for O(1) has() lookups on order badge render"
  - "Badge click opens DraftEmailApprovalPanel pre-populated from activeConversations data (conv.draftContent satisfies WARN-01)"
  - "AI Draft Ready badge added to both list view and grouped view order cards for complete coverage"
metrics:
  duration: "~4 minutes"
  completed: "2026-05-17"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
  files_created: 1
---

# Phase 34 Plan 03: Active Conversations Panel + AI Draft Ready Badge Summary

**One-liner:** Slide-in indigo-900 Active Conversations panel surfacing PENDING_APPROVAL AI draft emails directly from the orders list, with per-card Quick Approve/Discard/View actions, 24h stale warnings, and "AI Draft Ready" pill badges on order rows.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | activeConversationKeys + useActiveConversations hook + invalidation updates | `b3c8dfc` | useDraftEmailQueries.ts |
| 2 | ActiveConversationsPanel + Orders.tsx wiring + OrderSummary badge props | `32eb55b` | ActiveConversationsPanel.tsx, Orders.tsx, OrderSummary.tsx |

## What Was Built

### Task 1: useDraftEmailQueries.ts Additions

**`activeConversationKeys`** — Query key factory:
```typescript
export const activeConversationKeys = {
  all: ['conversations', 'active'] as const,
  list: (restaurantId: string) => [...activeConversationKeys.all, restaurantId] as const,
}
```

**`ActiveConversationDto`** — Interface matching backend DTO from 34-02 (including `draftContent` for WARN-01 pre-population).

**`useActiveConversations`** — Hook polling `GET /procurement/conversations/active` every 30s (`staleTime: 15_000`, `refetchInterval: 30_000`), scoped by `user.restaurantId` from `useAuth()`.

**Invalidation updates** — Both `useApproveDraft.onSettled` and `useDiscardDraft.onSettled` now also call `queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })`, ensuring the panel refreshes after approve/discard (mitigates T-34-03-01).

### Task 2: Component + Wiring

**`ActiveConversationsPanel.tsx`** — New 480px right-side slide-in panel:
- Dark indigo-900 background with `framer-motion` `AnimatePresence` + `spring` animation (stiffness: 300, damping: 30)
- Semi-transparent black backdrop (opacity: 0.3) that closes panel on click
- Per-card layout: wine name, provider, email type badge, quantity, draft age
- `formatDraftAge()` pure helper — computes label ("just now", "X min ago", "X hrs ago") + `isStale` flag (≥24h)
- Stale drafts: amber `bg-amber-900/30 border-amber-600/40` card, AlertTriangle icon, "Stale — review now" text
- Three actions per card: View Full Draft (indigo), Quick Approve (emerald), Discard (red/60)
- Footer: `N active drafts — oldest from {date}`
- Empty state: CheckCircle icon + "No pending drafts / All AI emails have been reviewed"

**`Orders.tsx` changes:**
- Import `ActiveConversationsPanel` and `useActiveConversations` / `ActiveConversationDto`
- `isActiveConvPanelOpen` state + `useActiveConversations()` hook
- `pendingDraftOrderIds` — `useMemo` Set for O(1) badge lookup
- `<OrderSummary>` receives `activeDraftsCount` and `onActiveDraftsClick` props
- `<ActiveConversationsPanel>` rendered after `<DraftEmailApprovalPanel>` with full prop wiring
- `onViewDraft` pre-populates `DraftEmailApprovalPanel` from `conv.draftContent` (WARN-01 satisfied) and closes ActiveConversationsPanel
- "AI Draft Ready" badge added to **both** list-view order cards (with full recurrence badge row) and grouped-view order cards
- Badge `onClick`: calls `e.stopPropagation()` → finds conversation by `order.order_id` → pre-populates and opens `DraftEmailApprovalPanel`

**`OrderSummary.tsx` changes:**
- Added `activeDraftsCount: number` and `onActiveDraftsClick: () => void` to `OrderSummaryProps` interface and destructuring
- Added conditional badge button inside Pending KPI card: indigo pill with dot, "N draft(s) ready", `e.stopPropagation()` so the card's filter-toggle click doesn't fire

## Deviations from Plan

None — plan executed exactly as written. All must_haves satisfied, all key_links wired.

## Verification Results

| Check | Result |
|-------|--------|
| `ActiveConversationsPanel.tsx` exists | ✓ |
| `activeConversationKeys` in useDraftEmailQueries.ts ≥ 3 | ✓ (5 occurrences) |
| `useActiveConversations` in useDraftEmailQueries.ts ≥ 1 | ✓ (1) |
| `ActiveConversationDto` in useDraftEmailQueries.ts ≥ 1 | ✓ (2) |
| Both useApproveDraft + useDiscardDraft invalidate activeConversationKeys.all | ✓ (lines 75, 90) |
| `isActiveConvPanelOpen` in Orders.tsx ≥ 2 | ✓ (2) |
| `activeDraftsCount` in OrderSummary.tsx ≥ 2 | ✓ (4) |
| `pendingDraftOrderIds` in Orders.tsx ≥ 2 | ✓ (3) |
| `setIsDraftPanelOpen` in Orders.tsx ≥ 2 | ✓ (9) |
| `activeConversations.find` in Orders.tsx ≥ 1 | ✓ (2 — list + grouped) |
| TypeScript: no new errors introduced | ✓ (pre-existing recurrence/order_number errors only — deferred in 34-01) |

## Threat Mitigation Verification

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-34-03-01 | mitigate | ✓ Both useApproveDraft.onSettled AND useDiscardDraft.onSettled invalidate activeConversationKeys.all |
| T-34-03-02 | accept | ✓ Quick Approve calls existing useApproveDraft mutation — same backend path as DraftEmailApprovalPanel |
| T-34-03-03 | accept | ✓ refetchInterval: 30_000 (conservative); polling stops on unmount |

## Known Stubs

None — `useActiveConversations` fetches real data from `GET /procurement/conversations/active` (implemented in 34-02). All panel props receive live query data. No placeholder text or empty data sources.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. Reuses existing procurement endpoints and mutation hooks.

## Self-Check: PASSED

- [x] `apps/web/src/components/orders/ActiveConversationsPanel.tsx` exists ✓
- [x] `apps/web/src/hooks/queries/useDraftEmailQueries.ts` modified ✓
- [x] `apps/web/src/pages/Orders.tsx` modified ✓
- [x] `apps/web/src/pages/orders/OrderSummary.tsx` modified ✓
- [x] Commit `b3c8dfc` exists ✓
- [x] Commit `32eb55b` exists ✓
- [x] All done criteria for Task 1 verified ✓
- [x] All done criteria for Task 2 verified ✓
- [x] No STATE.md or ROADMAP.md modifications made ✓
