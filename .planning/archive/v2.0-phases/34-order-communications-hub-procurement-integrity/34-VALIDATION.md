---
phase: 34
slug: order-communications-hub-procurement-integrity
date: 2026-05-18
---

# Phase 34: Validation Plan

## Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| PROCINT-01 | `dispatchInventoryUpdate` not called on order creation | unit | `cd apps/web && npm test -- --testPathPattern=Orders` | Mock and verify NOT called after handleContactProviders executes |
| PROCINT-02 | `createCalendarEvent.mutateAsync` not called on order creation | unit | `cd apps/web && npm test -- --testPathPattern=Orders` | Mock and verify NOT called |
| PROCINT-03 | Backend createOrder doesn't touch stock_live | integration | `cd apps/api-gateway && npm test -- --testPathPattern=procurement.service` | Check mock DB calls for absence of stock_live write |
| PROCINT-04 | approveDraft creates calendar event | integration | `cd apps/api-gateway && npm test -- --testPathPattern=procurement.service` | Already tested in Phase 32 — verify still passes |
| PROCINT-05 | updateOrder returns 422 when location_id set + PENDING status | unit | `cd apps/api-gateway && npm test -- --testPathPattern=procurement.service` | Test status guard logic; verify UnprocessableEntityException with reason 'order_not_approved' |
| PROCINT-06 | cancelOrder cascades PENDING_APPROVAL convos to CANCELLED | unit | `cd apps/api-gateway && npm test -- --testPathPattern=procurement.service` | Verify procurement_conversations.status = CANCELLED after cancel |
| COMMS-01 | Active conversations panel renders on Pending KPI click | unit | `cd apps/web && npm test -- --testPathPattern=Orders` | Verify isActiveConvPanelOpen state toggles |
| COMMS-02 | useActiveConversations fetches correct endpoint | unit | `cd apps/web && npm test -- --testPathPattern=useActiveConversation` | Mock apiClient; verify GET /procurement/conversations/active called |
| COMMS-05 | Send History tab renders procurement conversations | unit | `cd apps/web && npm test -- --testPathPattern=Communications` | Smoke render — verify 'Procurement Emails' tab present |

## Wave 0 Test Gaps

The following test scaffold files must be created before or alongside implementation:

- [ ] `apps/web/src/hooks/queries/__tests__/useActiveConversationQueries.test.ts` — unit tests for `useActiveConversations` hook (COMMS-02)
- [ ] `apps/api-gateway/src/procurement/procurement.service.spec.ts` (or extend existing) — location guard tests (PROCINT-05) + cancel cascade tests (PROCINT-06)

## End-to-End Verification Checklist

After all plans execute, verify these user-visible flows manually:

1. **Active Conversations panel** — Click Pending KPI card → panel slides in from right with dark indigo-900 background → shows PENDING_APPROVAL conversations with wine name, provider, email type, draft age
2. **Draft age amber warning** — Leave a test conversation > 24h old → it renders with amber styling in the panel
3. **Quick Approve from panel** — Click Quick Approve → conversation disappears from panel on next poll (≤ 30s)
4. **View Full Draft** — Click View Full Draft on a panel card → DraftEmailApprovalPanel opens pre-populated with draft content (WARN-01 fix)
5. **Location guard — backend** — `curl -X PATCH /procurement/orders/{pendingOrderId} -d '{"locationId":"loc-123"}' -H "Authorization: Bearer {token}"` → HTTP 422 with `{"reason":"order_not_approved",...}`
6. **Location guard — frontend** — OrderLocationField component renders as disabled with lock icon + tooltip "Available after order is approved" when order status is PENDING/APPROVAL_NEEDED/NEGOTIATING
7. **Cancel cascade** — Cancel an order with PENDING_APPROVAL conversation → verify `SELECT status FROM procurement_conversations WHERE order_id = $1` returns 'CANCELLED'
8. **Procurement Emails tab** — Navigate to /communications → click "Procurement Emails" tab → shows AI email history with expandable rows
9. **Integrity guards removed** — Create a new order → verify no calendar event appears in calendar page, no inventory stock_live change occurs
10. **Existing tabs preserved** — "Send History", "Templates", "Scheduled Reports" tabs still render their original content

## TypeScript Compilation Gate

All plans must pass TypeScript compilation before merge:

```bash
cd apps/api-gateway && npx tsc --noEmit 2>&1 | grep -i "procurement"
cd apps/web && npx tsc --noEmit 2>&1 | grep -E "Orders|Communications|ActiveConversations|OrderLocation"
```

Both commands must return empty output (0 errors).
