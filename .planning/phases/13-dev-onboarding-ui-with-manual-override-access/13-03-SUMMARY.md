---
phase: 13-dev-onboarding-ui-with-manual-override-access
plan: "03"
subsystem: frontend/studio
tags: [react, zustand, framer-motion, inline-editing, studio-ui, phase13, DEVUI-02, DEVUI-03, DEVUI-04]
dependency_graph:
  requires:
    - 13-01 (user_roles, onboarding_sessions, override_events DB tables)
    - 13-02 (studio backend API endpoints)
  provides:
    - /studio route with role-gated access (developer/certified_contributor/review_admin)
    - AuthContext.User.studioRoles[] loaded after auth
    - ProtectedRoute.requiredStudioRole with loading guard (Pitfall 6 compliant)
    - useStudioSessionStore Zustand store for session state
    - CommandBar: PDF/URL/manual auto-detect + drag-drop + in-progress state
    - WineRecordsTable: 11 fixed columns (D-06)
    - FieldCell: inline click-to-edit (D-05) with conditional reason enforcement (D-07/D-08)
  affects:
    - App.tsx routing (3 new studio routes outside DashboardLayout)
    - AuthContext (User interface extension)
    - ProtectedRoute (new requiredStudioRole prop)
    - All Phase 13 Plan 04 pages (StudioApprovalQueue, StudioCertify) which reuse StudioLayout
tech_stack:
  added: []
  patterns:
    - Zustand store for session-scoped state (useStudioSessionStore)
    - framer-motion AnimatePresence for conditional slide-down (ReasonInput)
    - Inline click-to-edit table cells (FieldCell) — no modal
    - Fire-and-forget studio roles fetch after auth (non-blocking, graceful 404 fallback)
    - confidence >= 0.8 threshold for reason enforcement (D-07 client-side UX)
key_files:
  created:
    - apps/web/src/stores/useStudioSessionStore.ts
    - apps/web/src/pages/studio/StudioLayout.tsx
    - apps/web/src/pages/studio/Studio.tsx
    - apps/web/src/pages/studio/CommandBar.tsx
    - apps/web/src/pages/studio/SessionSummary.tsx
    - apps/web/src/pages/studio/WineRecordsTable.tsx
    - apps/web/src/pages/studio/FieldCell.tsx
    - apps/web/src/pages/studio/ReasonInput.tsx
    - apps/web/src/pages/studio/StudioApprovalQueue.tsx
    - apps/web/src/pages/studio/StudioCertify.tsx
  modified:
    - apps/web/src/contexts/AuthContext.tsx
    - apps/web/src/components/ProtectedRoute.tsx
    - apps/web/src/App.tsx
decisions:
  - "detectIngestionType uses hasPdfFile boolean param instead of DataTransfer FileList hack — cleaner and more testable"
  - "StudioApprovalQueue and StudioCertify created as stubs so lazy() imports resolve without breaking App.tsx"
  - "recordId kept in FieldCellProps interface for parent context but not destructured in component (parent captures via closure)"
  - "import.meta.env errors are pre-existing TypeScript config issue (Vite specific) — not fixed per scope boundary rule"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-04-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 10
  files_modified: 3
---

# Phase 13 Plan 03: Studio Main Authoring Screen — Summary

**One-liner:** Full React frontend for /studio route — role-gated AuthContext extension, Zustand session store, CommandBar smart ingestion bar (PDF/URL/manual drag-drop auto-detect), 11-column WineRecordsTable with inline FieldCell click-to-edit and framer-motion ReasonInput slide-down at confidence ≥ 0.8.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Foundation — AuthContext, ProtectedRoute, App.tsx, Zustand store, StudioLayout, Studio skeleton | `dc377da` | `AuthContext.tsx`, `ProtectedRoute.tsx`, `App.tsx`, `useStudioSessionStore.ts`, `StudioLayout.tsx`, `Studio.tsx`, `StudioApprovalQueue.tsx`, `StudioCertify.tsx` |
| 2 | Ingestion layer — CommandBar + SessionSummary (D-10, D-11) | `dd1bc2c` | `CommandBar.tsx`, `SessionSummary.tsx` |
| 3 | Wine table + inline editing — WineRecordsTable + FieldCell + ReasonInput (D-05/D-06/D-07/D-08) | `daab7e8` | `WineRecordsTable.tsx`, `FieldCell.tsx`, `ReasonInput.tsx` |
| fix | Remove unused imports (Wine, recordId) | `8c1fc0a` | `ProtectedRoute.tsx`, `FieldCell.tsx` |

---

## What Was Built

### AuthContext.tsx
- Extended `User` interface with `studioRoles?: ('developer' | 'certified_contributor' | 'review_admin')[]`
- After `setUser(response.data.user)` in `loadUser`, fire-and-forget `GET /api/v1/studio/me/roles`
- Catch handles 404 gracefully: sets `studioRoles: []` so ProtectedRoute doesn't spinner forever
- `studioRoles` stays `undefined` while loading (T-13-15: loading race protection)

### ProtectedRoute.tsx
- Added `requiredStudioRole` prop
- Loading guard: when `studioRoles === undefined` → spinner (`Loading permissions...`)
- Access denied: when studioRoles is an array but doesn't include a required role → `Studio Access Required` card
- Pitfall 6 compliant: `undefined` ≠ denied (spinner); `[]` without required role = denied

### App.tsx
- Lazy imports: `Studio`, `StudioApprovalQueue`, `StudioCertify`
- 3 studio routes placed **before** the DashboardLayout block (outside DashboardLayout):
  - `/studio` — requires `developer | certified_contributor | review_admin`
  - `/studio/queue` — requires `review_admin`
  - `/studio/certify` — requires `review_admin`

### useStudioSessionStore.ts
- Zustand store with: `sessionId`, `scanSessionId`, `records: WineRecord[]`, `isExtracting`, `extractionError`, `editingCell`
- `WineRecord` interface with all 11 D-06 fields + `field_confidence` JSONB
- `clearSession()` resets all state to initial

### StudioLayout.tsx
- Sticky `h-14` header with `Wine` icon and "WineOps Studio" title
- Nav tabs: Studio always visible; Queue + Certify only when `primaryRole === 'review_admin'`
- Role badge in top-right (Developer / Review Admin / Certified Contributor)
- User avatar initials (2-char from name)

### CommandBar.tsx (D-10, D-11)
- `detectIngestionType(value, hasPdfFile)` → `'pdf' | 'url' | 'manual' | null`
- PDF path: reads as base64, creates session (`pdf_upload`), POSTs to `/api/v1/onboarding/extract`
- URL path: creates session (`url_crawl`), sets records to `[]` (crawler async)
- Manual path: creates session (`manual_seed`), seeds one empty record
- Drag-drop: `onDrop` handler; rejects non-PDF with `toast.error`
- Detection hints: Globe icon for URL, FileText for PDF, Upload hint while dragging
- "Or start with an empty record →" button when no input detected
- `Loader2 animate-spin` + `Ingesting...` label during extraction

### SessionSummary.tsx
- Shows session ID (12-char prefix), record count badge, status badge (Extracting/Complete)
- Clear session button calls `clearSession()`

### WineRecordsTable.tsx (D-06)
- `COLUMN_ORDER` array with exactly 11 entries in D-06 order
- `wine_name` column sticky-left; `thead` sticky-top; amber row tint for review-confidence records
- `handleOverrideSuccess` updates Zustand store locally: sets value + `confidence: 1.0 source: human_override`
- Loading skeleton (3 rows of `<Skeleton>`) while `isLoading`

### FieldCell.tsx (D-05, D-07, D-08)
- **Display mode**: value text + `ConfidenceBadge` + source attribution
- **Edit mode**: click or Enter to activate; `autoFocus` input; Escape to cancel
- `requiresReason = (entry.confidence ?? 0) >= 0.8` (D-07)
- `canSave` requires non-empty, changed value AND if requiresReason → reason >= 5 chars
- Override POST to `/api/v1/studio/overrides` with full audit payload
- `data.status === 'pending'` → info toast; otherwise → success toast

### ReasonInput.tsx (D-08)
- `AnimatePresence` with `motion.div`: `height: 0 → auto`, `opacity: 0 → 1`
- Inline amber-bordered `textarea` (not modal)
- Error message for `< 5 chars`

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] detectIngestionType simplified — removed DataTransfer hack**
- **Found during:** Task 2 implementation
- **Issue:** Plan used `Object.assign(new DataTransfer(), { files: [pendingFile] }).files` which is non-standard (FileList is read-only)
- **Fix:** Changed signature to `detectIngestionType(value: string, hasPdfFile: boolean)` — semantically identical, no runtime issues
- **Files modified:** `CommandBar.tsx`
- **Commit:** `dd1bc2c`

**2. [Rule 2 - Missing Critical Functionality] Created StudioApprovalQueue and StudioCertify stubs**
- **Found during:** Task 1 — App.tsx lazy imports require resolvable module paths
- **Issue:** `lazy(() => import('./pages/studio/StudioApprovalQueue'))` would fail at runtime without the file
- **Fix:** Created minimal stub pages wrapping StudioLayout with EmptyState
- **Files modified:** `StudioApprovalQueue.tsx`, `StudioCertify.tsx`
- **Commit:** `dc377da`

---

## Known Stubs

| Stub | File | Reason |
|------|------|--------|
| `StudioApprovalQueue` renders placeholder | `apps/web/src/pages/studio/StudioApprovalQueue.tsx` | Full approval queue UI is Plan 04 scope |
| `StudioCertify` renders placeholder | `apps/web/src/pages/studio/StudioCertify.tsx` | Full certify flow is Plan 04 scope |
| `CommandBar` URL crawl sets empty records | `CommandBar.tsx:71` | URL crawl is async; record streaming from backend is Plan 04 scope |

---

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-13-13 (client studioRoles check) | `ProtectedRoute.tsx`, `StudioLayout.tsx` | Client-side role check is UX only — server always re-validates via `require_studio_role()` (Plan 02) |
| T-13-14 (reason bypass on client) | `FieldCell.tsx` | `canSave` enforces reason ≥ 5 chars for UX; server re-validates independently via old_confidence from DB |
| T-13-15 (studioRoles loading race) | `AuthContext.tsx`, `ProtectedRoute.tsx` | `studioRoles: undefined` = spinner; `[]` without role = denied. Pitfall 6 fully addressed |

---

## Self-Check

```
FOUND: apps/web/src/stores/useStudioSessionStore.ts
FOUND: apps/web/src/pages/studio/StudioLayout.tsx
FOUND: apps/web/src/pages/studio/Studio.tsx
FOUND: apps/web/src/pages/studio/CommandBar.tsx
FOUND: apps/web/src/pages/studio/SessionSummary.tsx
FOUND: apps/web/src/pages/studio/WineRecordsTable.tsx
FOUND: apps/web/src/pages/studio/FieldCell.tsx
FOUND: apps/web/src/pages/studio/ReasonInput.tsx
FOUND: apps/web/src/pages/studio/StudioApprovalQueue.tsx
FOUND: apps/web/src/pages/studio/StudioCertify.tsx
FOUND: commit dc377da (Task 1)
FOUND: commit dd1bc2c (Task 2)
FOUND: commit daab7e8 (Task 3)
FOUND: commit 8c1fc0a (fix)
```

## Self-Check: PASSED

---

## Plan Status: COMPLETE

All 3 tasks executed. /studio route fully wired with role-gated access, session store, CommandBar smart ingestion, 11-column WineRecordsTable with inline editing and conditional reason enforcement. StudioApprovalQueue and StudioCertify stubs created for Plan 04.

