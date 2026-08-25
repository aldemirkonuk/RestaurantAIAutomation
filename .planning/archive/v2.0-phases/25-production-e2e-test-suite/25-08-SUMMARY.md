---
phase: 25-production-e2e-test-suite
plan: "08"
subsystem: frontend-e2e
tags: [playwright, production, wave-f, write-flow, supabase-teardown, gap-closure, typescript]
dependency_graph:
  requires:
    - "25-06 (prod-smoke.spec.ts Wave F baseline — Wave F-1/F-2/F-3 tests)"
    - "25-02 (conftest_prod.py — onboarding_sessions not in E2E_TABLES, must be cleaned by Playwright)"
  provides:
    - "Wave F-4 full write-flow: CommandBar ingest → WineRecordsTable verify → /studio/queue verify → Supabase REST teardown"
    - "TEST-PROD-06 gap closed: Phase 25 verification score advances to 12/12"
  affects:
    - "apps/web/e2e/prod-smoke.spec.ts (modified)"
tech_stack:
  added: []
  patterns:
    - "Playwright response interception: page.on('response') to capture POST body without page.evaluate"
    - "Supabase REST teardown in Node.js via request.newContext() — SUPABASE_SERVICE_ROLE_KEY never in browser"
    - "commandInput.press('Enter') for onKeyDown-path ingest (avoids SyntheticMouseEvent as overrideType)"
    - "test.skip() guard for missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY env vars"
key_files:
  created: []
  modified:
    - "apps/web/e2e/prod-smoke.spec.ts"
decisions:
  - "Used commandInput.press('Enter') NOT ingestButton.click() — onClick passes SyntheticMouseEvent as overrideType which may corrupt the ingest type resolution; onKeyDown path calls handleIngest() with no args and resolves cleanly to detectedType='manual'"
  - "Intercepted /api/v1/studio/sessions response to capture session id rather than querying DB — avoids any direct Supabase SELECT in browser context"
  - "Teardown is non-fatal: if capturedSessionId is null, orphaned row is acceptable (small/ephemeral, no PII, documented in test comment)"
  - "Added type APIRequestContext to existing import — kept single-line import, no new import statement"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-05-05"
  tasks_completed: 1
  files_changed: 1
---

# Phase 25 Plan 08: Wave F-4 Write-Flow Gap Closure Summary

**One-liner:** Wave F-4 replaced from stub UI-check to full write-flow: CommandBar Enter-key ingest → WineRecordsTable column header assertion → /studio/queue heading assertion → Supabase REST DELETE teardown in Node.js request context only.

## What Was Built

### Task 1 — Wave F-4 full write-flow in prod-smoke.spec.ts

`apps/web/e2e/prod-smoke.spec.ts` modified:

**Import update:**
- Added `type APIRequestContext` to the existing `@playwright/test` import (line 26)

**Wave F-4 replacement** (lines 137–241):

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | `loginWithRealCredentials(page)` | `not.toHaveURL(/\/login/)` |
| 2 | `page.goto('/studio')` | `getByText('WineOps Studio').toBeVisible()` |
| 3 | Fill CommandBar input + `press('Enter')` | `getByRole('button', { name: 'Ingest' }).toBeEnabled()` |
| 4 | Wait for WineRecordsTable | `getByRole('columnheader', { name: 'Wine Name' }).toBeVisible()` + `getByText('E2E Write Flow Test 2026').toBeVisible()` |
| 5 | `page.goto('/studio/queue')` | `getByRole('heading', { name: 'Override Approval Queue' }).toBeVisible()` |
| 6 | Teardown via `request.newContext()` | `DELETE /rest/v1/onboarding_sessions?id=eq.<capturedSessionId>` |

**Security controls verified:**
- `SUPABASE_SERVICE_ROLE_KEY` used only in `request.newContext()` (Node.js process, never in page context)
- `page.evaluate` never called with credentials
- `ADMIN_API_KEY` / `X-Admin-Key` do not appear in file
- `test.skip()` guard if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` env vars absent

**Wave F-1 / F-2 / F-3 untouched** — 6 occurrences confirmed (2 each).

## Deviations from Plan

None — plan executed exactly as written. The implementation in the plan's `<action>` block was applied verbatim with the single structural addition of the `APIRequestContext` type annotation on `apiCtx` (already specified in the plan's implementation code block).

## Known Stubs

None — Wave F-4 exercises the live production write path. `capturedSessionId` being null is an accepted non-fatal condition documented in the test, not a stub.

## Threat Flags

No new security surface introduced — the test file itself is not a production artifact. All mitigations from the plan's threat register applied:

| Threat ID | Mitigation Applied | Evidence |
|-----------|-------------------|---------|
| T-25-08-01 | SUPABASE_SERVICE_ROLE_KEY in Node.js only | `request.newContext()` block; `grep page.evaluate.*serviceKey` → empty |
| T-25-08-02 | Service role used only for targeted DELETE | `DELETE /rest/v1/onboarding_sessions?id=eq.<id>` — no broad access |
| T-25-08-03 | Orphan row accepted/documented | `// If capturedSessionId is null...` comment in test body |
| T-25-08-04 | ADMIN_API_KEY absent | `grep "ADMIN_API_KEY\|X-Admin-Key" prod-smoke.spec.ts` → empty |

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1 | `6207311` | `apps/web/e2e/prod-smoke.spec.ts` |

## Self-Check: PASSED
