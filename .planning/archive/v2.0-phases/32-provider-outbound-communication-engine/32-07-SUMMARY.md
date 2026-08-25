---
phase: 32-provider-outbound-communication-engine
plan: "07"
subsystem: frontend-pages
tags: [intel-badge, draft-approval, realtime, provider-profile, orders]
dependency_graph:
  requires: [32-05]
  provides: [IntelBadge pills in Providers page, DraftEmailApprovalPanel wired in Orders page]
  affects: [apps/web/src/pages/Providers.tsx, apps/web/src/pages/Orders.tsx]
tech_stack:
  added: []
  patterns: [window-event-listener for draft_ready, React Query mutation hooks, dynamic component overlay]
key_files:
  created: []
  modified:
    - apps/web/src/pages/Providers.tsx
    - apps/web/src/pages/Orders.tsx
    - apps/web/src/services/api/providers.ts
decisions:
  - "Used window.addEventListener('notification_sent') for draft_ready detection — matches existing WebSocket bridge dispatch pattern (not Supabase Realtime)"
  - "Added profile_foundational/profile_dynamic to shared Provider interface in providers.ts rather than local augment"
  - "IntelBadge pills placed between TypeBadge and star-rating in grid card to keep badge density manageable"
metrics:
  duration: ~12 minutes
  completed: "2026-05-14"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 32 Plan 07: Page Wiring — IntelBadge + DraftEmailApprovalPanel Summary

IntelBadge pills + ProviderProfileForm overlay wired into Providers.tsx; draft_ready notification listener + DraftEmailApprovalPanel wired into Orders.tsx using the Socket.IO / window-event bridge pattern.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Modify Providers.tsx — IntelBadge + ProviderProfileForm overlay | f825cfb | apps/web/src/pages/Providers.tsx, apps/web/src/services/api/providers.ts |
| 2 | Modify Orders.tsx — draft_ready listener + DraftEmailApprovalPanel | f96d2cf | apps/web/src/pages/Orders.tsx |

## What Was Built

### Task 1 — Providers.tsx

- Added `profile_foundational?: Record<string, any>` and `profile_dynamic?: Record<string, any>` to the shared `Provider` interface in `services/api/providers.ts`.
- Added `IntelBadge` component (dot-badge style, matching TypeBadge visual language) with colour mappings for `response_speed` (green), `negotiation_style` (amber), `relationship_tier` (rose), and a gray fallback.
- Added `getTopIntelDimensions()` helper that filters `profile_dynamic` by priority keys and returns up to 3 formatted badge objects.
- Added `profileFormProviderId` state and `queryClient` hook in the `Providers` component.
- In the grid card, IntelBadge pills render below the TypeBadge when `provider.profile_dynamic` has keys.
- "Fill intelligence profile" button (indigo underline CTA) renders when `profile_foundational` is absent/empty.
- `ProviderProfileForm` overlay (z-[110]) opens on CTA click; on save, closes and calls `queryClient.invalidateQueries({ queryKey: ['providers'] })` to refresh cards.
- Imported `ProviderProfileForm` from `'../components/providers/ProviderProfileForm'` and `useQueryClient` from `'@tanstack/react-query'`.

### Task 2 — Orders.tsx

- Imported `DraftEmailApprovalPanel` from `'../components/orders/DraftEmailApprovalPanel'`.
- Imported `useApproveDraft`, `useDiscardDraft` from `'../hooks/queries/useDraftEmailQueries'`.
- Added `draftPanelData` state (typed to match `DraftEmailData`) and `isDraftPanelOpen` boolean state.
- Added `approveDraftMutation` and `discardDraftMutation` React Query mutations.
- Added `useEffect` that subscribes to the `notification_sent` window event (dispatched by the WebSocket bridge in `websocket.tsx`); filters for `payload.type === 'draft_ready'`, fetches the pending draft from `GET /procurement/orders/:id/draft`, maps the API response into `draftPanelData`, and opens the panel.
- Rendered `DraftEmailApprovalPanel` with full approve/discard/close handlers:
  - `onApprove` calls `approveDraftMutation.mutateAsync` then closes + resets state.
  - `onDiscard` calls `discardDraftMutation.mutateAsync` then closes + resets state.
  - `isSubmitting` reflects either mutation's `isPending` state.

## Deviations from Plan

### Auto-adapted Implementation

**1. [Rule 1 - Adaptation] Socket.IO window-event pattern instead of Supabase Realtime**
- **Found during:** Task 2
- **Issue:** The plan offered two paths (Supabase Realtime INSERT or Socket.IO). The project uses a custom WebSocket system (see `RealtimeContext.tsx` architecture note). The backend dispatches `notification_sent` window events via `websocket.tsx` on `notification:new` socket events, and also via `RealtimeContext.tsx` on `event:new` events with `event_type: 'notification_sent'`.
- **Fix:** Used `window.addEventListener('notification_sent', ...)` listening for `detail.new.type === 'draft_ready'`, which intercepts both code paths.
- **Files modified:** apps/web/src/pages/Orders.tsx

## TypeScript Status

198 pre-existing TS errors in the codebase (tracked before this plan). Zero new errors introduced by plan 32-07 changes. Pre-existing errors in the modified files:
- `Orders.tsx`: `Property 'recurrence' does not exist on type 'Order'` (lines 1385, 1850, 1851, 2217, 2218) — pre-existing
- `Providers.tsx`: `ProviderUpdatePayload` type mismatch, `NewProviderData.accountNumber`, `primaryBusinessType` string widening — pre-existing

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-32-07-01 | Accepted — notification metadata carries only orderId; actual draft content fetched via JWT-authenticated apiClient |
| T-32-07-02 | Mitigated — `modifiedContent` passed through `onApprove` → `approveDraftMutation` → stored before send |
| T-32-07-03 | Mitigated — PATCH /providers/:id/intelligence called via `ProviderProfileForm` which uses `apiClient` (JWT) |

## Known Stubs

None — both components (DraftEmailApprovalPanel, ProviderProfileForm) receive real data from API calls.

## Self-Check: PASSED

- `f825cfb` exists: ✓ (git log confirms)
- `f96d2cf` exists: ✓ (git log confirms)
- Providers.tsx grep counts: IntelBadge=2, getTopIntelDimensions=2, "Fill intelligence profile"=1, ProviderProfileForm=2, profileFormProviderId=3 ✓
- Orders.tsx grep counts: DraftEmailApprovalPanel=2, useApproveDraft=2, draft_ready=2, isDraftPanelOpen=2, draftPanelData=6 ✓
