---
type: page
route: /onboarding
slug: onboarding
component: apps/web/src/pages/Onboarding.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 2
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[get-started]]", "[[dashboard]]"]
---

# /onboarding

## Surface — buttons → where they go

- Auto-redirect (menu not yet uploaded) → [[get-started]] `/get-started`
- **Go to Dashboard →** → [[dashboard]] `/`
- **Set up my wine list** → [[get-started]] `/get-started`

## 1. Purpose
**A tombstone, not a wizard.** The old 9-step onboarding was retired; this page says "Setup has moved — your checklist lives on the dashboard. Connect POS under Settings → Integrations" (`Onboarding.tsx:20-21`) and offers Go to Dashboard / Set up my wine list. Users with no menu uploaded are auto-forwarded to `/get-started` (`Onboarding.tsx:11-16`), so only already-activated users ever see the card.

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
