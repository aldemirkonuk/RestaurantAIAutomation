---
type: page
route: /login
slug: login
softwares: [auth-onboarding]
component: apps/web/src/pages/Login.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 3
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[PAGE_MAP]]", "[[dashboard]]", "[[forgot-password]]", "[[register]]", "[[0024-identity-first-signin]]"]
---

# /login

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

**Identity-first since 2026-08-26 (ADR 0024).** Step 1 asks only for the address; step 2 renders the methods that identity actually has.

- **Continue** (step 1) → API `POST /api/v1/auth/sign-in-methods`, then step 2
- **Change** (step 2) → back to step 1, same page, no navigation
- **Sign In** → API `POST /api/v1/auth/login`, then the `?redirect=` target or [[dashboard]] `/`
- **Google sign-in / One Tap** → API `POST /api/v1/auth/oauth/google`, same redirect
- **Set a password** / **Forgot password?** → [[forgot-password]] `/forgot-password?email=…`
- **Create one now** → [[register]] `/register`

## 1. Purpose
Sign in with the methods this identity actually has. Enter an address, and the page asks the gateway which methods exist for it — `password_hash` present, plus rows in `user_oauth_accounts` — and renders exactly those (`Login.tsx:70-79`, `auth.service.ts:1890`). Nothing is inferred from the address.

Two inference paths were removed here (ADR 0024, both fabrications under ADR 0020):
- The `@gmail.com` shortcut that opened Google's chooser before `login()` ever ran. Two production accounts are gmail addresses with a real password and **no** linked Google account, so the shortcut made their password unusable from this page.
- The backend's `oauth_provider === "microsoft" ? "microsoft" : "google"` default, which told every password-less account it "uses Google sign-in" — wrong for 4 of 4 such accounts in production on 2026-08-26.

An identity with no password **and** no linked provider now gets a stated answer and the set-password path (`Login.tsx:236`), instead of being pointed at a flow that cannot work.

## 1a. Features
- Sign in with email/password
- Sign in with Google (Gmail addresses are auto-routed to Google's chooser; 🚧 no Microsoft button though the backend supports it)
- Return-to-where-you-were after signing in (`?redirect=`)
- Links out: forgot password, create account
- Lands in the right house (ADR 0164, 2026-09-18): one house, straight in; two or more, straight back into the house this device used within seven days, otherwise to `/choose-house` ("Which house today?", `pages/ChooseHouse.tsx`). Every sign-in call sends this device's memory (`lastHouses`, `lib/houseMemory.ts`); the server decides. No house at all goes to `/no-access`.

## 2. Entry
Most-linked page in the app — in-degree 6 per [PAGE_MAP](../foundation/PAGE_MAP.md) (`/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access` all link back). Also the default redirect target of every `ProtectedRoute` when unauthenticated (`components/ProtectedRoute.tsx:16,38`), carrying `?redirect=` or router state so login returns you where you were (`Login.tsx:24-26`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:149` (eager import, `App.tsx:64`)
- `apps/web/src/pages/Login.tsx` (400 lines)
- Provider registry (client mirror + fallback + renderer set): `apps/web/src/lib/identityProviders.ts`
- Provider registry (**source of truth**): `apps/api-gateway/src/auth/identity-providers.ts`
- Shared chrome: `apps/web/src/components/brand/AuthShell.tsx` (title/footer/BrandMark), `apps/web/src/components/auth/GoogleSignInButton.tsx`
- Auth plumbing: `apps/web/src/contexts/AuthContext.tsx`
- Tests: `apps/api-gateway/src/auth/identity-first-signin.spec.ts` (26, measured 2026-09-12 by `npx jest --runInBand --forceExit src/auth/identity-first-signin.spec.ts`; the "21" here was stale and predates this PR), `apps/api-gateway/src/auth/oauth-provider-binding.spec.ts` (54, ADR 0139)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/sign-in-methods` | `AuthContext.tsx:631` via `Login.tsx:74` | new 2026-08-26 |
| POST | `/api/v1/auth/login` | `AuthContext.tsx:507` | ENDPOINTS.md:64 |
| GET | `/api/v1/auth/me` | `AuthContext.tsx:518` (after login) | ENDPOINTS.md:67 |
| POST | `/api/v1/auth/oauth/google` | `AuthContext.tsx:661` via `GoogleSignInButton` → `loginWithGoogle` (`GoogleSignInButton.tsx:81`) | ENDPOINTS.md:75 |
| POST | `/api/v1/auth/oauth/microsoft` | `AuthContext.tsx:682` (`loginWithMicrosoft`) — **no button calls it**; see §9 | ENDPOINTS.md |

**Both OAuth routes changed on 2026-09-12 (ADR 0139).** They are still `@Public()`
(ADR 0096: by decision, the provider token in the body is the credential), but:

- The account must be **linked** to the provider — a row in `user_oauth_accounts`
  for `(user_id, provider)`, or, only when there are no rows at all, the legacy
  `users.oauth_provider` hint ADR 0024 already treats as a hint. Where the stored
  row carries a `provider_user_id`, the token's own subject (`sub` / `oid`) must
  match it. Resolving by address alone let a token for a matching address sign
  the holder in as that user.
- Microsoft now verifies an **ID token** itself — RS256 against the published
  JWKS, `aud` = `MICROSOFT_CLIENT_ID`, exact `iss`, `exp`/`nbf`, and a verified
  address (`xms_edov`) — instead of replaying the body string to
  `https://graph.microsoft.com/v1.0/me`, which answered for any Graph token.
- Unknown address and "account does not use this provider" return **the same
  sentence**, so the public route stops answering which addresses have accounts.
  A failed read of the link table returns a third, distinct sentence: "we could
  not check" is never collapsed into "not linked".

## 5. Signals
**none.** No tracking, NF events, or uxSignals are emitted from this page (grep of `Login.tsx` and its tree).

## 6. Tier cut
Public — upstream of every scenario; no `S..` touches it directly. Tiering runs through scenarios, not pages (OD-48, [TIER-MAP](../03-scenarios/TIER-MAP.md)).

## 7. Rebrand surface
- `Login.tsx:70` — `<AuthShell title="WineOps AI" …>` (page H1)
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI. All rights reserved.`
- `BrandMark.tsx:17` — default `alt = 'WineOps'` (screen-reader visible via AuthShell)

Adjacent server-side leaks surfaced *on* this page as error copy: `auth.service.ts:2245` ("OAuth account email must match your WineOps email"), rendered verbatim by `Login.tsx:158-170`. The second one — "No WineOps account uses that address…" — **is gone as of ADR 0139**: it was replaced by a brand-free sentence shared with the not-linked refusal, so this rebrand surface closed itself.

## 8. State & config
- `VITE_GOOGLE_CLIENT_ID` (`lib/googleIdentity.ts:74`) — without it the Google button/One Tap can't initialise.
- `VITE_API_GATEWAY_URL` (via `AuthContext.tsx:25` / `services/api/client.ts:20`), default `http://localhost:4000`.
- No feature flags or per-restaurant toggles.

## 9. Gaps
- No Microsoft sign-in button, though the backend has `POST /auth/oauth/microsoft` (`AuthContext.tsx:682`). Microsoft is **declared and disabled** in the registry rather than silently absent: an account with a linked Microsoft identity gets a stated reason plus the set-password path, not a Google button. **ADR 0139 made that endpoint safe; it did not make the provider shippable** — `enabled` stays `false`, and enabling it now needs a button, a *concrete* `MICROSOFT_TENANT_ID` (`common`/`organizations`/`consumers` are refused, since with them `iss` names whatever tenant the caller belongs to) and **two** Azure optional claims — `xms_edov` *and* `email` itself, since the `preferred_username` substitute was removed — not just a registry field. Both are off by default, so satisfying only part of this list still refuses every token.
- **An OAuth sign-in now requires an existing link** (ADR 0139). "Sign in with Google" no longer works for an account that has never linked Google — the user signs in another way and links from their profile (`POST /auth/me/link/:provider` (`auth.controller.ts:286-289`)). Production on 2026-09-12: 8 users, all 8 with a password, so nobody is locked out; but this is a real change to the first-time path and there is no UI that explains it yet.
- Apple is declared and disabled too, and **cannot be enabled without a migration** — `user_oauth_accounts.provider` carries a CHECK admitting only `google|microsoft` (`baseline_from_production.sql:5771`). `identity-first-signin.spec.ts` fails the build if that is forgotten.
- "Remember me" deliberately removed 2026-07-31 (v3.0 task 44.15) — rationale preserved in `Login.tsx`.
- The extra round-trip is not cached: revisiting `/login` re-resolves. Acceptable at 10/10min per IP; would matter if the page ever polls.
- **The resting field underline on the endpaper is about 2.3:1** (`--mdv-ep-line`, `--ink-3` at 60% over `--paper-0`, `endpaper.css`), below the 3:1 that WCAG 1.4.11 asks for when an underline is a field's only visible edge. Every field has a visible text label, and the focused underline is about 7.2:1, so nothing is unlabelled. Found by PR #397's pr-audit-gate (planner's final call, 2026-09-19). Named follow-up: Roadmap 7.

---

## 10. Maturity

**partial.**

Password and Google sign-in both complete end to end: `Login.tsx:104` → `AuthContext.tsx:507` → `POST /auth/login` (`auth.controller.ts:53-64`) → `AuthService#login` (`auth.service.ts:278-287`) → 15m/7d JWT pair (`auth.service.ts:617-625`), then `/auth/me` and the branch fetch populate context.

What is absent, each named:
- **Microsoft sign-in has a backend and no button.** `POST /auth/oauth/microsoft` exists (`auth.controller.ts:128-141`) and `AuthContext.tsx:682` wraps it; the page renders only `GoogleSignInButton`. Since ADR 0024 this is *declared* rather than hidden — see §9.
- ~~**Gmail addresses cannot use password login at all.**~~ **Fixed 2026-08-26 (ADR 0024).** The `@gmail.com` interception is gone; a gmail address with a password now gets the password form like any other.
- ~~**The error copy distinguishes account states.**~~ **Still true, now deliberately** — see §13.

Fixed in the same pass:
- **`validateUser` no longer guesses a provider** (`auth.service.ts:141-200`). It reads `user_oauth_accounts` via `resolveLinkedProviderIds` (`:1819`) and answers `NO_SIGNIN_METHOD` (`:175`) when there is nothing to name.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/sign-in-methods` | `@Public()`, `@RateLimit({limit:10, windowSeconds:600})` — tighter than the `/auth/` default | `auth.controller.ts:514-521` | `{success, email, methods[], unavailable[], declared[], noSignInMethod}` (`auth.service.ts:1890`) |
| POST | `/api/v1/auth/login` | **anonymous** — no `@Public()`, no `@UseGuards`; `JwtAuthGuard` is never a global guard (only `RateLimitGuard` + `TenantGuard` are, `app.module.ts:143-151`), so an undecorated route is open | `auth.controller.ts:53-64` | `{success, accessToken, refreshToken}`; payload carries `sub, email, role, restaurantId, emailVerified, app_metadata.roles` (`auth.service.ts:601-615`) |
| POST | `/api/v1/auth/oauth/google` | anonymous, same reason | `auth.controller.ts:112-123` | same token pair via `findOrCreateOAuthUser` (`auth.service.ts:1624`) |
| GET | `/api/v1/auth/me` | Bearer (`@UseGuards(JwtAuthGuard)`) | `auth.controller.ts:181-188` | `{userId, email, name, phone, role, restaurantId, hasPassword, linkedProviders}` (`auth.service.ts:1817-1833`) — **note: no `emailVerified`** |
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

**Should be:** the one door, showing every sign-in method that identity actually has, and never naming one it does not.

**2026-09-19 — sketch 118 Direction B built.** The founder chose B, the endpaper, over the
sketch README's recommended A (ADR 0149 row 35; ADR 0143 bracket). When `on === true`
(`usePublicDesign()`), the page renders `EndpaperShell` (`components/brand/EndpaperShell.tsx`)
instead of `AuthShell`/`AuthCard`. The fields are the same (`Login.tsx:206-404`, unchanged) inside
a new two-column book frame, and the OFF branch is unchanged. His later call the same day puts
"Sign in with Google" on the first page as well (PR #397, merged 1fba79f57, shipped dark behind
`VITE_MUDAVYM_PUBLIC`). His build directions (ledger fields, the seal pressing, the page turn,
"The mark draws", refusals in the book's voice) are listed in sketch 118's README. The password
step needs the api-gateway, so it is covered by vitest only.

**The front matter (the Easter egg).** On the house path only, the endpaper is a real button that
turns back to the inside cover ("müdavim") and a short poem about the book the house keeps
(`EndpaperShell` `frontMatter`, `FrontMatter.tsx`; sketch 118 `front-matter.html` Direction 1).
The founder asked that nothing advertise it, so there is no dog-ear or hover hint. The sign-in
under it stays mounted and inert, so the typed address survives. Escape turns back, and focus
follows the page. /register does not have it.

Note: an earlier revision of this section cited a normalising regex at `Login.tsx:25-28` that collapsed auth errors into "Invalid email or password". **No such code exists in `Login.tsx`** — it was already stale when written; the page renders `err.message` verbatim. The correction is recorded rather than silently deleted, per CLAUDE.md §5b.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a (form) | — |
| Resolving | yes | "Checking…" disables Continue, `Login.tsx:175-198` |
| Loading | yes | `loading` disables submit, `Login.tsx:61,89` |
| Error | yes. On today's page the gateway's words, verbatim. On the house path a plain 401 or 429 is worded in the book's voice ("That password did not match." / "Too many tries — wait a moment."), keyed on HTTP status and never on message text. A coded refusal (`OAUTH_ONLY`, `NO_SIGNIN_METHOD`) and anything else keeps the gateway's words | `Login.tsx` `signInNote`; `Login.signInNote.test.tsx` |
| No sign-in method | **yes, stated** | `Login.tsx:236-263` — amber panel + "Set a password" → `/forgot-password?email=…` |
| Provider linked but unusable | yes, stated with reason | `Login.tsx:294-310`, fed by `unavailable[]` |
| Gateway unreachable / 429 | yes, degrades | `AuthContext.tsx:627-655` falls back to `password + google`, marked `assumed`; the page never claims anything about the address |
| Permission-denied | n/a (pre-auth) | — |

**What it now reveals, deliberately:** the methods an address has. Accepted by the founder 2026-08-26 and argued in ADR 0024 — the leak already existed via `GET /auth/check-email` (`@Public()`, `available: true/false`) and `POST /auth/register`'s "Email already registered". This makes it intentional and rate-limited. `requestPasswordReset` stays enumeration-safe and is untouched.

## 13. Roadmap

1. ~~Fold `OAUTH_ONLY` into the generic error~~ — **retired by ADR 0024.** Answered the other way: the message is made *true* rather than generic, and enumeration on this route is now a recorded decision.
2. Add the Microsoft button — the endpoint and the context method already exist (`auth.controller.ts:130`, `AuthContext.tsx:682`). No longer "UI plus flipping `enabled`": ADR 0139 makes the endpoint fail closed, so shipping it also needs an Azure app registration with a concrete tenant and the `xms_edov` optional claim, plus a founder decision on multi-tenant sign-in (a placeholder tenant is refused by design).
3. ~~Let a Gmail user fall through to password login~~ — **retired by ADR 0024**, the interception is gone.
4. Move the rate-limit store off in-memory `Map` before running >1 gateway replica (`rate-limit.guard.ts:69-121`). *Blocked:* no shared cache reachable from a guard today — the same blocker is written up at `password-reset-throttle.guard.ts:20-28`. **Now load-bearing for two routes**, not one.
5. Emit sign-in success/failure/method signals — §5 is `none` and this is the top of every funnel. *Blocked:* no signal sink exists (see [[get-started]] §11).
6. Decide whether `GET /auth/check-email` should move to the same POST-with-body shape. Out of scope for ADR 0024, which deliberately left it alone. See [[register]] §13.
7. **Raise the endpaper's resting field underline to at least 3:1** (WCAG 1.4.11) on both grounds, with tokens only. Change the line's weight and colour, not its style, which the founder approved. It is the same stylesheet that dresses [[register]], so the fix covers both pages. Measure the contrast and state it in the commit. See §9.
