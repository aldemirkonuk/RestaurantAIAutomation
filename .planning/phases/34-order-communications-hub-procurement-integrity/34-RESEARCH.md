# Phase 34: Order Communications Hub & Procurement Integrity — Research

**Researched:** 2026-05-18
**Domain:** Procurement UI / React Query / NestJS state machine
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** Pending KPI card is the primary entry point; clicking opens right-side slide-in "Active Conversations" panel listing all orders where `procurement_conversations.status = 'PENDING_APPROVAL'`.
- **D-02** Each order row shows a subtle "AI Draft Ready" indigo pill badge when a PENDING_APPROVAL conversation exists; clicking opens DraftEmailApprovalPanel.
- **D-03** /communications page gets a new "Send History" tab; shows `status IN ('AUTO_SENT', 'SENT', 'COMPLETED', 'CLOSED')`; each row expands to full thread replay.
- **D-04** `dispatchInventoryUpdate` in `handleContactProviders` (Orders.tsx) is **removed entirely**. `createInventoryItem` call is **kept** (stockLive: 0 only). Only the cache-update event (`type: 'add'`) is dropped.
- **D-05** `createCalendarEvent.mutateAsync(...)` call inside `handleContactProviders` is **removed**. Calendar delivery events are ONLY created inside `approveDraft` on the backend (already wired — verified below).
- **D-06** New `PATCH /procurement/orders/:id/location` (or existing patch route) returns HTTP 422 when `order.status` is `PENDING`, `APPROVAL_NEEDED`, or `NEGOTIATING`. Allowed statuses: `APPROVED`, `CONFIRMED`, `IN_TRANSIT`, `DELIVERED`, `COMPLETED`.
- **D-07** Location assignment UI is rendered disabled with tooltip when order is in pending states.
- **D-08** New backend endpoint `GET /procurement/conversations/active?restaurantId=...` returns all PENDING_APPROVAL conversations joined with order and provider data. Frontend uses `useActiveConversations()` hook.
- **D-09** Active conversations panel shows draft age ("2 hrs ago"); drafts older than 24h show amber warning.
- **D-10** Cancelled orders cascade their PENDING_APPROVAL conversation to `CANCELLED` status via backend trigger.

### Claude's Discretion
None specified — all areas have locked decisions.

### Deferred Ideas (OUT OF SCOPE)
- Multi-round negotiation UI (Phase 32 scope)
- Provider reply tracking / inbound email thread view
- Email template customization per restaurant
- Export/download conversation thread as PDF
- Notification when draft is about to expire / stale (frontend timer)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMMS-01 | Pending KPI card opens Active Conversations slide-in panel | D-01: OrderSummary component needs new `onActiveDraftsClick` prop; new `ActiveConversationsPanel` component |
| COMMS-02 | Active Conversations panel shows PENDING_APPROVAL conversations with order/provider metadata | D-08: new `GET /procurement/conversations/active` endpoint + `useActiveConversations()` hook |
| COMMS-03 | Each conversation card has Approve/Discard quick actions + View Full Draft button | D-01: forward to existing `useApproveDraft` / `useDiscardDraft` mutations; open existing `DraftEmailApprovalPanel` |
| COMMS-04 | "AI Draft Ready" badge on order rows linked to DraftEmailApprovalPanel | D-02: requires knowing which order_ids have PENDING_APPROVAL convos — comes from `useActiveConversations()` data |
| COMMS-05 | Send History tab on /communications showing procurement email history | D-03: new backend endpoint `GET /procurement/conversations/history`; new React component |
| COMMS-06 | Draft age indicator (relative time + 24h amber warning) | D-09: compute from `created_at`; pure frontend |
| PROCINT-01 | Remove `dispatchInventoryUpdate` (type:'add') from `handleContactProviders` | D-04: exact line identified: 954–963 in Orders.tsx |
| PROCINT-02 | Remove `createCalendarEvent.mutateAsync` from `handleContactProviders` | D-05: exact lines identified: 1009–1022 in Orders.tsx; also audit `dispatchCalendarEvent` real-time event at 996–1005 |
| PROCINT-03 | Backend `createOrder` must NOT modify `stock_live` | VERIFIED: backend createOrder is clean — no stock_live writes |
| PROCINT-04 | `approveDraft` creates calendar events (must be sole calendar creation path) | VERIFIED: approveDraft in procurement.service.ts lines 836–857 already calls `createCalendarEventForOrder` |
| PROCINT-05 | Location assignment guard: 422 for pending-status orders | D-06: add `location_id` to UpdateOrderDto + guard in `updateOrder` service |
| PROCINT-06 | Cancelled orders cascade PENDING_APPROVAL → CANCELLED conversation status | D-10: `cancelOrder` in procurement.service.ts currently does NOT cascade — gap confirmed |

</phase_requirements>

---

## Summary

Phase 34 is a refinement phase with no new AI primitives — it surfaces existing Phase 32 data in the right UI locations and hardens the procurement state machine. All three delivery streams operate on already-existing infrastructure (procurement_conversations table, approveDraft backend, React Query mutation hooks). The work is primarily: (1) wiring new UI panels to new read endpoints, (2) removing two premature frontend side-effects in `handleContactProviders`, and (3) adding two small backend guards.

**Finding 1 — Inventory integrity.** The backend `createOrder` method is clean. It does not write to `stock_live` or `calendar_events`. The only fix needed is in the frontend `handleContactProviders` function where `dispatchInventoryUpdate({type:'add'})` (a fire-and-forget cache event at line 954) and `createCalendarEvent.mutateAsync` (a DB write at line 1009) are called after each order creation. Both must be removed. The `createInventoryItem` call (which creates a row with `stockLive: 0`) is intentionally kept.

**Finding 2 — Calendar integrity.** Phase 32 already correctly placed calendar creation inside `approveDraft` (procurement.service.ts lines 836–857). The `approveDraft` method calls `createCalendarEventForOrder` which directly inserts into `calendar_events` with tag `{order_id, trigger: 'approved'}`. The only cleanup is removing the premature frontend call. Additionally, `dispatchCalendarEvent` (a real-time SSE event at line 996) sends a calendar notification to the calendar page without writing to the DB — this ALSO should be removed from `handleContactProviders` to prevent a phantom calendar entry appearing before draft approval.

**Finding 3 — Active Conversations panel.** `GET /procurement/conversations/active` does NOT exist. It must be created. The `procurement_conversations` table has all needed fields: `order_id`, `provider_id`, `restaurant_id`, `status`, `outbound_email_type`, `round_count`, `created_at`, `content`. The join to get wine name and quantity requires `procurement_orders` (via order_id). Provider name requires `providers` (via provider_id).

**Finding 4 — Communications Send History.** The `/communications` page **already has** a "Send History" tab (key: `'history'`). It currently renders `ApiCommunicationHistory` which shows **generic AI conversations** from `/api/v1/conversations` endpoint — NOT procurement_conversations. D-03 requires procurement-specific data. The implementation should add a **new 4th tab** ("Procurement Emails" or "Email Drafts") with procurement conversation history to avoid colliding with the existing "Send History" tab. The existing "Send History" tab has been noted as an open question.

**Finding 5 — Conversation cancellation cascade.** `cancelOrder` in procurement.service.ts updates conversation calendar events and releases shadow stock but does **NOT** update `procurement_conversations.status` to CANCELLED. This is a one-line gap.

**Finding 6 — Location guard.** `UpdateOrderDto` has no `location_id` field. `PATCH /procurement/orders/:id` exists and routes through `updateOrder` service method. The simplest implementation: add `locationId` to `UpdateOrderDto` + add a status guard in `updateOrder` that 422s when `location_id` is being set and order is in a pending status.

**Primary recommendation:** Implement in three waves: (1) backend endpoints + guards, (2) frontend panels + hooks, (3) Communications tab. No new DB migrations required — all needed columns exist in `procurement_conversations`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Active Conversations data | API / Backend | — | Read from Supabase, join two tables, scoped to restaurant |
| Active Conversations panel | Browser / Client | Frontend (state) | Slide-in panel, purely display + mutation triggers |
| "AI Draft Ready" badge | Browser / Client | — | Derived from already-loaded conversation data |
| Send History data | API / Backend | — | Filter procurement_conversations by status set |
| Send History tab UI | Browser / Client | — | Expand/collapse rows, filters |
| Draft age indicator | Browser / Client | — | Pure `Date.now() - created_at` computation |
| Inventory write guard | Browser / Client | API / Backend | Frontend removes call; backend createOrder already clean |
| Calendar write guard | Browser / Client | API / Backend | Frontend removes premature call; backend approveDraft is correct |
| Location assignment guard | API / Backend | Browser / Client | 422 at API layer; frontend disables UI |
| Conversation cancellation cascade | API / Backend | — | cancelOrder hook in procurement.service.ts |

---

## Standard Stack

### Core (all already in use — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | v5 | Server state, caching, invalidation | Project standard — all existing hooks use it |
| axios (via apiClient) | — | HTTP client | Project standard — apiClient wraps axios |
| NestJS | — | Backend framework | Project standard |
| Supabase client | — | DB queries | Project standard |
| framer-motion | — | Slide-in panel animation | Already used in DraftEmailApprovalPanel |
| lucide-react | — | Icons (Clock, AlertTriangle etc.) | Project standard |
| date-fns OR native Date | — | Relative time formatting | No external dependency needed |

### New query key namespace needed

```typescript
// Add to useDraftEmailQueries.ts or new useActiveConversationQueries.ts
export const activeConversationKeys = {
  all: ['conversations', 'active'] as const,
  list: (restaurantId: string) =>
    [...activeConversationKeys.all, restaurantId] as const,
}
```

**Version verification:** No new npm packages required — all dependencies are pre-installed. [VERIFIED: existing package.json already contains all referenced libraries]

---

## Architecture Patterns

### System Architecture Diagram

```
Orders.tsx (Pending KPI click)
    │
    ▼
ActiveConversationsPanel (new component, ~480px slide-in)
    │
    ├─ GET /procurement/conversations/active?restaurantId=...  (new endpoint)
    │       └─ ProcurementService.getActiveConversations()  (new method)
    │               └─ procurement_conversations JOIN procurement_orders JOIN providers
    │
    ├─ [Quick Approve] ──► POST /procurement/orders/:id/approve-draft
    ├─ [Discard]        ──► POST /procurement/orders/:id/discard-draft
    └─ [View Full Draft] ──► opens existing DraftEmailApprovalPanel

On approve/discard:
    useApproveDraft / useDiscardDraft (existing mutations)
        └─ onSettled: invalidate draftKeys.all + queryKeys.orders.all
                     + NEW: activeConversationKeys.all  ← MUST ADD

Communications.tsx (new tab)
    │
    ├─ GET /procurement/conversations/history?restaurantId=...&status=AUTO_SENT,APPROVED  (new endpoint)
    │       └─ ProcurementService.getConversationHistory()  (new method)
    │
    └─ Expand row → shows draft body, email type, outcome metadata

handleContactProviders (Orders.tsx) — INTEGRITY CHANGES
    ├─ KEEP:   createInventoryItem (stockLive: 0)
    ├─ REMOVE: dispatchInventoryUpdate({ type: 'add' })   ← line 954
    ├─ REMOVE: dispatchCalendarEvent(...)                  ← line 996
    └─ REMOVE: createCalendarEvent.mutateAsync(...)        ← line 1009

cancelOrder (backend) — INTEGRITY CHANGE
    └─ ADD: UPDATE procurement_conversations SET status='CANCELLED'
             WHERE order_id=orderId AND status='PENDING_APPROVAL'

updateOrder (backend) — LOCATION GUARD
    └─ ADD: if dto.locationId && ['PENDING','APPROVAL_NEEDED','NEGOTIATING'].includes(order.status)
                 → throw UnprocessableEntityException({ reason: 'order_not_approved', ... })
```

### Recommended Project Structure (additions only)

```
apps/web/src/
├── components/orders/
│   ├── DraftEmailApprovalPanel.tsx      # existing — no change
│   └── ActiveConversationsPanel.tsx     # NEW — slide-in panel
├── hooks/queries/
│   ├── useDraftEmailQueries.ts          # existing — add activeConversationKeys + useActiveConversations
│   └── useConversationQueries.ts        # existing — may add useConversationHistory for procurement history
├── pages/
│   ├── Orders.tsx                       # existing — add panel state, remove 2 calls, add badge
│   └── Communications.tsx              # existing — add new procurement tab

apps/api-gateway/src/procurement/
├── procurement.controller.ts            # add GET conversations/active, GET conversations/history
├── procurement.service.ts               # add getActiveConversations(), getConversationHistory(), location guard, cancel cascade
└── dto/procurement.dto.ts               # add locationId to UpdateOrderDto
```

### Pattern 1: New backend endpoint — getActiveConversations

```typescript
// Source: [VERIFIED — matches existing Supabase query patterns in procurement.service.ts]
async getActiveConversations(restaurantId: string): Promise<ActiveConversationDto[]> {
  const { data, error } = await this.databaseService.supabase
    .from('procurement_conversations')
    .select(`
      id,
      order_id,
      provider_id,
      outbound_email_type,
      round_count,
      created_at,
      constraint_flags,
      procurement_orders!inner(
        id, order_number, quantity, quoted_price,
        inventory:inventory_id(wine_name)
      ),
      providers!inner(name)
    `)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'PENDING_APPROVAL')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []).map(this.mapActiveConversation);
}
```

### Pattern 2: Conversation cancellation cascade in cancelOrder

```typescript
// After updateOrder call in cancelOrder(), add:
await this.databaseService.supabase
  .from('procurement_conversations')
  .update({ status: 'CANCELLED' })
  .eq('restaurant_id', restaurantId)
  .eq('order_id', orderId)
  .eq('status', 'PENDING_APPROVAL');
// Non-fatal: wrap in try/catch, log warning on failure
```

### Pattern 3: Location guard in updateOrder

```typescript
// At top of updateOrder(), when locationId is being set:
if (dto.locationId !== undefined) {
  const { data: existing } = await this.databaseService.supabase
    .from('procurement_orders')
    .select('status')
    .eq('restaurant_id', restaurantId)
    .eq('id', orderId)
    .single();

  const BLOCKED_STATUSES = ['PENDING', 'APPROVAL_NEEDED', 'NEGOTIATING'];
  if (BLOCKED_STATUSES.includes(existing?.status)) {
    throw new UnprocessableEntityException({
      reason: 'order_not_approved',
      message: 'Location can only be assigned after the order is approved.',
    });
  }
}
```

### Pattern 4: React Query cache invalidation for active conversations

```typescript
// In useApproveDraft and useDiscardDraft, add to onSettled:
queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })

// In new useActiveConversations hook:
export function useActiveConversations() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  return useQuery({
    queryKey: activeConversationKeys.list(activeRestaurantId ?? ''),
    queryFn: () =>
      apiClient
        .get(`/procurement/conversations/active`)
        .then(r => r.data),
    enabled: !!activeRestaurantId && isAuthenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}
```

### Pattern 5: Removing premature side-effects from handleContactProviders

```typescript
// REMOVE these blocks entirely from handleContactProviders (Orders.tsx):

// Block A — line 954–963: fire-and-forget inventory cache event
// dispatchInventoryUpdate({ type: 'add', wineId: ..., ... }).catch(...)

// Block B — line 996–1005: real-time calendar event dispatch
// dispatchCalendarEvent({ type: 'created', eventId: ..., ... })

// Block C — line 1007–1023: DB calendar event creation
// if (user?.restaurantId) {
//   await createCalendarEvent.mutateAsync({ ... })
// }
```

### Pattern 6: Active Conversations Panel — draft age indicator

```typescript
// Pure frontend computation — no backend call needed
function formatDraftAge(createdAt: string): { label: string; isStale: boolean } {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const diffHrs = diffMs / (1000 * 60 * 60)
  const isStale = diffHrs >= 24
  if (diffMs < 60_000) return { label: 'just now', isStale }
  if (diffMs < 3_600_000) return { label: `${Math.floor(diffMs / 60_000)} min ago`, isStale }
  return { label: `${Math.floor(diffHrs)} hrs ago`, isStale }
}
```

### Anti-Patterns to Avoid

- **Optimistic updates on approve/discard from Active Conversations panel:** Prefer server refresh for procurement data. PM-08 warns that optimistic state and DraftEmailApprovalPanel sharing mutations can desync. Invalidate and refetch instead.
- **Re-adding `dispatchCalendarEvent` as a replacement for `createCalendarEvent.mutateAsync`:** The real-time event at line 996 also creates a phantom calendar entry on the calendar page before draft approval. Remove both.
- **Adding location guard only to frontend:** Backend 422 is mandatory (PM-05). Frontend disability is a UX improvement, not the security layer.
- **Creating a new `procurement_conversations` status value:** The existing values `PENDING_APPROVAL`, `APPROVED`, `DISCARDED`, `AUTO_SENT`, `CANCELLED` cover all cases. Do not add new ones.
- **Colliding with existing "Send History" tab in Communications.tsx:** The existing `key: 'history'` tab shows generic AI conversations from `/api/v1/conversations`. Add a new tab key (e.g. `'procurement-history'`) for procurement email drafts to avoid replacing existing functionality.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Relative time formatting | Custom humanizer | Native `Date` diff with simple conditionals | Sub-24h range is simple; no i18n needed in this phase |
| Slide-in panel animation | Custom CSS transition | `framer-motion` (already imported in DraftEmailApprovalPanel) | AnimatePresence already handles mount/unmount |
| Draft approval/discard logic | Duplicate mutation | `useApproveDraft` / `useDiscardDraft` (existing in useDraftEmailQueries.ts) | Active Conversations panel just calls these — no new mutation needed |
| Conversation status → text label | Enum decode logic | Inline map object | Two statuses (AUTO_SENT, APPROVED) map to "auto-sent" / "approved" |

---

## Common Pitfalls

### Pitfall 1: `dispatchCalendarEvent` is NOT safe to keep

**What goes wrong:** Removing `createCalendarEvent.mutateAsync` but keeping `dispatchCalendarEvent` (line 996) causes a phantom delivery event to appear on the calendar page (via real-time SSE) before the manager approves any draft. The manager sees a calendar event for an unconfirmed delivery.

**Why it happens:** `dispatchCalendarEvent` publishes a real-time event that the CalendarPage subscription converts into a visual calendar entry (optimistic or via refetch). It was designed as an optimistic-update mechanism.

**How to avoid:** Remove BOTH `dispatchCalendarEvent` (line 996–1005) and `createCalendarEvent.mutateAsync` (line 1009–1022) from `handleContactProviders`. [VERIFIED: `approveDraft` already creates the calendar event in the DB]

**Warning signs:** Calendar page shows delivery events immediately after order creation, before any draft is approved.

---

### Pitfall 2: Active Conversations panel cache stale after DraftEmailApprovalPanel approval

**What goes wrong:** Manager approves a draft via DraftEmailApprovalPanel; the Active Conversations slide-in panel still shows that draft (PM-08 scenario).

**Why it happens:** `useApproveDraft` currently invalidates `draftKeys.all` and `queryKeys.orders.all` but NOT `activeConversationKeys.all`. The Active Conversations panel has its own query key.

**How to avoid:** Add `queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })` to both `useApproveDraft.onSettled` and `useDiscardDraft.onSettled`.

**Warning signs:** After approving from DraftEmailApprovalPanel, the Active Conversations panel count badge still shows the old number.

---

### Pitfall 3: Communications Send History tab collides with existing "Send History"

**What goes wrong:** If implementation uses tab key `'history'` for the new procurement history tab, it replaces the existing generic communication history panel that restaurant managers may already rely on.

**Why it happens:** CONTEXT.md D-03 was written as "new 'Send History' tab alongside any existing tabs" without noting that `'history'` key already exists (label: "Send History") in Communications.tsx.

**How to avoid:** Use a new tab key (e.g. `'procurement-history'`) with label "Procurement Emails" or "AI Draft History". Document in the plan that the existing "Send History" tab is preserved.

**Warning signs:** The existing email/SMS template communication history disappears from Communications.tsx.

---

### Pitfall 4: Location guard race condition — fetch then check

**What goes wrong:** Between the `SELECT status` check and the `UPDATE` with `location_id`, another request changes the order status.

**Why it happens:** Two sequential DB calls without a transaction.

**How to avoid:** Add `eq('status', 'in', BLOCKED_STATUSES)` predicate to the UPDATE itself (i.e., only update if NOT in blocked status), and return 422 if 0 rows updated. Or use the existing Supabase `.single()` to catch this. Since location assignment is a manual manager action (not a concurrent automated flow), the race window is negligible, but the pattern should still be correct.

**Warning signs:** Location assigned to PENDING order despite guard.

---

### Pitfall 5: GET conversations/active joined query fails if orders or providers are soft-deleted

**What goes wrong:** `!inner` join drops conversations whose linked order or provider has been soft-deleted, making them invisible in the active panel.

**Why it happens:** Supabase PostgREST `!inner` performs an INNER JOIN, which excludes rows where the joined table returns no match.

**How to avoid:** Use `!left` join for providers (providers can be deactivated). Keep `!inner` for procurement_orders since a conversation always has a valid order.

**Warning signs:** Active conversations panel shows fewer drafts than expected.

---

## Exact Code Paths Requiring Change

### PROCINT-01 & PROCINT-02: handleContactProviders side-effects (Orders.tsx)

```
File: apps/web/src/pages/Orders.tsx
Function: handleContactProviders (line 848)

Line 954–963: REMOVE — dispatchInventoryUpdate({ type:'add' }) fire-and-forget
  Condition: inventoryJustCreated && inventoryItem
  Reason: premature cache event before draft approval

Line 996–1005: REMOVE — dispatchCalendarEvent({ type:'created', ... })
  Reason: causes phantom calendar entry before draft approval (PM-02)

Line 1007–1023: REMOVE — createCalendarEvent.mutateAsync({ ... })
  Reason: DB write before draft approval — violates D-05

Lines 899–963 (createInventoryItem block): KEEP — stockLive:0, no stock change
```

### PROCINT-03 & PROCINT-04: Backend is already correct (VERIFIED)

```
File: apps/api-gateway/src/procurement/procurement.service.ts

createOrder(): does NOT touch stock_live or calendar_events — CLEAN [VERIFIED lines 87–214]

approveDraft():
  - Lines 836–857: calls createCalendarEventForOrder(restaurantId, order, 'approved')
  - createCalendarEventForOrder() inserts into calendar_events with trigger:'approved' tag
  - VERIFIED COMPLETE — no additional work needed
```

### PROCINT-06: cancelOrder missing cascade (procurement.service.ts)

```
File: apps/api-gateway/src/procurement/procurement.service.ts
Function: cancelOrder() (line 352)

MISSING: After line 368 (updateOrder call), add:
  UPDATE procurement_conversations
  SET status = 'CANCELLED'
  WHERE order_id = orderId AND status = 'PENDING_APPROVAL'
  Non-fatal: wrap in try/catch
```

### PROCINT-05: Location guard (procurement.service.ts + dto)

```
File: apps/api-gateway/src/procurement/dto/procurement.dto.ts
  ADD to UpdateOrderDto:
    @ApiPropertyOptional()
    @IsString()
    @IsOptional()
    locationId?: string;

File: apps/api-gateway/src/procurement/procurement.service.ts
  updateOrder(): ADD guard before the UPDATE call:
    if dto.locationId → fetch current status → 422 if pending

File: apps/api-gateway/src/procurement/procurement.controller.ts
  No change needed — PATCH orders/:id already exists
```

---

## `procurement_conversations` Table Schema (Inferred from Code)

[VERIFIED: from procurement.service.ts queries at lines 809–943 and provider_communication_agent.py lines 545–563]

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_id | uuid | FK → procurement_orders |
| provider_id | uuid | FK → providers |
| restaurant_id | uuid | Tenant scoping |
| direction | text | 'OUTBOUND' |
| channel | text | 'email' |
| content | text | Full draft body (with disclaimer) |
| status | text | 'PENDING_APPROVAL' / 'APPROVED' / 'DISCARDED' / 'AUTO_SENT' / 'CANCELLED' |
| outbound_email_type | text | PRICE_INQUIRY / DEMAND_OFFER / PROMO_INQUIRY / WINE_INQUIRY |
| round_count | int | Negotiation rounds |
| disclaimer_appended | bool | Always true for AI drafts |
| constraint_flags | jsonb | `{hard:[], annotating:[], soft_warnings:[], is_sensitive:bool}` |
| rolling_summary | text | Progressive summary after round 2+ |
| created_at | timestamptz | When draft was generated |
| sent_at | timestamptz | When manager approved |

**Fields for Active Conversations panel (via join):**
- `procurement_orders.order_number`, `procurement_orders.quantity`, `procurement_orders.quoted_price`
- `inventory:inventory_id(wine_name)` — nested join
- `providers.name` — for provider name display

**Fields for Send History tab (status filter):**
- status IN ('AUTO_SENT', 'APPROVED', 'SENT', 'COMPLETED', 'CLOSED')
- sent_at for "date sent"
- outbound_email_type for email type badge
- content for full draft replay

---

## React Query Cache Key Architecture

### Existing keys that affect this phase

```typescript
// useDraftEmailQueries.ts (EXISTING)
draftKeys.all = ['drafts']                        // invalidated by approveDraft/discardDraft
draftKeys.byOrder = ['drafts', 'order', orderId]  // per-order pending draft

// query-keys.ts (EXISTING)
queryKeys.orders.all = ['orders']                 // invalidated by approveDraft/discardDraft

// useConversationQueries.ts (EXISTING — for generic communications history)
conversationKeys.all = ['conversations']          // NOT affected by procurement actions
```

### New key needed for this phase

```typescript
// ADD to useDraftEmailQueries.ts or new useActiveConversationQueries.ts
export const activeConversationKeys = {
  all: ['conversations', 'active'] as const,
  list: (restaurantId: string) =>
    [...activeConversationKeys.all, restaurantId] as const,
}
```

### Required invalidation updates

```typescript
// useApproveDraft (useDraftEmailQueries.ts) — EXISTING onSettled:
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: draftKeys.all })
  queryClient.invalidateQueries({ queryKey: queryKeys.orders.all })
  // ADD:
  queryClient.invalidateQueries({ queryKey: activeConversationKeys.all })
}

// useDiscardDraft — SAME addition required
```

---

## DraftEmailApprovalPanel Integration

[VERIFIED: apps/web/src/components/orders/DraftEmailApprovalPanel.tsx]

The existing panel accepts:
```typescript
interface DraftEmailApprovalPanelProps {
  isOpen: boolean
  draftData: DraftEmailData | null   // { conversationId, orderId, wineName, quantity,
                                     //   providerName, providerEmail, emailType,
                                     //   draftContent, disclaimer, constraintWarnings,
                                     //   roundCount, timestamp }
  onApprove: (modifiedContent?: string, managerNotes?: string) => void
  onDiscard: () => void
  onClose: () => void
  isSubmitting?: boolean
}
```

The **Active Conversations panel** (D-01) is a SEPARATE component — not the same as DraftEmailApprovalPanel. When the user clicks "View Full Draft" from the Active Conversations panel, it should:
1. Set `draftPanelData` state in Orders.tsx to the selected conversation's data
2. Set `isDraftPanelOpen = true`
3. Let the existing DraftEmailApprovalPanel handle the review/approve/discard flow

This means Active Conversations panel needs to accept `onViewDraft` callback that delegates to the parent Orders.tsx state, and the parent already has `approveDraftMutation` / `discardDraftMutation` wired (lines 250–251).

---

## Communications.tsx Current State

[VERIFIED: apps/web/src/pages/Communications.tsx — read in full]

### Existing tabs

| Tab key | Label | Content |
|---------|-------|---------|
| `'templates'` | Templates | GmailTemplateBuilder + SMSTemplateBuilder + SavedTemplates/SMSTemplates |
| `'history'` | Send History | `ApiCommunicationHistory` — queries `/api/v1/conversations` (generic table) |
| `'scheduled-reports'` | Scheduled Reports | ReportScheduler |

### D-03 requires a NEW tab

The existing `'history'` tab shows generic AI conversation history from the `conversations` table (not `procurement_conversations`). D-03 requires **procurement-specific** send history. 

**Implementation decision (for planner):** Add a 4th tab key `'procurement-history'` with label "Procurement Emails" (or "AI Drafts") alongside the existing three tabs. Do NOT modify or replace the existing `'history'` tab. This avoids breaking existing functionality while satisfying D-03.

The tab will need:
- New backend endpoint: `GET /procurement/conversations/history` filtered by status
- New React Query hook: `useProcurementConversationHistory(filters)`
- New inline component: `ProcurementSendHistory` inside Communications.tsx

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest + React Testing Library (frontend) / Jest (backend) |
| Quick run command | `npm test` in apps/web or apps/api-gateway |
| Full suite command | `npm run test:ci` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| PROCINT-01 | `dispatchInventoryUpdate` not called on order creation | unit | vitest Orders.tsx | Mock and verify NOT called |
| PROCINT-02 | `createCalendarEvent.mutateAsync` not called on order creation | unit | vitest Orders.tsx | Mock and verify NOT called |
| PROCINT-03 | Backend createOrder doesn't touch stock_live | integration | Jest procurement.service | Check mock DB calls |
| PROCINT-04 | approveDraft creates calendar event | integration | Jest procurement.service | Already tested in Phase 32 — verify still passes |
| PROCINT-05 | updateOrder returns 422 when location_id set + PENDING status | unit | Jest procurement.service | Test status guard logic |
| PROCINT-06 | cancelOrder cascades PENDING_APPROVAL convos to CANCELLED | unit | Jest procurement.service | Verify conversation status after cancel |
| COMMS-01 | Active conversations panel renders on Pending KPI click | unit | vitest Orders.tsx | Verify panel opens |
| COMMS-02 | useActiveConversations fetches correct endpoint | unit | vitest hooks | Mock apiClient, check URL |
| COMMS-05 | Send History tab renders procurement conversations | unit | vitest Communications.tsx | Smoke render |

### Wave 0 Gaps

- [ ] `apps/web/src/hooks/queries/useActiveConversationQueries.ts` — unit test file needed
- [ ] `apps/api-gateway/src/procurement/procurement.service.spec.ts` — location guard + cancel cascade tests

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JwtAuthGuard already applied to all procurement endpoints |
| V4 Access Control | yes | All new endpoints must be scoped by `restaurantId` from JWT (not request body) |
| V5 Input Validation | yes | New `locationId` field in UpdateOrderDto needs `@IsString() @IsOptional()` |
| V6 Cryptography | no | No new crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Direct API location assignment bypassing frontend guard | Tampering | Backend 422 guard is mandatory — frontend disability alone is insufficient (PM-05) |
| Cross-tenant conversation exposure | Elevation of Privilege | All new queries MUST filter by `restaurant_id` from JWT, not from query param |
| PENDING_APPROVAL conversation polling by other tenant | Info Disclosure | `GET conversations/active` endpoint must use `user.restaurantId` from `@CurrentUser()` decorator, never accept restaurantId from query string |

---

## Open Questions

1. **Communications "Send History" tab label collision** (RESOLVED: Added new `'procurement-history'` tab with label "Procurement Emails" alongside the existing `'history'` tab. Existing "Send History" tab preserved untouched. Implemented in plan 34-04 via `Communications.tsx` state union type extension.)

2. **`dispatchCalendarEvent` (line 996) — remove or keep?** (RESOLVED: Both `dispatchCalendarEvent` (line 996) AND `createCalendarEvent.mutateAsync` (line 1009) are removed from `handleContactProviders`. The backend `approveDraft` (procurement.service.ts lines 836–857 — already calls `createCalendarEventForOrder`) is the sole calendar creation path. Implemented in plan 34-01.)

3. **PENDING_APPROVAL badge (D-02) — query strategy** (RESOLVED: Badge derives from `useActiveConversations()` result in Orders.tsx — a `pendingDraftOrderIds` Set is built via `useMemo` from the active conversations data. Order card badge checks `pendingDraftOrderIds.has(order.order_id)`. Zero extra API calls. Implemented in plan 34-03.)

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — all changes are code/config within existing services)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `procurement_conversations` table has no `sent_at` column populated for AUTO_SENT records | Send History tab | If absent, "date sent" would show null — show `created_at` as fallback |
| A2 | `dispatchCalendarEvent` at line 996 causes a visible phantom calendar entry (not just internal state) | Pitfall 1 | If it only updates in-memory React state, removing it is still correct but urgency is lower |
| A3 | Communications.tsx `'history'` tab is used/relied on by managers | Open Question 1 | If unused, safe to replace; if used, must preserve |

---

## Sources

### Primary (HIGH confidence)
- `apps/api-gateway/src/procurement/procurement.service.ts` — read in full; all method implementations verified
- `apps/api-gateway/src/procurement/procurement.controller.ts` — read in full; all endpoints verified
- `apps/api-gateway/src/procurement/dto/procurement.dto.ts` — read in full; UpdateOrderDto has no locationId
- `apps/web/src/pages/Orders.tsx` — key sections read (lines 140–270, 519–610, 840–1038)
- `apps/web/src/pages/Communications.tsx` — read in full; 3 existing tabs confirmed
- `apps/web/src/hooks/queries/useDraftEmailQueries.ts` — read in full; invalidation scope confirmed
- `apps/web/src/hooks/queries/useConversationQueries.ts` — read in full; conversationKeys confirmed
- `apps/web/src/lib/query-keys.ts` — read in full; no 'conversations.active' key exists
- `apps/web/src/components/orders/DraftEmailApprovalPanel.tsx` — props interface confirmed
- `apps/web/src/pages/orders/OrderSummary.tsx` — Pending KPI card structure confirmed
- `services/agent-orchestrator/agents/provider_communication_agent.py` — procurement_conversations insert schema confirmed

### Secondary (MEDIUM confidence)
- `.planning/phases/34-order-communications-hub-procurement-integrity/34-CONTEXT.md` — locked decisions

---

## Metadata

**Confidence breakdown:**
- Exact code paths to change: HIGH — all files read, exact line numbers identified
- New endpoint structure: HIGH — matches existing patterns in procurement.service.ts
- React Query invalidation plan: HIGH — all existing keys traced
- Communications tab conflict: HIGH — confirmed by reading Communications.tsx in full
- `procurement_conversations` schema: HIGH — inferred from multiple verified queries
- dispatchCalendarEvent behavior: MEDIUM — assumed to cause phantom UI entry (A2)

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (stable codebase — no fast-moving external dependencies)
