---
type: software
slug: app-shell-support
name: App Shell & Support
division: platform-admin
status: partial
tier: core
routes: ["/help", "/privacy", "/credits"]
pages: [help, privacy, credits]
api_modules: []
agents: []
owner_unit: ""
gap_reason: "**By design, not a defect** — a shell/legal/support surface, not a product. Listed so the pages are visibly accounted for"
updated: 2026-09-17
links: ["[[help]]", "[[privacy]]", "[[credits]]", "[[SOFTWARE-CONTRACT]]", "[[SOFTWARE-MAP]]"]
---

# App Shell & Support

## §0 What it is

Not a product. Three pages that any application has to have and that no product owns: how
to get help, what we do with your data, and one old link kept alive so it does not 404.
This note exists because the contract's *"Nothing falls unassigned"* rule is worth more
than a tidy atlas — a page with no natural home gets an explicit thin software rather than
silence (`SOFTWARE-CONTRACT.md:81-83`).

## §1 Features today

- Follow an old `/credits` bookmark to where credits actually live
- Read the privacy notice without an account
- Jump from the notice to the controls it describes (Settings, Profile)
- Read four FAQ entries and jump off to tours, Get Started, services, or the Wine Agent
- Contact support by email or Slack — **unverified**: both fall back to `wineops.*`
  defaults if the env vars are unset (`Help.tsx:18,20`)
- **The crawl surface** ([[0158-machines-read-mudavym-from-what-the-host-serves]],
  2026-09-17) — what the host serves to machines: `robots.txt` (company-specific, split by
  reader purpose), `sitemap.xml` + `sitemap-pages.xml` + `sitemap-vendors-N.xml`, `llms.txt`,
  each public page's head, `noindex` on everything signed-in, a real 404, and the old
  vercel.app host's 308. One registry: `apps/web/src/lib/seo/routes.ts`.

## §2 Screens

- [[help]] — `apps/web/src/App.tsx:319`. 195 lines, no async work, nothing that can fail
  at runtime.
- [[privacy]] — `apps/web/src/App.tsx:168`, **public** by design: it is linked from the
  auth screens, so it must be readable before you have an account (`App.tsx:166-167`).
  130 lines, fully static.
- [[credits]] — a redirect, **confirmed**: `apps/web/src/App.tsx:314` is
  `<Navigate to="/receipts?tab=credits" replace />`. `replace` keeps it out of history, so
  Back does not bounce.

## §3 Backend

`none` for the three pages — static text, a link, or a redirect.

The crawl surface (ADR 0158) has a gateway half, `apps/api-gateway/src/seo/`: the sitemap
index and vendor blocks (XML, CDN-cached through `apps/web/vercel.json` rewrites) and the
`/v/:slug` head payload the web middleware reads. Host rules live in `apps/web/vercel.json`
(the live config for mudavym.com; the repo-root file configures only the second Vercel
project). A deployment is checked with `scripts/crawl_surface_census.py <origin>`.

## §4 Automation

`none (every action is human-initiated)`.

## §5 Data

`none` — no table is read or written by any of the three.

## §6 Owner

The crawl surface: **Technical SEO & AI-answer surface (G4)** — its charter names robots,
sitemap, canonical, `llms.txt`, status codes and structured data
(`technical-seo-ai-answer-surface-charter.md:43-55`). The three pages: `unowned — gap`. Grep over `01-org` finds no charter naming `Help.tsx` or the `/credits`
redirect. One of the three has a partial answer: `legal-charter.md:72,114` routes *the
privacy notice* to **Compliance §3.2**, on the reasoning that *"a notice is a public
statement, not an agreement"* — the department is [[compliance-privacy-charter]], though
which of its three teams §3.2 names is not resolvable from the `01-org` vault alone. That
covers the *content* of one page and nothing else. Gap row for [[SOFTWARE-MAP]].

## §7 Maturity & seams

**partial**, from `partial` ([[help]]) and `complete` on both of the others.

- [[privacy]] is accurate today and spot-checked claim by claim against the code
  (`privacy.md` §10). Its risk is drift, not function: it is a legally-adjacent
  behavioural representation with **no mechanism binding it to the code it describes**, and
  its own header says so. It is also still branded *WineOps* at four strings.
- [[help]]'s destinations all resolve, but its two support channels are unverified
  `wineops.*` defaults — if the env vars are unset in production, the P0 support channel is
  a mailto to a domain the project is migrating away from.
- [[credits]] redirects correctly. Its destination tab is `partial`; that is the
  destination's verdict, not this route's.

The seam worth naming is the one in §6: this is a shell, and shells accumulate. A page
nobody owns gets no verdict, and a legal notice that nobody owns goes stale silently.

## §8 Where it's going

- ADR 0049 §3a names none of these three pages in any division row
  (`.planning/04-specs/ECOSYSTEM-PLAN.md:51-60`) — consistent with the gap in §6.
- The privacy-notice drift risk has a written remedy already: DO-7 proposes binding any
  tracking, cookie or telemetry change to a `Privacy.tsx` edit **in the same PR**
  (`compliance-privacy-questions.md:22`). That is the one durable fix in this note.
- The `wineops.*` support defaults are a rebrand item, not a feature.

## §9 Capacity and coverage — measured 2026-09-19

**Capacity.** N/A — a shell/legal surface by design; confirmed `api_modules: []`.

**Coverage.** N/A — no backend module exists to measure.

**Runs in production.** Yes; `/credits` is a redirect into Receipts, not its own page.

**Promised vs. built.** Matches this note's own framing exactly.

**Gaps.** None — by design.

*Evidence:* `apps/web/src/App.tsx:371`; this note's own §0.
