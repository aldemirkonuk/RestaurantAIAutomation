---
phase: 30-calendar-operations-hub
reviewed: 2026-05-12T20:41:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - apps/api-gateway/src/calendar/calendar.service.ts
  - apps/api-gateway/src/calendar/calendar.controller.ts
  - apps/api-gateway/src/calendar/dto/calendar.dto.ts
  - apps/web/src/pages/Dashboard.tsx
  - apps/web/src/pages/Settings.tsx
  - apps/web/src/pages/Calendar.tsx
  - apps/web/src/pages/calendar/CalendarPage.tsx
  - apps/web/src/pages/calendar/CalendarAgenda.tsx
  - apps/web/src/pages/calendar/EventCard.tsx
  - apps/web/src/pages/calendar/useCalendarPage.ts
  - apps/web/src/hooks/queries/useCalendarQueries.ts
  - apps/web/src/services/api/calendar.ts
  - apps/web/src/data/FALLBACK_DATA.ts
  - supabase/migrations/20260512000001_calendar_schema_fix.sql
  - supabase/migrations/20260512000002_calendar_ical_token.sql
findings:
  critical: 7
  warning: 11
  info: 3
  total: 21
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-05-12T20:41:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Phase 30 introduces a solid calendar foundation — the schema migration guards, Supabase-backed CRUD, iCal feed, and React query layer are all well-structured. However, seven blockers require attention before shipping:

- **The iCal RRULE BYDAY field emits integers instead of RFC 5545 day codes**, meaning every weekly recurrence is silently broken for external calendar subscribers.
- **The `EventType` name collision is a TypeScript compilation error** that affects every import of the calendar API service.
- **Multi-day event end dates can never be set or updated** because `buildCreatePayload` reads a non-existent `endDate` field.
- **The `deleteEvent` scope parameters `this_and_future` and `all` are effectively no-ops** — they fall through to a single-row delete without cascading.
- **An `is_recurring=true` parent event can be persisted without a recurrence rule** if the rule insert fails.
- **`createEventType` accepts any `restaurantId` from the request body** — no ownership check against the authenticated user.
- **Date grouping produces wrong calendar day for users east of UTC** due to `.toISOString()` on local-midnight Date objects.

---

## Critical Issues

### CR-01: Invalid BYDAY values in iCal RRULE (RFC 5545 violation)

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:1142`
**Issue:** `days_of_week` stores integers (0 = Sunday … 6 = Saturday), but RFC 5545 RRULE requires two-letter day codes (`MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU`). The current code emits `BYDAY=0,1,2` which is invalid. Google Calendar, Apple Calendar, and Outlook all either reject or silently ignore BYDAY with numeric values, so weekly recurring events will appear as non-recurring in every external subscriber's calendar.

**Fix:**
```typescript
// calendar.service.ts — replace BYDAY generation
const DAY_MAP: Record<number, string> = {
  0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA',
}

if (rule.days_of_week?.length > 0) {
  const dayCodes = rule.days_of_week.map((d: number) => DAY_MAP[d]).filter(Boolean)
  if (dayCodes.length > 0) rrule += `;BYDAY=${dayCodes.join(',')}`
}
```

---

### CR-02: `deleteEvent` ignores `this_and_future` and `all` scopes for child occurrences

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:568-601`
**Issue:** The method only branches on `existingParentEventId && deleteScope === 'this'`. For `deleteScope === 'this_and_future'` or `'all'`, execution falls through to a single-row delete (`eq('id', eventId)`). Since `parent_event_id` is declared `ON DELETE SET NULL` (not `CASCADE`) in the migration, deleting one child does not remove siblings. `deleteRecurringSeries` exists in the service but is never called from this method, so both scope values silently behave identically to an unscoped delete.

**Fix:**
```typescript
// After the 'this' branch, add:
if (existing.parentEventId && deleteScope === 'this_and_future') {
  return this.deleteRecurringSeries(
    restaurantId, userId, existing.parentEventId,
    existing.occurrenceDate || existing.eventDate,
  )
}
if (existing.parentEventId && deleteScope === 'all') {
  return this.deleteRecurringSeries(restaurantId, userId, existing.parentEventId)
}
// Fall through only for non-recurring or when no parentEventId (parent event itself)
```

---

### CR-03: `is_recurring=true` orphan when recurrence rule creation fails

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:126,170-188`
**Issue:** The event insert payload always sets `is_recurring: !!dto.recurrence` before any database call. If the subsequent rule insert on line 164 fails, the code logs the error but continues — leaving a persisted event with `is_recurring = true` but no associated `recurrence_rule_id`. The mapper and client code rely on `isRecurring` to decide whether to load recurrence rules, so this orphaned state causes incorrect behavior on every subsequent read.

**Fix:**
```typescript
if (ruleError) {
  this.logger.error('Failed to create recurrence rule', { eventId: eventData.id, error: ruleError.message })
  // Correct the orphaned is_recurring flag
  await this.databaseService.supabase
    .from('calendar_events')
    .update({ is_recurring: false })
    .eq('id', eventData.id)
} else {
  recurrenceRule = this.mapRecurrenceRule(ruleData)
  // ...existing rule-linked updates
}
```

---

### CR-04: Authorization bypass — `createEventType` accepts any `restaurantId` from body

**File:** `apps/api-gateway/src/calendar/calendar.controller.ts:281-295`
**Issue:** `POST /calendar/event-types` has no `@CurrentUser()` parameter. The `restaurantId` is read from the request body (`CreateEventTypeDto`) and passed directly to the service. Any authenticated user from any restaurant can forge a different `restaurantId` to create event types for another tenant.

**Fix:**
```typescript
@Post('event-types')
async createEventType(
  @Body() dto: CreateEventTypeDto,
  @CurrentUser() user: { userId: string; restaurantId: string },
): Promise<EventTypeResponseDto> {
  // Enforce ownership — ignore any restaurantId in the body
  return await this.calendarService.createEventType({
    ...dto,
    restaurantId: user.restaurantId,
  })
}
```
Apply the same pattern to `updateEventType` and `deleteEventType` (verify restaurant ownership before operating on the ID).

---

### CR-05: Duplicate `EventType` identifier — TypeScript compilation error

**File:** `apps/web/src/services/api/calendar.ts:4,167`
**Issue:** The file exports two declarations with the same name:
- Line 4: `export type EventType = 'delivery' | 'order' | 'meeting' | ...` (string union)
- Line 167: `export interface EventType { id: string; name: string; color: string; icon: string; isCustom: boolean; ... }`

TypeScript raises `error TS2300: Duplicate identifier 'EventType'`. Consumers that import `EventType` expecting the string union receive the interface shape, which is structurally incompatible — `CreateEventInput.type` is typed as the interface but assigned string literals throughout the codebase.

**Fix:**
```typescript
// Rename the entity interface
export interface EventTypeEntity {
  id: string
  name: string
  color: string
  icon: string
  isCustom: boolean
  restaurantId?: string
}
// Update CalendarEvent.type, CreateEventInput.type, etc. to keep the string union
```

---

### CR-06: Multi-day event end date permanently broken — `buildCreatePayload` reads non-existent field

**File:** `apps/web/src/services/api/calendar.ts:112,253`
**Issue:** `buildCreatePayload` sets:
```typescript
eventDateEnd: data.allDay ? undefined : (data as any).endDate,
```
`CreateEventInput` has no `endDate` property — the field does not exist in the interface. `(data as any).endDate` is always `undefined`. Every multi-day event is stored without an end date. The same bug appears in `updateCalendarEvent` line 253 where `(updateData as any).endDate` is also always `undefined`.

**Fix:**
Add `endDate?: string` to `CreateEventInput` (and `UpdateEventInput`), populate it from the event modal, and reference it directly without the type cast:
```typescript
// In buildCreatePayload:
eventDateEnd: data.endDate,  // no allDay gating needed — backend handles it

// In CreateEventInput interface:
endDate?: string   // end date for multi-day events
```

---

### CR-07: Timezone off-by-one for users east of UTC — `toISOString()` on local Date objects

**Files:** `apps/web/src/pages/calendar/useCalendarPage.ts:126`, `apps/web/src/pages/calendar/CalendarAgenda.tsx:92`
**Issue:** Both files compute date keys via `event.date.toISOString().split('T')[0]`. `event.date` was created by `parseLocalDate` as local midnight (e.g., `new Date(2026, 2, 15, 0, 0, 0)`). For users in UTC+1 through UTC+14, `.toISOString()` shifts to the previous UTC day. An event on March 15 appears under March 14 in the calendar grid and agenda grouping for roughly 40% of the world's population.

**Fix:**
```typescript
// Replace .toISOString().split('T')[0] with a timezone-safe key builder:
function toLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// Use in useCalendarPage.ts:126 and CalendarAgenda.tsx:92
```

---

## Warnings

### WR-01: Race condition in `getOrGenerateICalToken`

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:1012-1037`
**Issue:** Two concurrent requests that both observe `calendar_ical_token IS NULL` will each generate a token and call UPDATE. The second write silently overwrites the first. The first client receives a token that is no longer stored, immediately breaking their calendar subscription. A unique constraint on the column (see IN-03) wouldn't prevent this — the fix requires an atomic operation.
**Fix:** Use a DB function or Postgres `UPDATE ... WHERE calendar_ical_token IS NULL RETURNING calendar_ical_token`, retrying if the row was updated by a concurrent request.

---

### WR-02: `this_and_future` split inherits `endAfterCount` without adjustment

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:464-465`
**Issue:** The new recurrence rule for the future series copies `endAfterCount` verbatim from the original. If the original rule has `endAfterCount = 10` and 5 occurrences preceded the split point, the new series generates 10 more events instead of the remaining 5, exceeding the user's intended total.
**Fix:** Count pre-split occurrences and subtract: `endAfterCount: Math.max(1, (existing.recurrenceRule.endAfterCount ?? 0) - preSplitCount)`.

---

### WR-03: iCal `UNTIL` datetime is midnight UTC — last day dropped for UTC+ users

**File:** `apps/api-gateway/src/calendar/calendar.service.ts:1140`
**Issue:** `` `UNTIL=${rule.end_on_date.replace(/-/g, '')}T000000Z` `` produces a DATETIME UNTIL at midnight UTC on the end date. Calendar apps compliant with RFC 5545 exclude occurrences *after* UNTIL, so users in UTC+1 through UTC+14 lose the last occurrence (which falls at 00:00 local = day before midnight UTC).
**Fix:** Use a date-only UNTIL value for date-based events: `` `UNTIL=${rule.end_on_date.replace(/-/g, '')}` ``.

---

### WR-04: UUID validation result computed but never checked

**File:** `apps/api-gateway/src/calendar/calendar.controller.ts:57-62`
**Issue:** `userIdIsUuid` and `restaurantIdIsUuid` are assigned from regex tests but never read. If the intent was to reject non-UUID values before hitting the database, the guard is completely inert.
**Fix:** Either enforce the check or remove the dead code:
```typescript
if (!userIdIsUuid || !restaurantIdIsUuid) {
  throw new HttpException('Invalid user or restaurant ID', HttpStatus.BAD_REQUEST)
}
```

---

### WR-05: Raw database error messages leaked to API clients

**File:** `apps/api-gateway/src/calendar/calendar.controller.ts` (all catch blocks)
**Issue:** Every handler re-throws `new HttpException(error.message, 500)`. Supabase errors include constraint names, table names, and column references. Error responses with database internals aid schema enumeration by attackers.
**Fix:**
```typescript
// In catch blocks, separate internal logging from the client response:
this.logger.error({ message: 'Operation failed', error: error.message, stack: error.stack })
throw new HttpException('An internal error occurred', HttpStatus.INTERNAL_SERVER_ERROR)
```

---

### WR-06: `RecurrenceFrequency.CUSTOM` silently ignored across the entire pipeline

**File:** `apps/api-gateway/src/calendar/dto/calendar.dto.ts:27`
**Issue:** `CUSTOM = 'custom'` is accepted by DTO validation. The DB function stub ignores it, `freqMap` in `getICalFeed` has no entry for `'custom'`, and the frontend `mapRecurrenceToApi` passes it as-is. A user creating a `custom` recurring event gets a success response but zero occurrences are generated and no RRULE appears in the iCal feed, with no error.
**Fix:** Either implement custom frequency or reject it at the DTO level with a validator and a clear `400` response.

---

### WR-07: IDOR — `getEventTypes` exposes any restaurant's types to any authenticated user

**File:** `apps/api-gateway/src/calendar/calendar.controller.ts:263-279`
**Issue:** `GET /calendar/event-types/:restaurantId` takes the target restaurant from the URL with no `@CurrentUser()` authorization check. Any authenticated user can enumerate custom event types for any tenant.
**Fix:** Add `@CurrentUser()` and assert `restaurantId === user.restaurantId`, or derive `restaurantId` solely from the authenticated user.

---

### WR-08: `deleteEventType` / `updateEventType` lack restaurant ownership verification

**File:** `apps/api-gateway/src/calendar/calendar.controller.ts:298-333`
**Issue:** Both endpoints resolve records by UUID alone. Without checking that the event type belongs to the authenticated user's restaurant, any authenticated user who knows (or brute-forces) a UUID can modify or delete another tenant's custom event types.
**Fix:** Pass `user.restaurantId` from `@CurrentUser()` into the service and add an `.eq('restaurant_id', restaurantId)` condition to the Supabase query in the service.

---

### WR-09: `fetchUpcomingEvents` sends `days` param that the controller ignores

**File:** `apps/web/src/services/api/calendar.ts:278-286`
**Issue:** The client calls `/calendar/upcoming?days=N` but `getUpcomingEvents` in the controller has no `@Query('days')` parameter — it hardcodes a 30-day window. The `days` argument is silently discarded, so callers expecting a 7-day window (the default in `useUpcomingEvents`) always receive 30 days.
**Fix:** Either add `@Query('days') days: number = 30` to the controller and plumb it through the service, or remove the dead `days` parameter from the client function.

---

### WR-10: `CalendarSubscriptionSection` reads access token from `localStorage`

**File:** `apps/web/src/pages/Settings.tsx:129,147`
**Issue:** Both `fetchToken()` and `handleRegenerate()` call `localStorage.getItem('accessToken')` to attach a Bearer token. JWT access tokens stored in `localStorage` are accessible to any JavaScript on the page, including injected scripts. The token regeneration action is high-sensitivity (it invalidates all existing subscriptions), making this a meaningful XSS amplification point.
**Fix:** If the project can move to HttpOnly session cookies, do so. As an interim, use the existing `apiClient` (which likely handles auth headers) rather than reading localStorage directly.

---

### WR-11: `handleModalSave` silently discards recurrence data on update

**File:** `apps/web/src/pages/calendar/CalendarPage.tsx:177-190`
**Issue:** When `editingEvent` is set, `updateEvent.mutate(...)` is called without passing the `recurring` field from `data.recurrence`. Users who open the edit modal and modify a recurrence rule will see a success toast but their changes are never sent to the API.
**Fix:** Add `recurring: data.recurrence as RecurringConfig | undefined` to the `updateEvent.mutate(...)` call, matching how the `createEvent` path handles it.

---

## Info

### IN-01: `EventCard.tsx` — duplicate CSS rule for `approved` status (blue overrides green)

**File:** `apps/web/src/pages/calendar/EventCard.tsx:141-142`
**Issue:** Two consecutive lines both check `event.status === 'approved'` and apply conflicting Tailwind classes: first `bg-green-100 text-green-600`, then `bg-blue-100 text-blue-600`. Both classes are present in the class string; blue wins via source order. If green styling was intended for `approved`, the second line is a copy-paste mistake.
**Fix:** Remove the duplicate `approved` condition (line 142) and keep the green variant.

---

### IN-02: `calendar_ical_token` index is not UNIQUE

**File:** `supabase/migrations/20260512000002_calendar_ical_token.sql:11`
**Issue:** The migration creates a plain `CREATE INDEX` — not `UNIQUE`. While the 64-byte entropy makes accidental collision near-impossible, a `UNIQUE` constraint would enforce the single-owner semantic at the DB level and prevent silent overwrite bugs from the race condition in WR-01.
**Fix:** Replace with `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurants_calendar_ical_token ...`

---

### IN-03: `FALLBACK_CALENDAR_EVENTS` missing `allDay` field

**File:** `apps/web/src/data/FALLBACK_DATA.ts:31-43`
**Issue:** The fallback event object does not include an `allDay` field, which is required at the API response level (the service always returns it). The `CalendarEvent` interface marks it `allDay?: boolean` (optional), so this won't cause a runtime crash, but the fallback event will behave as `allDay = undefined` rather than `false`, potentially rendering without time display in dev mode.
**Fix:** Add `allDay: false` to the fallback event object.

---

_Reviewed: 2026-05-12T20:41:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
