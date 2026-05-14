---
phase: 24-provider-communication-pipeline-email-intelligence
plan: "02"
subsystem: api-gateway / communications
tags: [gmail-watch, rabbitmq, email-routing, direction-detection, bug-fix]
dependency_graph:
  requires: [24-01]
  provides: [email.inbound.raw routing key, direction field, gmail_thread_id in every message]
  affects: [EmailIntelAgent queue subscription, communications pipeline]
tech_stack:
  added: []
  patterns: [service-owns-publish pattern, direction from server-authoritative labelIds]
key_files:
  modified:
    - apps/api-gateway/src/communications/gmail-watch.service.ts
    - apps/api-gateway/src/communications/communications.controller.ts
decisions:
  - Moved publish logic from CommunicationsController into GmailWatchService.fetchNewMessages() to satisfy routing key + direction detection in service layer
  - direction derived from fullMessage.data.labelIds (server-authoritative, not header-spoofable — mitigates T-24-02-01)
  - OrchestratorService injected into GmailWatchService (OrchestratorModule already imported in CommunicationsModule)
metrics:
  duration: ~8 minutes
  completed: 2026-05-13T00:38:00Z
  tasks_completed: 1/1 (auto tasks)
  files_changed: 2
---

# Phase 24 Plan 02: Gmail Watch SENT Expansion + Direction Detection Summary

**One-liner:** Fixed three blocking bugs in gmail-watch.service.ts — removed INBOX-only labelId filter, added server-authoritative direction detection, and changed routing key from email.inbound.received to email.inbound.raw with gmail_thread_id + labelIds in every published message.

---

## Tasks Completed

| Task | Commit | Files |
|------|--------|-------|
| 1: Fix fetchNewMessages — remove INBOX filter, add direction detection, update routing key | `c462e17` | gmail-watch.service.ts, communications.controller.ts |

---

## What Was Built

### Bug 1: INBOX-only labelId filter removed
`history.list()` previously had `labelId: 'INBOX'` which silently excluded SENT messages from the history query. Removed this parameter entirely. Gmail API now returns both INBOX and SENT message additions.

### Bug 2: Direction detection added
After fetching `fullMessage`, direction is computed from the server-authoritative `labelIds` array:
```typescript
const labelIds: string[] = (fullMessage.data.labelIds as string[]) || [];
const direction: 'inbound' | 'outbound' =
  labelIds.includes('SENT') && !labelIds.includes('INBOX') ? 'outbound' : 'inbound';
```
This satisfies the T-24-02-01 threat mitigation (direction from Gmail API, not email header).

### Bug 3: Routing key updated + payload enriched
Changed from `email.inbound.received` → `email.inbound.raw`. Each published message now includes:
- `direction: 'inbound' | 'outbound'`
- `labelIds: string[]` (raw Gmail labels)
- `gmail_thread_id: string` (was already in controller, now in service)

### Architecture change: publish moved to GmailWatchService
The body extraction + header extraction + `publishEvent` call was moved from `CommunicationsController` into `GmailWatchService.fetchNewMessages()`. The controller now calls `fetchNewMessages()` and the service handles publishing internally. This avoids double-publishing and keeps routing key ownership in the service layer.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved publish from controller to service**
- **Found during:** Task 1
- **Issue:** `publishEvent('email.inbound.received', ...)` lived in `CommunicationsController`, not `gmail-watch.service.ts`. The plan's acceptance criteria required `email.inbound.raw`, `direction`, and `gmail_thread_id` in `gmail-watch.service.ts`. Leaving the publish in the controller would have caused double-publishing (once in service, once in controller) and failed the acceptance criteria.
- **Fix:** Injected `OrchestratorService` into `GmailWatchService` (constructor injection; `OrchestratorModule` was already imported in `CommunicationsModule`). Moved full header/body extraction + publish into `fetchNewMessages()`. Removed the now-redundant for-loop and `email.inbound.received` publish from `CommunicationsController`.
- **Files modified:** both `gmail-watch.service.ts` and `communications.controller.ts`
- **Commit:** `c462e17`

**2. [Rule 1 - Bug] Removed sender-email pre-filter from controller**
- **Found during:** Task 1
- **Issue:** Controller had `if (from.includes(senderEmail)) { continue; }` — this silently dropped our own SENT emails from the pipeline, contradicting D-01 ("no pre-filtering by sender") and D-02 (SENT messages should reach EmailIntelAgent for direction=outbound classification).
- **Fix:** Removed the filter. Direction detection now communicates outbound status to EmailIntelAgent via the `direction` field.
- **Commit:** `c462e17` (part of same fix)

---

## Checkpoint Status

**Pending: checkpoint:human-verify (gate=blocking)**

The Railway env var update (`GMAIL_WATCH_LABEL_IDS=INBOX,SENT`) is a deploy step that should be applied before Plan 24-04 execution. Type **"watch fixed"** after confirming the grep checks below pass.

**Verification commands:**
```bash
# Must be 0 (INBOX filter removed):
grep -c "labelId: 'INBOX'" apps/api-gateway/src/communications/gmail-watch.service.ts

# Must be ≥1 (new routing key):
grep "email.inbound.raw" apps/api-gateway/src/communications/gmail-watch.service.ts

# Must be 0 (old key gone from service):
grep "email.inbound.received" apps/api-gateway/src/communications/gmail-watch.service.ts

# TypeScript build:
cd apps/api-gateway && npx tsc --noEmit
```

All four checks pass as of commit `c462e17`.

---

## Known Stubs

None — all changes are functional code edits with no placeholder data.

---

## Threat Surface Scan

No new network endpoints introduced. The routing key change (`email.inbound.received` → `email.inbound.raw`) is an internal RabbitMQ routing change with no external trust boundary impact. T-24-02-01 mitigation (direction from server-authoritative labelIds) is implemented as planned.

---

## Self-Check: PASSED

- `c462e17` exists in git log ✓
- `gmail-watch.service.ts` modified ✓
- `communications.controller.ts` modified ✓
- All acceptance criteria grep checks pass ✓
- TypeScript compiles without errors ✓
