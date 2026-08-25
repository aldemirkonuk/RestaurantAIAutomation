---
type: page
route: /help
slug: help
component: apps/web/src/pages/Help.tsx
audience: owner
tier: core
signals_today: partial
rebrand_strings: 4
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[privacy]]", "[[sommelier]]", "[[services]]"]
---

# /help — Help & Support

## 1. Purpose
Recovery hub: support channels (email + Slack), 4 FAQ stubs, and jump-off cards to
Learn/tours, the Get Started guide, Services & permissions, and the Wine Agent
(`Help.tsx:41-44` — "recovery entry for Learn, Get Started, Services, Wine Agent,
plus P0 support channels").

## 2. Entry
Sidebar bottom nav (`components/layout/Sidebar.tsx:180`); Settings links here
(`PAGE_MAP.md:97`). Outbound: get-started, profile, settings, sommelier
(`PAGE_MAP.md:70-73`).

## 3. Files
- Route: `apps/web/src/App.tsx:287` → `pages/Help.tsx` (195 lines, self-contained)
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
- "Wine Agent" card deliberately routes to `/sommelier`, not `/wineagent` — with an
  in-code admission the route is a placeholder (`Help.tsx:174-176`); the sidebar still
  offers the placeholder (see [[wineagent-alias]] §9).
- FAQ answer says team invites live at "Settings → Team" (`Help.tsx:25`) — verify
  against the actual Settings tabs when that page doc is written.
- §5's dead-ended events are one bootstrap (dataLayer or a collector for
  `wineops:guidance`) away from being the app's first real page telemetry.
