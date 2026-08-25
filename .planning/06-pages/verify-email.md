---
type: page
route: /verify-email
slug: verify-email
component: apps/web/src/pages/VerifyEmail.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[register]]", "[[get-started]]", "[[login]]", "[[dashboard]]"]
---

# /verify-email

## Surface — buttons → where they go

- **Verify My Email** → API `POST /api/v1/auth/verify-email`, then auto-redirect → [[get-started]] `/get-started` (or [[dashboard]] `/` when a menu is already uploaded)
- **Resend Verification Email** → API `POST /api/v1/auth/resend-verification` (client rate-limit 1/min)
- **Back to Sign In** → [[login]] `/login`

## 1. Purpose
Post-registration email-verification gate for Path B (restaurant-creating) users. Two modes: **without `?token`** — "Check Your Email" instructions plus a resend button (client-side rate-limited 1/min, T-26-05-03, `VerifyEmail.tsx:66-70`); **with `?token`** — a "Verify My Email" button that redeems the token, stores fresh JWTs carrying `emailVerified: true` (`VerifyEmail.tsx:44-45`), then routes to `/get-started` — or straight to `/` when a menu is already uploaded (re-verification flows, `VerifyEmail.tsx:48-53`).

## 2. Entry
- Redirect target: `Register.tsx:932` after Path B submit, and `ProtectedRoute.tsx:41-44` bounces any authenticated-but-unverified user here (D-05, T-26-05-02) — so it guards the whole dashboard.
- Cold URL from the verification email: link built as `${FRONTEND_URL}/verify-email?token=…` (`auth.service.ts:705`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:153` (eager, `App.tsx:68`)
- `apps/web/src/pages/VerifyEmail.tsx` (194 lines)
- Chrome: `components/brand/AuthShell.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/verify-email` | `VerifyEmail.tsx:32` | ENDPOINTS.md:85 |
| POST | `/api/v1/auth/resend-verification` | `VerifyEmail.tsx:74` | ENDPOINTS.md:81 |
| GET | `/onboarding/progress` | `VerifyEmail.tsx:49` via `getOnboardingProgress` (`services/api/menus.ts:113`) | ENDPOINTS.md:286 (atlas lists it under `menus/menus`; the controller is `@Controller("onboarding")`, `menus.controller.ts:68`) |

## 5. Signals
**none.** Verification success/failure is not tracked.

## 6. Tier cut
Public; gate between registration and every Core scenario (OD-48).

## 7. Rebrand surface
- `VerifyEmail.tsx:128` — step copy "Open the email from WineOps AI"
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.`
- `BrandMark.tsx:17` — default alt `WineOps`

**The bigger leak is the email itself, server-side** (the known one from the task brief): subject "Verify your WineOps AI account" (`auth.service.ts:710`), `<title>` (`:731`), header `WineOps AI` (`:735`), body "activate your WineOps account" (`:740`), "didn't create a WineOps account" (`:748`), footer `© … WineOps AI` (`:757`). The page and the email must be rebranded together or the flow contradicts itself.

## 8. State & config
- `VITE_API_GATEWAY_URL` (`VerifyEmail.tsx:10`).
- Server: `FRONTEND_URL` decides where the emailed link points; falls back to a hard-coded Vercel URL (`auth.service.ts:702-704`).
- Email delivery falls back to mock when Gmail OAuth is unconfigured (`auth.service.ts:708` comment) — in that state, the resend button "succeeds" without a real email leaving.

## 9. Gaps
- Uses raw `fetch` + manual `localStorage.getItem('accessToken')` (`VerifyEmail.tsx:31-38`) instead of the shared axios client — no auto-refresh on 401 during verification.
- Success path navigates via `window.location.href` (`VerifyEmail.tsx:52`) — full reload, deliberate or not, unrecorded.
