---
type: page
route: /invite/:code
slug: invite-landing
component: apps/web/src/pages/InviteLanding.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-25
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
