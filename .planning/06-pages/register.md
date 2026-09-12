---
type: page
route: /register
slug: register
softwares: [auth-onboarding]
component: apps/web/src/pages/Register.tsx
audience: public
tier: public
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 3
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[invite-landing]]", "[[verify-email]]", "[[dashboard]]"]
---

# /register

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Create account** (owner flow) → API `POST /api/v1/auth/register/restaurant`, then [[verify-email]] `/verify-email`
- **Join workspace** (invite flow) → API `POST /api/v1/auth/join`, then [[dashboard]] `/`
- **Sign in** → [[login]] `/login`

## 1. Purpose
Two-path account creation: **Path A "Join Your Team"** — enter an 8-character invite code and create a staff/manager account under an existing restaurant; **Path B "Open a Restaurant"** — create an owner account plus the restaurant record (identity/location/contact in a 3-section rail form). Path B ends at `/verify-email`; Path A lands straight on the dashboard ("No email verification needed", `Register.tsx:196`).

## 1a. Features
- **Path A "Join Your Team"**: enter an 8-character invite code (validated live as you type) and create a staff/manager account — lands straight on the dashboard
- **Path B "Open a Restaurant"**: create an owner account plus the restaurant record in a 3-section rail form (identity / location / contact), with address autocomplete, phone input, cuisine picker — ends at email verification
- **A currency step in the Location section** (`components/onboarding/CurrencyStep.tsx`, added 2026-09-05, ADR 0117 Q25): the house's reporting currency, DEFAULTED from the address's country and stated in words before it is recorded — "Defaulted from Türkiye. We will record TRY. Change it if that is wrong." "Not yet" is a real answer that records nothing; a country the table cannot place gets NO default and says so. The copy tells the manager nothing is converted: each invoice keeps the currency its vendor billed in
- Live "email already in use" check while typing
- Deep links pre-route the path: `?invite=CODE`, `?type=join|new`
- 🚧 No Google sign-*up* — OAuth exists on `/login` only

## 2. Entry
- `/login` → "Create one now" (`Login.tsx:188-193`)
- `/invite/:code` → "Create account to accept" as `/register?invite=CODE` (`InviteLanding.tsx:144`)
- URL params auto-route (D-09): `?invite=CODE` → Path A prefilled, `?type=join` → Path A, `?type=new` → Path B (`Register.tsx:129-145`)

## 3. Files
- Route binding: `apps/web/src/App.tsx:150` (eager, `App.tsx:65`)
- `apps/web/src/pages/Register.tsx` (largest auth page; builds its own shell rather than using `AuthShell`)
- Inputs: `PhoneNumberInput`, `PlacesAutocomplete`, `CountryCombobox`, `CuisinePicker`
- `apps/web/src/components/onboarding/CurrencyStep.tsx` — the currency step, extracted so the decision can be rendered and asserted on its own
- `apps/web/src/lib/currency.ts` — ISO 3166 name to ISO 4217 code, the picker's list, `currencyToRecord`, and `formatMoney`, which renders an unrecorded currency in words rather than as a symbol
- Tests: `src/lib/currency.test.ts` (12), `src/pages/__tests__/Register.currencyStep.test.tsx` (12)

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/auth/check-email` | `Register.tsx:97-98` (debounced 400ms) | ENDPOINTS.md:58 |
| GET | `/api/v1/auth/invite/:code` | `Register.tsx:157` (inline validation, debounced — D-08) | ENDPOINTS.md:61 |
| POST | `/api/v1/auth/join` | via `joinViaInvite` → `AuthContext.tsx:515` | ENDPOINTS.md:63 |
| POST | `/api/v1/auth/register/restaurant` | via `registerRestaurant` → `AuthContext.tsx:492` | ENDPOINTS.md:79 |
| GET | `/api/v1/auth/me` | `AuthContext.tsx:500,520` (post-register) | ENDPOINTS.md:67 |

## 5. Signals
**none.** No funnel tracking on a multi-step registration flow — no step-advance, path-choice, or abandonment events (grep of `Register.tsx`).

## 6. Tier cut
Public. No scenario touches it; it creates the tenant every scenario runs in (OD-48 — tiers attach to scenarios, not pages).

## 7. Rebrand surface
- `Register.tsx:1307` — H1 `Join WineOps AI`
- `Register.tsx:1328` — footer `© 2026 WineOps AI. All rights reserved.`
- `BrandMark` default alt `WineOps` (`Register.tsx:1305`, `BrandMark.tsx:17`)

Wine-domain copy that is rebrand-adjacent but not the literal string: "start managing wine inventory with AI" (`Register.tsx:220`).

## 8. State & config
- `VITE_GOOGLE_MAPS_API_KEY` — `PlacesAutocomplete` address lookup degrades without it (`lib/googleMaps.ts:14,88`).
- `VITE_API_GATEWAY_URL` via `services/api/client.ts:20`; note the invite-preview fetch at `Register.tsx:157` uses a *relative* `/api/v1/...` path (relies on same-origin proxy/rewrite), unlike every other auth call.
- No feature flags.

## 9. Gaps
- No Google/OAuth sign-*up* path — `GoogleSignInButton` exists on `/login` only; a new user who wants Google must register with a password first, then link (Profile → Linked accounts). Since ADR 0024 the provider set is declared in one place (`apps/api-gateway/src/auth/identity-providers.ts`), so a future sign-up path should read from that registry rather than hard-code buttons.
- The relative-path invite fetch (`Register.tsx:157`) breaks if the SPA is served from an origin with no `/api` rewrite (works on Vercel, not on a bare static host) — inconsistent with `InviteLanding.tsx:38` which uses `API_URL`.
- ~~**The country tables disagree, and Google is on the losing side.**~~ FIXED 2026-09-05 (ADR 0117 Q33): one table, `lib/countries.ts`, keyed by ISO 3166-1 alpha-2, with `Türkiye` as a recorded alias of `TR`; `PlacesAutocomplete`'s `COUNTRY_ISO` and `currency.ts`'s `COUNTRY_CURRENCY` are deleted and `countries.migration.test.ts` proves every retired pair still resolves. The original finding, kept because it is the reason: `PlacesAutocomplete` writes Google's own `longText` into `country`, which today is `Türkiye`; both `lib/countries.ts` (the combobox's 194 names) and `PlacesAutocomplete`'s own `COUNTRY_ISO` map still say `Turkey`, so a Turkish address filled in from Google matches neither — the ISO bias on subsequent searches is silently lost. Measured 2026-09-05 on the three live Turkish/British rows. `lib/currency.ts` folds the spelling for its own purposes only; the other two tables are untouched. ADR 0117 Q33.
- **Path B step 1 can wedge on "Checking email…".** Observed 2026-09-05 driving the live form at `127.0.0.1:5274`: after `Next: Restaurant Details` runs the inline availability check, `createEmailCheck.checking` stayed true and the button stayed disabled, with both `GET /auth/check-email` calls returning 200 and no console error; the email field then rejected further input. Not reproduced from a cold load, and not investigated — recorded because it blocked a capture, and the currency step had to be photographed through its own component instead.

---

## 10. Maturity

**partial** — and it fronts the most serious defect found in this cluster.

Both paths persist real rows. Path B (`POST /auth/register/restaurant`, `auth.controller.ts:353-363`) creates `organizations` → `restaurants` → `users` → `organization_members` → `user_restaurant_access` → `user_onboarding_progress`, with an explicit rollback that deletes all three parents on any failure (`auth.service.ts:554-688`). Path A (`POST /auth/join`, `auth.controller.ts:398-404`) consumes the invite atomically and grants access (`auth.service.ts:1138-1251`).

**Defect — `POST /auth/join` mints a session for an existing account without checking its password.** `JoinViaInviteDto` requires `password` (`join-via-invite.dto.ts:7`), but that field is used **only in the new-user branch** (`auth.service.ts:1181-1194`). When the submitted email already matches a `users` row, the code takes `user = existingUser` (`:1179`) with no `bcrypt.compare`, and returns `this.generateTokens({...user, restaurant_id: invite.restaurant_id})` (`:1247-1250`) — a valid access + refresh pair for that account. The route is `@Public()`. Preconditions: hold one unused, unexpired invite code, and know the target's email address; the target must not already be a member of the inviting restaurant (`:1164-1177` is the only branch that rejects). Any invitee — or anyone who intercepts an invite link — can take over any other account in the system. Reported, not fixed, per this task's brief.

Secondary gaps:
- Path A creates **no** `user_onboarding_progress` row (absent from `auth.service.ts:1138-1251`; contrast Path B `:634-642`), so `GET /onboarding/progress` 404s for every invitee (`menus.service.ts:655-658`).
- Neither path normalises email case (`:599`, `:1186` store `dto.email` raw) — see [[forgot-password]] §10.
- `checkEmailAvailability` swallows all errors and lets registration proceed (`Register.tsx:106-110`).

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/auth/check-email` | `@Public()` | `auth.controller.ts:449-457` | `{available, email}` — **a deliberate account-existence oracle**, see §12 |
| GET | `/api/v1/auth/invite/:code` | `@Public()` | `auth.controller.ts:368-372` | `{valid, organization, restaurant, city, inviter, role}` (`auth.service.ts:788-795`) |
| POST | `/api/v1/auth/join` | `@Public()` | `auth.controller.ts:398-404` | token pair — **see §10** |
| POST | `/api/v1/auth/register/restaurant` | `@Public()` | `auth.controller.ts:353-363` | token pair, `emailVerified:false` in payload |
| GET | `/api/v1/auth/me` | Bearer | `auth.controller.ts:166-176` | profile without `emailVerified` (`auth.service.ts:1421-1430`) |

### Fed by

`organization_invites` rows, produced only by `POST /auth/invite` (owner/manager, `auth.controller.ts:377-393` → `auth.service.ts:802-896`). Nothing else writes them. Codes are 8 chars from a 32-char unambiguous charset (`auth.service.ts:838-845`) — a ~1.1e12 keyspace, so guessing is not the exposure; link interception is.

### Writes — and what reacts

| Path | Tables written | Downstream |
|---|---|---|
| B | `organizations`, `restaurants` (slug `name-<6 hex>`, `:565-569`), `users` (`role:'owner'`, `email_verified:false`), `organization_members`, `user_restaurant_access`, `user_onboarding_progress` | fire-and-forget verification email (`:645`) and onboarding email (`:651-665`); both non-fatal, both fall back to a **mock sender** when Gmail OAuth is unconfigured (`:708`) |
| A | `organization_invites.used_at` + `used_by_email` (`:1142`), `users` (new only), **`user_restaurant_access`** (`:1208-1216`), `organization_members` upsert (`:1228-1236`), `team_members` claim (`claimTeamMemberFromInvite`, `:964`) | the roster on [[team]] picks up the claimed `team_members` row |

**Yes — registration creates a restaurant** (Path B, `auth.service.ts:571-593`). **Yes — an invite mutates `user_restaurant_access`** (Path A `:1208`; the signed-in variant `:1077`).

## 12. Design intent

**Should be:** two unambiguous doors — join an existing workspace, or open a new one — neither of which tells an anonymous visitor anything about addresses they did not already control.

| State | Handled? | Evidence |
|---|---|---|
| Empty | n/a | — |
| Loading | yes | `validating` for the invite probe (`Register.tsx:154-160`), `checking` for email |
| Error | partial | invite-invalid renders; `check-email` failure is swallowed (`Register.tsx:106-110`) |
| Permission-denied | n/a (pre-auth) | — |

**Where it misleads:**
- `GET /auth/check-email` returns `{available:false}` with the message *"This email is already registered"* (`Register.tsx:100-103`). This is a full email-enumeration oracle on a public route, throttled only by the shared 10/min-per-IP auth bucket (`rate-limit.guard.ts:29`) held in a per-process in-memory map (`:69-121`). It is a real UX affordance and a real leak; the fork is which one wins.
- Path A's screen promises *"No email verification needed"* (`Register.tsx:196`) and sets `email_verified: true` (`auth.service.ts:1191`) — accurate, but combined with §10 it means the invite is the trust anchor for an unverified address.
- The invite probe uses a **relative** `/api/v1/...` URL (`Register.tsx:157`) while `InviteLanding.tsx:38` uses `API_URL` — one of these is wrong on any host without an `/api` rewrite.

## 13. Roadmap

1. **Fix `POST /auth/join`** — verify the password (or reject existing accounts and route them to the signed-in accept path, `auth.controller.ts:321-335`) before returning tokens. Blocks nothing; nothing should ship ahead of it. (§10)
2. Insert a `user_onboarding_progress` row in `joinViaInvite`, matching Path B (`auth.service.ts:634-642`).
3. Normalise email to lower-case at every write and read (`:599`, `:1186`, `:91`) — one migration plus three call sites. (See [[forgot-password]] §10.)
4. Decide `check-email`: keep the oracle, or replace it with a post-submit 400. *Still a founder call* — but no longer wide open. **ADR 0024** (2026-08-26) made enumeration deliberate on the *sign-in* route: `/login` now reveals which methods an address has, and the argument there was that `check-email` and `POST /auth/register`'s "Email already registered" already leak existence anyway. That settles the direction (revealing is accepted) without settling this endpoint's shape — what remains is whether `check-email` should move to the POST-with-body form ADR 0024 chose, so the address stays out of URLs and logs. Cheaper now: it is a shape change, not a policy fight.
5. Unify the invite-preview fetch on `API_URL` (`Register.tsx:157`).
6. Add funnel signals — path choice, step advance, abandonment. *Blocked:* no sink (see [[get-started]] §11).
7. **The currency step is built, and so is everything that was open around it** (ADR 0117 Q25/Q30/Q33, 2026-09-05). The three wrong production rows were corrected on the founder's word; the country tables are one table; `--clear-inherited` is written and waiting for him to run it. ~~**What the step now makes urgent is Q35: nothing lets a house change its currency after sign-up.**~~ **BUILT 2026-09-05.** The step asks once, here; `/settings` is now where an EXISTING house answers — the Currency register on the rebuilt page (`pages/settings/next/CurrencySection.tsx`) and `ReportingCurrencySection` on the legacy one, both through `GET`/`PUT /settings/currency` (`apps/api-gateway/src/settings/house-currency.service.ts`), manager-or-owner only and audited. The same three rules hold there as here: the default is offered from the country and stated in words, only Record writes, and "not recorded" stays a real state. See `06-pages/settings.md` §1a/§4/§9/§13.35.
