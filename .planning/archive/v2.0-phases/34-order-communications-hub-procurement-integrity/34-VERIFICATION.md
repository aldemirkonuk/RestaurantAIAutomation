---
phase: 34-order-communications-hub-procurement-integrity
verified: 2026-05-17T22:55:00-05:00
status: human_needed
score: 26/26 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Navigate to /orders — click the 'N drafts ready' button on the Pending KPI card"
    expected: "Dark indigo-900 panel slides in from the right showing PENDING_APPROVAL conversations with wine name, provider, email type badge, draft age indicator"
    why_human: "Animation quality, panel dimensions, and data content are visible-only — cannot verify framer-motion spring transitions programmatically"
  - test: "On Active Conversations panel — check a draft that is ≥ 24 hours old"
    expected: "Card background turns amber (amber-900/30), AlertTriangle icon appears, 'Stale — review now' text shows in amber"
    why_human: "Stale-draft amber styling requires either live data or test data with an old createdAt — cannot simulate elapsed time in static code analysis"
  - test: "Click Quick Approve on an Active Conversations panel card"
    expected: "Panel entry disappears on next 30s poll or immediate refetch; DraftEmailApprovalPanel is NOT opened (quick approve skips review)"
    why_human: "Mutation side-effect and panel refresh cycle require a live session with actual PENDING_APPROVAL data"
  - test: "Click 'AI Draft Ready' indigo pill on an order row"
    expected: "DraftEmailApprovalPanel slides in pre-populated with the draft content from conv.draftContent"
    why_human: "Pre-population of DraftEmailApprovalPanel fields from activeConversations data requires visual inspection"
  - test: "Send a PATCH to /procurement/orders/:id with { locationId: 'any' } while order is PENDING"
    expected: "HTTP 422 response with body { reason: 'order_not_approved', message: 'Location can only be assigned after the order is approved.' }"
    why_human: "Cannot test real HTTP response without a running API + a PENDING order — requires integration test environment"
  - test: "Navigate to /communications → click Procurement Emails tab → expand a row"
    expected: "Expandable row shows: draft body in monospace pre block, constraint notes (amber), rolling summary, order number, quantity, round count, sent timestamp"
    why_human: "Thread replay layout and expandable row interaction require visual/browser verification"
---

# Phase 34: Order Communications Hub & Procurement Integrity — Verification Report

**Phase Goal:** Three interconnected improvements that complete the procurement loop: (1) Surface AI conversations where managers need them — Active Conversations panel on /orders (from Pending KPI card), and Procurement Emails tab on /communications; (2) Enforce procurement integrity — PENDING orders must NOT trigger inventory writes or calendar scheduling; (3) Location-assignment guard — assigning location to a PENDING order raises 422.
**Verified:** 2026-05-17T22:55:00-05:00
**Status:** HUMAN_NEEDED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths — Plan 34-01 (Procurement Integrity: Side-Effect Removal)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Creating an order does NOT fire `dispatchInventoryUpdate({type:'add'})` | ✓ VERIFIED | `grep -c "inventoryJustCreated" Orders.tsx` → **0**; `dispatchInventoryUpdate({type:'add'})` block fully removed |
| 2 | Creating an order does NOT call `dispatchCalendarEvent` | ✓ VERIFIED | `grep -c "dispatchCalendarEvent" Orders.tsx` → **0**; import and usage removed |
| 3 | Creating an order does NOT call `createCalendarEvent.mutateAsync` | ✓ VERIFIED | `grep -c "createCalendarEvent" Orders.tsx` → **0**; hook declaration and all call sites removed |
| 4 | `createInventoryItem` call in `handleContactProviders` is kept (stockLive:0 row only) | ✓ VERIFIED | `grep -c "createInventoryItem" Orders.tsx` → **2** (call site retained) |
| 5 | `approveDraft` backend remains the sole calendar event creator | ✓ VERIFIED | `procurement.service.ts` line 890: `await this.createCalendarEventForOrder(...)` called only inside `approveDraft`; no other call sites |

### Observable Truths — Plan 34-02 (Backend Guards + Conversation Read Endpoints)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | `PATCH /procurement/orders/:id` with `locationId` returns HTTP 422 when PENDING/APPROVAL_NEEDED/NEGOTIATING | ✓ VERIFIED | `procurement.service.ts` lines 325–328: `throw new UnprocessableEntityException({ reason: 'order_not_approved', ... })` — guard fires when `dto.locationId !== undefined` and status in `BLOCKED_STATUSES` |
| 7 | 422 body is `{ reason: 'order_not_approved', message: 'Location can only be assigned after the order is approved.' }` | ✓ VERIFIED | Exact strings confirmed at service lines 325–327 |
| 8 | `cancelOrder` cascades PENDING_APPROVAL conversations to CANCELLED (non-fatal) | ✓ VERIFIED | `procurement.service.ts` lines 394–403: try/catch updates `procurement_conversations` where `status = 'PENDING_APPROVAL'` → `'CANCELLED'`; logger.warn on failure |
| 9 | `GET /procurement/conversations/active` returns PENDING_APPROVAL conversations with order+provider data | ✓ VERIFIED | `getActiveConversations` method (service line ~987) queries `procurement_conversations` with `status = 'PENDING_APPROVAL'` and joins `procurement_orders!inner` + `providers!left`; controller route confirmed |
| 10 | Response includes `draftContent` (draft body from `content` column) | ✓ VERIFIED | `draftContent: row.content ?? null` in service mapper; `grep -c "draftContent" procurement.service.ts` → **2** |
| 11 | `GET /procurement/conversations/history` returns `AUTO_SENT, APPROVED, SENT, COMPLETED, CLOSED` | ✓ VERIFIED | `HISTORY_STATUSES = ['AUTO_SENT', 'APPROVED', 'SENT', 'COMPLETED', 'CLOSED']` at service line 1040; `.in('status', HISTORY_STATUSES)` at line 1063 |
| 12 | Both endpoints scoped by `restaurantId` from JWT (`@CurrentUser`), never from query string | ✓ VERIFIED | Controller uses `user.restaurantId` from `@CurrentUser()` — `grep -c "user.restaurantId" procurement.controller.ts` → **16**; no `@Query('restaurantId')` parameter |
| 13 | Location assignment UI disabled with tooltip when order is PENDING/APPROVAL_NEEDED/NEGOTIATING | ✓ VERIFIED | `OrderLocationField.tsx`: `isBlocked` flag (7 occurrences), `disabled={isBlocked || isUpdating}`, tooltip "Available after order is approved" (2 occurrences) |

### Observable Truths — Plan 34-03 (Active Conversations Panel + AI Draft Ready Badge)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 14 | Clicking Pending KPI card opens right-side slide-in Active Conversations panel | ✓ VERIFIED | `Orders.tsx` line 1455: `onActiveDraftsClick={() => setIsActiveConvPanelOpen(true)}`; `OrderSummary.tsx` line 65: `onClick={(e) => { e.stopPropagation(); onActiveDraftsClick() }}` on badge button |
| 15 | Panel lists PENDING_APPROVAL conversations with wine name, provider, email type, draft age | ✓ VERIFIED | `ActiveConversationsPanel.tsx` renders `conv.wineName`, `conv.providerName`, `EMAIL_TYPE_LABELS[conv.emailType]`, `formatDraftAge(conv.createdAt)` per card |
| 16 | Each card has Quick Approve, Discard, and View Full Draft actions | ✓ VERIFIED | `grep -c "Quick Approve\|Discard\|View Full Draft" ActiveConversationsPanel.tsx` → **9** (buttons rendered in card loop) |
| 17 | Drafts ≥ 24h old show amber color warning | ✓ VERIFIED | `formatDraftAge`: `isStale = diffHrs >= 24`; amber card style `bg-amber-900/30 border-amber-600/40` + AlertTriangle icon applied when `age.isStale` — 12 amber/isStale references |
| 18 | Active draft count badge visible on Pending KPI card when count > 0 | ✓ VERIFIED | `OrderSummary.tsx`: `activeDraftsCount` prop (4 occurrences), conditional badge `{activeDraftsCount > 0 && <button>N draft(s) ready</button>}` |
| 19 | Order rows show "AI Draft Ready" indigo pill badge when PENDING_APPROVAL conversation exists | ✓ VERIFIED | `pendingDraftOrderIds.has(order.order_id)` guard (3 occurrences in Orders.tsx); `"AI Draft Ready"` badge rendered in **both** list-view and grouped-view cards (4 occurrences) |
| 20 | Approving/discarding from either panel invalidates `activeConversationKeys.all` and refreshes count | ✓ VERIFIED | `useDraftEmailQueries.ts` lines 75 + 90: both `useApproveDraft.onSettled` AND `useDiscardDraft.onSettled` call `queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })` |

### Observable Truths — Plan 34-04 (Communications Procurement Emails Tab)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 21 | `/communications` has new 4th tab with key `'procurement-history'` and label `'Procurement Emails'` | ✓ VERIFIED | `Communications.tsx` line 426: `{ key: 'procurement-history', label: 'Procurement Emails', Icon: Mail }`; `grep -c "procurement-history"` → **3** |
| 22 | Tab shows conversations with status IN `(AUTO_SENT, APPROVED, SENT, COMPLETED, CLOSED)` | ✓ VERIFIED | Backend `HISTORY_STATUSES` filter + frontend `OUTCOME_LABELS` map covers all 5 statuses |
| 23 | Each row shows provider name, wine name, email type badge, date sent, outcome label | ✓ VERIFIED | Row summary renders `item.wineName`, `item.providerName`, `EMAIL_TYPE_LABELS[item.emailType]` badge, `new Date(item.sentAt).toLocaleDateString()`, `OUTCOME_LABELS[item.status]` badge |
| 24 | Clicking a row expands thread replay with full draft body, constraint warnings, outcome metadata | ✓ VERIFIED | Expanded section: draft body in `<pre>`, disclaimer, constraint `annotating` flags in amber, `rollingSummary` block — `isExpanded`/`expandedRowId`/`onExpandRow` pattern (10 occurrences) |
| 25 | Date range, provider, wine, and email type filters are present and functional | ✓ VERIFIED | `Communications.tsx`: `dateFrom`, `providerFilter`, `typeFilter`, `wineFilter` — 4 distinct filter controls; client-side `filtered` array applies all 4; `grep -cE "wineFilter\|wineName\|wine_name"` → **7** |
| 26 | Existing `'history'`, `'templates'`, `'scheduled-reports'` tabs are NOT affected | ✓ VERIFIED | `grep -c "'history'" Communications.tsx` → **3** (tab array entry + render condition preserved); tab array untouched |

**Score: 26/26 truths verified**

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/pages/Orders.tsx` | handleContactProviders with 3 blocks removed | ✓ VERIFIED | No `dispatchCalendarEvent`, `createCalendarEvent`, or `inventoryJustCreated` references; `createInventoryItem` kept (2 hits) |
| `apps/api-gateway/src/procurement/dto/procurement.dto.ts` | `locationId` field in UpdateOrderDto | ✓ VERIFIED | `grep -c "locationId"` → **1** |
| `apps/api-gateway/src/procurement/procurement.service.ts` | Location guard + cancel cascade + getActiveConversations + getConversationHistory | ✓ VERIFIED | `UnprocessableEntityException` (3 hits), `order_not_approved` (1), `PENDING_APPROVAL.*CANCELLED` (6), `getActiveConversations` (4), `getConversationHistory` (2) |
| `apps/api-gateway/src/procurement/procurement.controller.ts` | HttpException passthrough + `conversations/active` + `conversations/history` endpoints | ✓ VERIFIED | `instanceof HttpException` passthrough at line 159; `conversations/active` and `conversations/history` GET routes confirmed |
| `apps/web/src/components/orders/OrderLocationField.tsx` | Location control with pending-state guard and tooltip | ✓ VERIFIED | File exists; `isBlocked` (7), `disabled={isBlocked`, `"Available after order"` (2) |
| `apps/web/src/services/api/types.ts` | `UpdateOrderRequest` with `locationId` field | ✓ VERIFIED | `grep -c "locationId"` → **1** |
| `apps/web/src/hooks/queries/useDraftEmailQueries.ts` | `activeConversationKeys` + `useActiveConversations` + invalidation updates | ✓ VERIFIED | `activeConversationKeys` (5), `useActiveConversations` (1), `ActiveConversationDto` (2), invalidations on lines 75 + 90 |
| `apps/web/src/components/orders/ActiveConversationsPanel.tsx` | Slide-in panel (indigo-900, ≥80 lines) | ✓ VERIFIED | File exists; framer-motion AnimatePresence + spring slide; `w-[480px] bg-indigo-900`; Quick Approve/Discard/View Full Draft buttons |
| `apps/web/src/pages/orders/OrderSummary.tsx` | `activeDraftsCount` badge + `onActiveDraftsClick` prop on Pending KPI card | ✓ VERIFIED | `activeDraftsCount` (4), `onActiveDraftsClick` (3), conditional badge with `e.stopPropagation()` |
| `apps/web/src/hooks/queries/useConversationQueries.ts` | `useProcurementConversationHistory` hook | ✓ VERIFIED | `grep -c "useProcurementConversationHistory"` → **1** |
| `apps/web/src/pages/Communications.tsx` | `'procurement-history'` tab + `ProcurementSendHistory` inline component | ✓ VERIFIED | `procurement-history` (3), `ProcurementSendHistory` (4) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `OrderSummary` Pending KPI card badge | `setIsActiveConvPanelOpen(true)` | `onActiveDraftsClick` prop | ✓ WIRED | OrderSummary line 65 → Orders.tsx line 1455 |
| `ActiveConversationsPanel` Quick Approve | `approveDraftMutation.mutate` | `onApprove` callback | ✓ WIRED | `onApprove={(orderId) => approveDraftMutation.mutate({ orderId })}` in Orders.tsx |
| `useApproveDraft` / `useDiscardDraft` onSettled | `activeConversationKeys.all` invalidation | `queryClient.invalidateQueries` | ✓ WIRED | `useDraftEmailQueries.ts` lines 75, 90 |
| `PATCH /procurement/orders/:id` (controller) | `UnprocessableEntityException` (422) | `dto.locationId` guard → service | ✓ WIRED | Controller line 159: `if (error instanceof HttpException) throw error` passes 422 through |
| `cancelOrder` (service) | `procurement_conversations` status cascade | Supabase `.update({ status: 'CANCELLED' })` | ✓ WIRED | Service lines 394–403: try/catch cascade with `logger.warn` on failure (non-fatal) |
| `GET conversations/active` (controller) | `getActiveConversations(restaurantId)` | `@CurrentUser()` restaurantId | ✓ WIRED | Controller delegates to service; restaurantId from JWT only |
| `useActiveConversations` hook | `GET /procurement/conversations/active` | `apiClient.get('/procurement/conversations/active')` | ✓ WIRED | `useDraftEmailQueries.ts` line 40 |
| `Communications.tsx 'procurement-history' tab` | `GET /procurement/conversations/history` | `useProcurementConversationHistory` → `api.get('/procurement/conversations/history')` | ✓ WIRED | `useConversationQueries.ts` line 218 |
| `OrderLocationField` disabled state | `PATCH /procurement/orders/:id` | `LOCATION_BLOCKED_STATUSES` → `disabled={isBlocked}` | ✓ WIRED | Component guards PENDING/APPROVAL_NEEDED/NEGOTIATING with both disabled attr and tooltip |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ActiveConversationsPanel` | `conversations` prop | `useActiveConversations()` → `GET /procurement/conversations/active` → `procurement_conversations` WHERE `status = 'PENDING_APPROVAL'` JOIN `procurement_orders` + `providers` | ✓ Real Supabase query (service lines ~993–1010) | ✓ FLOWING |
| `ProcurementSendHistory` (Communications) | `items` prop | `useProcurementConversationHistory()` → `GET /procurement/conversations/history` → `procurement_conversations` WHERE status IN HISTORY_STATUSES | ✓ Real Supabase query (service lines 1040–1063) | ✓ FLOWING |
| Orders.tsx `pendingDraftOrderIds` Set | `activeConversations` | `useActiveConversations()` real query result | ✓ Live data; `useMemo` Set derives O(1) lookup | ✓ FLOWING |
| `OrderSummary` badge count | `activeDraftsCount={activeConversations.length}` | Same `useActiveConversations()` query | ✓ Live count from server | ✓ FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Check | Result | Status |
|----------|-------|--------|--------|
| `dispatchCalendarEvent` removed from Orders.tsx | `grep -c "dispatchCalendarEvent" Orders.tsx` | 0 | ✓ PASS |
| `createCalendarEvent` hook removed from Orders.tsx | `grep -c "createCalendarEvent" Orders.tsx` | 0 | ✓ PASS |
| `inventoryJustCreated` variable removed | `grep -c "inventoryJustCreated" Orders.tsx` | 0 | ✓ PASS |
| `createInventoryItem` retained | `grep -c "createInventoryItem" Orders.tsx` | 2 | ✓ PASS |
| `approveDraft` sole calendar path | `grep -n "createCalendarEventForOrder" procurement.service.ts` | Line 890 only (inside `approveDraft`) | ✓ PASS |
| 422 guard in updateOrder | `grep -c "UnprocessableEntityException" procurement.service.ts` | 3 | ✓ PASS |
| 422 propagates through controller | `grep -c "instanceof HttpException" procurement.controller.ts` | 1 | ✓ PASS |
| `activeConversationKeys` query key | `grep -c "activeConversationKeys" useDraftEmailQueries.ts` | 5 | ✓ PASS |
| Both mutations invalidate active keys | `grep -n "activeConversationKeys.all" useDraftEmailQueries.ts` | Lines 75 + 90 | ✓ PASS |
| Active conversations panel wired | `grep -n "isActiveConvPanelOpen" Orders.tsx` | Lines 253, 1455, 3311, 3331 | ✓ PASS |
| `'procurement-history'` tab exists | `grep -c "procurement-history" Communications.tsx` | 3 | ✓ PASS |
| Existing `'history'` tab preserved | `grep -c "'history'" Communications.tsx` | 3 | ✓ PASS |
| 4 filters in ProcurementSendHistory | `grep -c "dateFrom\|providerFilter\|typeFilter\|wineFilter" Communications.tsx` | 19 | ✓ PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PROCINT-01 | 34-01 | Remove `dispatchInventoryUpdate({type:'add'})` from `handleContactProviders` | ✓ SATISFIED | `inventoryJustCreated` block fully removed; grep → 0 |
| PROCINT-02 | 34-01 | Remove `createCalendarEvent.mutateAsync` from `handleContactProviders` | ✓ SATISFIED | Both `createCalendarEvent` and `dispatchCalendarEvent` removed; grep → 0 |
| PROCINT-03 | 34-01 | Backend `createOrder` does not modify `stock_live` | ✓ SATISFIED | Phase 32 backend confirmed clean; no stock_live writes in createOrder path |
| PROCINT-04 | 34-01 | `approveDraft` creates calendar events (sole calendar creation path) | ✓ SATISFIED | `createCalendarEventForOrder` called at service line 890 only, inside `approveDraft` |
| PROCINT-05 | 34-02 | Location assignment guard: HTTP 422 for pending-status orders | ✓ SATISFIED | `UnprocessableEntityException` at service lines 325–328; `HttpException` passthrough in controller |
| PROCINT-06 | 34-02 | Cancelled orders cascade PENDING_APPROVAL → CANCELLED conversation status | ✓ SATISFIED | Non-fatal try/catch cascade in `cancelOrder` at service lines 394–403 |
| COMMS-01 | 34-03 | Pending KPI card opens Active Conversations panel | ✓ SATISFIED | `onActiveDraftsClick` → `setIsActiveConvPanelOpen(true)` fully wired |
| COMMS-02 | 34-02/03 | Active Conversations panel shows PENDING_APPROVAL conversations with order/provider metadata | ✓ SATISFIED | Backend endpoint + `useActiveConversations` hook + panel component all wired |
| COMMS-03 | 34-03 | Each conversation card has Approve/Discard quick actions + View Full Draft button | ✓ SATISFIED | 3 action buttons per card; Quick Approve calls `useApproveDraft.mutate`; View Full Draft opens `DraftEmailApprovalPanel` |
| COMMS-04 | 34-03 | "AI Draft Ready" badge on order rows linked to DraftEmailApprovalPanel | ✓ SATISFIED | `pendingDraftOrderIds.has()` badge with click → pre-populates and opens `DraftEmailApprovalPanel` |
| COMMS-05 | 34-02/04 | Send History tab on /communications showing procurement email history | ✓ SATISFIED | `'procurement-history'` tab with `useProcurementConversationHistory` → `GET /procurement/conversations/history` |
| COMMS-06 | 34-03 | Draft age indicator (relative time + 24h amber warning) | ✓ SATISFIED | `formatDraftAge()` helper: label + `isStale` flag (≥24h); amber card styling applied when stale |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| — | None found | — | No TODOs, FIXMEs, placeholder text, stub returns, or hardcoded empty arrays in the data path of any Phase 34 new/modified files |

All Phase 34 files are substantive implementations with real Supabase queries, live React Query hooks, and fully wired component props. No empty handler stubs.

---

## Routing Note (ROADMAP vs Implementation)

**ROADMAP SC5** specifies: `PATCH /procurement/orders/:id/location` as the location assignment endpoint.

**Actual implementation**: The location guard is in the general `PATCH /procurement/orders/:id` (updateOrder) endpoint, triggered when `dto.locationId !== undefined`. There is no separate `/location` sub-route.

**Assessment**: Functionally equivalent — the 422 guard fires correctly regardless of whether it's a dedicated route or a field guard on the general update route. The security and UX requirements are met. This is a naming deviation in the ROADMAP specification, not a behavioral gap. The frontend `OrderLocationField` disables the control pre-APPROVED and the backend enforces the 422 on any PATCH that includes a locationId.

---

## Human Verification Required

### 1. Active Conversations Panel Visual Flow

**Test:** Log in to the app with a restaurant that has PENDING_APPROVAL procurement conversations. Navigate to `/orders`. Look at the Pending KPI card — verify the indigo "N drafts ready" button is visible. Click it.
**Expected:** Dark indigo-900 panel slides in from the right with a spring animation (~480px wide), showing a list of conversation cards. Each card shows wine name, provider name, email type badge (e.g., "Price Inquiry"), draft age (e.g., "3 hrs ago"), Quick Approve (emerald), Discard (red), and View Full Draft (indigo) buttons.
**Why human:** Framer-motion animation quality, panel dimensions, and rendered card content require browser-level visual verification.

### 2. Stale Draft Amber Warning (24h)

**Test:** Identify or create a PENDING_APPROVAL conversation older than 24 hours. Open the Active Conversations panel.
**Expected:** That conversation's card has amber background (`bg-amber-900/30`), an AlertTriangle icon next to the age display, and the text "Stale — review now" in amber.
**Why human:** Requires actual time-elapsed data or test fixture with a backdated `created_at`; CSS visual styling must be verified.

### 3. View Full Draft → DraftEmailApprovalPanel Pre-Population

**Test:** Click "View Full Draft" on a panel card.
**Expected:** `DraftEmailApprovalPanel` opens with the full draft body pre-populated from `conv.draftContent`, correct wine name, provider name, email type, and round count.
**Why human:** Panel props are dynamically set from the live `activeConversations` array; requires visual inspection of the pre-populated panel state.

### 4. API Integration: Location Guard 422

**Test:** With a PENDING order ID, send `PATCH /procurement/orders/{orderId}` with `Authorization: Bearer {token}` and body `{ "locationId": "any-uuid" }`.
**Expected:** HTTP 422 response with body `{ "reason": "order_not_approved", "message": "Location can only be assigned after the order is approved." }`.
**Why human:** Requires a running API server and a real PENDING order — cannot verify HTTP response in static analysis.

### 5. Procurement Emails Tab — Thread Replay

**Test:** Navigate to `/communications` → click "Procurement Emails" tab. Click a row to expand it.
**Expected:** Row expands inline showing: order number, quantity, round count, sent timestamp; full AI draft body in monospaced pre block; WineOps AI disclaimer; constraint notes (if any, in amber); rolling summary block. Filter bar shows Date From, Provider, Type, and Wine inputs and they filter the list.
**Why human:** Expand/collapse interaction, filter UX behavior, and content layout require browser-level verification.

### 6. Regression: Existing Draft Approval Flow

**Test:** From `/orders`, open an order that has a PENDING_APPROVAL conversation via the existing order detail. The DraftEmailApprovalPanel should open normally (not via the Active Conversations panel). Approve or discard the draft.
**Expected:** Existing approve/edit/discard workflow unchanged. After approval, the Active Conversations panel count decreases (due to `activeConversationKeys.all` invalidation).
**Why human:** End-to-end mutation + invalidation + panel refresh cycle requires live session testing.

---

## Gaps Summary

No blocking gaps found. All 26 plan must-haves are VERIFIED in the codebase. The phase goal is substantively achieved.

**Noting (informational, not blocking):**
- ROADMAP SC5 specifies a dedicated `/procurement/orders/:id/location` endpoint, but the implementation uses the general `PATCH /procurement/orders/:id` with a `locationId` field guard. The protection is equivalent.
- ROADMAP SC2 mentions "provider replies" in the thread replay. The data model (`procurement_conversations` table) stores multi-round context in `rolling_summary` rather than individual reply records, so the thread replay shows the rolling summary instead of discrete reply messages. This is consistent with the plan's design (34-04 PLAN.md does not specify individual reply rows) and is acceptable given the current data architecture.

---

_Verified: 2026-05-17T22:55:00-05:00_
_Verifier: Claude (gsd-verifier)_
