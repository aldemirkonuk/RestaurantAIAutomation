---
phase: 32-provider-outbound-communication-engine
plan: "04"
subsystem: api-gateway
tags:
  - nestjs
  - procurement
  - providers
  - rabbitmq
  - intelligence
dependency_graph:
  requires:
    - 32-01
    - 32-02
  provides:
    - procurement.order.created RabbitMQ event (consumed by 32-03 Python agent)
    - provider.draft.approved / provider.draft.discarded events
    - GET/PATCH /providers/:id/intelligence
    - POST /providers/:id/retroactive-order
    - GET/POST /procurement/orders/:id/draft endpoints
  affects:
    - 32-05 (frontend depends on all new endpoints)
    - 32-03 (Python agent triggered by procurement.order.created)
tech_stack:
  added:
    - ApproveDraftDto (class-validator MaxLength guards on modifiedContent)
    - UpdateIntelligenceDto (profile_foundational / profile_dynamic JSONB)
    - RetroactiveOrderDto (off-app invoice ingestion shape)
  patterns:
    - fire-and-forget RabbitMQ via orchestratorService.publishEvent wrapped in try/catch
    - restaurant_id JWT-scoped DB queries (.eq('restaurant_id', restaurantId))
    - dual-service pattern: new methods in both ProviderIntelligenceService + ProvidersService
key_files:
  created:
    - apps/api-gateway/src/procurement/dto/approve-draft.dto.ts
    - apps/api-gateway/src/providers/dto/update-intelligence.dto.ts
    - apps/api-gateway/src/providers/dto/retroactive-order.dto.ts
  modified:
    - apps/api-gateway/src/procurement/procurement.service.ts
    - apps/api-gateway/src/procurement/procurement.controller.ts
    - apps/api-gateway/src/providers/providers.service.ts
    - apps/api-gateway/src/providers/providers.controller.ts
    - apps/api-gateway/src/providers/provider-intelligence.service.ts
decisions:
  - "Added intelligence methods to both ProvidersService and ProviderIntelligenceService — ProvidersService owns the controller-facing methods; ProviderIntelligenceService owns the authoritative implementation for the ProviderIntelligenceController."
  - "createRetroactiveOrder creates 3 rows atomically: procurement_orders (source=retroactive), procurement_conversations (INBOUND), order_interactions (invoice_received) — conversation+interaction failures are non-fatal warns to avoid blocking order creation."
  - "procurement.order.created publish is fire-and-forget wrapped in try/catch — order creation is never failed due to MQ unavailability."
metrics:
  duration: "~10 minutes"
  completed_date: "2026-05-14"
  tasks_completed: 4
  files_changed: 8
---

# Phase 32 Plan 04: NestJS API Layer for Provider Outbound Communication — Summary

**One-liner:** JWT-guarded draft management + provider intelligence CRUD endpoints wired to `procurement_conversations` table and RabbitMQ `procurement.order.created` event trigger.

## What Was Built

### Task 1 — 3 DTO files (`b09e38b`)
- **`approve-draft.dto.ts`**: `ApproveDraftDto` with `modifiedContent` (MaxLength 5000) and `managerNotes` (MaxLength 500) — satisfies T-32-04-03 tamper mitigation.
- **`update-intelligence.dto.ts`**: `UpdateIntelligenceDto` with `profile_foundational` and `profile_dynamic` as optional JSONB objects.
- **`retroactive-order.dto.ts`**: `RetroactiveOrderDto` with `wineName` (required), `quantity`, `finalConfirmedCost`, `invoiceDate`, `invoiceNumber`, `rawInvoiceContent`.

### Task 2 — `procurement.service.ts` (`922a4b0`)
- `createOrder()`: After emitting the order change event, fires `procurement.order.created` to RabbitMQ `procurement.events` exchange when `dto.providerId` is set. Non-fatal on failure.
- `approveDraft()`: Updates `procurement_conversations` to `APPROVED`, stamps `sent_at`, optionally updates `content`, then publishes `provider.draft.approved`.
- `discardDraft()`: Updates status to `DISCARDED`, publishes `provider.draft.discarded`.
- `editDraft()`: Updates `content` without touching `status` (PENDING_APPROVAL preserved).
- `getPendingDraft()`: Returns latest `PENDING_APPROVAL` conversation row for an order (null-safe).

### Task 3 — `procurement.controller.ts` (`66185a1`)
Four new endpoints added after existing `approveOrder`:
- `POST orders/:id/approve-draft` — calls `procurementService.approveDraft()`
- `POST orders/:id/discard-draft` — calls `procurementService.discardDraft()`
- `PATCH orders/:id/draft` — calls `procurementService.editDraft()` with `dto.modifiedContent`
- `GET orders/:id/draft` — calls `procurementService.getPendingDraft()`

All guarded by `@UseGuards(JwtAuthGuard)`, scoped to `user.restaurantId`.

### Task 4 — Intelligence service + providers (`c374699`)
**`provider-intelligence.service.ts`** — new Phase 32 methods appended:
- `getIntelligence(providerId, restaurantId)`: SELECT `profile_foundational, profile_dynamic` from `providers`
- `updateIntelligence(providerId, restaurantId, dto)`: PATCH `profile_foundational`/`profile_dynamic`
- `getProfileSummary(profileDynamic)`: Pure function returning top-3 badge pill dimensions (priority: response_speed > negotiation_style > relationship_tier)
- `createRetroactiveOrder(providerId, restaurantId, dto)`: Inserts to `procurement_orders` (status=delivered, source=retroactive), `procurement_conversations` (INBOUND), `order_interactions` (invoice_received)

**`providers.service.ts`** — same 4 methods added for use by `ProvidersController`.

**`providers.controller.ts`** — 4 new endpoints:
- `GET :id/intelligence` → profile_foundational + profile_dynamic
- `PATCH :id/intelligence` → update profile_foundational
- `GET :id/intelligence/summary` → top-3 badge pills
- `POST :id/retroactive-order` → D-32-15 Scenario C

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `b09e38b` | feat(32-04): add ApproveDraftDto, UpdateIntelligenceDto, RetroactiveOrderDto |
| 2 | `922a4b0` | feat(32-04): createOrder publishes procurement.order.created + add draft management methods |
| 3 | `66185a1` | feat(32-04): add draft management endpoints to ProcurementController |
| 4 | `c374699` | feat(32-04): provider intelligence CRUD + retroactive order endpoint |

## Verification Results

| Check | Command | Result |
|-------|---------|--------|
| procurement.order.created published | grep -c "procurement.order.created" procurement.service.ts | 2 (publishEvent + error log) ✓ |
| approve-draft endpoint | grep -c "approve-draft" procurement.controller.ts | 2 ✓ |
| intelligence endpoints | grep -c "intelligence" providers.controller.ts | 10 ✓ |
| provider-intelligence.service.ts exists | ls | ✓ |
| TypeScript compilation | npx tsc --noEmit | 0 errors ✓ |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Discovery] ProviderIntelligenceController already existed**
- **Found during:** Task 4 setup
- **Issue:** `provider-intelligence.controller.ts` and `provider-intelligence.service.ts` already existed from a prior Wave 1 commit (knowledge graph, promotions, sessions, sentiment). The plan treated them as new files to create.
- **Fix:** Added Phase 32 methods (`getIntelligence`, `updateIntelligence`, `getProfileSummary`, `createRetroactiveOrder`) as new methods at the end of the existing service. The controller endpoints were added to `providers.controller.ts` (as planned), using `providers.service.ts` wrapper methods.
- **Files modified:** `provider-intelligence.service.ts` (extended), `providers.service.ts` (new methods), `providers.controller.ts` (4 new endpoints)
- **No behavior change** to existing knowledge/promotions/sessions endpoints.

**2. [Rule 2 - Missing critical functionality] Dual-service pattern for retroactive-order**
- **Issue:** The plan's note said "If DatabaseService cannot be injected into controller directly, move createRetroactiveOrder into ProvidersService." Since `ProvidersController` only has `ProvidersService` injected (not `ProviderIntelligenceService`), retroactive order logic was implemented in `ProvidersService` directly (not delegated to `ProviderIntelligenceService`).
- **Both services now have the implementation** — `ProviderIntelligenceService` (used by `ProviderIntelligenceController`) and `ProvidersService` (used by `ProvidersController`). No code is "dead" — they serve different controller paths.

## Known Stubs

None — all methods make live DB queries. No hardcoded empty values flowing to UI.

## Threat Surface Scan

All threat mitigations from the plan's STRIDE register are present:
- T-32-04-01: `@UseGuards(JwtAuthGuard)` + `.eq('restaurant_id', restaurantId)` on all new endpoints ✓
- T-32-04-02: `provider.draft.approved` published to RabbitMQ for agent audit logging ✓
- T-32-04-03: `@MaxLength(5000)` on `ApproveDraftDto.modifiedContent` ✓
- T-32-04-04: retroactive order endpoint accepts but does not enforce fuzzy matching — score enforcement remains in frontend/agent (as designed) ✓
- T-32-04-05: profile_foundational JSONB access restricted by `.eq('restaurant_id', restaurantId)` ✓

No new unplanned trust boundaries introduced.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| approve-draft.dto.ts exists | ✓ FOUND |
| update-intelligence.dto.ts exists | ✓ FOUND |
| retroactive-order.dto.ts exists | ✓ FOUND |
| provider-intelligence.service.ts exists | ✓ FOUND |
| Commit b09e38b (DTOs) | ✓ FOUND |
| Commit 922a4b0 (procurement.service.ts) | ✓ FOUND |
| Commit 66185a1 (procurement.controller.ts) | ✓ FOUND |
| Commit c374699 (intelligence + providers) | ✓ FOUND |
