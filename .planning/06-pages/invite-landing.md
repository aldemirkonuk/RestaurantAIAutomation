---
type: page
route: /invite/:code
slug: invite-landing
component: apps/web/src/pages/InviteLanding.tsx
audience: public
tier: public
archetype: focused # proposed 2026-08-26 (OD-79)
signals_today: none
rebrand_strings: 3
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[register]]", "[[no-access]]", "[[login]]", "[[dashboard]]"]
---

# /invite/:code

## Surface — buttons → where they go

- **Sign in to accept** → [[login]] `/login?redirect=/invite/:code`
- **Create account to accept** → [[register]] `/register?invite=CODE`
- **Add {restaurant} (signed-in)** → API `POST /api/v1/auth/invite/:code/accept` → [[dashboard]] `/`
- **Cancel, go back** → browser history back
- **Back to sign in (expired invite)** → [[login]] `/login`

## 1. Purpose
Landing page for a team-invite link. Previews the invite (restaurant, role) before any commitment. Branches on auth state: signed-out users get "Sign in to accept" (login with `?redirect=` back here, `InviteLanding.tsx:90`) or "Create account to accept" (`/register?invite=CODE`, `:144`); signed-in users get a one-tap "Add {restaurant}" accept (`:154-168`). A 409 ("already a member") is treated as success (`:67-72`). Expired/invalid codes get a dead-end card pointing back to `/login` (`:102-116`).

## 1a. Features
- Preview the invite before committing: which restaurant, which role
- Signed out: "Sign in to accept" or "Create account to accept" (both return here)
- Signed in: one-tap "Add {restaurant}" accept ("already a member" counts as success)
- Expired/invalid code: a clear dead-end card pointing back to sign-in

## 2. Entry
**Cold URL** — the link is minted server-side as `${FRONTEND_URL}/invite/${invite.code}` (`auth.service.ts:893`) and shared by the owner out-of-band (email/chat). No in-app navigation to it.

## 3. Files
- Route binding: `apps/web/src/App.tsx:154` (eager, `App.tsx:69`)
- `apps/web/src/pages/InviteLanding.tsx` (181 lines)
- Chrome: `components/brand/AuthShell.tsx`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/api/v1/auth/invite/:code` | `InviteLanding.tsx:38` (unauthenticated preview) | ENDPOINTS.md:61 |
| POST | `/api/v1/auth/invite/:code/accept` | `InviteLanding.tsx:59-60` (Bearer from localStorage) | ENDPOINTS.md:62 |
| GET | `/api/v1/organizations/branches` | via `refreshBranches` → `AuthContext.tsx:301` (after accept) | ENDPOINTS.md:346 |

## 5. Signals
**none.** Invite conversion — the single highest-value growth funnel event — is untracked.

## 6. Tier cut
Public → Core: accepting an invite is how staff enter every Core scenario. No `S..` names this page (OD-48).

## 7. Rebrand surface
- `InviteLanding.tsx:94` — loading state `AuthShell title="WineOps AI"`
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.`
- `BrandMark.tsx:17` — default alt `WineOps`
- Wine-domain copy: "start managing wine inventory together" (`InviteLanding.tsx:126`)

## 8. State & config
- `VITE_API_GATEWAY_URL` (`InviteLanding.tsx:8`). No flags.

## 9. Gaps
- Accept requires a token in `localStorage` and silently no-ops without one (`InviteLanding.tsx:54-55`) — an authenticated-per-context but token-expired user gets a button that does nothing.
- Wired and verified during the Phase 33 drift audit — routed, endpoints answer 401-not-404 (`v3.0-TECH-DEBT.md:229`).

---

## 10. Maturity

**partial.**

Both halves work against real data. The preview is a live lookup (`auth.service.ts:769-796`) and the accept path writes a real membership: it consumes the invite with a conditional update that is atomic against double-use (`.is("used_at", null).gt("expires_at", now)`, `auth.service.ts:1046-1054`), inserts `user_restaurant_access`, upserts `organization_members`, claims the `team_members` row, and un-consumes the invite on every failure branch (`:1070-1073`, `:1088-1091`).

Named absences:
- **Accept silently no-ops without a token.** `InviteLanding.tsx:54-55` returns if `localStorage.accessToken` is missing — but the button is rendered on `isAuthenticated` (`:154-168`), which comes from context state that can outlive the stored token. A user in that state clicks a button that does nothing, with no message.
- **Invites are not bound to an email.** `targetEmail` is optional on generation (`auth.service.ts:875`, `InviteDto`), and neither accept path checks it (`:1033-1118`, `:1138-1251`). Whoever holds the link gets the role. That is a design choice; it is also what makes the `POST /auth/join` defect in [[register]] §10 reachable.
- Raw `fetch` + manual `Bearer` (`:38`, `:59-64`) rather than the shared axios client, so no 401 refresh.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/api/v1/auth/invite/:code` | `@Public()` | `auth.controller.ts:368-372` | `{valid:false, reason:"not_found"\|"used"\|"expired"}` or `{valid:true, organization, restaurant, city, inviter, role}` (`auth.service.ts:783-795`) |
| POST | `/api/v1/auth/invite/:code/accept` | Bearer (`@UseGuards(JwtAuthGuard)`) | `auth.controller.ts:321-335` | `{restaurant, role}`; **409 `already_member`** (`auth.service.ts:1074`) |
| GET | `/api/v1/organizations/branches` | Bearer | `organizations.controller.ts:33,40` | refreshed branch list (`AuthContext.tsx:306`) |

**What an anonymous caller learns from the preview:** the organisation name, the restaurant name, its city, the **inviter's personal name**, and the role on offer — with no authentication (`auth.service.ts:788-795`). Guessing is not the exposure: 8 chars over a 32-symbol charset is ~1.1e12 combinations (`:838-845`) against a 10/min-per-IP auth bucket (`rate-limit.guard.ts:29`). The exposure is that anyone who *receives or intercepts* the link — a forwarded email, a shared chat, a browser-history sync — reads a named individual and a business location out of it. Worth a decision, not an emergency.

### Fed by

`organization_invites`, written only by `POST /auth/invite` (owner/manager, `auth.controller.ts:377-393` → `auth.service.ts:802-896`). The producer also pre-creates a `team_members` row so the pending invite shows on [[team]] before anyone accepts (`ensureTeamMemberForInvite`, `:902-963`) and flips `user_onboarding_progress.team_member_invited` (`:880-889`).

### Writes — and what reacts

| Table | Write | Downstream |
|---|---|---|
| `organization_invites` | `used_at`, `used_by_email` (`auth.service.ts:1046-1049`) | single-use; rolled back on any later failure (`:1070-1073`, `:1088-1091`) |
| **`user_restaurant_access`** | insert `{user_id, restaurant_id, role, invited_via, is_active}` (`:1077-1085`) | this row is what `generateTokens` reads for the role claim (`:413-420`) and what [[dashboard]] tenanting depends on |
| `organization_members` | upsert on `(organization_id, user_id)` (`:1097-1105`) | multi-branch switching via `POST /auth/switch-restaurant` |
| `team_members` | claim by `invite_id` or email (`claimTeamMemberFromInvite`, `:964`) | the pending row on [[team]] becomes a real member |
| client | `refreshBranches()` (`InviteLanding.tsx:69,77`) | rewrites `availableRestaurants`, `activeRestaurantId`, `X-Restaurant-Id` (`AuthContext.tsx:293-302`) |

**Yes — accepting an invite mutates `user_restaurant_access`.**

## 12. Design intent

**Should be:** enough context to decide before committing, and exactly one obvious next action for each of the three arrival states (signed out / signed in / stale invite).

| State | Handled? | Evidence |
|---|---|---|
| Empty | yes — invalid/used/expired all render one card (`:102-116`) | but all three collapse into the copy *"This invite has expired"* (`:104`), so a *used* code is described wrongly |
| Loading | yes | spinner (`:92-100`) |
| Error | yes | `acceptError` banner, 409 handled as success (`:67-72`, `:79-84`) |
| Permission-denied | n/a | the code is the permission |

**Where it misleads:**
- The three `reason` values the API returns (`auth.service.ts:783-786`) are discarded; a code that was already used is reported as expired (`:102-104`). Cheap fix, real support cost.
- The accept button with no stored token (§10) is a control with no effect — the contract's named failure mode.

## 13. Roadmap

1. Guard the accept button on the actual token, or refresh/redirect to `/login?redirect=…` instead of returning silently (`:54-55`).
2. Render the three invite `reason` values distinctly (`:102-116`).
3. Decide whether invites bind to `targetEmail`. *Blocked:* founder call. It changes the sharing model — and it is the cheapest containment for the [[register]] §10 defect.
4. Decide whether the unauthenticated preview should name the inviter (`auth.service.ts:793`). *Blocked:* founder call.
5. Move to the shared axios client (`:38`, `:59`).
6. Track invite viewed / accepted / abandoned — the highest-value growth event in the product, currently unmeasured (§5). *Blocked:* no sink (see [[get-started]] §11).
