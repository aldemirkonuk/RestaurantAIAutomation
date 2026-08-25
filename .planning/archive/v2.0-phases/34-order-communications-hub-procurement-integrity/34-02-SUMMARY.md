---
phase: 34-order-communications-hub-procurement-integrity
plan: "02"
subsystem: procurement
tags: [procurement, location-guard, conversation-read, integrity, frontend]
dependency_graph:
  requires: []
  provides:
    - "PATCH /procurement/orders/:id rejects locationId on pending-status orders (HTTP 422)"
    - "cancelOrder cascades PENDING_APPROVAL conversations to CANCELLED (non-fatal)"
    - "GET /procurement/conversations/active with order+provider join"
    - "GET /procurement/conversations/history for completed conversations"
    - "OrderLocationField component with disabled guard for pending orders"
  affects:
    - apps/api-gateway/src/procurement/dto/procurement.dto.ts
    - apps/api-gateway/src/procurement/procurement.service.ts
    - apps/api-gateway/src/procurement/procurement.controller.ts
    - apps/web/src/services/api/types.ts
    - apps/web/src/components/orders/OrderLocationField.tsx
tech_stack:
  added: []
  patterns:
    - UnprocessableEntityException for domain rule violations (HTTP 422 with structured error body)
    - Non-fatal cascade pattern (try/catch + logger.warn for non-critical side effects)
    - JWT-scoped read endpoints (restaurantId from CurrentUser only, never query params)
key_files:
  created:
    - apps/web/src/components/orders/OrderLocationField.tsx
  modified:
    - apps/api-gateway/src/procurement/dto/procurement.dto.ts
    - apps/api-gateway/src/procurement/procurement.service.ts
    - apps/api-gateway/src/procurement/procurement.controller.ts
    - apps/web/src/services/api/types.ts
decisions:
  - "D-06 enforced server-side: UnprocessableEntityException with reason:'order_not_approved' for PENDING/APPROVAL_NEEDED/NEGOTIATING orders"
  - "D-07 enforced client-side: OrderLocationField disabled with tooltip for blocked statuses, mirroring backend enum"
  - "D-08/D-10: conversation read endpoints scoped by JWT restaurantId only (T-34-02-02 mitigated)"
  - "cancelOrder cascade is non-fatal: warn log on failure, order cancellation proceeds"
  - "HttpException passthrough in updateOrder controller preserves 422 status code to client"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-17"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 5
---

# Phase 34 Plan 02: Procurement Integrity Guards + Conversation Read Endpoints Summary

**One-liner:** HTTP 422 location guard on pending orders, cancel cascade for conversations, and two JWT-scoped GET endpoints for active/history conversation data.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | locationId to DTO + location guard + cancel cascade + controller passthrough | `ffcfb72` | dto, service, controller |
| 2 | getActiveConversations + getConversationHistory service methods + 2 GET endpoints | `9005ffb` | service, controller |
| 3 | locationId in UpdateOrderRequest + OrderLocationField component | `d01353f` | types.ts, OrderLocationField.tsx |

## What Was Built

### Task 1: Procurement State Machine Guards

**UpdateOrderDto** — added `locationId?: string` field with `@IsString @IsOptional` validators.

**Location guard in `updateOrder`** — before `updatePayload` construction, when `dto.locationId` is set, fetches the current order status and throws `UnprocessableEntityException` with `{ reason: 'order_not_approved', message: '...' }` if status is `PENDING`, `APPROVAL_NEEDED`, or `NEGOTIATING`. Mitigates T-34-02-01.

**`location_id`** added to `updatePayload` map so it persists to DB when guard passes.

**cancelOrder conversation cascade** — after updating order to CANCELLED, updates `procurement_conversations` rows with `status = 'PENDING_APPROVAL'` for the same `order_id` to `CANCELLED`. Wrapped in try/catch; failures are logged as `warn` and do not throw. Implements D-10.

**Controller HttpException passthrough** — `updateOrder` catch block now checks `if (error instanceof HttpException) throw error` before wrapping in 500, so the 422 from the service propagates correctly to the client.

### Task 2: Conversation Read Endpoints

**`getActiveConversations(restaurantId)`** — queries `procurement_conversations` with `status = PENDING_APPROVAL`, joins with `procurement_orders!inner` (order_number, quantity, quoted_price, wine_name) and `providers!left` (name). Maps rows to camelCase DTO including `draftContent` (from `content` column) for pre-populating `DraftEmailApprovalPanel`.

**`getConversationHistory(restaurantId)`** — queries conversations with status `IN ('AUTO_SENT', 'APPROVED', 'SENT', 'COMPLETED', 'CLOSED')`, limit 100, with full order+provider join. Includes `sentAt` (fallback to `createdAt`), `rollingSummary`, and `draftContent`.

**Controller endpoints** — `GET conversations/active` and `GET conversations/history`, both with `@UseGuards(JwtAuthGuard)` and `@CurrentUser()`. restaurantId sourced exclusively from JWT (T-34-02-02 mitigated).

### Task 3: Frontend Location Guard

**`UpdateOrderRequest`** in `types.ts` — added `locationId?: string`.

**`OrderLocationField` component** — location assignment select with:
- `LOCATION_BLOCKED_STATUSES` list mirroring backend enum (both cased variants)
- `disabled` on `<select>` when `isBlocked || isUpdating`
- `Lock` icon overlay (pointer-events-none) when blocked
- Hover tooltip "Available after order is approved" (D-07)
- Accessible: `aria-label`, `aria-describedby`, `role="tooltip"`

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-34-02-01 | MITIGATED | Backend 422 guard fetches current order status before allowing locationId update |
| T-34-02-02 | MITIGATED | Both GET endpoints use `user.restaurantId` from `@CurrentUser()` JWT; no query param accepted |
| T-34-02-03 | ACCEPTED | JwtAuthGuard on all procurement endpoints; role-based access enforced at route level |
| T-34-02-04 | ACCEPTED | Race condition accepted as low risk for manual manager action |

## Known Stubs

None — all methods return real data from Supabase queries. No placeholder values in the data path.

## Self-Check: PASSED

**Files created:**
- `apps/web/src/components/orders/OrderLocationField.tsx` ✓

**Files modified:**
- `apps/api-gateway/src/procurement/dto/procurement.dto.ts` — `locationId` field ✓
- `apps/api-gateway/src/procurement/procurement.service.ts` — guard + cascade + read methods ✓
- `apps/api-gateway/src/procurement/procurement.controller.ts` — passthrough + 2 endpoints ✓
- `apps/web/src/services/api/types.ts` — `locationId` in `UpdateOrderRequest` ✓

**Commits verified:**
- `ffcfb72` — Task 1 ✓
- `9005ffb` — Task 2 ✓
- `d01353f` — Task 3 ✓

**TypeScript:** `apps/api-gateway` — 0 errors ✓ | `apps/web` — pre-existing errors only, none in modified files ✓
