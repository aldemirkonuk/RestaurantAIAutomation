---
type: page
route: /help
slug: help
component: apps/web/src/pages/Help.tsx
audience: owner
tier: core
archetype: document # proposed 2026-08-26 (OD-79)
signals_today: partial
rebrand_strings: 4
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[privacy]]", "[[sommelier]]", "[[services]]", "[[get-started]]", "[[settings]]", "[[profile]]"]
---

# /help — Help & Support

## Surface — buttons → where they go

- **Email support** → external `mailto:` (support address)
- **Slack** → external — WineOps support Slack workspace
- **Open app guide** → [[get-started]] `/get-started?tab=use`
- **Manage services** → [[settings]] `/settings?tab=services`
- **Open Wine Agent** → [[sommelier]] `/sommelier` (`/wineagent` is still a placeholder)
- **Profile link (footer)** → [[profile]] `/profile`

## 1. Purpose
Recovery hub: support channels (email + Slack), 4 FAQ stubs, and jump-off cards to
Learn/tours, the Get Started guide, Services & permissions, and the Wine Agent
(`Help.tsx:41-44` — "recovery entry for Learn, Get Started, Services, Wine Agent,
plus P0 support channels").

## 1a. Features
- Contact support: email and Slack channel links
- FAQ accordion (4 entries today)
- Jump-off cards: Learn/tours, the Get Started guide, Services & permissions, the Wine Agent

## 2. Entry
Sidebar bottom nav (`components/layout/Sidebar.tsx:176-180`); Settings links here
(`PAGE_MAP.md:97`). Outbound: get-started, profile, settings, sommelier
(`PAGE_MAP.md:70-73`).

## 3. Files
- Route: `apps/web/src/App.tsx:285` → `pages/Help.tsx` (195 lines, self-contained)
- `guidance/analytics.ts` (trackGuidance)

## 4. Endpoints
none — static page; `mailto:` and external Slack `href` only (`Help.tsx:61,71`).

## 5. Signals — partial, and going nowhere
The only page in this batch that emits anything: `trackGuidance` on the three action
buttons — `guide_card_clicked` (`Help.tsx:133`), `services_visited` (`:153`),
`wine_agent_fab_clicked` (`:173`). But `trackGuidance` (`guidance/analytics.ts:20-41`)
only console-logs in dev, pushes to `window.dataLayer` — **which nothing in the repo
ever creates** (grep `dataLayer` outside `analytics.ts`: zero hits) — and dispatches a
`wineops:guidance` CustomEvent with no listener. Emitted, never collected.

## 6. Tier cut
Core — support surface for every tier; no S.. scenario routes through it.

## 7. Rebrand surface
4 user-visible occurrences (plus 1 config URL):
- `Help.tsx:18` — default support email `support@wineops.ai`, rendered as visible text at `:67`
- `Help.tsx:20` — default Slack URL `https://wineops.slack.com` (link target, `:71`)
- `Help.tsx:36` — FAQ: "How do I get help from the **WineOps** team?"
- `Help.tsx:79` — "Join the **WineOps** support channel"
(Also non-visible: the `wineops:guidance` event name, `guidance/analytics.ts:38`.)

## 8. State & config
- `VITE_SUPPORT_EMAIL` (default `support@wineops.ai`) and `VITE_SUPPORT_SLACK_URL`
  (default `https://wineops.slack.com`) — `Help.tsx:18-20`
- Local `openFaq` accordion state only

## 9. Gaps
- Support defaults are **wineops-branded and unverified destinations** — if the env
  vars are unset in prod, the P0 support channel mails a wineops.ai address.
- ~~"Wine Agent" card routes to `/sommelier`, not `/wineagent`; the sidebar still
  offers the placeholder.~~ **Closed 2026-08-26** — `/wine-agent` and `/wineagent`
  are retired (ADR 0019 §B) and the sidebar item is gone. The card's `/sommelier`
  target was always the right one and is unchanged (`Help.tsx:174-176`).
- ~~FAQ answer says team invites live at "Settings → Team" — verify~~ — **verified
  correct**: `SECTION_IDS` in `pages/Settings.tsx:82` includes `'team'`, labelled `Team`
  at `:85`, deep-linkable via `?tab=team` (`:721,744`).
- §5's dead-ended events are one bootstrap (dataLayer or a collector for
  `wineops:guidance`) away from being the app's first real page telemetry.

---

## 10. Maturity — **partial**

Every link on the page works and lands where it says. What is unfinished is on both
edges: the support destinations are unverified defaults, and the telemetry is emitted into
a vacuum.

- **Structurally complete.** Four FAQ accordions (`Help.tsx:22-40`, rendered `:90-95`),
  two contact channels (`:61,71`), three jump-off cards, a Learn/tours explainer
  (`:116-118`) and a Profile footer link. 195 lines, no async work, nothing that can fail
  at runtime.
- **Every destination verified live:** `/get-started?tab=use` (`:134`),
  `/settings?tab=services` (`:154` — `'services'` is in `Settings.tsx:82`),
  `/sommelier` (`:176`). The Wine Agent card's target is now the *only* Wine Agent route:
  `/wine-agent` and `/wineagent` are retired on this branch (`App.tsx:293-299`) and the
  sidebar's Wine Agent row is gone (`components/layout/Sidebar.tsx:146-161`).
- **Support destinations are unverified `wineops.*` defaults.**
  `VITE_SUPPORT_EMAIL || 'support@wineops.ai'` (`:18`) and
  `VITE_SUPPORT_SLACK_URL || 'https://wineops.slack.com'` (`:20`), rendered as the visible
  address (`:67`) and the link target (`:71`). If the env vars are unset in production, the
  P0 support channel is a mailto to a domain the project is migrating away from — and the
  page displays that address to the user as fact.
- **The signals go nowhere.** This is the only page in this batch that emits anything:
  `guide_card_clicked` (`:133`), `services_visited` (`:153`), `wine_agent_fab_clicked`
  (`:173`). `trackGuidance` (`guidance/analytics.ts:19-41`) does three things: `console.debug`
  in DEV only (`:25-27`); `window.dataLayer?.push` — **nothing in the repo ever creates
  `dataLayer`**, the only two mentions are inside `analytics.ts` itself (`:2,30`), and the
  optional-chain means the push is a silent no-op; and a `wineops:guidance` CustomEvent
  (`:37`) with **zero listeners** anywhere in `apps/web/src` or `apps/api-gateway/src`.
  `signals_today: partial` is generous — the instrumentation exists and collects nothing.
- The Wine Agent card links to a page whose backend does not exist
  (see [[sommelier]] §10), so the recovery hub's most prominent AI affordance recovers
  the user into a rules bot.

## 11. Data flow

**Calls out**

**None.** Zero API calls — grep `Help.tsx` for fetch/axios/apiClient: nothing. The only
outbound requests are user-initiated: `mailto:` (`:61`) and the external Slack workspace
(`:71`). Correct for a static support page; also means it has no failure mode.

**Fed by**

| Source | Where | Note |
|---|---|---|
| Build-time env vars | `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_SLACK_URL` (`:18-20`) | Baked into the bundle at build time — changing support contact needs a redeploy, not a config toggle |
| Hard-coded `FAQS` array | `:22-40` | Four entries, in source. No CMS, no DB, no per-tenant variation |

Nothing dynamic reaches this page — no ticket count, no incident banner, no per-restaurant
support tier. A support page fed by nothing is defensible at this stage; worth naming.

**Writes**

- **Nothing persisted.** Three `trackGuidance` calls that reach no sink (§10); local
  `openFaq` accordion state (`:47`).
- Downstream: nothing reacts. The `wineops:guidance` CustomEvent (`analytics.ts:37`) is
  dispatched onto `window` with no listener registered anywhere.

## 12. Design intent

**Should be:** the page you reach when something has gone wrong or you are lost — one
obvious way to reach a human, and one obvious way back into the product's own guidance.
It should also be the app's cheapest source of truth about where users get stuck, which is
exactly what the three events were meant to provide.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **n/a** — static content, nothing to be empty of |
| Loading | **n/a** — no async work |
| Error | **n/a** — nothing can fail; the honest risk is a *wrong* destination, not a failed one |
| Permission-denied | **n/a** — plain `ProtectedRoute` (`App.tsx:285`), reachable by every authenticated role, which is right for a support page |

**Where the UI misleads**

1. **A support address the project may not own.** `support@wineops.ai` is rendered as
   visible text (`:67`), not just a link target — a user will copy it into their own mail
   client. Unlike a dead button, this failure is invisible to us and to them.
2. **"Join the WineOps support channel"** (`:79`) pointing at
   `https://wineops.slack.com` (`:20`) — same class of problem, and it is a link a user
   may request access to.
3. **Three tracked interactions that look instrumented and are not** (§10). This is the
   contract's *hollow* pattern applied to telemetry rather than to data.
4. **"Open Wine Agent"** (`:173-176`) promises an agent; the destination is
   [[sommelier]], whose chat backend is unregistered.

## 13. Roadmap

1. **Set `VITE_SUPPORT_EMAIL` and `VITE_SUPPORT_SLACK_URL` in the production
   environment**, or change the defaults to something the project controls (`:18-20`).
   A P0 support channel pointing at an unowned domain is the highest-severity item on this
   page and the cheapest to fix.
2. **Give `trackGuidance` a sink.** Either bootstrap `dataLayer` or register a collector
   for the `wineops:guidance` CustomEvent (`analytics.ts:29-40`) that forwards to the
   gateway. Twelve event types are already emitted app-wide (`analytics.ts:5-17`) — this
   single bootstrap turns the whole guidance system into the app's first real page
   telemetry, and it is the shared blocker behind [[vendor-public-page]] §13.4.
   *Blocked: needs a decision on the analytics destination — GTM, the gateway's own
   `neural_footprint_event` table, or both.*
3. **Rebrand the four visible `WineOps` strings** (`:36,67,79` and the default at `:18`),
   sequenced with #1 so the address and the copy change together.
4. Relabel or re-point the Wine Agent card once [[sommelier]] has a backend, so "Open Wine
   Agent" stops overpromising (`:173-176`).
5. Move `FAQS` (`:22-40`) somewhere editable without a deploy, once there are more than
   four.
