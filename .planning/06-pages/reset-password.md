---
type: page
route: /reset-password
slug: reset-password
component: apps/web/src/pages/ResetPassword.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 5
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[forgot-password]]", "[[login]]"]
---

# /reset-password

## Surface — buttons → where they go

- **Reset Password** (submit) → API `POST /api/v1/auth/reset-password`, then auto-redirect → [[login]] `/login`
- **Request a new link** (invalid-token state) → [[forgot-password]] `/forgot-password`
- **Back to sign in** → [[login]] `/login`

## 1. Purpose
Set a new password from an emailed reset link (`?token=`). Three states: missing token → "Invalid reset link" (`ResetPassword.tsx:64-88`), form (min 8 chars, confirm match, `ResetPassword.tsx:33-40`), success → auto-redirect to `/login` after 2.5s (`ResetPassword.tsx:48-49`). Backend error messages are surfaced verbatim — safe here because possessing the token already proves email receipt, so no enumeration risk (`ResetPassword.tsx:50-58`).

## 2. Entry
**Cold URL only** — the link is minted server-side as `${FRONTEND_URL}/reset-password?token=…` (`auth.service.ts:1596`) and arrives by email. No in-app navigation *to* it; it links out to `/forgot-password` and `/login`.

## 3. Files
- Route binding: `apps/web/src/App.tsx:152` (eager, `App.tsx:67`)
- `apps/web/src/pages/ResetPassword.tsx` (190 lines)
- Chrome: `components/brand/AuthShell.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/reset-password` | `ResetPassword.tsx:44` (`{ token, newPassword }`) | ENDPOINTS.md:82 |

## 5. Signals
**none.**

## 6. Tier cut
Public; no scenario touches it (OD-48).

## 7. Rebrand surface
- `ResetPassword.tsx:66`, `:92`, `:111` — `AuthShell title="WineOps AI"` (all three states)
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.`
- `BrandMark.tsx:17` — default alt `WineOps`

## 8. State & config
- `VITE_API_GATEWAY_URL` (`ResetPassword.tsx:9`). No flags.

## 9. Gaps
none found. Client-side validation (length/match) duplicates but does not conflict with the DTO (`password-reset.dto.ts`, referenced from `Login.tsx:139-141`).
