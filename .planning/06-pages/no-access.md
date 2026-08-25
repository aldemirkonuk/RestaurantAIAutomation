---
type: page
route: /no-access
slug: no-access
component: apps/web/src/pages/NoAccess.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 2
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[invite-landing]]", "[[login]]"]
---

# /no-access

## 1. Purpose
Dead-end card for a signed-in user with no restaurant membership: shows their email, tells them to ask an owner for an invite link, offers Sign out (`NoAccess.tsx:24-31`, calls `logout`) and Back to sign in.

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
