# Phase 30: Calendar Operations Hub — Research

**Researched:** 2026-05-12
**Domain:** NestJS + Supabase calendar system — bug fixes, schema migration, iCal RFC 5545 feed
**Confidence:** HIGH (all findings codebase-verified)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (LOCKED)** Column name alignment: update service code to match migration (`start_date`, `start_time`, `end_date`, `end_time`). Column mapping: `event_date → start_date`, `event_date_end → end_date`, `event_time → start_time`.
- **D-02 (LOCKED)** Status enum alignment: remove `confirmed` from frontend; use `approved` as the confirmed state. Map display label "Confirmed" → enum value `approved`.
- **D-03 (LOCKED)** Color persistence: add `color VARCHAR(7)` column via migration; wire through insertPayload, updatePayload, mapCalendarEvent(), CalendarEventRow interface.
- **D-04 (LOCKED)** End time persistence: map `endTime` in `buildCreatePayload` and `updateCalendarEvent` in `calendar.ts`; add `eventTimeEnd` to `UpdateCalendarEventDto`.
- **D-05 (LOCKED)** Recurring `this_and_future` scope: implement the TODO at calendar.service.ts ~line 388. Split series: (a) set `end_on_date` of existing rule to `occurrence_date - 1 day`, (b) create new recurrence rule starting at `occurrence_date`, (c) create new parent event.
- **D-06 (LOCKED)** Dashboard "Add Event": Option A — navigate to `/calendar?openModal=true&date={selectedDate}`. CalendarPage reads param in `useEffect` → `openCreateModal(date)`.
- **D-07 (LOCKED)** New endpoint: `GET /api/v1/calendar/feed/:restaurantToken.ics` — no auth header, RFC 5545 compliant iCal feed.
- **D-08 (LOCKED)** Token: `calendar_ical_token VARCHAR(64)` on `restaurants` table. Generated as `crypto.randomBytes(32).toString('hex')`.
- **D-09 (LOCKED)** iCal format via `ical-generator` npm package.
- **D-10 (LOCKED)** Settings UI: "Calendar Subscription" section in Settings. URL display + Copy + Regenerate Token.
- **D-11 (LOCKED)** Dashboard: small calendar icon button copies iCal URL to clipboard with toast.
- **D-12 (LOCKED)** Fix dashboard calendar widget date range params (broken by D-01 column fix).
- **D-13 (LOCKED)** After planning: generate 2 UI sketches (EventModal + Settings calendar section).

### Claude's Discretion
None specified — all key decisions are locked.

### Deferred Ideas (OUT OF SCOPE)
- Microsoft OAuth / Google Calendar two-way sync
- Event-driven procurement signals (Phase 31)
- Sales calendar redesign
- CalDAV server (read-only iCal subscription is sufficient)
- Push notifications
</user_constraints>

---

## Summary

Phase 30 is a targeted bug-fix + feature sprint for the WineOps calendar system. Codebase audit reveals the confirmed bugs are real and fully traced to their exact lines. There is one **critical undisclosed schema gap** larger than the CONTEXT described: the `calendar_events` table in the baseline migration is missing 8 columns the service code inserts/reads, and the `calendar_recurrence_rules` / `calendar_recurrence_exceptions` tables have both renamed columns AND missing columns compared to the service interface. The `generate_recurring_events` Postgres RPC function called by the service does not exist in any migration.

The fix strategy remains correct: update service code to use `start_date/start_time/end_date/end_time` (D-01) + write a comprehensive migration that adds all missing columns and fixes the recurrence table schemas. The migration is more work than D-01 implied — it needs to patch 3 tables, not just one.

For the iCal feed: `ical-generator` is NOT installed in `apps/api-gateway` and needs to be added. The `@Public()` decorator pattern already exists in the codebase and is the correct approach for the unauthenticated feed endpoint. All other machinery (NestJS module, controller, service) is in place.

**Primary recommendation:** Plan 5 focused work areas — (1) DB migration, (2) service layer fixes, (3) frontend status/endtime fixes, (4) iCal backend, (5) iCal frontend UI. The biggest complexity risk is the comprehensive schema migration.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Column name fix (D-01) | API / Backend (NestJS service) | DB migration | Service code updated to match migration column names |
| Status enum fix (D-02) | Frontend (type unions + display labels) + API Backend (no enum change needed) | — | Backend DTO already correct; frontend needs update |
| Color persistence (D-03) | DB migration (new column) + API Backend (service mapper) | Frontend (already sends color) | Color already flows from EventModal but is dropped by service |
| endTime fix (D-04) | Frontend (buildCreatePayload + updateCalendarEvent) + API DTO | — | Bug is in frontend payload builder; DTO needs one field |
| this_and_future (D-05) | API / Backend (calendar.service.ts) | DB migration (recurrence table schema must be fixed first) | Business logic lives in service |
| Dashboard UX (D-06) | Frontend (Dashboard.tsx + CalendarPage.tsx) | — | Navigate + useSearchParams pattern, no backend change |
| iCal feed endpoint (D-07) | API / Backend (new controller method) | DB (new column on restaurants) | Token-authenticated, streaming response |
| iCal token generation (D-08) | API / Backend | DB migration (column on restaurants) | `crypto.randomBytes` in service, REST endpoint |
| iCal library (D-09) | API / Backend (npm package) | — | `ical-generator` in api-gateway |
| Settings Calendar UI (D-10) | Frontend (Settings.tsx) | API (token endpoint) | New section in existing settings page |
| Dashboard subscribe shortcut (D-11) | Frontend (Dashboard.tsx) | API (token endpoint) | Clipboard copy with toast |
| Dashboard calendar widget fix (D-12) | Frontend (useDashboardPage.ts + Dashboard.tsx) | — | Query params already broken by D-01; fix follows automatically |

---

## Standard Stack

### Core (Verified in codebase)
| Library | Version | Purpose | Verification |
|---------|---------|---------|--------------|
| `@nestjs/common` | ^10.3.0 | NestJS framework | [VERIFIED: package.json] |
| `@supabase/supabase-js` | in DatabaseService | Supabase queries | [VERIFIED: codebase] |
| `ical-generator` | 10.2.0 (latest) | RFC 5545 iCal generation | [VERIFIED: npm view] — NOT yet installed |
| `react-router-dom` | v6 (useNavigate, useSearchParams) | Navigation, query params | [VERIFIED: codebase] |
| `@tanstack/react-query` | in use | Server state management | [VERIFIED: codebase] |
| `class-validator` | in use | NestJS DTO validation | [VERIFIED: calendar.dto.ts] |
| `crypto` | Node.js built-in | Token generation | [VERIFIED: Node.js built-in, no install needed] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `sonner` | in use | Toast notifications | Already used in Settings.tsx for toast |
| `lucide-react` | in use | Icons (Calendar, Link2, Copy) | Dashboard and Settings UI |

### Installation Required
```bash
pnpm add ical-generator --filter api-gateway
```

**Version verification:** `npm view ical-generator version` → `10.2.0` [VERIFIED: npm registry 2026-05-12]

---

## Architecture Patterns

### System Architecture Diagram

```
Dashboard.tsx              CalendarPage.tsx           CalendarController (NestJS)
  [Add Event btn]   ──navigate('/calendar?openModal=true')──>  [useSearchParams]
                                                                  ↓
  [Subscribe btn]  ──GET /calendar/ical-token (authed)──>  [getOrGenerateICalToken()]
                        ↓ returns token URL
  ── clipboard copy ──

                         [EventModal]                    CalendarService
                           [Save]    ──POST /events──>  [createEvent()]
                                     ──PATCH /events/:id──>  [updateEvent()]
                                                                  ↓
                                                        [Supabase JS client]
                                                                  ↓
                                                        [calendar_events table]
                                                        [calendar_recurrence_rules]

Public iCal feed:
  Outlook/Apple/Google
  ──GET /calendar/feed/:token.ics──>  [CalendarController @Public()]
                                        ↓
                                      [CalendarService.getICalFeed(token)]
                                        ↓ query calendar_events WHERE restaurant
                                      [ical-generator buildIcal()]
                                        ↓ text/calendar response
```

### Recommended File Structure (new files only)
```
apps/api-gateway/src/calendar/
├── calendar.controller.ts   # add getFeed() + getICalToken() + regenerateToken()
├── calendar.service.ts      # add getICalFeed(), getOrGenerateICalToken(), regenerateICalToken()
└── dto/calendar.dto.ts      # add ICalTokenResponseDto, add eventTimeEnd to UpdateCalendarEventDto

apps/web/src/
├── pages/Settings.tsx            # add 'calendar' section + CalendarSubscriptionSection component
├── pages/Dashboard.tsx           # fix Add Event NavLink + add Subscribe shortcut
└── pages/calendar/CalendarPage.tsx  # add useSearchParams, openModal effect
    
supabase/migrations/
└── 20260512000001_calendar_schema_fix.sql   # comprehensive schema fix (see below)
└── 20260512000002_calendar_ical_token.sql   # restaurants.calendar_ical_token column
```

### Pattern 1: @Public() Decorator for Unauthenticated NestJS Endpoint

```typescript
// Source: verified at apps/api-gateway/src/auth/decorators/public.decorator.ts
// IS_PUBLIC_KEY checked by JwtAuthGuard.canActivate() — returns true early if set

import { Public } from '../auth/decorators/public.decorator';
import { Res, Param, Get } from '@nestjs/common';
import { Response } from 'express';

// In CalendarController:
@Get('feed/:token.ics')
@Public()                          // skips JwtAuthGuard entirely
async getICalFeed(
  @Param('token') token: string,
  @Res() res: Response,
): Promise<void> {
  const ical = await this.calendarService.getICalFeed(token);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
  res.send(ical);
}
```

### Pattern 2: ical-generator Usage

```typescript
// Source: ical-generator v10 docs [CITED: github.com/sebbo2002/ical-generator]
import ical from 'ical-generator';

const calendar = ical({ name: 'WineOps Calendar', prodId: '-//WineOps//Restaurant Calendar//EN' });
calendar.createEvent({
  id: `${event.id}@wineops.app`,
  start: new Date(`${event.start_date}T${event.start_time || '00:00'}:00`),
  end: new Date(`${event.end_date || event.start_date}T${event.end_time || '23:59'}:00`),
  summary: event.title,
  description: event.description || undefined,
  allDay: event.all_day,
});
const icalString = calendar.toString(); // RFC 5545 compliant
```

### Pattern 3: useSearchParams + openModal Effect

```tsx
// Source: react-router-dom v6, verified already used in project
import { useSearchParams } from 'react-router-dom'
// In CalendarPage:
const [searchParams, setSearchParams] = useSearchParams()
useEffect(() => {
  if (searchParams.get('openModal') === 'true') {
    const dateStr = searchParams.get('date')
    const date = dateStr ? new Date(dateStr) : new Date()
    openCreateModal(date)
    // Clear param to prevent re-open on back-navigation
    setSearchParams(prev => { prev.delete('openModal'); prev.delete('date'); return prev; })
  }
}, [])  // empty deps — run once on mount
```

### Pattern 4: Settings Section Pattern (scrollspy-based)

```tsx
// Source: verified apps/web/src/pages/Settings.tsx
// Settings uses SECTION_IDS array + scrollspy — NOT tabs
// To add 'calendar' section:
// 1. Add 'calendar' to SECTION_IDS array
// 2. Add SECTION_LABELS['calendar'] = 'Calendar'
// 3. Create CalendarSubscriptionSection component
// 4. Add <section id="calendar"> in the page body

const SECTION_IDS = ['team', 'locations', 'measurement', 'features', 'calendar'] as const;
// Scrollspy auto-highlights the visible section
```

### Anti-Patterns to Avoid
- **Storing `confirmed` in the DB:** Always store `approved`, only use `confirmed` as a display label. Storing `confirmed` will 400 against the status check constraint (or just be wrong semantically).
- **Logging the iCal token URL:** NestJS request logs include params by default. If `calendar_ical_token` appears in the URL, it MUST be excluded from logs. Use a logging interceptor exclusion or route-level log suppression.
- **Using `ALTER TABLE ... ADD COLUMN` without `IF NOT EXISTS`:** Will fail if migration is applied twice. Always use `IF NOT EXISTS`.
- **Using `ALTER TABLE RENAME COLUMN` on columns that may not exist:** Use a PL/pgSQL DO block with `IF EXISTS` check.
- **Calling `generateOccurrences()` before the RPC exists:** The `generate_recurring_events` Postgres function must be created in the migration before D-05 is implemented.
- **`useSearchParams` double-open:** The `openModal` effect dependency array must be empty `[]` (run once on mount), not `[searchParams]` (would loop).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RFC 5545 iCal generation | Custom text string builder | `ical-generator` | VEVENT timezone, RRULE, EXDATE — all edge-cases are handled |
| Token generation | `Math.random()` | `crypto.randomBytes(32).toString('hex')` | Cryptographic randomness, no collisions |
| Date arithmetic for recurrence splits | Custom date math | `new Date(date); date.setDate(date.getDate() - 1)` | Simple but native is sufficient |

---

## Critical Discovery: Schema Divergence Is Deeper Than D-01 Described

> **This section is the most important finding in this research. The planner MUST account for it.**

The CONTEXT.md D-01 describes a 3-column rename (`event_date/event_date_end/event_time → start_date/end_date/start_time`). Codebase audit reveals the divergence is substantially larger. A single comprehensive migration must fix all three calendar tables.

### calendar_events — Missing Columns

The baseline migration (`20260208024921_new-migration.sql`) created `calendar_events` with 16 columns. The `CalendarEventRow` interface in `calendar.service.ts` expects 24 columns. Missing columns that will cause silent failures:

| Column | Service Uses | Migration Has | Fix |
|--------|-------------|---------------|-----|
| `reminder_enabled` | `row.reminder_enabled` | `notification_enabled` | RENAME notification_enabled → reminder_enabled |
| `reminder_days_before` | `row.reminder_days_before` | MISSING | ADD COLUMN INTEGER DEFAULT 1 |
| `reminder_sent` | `row.reminder_sent` | MISSING | ADD COLUMN BOOLEAN DEFAULT false |
| `is_recurring` | `row.is_recurring` | MISSING | ADD COLUMN BOOLEAN DEFAULT false |
| `parent_event_id` | `row.parent_event_id` | MISSING | ADD COLUMN UUID self-FK |
| `occurrence_date` | `row.occurrence_date` | MISSING | ADD COLUMN DATE |
| `recurrence_rule_id` | `row.recurrence_rule_id` | MISSING | ADD COLUMN UUID FK |
| `created_by` | `row.created_by` | MISSING | ADD COLUMN UUID |
| `color` | (D-03 fix) | MISSING | ADD COLUMN VARCHAR(7) DEFAULT NULL |

Column names being changed by D-01 (service updates to match migration):
- Service was using `event_date` → will use `start_date` (already in migration)
- Service was using `event_date_end` → will use `end_date` (already in migration)
- Service was using `event_time` → will use `start_time` (already in migration)
- `end_time` is already in migration and was never mapped — D-04 fix adds this

### calendar_recurrence_rules — Column Renames + Missing Columns

The migration table is a simplified v1. The service code expects the full v2 schema:

| Issue | Migration Column | Service Expects |
|-------|-----------------|-----------------|
| RENAME | `event_id` | `calendar_event_id` |
| RENAME | `end_date` | `end_on_date` |
| RENAME | `max_occurrences` | `end_after_count` |
| ADD | MISSING | `restaurant_id UUID` |
| ADD | MISSING | `day_of_month INTEGER` |
| ADD | MISSING | `week_of_month INTEGER` |
| ADD | MISSING | `month_of_year INTEGER` |
| ADD | MISSING | `end_type VARCHAR(20) DEFAULT 'never'` |
| ADD | MISSING | `last_generated_date DATE` |
| ADD | MISSING | `next_generation_date DATE` |
| ADD | MISSING | `generation_horizon_days INTEGER DEFAULT 90` |
| ADD | MISSING | `updated_at TIMESTAMPTZ` |

### calendar_recurrence_exceptions — Column Renames

| Issue | Migration Column | Service Expects |
|-------|-----------------|-----------------|
| RENAME | `recurrence_id` | `recurrence_rule_id` |
| RENAME | `exception_date` | `original_date` |

### generate_recurring_events RPC — Does Not Exist

`calendar.service.ts` line 554 calls:
```typescript
this.databaseService.supabase.rpc('generate_recurring_events', {
  p_rule_id: ruleId,
  p_horizon_date: horizonDate || null,
})
```
This PostgreSQL function does not exist in any migration. Every call to `createEvent()` with a recurrence rule (line 181) calls `generateOccurrences()` → this RPC → `500 Internal Server Error`. The migration must create this function as part of the schema fix.

**Minimal viable implementation for the RPC:**
```sql
CREATE OR REPLACE FUNCTION generate_recurring_events(
  p_rule_id UUID,
  p_horizon_date DATE DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  -- Implementation: fetch rule, iterate dates per frequency,
  -- insert calendar_events with parent_event_id set
BEGIN
  -- Placeholder returns 0; full implementation needed for D-05
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
```
The full function body needs to generate occurrence rows. For Phase 30, a minimal stub that returns 0 (allowing creates to succeed without generating server occurrences, since the frontend does client-side recurrence expansion via `expandAllRecurringEvents()`) may be acceptable. The planner should decide whether to implement the full RPC or use a stub.

---

## Bug-by-Bug Fix Map

### Bug 1 (D-01): Column Name Fix
**Files to change:**
- `apps/api-gateway/src/calendar/calendar.service.ts`:
  - `CalendarEventRow` interface: rename fields `event_date` → `start_date`, `event_date_end` → `end_date`, `event_time` → `start_time`, add `end_time`
  - `insertPayload` in `createEvent()`: rename keys accordingly
  - `updatePayload` in `updateEvent()`: rename keys accordingly
  - `listEvents()` filter queries: `gte('event_date', ...)` → `gte('start_date', ...)`
  - `getRecurringInstances()` filter: same rename
  - `deleteRecurringSeries()` filter: same rename
  - `mapCalendarEvent()`: `row.event_date` → `row.start_date`, etc.
  - CalendarEventRow must also get `color` field (D-03)
- Migration: rename `notification_enabled` → `reminder_enabled`, add all missing columns

### Bug 2 (D-02): Status Enum
**Files to change (frontend — all confirmed by grep):**
- `apps/web/src/hooks/queries/useCalendarQueries.ts` line 329: `useUpdateEventStatus` mutationFn type — remove `'confirmed'`, add `'approved'` and `'dismissed'`
- `apps/web/src/services/api/calendar.ts` lines 32, 136, 189, 328: remove `'confirmed'` from all status union types
- `apps/web/src/pages/calendar/useCalendarPage.ts` line 26: remove `'confirmed'`
- `apps/web/src/pages/calendar/CalendarAgenda.tsx` line 167: `!== 'confirmed'` → `!== 'approved'`
- `apps/web/src/pages/calendar/EventCard.tsx` line 140: `=== 'confirmed'` → `=== 'approved'`
- `apps/web/src/pages/Calendar.tsx` lines 78, 1009, 1326, 1624: same pattern replacements
- `apps/web/src/data/FALLBACK_DATA.ts` line 40: `status: 'confirmed'` → `status: 'approved'`

### Bug 3 (D-03): Color Persistence
**Files to change:**
- Migration: `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color VARCHAR(7) DEFAULT NULL`
- `apps/api-gateway/src/calendar/calendar.service.ts`:
  - `CalendarEventRow`: add `color: string | null`
  - `insertPayload`: add `color: dto.color || null`
  - `updatePayload`: `if (dto.color !== undefined) updatePayload.color = dto.color`
  - `mapCalendarEvent()`: add `color: row.color || undefined`
  
Note: `CreateCalendarEventDto` already has `color?: string` [VERIFIED: dto line 200]. `UpdateCalendarEventDto` already has `color?: string` [VERIFIED: dto line 269]. `CalendarEventResponseDto` already has `color?: string` [VERIFIED: dto line 418]. Only the service mapper and payload builders need updating.

### Bug 4 (D-04): endTime Not Sent
**Files to change:**
- `apps/web/src/services/api/calendar.ts`:
  - `buildCreatePayload()` line 104: add `eventDateEnd: data.allDay ? undefined : data.endTime`
  - `updateCalendarEvent()` line 240: add `if (updateData.endTime !== undefined) payload.eventDateEnd = updateData.endTime`
- `apps/api-gateway/src/calendar/dto/calendar.dto.ts`:
  - `UpdateCalendarEventDto`: add `eventTimeEnd?: string` field with `@IsString()` `@IsOptional()` decorators
- `apps/api-gateway/src/calendar/calendar.service.ts`:
  - `updatePayload` in `updateEvent()`: add `if (dto.eventTimeEnd !== undefined) updatePayload.end_time = dto.eventTimeEnd`

Note: `CreateCalendarEventDto` does NOT have `eventTimeEnd`. The DTO uses `eventTime` for start time. For the create flow, `end_time` in the DB comes from `buildCreatePayload`'s `endTime` field which needs mapping to `eventDateEnd`. But wait — `end_time` is the DB column, and the service's `insertPayload` needs an `end_time` key. Check: `CreateCalendarEventDto` only has `eventTime` (start time). We need to add `eventTimeEnd?: string` to `CreateCalendarEventDto` as well, and map it in `insertPayload`.

### Bug 5 (D-05): this_and_future Recurrence Split
**File to change:** `apps/api-gateway/src/calendar/calendar.service.ts` lines 388-390
**Precondition:** Migration must fix `calendar_recurrence_rules` schema first (D-01 migration)

Implementation:
```typescript
} else if (dto.updateScope === 'this_and_future') {
  const occurrenceDate = existing.occurrenceDate || existing.eventDate;
  const splitDate = new Date(occurrenceDate);
  splitDate.setDate(splitDate.getDate() - 1);
  const endOnDate = splitDate.toISOString().split('T')[0];
  
  // Step 1: Truncate the existing recurrence rule
  if (existing.recurrenceRule?.id) {
    await this.databaseService.supabase
      .from('calendar_recurrence_rules')
      .update({ end_on_date: endOnDate })
      .eq('id', existing.recurrenceRule.id);
  }
  
  // Step 2: Create new parent event with the modified fields
  const { data: newParentData } = await this.databaseService.supabase
    .from('calendar_events')
    .insert({ ...insertPayloadFromUpdateDto, start_date: occurrenceDate, is_recurring: true })
    .select('*').single();
  
  // Step 3: Create new recurrence rule from occurrence_date
  if (newParentData && existing.recurrenceRule) {
    const { data: newRuleData } = await this.databaseService.supabase
      .from('calendar_recurrence_rules')
      .insert({ 
        restaurant_id: restaurantId,
        calendar_event_id: newParentData.id,
        frequency: existing.recurrenceRule.frequency,
        interval_value: existing.recurrenceRule.interval,
        end_type: existing.recurrenceRule.endType,
        end_on_date: existing.recurrenceRule.endOnDate,
      })
      .select('*').single();
    if (newRuleData) {
      await this.generateOccurrences(restaurantId, newRuleData.id);
    }
  }
}
```

---

## Common Pitfalls

### Pitfall 1: Migration applies to column that already exists with data
**What goes wrong:** `ALTER TABLE RENAME COLUMN notification_enabled` on a live DB with data works, but `ADD COLUMN reminder_days_before INTEGER NOT NULL DEFAULT 1` without `DEFAULT` will fail if table has rows.
**Why it happens:** PostgreSQL requires a DEFAULT value for NOT NULL columns added to tables with existing data.
**How to avoid:** Always specify `DEFAULT` for `NOT NULL` columns, or use `DEFAULT NULL` and update later. Use `IF NOT EXISTS` on all ADD COLUMN statements.

### Pitfall 2: calendar_recurrence_rules RENAME COLUMN on empty vs populated table
**What goes wrong:** `RENAME COLUMN event_id TO calendar_event_id` — if any application code inserts using the OLD name concurrently, it will fail after rename.
**How to avoid:** Plan the migration + service code update as an atomic deploy. Rename in migration, update service code simultaneously.

### Pitfall 3: iCal Token URL Logged
**What goes wrong:** NestJS request logger logs `GET /calendar/feed/abc123def456.ics`. The token in the URL is visible to anyone reading server logs.
**How to avoid:** Add a route exclusion in the NestJS logger config, or at minimum document that logs containing `/calendar/feed/` should be treated as sensitive.

### Pitfall 4: openModal useEffect runs on every searchParam change
**What goes wrong:** If the `useEffect` dependency array includes `searchParams`, it runs every time any query param changes, potentially reopening the modal.
**How to avoid:** Empty dependency array `[]` — run once on mount. Read `searchParams` inside the effect via closure.

### Pitfall 5: ical-generator date format for all-day events
**What goes wrong:** Creating DTSTART with a time component for all-day events violates RFC 5545. Apple Calendar and Outlook will treat it as a timed event.
**How to avoid:** Check `event.all_day`. If true: set `allDay: true` in `createEvent()`. ical-generator handles `VALUE=DATE` automatically.

### Pitfall 6: endTime DTO field naming inconsistency
**What goes wrong:** Frontend uses `endTime` on `CreateEventInput`, `UpdateEventInput`. Backend DTO uses `eventTime` for start time. The end time field must be named `eventTimeEnd` in the backend DTO (matching the existing `eventTime` naming convention) but `endTime` on the frontend `CreateEventInput`.
**How to avoid:** Map `endTime` → `eventDateEnd` in `buildCreatePayload`, then map `eventDateEnd` → `end_time` in `insertPayload`. Document the 3-layer naming explicitly.

### Pitfall 7: CalendarEventRow missing `color` causes TypeScript error
**What goes wrong:** Adding `color: row.color` in `mapCalendarEvent()` will cause a TypeScript error if `color` is not in `CalendarEventRow`.
**How to avoid:** Add `color: string | null` to `CalendarEventRow` interface at the same time as updating `mapCalendarEvent()`.

---

## Code Examples

### Verified current insertPayload (service line 105–122)
```typescript
// Source: apps/api-gateway/src/calendar/calendar.service.ts lines 105-122 [VERIFIED]
// BUG: uses event_date/event_date_end/event_time — must be fixed to start_date/end_date/start_time
const insertPayload = {
  restaurant_id: restaurantId,
  title: dto.title,
  description: dto.description || null,
  event_type: dto.eventType,
  event_date: dto.eventDate,          // BUG → should be start_date
  event_date_end: dto.eventDateEnd || null,  // BUG → should be end_date
  all_day: dto.allDay ?? true,
  event_time: dto.eventTime || null,  // BUG → should be start_time
  // end_time NOT PRESENT → D-04 adds it
  // color NOT PRESENT → D-03 adds it
  ...
};
```

### Corrected insertPayload (after D-01 + D-03 + D-04 fixes)
```typescript
const insertPayload = {
  restaurant_id: restaurantId,
  title: dto.title,
  description: dto.description || null,
  event_type: dto.eventType,
  start_date: dto.eventDate,           // D-01 fix
  end_date: dto.eventDateEnd || null,  // D-01 fix
  all_day: dto.allDay ?? true,
  start_time: dto.eventTime || null,   // D-01 fix
  end_time: dto.eventTimeEnd || null,  // D-04 fix — new field
  color: dto.color || null,            // D-03 fix — new field
  provider_id: dto.providerId || null,
  order_id: dto.orderId || null,
  source: dto.source || 'manual',
  status: dto.status || 'pending',
  reminder_enabled: dto.reminderEnabled ?? true,    // migration renamed
  reminder_days_before: dto.reminderDaysBefore ?? 1,
  is_recurring: !!dto.recurrence,
  created_by: userId,
};
```

### buildCreatePayload frontend bug (calendar.ts line 104–118)
```typescript
// Source: apps/web/src/services/api/calendar.ts [VERIFIED]
// BUG: endTime is in CreateEventInput but NOT mapped to API payload
const buildCreatePayload = (data: CreateEventInput) => ({
  title: data.title,
  description: data.description,
  eventType: data.type ?? (data as any).eventType,
  eventDate: data.date ?? (data as any).eventDate,
  allDay: data.allDay,
  eventTime: data.allDay ? undefined : data.startTime,
  // MISSING: eventDateEnd: data.allDay ? undefined : data.endTime   ← D-04 adds this
  // MISSING: eventTimeEnd: data.allDay ? undefined : data.endTime   ← D-04 check naming
  ...
});
```

### Dashboard Add Event NavLink (current, buggy)
```tsx
// Source: apps/web/src/pages/Dashboard.tsx line 697 [VERIFIED]
<NavLink
  to="/calendar"
  className="mt-4 flex items-center justify-center gap-2 w-full ..."
>
  <Plus className="w-3 h-3" />
  Add Event
</NavLink>
```

### Dashboard Add Event after D-06 fix
```tsx
// D-06: replace NavLink with navigate button
// Dashboard already imports NavLink from 'react-router-dom' — add useNavigate
import { NavLink, useNavigate } from 'react-router-dom'
const navigate = useNavigate()

<button
  onClick={() => navigate('/calendar?openModal=true')}
  className="mt-4 flex items-center justify-center gap-2 w-full ..."
>
  <Plus className="w-3 h-3" />
  Add Event
</button>
```

### iCal Token Generation (service)
```typescript
import * as crypto from 'crypto';

async getOrGenerateICalToken(restaurantId: string): Promise<string> {
  const { data } = await this.databaseService.supabase
    .from('restaurants')
    .select('calendar_ical_token')
    .eq('id', restaurantId)
    .single();
  
  if (data?.calendar_ical_token) return data.calendar_ical_token;
  
  const token = crypto.randomBytes(32).toString('hex');
  await this.databaseService.supabase
    .from('restaurants')
    .update({ calendar_ical_token: token })
    .eq('id', restaurantId);
  return token;
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| OAuth calendar sync | iCal subscription URL (RFC 5545) | Zero OAuth setup; any calendar app subscribes with one URL |
| `ical-generator` v3 (2021) | v10 (2024) — fluent API redesigned | Updated import syntax: `import ical from 'ical-generator'` not `ICalCalendar` direct |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `generate_recurring_events` PG function is not defined anywhere — not even in a SQL file outside `supabase/migrations/` | Critical Discovery | Low: grepped entire supabase/ directory — no match |
| A2 | The `notification_enabled` column can be safely renamed to `reminder_enabled` without breaking other services | Schema Fix | Medium: grep found no other references to `notification_enabled` outside calendar context |
| A3 | ical-generator v10 API uses `import ical from 'ical-generator'` (default export) | iCal feature | Low: npm registry + docs confirm |
| A4 | Dashboard does not already import `useNavigate` | D-06 | Low: grep confirmed only `NavLink` import from react-router-dom |
| A5 | `restaurants` table has no `calendar_ical_token` column in any migration | D-08 | Very low: searched all 56 migrations — not found |

**If A1 is wrong (function exists elsewhere):** The migration should not create a duplicate — check all SQL files in the project before migrating.

---

## Open Questions

1. **`generate_recurring_events` stub vs full implementation**
   - What we know: the function doesn't exist; the frontend does client-side recurrence expansion via `expandAllRecurringEvents()`
   - What's unclear: does Phase 30 need server-side occurrence generation (e.g., for iCal feed to include recurring events correctly)?
   - Recommendation: implement a full server-side occurrence generator in the Postgres function for the iCal feed to work correctly with recurring events (subscribers would only see the parent, not all occurrences, without server-side expansion). Plan as a separate task within the phase.

2. **`CreateCalendarEventDto.eventTimeEnd` — needed?**
   - What we know: `buildCreatePayload` needs to send `end_time` to backend for new events
   - What's unclear: the backend DTO `CreateCalendarEventDto` has no `eventTimeEnd` field, yet the DB already has an `end_time` column
   - Recommendation: add `eventTimeEnd?: string` to `CreateCalendarEventDto` in same task as D-04.

3. **Settings page: add section vs add tab**
   - What we know: Settings uses scrollspy sections, NOT tabs. Adding a new section means adding to `SECTION_IDS` and rendering a `<section id="calendar">` block.
   - What's unclear: nothing — the pattern is clear from code.
   - Recommendation: add `calendar` section following the existing pattern.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `ical-generator` npm | D-07/D-09 | ✗ — NOT installed in api-gateway | 10.2.0 (latest) | None — install required |
| `@nestjs/common v10` | All backend changes | ✓ | ^10.3.0 | — |
| `react-router-dom useSearchParams` | D-06 | ✓ (v6 in use) | v6 | — |
| `crypto` (Node.js built-in) | D-08 | ✓ | Node built-in | — |
| Supabase migration CLI | Schema fix | ✓ (assumed) | In use | — |

**Missing dependencies with no fallback:**
- `ical-generator` — must install before implementing D-07/D-09

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test config files found |
| Config file | None |
| Quick run command | N/A |
| Full suite command | N/A |

No test infrastructure exists in the codebase. All validation for Phase 30 must be manual or smoke-tested against the running API.

### Phase Requirements → Smoke Test Map
| Req | Behavior | Test Approach |
|-----|----------|---------------|
| D-01 | Creating an event succeeds without Supabase column error | POST /calendar/events → 201, not 500 |
| D-02 | Setting status to 'approved' succeeds | PATCH /calendar/events/:id/status {status:'approved'} → 200 |
| D-03 | Color saved and returned on re-fetch | POST with color, GET same event → color field present |
| D-04 | end_time saved to DB | POST with startTime+endTime, GET → eventTimeEnd populated |
| D-05 | this_and_future splits series | PATCH with updateScope:'this_and_future' → new parent event created |
| D-07 | iCal feed returns valid .ics | GET /calendar/feed/:token.ics → 200 text/calendar, import into calendar app |
| D-08 | Token generated on first call | GET /calendar/ical-token → 200, 64-char hex |
| D-06 | Dashboard Add Event opens modal | Navigate to /calendar?openModal=true → modal opens |

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (iCal token) | Token-in-URL pattern; token is the only auth for feed |
| V3 Session Management | No | Feed is stateless |
| V4 Access Control | Yes | Restaurant-scoped token; wrong token gets empty/404 |
| V5 Input Validation | Yes | Token param sanitized (hex chars only) |
| V6 Cryptography | Yes | `crypto.randomBytes(32)` — 256-bit entropy |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token enumeration | Information Disclosure | 256-bit token entropy makes brute force infeasible |
| Token in server logs | Information Disclosure | Exclude `/calendar/feed/` routes from access logs |
| Calendar event data leakage | Disclosure | Token is restaurant-scoped; only events for that restaurant returned |
| Token shared beyond intended subscribers | Disclosure | "Regenerate Token" button invalidates existing subscriptions |

---

## Sources

### Primary (HIGH confidence)
- Codebase: `apps/api-gateway/src/calendar/calendar.service.ts` — full insertPayload, updatePayload, mapCalendarEvent, RecurrenceRuleRow, CalendarEventRow — all column names verified
- Codebase: `supabase/migrations/20260208024921_new-migration.sql` — actual `calendar_events` column list (start_date, start_time, end_date, end_time, notification_enabled — NOT reminder_enabled)
- Codebase: `apps/api-gateway/src/calendar/dto/calendar.dto.ts` — CalendarEventStatus enum (NO 'confirmed')
- Codebase: `apps/web/src/services/api/calendar.ts` — buildCreatePayload, updateCalendarEvent, endTime bug
- Codebase: `apps/web/src/hooks/queries/useCalendarQueries.ts` — useUpdateEventStatus type uses 'confirmed'
- Codebase: `apps/api-gateway/src/auth/decorators/public.decorator.ts` — @Public() pattern confirmed
- [VERIFIED: npm registry] `ical-generator` → 10.2.0

### Secondary (MEDIUM confidence)
- [CITED: github.com/sebbo2002/ical-generator] ical-generator v10 API (default import, createEvent, allDay option)

### Tertiary (LOW confidence)
- None — all claims are codebase-verified

---

## Metadata

**Confidence breakdown:**
- Schema divergence findings: HIGH — line-by-line grep across all 56 migrations
- Standard stack: HIGH — verified in package.json
- Bug fixes: HIGH — all traced to exact file + line numbers
- ical-generator API: MEDIUM — npm registry + GitHub docs cross-checked
- this_and_future implementation: MEDIUM — pattern correct but untested until migration is fixed

**Research date:** 2026-05-12
**Valid until:** Indefinite (codebase snapshot) — re-verify if migrations run before planning starts
