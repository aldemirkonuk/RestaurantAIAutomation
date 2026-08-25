---
type: page
route: /verify-email
slug: verify-email
component: apps/web/src/pages/VerifyEmail.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
maturity: hollow
status: documented
updated: 2026-08-26
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

---

## 10. Maturity

**hollow.** The page performs a real write. The gate it exists to enforce does not exist.

The write is genuine: `POST /auth/verify-email` stamps `email_verifications.verified_at`, flips `users.email_verified`, and re-mints tokens (`auth.service.ts:1257-1287`), with distinct rejections for unknown / already-used / expired tokens (`:1264-1271`).

**The gate is dead, on both sides.**

*Client.* The only enforcement in the SPA is `ProtectedRoute.tsx:42` — `if (user?.emailVerified === false)`. Nothing ever sets that field. `GET /auth/me` does not return it: `getProfileForUser` selects and returns exactly `userId, email, name, phone, role, restaurantId, hasPassword, linkedProviders` (`auth.service.ts:1409-1430`), and the controller adds only `restaurantId` (`auth.controller.ts:166-176`). A repo-wide grep for `emailVerified` in `apps/web/src` returns three hits and no writer: the optional type field (`AuthContext.tsx:49`), this read (`ProtectedRoute.tsx:42`), and a comment (`VerifyEmail.tsx:43`). So `user.emailVerified` is always `undefined`, `undefined === false` is `false`, and the redirect never fires.

*Server.* Nothing checks it either. `JwtStrategy#validate` returns `{userId, email, name, role, restaurantId}` (`jwt.strategy.ts:33-39`) — `emailVerified` is in the signed payload (`auth.service.ts:431`) but is dropped before it reaches `request.user`, and no guard reads it.

Net effect: an unverified Path-B owner holds a fully privileged session. They land here only because `Register.tsx:932` navigates them here; typing `/` goes straight to the dashboard, and calling the API directly was never gated at all. §2's claim that this page "guards the whole dashboard" is **stale** — that is the §9 verdict this dossier revises.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/verify-email` | **anonymous** — no `@Public()`, no `@UseGuards`; `JwtAuthGuard` is not global (`app.module.ts:122-131`), so the token in the body is the only credential | `auth.controller.ts:409-413` | fresh token pair with `emailVerified:true` in the payload |
| POST | `/api/v1/auth/resend-verification` | Bearer | `auth.controller.ts:418-426` | `{sent:true}`; 60s server cooldown on `last_resent_at` (`auth.service.ts:1307-1313`) |
| GET | `/onboarding/progress` | Bearer | `menus.controller.ts:68-69,76-80` (`@Controller("onboarding")`) | progress row; **404 when no row exists** (`menus.service.ts:655-658`), mapped to `null` client-side (`services/api/menus.ts:41-44`) |

The page sends the access token on verify as a bonus header but the server ignores it — the URL token alone identifies the user (`auth.service.ts:1258-1262`). That is correct for a link clicked in a different browser, and worth stating rather than assuming.

### Fed by

`email_verifications` rows, written only by `queueEmailVerification` (`auth.service.ts:691-728`), called from registration (`:645`) and resend (`:1323`). The email link is `${FRONTEND_URL}/verify-email?token=…` with a **hard-coded Vercel fallback** if `FRONTEND_URL` is unset (`:703-706`) — a misconfigured deploy mails users to someone else's origin.

### Writes

| Table | Write | Downstream reaction |
|---|---|---|
| `email_verifications.verified_at` | `auth.service.ts:1273-1276` | makes the token single-use (`:1265-1266`) |
| `users.email_verified` | `→ true` (`:1278-1283`) | **nothing reads it** — see §10 |
| localStorage tokens | `VerifyEmail.tsx:44-45` | replaces the session in place |
| resend counters | `resend_count`, `last_resent_at` (`auth.service.ts:1315-1321`) | server-side 1/min limit |

A column written by one endpoint and read by nothing is exactly the "data with no consumer" §11 asks to be named.

## 12. Design intent

**Should be:** the wall between "claimed an address" and "operating a restaurant tenant" — enforced where it cannot be walked around, i.e. in the gateway.

| State | Handled? | Evidence |
|---|---|---|
| Empty (no `?token`) | yes | instructions + resend (`VerifyEmail.tsx:157-184`) |
| Loading | yes | `verifying` / `resending` spinners (`:146-155`, `:169-177`) |
| Error | yes | inline banner from the server message (`:119-124`, `:54-59`) |
| Permission-denied | n/a | the token is the credential |

**Where it misleads:**
- The whole page implies a gate that is not there (§10) — the single most misleading surface in this cluster.
- The resend button reports *"Verification email resent! Check your inbox."* (`:85`) even when `GmailService` is on its mock fallback (`auth.service.ts:708-720`, which only `logger.warn`s). A success toast for an email that never left.
- Uses raw `fetch` + `localStorage` (`:31-38,73-79`) instead of the shared axios client, so it gets no 401 refresh (`services/api/client.ts:82-92`).
- Success navigates with `window.location.href` (`:52`) — a full reload, which is what makes the freshly stored tokens take effect; undocumented but load-bearing.

## 13. Roadmap

1. **Make the gate real, server-side.** Put `emailVerified` on `request.user` in `jwt.strategy.ts:33-39` and enforce it in a guard on write-bearing controllers. Client-only gating cannot work — the API was always open.
2. **Repair the client gate meanwhile:** return `email_verified` from `getProfileForUser` (`auth.service.ts:1421-1430`) so `ProtectedRoute.tsx:42` stops comparing `undefined` to `false`. One-line server change, immediate effect.
3. Make the mock-sender fallback fail loudly, or report `{sent:false}` so `VerifyEmail.tsx:85` can tell the truth.
4. Fail startup when `FRONTEND_URL` is unset instead of falling back to a hard-coded Vercel host (`auth.service.ts:703-706`) — same posture `jwt-secret.ts` now takes for `JWT_SECRET`.
5. Move to the shared axios client (`:31-38`).
6. Track verify success/failure/resend (§5 is `none`). *Blocked:* no sink.
