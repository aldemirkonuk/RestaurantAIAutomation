---
type: page
route: /forgot-password
slug: forgot-password
softwares: [auth-onboarding]
component: apps/web/src/pages/ForgotPassword.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 4
maturity: partial
status: documented
updated: 2026-09-13
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[reset-password]]"]
---

# /forgot-password

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Send reset link** → API `POST /api/v1/auth/request-password-reset`
- **Back to sign in** → [[login]] `/login`

## 1. Purpose
Request a password-reset email. Deliberately enumeration-resistant: the UI has no "email not found" branch because the backend always answers success (`ForgotPassword.tsx:27-32`, reasoning mirrors `AuthService#requestPasswordReset`). Only genuinely non-account-revealing failures render: 429 throttle and generic 5xx (`ForgotPassword.tsx:37-41`).

## 1a. Features
- Request a password-reset email (always answers success — deliberately enumeration-resistant)
- Rate-limit (429) and server-error states; everything else looks like success by design

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

---

## 10. Maturity

**partial.**

The enumeration-resistant contract is real and correctly built: `requestPasswordReset` returns `{sent:true}` on every branch — unknown address (`auth.service.ts:1545-1550`), inside the 60s per-email cooldown (`:1561-1573`), and even on an insert failure (`:1586-1592`) — and the controller's message never varies (`auth.controller.ts:222-226`). Two throttles stack: per-IP 5/15min (`password-reset-throttle.guard.ts:32-51`) and per-email 60s (`auth.service.ts:1514,1564`).

**The named gap: the page silently fails for any account whose stored email is not all-lower-case.** `requestPasswordReset` lower-cases before lookup (`auth.service.ts:1535`) but nothing lower-cases on write — `registerRestaurant` stores `dto.email` raw (`:599`), `joinViaInvite` likewise (`:1186`), and `validateUser` compares raw (`:91`). A user who registers `Foo@Bar.com` therefore misses the `.eq("email", normalizedEmail)` match at `:1540`, takes the unknown-address branch, and sees the success screen (`ForgotPassword.tsx:33`) while no email is ever sent. Enumeration resistance makes this failure permanently invisible to the user *and* to support.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/request-password-reset` | `@Public()` + `@UseGuards(PasswordResetThrottleGuard)` | `auth.controller.ts:213-227` | always `{success:true, message:"If an account exists…"}` — identical for every branch |

Rate limiting is layered on purpose: `PasswordResetThrottleGuard` catches one IP cycling many addresses (5/15min, `password-reset-throttle.guard.ts:32-33`); the per-email DB cooldown catches many IPs hammering one address (`auth.service.ts:1552-1573`). Both stores are in-memory/per-process — written down at `password-reset-throttle.guard.ts:20-28` rather than discovered later. The global `auth` bucket (10/min, `rate-limit.guard.ts:29`) applies on top.

### Fed by

`users` rows (created by `/auth/register/restaurant` and `/auth/join`) and the `password_resets` table, which only this endpoint writes.

### Writes

| Table | Write | Downstream reaction |
|---|---|---|
| `password_resets` | insert `{user_id, email, requested_ip}`, token returned by the DB default (`auth.service.ts:1575-1584`) | the row is the only thing that makes [[reset-password]] work |
| — | Gmail send, subject "Reset your WineOps AI password", link `${FRONTEND_URL}/reset-password?token=…` (`:1594-1606`) | falls back to a **mock sender** when Gmail OAuth is unconfigured; failure is logged, never surfaced (`:1607-1614`) |

No queue, no notification, no ledger entry.

## 12. Design intent

**Should be:** a request form that behaves identically for every address on earth, and still gets a real email to real accounts.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a | — |
| Loading | yes | `ForgotPassword.tsx:23` |
| Error | yes, and correctly scoped | 429 and generic 5xx only (`:37-41`) — deliberately no "not found" branch |
| Permission-denied | n/a (pre-auth) | — |

**Where it misleads:** the success screen is unconditional (`:33`). That is right for enumeration resistance and wrong for the two cases where nothing was sent — the mixed-case account above, and the mock-sender fallback (`auth.service.ts:1602-1611`). This is the contract's "success toast for a write that did not land", made structurally undetectable. Any fix has to preserve the identical response and repair the underlying cause instead.

## 13. Roadmap

1. Normalise email to lower-case on write and on every lookup (`auth.service.ts:599`, `:1186`, `:91`), with a backfill migration for existing rows. Restores this page for mixed-case accounts without touching the response contract.
2. Alert on the mock-sender fallback — today a misconfigured `GmailService` degrades this page to a no-op with only a `logger.warn` (`auth.service.ts:1607-1611`).
3. Move both throttle stores to a shared cache before the gateway runs more than one replica. *Blocked:* no guard-reachable shared cache — stated at `password-reset-throttle.guard.ts:20-28`.
4. Emit a `password_reset_requested` signal (§5 is `none`) — it is the only observable proxy for login trouble. *Blocked:* no sink (see [[get-started]] §11).


### PublicShell implementation — 2026-09-13

Implemented in the page-finalization working branch from `60ed83a7`; this is a code/test record, not a production-deployment claim. The new public treatment uses the shared `PublicShell` and `usePublicDesign()` (`VITE_MUDAVYM_PUBLIC`, overridden by the existing `mudavym.design.public` browser preference). The legacy rendering remains available with that switch off. No new server authorization or public endpoint is introduced by the visual port.

The new form preserves the login email prefill, required email input, per-IP throttle message and enumeration-resistant request. A network failure stays a recoverable error; success says a reset email was **requested**, conditional on an account existing, because the API deliberately does not prove delivery. One-hour expiry remains. The verification/reset/Studio invite email subject/body/header/footer product identity now reads Mudavym; underlying sender account and links remain deployment configuration. No real email was sent to validate this change.

Verification: `apps/web/src/pages/__tests__/publicPages.recovery.test.tsx` (ten behavior tests across the seven pages), existing PublicShell/public-switch tests (34), web/gateway TypeScript checks. Vendor read/JSON-LD tests (five) and account email body/sender identity tests (five) are isolated and perform no real sends or database writes. Remaining product choices are recorded under [[OPEN-DECISIONS#Public-page completion — 2026-09-13]]. The earlier audit is available from [[MUDAVYM-TRANSITION-2026-09-13]].
