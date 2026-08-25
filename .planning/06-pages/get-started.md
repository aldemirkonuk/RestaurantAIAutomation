---
type: page
route: /get-started
slug: get-started
component: apps/web/src/pages/GetStarted.tsx
audience: owner
tier: core
signals_today: partial
rebrand_strings: 5
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[onboarding]]", "[[verify-email]]"]
---

# /get-started

## 1. Purpose
The live activation surface: **Activate** tab (import your wine list via Scan Photo / Upload File / Manual Entry → review screen → one-time low-stock threshold step) and **Use the app** tab (seven guide cards into the main surfaces + Wine Agent explainer). "Activated" = menu + threshold (`GetStarted.tsx:239-240`). Staff get a separate read-only welcome with no upload/threshold/invite steps (`GetStarted.tsx:217-221` → `StaffWelcome`).

## 2. Entry
- `/verify-email` success → here unless a menu already exists (`VerifyEmail.tsx:50`)
- `/onboarding` auto-forwards menu-less users (`Onboarding.tsx:13-15`)
- Sidebar "Get started" checklist, shown while activation is incomplete (`Sidebar.tsx:422,601`)
- Guidance surfaces: `LearnPanel`, `SetupNudgeBanner` (grep `get-started`)
- Query params: `?tab=activate|use`, `?method=scan|csv|manual` deep-link a specific import method (`GetStarted.tsx:166-183`)

## 3. Files
- Route binding: `apps/web/src/App.tsx:162` (lazy, `App.tsx:77`)
- `apps/web/src/pages/GetStarted.tsx` (482 lines)
- Co-located tree: `components/onboarding/` — `MenuImportCard`, `MenuScanUpload`, `MenuCsvUpload`, `MenuManualEntry`, `MenuReviewScreen`, `ThresholdStep`, `OptionalTail`, `StaffWelcome`
- API module: `services/api/menus.ts`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/onboarding/progress` | `useOnboardingProgress` → `menus.ts:113` | ENDPOINTS.md:286 |
| POST | `/menus/import` | all three import components → `menus.ts:83` | ENDPOINTS.md:283 |
| PATCH | `/menus/items/:id` · POST `/menus/items` | `MenuReviewScreen` → `menus.ts:96,104` | ENDPOINTS.md:284-285 |
| PATCH | `/onboarding/threshold` | `ThresholdStep` → `menus.ts:136` | ENDPOINTS.md:288 |
| GET | `/onboarding/vendor-email` | `OptionalTail` → `menus.ts:128` | ENDPOINTS.md:289 |
| GET | (ical token) | `OptionalTail` → `services/api/calendar.ts` `getIcalToken` | — |
| GET | `/auth/me/linked-providers` | `OptionalTail` → `profileApi` (`profile.ts:39-40`) | ENDPOINTS.md:72 |

## 5. Signals
**partial — the only instrumented page in this batch.** `trackGuidance('guide_card_clicked', { cardId })` (`GetStarted.tsx:445`) and `trackGuidance('services_visited', { source: 'get-started' })` (`:452`). Sink: `window.dataLayer.push` + a `wineops:guidance` CustomEvent, console-only in dev (`guidance/analytics.ts:19-41`). Nothing consumes the CustomEvent server-side — events die in the browser unless a GTM container exists. Import success/failure, method choice, and threshold completion are **not** tracked.

## 6. Tier cut
Core — this page *is* activation for S06 (menu/wine-list enters the system; wine ✅ / food 🚧 per [TIER-MAP](../03-scenarios/TIER-MAP.md) S06 row) and sets the S10 threshold. **It never asks the POS question** — the tier unlock (S14; most Plus/Pro ⛔ cells) is deferred to Settings → Integrations, so activation ends with the majority of paid value still dark.

## 7. Rebrand surface
- `GetStarted.tsx:279` — header wordmark `WineOps`
- `GetStarted.tsx:63` — success copy "…learn how to use WineOps day to day"
- `GetStarted.tsx:324` — "Uploading your menu helps WineOps understand what you sell"
- `GetStarted.tsx:418` — H1 "How to use WineOps"
- `StaffWelcome.tsx:43` — "Welcome to WineOps" (staff variant)
Plus the event namespace itself: `wineops:guidance` (`guidance/analytics.ts:37`).

## 8. State & config
- Role gate: `user.role === 'staff'` swaps the entire page for `StaffWelcome` (`GetStarted.tsx:164,219-221`); owner-only cards filtered by `ownerOnly` (`:272`).
- Server-side progress flags drive rendering: `menu_uploaded`, `threshold_configured` (`GetStarted.tsx:168,187,195,241`).
- No env flags.

## 9. Gaps
- Threshold step is skipped silently when already configured (`GetStarted.tsx:194-199`) — correct, but the `return null` waiting state (`:252-256`) renders a blank screen while progress loads.
- The guidance funnel has no backend sink (§5) — the founder's tracking mandate lands here first: this page is already emitting, nothing is listening.
