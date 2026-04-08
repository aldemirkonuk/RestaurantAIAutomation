---
status: testing
phase: 13-dev-onboarding-ui-with-manual-override-access
source: [13-VERIFICATION.md, 13-03-SUMMARY.md, 13-04-SUMMARY.md]
started: 2026-04-07T00:00:00Z
updated: 2026-04-07T00:00:00Z
---

## Current Test

number: 1
name: Studio Access Gate — Loading + Denied State
expected: |
  Navigate to /studio as a user with no studio role assigned.
  First: a spinner appears ("Loading permissions...") while studioRoles loads.
  Then: a "Studio Access Required" card appears with a ShieldAlert icon — NOT an instant deny.
awaiting: user response

## Tests

### 1. Studio Access Gate — Loading + Denied State
expected: Navigate to /studio as a user with no studio role assigned. First a spinner appears ("Loading permissions...") while studioRoles loads. Then a "Studio Access Required" card appears with ShieldAlert icon — NOT an instant deny (the spinner must show before the card).
result: |
  TO TEST: Log in with a user that has NO row in the user_roles table (create via Supabase Dashboard → Auth → Users, do NOT add them to user_roles). Navigate to /studio.
  Expected: Spinner ("Loading permissions...") appears for ~200ms, then "Studio Access Required" card with ShieldAlert icon. NOT an instant deny — the spinner must show first.
  Update with: PASS / FAIL / PARTIAL + notes

### 2. CommandBar PDF Drag-and-Drop
expected: Drag a .pdf file onto the CommandBar drop zone. Drag-over shows dashed wine-colored border. Drop populates the input with the filename and shows "Detected: PDF menu — will use Claude Vision extraction". Then drag a .jpg and verify it is rejected with a toast error ("Only PDF files are supported").
result: |
  TO TEST: Navigate to /studio as a developer. Find the CommandBar input area at top. Drag a .pdf file from Finder onto it.
  Expected (drag-over): Dashed wine-colored border appears around the drop zone.
  Expected (drop): Input fills with filename. Text appears: "Detected: PDF menu — will use Claude Vision extraction".
  Expected (.jpg drag): Toast error "Only PDF files are supported".
  Update with: PASS / FAIL / PARTIAL + notes

### 3. FieldCell Inline Edit + ReasonInput Animation
expected: Click a wine field cell with confidence >= 80%. The cell expands in place (no navigation), the input is auto-focused, and a ReasonInput slides down with a smooth framer-motion animation (height 0 → auto, ~200ms). Click a low-confidence cell — input appears but no ReasonInput. Press Escape to close edit mode.
result: |
  TO TEST: Navigate to /studio, create a session (manual seed or URL crawl). In the WineRecordsTable, find a field cell with a high-confidence badge (>= 0.8). Click it.
  Expected: Cell expands inline (no page navigation), input auto-focuses, ReasonInput slides down smoothly (~200ms framer-motion animation).
  Then click a low-confidence cell (< 0.8): input appears but NO ReasonInput.
  Press Escape: edit mode closes.
  Update with: PASS / FAIL / PARTIAL + notes

### 4. Approval Queue — Inline Rejection (No Modal)
expected: On /studio/queue, click "Reject" on a pending override. A textarea slides down inline within the same table row — no modal or dialog overlay appears. "Confirm Rejection" and "Cancel" buttons appear below the textarea. Clicking Cancel collapses it without navigating away.
result: |
  TO TEST: Log in as review_admin. Navigate to /studio/queue. If queue is empty, first submit an override as a certified_contributor user. Then as review_admin, click "Reject" on the pending item.
  Expected: Textarea slides down INLINE inside the table row — NO modal/dialog overlay appears over the page. "Confirm Rejection" and "Cancel" buttons appear below the textarea. Clicking Cancel collapses without navigating away.
  Update with: PASS / FAIL / PARTIAL + notes

### 5. InviteDialog Two-State Behavior
expected: On /studio/certify, click "Invite Contributor". Fill in an email and role, then click "Generate Invite Link". The dialog stays open but transitions from form view to link view, showing an invite URL in path-param format (/studio/invite/{uuid}). Clicking Copy shows a "Copied" confirmation for ~2 seconds.
result: |
  TO TEST: Log in as review_admin. Navigate to /studio/certify. Click "Invite Contributor". Fill in an email and select a role. Click "Generate Invite Link".
  Expected: Dialog stays open (does NOT close). View transitions from form to link view. URL format: /studio/invite/{uuid} (path param, not query string). Click Copy → "Copied" confirmation shows for ~2 seconds.
  Update with: PASS / FAIL / PARTIAL + notes

## Summary

total: 5
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
awaiting_human: 5

## Gaps

[none yet]
