---
type: page
route: /login
slug: login
component: apps/web/src/pages/Login.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
maturity: partial
status: documented
updated: 2026-08-26
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

---

## 10. Maturity

**partial.**

Password and Google sign-in both complete end to end: `Login.tsx:52` → `AuthContext.tsx:432` → `POST /auth/login` (`auth.controller.ts:48-58`) → `AuthService#login` (`auth.service.ts:131-140`) → 15m/7d JWT pair (`auth.service.ts:435-443`), then `/auth/me` and the branch fetch populate context.

What is absent, each named:
- **Microsoft sign-in has a backend and no button.** `POST /auth/oauth/microsoft` exists (`auth.controller.ts:118-128`, `auth.service.ts:250`) and `AuthContext.tsx:560` wraps it; the page renders only `GoogleSignInButton`. Microsoft-only accounts are told to use "Forgot password?" (`auth.service.ts:111`).
- **Gmail addresses cannot use password login at all.** `Login.tsx:45` intercepts any `@gmail.com` address before `login()` is called and opens Google's chooser. A Gmail user who registered with a password (`/register` sets one — `auth.service.ts:595-605`) has no way to use it from this page.
- **The error copy distinguishes account states.** See §12 and §11's auth-posture column.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | **anonymous** — no `@Public()`, no `@UseGuards`; `JwtAuthGuard` is never a global guard (only `RateLimitGuard` + `TenantGuard` are, `app.module.ts:122-131`), so an undecorated route is open | `auth.controller.ts:48-58` | `{success, accessToken, refreshToken}`; payload carries `sub, email, role, restaurantId, emailVerified, app_metadata.roles` (`auth.service.ts:426-433`) |
| POST | `/api/v1/auth/oauth/google` | anonymous, same reason | `auth.controller.ts:103-113` | same token pair via `findOrCreateOAuthUser` (`auth.service.ts:1332`) |
| GET | `/api/v1/auth/me` | Bearer (`@UseGuards(JwtAuthGuard)`) | `auth.controller.ts:166-176` | `{userId, email, name, phone, role, restaurantId, hasPassword, linkedProviders}` (`auth.service.ts:1421-1430`) — **note: no `emailVerified`** |
| GET | `/api/v1/organizations/branches` | Bearer | `organizations.controller.ts:33,40` | branch list, via `refreshBranches` (`AuthContext.tsx:306`) |

Rate limiting: every `/auth/` path falls into the `auth` bucket, **10 requests / 60s** (`rate-limit.guard.ts:29,227-229`), keyed per-IP-per-route (`:246-273`). The store is an in-memory `Map` (`:69-121`) — per process, lost on redeploy, and multiplied by replica count. The guard's own sibling documents this caveat explicitly (`password-reset-throttle.guard.ts:20-28`).

### Fed by

| Data | Producer |
|---|---|
| `users` row + `password_hash` | `POST /auth/register/restaurant` (`auth.service.ts:596-607`) and `POST /auth/join` (`auth.service.ts:1182-1194`) |
| `role` claim | `user_restaurant_access` lookup at token mint (`auth.service.ts:413-420`) — falls back to `users.role` |
| `app_metadata.roles` (studio) | `user_roles` where `revoked_at IS NULL` (`auth.service.ts:400-405`) |

### Writes

No database write. Client-side only: `accessToken`/`refreshToken` (`AuthContext.tsx:434-436`), `availableRestaurants` + `activeRestaurantId` (`:293,300`). Downstream reactions: sets the `X-Restaurant-Id` default header (`:301`) and seeds `useAuthStore` (`:302`), which is what every later tenant-scoped call reads.

## 12. Design intent

**Should be:** the one door, with every working sign-in method on it and no message that tells a stranger anything about an address they typed.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a (form) | — |
| Loading | yes | `loading` disables submit, `Login.tsx:21,49` |
| Error | yes, normalised | `Login.tsx:25-28` collapses anything matching `/(invalid\|credentials\|email\|password\|401\|unauthorized)/i` into "Invalid email or password" |
| Permission-denied | n/a (pre-auth) | — |

**Where it misleads:**
- The normalisation at `:25-28` does **not** catch the `OAUTH_ONLY` message (`auth.service.ts:107-114`) — none of its words match the regex — so a Microsoft-only account renders *"This account uses Microsoft sign-in…"* verbatim. That is a positive existence confirmation for an arbitrary address. See §13.
- `Login.tsx:45` returns silently for Gmail addresses when the chooser opens; a user who dismisses the chooser sees a form that did nothing and no message.

## 13. Roadmap

1. Fold `OAUTH_ONLY` into the generic error, or gate it behind proof of address control — today it is an existence oracle on a public route (`auth.service.ts:107-114` vs `Login.tsx:25-28`).
2. Add the Microsoft button — the endpoint and the context method already exist (`auth.controller.ts:118`, `AuthContext.tsx:560`); this is UI only.
3. Let a Gmail user fall through to password login when the chooser is dismissed or fails (`Login.tsx:45`).
4. Move the rate-limit store off in-memory `Map` before running >1 gateway replica (`rate-limit.guard.ts:69-121`). *Blocked:* no shared cache reachable from a guard today — the same blocker is written up at `password-reset-throttle.guard.ts:20-28`.
5. Emit sign-in success/failure/method signals — §5 is `none` and this is the top of every funnel. *Blocked:* no signal sink exists (see [[get-started]] §11).
