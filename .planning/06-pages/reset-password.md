---
type: page
route: /reset-password
slug: reset-password
component: apps/web/src/pages/ResetPassword.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 5
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[forgot-password]]", "[[login]]"]
---

# /reset-password

## Surface — buttons → where they go

- **Reset Password** (submit) → API `POST /api/v1/auth/reset-password`, then auto-redirect → [[login]] `/login`
- **Request a new link** (invalid-token state) → [[forgot-password]] `/forgot-password`
- **Back to sign in** → [[login]] `/login`

## 1. Purpose
Set a new password from an emailed reset link (`?token=`). Three states: missing token → "Invalid reset link" (`ResetPassword.tsx:64-88`), form (min 8 chars, confirm match, `ResetPassword.tsx:33-40`), success → auto-redirect to `/login` after 2.5s (`ResetPassword.tsx:48-49`). Backend error messages are surfaced verbatim — safe here because possessing the token already proves email receipt, so no enumeration risk (`ResetPassword.tsx:50-58`).

## 1a. Features
- Set a new password from the emailed link (min 8 chars, confirm match)
- Invalid/missing link state with "request a new link"
- Success auto-redirects to sign-in

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

---

## 10. Maturity

**complete.**

Every claim the page makes is enforced server-side. Token shape is validated by the DTO before the service runs (`password-reset.dto.ts:16`); existence, single-use and expiry are each checked separately with distinct messages (`auth.service.ts:1627-1643`); the new hash is written with the same 10-round bcrypt used at registration (`:1645-1650`, `SALT_ROUNDS` `:54`); and consumption invalidates *every* other live reset row for that user in one statement, so an older un-clicked link cannot be replayed afterwards (`:1662-1666`).

All three client states render and match real backend outcomes: missing token (`ResetPassword.tsx:64-88`), form with length + match validation mirroring `@MinLength(8)` (`:33-40` vs `password-reset.dto.ts:20`), success with a 2.5s redirect to [[login]] (`:48-49`).

One deliberate, documented limitation keeps this from being absolute rather than complete: existing sessions are **not** revoked (`auth.service.ts:1668-1675`). It is a named follow-up with a written rationale, not an oversight — see §11.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/reset-password` | `@Public()` | `auth.controller.ts:235-241` | `{success:true, message:"Password has been reset"}`; **no token pair** — the user must sign in again |

The token is validated twice: `@IsUUID()` on the DTO rejects malformed input before the service runs (`password-reset.dto.ts:16`), then the service checks existence, `used_at`, and `expires_at` (`auth.service.ts:1627-1643`).

### Fed by

Exclusively `password_resets` rows written by `POST /auth/request-password-reset` ([[forgot-password]] §11, `auth.service.ts:1575-1584`). No cron, no agent, no webhook touches this table — a token that does not come from that endpoint does not exist.

### Writes

| Table | Write | Downstream reaction |
|---|---|---|
| `users.password_hash` | bcrypt, 10 rounds (`auth.service.ts:1645-1650`, `SALT_ROUNDS` at `:54`) | none |
| `password_resets.used_at` | stamps **this token and every other unused row for the same user** in one statement (`:1662-1666`) | closes the replay window an older un-consumed link would otherwise leave open |

**Explicitly not done:** existing sessions are not revoked. The reasoning is written in-file (`auth.service.ts:1668-1675`) — nothing in this codebase tracks issued tokens, `TokenBlacklistService` can only blacklist a token handed to it, and `changePassword` has the same behaviour, so a one-off here would be inconsistent. Consequence to state plainly: **a stolen access token survives a password reset for up to 15 minutes, and a stolen refresh token for up to 7 days** (`auth.service.ts:437,442`).

## 12. Design intent

**Should be:** a single-use, time-boxed way back into an account that leaves no other route in afterwards.

| State | Handled? | Evidence |
|---|---|---|
| Empty (no `?token`) | yes | "Invalid reset link" + link to [[forgot-password]] (`ResetPassword.tsx:64-88`) |
| Loading | yes | submit disabled during the call (`:41-44`) |
| Error | yes, verbatim from the server | `:50-58` — safe here: holding the token already proves inbox access, so distinguishing "expired" from "already used" leaks nothing |
| Permission-denied | n/a — the token *is* the permission | — |

**Where it misleads:** the success screen says the password is reset and redirects to `/login` after 2.5s (`:48-49`), which is accurate; but a user resetting *because* they suspect compromise will reasonably read that as "other sessions are now out", and they are not (§11). That is the one honest gap on this page.

## 13. Roadmap

1. Surface the session caveat, or build revocation. The real fix is a per-user token generation/`iat` floor checked in `JwtStrategy#validate` (`jwt.strategy.ts:17-40`), applied to `changePassword` too. *Blocked:* founder decision — `auth.service.ts:1668-1675` deliberately deferred it rather than half-building it.
2. Depends on [[forgot-password]] item 1: mixed-case accounts can never reach this page at all.
3. Emit `password_reset_completed` (§5 is `none`) — the only end-of-funnel confirmation that a recovery worked. *Blocked:* no sink.
