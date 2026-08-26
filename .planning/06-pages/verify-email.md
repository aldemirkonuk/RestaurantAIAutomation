---
type: page
route: /verify-email
slug: verify-email
component: apps/web/src/pages/VerifyEmail.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 3
maturity: partial
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

## 1a. Features
- "Check Your Email" instructions with a resend button (rate-limited to 1/min)
- With an emailed `?token`: a "Verify My Email" button that redeems it and signs you in verified
- Routes onward smartly: to Get Started, or straight to the dashboard when a menu already exists

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

**partial** (was **hollow** until 2026-08-26). The page always performed a real write; the gate it exists to enforce did not exist in either layer. It does now. What keeps it from **complete** is §5 — verification success, failure and resend are still untracked — and the mock-sender fallback in §8, which now has teeth: with the gate live, a silently mocked verification email is the difference between a slow signup and a locked-out account.

The write is genuine: `POST /auth/verify-email` stamps `email_verifications.verified_at`, flips `users.email_verified`, and re-mints tokens (`auth.service.ts:1257-1287`), with distinct rejections for unknown / already-used / expired tokens (`:1264-1271`).

**The gate is live on both sides as of 2026-08-26** — see [[0023-email-verification-is-enforced]] and OD-79. What follows is the diagnosis that produced the fix, kept because the failure shape recurs.

*Client, before.* The only enforcement in the SPA was `ProtectedRoute.tsx:42` — `if (user?.emailVerified === false)`. Nothing ever set that field. `GET /auth/me` did not return it: `getProfileForUser` selected and returned exactly `userId, email, name, phone, role, restaurantId, hasPassword, linkedProviders`, and the controller added only `restaurantId`. `AuthContext` populates `user` from `/auth/me` and nowhere else — seven call sites, none of which decode the JWT. So `user.emailVerified` was always `undefined`, `undefined === false` is `false`, and the redirect never fired.

*Server, before.* Nothing checked it either. `JwtStrategy#validate` returned `{userId, email, name, role, restaurantId}` (`auth/strategies/jwt.strategy.ts:33-39`) — `emailVerified` was in the signed payload but was dropped before it reached `request.user`, so no guard could have read it even if one had existed.

*Now.* `getProfileForUser` returns `emailVerified` and `JwtStrategy#validate` carries it, both **from the database column rather than the token claim** — a token is a snapshot from issue time, so a user who verifies mid-session would otherwise stay locked out for the remaining 15 minutes. `assertEmailVerified` runs inside `JwtAuthGuard` immediately after passport populates `request.user`, beside `assertTenantMatch` and for the same reason: a global `APP_GUARD` executes before there is a user to inspect and would have been inert. It fails **closed** on a missing field. Six routes carry `@AllowUnverified` so a blocked session can still discover why it is blocked, resend, and leave.

Net effect, before: an unverified Path-B owner held a fully privileged session, and calling the API directly was never gated at all. §2's claim that this page "guards the whole dashboard" was **stale then and is accurate now**.

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
| `users.email_verified` | `→ true` (`:1278-1283`) | read by `getProfileForUser` (`/auth/me`) and `JwtStrategy#validate`, and enforced by `assertEmailVerified` inside `JwtAuthGuard`. **Nothing read it before 2026-08-26** — see §10 |
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

1. ~~**Make the gate real, server-side.**~~ **DONE 2026-08-26** — `assertEmailVerified` in `JwtAuthGuard`, fails closed, six `@AllowUnverified` routes. [[0023-email-verification-is-enforced]].
2. ~~**Repair the client gate.**~~ **DONE 2026-08-26** — `getProfileForUser` and `JwtStrategy#validate` both return it, sourced from the DB column.
3. Make the mock-sender fallback fail loudly, or report `{sent:false}` so `VerifyEmail.tsx:85` can tell the truth. **Now higher stakes than when it was written:** with the gate live, a silently mocked verification email is the difference between a slow signup and a locked-out account. `gmail.service.ts:80-85` returns early when `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` are absent. Production has them, so this is a staging/local hazard today — but it is one deploy setting away from being a production one.
4. Fail startup when `FRONTEND_URL` is unset instead of falling back to a hard-coded Vercel host (`auth.service.ts:703-706`) — same posture `jwt-secret.ts` now takes for `JWT_SECRET`.
5. Move to the shared axios client (`:31-38`).
6. Track verify success/failure/resend (§5 is `none`). *Blocked:* no sink.
