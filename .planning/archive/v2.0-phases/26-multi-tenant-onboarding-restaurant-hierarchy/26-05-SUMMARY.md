---
phase: 26-multi-tenant-onboarding-restaurant-hierarchy
plan: "05"
subsystem: frontend-registration-flow
tags: [onboarding, registration, two-path-wizard, email-verification, invite-flow, framer-motion]
dependency_graph:
  requires: [26-02, 26-03, 26-04]
  provides: [two-path Register.tsx wizard, VerifyEmail.tsx holding page, emailVerified ProtectedRoute gate, /verify-email route]
  affects:
    - apps/web/src/pages/Register.tsx
    - apps/web/src/pages/VerifyEmail.tsx
    - apps/web/src/components/ProtectedRoute.tsx
    - apps/web/src/App.tsx
    - apps/web/src/contexts/AuthContext.tsx
tech_stack:
  added: []
  patterns:
    - debounced fetch (400ms) for inline invite code validation
    - URL param auto-routing (?invite=CODE, ?type=join, ?type=new)
    - client-side rate limiting (60s cooldown on resend)
    - sub-component pattern with AnimatePresence exit transitions
    - Intl.DateTimeFormat() for browser timezone auto-detection
key_files:
  created:
    - apps/web/src/pages/VerifyEmail.tsx
  modified:
    - apps/web/src/pages/Register.tsx
    - apps/web/src/components/ProtectedRoute.tsx
    - apps/web/src/App.tsx
    - apps/web/src/contexts/AuthContext.tsx
decisions:
  - "Sub-components (PathSelector, PathAStep1, PathAStep2, PathBStep1, PathBStep2) defined inside Register() as closures — shares parent state without prop drilling; AnimatePresence handles transition on unmount"
  - "Invite validation uses relative URL /api/v1/auth/invite/:code (not API_URL) — relies on Vite proxy, matches backend unauthenticated endpoint"
  - "emailVerified gate uses strict === false check — undefined (pre-existing users, invite joiners) passes through; only explicit false triggers redirect"
  - "VerifyEmail uses window.location.href=/ after verify to force full page reload, refreshing JWT-decoded user state in AuthContext"
  - "AuthContext User interface extended with emailVerified?: boolean as Rule 2 deviation — field was documented in plan context but missing from implementation"
metrics:
  duration_minutes: 12
  completed_date: "2026-05-07"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 26 Plan 05: Two-Path Registration Wizard Summary

**One-liner:** Full Register.tsx replacement with two-path wizard (card selector → Path A invite flow + Path B 3-step create restaurant wizard) plus VerifyEmail.tsx holding page and emailVerified ProtectedRoute gate.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Replace Register.tsx with two-path wizard | 2328cfa | apps/web/src/pages/Register.tsx |
| 2 | VerifyEmail.tsx + ProtectedRoute gate + /verify-email route | e3d213a | apps/web/src/pages/VerifyEmail.tsx, apps/web/src/components/ProtectedRoute.tsx, apps/web/src/App.tsx, apps/web/src/contexts/AuthContext.tsx |

## What Was Built

### Task 1 — Register.tsx (complete replacement)

- **Removed `restaurantId` field** — root cause of broken registration (ONBOARD-01). No user could know the UUID to fill this field.
- **Path Selector**: Two large card-style `<button>` elements (not radio buttons per D-01, D-08) with icons (Users for join, Building2 for create), hover border transition, and arrow indicator
- **URL param auto-routing (D-09)**:
  - `?invite=CODE` → Path A with code pre-filled + starts validation
  - `?type=join` → Path A (invite entry), no code pre-filled
  - `?type=new` → Path B (create restaurant), skips selector
  - Default → path selector shown
- **Path A Step 1**: Monospace invite code input (8-char, uppercase-forced) with 400ms debounced validation calling `GET /api/v1/auth/invite/:code`. InviteValidationFeedback component shows:
  - Loading spinner during validation
  - Green card with restaurant name, city, inviter name on valid code
  - Specific error messages per reason: expired / already used / code not found with typo hint (D-08)
  - Continue button disabled until `invitePreview.valid === true`
- **Path A Step 2**: Invite preview banner (restaurant + city + role) + account fields (name, email, password, confirm) → `joinViaInvite()` → navigate to `/`
- **Path B Step 1**: Step indicator bar "Step 1 of 2" + account fields → advance to Step 2
- **Path B Step 2**: Step indicator bar "Step 2 of 2" + restaurant fields (name, address, city, phone, cuisine type dropdown) → `registerRestaurant()` → navigate to `/verify-email`
- **Timezone auto-detection**: `Intl.DateTimeFormat().resolvedOptions().timeZone` passed to `registerRestaurant()` (ONBOARD-07)
- **Visual style**: matches Login.tsx exactly — `bg-white/60 backdrop-blur-md border border-white/20 rounded-2xl shadow-2xl p-8` card, framer-motion entry animation (ONBOARD-08)

### Task 2 — VerifyEmail.tsx + ProtectedRoute + App.tsx

- **VerifyEmail.tsx**: "Check your email" holding page showing user's email address
  - Without `?token=`: shows "Resend Verification Email" button with 60s client-side cooldown (T-26-05-03). Displays resent timestamp after send.
  - With `?token=CODE`: shows "Verify My Email" button that POSTs token to `/api/v1/auth/verify-email`, stores new tokens (with `emailVerified:true` in JWT), shows success state, then redirects to `/` via `window.location.href` (forces AuthContext reload)
  - "Back to Sign In" link
- **ProtectedRoute.tsx**: Added `user?.emailVerified === false` gate between the `!isAuthenticated` redirect and the studio role loading guard. Redirects to `/verify-email` (T-26-05-02). Uses strict `=== false` so `undefined` (invite joiners, pre-existing users) passes through.
- **App.tsx**: Added `/verify-email` public route pointing to `<VerifyEmail />`, alongside `/register` in the public routes block. Imported `VerifyEmail` from `./pages/VerifyEmail`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added `emailVerified?: boolean` to User interface in AuthContext.tsx**
- **Found during:** Task 2 — writing ProtectedRoute gate `user?.emailVerified === false`
- **Issue:** The plan's context documented `emailVerified?: boolean` in the User interface, but Plan 26-04 did not add it. TypeScript would reject `user?.emailVerified` without the field on the interface.
- **Fix:** Added `emailVerified?: boolean` to the `User` interface in `AuthContext.tsx`. Field is populated from the `/api/v1/auth/me` JWT payload response (which the backend's `registerRestaurant` endpoint returns with `emailVerified: false` in the JWT).
- **Files modified:** `apps/web/src/contexts/AuthContext.tsx`
- **Commit:** e3d213a (included in Task 2 commit)

**2. [Rule 1 - Code Quality] Changed `err: any` to `err: unknown` with type narrowing**
- **Found during:** Task 1 and Task 2 — TypeScript strict mode flags `catch (err: any)` 
- **Fix:** Used `err: unknown` with `err instanceof Error ? err.message : 'fallback'` pattern in all catch blocks
- **Files modified:** `apps/web/src/pages/Register.tsx`, `apps/web/src/pages/VerifyEmail.tsx`
- **Commit:** 2328cfa, e3d213a

## Verification Results

```
grep "restaurantId" apps/web/src/pages/Register.tsx | wc -l     → ✅ 0 (ONBOARD-01 fixed)
grep "border-2.*border-gray-200.*rounded-xl" Register.tsx        → ✅ 2 card-style selectors (D-01, D-08)
grep -o "debounceRef\|400" Register.tsx | wc -l                  → ✅ matches (D-08 400ms debounce)
grep -o "joinViaInvite\|registerRestaurant" Register.tsx | wc -l → ✅ 4 (import + usage for both)
grep "Intl.DateTimeFormat" Register.tsx                          → ✅ timezone auto-detect (ONBOARD-07)
grep "navigate.*verify-email" Register.tsx                       → ✅ Path B redirect after success
grep "expired.*Contact\|already been used\|check for typos" Register.tsx → ✅ specific error messages (D-08)
grep "searchParams.get.*invite\|searchParams.get.*type" Register.tsx → ✅ URL param routing (D-09)
grep "StepIndicator\|Step.*of" Register.tsx                      → ✅ step indicator component (D-08)

grep "verify-email" apps/web/src/App.tsx                         → ✅ route registered
grep "VerifyEmail" apps/web/src/App.tsx                          → ✅ import + Route element
grep "emailVerified.*false" apps/web/src/components/ProtectedRoute.tsx → ✅ gate present
grep "Navigate.*verify-email" apps/web/src/components/ProtectedRoute.tsx → ✅ redirect present
grep "resend-verification\|60000" apps/web/src/pages/VerifyEmail.tsx → ✅ resend + rate limit (D-05)
grep "searchParams.get.*token" apps/web/src/pages/VerifyEmail.tsx → ✅ token from URL

pnpm build: ✓ built in 9.12s — 0 TypeScript errors
```

## Known Stubs

None. All forms wire directly to `registerRestaurant()` and `joinViaInvite()` methods from AuthContext (implemented in Plan 26-04). The invite validation fetches live from `GET /api/v1/auth/invite/:code` (implemented in Plan 26-02). The resend/verify endpoints are wired to live backend routes.

## Threat Flags

No new security surface beyond plan's threat model:
- T-26-05-01 (accepted): Frontend invite validation is UX-only; backend validates atomically on `POST /auth/join`
- T-26-05-02 (mitigated): ProtectedRoute gates `emailVerified === false` users to `/verify-email` before any dashboard render ✅
- T-26-05-03 (mitigated): 60s client-side cooldown on resend + backend `resend_count` check ✅
- T-26-05-04 (accepted): Invite preview returns restaurant name/city — intentionally public for UX

## Self-Check: PASSED

- [x] `apps/web/src/pages/Register.tsx` — modified (committed 2328cfa)
- [x] `apps/web/src/pages/VerifyEmail.tsx` — created (committed e3d213a)
- [x] `apps/web/src/components/ProtectedRoute.tsx` — modified (committed e3d213a)
- [x] `apps/web/src/App.tsx` — modified (committed e3d213a)
- [x] `apps/web/src/contexts/AuthContext.tsx` — modified (committed e3d213a, Rule 2 deviation)
- [x] Both commits exist in git log
- [x] TypeScript build: 0 errors (✓ built in 9.12s)
- [x] STATE.md NOT modified (as instructed by orchestrator)
- [x] ROADMAP.md NOT modified (as instructed by orchestrator)
