---
type: page
route: /no-access
slug: no-access
component: apps/web/src/pages/NoAccess.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 2
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[invite-landing]]", "[[login]]"]
---

# /no-access

## Surface — buttons → where they go

- **Sign out** → API `POST /api/v1/auth/logout`, session cleared → [[login]] `/login`
- **Back to sign in** → [[login]] `/login`

## 1. Purpose
Dead-end card for a signed-in user with no restaurant membership: shows their email, tells them to ask an owner for an invite link, offers Sign out (`NoAccess.tsx:24-31`, calls `logout`) and Back to sign in.

## 1a. Features
- Shows your signed-in email and explains you need an owner's invite link
- Sign out; back to sign in
- 🚧 Nothing actually routes users here today (see §9)

## 2. Entry
**Orphaned.** The route exists (`App.tsx:155`) but *nothing navigates to it* — grep for `no-access` across `apps/web/src` finds only the route binding and a comment in `AuthShell.tsx:18`. Neither `ProtectedRoute.tsx` nor `AuthContext.tsx` redirects membership-less users here. [PAGE_MAP](../foundation/PAGE_MAP.md) omits it from the entry-points list (it only records the outbound `n_no_access --> n_login` edge) — a map inconsistency worth knowing about.

## 3. Files
- Route binding: `apps/web/src/App.tsx:155` (eager, `App.tsx:70`)
- `apps/web/src/pages/NoAccess.tsx` (42 lines)
- Chrome: `components/brand/AuthShell.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| POST | `/api/v1/auth/logout` | via `logout` → `AuthContext.tsx:583` | ENDPOINTS.md:65 |

## 5. Signals
**none.**

## 6. Tier cut
Public; no scenario touches it (OD-48).

## 7. Rebrand surface
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.`
- `BrandMark.tsx:17` — default alt `WineOps`
(No WineOps string in `NoAccess.tsx` itself; "restaurant workspace" copy is brand-neutral.)

## 8. State & config
none. Renders from auth context only.

## 9. Gaps
- **The page is unreachable by design flow.** The state it describes (authenticated, zero restaurants) is real — `AuthContext` fetches `/organizations/branches` — but no code routes that state here. Either wire the redirect or retire the page; today it exists only for someone who types the URL. Related wiring-audit lesson: `v3.0-TECH-DEBT.md:229` verified it is *routed*, but routed ≠ reachable.

---

## 10. Maturity

**hollow.** The card renders and its buttons work; the condition it describes is never computed, and the app actively fabricates a state that hides it.

*Unreachable, confirmed by exhaustive grep.* `no-access` / `NoAccess` appears exactly four times in `apps/web/src`: the import (`App.tsx:70`), the route (`App.tsx:155`), a docstring listing (`AuthShell.tsx:18`), and the component itself (`NoAccess.tsx:6`). No `Navigate`, no `navigate()`, no redirect anywhere targets it. `ProtectedRoute` has no membership check at all — its branches are loading, unauthenticated, email-verification (dead, see [[verify-email]] §10), studio-role loading, role, studio-role (`ProtectedRoute.tsx:22-124`).

*And worse than unreachable — contradicted.* For exactly the user this page exists for (authenticated, zero restaurants), `AuthContext` does not surface emptiness; it invents a branch. When `GET /organizations/branches` returns an empty list or throws, the fallback resolves a candidate id from the JWT or localStorage and, if it finds one, applies a synthetic branch literally named **`'My Restaurant'`** (`AuthContext.tsx:342-355`). The user is then routed into [[dashboard]] against a restaurant they may have no membership in. That is the contract's "fabricated" state, not a missing one.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| POST | `/api/v1/auth/logout` | Bearer (`@UseGuards(JwtAuthGuard)`) | `auth.controller.ts:146-148` | `{success:true}`; blacklists the presented access token via `TokenBlacklistService` (checked at `jwt-auth.guard.ts:37-43`) |

Renders `user.email` from context (`NoAccess.tsx:13-17`) — no fetch of its own.

### Fed by

The state it should react to would come from `GET /api/v1/organizations/branches` (`organizations.controller.ts:33,40`) returning an empty list — i.e. no `user_restaurant_access` rows for this user. Those rows are written by `POST /auth/register/restaurant` (`auth.service.ts:623-631`), `POST /auth/join` (`:1208-1216`) and `POST /auth/invite/:code/accept` (`:1077-1085`). **Nothing consumes the empty case.**

### Writes

Nothing persistent. `logout()` clears client state (`AuthContext.tsx:583`) and blacklists one access token server-side; the refresh token is not revoked (no revocation store exists — same gap noted at `auth.service.ts:1668-1675`).

## 12. Design intent

**Should be:** the honest terminal state for "your account is real, your membership is not" — the counterpart to [[invite-landing]], reached automatically rather than by typing a URL.

| State | Handled? | Evidence |
|---|---|---|
| Empty | this page *is* the empty state — but is never shown | §10 |
| Loading | no | renders immediately; a user whose branch fetch is still in flight would see "no access" prematurely if it were ever routed to |
| Error | no | cannot distinguish "no memberships" from "branches endpoint failed" — `AuthContext.tsx:320-322` only `console.warn`s |
| Permission-denied | this page *is* the permission-denied state | — |

**Where it misleads:** not on this page — on the one that replaces it. The `'My Restaurant'` fallback (`AuthContext.tsx:347-355`) is a fabricated tenant shown to a user with no tenant; every downstream page then renders zeros for a restaurant that is not theirs.

## 13. Roadmap

1. Decide: wire it or retire it. Retire-to-write (CLAUDE.md §4) applies either way.
2. If wired — add a membership branch to `ProtectedRoute` that redirects here when `availableRestaurants` is empty *after* the fetch settles (`ProtectedRoute.tsx:22-124`, `AuthContext.tsx:290-356`). Requires distinguishing "empty" from "still loading" and from "fetch failed", which the context does not currently expose.
3. Either way — stop fabricating `'My Restaurant'` (`AuthContext.tsx:347-355`). This is the real defect; the orphaned page is only its symptom.
4. Correct [PAGE_MAP](../foundation/PAGE_MAP.md), which records an outbound `n_no_access --> n_login` edge but omits the page from entry points — routed is not reachable (`v3.0-TECH-DEBT.md:229`).
