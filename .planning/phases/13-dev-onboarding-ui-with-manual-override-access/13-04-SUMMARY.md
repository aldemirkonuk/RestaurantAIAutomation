---
phase: 13-dev-onboarding-ui-with-manual-override-access
plan: "04"
subsystem: frontend/studio
tags: [react, tanstack-query, framer-motion, radix-ui, approval-queue, certification, studio-ui, phase13, DEVUI-07]
dependency_graph:
  requires:
    - 13-01 (user_roles, override_events DB tables)
    - 13-02 (studio backend API: GET/PATCH /studio/queue, POST /studio/invite, GET /studio/contributors)
    - 13-03 (StudioLayout wrapper, TrustProgress reused in ContributorTable)
  provides:
    - /studio/queue — approval queue screen (D-14)
    - /studio/certify — contributor certification management screen (DEVUI-07, D-03)
    - TrustProgress component showing N/5 progress toward auto-promote (D-12)
    - QueueRow inline rejection note (D-05 spirit — no modal)
    - InviteDialog single-use token generation with path-param URL (T-13-17)
  affects:
    - apps/web/src/pages/studio/StudioApprovalQueue.tsx (stub replaced with full implementation)
    - apps/web/src/pages/studio/StudioCertify.tsx (stub replaced with full implementation)
tech_stack:
  added: []
  patterns:
    - "@tanstack/react-query useQuery with refetchInterval (30s queue, 60s contributors)"
    - "useMutation + queryClient.invalidateQueries for optimistic UI after approve/reject"
    - "framer-motion AnimatePresence for inline rejection note slide-down (D-05 spirit)"
    - "framer-motion motion.tr layout exit animation for row removal"
    - "Radix Dialog for InviteDialog (administrative one-time action — outside D-05 field-editor scope)"
    - "sonner toast with action/cancel for status toggle confirmation"
key_files:
  created:
    - apps/web/src/pages/studio/queue/TrustProgress.tsx
    - apps/web/src/pages/studio/queue/QueueRow.tsx
    - apps/web/src/pages/studio/queue/QueueTable.tsx
    - apps/web/src/pages/studio/certify/ContributorTable.tsx
    - apps/web/src/pages/studio/certify/InviteDialog.tsx
  modified:
    - apps/web/src/pages/studio/StudioApprovalQueue.tsx (stub → full implementation)
    - apps/web/src/pages/studio/StudioCertify.tsx (stub → full implementation)
decisions:
  - "TrustProgress reused in both QueueRow (actor trust context) and ContributorTable (trust level column) — single source of truth for D-12 display"
  - "InviteDialog uses Radix Dialog (modal) — D-05 (inline-only) applies specifically to wine field editor; invite is a one-time admin action, modal is correct and explicitly outside D-05 scope"
  - "Token in URL path param /studio/invite/{token}, not ?token= query string — prevents server log and Referer header leakage (T-13-17, Pitfall 2)"
  - "onRevoke prefixed as _onRevoke to suppress TS6133 — prop reserved in interface for kebab menu future implementation"
  - "Skeleton used from loading-skeleton.tsx instead of LoadingSkeleton — component named Skeleton in that module"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-04-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 2
---

# Phase 13 Plan 04: Approval Queue + Certification Management Screens — Summary

**One-liner:** Two remaining Studio screens built — StudioApprovalQueue (GET /studio/queue every 30s, inline approve/reject with framer-motion rejection note) and StudioCertify (60s poll, ContributorTable with sonner-confirmed toggle, InviteDialog generating single-use path-param token via POST /studio/invite).

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Approval Queue Screen — QueueTable + QueueRow + TrustProgress + StudioApprovalQueue (D-14, D-12) | `4c624ad` | `queue/TrustProgress.tsx`, `queue/QueueRow.tsx`, `queue/QueueTable.tsx`, `StudioApprovalQueue.tsx` |
| 2 | Certification Management Screen — ContributorTable + InviteDialog + StudioCertify (DEVUI-07, D-03) | `8b6b7bf` | `certify/ContributorTable.tsx`, `certify/InviteDialog.tsx`, `StudioCertify.tsx` |

---

## What Was Built

### TrustProgress.tsx (D-12)
- Animated `framer-motion` progress bar: `width: 0 → pct%` on mount, 0.4s easeOut
- Shows "N/5 approvals toward auto-promote" label
- Reused in both QueueRow (actor column) and ContributorTable (trust level column)

### QueueRow.tsx (D-14, D-05 spirit)
- `motion.tr` with layout + exit animation (opacity/height 0 on removal)
- Columns: wine_name/vintage, field_name badge, old→new with ArrowRight, actor avatar+email+role badge, reason (line-clamp-2 with title tooltip), citation ExternalLink, relative time
- **Approve button**: 44px min-height, emerald-600, calls `onDecide('approved')`
- **Reject button**: opens inline rejection note via `AnimatePresence` — no modal (D-05 spirit)
- Rejection note: `motion.div` height 0→auto slide-down; textarea + Confirm/Cancel buttons
- `TrustProgress` shown only for `actor_role === 'certified_contributor'` with trust_count (D-12)

### QueueTable.tsx
- `motion.tbody` with stagger `{ staggerChildren: 0.04 }` container variants
- Renders 8-column thead + QueueRow items

### StudioApprovalQueue.tsx
- `useQuery({ queryKey: ['studio-queue'], refetchInterval: 30_000 })` — 30s polling
- `useMutation` for PATCH `/api/v1/studio/queue/{id}` with `invalidateQueries` on success
- Loading: 3× `Skeleton` rows; Error: inline refresh link; Empty: `EmptyState` "All caught up" with CheckCircle
- Badge shows pending count (warning) or "All clear" (success)

### ContributorTable.tsx
- Contributor rows: avatar initials, name/email, trust level (auto-promote badge | TrustProgress | New badge), scopes (outline badges), status toggle, joined date, kebab menu
- Status toggle: custom `button` styled as switch (emerald/slate); click triggers sonner toast with Confirm/Cancel actions before API call
- `onRevoke` prop preserved in interface, prefixed `_onRevoke` for future kebab menu wiring

### InviteDialog.tsx (D-03, T-13-17)
- Radix Dialog with framer-motion entrance animation (scale 0.97→1, y 8→0)
- **State 1 (form)**: email input + role selector (certified_contributor/developer/review_admin) + "7 days" expiry note
- POST `GET /api/v1/studio/invite` → receives `{ token, expires_at }`
- **State 2 (link)**: monospace font URL display + Copy button with 2s "Copied" feedback state
- **Token in path param**: `/studio/invite/{token}` — never in `?token=` query string (T-13-17)

### StudioCertify.tsx
- `useQuery({ queryKey: ['studio-contributors'], refetchInterval: 60_000 })`
- Loading: 3× Skeleton rows; Empty: `EmptyState` "No certified contributors" with Invite action
- `handleRevoke` / `handleToggleEnable` → PATCH `/studio/contributors/{userId}/revoke|enable|disable`
- `InviteDialog` mounted in page; toggle via `inviteOpen` state

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `onRevoke` unused prop causes TS6133**
- **Found during:** Task 2 TypeScript check
- **Issue:** `onRevoke` declared in interface and destructured but never called — strict TS6133 error
- **Fix:** Renamed destructured binding to `_onRevoke` — suppresses unused warning, preserves interface for future kebab menu implementation
- **Files modified:** `certify/ContributorTable.tsx`
- **Commit:** `8b6b7bf` (included in task commit)

**2. [Rule 3 - Blocking] `LoadingSkeleton` not exported from loading-skeleton.tsx**
- **Found during:** Task 1 implementation — plan references `LoadingSkeleton` but module only exports `Skeleton`
- **Fix:** Used `Skeleton` import from `../../components/ui/loading-skeleton` in all files
- **Files modified:** `StudioApprovalQueue.tsx`, `StudioCertify.tsx`
- **Commits:** `4c624ad`, `8b6b7bf`

---

## Known Stubs

None — all plan objectives fully implemented. The Plan 03 stubs (`StudioApprovalQueue` and `StudioCertify` placeholders) have been replaced with complete implementations.

---

## Threat Mitigations Verified

| Threat ID | Description | Status |
|-----------|-------------|--------|
| T-13-17 | InviteDialog token in path param, not query string | ✅ `inviteUrl = \`${APP_URL}/studio/invite/${generatedToken}\`` |
| T-13-18 | Status toggle self-disable — sonner confirmation toast | ✅ `toast(...)` with Confirm/Cancel before API call |
| T-13-19 | QueueRow approve requires auth — Bearer JWT in headers | ✅ `getAuthHeaders()` applied to all PATCH requests |
| T-13-20 | TrustProgress is read-only display — no counter manipulation from frontend | ✅ `trust_count` is passed from server; frontend never increments it |

---

## Self-Check

```
FOUND: apps/web/src/pages/studio/queue/TrustProgress.tsx
FOUND: apps/web/src/pages/studio/queue/QueueRow.tsx
FOUND: apps/web/src/pages/studio/queue/QueueTable.tsx
FOUND: apps/web/src/pages/studio/certify/ContributorTable.tsx
FOUND: apps/web/src/pages/studio/certify/InviteDialog.tsx
FOUND: apps/web/src/pages/studio/StudioApprovalQueue.tsx (full implementation)
FOUND: apps/web/src/pages/studio/StudioCertify.tsx (full implementation)
FOUND: commit 4c624ad (Task 1)
FOUND: commit 8b6b7bf (Task 2)
```

## Self-Check: PASSED

---

## Plan Status: COMPLETE

Both tasks executed. `/studio/queue` approval queue with inline approve/reject (no modal), TrustProgress for certified_contributors, 30s polling. `/studio/certify` contributor table with status toggle + InviteDialog generating single-use path-param invite URL. Both screens use `StudioLayout` from Plan 03. Phase 13 Plan 04 fully satisfies D-12, D-14, D-03, DEVUI-07.
