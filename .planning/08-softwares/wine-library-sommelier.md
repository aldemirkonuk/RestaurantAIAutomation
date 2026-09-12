---
type: software
slug: wine-library-sommelier
name: Wine Library & Sommelier
division: sommelier
status: hollow
tier: core
routes: ["/wines", "/sommelier"]
pages: [wines, sommelier]
api_modules: [wines]
agents: [sommelier_agent, menu_analyzer_agent]
owner_unit: ""
gap_reason: "Four units hold a slice each — catalogue-identity, agent-fleet, corpora-enrichment, taste-fingerprint — and every one disclaims the product"
updated: 2026-09-01
links: ["[[wines]]", "[[sommelier]]", "[[wine-studio]]", "[[catalogue-identity-charter]]", "[[SOFTWARE-MAP]]"]
---

# Wine Library & Sommelier

## §0 What it is

The wine half of the product: a catalogue of roughly five hundred wines you can browse,
filter and price against your own stock, and a chat window where you ask a sommelier what
pairs with the special or which bottle to reorder. It is the thing a restaurant would
point at if asked what makes Mudavym a *wine* company rather than a stock-counting one.

Read it and it is real. Act on it and, today, mostly nothing happens.

## §1 Features today

- Search the master wine catalogue as your restaurant sees it — 9 filters, a sort cycle,
  three view modes, ~500 wines
- Sort columns and select in bulk
- Overlay your own stock onto the catalogue
- Receive live wine updates over WebSocket
- Add a catalogue wine into inventory
- Read vendor recommendations for a selected wine
- Add wines manually, or by scanning a menu photo
- Pick one of three chat personas — Sommelier / Buyer / Floor training, persisted per device
- Chat with wine context attached (your first 50 wines travel with the question)
- Keep conversations per user; "Ask AI" from another page prefills a prompt here
- Compare list price against market price — *dark*: renders "—" for every wine, because
  the column's only writer is an undeployed Celery task
- Order a wine from the library — *broken*: reports "✅ Order created" and writes nothing
- Save a wine as a recurring order — *broken*: it is component state, lost on reload
- Export the catalogue — *broken*: ships six fabricated attribute columns as fact
- Get a model-generated answer in the chat — *broken*: the endpoint has no server, so
  every message falls through to a client-side rules bot

## §2 Screens

- [[wines]] (`/wines`, `App.tsx:289`) — the catalogue. `WineLibrary.tsx`, the larger of
  the two surfaces.
- [[sommelier]] (`/sommelier`, `App.tsx:331`) — the chat. `SommelierAI.tsx`, 721 lines.

`/sommelier` is the terminus for every "Wine Agent" affordance in the product. The
`/wine-agent` and `/wineagent` placeholder routes are **retired** — *"both rendered the
same under-construction placeholder with no behaviour behind it. Everything that said
'Wine Agent' in the UI already navigated to `/sommelier`"* (`App.tsx:326-330`,
[ADR 0019](../decisions/0019-p2-build-scope.md) §B). Both old URLs now fall to the `*`
catch-all, and their page dossiers were deleted under retire-to-write — recorded at
[[RETIRED]] (`.planning/06-pages/RETIRED.md:5,19-27`, dated 2026-08-26). The sidebar row is
gone; the FAB, the Help card and the Learn panel all now land here — so the concept's
entire surface area resolves to a page whose backend is missing (`sommelier.md:120-126`).

## §3 Backend

`apps/api-gateway/src/wines/` — 10 endpoints, `@Controller("wines")` at
`wines.controller.ts:30`. It is a clean single-domain module.

| Endpoint | Controller |
|---|---|
| `GET /wines` | `wines.controller.ts:38` |
| `GET /wines/meta/categories` · `meta/regions` · `meta/countries` | `:52`, `:57`, `:62` |
| `GET /wines/suggestions` | `:67` |
| `GET /wines/:wineId/similar` · `GET /wines/:wineId` | `:72`, `:80` |
| `POST /wines/submissions` · `GET /wines/submissions/list` · `POST /wines/submissions/process` | `:89`, `:102`, `:111` |

**The chat has no module at all.** `SommelierAI.tsx:172-186` posts to
`{VITE_AGENT_ORCHESTRATOR_URL}/api/v1/sommelier/chat`. No such route exists: the
orchestrator's mounted routers are enumerated at `services/agent-orchestrator/main.py:151-186`
(onboarding, quality, research, preview, analytics, studio, pos, health, procurement,
synth) and none defines `/chat`. The gateway has no sommelier module either — only the
`enable_sommelier_ai` feature flag (`settings/dto/feature-flags.dto.ts:34`).

**Seam to name:** the three `submissions` endpoints share
`master_wine_library_submissions` with [[wine-studio]], which writes the same table from
FastAPI. One table, two runtimes, two write paths.

## §4 Automation

Two agents exist behind this software. **Neither is reached.**

- `services/agent-orchestrator/agents/sommelier_agent.py` (799 lines) — registered
  (`core/orchestrator.py:191`, `core/agent_registry.py:150`), subscribed to
  `sommelier.wine_query` and `sommelier.pairing_request`
  (`sommelier_agent.py:118-120`). Grepping both routing keys across `apps/` and
  `services/` returns **only the subscription itself** — nothing publishes them. The brain
  exists; nothing connects the page to it. That is a wiring gap, not a build-from-scratch.
- `services/agent-orchestrator/agents/menu_analyzer_agent.py` (952 lines) — registered
  (`core/orchestrator.py:192`, `agent_registry.py:156`), subscribed to
  `menu.scan_request`, `menu.text_extraction_request`, `menu.wine_lookup_request`
  (`:418-423`). Exactly one publisher exists — a Celery task at
  `services/agent-orchestrator/jobs/tasks.py:60` — and the Celery worker is not deployed
  (the same undeployed worker that leaves Market Price blank, `v3.0-TECH-DEBT.md:432-440`).

No `@Cron` in the gateway module.

## §5 Data

Verified from `.from("…")` in `apps/api-gateway/src/wines/`:

- `master_wine_library` — 18 references
- `master_wine_library_submissions` — 16 references

Both created in `supabase/migrations/20260805000000_baseline_from_production.sql`.

It **owns neither cleanly.** `master_wine_library`'s identity semantics — match keys,
duplicate detection, merge and un-merge — belong to [[catalogue-identity-charter]] and
live in their own migrations (`…20260812000000_backfill_wine_match_keys.sql`,
`…20260813030000_merge_library_wines.sql`, `…20260817120000_nondestructive_merge.sql`).
`master_wine_library_submissions` is co-written by [[wine-studio]]. This module is the
*read surface* over a corpus three other units shape.

`retail_price_avg` is listed nowhere below because nothing writes it: it is a real column
with an undeployed producer, which is why Market Price renders "—".

## §6 Owner

`unowned — gap.` Add the row to [[SOFTWARE-MAP]]'s gap table.

Resolved rather than guessed. No charter under `.planning/01-org/**/teams/` names
`apps/api-gateway/src/wines`, `SommelierAI.tsx` or `WineLibrary.tsx` in a boundaries
section. The four nearest units each hold a *slice* and each disclaims the product:

- [[catalogue-identity-charter]] owns *"what a beverage or dish **is** — match keys,
  duplicate detection, merge and un-merge, producer normalization"*
  (`catalogue-identity-charter.md:19-21`) and explicitly hands off *"Agents that reason
  over the catalogue"* to [[agent-fleet-charter]] and *"Enriching the corpus"* to
  corpora-enrichment (`:52-55`). Identity, not product.
- [[agent-fleet-charter]] owns `services/agent-orchestrator/agents/` and lists
  `menu_analyzer_agent` and `sommelier_agent` among live agents (`:87-88`) — but it owns
  *behavior*, not the screens or the gateway module.
- [[ask-ai-charter]] treats `/sommelier` as one of four divergent AI entry points it must
  unify (`ask-ai-charter.md:117`) while explicitly disclaiming route ownership:
  *"Where Ask AI lives as a route → [[surface-portfolio-charter]]"* (`:61`).
- [[surface-portfolio-charter]] owns a *verdict per route* — keep / merge / kill /
  make-reachable (`:19-22`) — which decides whether the route survives, not what it does.

No team in the 79-team roster is a wine, beverage or sommelier product team. The company's
flagship domain surface has four part-owners and no owner.

## §7 Maturity & seams

**hollow**, rolled up from two `hollow` page notes — and hollow in the contract's precise
sense: the reads are genuine, and the actions report success for writes that do not land.

**[[wines]]** (`wines.md:99-114`). Browsing is real: `/wines` search over
`master_wine_library` with an inventory overlay and a live WebSocket subscription
(`wines.controller.ts:38`, `wines.service.ts:489`, `WineLibrary.tsx:48`). The two headline
actions are not.

- *"✅ Order created"* — `handlePlaceOrder` writes a plain object into a Zustand store and
  navigates; there is no POST anywhere in the handler (`WineLibrary.tsx:313-382`, alert at
  `:360-368`). The alert asserts *"The AI will contact the selected provider(s) via
  Plivo"* — Plivo is a real integration, belongs to `communications`, is not called by this
  flow, and mocks itself when unconfigured (`communications/sms.service.ts:23-37`).
- *"Save as recurring order"* is a bare `useState` map, lost on navigation, while a real
  `recurring-orders` module sits untouched (`WineLibrary.tsx:140,320-332`;
  `procurement/recurring-orders.controller.ts:36`).
- **Fabricated attributes are exported as data.** `mapApiWineToUiWine` hardcodes
  `body:'medium'`, `sweetness:'dry'`, `acidity:'medium'`, `alcohol:0`, empty aromas and
  flavors for *every* wine (`lib/wine-library.ts:32-37`), and the export ships exactly those
  as columns (`WineLibrary.tsx:459-464`). A 500-row CSV where every wine is medium-bodied,
  dry and 0% ABV leaves the product looking like a dataset.
- Enrichment arrives on the wire and is discarded — `description`, `tastingNotes`,
  `pairingNotes`, `imageUrl` are on the API type and unmapped (`services/api/types.ts:324-328`).

**[[sommelier]]** (`sommelier.md:96-126`). *A 721-line chat product with no chat backend.*
Everything around the model call is real; the model call is not. Every message takes the
catch branch (`SommelierAI.tsx:188-241`) — the code says so at `:171-172`: *"This endpoint
may not exist yet, so we'll handle gracefully."* What ships is a client-side rules bot: a
message containing "low", "stock" or "reorder" (`:194`) renders a markdown low-stock report
from `useWines` data; anything else returns "currently unavailable". Secondary: the request
carries no `Authorization` header (`:180-183`), so if the route is ever built it will be
built against a caller that does not authenticate.

Seams:

1. **Two runtimes, no bridge.** The gateway serves the catalogue; the two agents live in
   Python behind RabbitMQ with zero publishers. This is ECOSYSTEM-PLAN §4.2's two-runtime
   split showing up as a product that cannot reach its own brain.
2. **`master_wine_library_submissions` has two writers** — this module and
   [[wine-studio]]'s FastAPI routes — with no shared contract between them.
3. **Four part-owners** (§6). Identity, agents, entry point and route verdict are each
   someone's; the product is nobody's, which is why the fabricated-attribute defect has
   survived: it is a *corpus* defect surfacing on a *surface*, and neither owner is
   accountable for the pair.

**Taxonomy finding — ADR 0049 §3a names a page that does not exist.**
`.planning/04-specs/ECOSYSTEM-PLAN.md:57` gives the Sommelier division's pages as
**`sommelier`, `wine-agent`** (parenthetically *"`SommelierAI.tsx`, `WineLibrary.tsx`"*).
On origin/main there is **no `wine-agent` page note** — `.planning/06-pages/` holds
`sommelier.md` and `wines.md`, and no `wine-agent.md`. The row is wrong twice, and both
halves are confirmed: the dossier was **deleted** under retire-to-write, with
[[RETIRED]]`:5` listing `06-pages/wine-agent.md` in its `supersedes` and `:19-20`
recording the retirement on 2026-08-26; and the route it names was retired by ADR 0019 §B
(`App.tsx:326-330`), so §3a cites a page note and a route that both stopped existing before
the ADR was written. The parenthetical is the accurate half — `WineLibrary.tsx` is the
second surface, and its page note is `wines`. **The live pair is `sommelier` + `wines`, and
§3a is being amended;** recorded here rather than patched in place, because amending a
locked ADR is a decision, not a docs fix.

## §8 Where it's going

- ADR 0049 §3a puts this in the **Sommelier** division, spine hops 9–10, phases **E2**
  (honest intelligence) and **E4** (the wine → beverages expansion)
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:57`).
- E2's first item here is the smallest and the largest: publish `sommelier.wine_query` and
  the chat has a brain. The agent is already registered and subscribed.
- The fabricated-attribute mapper is a correctness defect, not a feature gap — it is
  shipping wrong data under real column headings today.
- §3a's page list needs an ADR-level correction (§7), and the ownership gap (§6) needs a
  team before either of the above has an accountable home.
