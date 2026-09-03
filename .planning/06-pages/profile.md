---
type: page
route: /profile
slug: profile
softwares: [auth-onboarding]
component: apps/web/src/pages/Profile.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 2
maturity: partial
status: documented
updated: 2026-09-02
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[settings]]"]
---

# /profile

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Save changes** → API `PATCH /api/v1/auth/me`
- **Change password** → API `POST /api/v1/auth/me/password`
- **Contact support** → external `mailto:` (VITE_SUPPORT_EMAIL, default support@wineops.ai)
- **Leave restaurant** → API `POST /api/v1/auth/me/leave-restaurant`
- **Delete account** → API `DELETE /api/v1/auth/me`, then [[login]] `/login`
- **Settings → Team** → [[settings]] `/settings?tab=team`
- **Settings** → [[settings]] `/settings`

## 1. Purpose
Personal account page for every role: Account (name/phone; email read-only), Security (change password), Linked accounts (Google link/unlink), Preferences (theme). Managers/owners additionally get Restaurant (name/city/billing contact), Payment, Memberships sections (`Profile.tsx:36-48`). Danger zone: leave the active restaurant, or delete the account behind a type-DELETE confirmation (`Profile.tsx:877-891`).

## 1a. Features
- Account: edit name and phone (email read-only)
- Security: change password
- Linked accounts: link/unlink Google
- Preferences: theme
- Managers/owners additionally: Restaurant details (name/city/billing contact), Payment, Memberships
- Danger zone: leave the active restaurant; delete your account behind a type-DELETE confirmation

**Added by the Mudavym redesign** (flag `mudavym_design_profile`; the legacy page above
is unchanged while it is off). Marked `dark` where the capability renders but nothing
behind it exists:

- **Connections register** — one row shape for every attachment this account has, across
  four rails: Sign-in, Workspace, Model context, Payment. A row's state chip
  (`Connected` / `Not connected` / `Unavailable` / `Not built` / `—`) is what tells a live
  connection from one with no backend — the row itself is one component either way
- Sign-in rail: password / Google / Microsoft as three peer methods, with the server's
  last-credential rule (`auth.service.ts:2043-2058`) **stated before the click** — Unlink
  is disabled, with the reason, when it would remove the only credential
- Sign-in rail: Microsoft `Connect` renders **disabled with its reason** (a gateway route
  exists, no button does — `lib/identityProviders.ts` `RENDERABLE_PROVIDER_IDS`). The
  shipping page's Microsoft "Connect" is a toast-only stub that looks like it worked
  (`Profile.tsx:256-268`)
- **Workspace rail (new to this page)** — Google Drive and Microsoft Excel from
  `GET /integrations/oauth/catalog` + `/connections`: real connect (via the existing
  `/authorize/:integrationId` consent screen), real disconnect, the granted scopes shown
  under "What you granted", and the server's `unavailableReason` on a deployment that
  cannot offer one
- **Model context (MCP) rail — `dark`.** Renders as a first-class rail; states in one
  line that no MCP backend exists; shows the shape a connection will carry (server,
  transport, tools exposed, who may call it, last handshake — all `—`) and what it will
  let you do; every control `disabled`
- **Payment rail** — billing contact is **real** (it is the restaurant record, and saves);
  payment method is `dark` (no provider integrated anywhere in the product); **plan is
  `—`** because `restaurants.subscription_tier` exists but no endpoint returns it. The
  shipping page prints `Plan: Free` from a hardcoded `useState('Free')` (`Profile.tsx:90`, rendered `:723`)
- Honest read states for both fetches: loading, error-in-words with a retry, and
  **permission-denied rendered rather than hidden** — a staff member sees the Restaurant
  record and Billing contact rows with one line saying who may change them, and that line
  credits the *page* rather than the server with withholding them, because the read is not
  actually gated (G8)
- The restaurant record **never falls back to the cached branch name**; on a failed read
  the fields stay empty and disabled and Save is refused, closing the page's only
  data-loss path (`Profile.tsx:143-146`)
- Phone is disabled and declared unknown when `GET /auth/me` fails, and a Save then
  leaves it untouched instead of writing a blank
- Support mailto degrades to a sentence when `VITE_SUPPORT_EMAIL` is unset, rather than a
  link to the dead `support@wineops.ai` (§7)
- Delete account is **hold-to-approve**, armed by the existing typed `DELETE`; the seal is
  pressed nowhere else on the page. The sole-owner refusal (`auth.service.ts:2132-2176`, throw at `:2149-2151`)
  is stated before the act

## 1b. Motions used — Mudavym redesign (flag `mudavym_design_profile`)

Canonical copy: `apps/web/src/pages/profile/next/MOTIONS.md`. Every motion is a token
from `apps/web/src/lib/mudavym/motion.ts`.

| id | token | curve · ms | fires |
|---|---|---|---|
| `pf-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the opening block — wordmark, role/location line, the name in Fraunces, the standing sentence — once on mount; opacity + 6px rise via `animate()` |
| `pf-expand` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a connection row's panel: "What you granted" / "What it would ask for" / "Show the shape". CSS `grid-template-rows: 0fr → 1fr` (053's row-expand, the founder's named favourite) |
| `pf-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover/focus on rows, buttons and membership entries — border and ground only; nothing translates or scales |
| `pf-pour` | `pour` | `linear` · 620ms | the İznik fill under **Hold to delete this account** inside `HoldToApprove`; an early release retreats on `tuck` (spring 380/32, ~300ms) and says what did not happen |
| `pf-stamp` | `stamp` | sampled spring 500/26 (~11% overshoot) · 360ms | the seal landing when that hold completes — the only overshoot on the page, and the only place the seal is pressed |

Deliberate non-motions: no stagger or arrival (an account page is a reference, not an
event); no tally (the one number-shaped thing, the plan, is an em dash and unknowns never
animate); no skeleton sheen (loading is stated in words, so a moving bar would make "in
flight" and "failed" look alike again); chips do not transition; the reversible exit
("Leave restaurant") arms with a label change and no motion at all.
`prefers-reduced-motion` collapses `pf-open` to its end state via `animate()`, disables
the two CSS transitions in `PF_CSS`, and swaps the timed hold for a two-step confirm.

### Design used, and why

**The verdict** (`MAKEOVER-VERDICTS.md:216`): *"Let's make this a lot cooler."* The
redesign is acceptable but thin; must include **MCPs** as a first-class section,
**linked accounts** *"to be cooler than this, not just like that"*, and **payments** —
*"we should be able to add the payment here"*, Stripe or comparable.

**The structure that enforces it.** The shipping page is eight boxes down a scroll-spy
rail, each a different shape, and the two sections with no backend are drawn exactly like
the six with one. The rebuild is a ledger in four registers — *Who you are*, *What is
connected to you*, *The house*, *Ruled off* — and all three of the founder's additions
land inside **one** register on **one** row shape, next to the connections that already
work. That is the single structural idea: **one component draws every row, and what
changes between a live Google link and an MCP server with no backend is its state chip
and whether its control is a live link or a disabled one carrying its reason.** A section cannot
flatter itself by being drawn richer than its evidence, and the reader can compare a real
connection with an unbuilt one at a glance instead of taking a "coming soon" box on
trust. It also makes "cooler" mean something other than more chrome: the page now answers
one question — *what is attached to me, and is it actually working?*

**Honesty rules applied** (ADR 0020 / the absence-reported-as-health rule):

- both silently-swallowed reads (`Profile.tsx:110-118`, `:143-146`) are first-class query
  states with an error branch that names the register that failed and offers a retry;
- **the only data-loss path on the page is closed**: the restaurant record has no cache
  fallback at all, so an unread record leaves the fields empty and disabled and
  `saveRestaurant` refuses outright — a value nobody read cannot become a write;
- the plan renders `—`, not `Free`. The column exists (`restaurants.subscription_tier`,
  `baseline_from_production.sql:3582`, default `pilot`) and is read only by the model-spend
  ceiling (`common/model-client/model-client.service.ts:565-577`); no browser-reachable
  endpoint returns it (`organizations.service.ts:137-152` selects `id, name, city, email,
  phone`). Unknown, therefore a dash;
- an **empty** connections array from `GET /integrations/oauth/connections` is read as
  *"the register could not be read"*, not as *"nothing connected"* — that endpoint returns
  one row per catalogued integration on success and a bare `[]` on a swallowed query error
  (`integrations-oauth.service.ts:485-488`);
- permission-denied is rendered, not hidden: staff see the Restaurant record and Billing
  contact rows with one line naming who may change them, and a 403 from the PATCH has its
  own message. That line was corrected after audit (2026-09-02) to say the *page* declines
  to fetch the record: the write really is manager/owner
  (`organizations.service.ts:178-187`), but the read is open to any member of the
  organisation (`:123-153`), and claiming otherwise would be the same class of untruth
  this page exists to remove — see G8;
- every control whose backend does not exist is a `disabled` element carrying its reason
  in words. There is no Connect on this page that can appear to succeed.

**Two alternatives considered and not built** (the founder decides after seeing this one):

1. **MCP and Payments as their own top-level registers**, each with a full disabled form
   (server URL field, card field, plan picker). It reads as more "first-class" at a
   glance and it is what "make it cooler" most obviously suggests — but a full dead form
   is exactly the shape ADR 0020 exists to stop: it looks like something you can fill in.
   Rejected in favour of one row plus an expandable *shape*, which shows what is coming
   without pretending it is here. **If the founder wants the bigger gesture, this is the
   fork to reverse** — the rails are already separate components.
2. **Fetching the declared provider registry from `POST /auth/sign-in-methods`**, which
   would give the Sign-in rail the server's own labels, `enabled` flags and
   `disabledReason` strings for Google, Microsoft *and* Apple instead of page prose. It is
   the more honest source — but that route is `@Public()` and rate-limited to 10 requests
   per 600s keyed **by IP** when unauthenticated (`auth.controller.ts:487-491`,
   `rate-limit.guard.ts:246-271`), so a restaurant behind one NAT would lock its own staff
   out of their profile page. Rejected on that measurement; the rail uses the
   authenticated `GET /auth/me` for linked state and states Microsoft's reason in prose.
   An authenticated `GET /auth/me/sign-in-methods` would make alternative 2 correct — §13.

**Substituted or left out, and why:**

- **The scroll-spy left rail is gone.** It indexed eight boxes; four named registers on a
  860px measure do the same job without a second navigation model to maintain.
- **The "Upgrade / Coming soon" block is gone**, absorbed into the Payment rail's plan
  row, which is more honest than a disabled button with no subject.
- **The active-restaurant `<select>` in Preferences is gone** — it duplicated the
  Memberships switcher, which now carries it alone.
- **Google's own GSI button is used unstyled.** It is Google-rendered and cannot be
  restyled; it is the only real token-acquisition path and a house-styled fake would be
  worse than a foreign-looking real one.
- **No toasts.** Every outcome is a settled `role="status"` line next to the control that
  caused it, so a failure cannot scroll away unread.
- **Size**: 2,111 non-blank lines across 8 source files, against the p4 brief's ~900
  guidance (the richest built page, `dashboard/next`, is 1,493). Called out rather than
  hidden: this page carries four registers, twelve rows, six forms and nine write paths,
  each with four read states, and is already split into components. A further pass would
  move the repeated inline text styles into a page stylesheet the way `dashboard-next.css`
  does; it was not done.

## 2. Entry
In-degree 3 per [PAGE_MAP](../foundation/PAGE_MAP.md): header user menu (`Header.tsx:277`), sidebar bottom nav (`Sidebar.tsx:166-170`), plus `/help`, `/privacy`, `/settings` link here. Inside `DashboardLayout` + `ProtectedRoute` (`App.tsx:247-252,286`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:347` — `<PageGate page="profile" legacy={<Profile/>} next={<ProfileNext/>}/>` (both lazy, `App.tsx:92,121`)
- Legacy: `apps/web/src/pages/Profile.tsx` (907 lines)
- API module: `services/api/profile.ts`; `components/auth/GoogleLinkButton.tsx`
- **Mudavym rebuild** (`apps/web/src/pages/profile/next/`, flag `mudavym_design_profile`):
  `ProfileNext.tsx` (shell, opening voice, Register IV / the exit) ·
  `useProfileNextData.ts` (every read and write, tenant-keyed) ·
  `IdentityRegister.tsx` · `ConnectionsRegister.tsx` (the four rails) ·
  `HouseRegister.tsx` · `GoogleLink.tsx` (the one real token acquisition) ·
  `pf-ui.tsx` (the row shape, chip, card, field) · `pf-format.ts` ·
  `ProfileNext.test.tsx` (11 tests) · `MOTIONS.md`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/auth/me` | `profileApi.getMe` (`profile.ts:20`), `Profile.tsx:111` | ENDPOINTS.md:67 |
| PATCH | `/auth/me` | `profileApi.updateMe` (`profile.ts:25`), `Profile.tsx:217` | ENDPOINTS.md:68 |
| POST | `/auth/me/password` | `profile.ts:36`, `Profile.tsx:240` | ENDPOINTS.md:73 |
| GET | `/auth/me/linked-providers` | `profile.ts:39-40`, `Profile.tsx:565` | ENDPOINTS.md:72 |
| POST/DELETE | `/auth/me/link/:provider` | `profile.ts:50,60`, `Profile.tsx:273` | ENDPOINTS.md:70-71 |
| POST | `/auth/me/leave-restaurant` | `Profile.tsx:290` | ENDPOINTS.md:69 |
| DELETE | `/auth/me` | `Profile.tsx:310` | ENDPOINTS.md:66 |
| GET | `/organizations/locations/:id` | `Profile.tsx:131` (manager/owner only) | ENDPOINTS.md:352 |
| PATCH | `/organizations/locations/:id` | `Profile.tsx:332,352` | ENDPOINTS.md:353 |

**Added by the Mudavym rebuild** — the workspace rail, all pre-existing and guarded
(`integrations-oauth.controller.ts`, `IntegrationsModule` wired at `app.module.ts:109`):

| Method | Path | Where called | Guard |
|---|---|---|---|
| GET | `/integrations/oauth/catalog` | `integrationsApi.getCatalog` (`services/api/integrations.ts:41`), `useProfileNextData.ts` | `JwtAuthGuard` (`integrations-oauth.controller.ts:39-41`) |
| GET | `/integrations/oauth/connections` | `integrationsApi.getConnections` (`integrations.ts:49`) | `JwtAuthGuard` (`:62-64`) |
| DELETE | `/integrations/oauth/:integrationId` | `integrationsApi.disconnect` (`integrations.ts:64`) | `JwtAuthGuard` (`:124-126`); revokes at the provider first (`integrations-oauth.service.ts:505-509`) |
| POST | `/auth/me/link/google` | `profileApi.linkProvider` via `profile/next/GoogleLink.tsx` | `JwtAuthGuard` (`auth.controller.ts:261-264`) |

The consent step is **not** a new endpoint: the Connect control links to the existing
`/authorize/:integrationId?returnPath=/profile` page (`App.tsx:270`), which discloses the
scopes from the server's own catalogue before the redirect.

## 5. Signals
**none.** Account deletion and restaurant-leave — churn events — are untracked.

## 6. Tier cut
Core, every role. No `S..` touches it directly (OD-48).

## 7. Rebrand surface
- `Profile.tsx:445` — support mailto falls back to `support@wineops.ai` when `VITE_SUPPORT_EMAIL` is unset (a **domain**, not just a name — needs DNS/mailbox work, not a string swap)
- ~~`Profile.tsx:877` — "Permanently delete your WineOps account."~~ **Resolved.** Verified
  2026-09-02: that line now reads "Permanently delete your Mudavym account. This cannot be
  undone." `grep -in wineops apps/web/src/pages/Profile.tsx` matches only the `:445` mailto
  fallback above. Fixed by another session; kept here struck through rather than deleted so
  the register still shows what the surface was.

## 8. State & config
- `VITE_SUPPORT_EMAIL` (`Profile.tsx:445`). The rebuild reads the same variable and, when
  it is unset, renders a sentence instead of a `mailto:` to the dead fallback domain.
- `VITE_GOOGLE_CLIENT_ID` (`lib/googleIdentity.ts:73`) — without it the Sign-in rail's
  Google row says Google sign-in is not configured on this deployment rather than
  rendering a button that cannot work.
- Role gating in-page: `isManagerOrOwner` gates the Restaurant/Payment/Memberships sections and the locations fetch (`Profile.tsx:127,158`). The rebuild keeps the gate on the *fetch and the controls* but renders the section either way (permission-denied is a state, not an absence).
- Theme via `ThemeContext`.
- **Mudavym redesign gate:** feature flag `mudavym_design_profile`
  (`apps/api-gateway/src/settings/feature-flag-registry.ts:172-177`, `defaultValue: false`),
  read through `useMudavymDesign('profile')` and `<PageGate page="profile" …>`
  (`App.tsx:347`). Per-browser override: `localStorage["mudavym.design.profile"]` —
  `1|true|on` forces the redesign, `0|false|off` forces legacy, absent falls through to
  the flag (`lib/mudavym/useMudavymDesign.ts:60-79`).

## 9. Gaps
- Restaurant section edits (`PATCH /organizations/locations/:id`) rely on server-side role enforcement; the page gate is client-side only.
- The v3.0 UX catalog's "dashboard profile card with no handler" item (L102) was never located (`v3.0-TECH-DEBT.md:502`) — unverified, tracked there, not here.

**Found while building the Mudavym redesign (2026-09-02). All outside
`apps/web/src/pages/profile/next/**`, so none were built here.**

| # | File | What it needs |
|---|---|---|
| G1 | `scripts/check_no_seeded_defaults.py:187-196` (`SCAN_ROOTS`) | add `Path("apps/web/src/pages/profile/next")`. The guard currently does not read the rebuilt surface at all. **Measured**: with the root added it examines 67 web files / 751,144 chars instead of 59 / 671,932, and still exits 0 — run against a patched copy on a symlinked root, since `scripts/` is outside this page's paths |
| G2 | `apps/api-gateway/src/organizations/organizations.service.ts:137-152` + `organizations.controller.ts:109-117` | `getLocation` selects `id, name, city, email, phone`. Add `subscription_tier` (and, when billing exists, its status) so the Payment rail can name the plan instead of rendering `—`. This is the single change that turns the page's most visible dash into a figure |
| G3 | `apps/api-gateway/src/integrations/integrations-oauth.service.ts:485-488` | `listConnections` logs a query error and returns `[]`, so a failed read is indistinguishable from "nothing connected" on the wire. The rebuild infers the failure (catalogue non-empty + connections empty) — a correct inference *today*, and a fragile one. The endpoint should surface the error |
| G4 | nothing exists | **MCP.** Zero matches for `mcp` across `apps/api-gateway/src`, `apps/web/src` and `supabase/migrations` (measured 2026-09-02). A rail, a table, a gateway module and an ADR are all missing; the page renders the shape and says so |
| G5 | nothing exists | **Payments.** Zero Stripe (or comparable) client, no billing/subscription/invoice table in any migration, no webhook. Pricing itself is founder-deferred (OD-23; `common/model-client/spend-tiers.ts:1-22` says its own figures are placeholders and must not be cited as pricing), so this is a decision before it is an integration |
| G6 | `apps/web/src/lib/identityProviders.ts:101-107` | Microsoft is declared but not renderable, so the Sign-in rail's Connect is disabled with that reason. A Microsoft sign-in button (the gateway route `POST /auth/oauth/microsoft` already exists) would switch it on |
| G8 | `apps/api-gateway/src/organizations/organizations.service.ts:123-153` (`getLocation`) | **The read has no role check.** It enforces org membership only; `assertManagerOrOwner` is called at `:186`, inside `updateLocation`, and nowhere else. So the *write* posture is manager/owner (every field this page writes — name, city, email, phone — is in `touchesOps`, `:178-187`) but the *read* posture is **any member of the organisation**: a staff member calling `GET /organizations/locations/:id` directly, past the UI gate, can read the restaurant's billing email and phone. Pre-existing, shared with the legacy page, and outside this page's paths — the rebuild's copy was corrected 2026-09-02 to state the real posture instead of implying the read is gated. Fix is `assertManagerOrOwner` in `getLocation`, or a deliberate decision that the read is open |
| G7 | `apps/api-gateway/src/auth/auth.controller.ts:487-491` | there is no **authenticated** way to fetch the identity-provider registry. `POST /auth/sign-in-methods` is `@Public()` and rate-limited by IP (10 / 600s), which a shared restaurant network would exhaust. An authenticated `GET /auth/me/sign-in-methods` returning `declared`/`methods`/`unavailable` would let the Sign-in rail use the server's own labels and reasons instead of page prose |

## 10. Maturity

**partial.** Every write on this page reaches a real, guarded endpoint and takes
effect; two read paths fail silently, and the one unbuilt section says so.

**Real on the write side, and better than the page note assumed — but the READ is not
gated at all.** §9 flagged that the Restaurant section "relies on server-side role
enforcement; the page gate is client-side only". For the **write** that enforcement
exists and was verified:
`OrganizationsService.updateLocation` checks org membership, then calls
`assertManagerOrOwner(userId, restaurantId)` for any field that touches operations
(`apps/api-gateway/src/organizations/organizations.service.ts:178-186`, helper
`:94-118`). A non-manager PATCH gets a `ForbiddenException`. That half of the concern is closed.

The **read** half is not, and this note previously implied it was: `getLocation`
(`organizations.service.ts:123-153`) checks org membership and stops there, so any member
of the organisation can `GET /organizations/locations/:id` and read the restaurant's
billing email and phone. Both designs hide that section from staff in the client only.
Filed as **G8** in §9; the Mudavym rebuild's copy states the real posture rather than
implying the server is doing the hiding.

Account deletion is likewise not a stub: `deleteAccount` refuses when the caller is
the sole owner of any restaurant (`auth/auth.service.ts:2132-2176` — the loop and
throw at `:2141-2153`) before doing
anything destructive.

**Not real:**

| Gap | Evidence |
|---|---|
| Two loaders swallow every error | `profileApi.getMe()` fails into an empty `catch` with the comment "Graceful: page still usable with auth context data" (`Profile.tsx:110-118`) — so phone, `hasPassword` and linked providers silently show stale or blank values. The restaurant loader falls back to cached branch data on failure (`:143-146`), meaning the Restaurant form can display one name while the server holds another, and a save then overwrites |
| Upgrade section is unbuilt | `Profile.tsx:831-851` — a disabled "Coming soon" button. Honest, and correctly not counted as hollow |
| Churn is untracked | §5 stands: account delete and leave-restaurant are the two highest-signal events on the page and emit nothing (`lib/uxSignals.ts:15`, dark) |

## 11. Data flow

### Calls out

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/auth/me` | JWT (`auth/auth.controller.ts:166-167`) | same | Profile + `hasPassword` + linked providers |
| PATCH | `/auth/me` | JWT (`:178-179`) | same | Updated name/phone (email read-only) |
| POST | `/auth/me/password` | JWT (`:188-189`) | same | 200 / validation error |
| GET | `/auth/me/linked-providers` | JWT (`:243-244`) | same | `{google, microsoft}` |
| POST/DELETE | `/auth/me/link/:provider` | JWT (`:252-253`, `:271-272`) | same | Link state |
| POST | `/auth/me/leave-restaurant` | JWT (`:287-288`) | same | Membership removed |
| DELETE | `/auth/me` | JWT + `@AllowUnverified` (`auth.controller.ts:307-313`) | `auth.service.ts:2132-2176` — sole-owner guard at `:2141-2153` | 200 `{success}`, then the page redirects to `/login` |
| GET | `/organizations/locations/:id` | JWT (class, `organizations.controller.ts:33`) | `:109-117` | Restaurant name/city/billing contact |
| PATCH | `/organizations/locations/:id` | JWT + `assertManagerOrOwner` | `:92-107` → `organizations.service.ts:155-215` | 204 |

### Fed by

| Data | Producer | Live? |
|---|---|---|
| Account fields | Registration, and this page | Yes |
| Linked providers | Google/Microsoft OAuth (`auth.controller.ts:103,118`) | Yes |
| Memberships list | `user_restaurant_access`, via the auth store's `availableRestaurants` (rendered `Profile.tsx:775-800`) | Yes |
| Restaurant + billing contact | `/settings` locations section and this page write the same `restaurants` columns | Yes |
| Billing / subscription state | **none** — no billing provider is integrated; the Upgrade block says "Coming soon" | No |

No agent and no cron writes anything this page reads. Unlike the rest of this
cluster, `/profile` has no dormant producer to depend on.

### Writes

| Write | Downstream reaction |
|---|---|
| `PATCH /auth/me` | Header user menu and sidebar name update on next fetch |
| `POST /auth/me/password` | Session unaffected; `hasPassword` flips true for OAuth-first accounts |
| Link / unlink provider | Changes which login paths work; unlink is refused if it would leave no credential |
| `POST /auth/me/leave-restaurant` | Removes the `user_restaurant_access` row — the user disappears from `/team`'s roster and from broadcast targets (`team.controller.ts:346-350`) |
| `DELETE /auth/me` | Irreversible; blocked while sole owner (`auth.service.ts:2141-2153`) |
| `PATCH /organizations/locations/:id` | Restaurant name/city/billing contact change everywhere they render, including `/settings` locations |

## 12. Design intent

**Should be:** the account page every role can use without a manager — identity,
credentials, which restaurants you belong to, and the exit.

| State | Handled? | Evidence |
|---|---|---|
| Loading | **No** | Both loaders are fire-and-forget `useEffect`s with no loading flag (`Profile.tsx:108-150`); fields simply populate late |
| Empty | Yes | "No memberships yet." (`:780`) |
| Error | **No** | Reads: two empty `catch` blocks (`:116`, `:143`). Writes: every mutation toasts (`:212-361`) — so the page reports what it changed but never what it failed to read |
| Permission-denied | Partial | Manager-only sections are hidden client-side (`:127,:158`); the server refuses correctly (`organizations.service.ts:184`) but a 403 has no UI |

**Where the UI misleads**

1. The restaurant fallback (`:143-146`) can render cached values that differ from the
   server's, and Save then writes the stale value back over the real one — the only
   data-loss path found on this page.
2. `Profile.tsx:445` — the support mailto falls back to `support@wineops.ai`. Not a
   string swap: that is a **domain** needing DNS and a mailbox (§7).
3. ~~`Profile.tsx:877` — "Permanently delete your WineOps account."~~ **Resolved 2026-09-02**
   — the line now says "Mudavym account" (§7). The rebuild says the same.

## 13. Roadmap

> **Status 2026-09-02.** Item 1 is **done in the Mudavym rebuild only**
> (`apps/web/src/pages/profile/next/`, flag `mudavym_design_profile`, OFF by default).
> The shipping page still carries both silent reads, so this stays open until the flag
> is on for everyone or the legacy page is retired. Item 3 is now *degraded honestly*
> rather than fixed — the rebuild says "no support address is configured" instead of
> linking to a dead domain, but the domain and mailbox are still owed. Items 4 and 5 are
> **done in the rebuild**: both fetches have loading states, and permission-denied is
> rendered with a 403 branch on the write. Items 2 and 6 are untouched.
>
> New work the rebuild surfaced, in the order it is worth doing —
> **G2** (expose `subscription_tier` so the plan stops being an em dash: one column on
> one select, and it is the page's most visible unknown), **G1** (add the rebuilt surface
> to the seeded-defaults guard's roots), **G3** (stop `listConnections` swallowing its
> query error), then **G7** / **G6** / **G4** / **G5**. All seven are specified in §9.

1. **Stop the silent read failures** (`Profile.tsx:110-118`, `:143-146`) — surface
   the error, and do not let a cached restaurant name become a write. Highest value:
   it is the only overwrite risk on the page.
2. **Track leave-restaurant and delete-account** (§5). Churn is the one thing this
   page uniquely observes and it is thrown away today. Blocked on the signal spine
   (`lib/uxSignals.ts:15` ships dark, and its consent switch governs nothing — see
   settings.md §10).
3. **Fix the support address** — `VITE_SUPPORT_EMAIL` plus a real mailbox, or the
   rebrand leaves a dead `mailto:` (§7).
4. Loading state for both fetches.
5. 403 branch for the manager-only writes.
6. `v3.0-TECH-DEBT.md:502` (the "dashboard profile card with no handler", L102) was
   never located — leave it tracked there, not here.
