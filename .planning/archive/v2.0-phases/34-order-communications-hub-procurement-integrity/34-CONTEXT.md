# Phase 34: Order Communications Hub & Procurement Integrity — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Source:** Manager brainstorm + premortem analysis

---

<domain>
## Phase Boundary

This phase completes the Phase 32 procurement loop at the UX and integrity layer.
Phase 32 built the AI draft engine (backend). Phase 34 surfaces those drafts in the right
UI locations and locks down the procurement state machine so orders in PENDING status
cannot pollute inventory or calendar data.

Three delivery areas:
1. **Active Conversations Panel** — surface live AI drafts on /orders (Pending KPI tap)
2. **Send History Tab** — completed conversation threads on /communications
3. **Procurement Integrity Gate** — inventory/calendar writes only on approval; location guard on pending orders

Out of scope for Phase 34:
- New email types (Phase 32 owns PRICE_INQUIRY / DEMAND_OFFER / PROMO_INQUIRY / WINE_INQUIRY)
- Provider intelligence display (Phase 32 owns IntelBadge pills)
- Multi-round negotiation flow (Phase 32 owns round_count / progressive summarization)

</domain>

---

<decisions>
## Implementation Decisions

### D-01: Active Conversations entry point
**Decision**: The Pending KPI card on /orders is the primary entry point.
Clicking it opens a right-side slide-in panel ("Active Conversations") that lists all
orders where `procurement_conversations.status = 'PENDING_APPROVAL'`.
Panel is stylistically distinct from the order list — card-based, dark-indigo background
(consistent with DraftEmailApprovalPanel), live draft-age indicator.
Each card has inline "Approve / Discard" quick actions that forward to the existing
`approveDraft` / `discardDraft` mutation hooks.
A secondary "Active Conversations" badge count is shown on the Pending KPI card header
when count > 0.

### D-02: View Draft badge on order cards
**Decision**: Each order row/card in /orders shows a subtle "AI Draft Ready" badge
(indigo pill) when a PENDING_APPROVAL conversation exists for that order.
Clicking the badge opens the existing DraftEmailApprovalPanel for that order.
Badge is hidden once the conversation is approved/discarded.

### D-03: Communications Send History tab
**Decision**: /communications page gets a new "Send History" tab alongside any existing tabs.
Shows conversations where `status IN ('AUTO_SENT', 'SENT', 'COMPLETED', 'CLOSED')`.
Each row: provider name, wine name, email type, date sent, outcome (approved / auto-sent / discarded).
Clicking a row expands a full thread replay: subject line, draft body, disclaimer, constraint warnings,
any provider reply excerpts if stored.
Filter/sort by date range, provider, wine, email type.

### D-04: Procurement integrity — defer inventory write to approval
**Decision**: `dispatchInventoryUpdate` in `handleContactProviders` (Orders.tsx) is **removed entirely**.
Creating an order must never update inventory stock_live or show the wine as "on order" in inventory counts.
The `createInventoryItem` call (for linking order to wine) is kept — it only creates the inventory row
if it doesn't exist, without changing stock. Only the cache-update event (`type: 'add'`) is dropped.

### D-05: Procurement integrity — defer calendar scheduling to approval
**Decision**: The `createCalendarEvent.mutateAsync(...)` call inside `handleContactProviders` is **removed**.
Calendar delivery events are ONLY created inside `approveDraft` on the backend (Phase 32 already wires
this — verify that the path is complete and no alternate code path re-creates it on order creation).
Frontend must not create a calendar row at order creation time.

### D-06: Location assignment guard — backend
**Decision**: A new `PATCH /procurement/orders/:id/location` endpoint (or any existing patch route)
returns `HTTP 422 Unprocessable Entity` with:
```json
{ "reason": "order_not_approved", "message": "Location can only be assigned after the order is approved." }
```
…when `order.status` is `PENDING`, `APPROVAL_NEEDED`, or `NEGOTIATING`.
Allowed statuses: `APPROVED`, `CONFIRMED`, `IN_TRANSIT`, `DELIVERED`, `COMPLETED`.

### D-07: Location assignment guard — frontend
**Decision**: Any location assignment UI (dropdown, input, or button) for an order in pending states
is rendered as disabled with a tooltip: "Available after order is approved".
No silent failure — always visible to the user why it's blocked.

### D-08: Active conversations panel data query
**Decision**: A new backend endpoint `GET /procurement/conversations/active?restaurantId=...`
returns all PENDING_APPROVAL conversations joined with their order (wine name, quantity, provider name,
quoted price) and conversation metadata (email_type, round_count, created_at).
Frontend uses a React Query hook `useActiveConversations()`.

### D-09: Draft age indicator
**Decision**: Active conversations panel shows how long each draft has been waiting
(e.g. "2 hrs ago", "5 min ago"). Drafts older than 24h show a warning indicator
(amber color) — the user should not let drafts go stale as provider conditions may change.

### D-10: Conversation lifecycle on order cancellation
**Decision**: If an order is cancelled (`CANCELLED` status), its PENDING_APPROVAL conversation
is automatically transitioned to `CANCELLED` status via a backend trigger. This prevents
cancelled orders from appearing in the active conversations panel indefinitely.

</decisions>

---

<premortem>
## Premortem Analysis — What Could Go Wrong

### PM-01: Inventory double-write (HIGH RISK)
**Scenario**: Old `dispatchInventoryUpdate` is removed from `handleContactProviders` but a
separate real-time subscription or refetchOrders call triggers an inventory update indirectly.
**Mitigation**: Audit ALL paths that call `createInventoryItem` and `dispatchInventoryUpdate`.
Ensure the inventory item row creation (linking wine to restaurant) stays, but the stock_live
update and the cache event are deferred. Add a server-side check: `createOrder` should NOT
modify `stock_live`.

### PM-02: Calendar event created on two paths (MEDIUM RISK)
**Scenario**: The `createCalendarEvent.mutateAsync` removal in the frontend doesn't cover
cases where calendar events are created via the backend `emitOrderChangeEvent` path or
via the real-time subscription.
**Mitigation**: Trace the full calendar creation path. Ensure `createOrder` does not insert
into `calendar_events`. Only `approveDraft` (backend) or the user manually confirming delivery
should create calendar rows.

### PM-03: Race condition on concurrent approval (MEDIUM RISK)
**Scenario**: Manager approves a draft; simultaneously the system tries to create inventory
update from another source (e.g. real-time event, background job).
**Mitigation**: `approveDraft` backend should use a DB transaction for:
(1) update conversation status → APPROVED / SENT
(2) update order status → APPROVED
(3) update inventory stock_live (if applicable)
(4) insert calendar event
All-or-nothing.

### PM-04: Active conversations panel shows stale data (LOW-MEDIUM RISK)
**Scenario**: Manager approves a draft from DraftEmailApprovalPanel; active conversations
panel still shows the approved draft because React Query cache isn't invalidated.
**Mitigation**: On approveDraft/discardDraft mutations, invalidate both the order query key
AND a new `conversations.active` query key.

### PM-05: Location guard bypass via direct API call (LOW RISK)
**Scenario**: Frontend guard disabled properly, but a savvy user POSTs directly to the
location endpoint with a pending order ID.
**Mitigation**: Guard is in the backend (422), not just frontend. Frontend is a UX improvement.

### PM-06: Orphaned PENDING_APPROVAL conversations (LOW RISK)
**Scenario**: Order is cancelled/deleted but conversation stays PENDING_APPROVAL, cluttering
the active panel.
**Mitigation**: Backend `cancelOrder` / `deleteOrder` cascades conversation status to CANCELLED.
Add a cleanup job for conversations > 7 days old without status change.

### PM-07: Communications history missing data (LOW-MEDIUM RISK)
**Scenario**: Phase 32 conversations use `content` field for the draft body, but the full
thread (provider reply + round_count entries) may not be stored.
**Mitigation**: The send history tab should gracefully handle partial data — show what's available
(draft body, email type, outcome) and note when provider replies aren't available yet.

### PM-08: DraftEmailApprovalPanel not connected to Active Conversations panel (MEDIUM RISK)
**Scenario**: User approves from active panel; DraftEmailApprovalPanel (if open) still shows
old state; or vice versa.
**Mitigation**: Both views share the same React Query mutation (useApproveDraft /
useDiscardDraft). After mutation, invalidate `conversations.active` and `orders.list` keys.
Use optimistic updates sparingly — prefer server refresh for state-sensitive procurement data.

</premortem>

---

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 32 (primary dependency)
- `apps/api-gateway/src/procurement/procurement.service.ts` — approveDraft, discardDraft, getPendingDraft, createOrder
- `apps/api-gateway/src/procurement/procurement.controller.ts` — existing endpoints
- `apps/web/src/pages/Orders.tsx` — handleContactProviders, DraftEmailApprovalPanel usage, KPI cards, dispatchInventoryUpdate (to be removed)
- `apps/web/src/pages/orders/useOrdersPage.ts` — order state management
- `apps/web/src/hooks/queries/useOrderQueries.ts` — React Query hooks (useApproveOrder, useApproveDraft, useDiscardDraft)
- `services/agent-orchestrator/agents/provider_communication_agent.py` — _handle_order_created, final_status logic

### Communications page
- `apps/web/src/pages/` — check for existing Communications.tsx or similar
- `apps/api-gateway/src/procurement/` — procurement_conversations table access pattern

### Inventory
- `apps/api-gateway/src/inventory/inventory.service.ts` — createInventoryItem (keep), stock_live updates (defer)

### State machine reference
- `apps/api-gateway/src/procurement/dto/procurement.dto.ts` — ProcurementOrderStatus enum

</canonical_refs>

---

<specifics>
## Specific Implementation Notes

### Active Conversations Panel UX
- Slide-in from right, width ~480px, dark indigo-900 background
- Header: "Active Drafts" + count badge
- Cards sorted by `created_at DESC` (oldest drafts get amber warning at top after 24h)
- Each card: wine avatar/icon, wine name, quantity, provider name, email type badge, "X hrs ago"
- Quick actions: [View Full Draft] → opens DraftEmailApprovalPanel | [Quick Approve] | [Discard]
- Footer: "N active drafts — oldest from {date}"

### Communications Page — Send History Tab
- Date range filter (default: last 30 days)
- Provider filter (multi-select)
- Email type filter (PRICE_INQUIRY / DEMAND_OFFER / etc)
- Each row expands to show: full draft body, constraint warnings, outcome metadata
- Export to CSV option (nice-to-have, not blocking)

### Backend Location Guard
- New PATCH endpoint or enhance existing UpdateOrderDto
- `location_id` or `delivery_location` field addition to UpdateOrderDto
- Guard runs as a `@Before()` hook or inline in `updateOrder` service method
- 422 must include `reason: 'order_not_approved'` so frontend can show targeted message

### Inventory Integrity
- `handleContactProviders` in Orders.tsx: remove the `dispatchInventoryUpdate` fire-and-forget block
- `createCalendarEvent.mutateAsync(...)` block removed from handleContactProviders
- Verify `approveDraft` in procurement.service.ts correctly creates the calendar event via `dispatchCalendarEvent` or direct DB write
- If `approveDraft` calendar creation was the Phase 32 NOTE ("Calendar event is intentionally NOT created here"), confirm the full intended flow

</specifics>

---

<deferred>
## Deferred Ideas

- Multi-round negotiation UI (Phase 32 scope — not this phase)
- Provider reply tracking / inbound email thread view (future phase)
- Email template customization per restaurant (future phase)
- Export/download conversation thread as PDF (nice-to-have, defer if time-constrained)
- Notification when draft is about to expire / stale (could be simple frontend timer)

</deferred>

---

*Phase: 34-order-communications-hub-procurement-integrity*
*Context gathered: 2026-05-18 — Manager brainstorm + premortem analysis*
