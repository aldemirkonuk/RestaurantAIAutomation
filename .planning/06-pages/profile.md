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
updated: 2026-08-26
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

## 2. Entry
In-degree 3 per [PAGE_MAP](../foundation/PAGE_MAP.md): header user menu (`Header.tsx:277`), sidebar bottom nav (`Sidebar.tsx:166-170`), plus `/help`, `/privacy`, `/settings` link here. Inside `DashboardLayout` + `ProtectedRoute` (`App.tsx:247-252,286`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:286` (lazy, `App.tsx:105`)
- `apps/web/src/pages/Profile.tsx` (907 lines)
- API module: `services/api/profile.ts`; `components/auth/GoogleLinkButton.tsx`

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

## 5. Signals
**none.** Account deletion and restaurant-leave — churn events — are untracked.

## 6. Tier cut
Core, every role. No `S..` touches it directly (OD-48).

## 7. Rebrand surface
- `Profile.tsx:445` — support mailto falls back to `support@wineops.ai` when `VITE_SUPPORT_EMAIL` is unset (a **domain**, not just a name — needs DNS/mailbox work, not a string swap)
- `Profile.tsx:877` — "Permanently delete your WineOps account."

## 8. State & config
- `VITE_SUPPORT_EMAIL` (`Profile.tsx:445`).
- Role gating in-page: `isManagerOrOwner` gates the Restaurant/Payment/Memberships sections and the locations fetch (`Profile.tsx:127,158`).
- Theme via `ThemeContext`.

## 9. Gaps
- Restaurant section edits (`PATCH /organizations/locations/:id`) rely on server-side role enforcement; the page gate is client-side only.
- The v3.0 UX catalog's "dashboard profile card with no handler" item (L102) was never located (`v3.0-TECH-DEBT.md:502`) — unverified, tracked there, not here.

## 10. Maturity

**partial.** Every write on this page reaches a real, guarded endpoint and takes
effect; two read paths fail silently, and the one unbuilt section says so.

**Real, and better than the page note assumed.** §9 flagged that the Restaurant
section "relies on server-side role enforcement; the page gate is client-side only" —
the server enforcement exists and was verified:
`OrganizationsService.updateLocation` checks org membership, then calls
`assertManagerOrOwner(userId, restaurantId)` for any field that touches operations
(`apps/api-gateway/src/organizations/organizations.service.ts:178-186`, helper
`:94-118`). A non-manager PATCH gets a `ForbiddenException`. That concern is closed.

Account deletion is likewise not a stub: `deleteAccount` refuses when the caller is
the sole owner of any restaurant (`auth/auth.service.ts:1877-1897`) before doing
anything destructive.

**Not real:**

| Gap | Evidence |
|---|---|
| Two loaders swallow every error | `profileApi.getMe()` fails into an empty `catch` with the comment "Graceful: page still usable with auth context data" (`Profile.tsx:110-118`) — so phone, `hasPassword` and linked providers silently show stale or blank values. The restaurant loader falls back to cached branch data on failure (`:141-146`), meaning the Restaurant form can display one name while the server holds another, and a save then overwrites |
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
| DELETE | `/auth/me` | JWT (`:298-299`) | `auth.service.ts:1877-1921` — sole-owner guard | 204, then redirect to `/login` |
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
| `DELETE /auth/me` | Irreversible; blocked while sole owner (`auth.service.ts:1886-1897`) |
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

1. The restaurant fallback (`:141-146`) can render cached values that differ from the
   server's, and Save then writes the stale value back over the real one — the only
   data-loss path found on this page.
2. `Profile.tsx:445` — the support mailto falls back to `support@wineops.ai`. Not a
   string swap: that is a **domain** needing DNS and a mailbox (§7).
3. `Profile.tsx:877` — "Permanently delete your WineOps account."

## 13. Roadmap

1. **Stop the silent read failures** (`Profile.tsx:110-118`, `:141-146`) — surface
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
