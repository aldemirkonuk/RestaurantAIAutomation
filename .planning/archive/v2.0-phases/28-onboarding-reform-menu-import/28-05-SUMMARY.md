---
phase: 28-onboarding-reform-menu-import
plan: 05
status: complete
completed: "2026-05-11"
---

# Plan 05 Summary: Post-Verify Redirect + Slim Onboarding.tsx

## What Was Built

### VerifyEmail.tsx — Smart Redirect
- Imports `getOnboardingProgress` from `services/api/menus`
- After successful email verification, checks if `menu_uploaded` before redirecting:
  - `menu_uploaded: false` → redirects to `/get-started` (new user path)
  - `menu_uploaded: true` → redirects to `/` (re-verification, already onboarded)
- Error in progress check fails open (defaults to `/get-started`)
- Step 3 text updated: "You'll be guided through setting up your wine list"

### Onboarding.tsx — Slim Redirect Page
- Replaced 1,100-line 9-step wizard with a 70-line redirect page
- Auto-redirect: `useEffect` sends users without menu → `/get-started`, with menu → stays
- Shows "Setup has moved" message with:
  - "Go to Dashboard →" button
  - "Set up my wine list" button → `/get-started`
  - Note: "POS integration → Settings → Integrations"
- Re-exports `OnboardingProvider`, `useOnboarding`, `ONBOARDING_STEPS`, `WineImportItem` 
  from `OnboardingContext` so existing imports across the app don't break
- `/onboarding` route preserved in App.tsx (from Plan 03)

## Auth Flow After This Phase
```
Register → POST /auth/register (account created, email sent)
  ↓
/verify-email page (waiting state)
  ↓
User clicks email link → GET /verify-email?token=...
  ↓
POST /auth/verify-email → success
  ↓
Check progress.menu_uploaded
  ↓ (false)        ↓ (true)
/get-started     /  (dashboard)
```

## Key Deviations
- None — followed plan exactly

## Self-Check: PASSED
- ✅ VerifyEmail.tsx imports getOnboardingProgress
- ✅ Redirect logic checks menu_uploaded before routing
- ✅ Onboarding.tsx is slim (70 lines, not 1100)
- ✅ Re-exports from OnboardingContext preserved
- ✅ No linter errors
