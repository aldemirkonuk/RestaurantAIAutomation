---
type: page
route: /onboarding
slug: onboarding
softwares: [auth-onboarding]
component: apps/web/src/pages/Onboarding.tsx
audience: owner
tier: core
archetype: focused # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 2
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[get-started]]", "[[dashboard]]"]
---

# /onboarding

> **Part of** [[08-softwares/auth-onboarding|Auth & Onboarding]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- Auto-redirect (menu not yet uploaded) → [[get-started]] `/get-started`
- **Go to Dashboard →** → [[dashboard]] `/`
- **Set up my wine list** → [[get-started]] `/get-started`

## 1. Purpose
**A tombstone, not a wizard.** The old 9-step onboarding was retired; this page says "Setup has moved — your checklist lives on the dashboard. Connect POS under Settings → Integrations" (`Onboarding.tsx:20-21`) and offers Go to Dashboard / Set up my wine list. Users with no menu uploaded are auto-forwarded to `/get-started` (`Onboarding.tsx:11-16`), so only already-activated users ever see the card.

## 1a. Features
- A "Setup has moved" card: your checklist lives on the dashboard; POS connects under Settings → Integrations
- Buttons: Go to Dashboard / Set up my wine list
- Users with no menu are auto-forwarded to `/get-started` before seeing any of this

## 2. Entry
Kept for old links/bookmarks. [PAGE_MAP](../foundation/PAGE_MAP.md) records outbound edges only (`n_onboarding --> n_root`, `--> n_get_started`); no live in-app link navigates here (grep of `apps/web/src`).

## 3. Files
- Route binding: `apps/web/src/App.tsx:163` (lazy, `App.tsx:102`)
- `apps/web/src/pages/Onboarding.tsx` (37 lines) — re-exports `OnboardingProvider`/`useOnboarding`/`ONBOARDING_STEPS` for import compatibility (`Onboarding.tsx:34-36`)
- Legacy scaffolding: `apps/web/src/contexts/OnboardingContext.tsx` (485 lines) — the full old wizard state machine, including the 9 steps (`OnboardingContext.tsx:125-135`)
- Hook: `apps/web/src/hooks/queries/useOnboardingProgress.ts`

## 4. Endpoints
| Method | Path | Where called | Atlas |
|---|---|---|---|
| GET | `/onboarding/progress` | `useOnboardingProgress` → `services/api/menus.ts:113` | ENDPOINTS.md:286 (atlas lists under `menus/menus`; controller is `@Controller("onboarding")`, `menus.controller.ts:68`) |

Dead (defined, never called): `POST ${orchestratorUrl}/api/v1/onboarding/complete` (`OnboardingContext.tsx:391`) — see §9.

## 5. Signals
**none.**

## 6. Tier cut
Core. The POS-provider question the founder flagged lives here in fossil form: `POSIntegration.provider: 'square' | 'toast' | 'clover' | 'lightspeed' | 'other' | 'none'` (`OnboardingContext.tsx:95`) — but the *live* path defers POS entirely to Settings → Integrations (`Onboarding.tsx:21`). That matters for tiering: POS connection is the unlock for most ⛔ cells in [TIER-MAP](../03-scenarios/TIER-MAP.md) (S14 is the gateway scenario; "429/573 insight types need `checks`", TIER-MAP S15 row). Today no onboarding surface asks the POS question — the tier unlock has no funnel step.

## 7. Rebrand surface
- `AuthShell.tsx:64` — footer `© 2026 WineOps AI.` · `BrandMark.tsx:17` — alt `WineOps`
- Legacy, currently unrendered: "Get started with WineOps" (`OnboardingContext.tsx:126`), localStorage keys `wineops_onboarding_progress` / `wineops_restaurant_id` / `wineops_onboarding_complete` (`OnboardingContext.tsx:218,412,432`)

## 8. State & config
- Legacy context reads `process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || process.env.REACT_APP_ORCHESTRATOR_URL` (`OnboardingContext.tsx:362-363`) — **wrong env system for a Vite SPA** (`vite.config.ts` has no `define` for these); would throw `process is not defined` if ever executed. It never is (see §9).

## 9. Gaps
- **`OnboardingProvider` is mounted nowhere** and `useOnboarding`/`completeOnboarding` have zero callers outside the context file (grep of `apps/web/src`). ~450 lines of dead wizard state machine kept alive by two re-export lines. Candidate for retire-to-write (§4 of CLAUDE.md) once the type re-exports are inlined.
- The dead orchestrator POST (`OnboardingContext.tsx:391`) and its Next.js-style env vars would both fail if resurrected — do not treat the old wizard as a working fallback.

---

## 10. Maturity

**partial.** A tombstone that mostly works, plus ~450 lines of dead machinery and one misroute.

What works: the redirect and the two buttons are the whole page and they do what they say (`Onboarding.tsx:11-30`).

What is wrong:
- **The route is public.** `App.tsx:163` sits inside the `{/* Public Routes */}` block (`:148`) with no `ProtectedRoute` wrapper. An anonymous visitor's `GET /onboarding/progress` 401s (`menus.controller.ts:68-69`), `progress` stays `null`, so `!progress?.menu_uploaded` is true and they are forwarded to [[get-started]] — also public (`App.tsx:162`) — where nothing will load either. The redirect cannot tell "no menu yet" from "not signed in".
- **Same misroute for every invitee.** `POST /auth/join` never creates a `user_onboarding_progress` row (absent from `auth.service.ts:1138-1251`; Path B seeds one at `:634-642`), so `getOnboardingProgress` throws 404 (`menus.service.ts:655-658`) → `null` → redirect, for a user who has nothing to set up.
- **The dead wizard is confirmed dead.** `OnboardingProvider` is mounted nowhere and `useOnboarding` has no callers outside its own file; the only thing keeping `contexts/OnboardingContext.tsx` (485 lines) alive is two re-export lines (`Onboarding.tsx:35-36`).

## 11. Data flow

### Calls out

| Method | Path | Auth posture | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `/onboarding/progress` | Bearer (`@UseGuards(JwtAuthGuard)` at class level) | `menus.controller.ts:68-69`, `:76-80` | the user's `user_onboarding_progress` row; **404 when absent** (`menus.service.ts:647-658`), mapped to `null` by `services/api/menus.ts:41-44` |

The hook discards errors entirely — `useOnboardingProgress.ts:7-24` returns only `{progress, isLoading, update, isUpdating}`; `query.error` is never surfaced and there is no `enabled` guard, so it fires unauthenticated. That is why a 401 is indistinguishable from an empty row here.

**Dead call:** `POST ${orchestratorUrl}/api/v1/onboarding/complete` (`OnboardingContext.tsx:391`). Never invoked, and it would throw if it were: the URL comes from `process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || process.env.REACT_APP_ORCHESTRATOR_URL` (`:362-363`), and `process` is not defined in a Vite SPA with no `define` for it.

### Fed by

`user_onboarding_progress` rows, seeded fire-and-forget at Path-B registration (`auth.service.ts:634-642` — a `logger.warn` on failure, no retry) and flipped by `POST /auth/invite` (`team_member_invited`, `:880-889`) and the [[get-started]] flow. `getOnboardingProgress` self-heals `menu_uploaded` from `restaurant_menus` for invitees who join after the owner imported (`menus.service.ts:660-670`). The seed being non-transactional is a finding: a registration whose seed insert fails leaves an owner permanently 404-ing here.

### Writes

**None.** This page only reads and navigates. `updateOnboardingProgress` exists on the hook (`useOnboardingProgress.ts:14-17`) and is not called from this page.

## 12. Design intent

**Should be:** either a redirect stub kept only for old bookmarks, or nothing at all. It should not be the page that decides anything.

| State | Handled? | Evidence |
|---|---|---|
| Empty | conflated with error | `Onboarding.tsx:13` treats `null` as "no menu" |
| Loading | yes | `if (isLoading) return` guards the effect (`:12`) — but the card renders behind it, so the tombstone copy flashes before the redirect |
| Error | **no** | the hook never exposes `query.error` (`useOnboardingProgress.ts:7-24`) |
| Permission-denied | **no** | 401 renders as "no menu uploaded" |

**Where it misleads:** the card says *"Setup has moved — your checklist lives on the dashboard"* (`:20-21`) and is visible for a beat even to users who are about to be bounced elsewhere. And the POS instruction it gives — *"Connect POS under Settings → Integrations"* — is the only place in the entire funnel that mentions POS at all (see §6), which means the tier unlock is a sentence on a page nobody is routed to.

## 13. Roadmap

1. Gate the route behind `ProtectedRoute`, or handle the unauthenticated case explicitly (`App.tsx:163`).
2. Surface `query.error` from `useOnboardingProgress` (`useOnboardingProgress.ts:7-24`) so 401 and 404 stop being the same thing here and on [[get-started]].
3. Seed `user_onboarding_progress` in `joinViaInvite` (`auth.service.ts:1138-1251`), matching `:634-642`.
4. Retire `contexts/OnboardingContext.tsx` — inline the three re-exported types (`Onboarding.tsx:35-36`) and delete the rest, including the dead orchestrator POST and its Next.js-style env vars (`:362-363,391`). Retire-to-write, CLAUDE.md §4.
5. Decide whether the POS question belongs in the funnel at all. *Blocked:* founder decision, and it is the gateway to most Plus/Pro cells in [TIER-MAP](../03-scenarios/TIER-MAP.md) — see §6.
6. **The onboarding question the founder DID ask for landed on [[register]], not here** (2026-09-05, ADR 0117 Q25). *"ask each house in onboarding"* about its currency became a step in the sign-up form's Location section, because that is where the address it defaults from is entered and because this page is a tombstone that no live link reaches (§2, §9). If §13.4 ever revives a real wizard, the currency step is a component already — `apps/web/src/components/onboarding/CurrencyStep.tsx` — and moves without being rewritten.
