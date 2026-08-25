---
type: page
route: /forgot-password
slug: forgot-password
component: apps/web/src/pages/ForgotPassword.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 4
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[reset-password]]"]
---

# /forgot-password

## Surface — buttons → where they go

- **Send reset link** → API `POST /api/v1/auth/request-password-reset`
- **Back to sign in** → [[login]] `/login`

## 1. Purpose
Request a password-reset email. Deliberately enumeration-resistant: the UI has no "email not found" branch because the backend always answers success (`ForgotPassword.tsx:27-32`, reasoning mirrors `AuthService#requestPasswordReset`). Only genuinely non-account-revealing failures render: 429 throttle and generic 5xx (`ForgotPassword.tsx:37-41`).

## 2. Entry
- `/login` → "Forgot password?" (`Login.tsx:144-149`)
- `/reset-password` invalid-token state → "Request a new link" (`ResetPassword.tsx:78-83`)
In-degree 2 per [PAGE_MAP](../foundation/PAGE_MAP.md).

## 3. Files
- Route binding: `apps/web/src/App.tsx:151` (eager, `App.tsx:66`)
- `apps/web/src/pages/ForgotPassword.tsx` (136 lines)
- Chrome: `components/brand/AuthShell.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/request-password-reset` | `ForgotPassword.tsx:26` | ENDPOINTS.md:80 |

## 5. Signals
**none.**

## 6. Tier cut
Public; no scenario touches it (OD-48).

## 7. Rebrand surface
- `ForgotPassword.tsx:49` and `:76` — `AuthShell title="WineOps AI"` (both render states)
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.`
- `BrandMark.tsx:17` — default alt `WineOps`

The email this page triggers is also branded server-side: subject "Reset your WineOps AI password" (`auth.service.ts:1603`), link built as `${FRONTEND_URL}/reset-password?token=…` (`auth.service.ts:1596`).

## 8. State & config
- `VITE_API_GATEWAY_URL` (`ForgotPassword.tsx:9`), default `http://localhost:4000`. No flags or toggles.

## 9. Gaps
none found beyond the shared brand debt. The always-succeeds contract is intentional, documented in-file.
