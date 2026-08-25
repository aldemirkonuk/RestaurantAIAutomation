---
type: page
route: /profile
slug: profile
component: apps/web/src/pages/Profile.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 2
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[settings]]"]
---

# /profile

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
