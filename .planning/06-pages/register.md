---
type: page
route: /register
slug: register
component: apps/web/src/pages/Register.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 3
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[login]]", "[[invite-landing]]", "[[verify-email]]"]
---

# /register

## 1. Purpose
Two-path account creation: **Path A "Join Your Team"** — enter an 8-character invite code and create a staff/manager account under an existing restaurant; **Path B "Open a Restaurant"** — create an owner account plus the restaurant record (identity/location/contact in a 3-section rail form). Path B ends at `/verify-email`; Path A lands straight on the dashboard ("No email verification needed", `Register.tsx:196`).

## 2. Entry
- `/login` → "Create one now" (`Login.tsx:188-193`)
- `/invite/:code` → "Create account to accept" as `/register?invite=CODE` (`InviteLanding.tsx:144`)
- URL params auto-route (D-09): `?invite=CODE` → Path A prefilled, `?type=join` → Path A, `?type=new` → Path B (`Register.tsx:129-145`)

## 3. Files
- Route binding: `apps/web/src/App.tsx:150` (eager, `App.tsx:65`)
- `apps/web/src/pages/Register.tsx` (1,332 lines — largest auth page; builds its own shell rather than using `AuthShell`)
- Inputs: `PhoneNumberInput`, `PlacesAutocomplete`, `CountryCombobox`, `CuisinePicker` (`Register.tsx:7-12`)

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
- No Google/OAuth sign-*up* path — `GoogleSignInButton` exists on `/login` only; a new user who wants Google must register with a password first, then link (Profile → Linked accounts).
- The relative-path invite fetch (`Register.tsx:157`) breaks if the SPA is served from an origin with no `/api` rewrite (works on Vercel, not on a bare static host) — inconsistent with `InviteLanding.tsx:38` which uses `API_URL`.
