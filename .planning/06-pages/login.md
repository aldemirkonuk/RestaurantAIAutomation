---
type: page
route: /login
slug: login
component: apps/web/src/pages/Login.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[PAGE_MAP]]", "[[dashboard]]", "[[forgot-password]]", "[[register]]"]
---

# /login

## Surface — buttons → where they go

- **Sign In** → API `POST /api/v1/auth/login`, then the `?redirect=` target or [[dashboard]] `/`
- **Google sign-in / One Tap** → API `POST /api/v1/auth/oauth/google`, same redirect
- **Forgot password?** → [[forgot-password]] `/forgot-password`
- **Create one now** → [[register]] `/register`

## 1. Purpose
Sign in with email/password or Google. The front door for every returning user (owner, staff, dev alike). Gmail addresses are auto-routed to Google's account chooser instead of attempting a password (`Login.tsx:35-37`); OAuth-only accounts flagged by the backend (`code: OAUTH_ONLY`) get the same treatment (`Login.tsx:52-58`).

## 2. Entry
Most-linked page in the app — in-degree 6 per [PAGE_MAP](../foundation/PAGE_MAP.md) (`/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access` all link back). Also the default redirect target of every `ProtectedRoute` when unauthenticated (`components/ProtectedRoute.tsx:16,38`), carrying `?redirect=` or router state so login returns you where you were (`Login.tsx:24-26`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:149` (eager import, `App.tsx:64`)
- `apps/web/src/pages/Login.tsx` (199 lines)
- Shared chrome: `apps/web/src/components/brand/AuthShell.tsx` (title/footer/BrandMark), `apps/web/src/components/auth/GoogleSignInButton.tsx`
- Auth plumbing: `apps/web/src/contexts/AuthContext.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/login` | `AuthContext.tsx:432` | ENDPOINTS.md:64 |
| GET | `/api/v1/auth/me` | `AuthContext.tsx:443` (after login) | ENDPOINTS.md:67 |
| POST | `/api/v1/auth/oauth/google` | `AuthContext.tsx:535` via `GoogleSignInButton` → `loginWithGoogle` (`GoogleSignInButton.tsx:81`) | ENDPOINTS.md:75 |

## 5. Signals
**none.** No tracking, NF events, or uxSignals are emitted from this page (grep of `Login.tsx` and its tree).

## 6. Tier cut
Public — upstream of every scenario; no `S..` touches it directly. Tiering runs through scenarios, not pages (OD-48, [TIER-MAP](../03-scenarios/TIER-MAP.md)).

## 7. Rebrand surface
- `Login.tsx:70` — `<AuthShell title="WineOps AI" …>` (page H1)
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI. All rights reserved.`
- `BrandMark.tsx:17` — default `alt = 'WineOps'` (screen-reader visible via AuthShell)

Adjacent server-side leaks surfaced *on* this page as error copy: `auth.service.ts:1360` ("No WineOps account uses that address…"), `auth.service.ts:1741` ("OAuth account email must match your WineOps email") — both rendered verbatim by `Login.tsx:63`.

## 8. State & config
- `VITE_GOOGLE_CLIENT_ID` (`lib/googleIdentity.ts:74`) — without it the Google button/One Tap can't initialise.
- `VITE_API_GATEWAY_URL` (via `AuthContext.tsx:25` / `services/api/client.ts:20`), default `http://localhost:4000`.
- No feature flags or per-restaurant toggles.

## 9. Gaps
- No Microsoft sign-in button, though the backend supports `POST /auth/oauth/microsoft` (`AuthContext.tsx:560`); Microsoft-only accounts are told to use "Forgot password?" instead (`Login.tsx:60-63`).
- "Remember me" deliberately removed 2026-07-31 (v3.0 task 44.15) — rationale preserved in `Login.tsx:129-141`.
