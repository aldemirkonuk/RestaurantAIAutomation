---
type: page
route: /sommelier
slug: sommelier
component: apps/web/src/pages/SommelierAI.tsx
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[wineagent-alias]]", "[[wines]]"]
---

# /sommelier — Sommelier AI chat

## 1. Purpose
Chat assistant for pairings, pricing, reorders and staff coaching, with three personas
(Sommelier / Buyer / Floor training — `SommelierAI.tsx:77-81`). It is also the de-facto
"Wine Agent": every Wine Agent launcher redirects here.

## 2. Entry
- Sidebar `aiNavItems` (`components/layout/Sidebar.tsx:153`); PAGE_MAP in-degree 1
  (`PAGE_MAP.md:150`)
- Help page "Open Wine Agent" button (`pages/Help.tsx:176`)
- Wine Agent FAB (`guidance/components/WineAgentFab.tsx:39`)
- Ask-AI re-entry from other pages: `navigate('/sommelier', { state: { prompt } })`
  prefills without auto-sending (`SommelierAI.tsx:140-151`)

## 3. Files
- Route: `apps/web/src/App.tsx:292`
- Component: `apps/web/src/pages/SommelierAI.tsx` (721 lines, self-contained)
- Persistence hooks: `apps/web/src/hooks/queries/useSommelierQueries.ts`

## 4. Endpoints
- `POST {VITE_AGENT_ORCHESTRATOR_URL}/api/v1/sommelier/chat` — direct axios to the
  Python orchestrator (`SommelierAI.tsx:172-186`), payload includes `wine_context`
  (first 50 wines: id/name/type/stock/threshold/prices, `SommelierAI.tsx:159-168`) and
  `persona`. **This route is not registered server-side** — no sommelier router in
  `services/agent-orchestrator/main.py:130-165` (grep `sommelier/chat` in the
  orchestrator: zero hits). Not in ENDPOINTS.md (gateway atlas) either.
- Supabase direct from the browser: `sommelier_conversations` table — select/upsert/
  delete (`useSommelierQueries.ts:22-56`). Bypasses the gateway entirely.
- `GET /wines` (`limit: 500`) via `useWines` (`SommelierAI.tsx:129`)

## 5. Signals
none. Per-message thumbs up/down is component state only (`SommelierAI.tsx:106,642-649`)
— never persisted or sent anywhere; a feedback loop that looks instrumented and isn't.

## 6. Tier cut
Core surface, but **no S.. scenario in [TIER-MAP](../03-scenarios/TIER-MAP.md) routes
through it** — it sits beside the scenario library, not in it. Nearest: S10 (its
low-stock fallback answer) and S06 (wine catalogue context).

## 7. Rebrand surface
none user-visible. (`wineops.sommelier.model` is a localStorage key, `SommelierAI.tsx:82`
— see §8.)

## 8. State & config
- `VITE_AGENT_ORCHESTRATOR_URL` (default `http://localhost:8000`, `SommelierAI.tsx:155`)
- localStorage: `wineops.sommelier.model` persona (`:82,96-100`)
- Conversations keyed to `userId` from auth store; not persisted when logged-out (`:244-245`)

## 9. Gaps
- **The chat backend does not exist**: with `/api/v1/sommelier/chat` unregistered, every
  message takes the catch path (`SommelierAI.tsx:189-241`) — a canned low-stock answer
  computed client-side if the message mentions stock, otherwise "currently unavailable".
  The page's honest state is a local rules bot with an unshipped brain.
- `v3.0-TECH-DEBT.md:391-392` ("model selector decorative, Copy/ThumbsUp/Regenerate
  dead") is **partly stale**: the persona is now sent in the request (`:178`) and Copy
  works; thumbs feedback is still dead (§5).
- Wine context caps at 50 wines (`:159`) — silently partial for larger cellars.
