---
status: partial
phase: 30-calendar-operations-hub
source: [30-VERIFICATION.md]
started: 2026-05-12T20:00:00Z
updated: 2026-05-12T20:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Full CRUD round-trip — color, endTime, status persist through UI
expected: Create an event with a color, end time, and status 'approved'. Save. Click the event to view it. Edit it. Verify all three fields (color, end time, status) are correctly persisted and displayed after each operation. No mutation errors should appear.
result: [pending]

### 2. iCal subscription URL works in external calendar client

> **Partially discharged 2026-07-31 (v3.0 task 44.4).** The half that does not need
> a human is now covered by `apps/api-gateway/src/calendar/ical-feed.spec.ts` — 8
> tests asserting the VCALENDAR envelope, CRLF line endings, globally unique UIDs,
> RFC status vocabulary, RRULE/BYDAY expansion, null-safety, and that an unknown
> token returns an empty calendar rather than a 404 (T-30-09, so the feed URL is
> not an oracle for guessing valid tokens).
>
> Writing them found a real defect: `PRODID` was emitted as `--//WineOps//…` with a
> doubled dash, because ical-generator prepends the `-` that RFC 5545's FPI
> convention requires and the code supplied one too. Cosmetic to a lenient client,
> rejected by a strict one, and invisible to any amount of clicking. Fixed.
>
> **Still needs a human, and only a human:** actually subscribing the URL in
> Outlook, Apple Calendar and Google Calendar and confirming events appear at the
> right local times. The structural failure that would make every client refuse is
> now covered; what remains is whether the events *look right*, which is a judgment
> no test makes.
expected: Go to Settings → Calendar section. Copy the iCal subscription URL. Subscribe to it in Outlook, Apple Calendar, or Google Calendar. Your restaurant's events should appear in the external calendar. Recurring events should expand natively.
result: [pending]

### 3. this_and_future recurring event split
expected: Open a recurring event. Choose 'Edit this and future events'. Make a change. Save. Verify in the DB (or via the calendar UI) that: (a) the original series ends one day before this occurrence, (b) a new event series starts at this occurrence with the updated fields.
result: [pending]

### 4. Dashboard Add Event → modal auto-opens
expected: From /dashboard, click the "Add Event" button in the Sales Calendar widget. The browser should navigate to /calendar and the "Create Event" modal should automatically open without any further clicks. After closing the modal, the URL parameter ?openModal=true should be cleared.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
