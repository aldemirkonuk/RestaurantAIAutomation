---
type: page
route: /get-started
slug: get-started
softwares: [auth-onboarding]
component: apps/web/src/pages/GetStarted.tsx
audience: owner
tier: core
archetype: form # proposed 2026-08-26 (OD-106)
signals_today: partial
rebrand_strings: 5
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[onboarding]]", "[[verify-email]]", "[[dashboard]]", "[[inventory]]", "[[orders]]", "[[providers]]", "[[settings]]", "[[sommelier]]"]
---

# /get-started

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Go to Dashboard (header)** → [[dashboard]] `/`
- **Activate: Scan Photo / Upload File / Manual Entry** → (import flow on this page → review → threshold step)
- **Success screen: open inventory** → [[inventory]] `/inventory`
- **Card: Import your wine list** → (switches to Activate tab)
- **Card: Check inventory & alerts** → [[inventory]] `/inventory`
- **Card: Create & track orders** → [[orders]] `/orders`
- **Card: Add a vendor** → [[providers]] `/providers`
- **Card: Invite your team** → [[settings]] `/settings?tab=team`
- **Card: Wine Agent** → [[sommelier]] `/sommelier`
- **Card: Services & permissions** → [[settings]] `/settings?tab=services`

## 1. Purpose
The live activation surface: **Activate** tab (import your wine list via Scan Photo / Upload File / Manual Entry → review screen → one-time low-stock threshold step) and **Use the app** tab (seven guide cards into the main surfaces + Wine Agent explainer). "Activated" = menu + threshold (`GetStarted.tsx:239-240`). Staff get a separate read-only welcome with no upload/threshold/invite steps (`GetStarted.tsx:217-221` → `StaffWelcome`).

## 1a. Features
- **Activate** tab: import your wine list three ways — scan a photo, upload a file, or enter manually
- Review screen for the extracted items: edit lines, add missing ones
- One-time low-stock threshold step (skipped once configured)
- **Use the app** tab: seven guide cards into the main surfaces + a Wine Agent explainer
- Staff see a separate read-only welcome (no upload/threshold/invite steps)
- Deep links open a specific tab or import method (`?tab=`, `?method=`)
- **Flag-gated** (`mudavym_design_cellar`, OFF by default): "What does this house pour?" — the cellar registers, inferred from this house's own cellar and menu and **confirmed here**, mounted immediately after the menu review (`GetStarted.tsx:259-273`) and as the last Activate step when a menu already exists (`GetStarted.tsx:433-441`). Always skippable ("Confirm later — you can change this under Settings → Cellar"), never a gate on the flow, and silently skipped when there is nothing to ask (already confirmed) or when the readout could not be read (`components/onboarding/CellarRegistersOnboarding.tsx:47-52`). With the flag off the page renders exactly as before and the chunk is never fetched.

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
- Flag-gated step (lazy, `GetStarted.tsx:37-39`): `components/onboarding/CellarRegistersOnboarding.tsx` wrapping `pages/cellar/next/CellarRegistersStep.tsx` over `useCellarRegisters()` (`pages/cellar/next/useCellarNextData.ts:280`; `GET`/`PUT /cellar/:rid/registers`)
- Test: `pages/__tests__/GetStarted.cellarRegisters.test.tsx`

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
- Feature flag `mudavym_design_cellar` (per-restaurant, gateway registry `apps/api-gateway/src/settings/feature-flag-registry.ts:179`) gates the cellar-registers step, read via `useMudavymDesign('cellar')` (`GetStarted.tsx:175`). Per-browser override: `localStorage["mudavym.design.cellar"]` = `1|true|on` / `0|false|off`.
- No other env flags.

## 9. Gaps
- Threshold step is skipped silently when already configured (`GetStarted.tsx:194-199`) — correct, but the `return null` waiting state (`:252-256`) renders a blank screen while progress loads.
- The guidance funnel has no backend sink (§5) — the founder's tracking mandate lands here first: this page is already emitting, nothing is listening.

---

## 10. Maturity

**partial.** This is the live activation surface — [[onboarding]] is a tombstone that forwards here (`Onboarding.tsx:13-15`), so there is no ambiguity about which of the two is real. The import chain persists genuinely; three named capabilities are absent.

Works end to end: `POST /menus/import` parses scan/CSV/manual into `WineExtractItem[]` and writes a menu plus review items (`menus.controller.ts:36-43` → `menus.service.ts:62-84`); the review screen patches items (`:54-58`); `PATCH /onboarding/threshold` sets `restaurants.default_threshold_min` and `threshold_configured` (`menus.controller.ts:91-102` → `menus.service.ts:704-721`). "Activated" = both flags (`GetStarted.tsx:239-241`).

Absent:
- **The route is public** (`App.tsx:162`, inside the `{/* Public Routes */}` block at `:148`) — no `ProtectedRoute`. An anonymous visitor renders the full Activate tab with working-looking upload buttons; every call 401s. `useOnboardingProgress` has no `enabled` guard and drops `query.error` (`useOnboardingProgress.ts:7-24`), so 401 is indistinguishable from "nothing imported yet".
- **No POS question anywhere in activation** (§6). Activation completes with most paid value still dark.
- **Both writes are cross-tenant writable.** See §11.

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/onboarding/progress` | Bearer | `menus.controller.ts:68-69,76-80` | progress row; 404→`null` (`menus.service.ts:655-658`, `services/api/menus.ts:41-44`) |
| POST | `/menus/import` | Bearer; **`restaurantId` read from the request body** | `menus.controller.ts:36-43` → `menus.service.ts:62-84` (`const { restaurantId } = dto`) | `{menuId, itemsExtracted, submissionsCreated, items}` |
| PATCH | `/menus/items/:id` · POST `/menus/items` | Bearer | `menus.controller.ts:54-58`, `:45-52` | reviewed/added item |
| PATCH | `/onboarding/threshold` | Bearer; **`restaurantId` read from the request body** | `menus.controller.ts:91-102` → `menus.service.ts:704-721` | `{default_threshold_min, threshold_configured:true}` |
| GET | `/onboarding/vendor-email` | Bearer; tenant from the principal (`@CurrentUser`) | `menus.controller.ts:103-109` | inbound address, provisioned on demand |
| GET | `/auth/me/linked-providers` | Bearer | `auth.controller.ts:243-250` | `{google, microsoft}` |

**Tenancy finding — the two writes on this page take their tenant from the caller's body, and nothing verifies it.** `services/api/menus.ts:8-13` and `:61-62` send `restaurantId` from `getActiveRestaurantId()`; `menus.controller.ts:36-43` and `:91-102` pass it straight through; neither service method compares it to the authenticated user (`menus.service.ts:62-84`, `:704-721`). The only intended defence is the global `TenantGuard`.

**That defence does not run here.** `TenantGuard` is registered as an `APP_GUARD` (`app.module.ts:128-131`) and `JwtAuthGuard` is *never* global — the only two `APP_GUARD` entries are `RateLimitGuard` and `TenantGuard` (`app.module.ts:122-131`), and `JwtAuthGuard` is applied per controller/route (`menus.controller.ts:23`, `:69`). NestJS runs global guards before controller and route guards, so `request.user` is still unset when `TenantGuard` executes, and it takes its documented fail-open branch (`tenant.guard.ts:54-59`) on every such route. Corroborating evidence: `settings.controller.ts:32` re-lists `TenantGuard` *after* `JwtAuthGuard` in its own `@UseGuards`, which would be redundant if the global instance were effective; `tenant.guard.spec.ts` constructs a request with `user` already populated, so it pins the guard's logic and not its placement. **Not runtime-verified** — booting the gateway was out of scope for this pass; it should be confirmed with a live request before anything is built on it.

Two consequences, and they pull in opposite directions:
1. *Reassuring:* the 2026-08-25 tenantless-user denial (`tenant.guard.ts:70-78`) does **not** break this page. No onboarding path in this cluster regresses.
2. *Alarming:* it does not protect it either. As written, any authenticated user can import a menu into, or set the low-stock threshold of, **any restaurant id they name** (`menus.service.ts:62-84`, `:704-721`). And the moment someone "fixes" the ordering by adding `TenantGuard` to `menus.controller.ts`, these two calls become the first things to 403 — because they name a tenant in the body.

Adjacent, same root cause: `GET /menus/:restaurantId` (`menus.controller.ts:27-34`) passes the path param straight to `menusService.getMenu` with no ownership check.

### Fed by

`user_onboarding_progress` seeded at Path-B registration (`auth.service.ts:634-642`, fire-and-forget); `restaurant_menus` written by this page's own import, and read back by the `menu_uploaded` self-heal for invitees (`menus.service.ts:660-670`); scan imports go through `ScanParserService` (`menus.service.ts:76`), the one model call in the funnel.

### Writes — and what reacts

| Write | Downstream |
|---|---|
| menu + items (`menus.service.ts:62-84`) | populates [[inventory]]; the success screen links straight there (`GetStarted.tsx:267`) |
| `restaurants.default_threshold_min`, `threshold_configured` (`:704-721`) | the low-stock threshold every alert in [[notifications]] compares against — S10 |
| `user_onboarding_progress` flags | drives the sidebar "Get started" checklist (`Sidebar.tsx:422,601`) and [[onboarding]]'s redirect |
| `trackGuidance` events (`GetStarted.tsx:445,452`) | **nothing** — `window.dataLayer.push` + a `wineops:guidance` CustomEvent, console-only in dev (`guidance/analytics.ts:19-41`). No server sink exists |

## 12. Design intent

**Should be:** the shortest honest path from "account exists" to "the product has data and knows one threshold" — and the place the POS question gets asked, because that is what unlocks most of the product.

| State | Handled? | Evidence |
|---|---|---|
| Empty | yes | Activate tab is the empty state (`GetStarted.tsx:167-169`) |
| Loading | partial | `isLoading` gates the threshold decision (`:194-199`), but the pending-result branch renders `return null` — a blank screen while progress loads (`:252-256`) |
| Error | **no** | the hook never exposes `query.error` (`useOnboardingProgress.ts:7-24`); an import failure surfaces only inside the individual upload components |
| Permission-denied | partial | staff get `StaffWelcome` (`:219-221`) and owner-only cards are filtered (`:272`) — but that is role shaping, not a denial state; an unauthenticated visitor gets the full owner UI |

**Where it misleads:** an anonymous or unverified visitor sees a complete, inviting activation flow whose every button will fail; the `return null` at `:252-256` is a blank page with no explanation; and the guidance events give the impression the funnel is instrumented when nothing receives them.

## 13. Roadmap

1. **Confirm the guard-ordering finding with a live request, then fix tenancy at the source** — take `restaurantId` from `@CurrentUser` in `menus.controller.ts:36-43` and `:91-102` instead of the body (the pattern `getVendorEmail` already uses at `:103-109`), and drop it from the DTOs. This both closes the cross-tenant write and makes the page immune to any future `TenantGuard` placement change.
2. Wrap `/get-started` in `ProtectedRoute` (`App.tsx:162`).
3. Surface `query.error` from `useOnboardingProgress` and render a real error state; replace the `return null` at `:252-256` with a spinner.
4. Build the guidance sink — a `POST /signals` the `wineops:guidance` events land in (`guidance/analytics.ts:19-41`). This page already emits; nothing listens. It is the cheapest first win for the tracking mandate, and every other page's §13 "no sink" blocker resolves here.
5. Instrument import method chosen / import success / import failure / threshold set — the four events that would actually explain activation drop-off (§5).
6. Decide whether POS connection joins activation. *Blocked:* founder decision (§6, [TIER-MAP](../03-scenarios/TIER-MAP.md) S14/S15).
7. **An optional configuration step, and a skip that is recorded.** Proposed by [ADR 0113](../decisions/0113-the-assistant-proposes-the-seal-applies.md) from the founder's note of 2026-09-03: *"keep as defaults, but while onboarding they have the option to do that."* Sketch [`101-config-assistant/onboarding-step.html`](../sketches/101-config-assistant/onboarding-step.html) draws it.

   **Where it sits.** In the slot the flow already reserves — after `CellarRegistersOnboarding` (`GetStarted.tsx:256-271`), replacing `ThresholdStep` (`:280-286`) rather than being added beside it. The step is one screen of five short questions, not five screens.

   **What it offers, and the one thing it must not.** Each row is offered only because a write path exists today:

   | Offered | The route that writes it |
   |---|---|
   | low-stock threshold (today's whole step) | `menus.service.ts:707-720` |
   | which drinks registers this house carries | `cellar.controller.ts:32` and its writer |
   | approval ceiling + the role that must sign | `PUT /settings/approval-thresholds` (`settings/settings.controller.ts:107`) |
   | notification channel and quiet hours | `PATCH /notifications/preferences` (`notifications/notifications.controller.ts:159`) |
   | vendor terms for vendors already added | `PUT /vendor-terms/:providerId` (`vendor-terms/vendor-terms.controller.ts:71`) |

   The **market-price drop threshold** is deliberately **not** offered. It is read per deployment from `MARKET_SIGNAL_DROP_PCT` (`notifications/producers/market-price.producer.ts:95-97`, default `0.1` at `market-signal.ts:93`), so there is no per-house value to write. Offering a control that silently writes nowhere is the fault this page's §9 already catalogues; the step names the number, says it is set for every house at once, and moves on.

   **The skip is the actual proposal.** Today `ThresholdStep`'s "Skip for now" calls `onDone()` and writes nothing (`components/onboarding/ThresholdStep.tsx:80-81`), and the only state it could touch is `restaurants.threshold_configured boolean DEFAULT false NOT NULL` (`20260805000000_baseline_from_production.sql:3597`) — `false` for a house that skipped **and** for a house nobody asked. The product cannot tell them apart, which is [[absence-reported-as-health]] at the front door. So: an explicit skip writes one `system_audit_log` row — `action: 'configuration_step_skipped'`, `changes: {register, offered: [...], answered: []}`, **no setting changed**. Then `/settings` can render *"offered on 4 September, skipped"* instead of sharing an em dash with a register nobody ever mentioned, and the assistant of ADR 0113 can re-offer it truthfully later. No migration: `system_audit_log` and its `changes jsonb` are in the baseline (`:5553-5568`), and `SettingsAuditService.record` is already exported from `SettingsAuditModule`.

   *Outside this page's paths:* the step needs the role gate ADR 0113 rule 2 makes a precondition — `PUT /settings/approval-thresholds` carries `@UseGuards(JwtAuthGuard, TenantGuard)` and no role decorator (`settings/settings.controller.ts:40,107`) while `@Roles()`/`RolesGuard` exist and are used on two other controllers. Filed in `settings.md` §13.31, not built here.
