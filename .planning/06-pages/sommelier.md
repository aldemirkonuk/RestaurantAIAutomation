---
type: page
route: /sommelier
slug: sommelier
component: apps/web/src/pages/SommelierAI.tsx
audience: owner
tier: core
archetype: chat # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[help]]", "[[wines]]"]
---

# /sommelier — Sommelier AI chat

## Surface — buttons → where they go

- **Send** → API `POST {agent-orchestrator}/api/v1/sommelier/chat`
- **New Chat / persona picker / rename / delete** → (in-page state only)
- (no page-to-page links — dead-end in the page graph)

## 1. Purpose
Chat assistant for pairings, pricing, reorders and staff coaching, with three personas
(Sommelier / Buyer / Floor training — `SommelierAI.tsx:77-81`). It is also the de-facto
"Wine Agent": every Wine Agent launcher redirects here.

## 1a. Features
- Chat about pairings, pricing, reorders and staff coaching
- Three personas: Sommelier / Buyer / Floor training (persisted per device)
- Answers are wine-context aware (your first 50 wines are sent along)
- Conversations persist per user; "Ask AI" from other pages prefills a prompt here
- 🚧 The chat backend route is unregistered — today every message falls back to a local rules answer (§9)

## 2. Entry
- Sidebar `aiNavItems` — now the **only** AI nav row (`components/layout/Sidebar.tsx:154-160`;
  the Wine Agent row was removed with the retired routes, `:149-153`)
- Help page "Open Wine Agent" button (`pages/Help.tsx:173-176`)
- Wine Agent FAB (`guidance/components/WineAgentFab.tsx:36-40`)
- Learn panel "Wine Agent" action (`guidance/components/LearnPanel.tsx:227-233`)
- Ask-AI re-entry from other pages: `navigate('/sommelier', { state: { prompt } })`
  prefills without auto-sending (`SommelierAI.tsx:140-151`)

## 3. Files
- Route: `apps/web/src/App.tsx:299`
- Component: `apps/web/src/pages/SommelierAI.tsx` (721 lines, self-contained)
- Persistence hooks: `apps/web/src/hooks/queries/useSommelierQueries.ts`

## 4. Endpoints
- `POST {VITE_AGENT_ORCHESTRATOR_URL}/api/v1/sommelier/chat` — direct axios to the
  Python orchestrator (`SommelierAI.tsx:172-186`), payload includes `wine_context`
  (first 50 wines: id/name/type/stock/threshold/prices, `SommelierAI.tsx:159-168`) and
  `persona`, and **no `Authorization` header** (`:180-183`). **This route is not
  registered server-side** — no sommelier router in
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

---

## 10. Maturity — **hollow**

A 721-line chat product with no chat backend. Everything around the model call is real;
the model call is not.

- **The endpoint does not exist.** `POST {VITE_AGENT_ORCHESTRATOR_URL}/api/v1/sommelier/chat`
  (`SommelierAI.tsx:172-186`) has no server. `main.py:130-165` lists every router the
  orchestrator mounts — onboarding, quality, research, preview, analytics, studio, pos,
  health, procurement, synth — and none of them defines a `/chat` route; grepping
  `sommelier/chat` across `services/agent-orchestrator/api/` returns nothing. The gateway
  has no sommelier module either (only the `enable_sommelier_ai` feature flag,
  `apps/api-gateway/src/settings/dto/feature-flags.dto.ts:34`).
- **Every message therefore takes the catch branch** (`SommelierAI.tsx:188-241`). The code
  says so itself at `:171-172`: *"Note: This endpoint may not exist yet, so we'll handle
  gracefully."* What ships is a **client-side rules bot**: if the message contains
  "low", "stock" or "reorder" (`:194`) it renders a markdown low-stock report computed
  from `useWines` data; otherwise it returns "the AI sommelier is currently unavailable".
- There **is** a `sommelier_agent` in the orchestrator (`agents/sommelier_agent.py`,
  registered `core/orchestrator.py:188`, `core/agent_registry.py:150`) — it consumes
  RabbitMQ topics (`sommelier.wine_query`, `sommelier.pairing_request`,
  `agents/sommelier_agent.py:118-120`). The brain exists; nothing connects the page to it.
  This is a wiring gap, not a build-from-scratch.
- Secondary: the request carries **no `Authorization` header** (`:180-183`) — if the route
  is ever built, it will be built against a caller that does not authenticate.
- **This is the destination for every Wine Agent launcher.** The `/wine-agent` and
  `/wineagent` placeholder routes are retired on this branch (`App.tsx:293-299`) and the
  sidebar's "Wine Agent" row is gone (`components/layout/Sidebar.tsx:146-161`), so the
  FAB (`guidance/components/WineAgentFab.tsx:37-39`), the Help card (`pages/Help.tsx:173-176`)
  and the Learn panel (`guidance/components/LearnPanel.tsx:227-233`) all land here. The
  concept's entire surface area now resolves to a page whose backend is missing.

## 11. Data flow

**Calls out**

| Method | Path | Auth | Server | Returns / today |
|---|---|---|---|---|
| POST | `{VITE_AGENT_ORCHESTRATOR_URL}/api/v1/sommelier/chat` | **none** — no header sent (`:180-183`) | **none — route unregistered** (`main.py:130-165`) | Always throws → the local fallback at `:188-241` |
| GET | `/api/v1/wines?limit=500` via `useWines` (`:129`) | Bearer, via the shared API client | gateway `WinesModule` (`app.module.ts:100`) | The catalogue; first 50 become `wine_context` (`:159-168`) and all of it powers the low-stock fallback |
| — | `sommelier_conversations` **direct from the browser** (`hooks/queries/useSommelierQueries.ts:22-58`) | Supabase anon key + user session; **no gateway, no tenant guard** | Supabase | select / upsert / delete keyed on `user_id` |

**Fed by**

- **Nothing produces assistant messages.** The only content generator is the browser:
  `libraryWines.filter(w => w.liveStock <= w.threshold)` (`:195`) rendered into markdown
  (`:207-230`). A page whose data has no producer is a finding — this is the clearest one
  in the cluster.
- Wine data is fed by the normal inventory chain (POS ingestion → `pos_checks` →
  inventory), reaching the page only through `GET /wines`.
- `sommelier_conversations` is fed exclusively by this page's own upserts (`:245-253`,
  `:370`); there is no server-side writer.

**Writes**

- `sommelier_conversations` — title, full message array, `updated_at`
  (`useSommelierQueries.ts:39-53`). Delete is a hard delete (`:55-58`).
- Nothing downstream reacts. No queue, no notification, no ledger.
- `localStorage.wineops.sommelier.model` — the persona (`:82,96-100`).

## 12. Design intent

**Should be:** the one conversational entry to the whole platform — ask about a pairing,
a price, what to reorder, how to coach a server — answered from this restaurant's real
inventory, orders and vendor history, with the answer able to *do* something (draft a PO,
open a recommendation) rather than describe it.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **yes** — suggested-prompt cards on a fresh conversation (`:54,578`) | |
| Loading | **yes** — `isTyping` indicator gates Send and Regenerate (`:653`) | |
| Error | **no, by construction.** The failure path is disguised as an answer (`:188-241`); the user is never told the assistant is unreachable, only that it is "currently unavailable" — inside an assistant message bubble | |
| Permission-denied | **n/a at the route** — `/sommelier` is inside the plain `ProtectedRoute` (`App.tsx:299`), any authenticated user. Logged-out conversations silently do not persist (`:244-245`) | |

**Where the UI misleads**

1. **A rules bot presented as an AI assistant.** The fallback answer is formatted exactly
   like a model response — headings, emoji severity, per-wine suggested order quantities
   (`:207-224`) — with no indication it was computed locally.
2. **It offers actions it cannot take.** The fallback closes with *"I can help you: 1.
   Generate purchase orders… 2. Contact suppliers… 3. Find alternative wines… What would
   you like me to do?"* (`:225-230`). Answering that question produces "currently
   unavailable".
3. **Thumbs up/down is decorative** — `setMsgFeedback` writes to component state only
   (`:106,332`), colouring the icon (`:642,649`) and persisting nowhere. Feedback on a
   page with no model is doubly inert.
4. **Conversation-history errors read as "no history"** — `fetchConversations` catches the
   Supabase error, `console.warn`s and returns `[]` (`useSommelierQueries.ts:32-35`), so
   an RLS denial and an empty account are indistinguishable.
5. **Silent context truncation** at 50 wines (`:159`) — an answer about a 300-bottle
   cellar is drawn from a sixth of it, unlabelled.

## 13. Roadmap

1. **Say the assistant is unreachable when it is.** Replace the disguised catch
   (`:188-241`) with a real error state; keep the low-stock computation but label it as
   the local fallback it is. One change, removes the page's central dishonesty, blocked
   on nothing.
2. **Build `POST /api/v1/sommelier/chat`** on the orchestrator and register it in
   `main.py`, bridging to the existing `SommelierAgent` (`agents/sommelier_agent.py:118-120`).
   Send the Bearer token and authenticate it.
3. **Decide where the sommelier lives.** Direct-to-orchestrator (today's shape) vs a
   gateway module vs the gateway's `ModelClientModule` choke point (`app.module.ts:74`),
   which is where model spend and NF-A emission are already centralised. *Blocked:
   founder decision — and it is the same fork as [[studio]] §13.2, so decide once.*
4. **Persist thumbs feedback**, once there is a model whose output it can rate.
5. **Give the fallback's offered actions somewhere to go** — or delete the offer
   (`:225-230`).
6. Raise or paginate the 50-wine context cap (`:159`), and say when it truncates.
7. Surface conversation-load failures instead of returning `[]`
   (`useSommelierQueries.ts:32-35`).
