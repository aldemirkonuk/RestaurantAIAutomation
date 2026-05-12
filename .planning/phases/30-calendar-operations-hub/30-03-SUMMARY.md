---
phase: 30-calendar-operations-hub
plan: "03"
subsystem: api
tags: [calendar, ical, ical-generator, subscription-feed, public-endpoint, token]
dependency_graph:
  requires:
    - 30-01 (calendar schema — restaurants.calendar_ical_token column)
    - 30-02 (calendar service column fixes — start_date/end_date/start_time/end_time)
  provides:
    - calendar.service.ts: getICalFeed(), getOrGenerateICalToken(), regenerateICalToken()
    - calendar.controller.ts: GET /calendar/feed/:token.ics (@Public), GET /calendar/ical-token, POST /calendar/ical-token/regenerate
    - calendar.dto.ts: ICalTokenResponseDto
  affects:
    - GET /calendar/feed/:token.ics — new public endpoint, no auth header required
    - GET /calendar/ical-token — authenticated, lazy-creates token for restaurant
    - POST /calendar/ical-token/regenerate — authenticated, invalidates old subscriptions
tech_stack:
  added:
    - ical-generator ^10.2.0
  patterns:
    - RFC 5545 iCal generation with ical-generator library
    - crypto.randomBytes(32).toString('hex') for 256-bit token entropy
    - @Public() decorator bypasses JwtAuthGuard.canActivate() on feed endpoint
    - Empty-calendar-on-invalid-token (avoids leaking token validity via HTTP status)
    - RRULE attachment for recurring parent events (native recurrence in Outlook/Apple/Google Calendar)
key_files:
  created: []
  modified:
    - apps/api-gateway/src/calendar/calendar.service.ts
    - apps/api-gateway/src/calendar/calendar.controller.ts
    - apps/api-gateway/src/calendar/dto/calendar.dto.ts
    - apps/api-gateway/package.json
decisions:
  - "Empty calendar (not 404) returned for invalid tokens — T-30-09 mitigation, avoids exposing token validity"
  - "Only parent events selected for iCal feed (parent_event_id IS NULL) — RRULE in feed lets subscribers expand recurrence natively"
  - "RRULE built as raw string and passed to calEvent.repeating() because ical-generator v10 API wraps raw RRULE strings directly"
  - "ICalTokenResponseDto count-1 in DTO file is expected (class declared once) — same plan-spec inconsistency pattern as Plan 02"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-12"
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 4
---

# Phase 30 Plan 03: iCal Subscription Feed Summary

**One-liner:** Installed `ical-generator` and implemented a public RFC 5545 iCal subscription feed at `GET /calendar/feed/:token.ics` — keyed by a 256-bit hex token stored in `restaurants.calendar_ical_token` — plus authenticated endpoints to get and regenerate the token, enabling zero-OAuth calendar subscriptions in Outlook/Apple Calendar/Google Calendar.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install ical-generator + service methods | b874c37 | apps/api-gateway/src/calendar/calendar.service.ts, apps/api-gateway/package.json, pnpm-lock.yaml |
| 2 | Controller endpoints + ICalTokenResponseDto | 1570203 | apps/api-gateway/src/calendar/calendar.controller.ts, apps/api-gateway/src/calendar/dto/calendar.dto.ts |

## What Was Built

### Task 1: `calendar.service.ts` + `package.json`

**ical-generator installed:**
- `pnpm add ical-generator --filter api-gateway` → `^10.2.0` in dependencies

**New imports added:**
- `import ical from 'ical-generator'`
- `import * as crypto from 'crypto'`

**Three service methods added:**

`getOrGenerateICalToken(restaurantId)`:
- Queries `restaurants.calendar_ical_token`; returns existing token if present
- Otherwise generates `crypto.randomBytes(32).toString('hex')` (256-bit / 64-char) and stores it

`regenerateICalToken(restaurantId)`:
- Always generates a fresh `crypto.randomBytes(32).toString('hex')` token
- Overwrites existing token, invalidating all previous subscriptions

`getICalFeed(token)`:
- Looks up restaurant by `calendar_ical_token = token`; returns empty `VCALENDAR` for invalid tokens (T-30-09)
- Fetches all parent events (`parent_event_id IS NULL`) with date/time/status fields
- Fetches recurrence rules for recurring parents from `calendar_recurrence_rules`
- Builds RFC 5545 `VCALENDAR` with `VEVENT` for each event (DTSTART, DTEND, SUMMARY, UID, STATUS)
- Maps event status to RFC 5545 STATUS: `cancelled/dismissed → CANCELLED`, `pending → TENTATIVE`, otherwise `CONFIRMED`
- For all-day events: DTEND is next day per RFC 5545 exclusive-end convention
- Attaches `RRULE` to recurring events using `FREQ/INTERVAL/UNTIL/COUNT/BYDAY` components

### Task 2: `calendar.controller.ts` + `calendar.dto.ts`

**New controller imports:**
- `Res` from `@nestjs/common`
- `Response` from `express`
- `Public` from `../auth/decorators/public.decorator`
- `ICalTokenResponseDto` from `./dto/calendar.dto`

**Three endpoints added:**

`GET /calendar/feed/:token.ics` (`@Public()`):
- Bypasses `JwtAuthGuard` via `@Public()` decorator
- Calls `getICalFeed(token)` and sends with `Content-Type: text/calendar; charset=utf-8`
- Sets `Cache-Control: no-cache, no-store` and `Content-Disposition: attachment; filename="wineops-calendar.ics"`

`GET /calendar/ical-token` (JWT-authenticated):
- Returns `{ token, feedUrl }` via `getOrGenerateICalToken(user.restaurantId)`
- feedUrl is `/api/v1/calendar/feed/<token>.ics`

`POST /calendar/ical-token/regenerate` (JWT-authenticated):
- Returns fresh `{ token, feedUrl }` via `regenerateICalToken(user.restaurantId)`

**`ICalTokenResponseDto` added to `calendar.dto.ts`:**
- `token: string` — 64-char hex token
- `feedUrl: string` — full subscription URL

## Deviations from Plan

None — plan executed exactly as written.

### Plan Spec Inconsistency (non-blocking)

**[Note] `grep -c "ICalTokenResponseDto" calendar.dto.ts` returns 1, not ≥2**
- **Issue:** The acceptance criterion expected ≥2 occurrences ("class def + property") but the class name only appears once in the file (in the `export class` declaration). Properties `token` and `feedUrl` don't contain the class name.
- **Resolution:** Verified the class is correctly defined with both properties. Identical pattern to Plan 02 spec inconsistency.
- **Impact:** None — code is correct.

## Success Criteria Verification

| Criterion | Result |
|-----------|--------|
| `ical-generator` in apps/api-gateway/package.json | ✅ `^10.2.0` |
| `getICalFeed`, `getOrGenerateICalToken`, `regenerateICalToken` in CalendarService | ✅ 3 methods |
| `crypto.randomBytes(32)` appears twice (get + regenerate) | ✅ 2 |
| `@Public()` on feed endpoint only | ✅ 1 occurrence |
| `text/calendar` header set | ✅ 1 occurrence |
| `ical-token/regenerate` endpoint present | ✅ 1 occurrence |
| `ICalTokenResponseDto` exported from dto | ✅ present |
| `npx tsc --noEmit` exits 0 | ✅ PASSED |

## Threat Model Coverage

| Threat ID | Disposition | Implementation |
|-----------|-------------|----------------|
| T-30-07 | mitigate | `Cache-Control: no-cache, no-store` set on feed response; log exclusion documented for ops |
| T-30-08 | accept | `crypto.randomBytes(32)` = 2^256 entropy; brute force infeasible |
| T-30-09 | mitigate | Empty VCALENDAR returned for invalid tokens — HTTP 200, no status-code leak |
| T-30-10 | mitigate | Feed query is scoped to the restaurant owning the token |

## Known Stubs

None — all three service methods are fully implemented with live Supabase queries.

## Threat Flags

None — the new `/calendar/feed/:token.ics` endpoint was already in the plan's threat model (T-30-07 through T-30-10).

## Self-Check: PASSED

- [x] `apps/api-gateway/src/calendar/calendar.service.ts` modified — `getICalFeed` present
- [x] `apps/api-gateway/src/calendar/calendar.controller.ts` modified — `@Public()` on feed endpoint
- [x] `apps/api-gateway/src/calendar/dto/calendar.dto.ts` modified — `ICalTokenResponseDto` present
- [x] `apps/api-gateway/package.json` modified — `ical-generator ^10.2.0` present
- [x] Commit `b874c37` exists (Task 1)
- [x] Commit `1570203` exists (Task 2)
- [x] `npx tsc --noEmit` exits 0 — no TypeScript errors
