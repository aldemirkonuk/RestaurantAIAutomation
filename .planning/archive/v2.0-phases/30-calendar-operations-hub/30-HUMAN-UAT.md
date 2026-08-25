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
