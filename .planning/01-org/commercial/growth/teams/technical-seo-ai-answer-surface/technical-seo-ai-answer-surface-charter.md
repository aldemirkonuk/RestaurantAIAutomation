---
type: charter
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: partial
metrics: [seo.indexed_pages, answer_surface.assistant_citations, seo.soft_404_rate, seo.title_in_source_pct, seo.checklist_items_green]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[technical-seo-ai-answer-surface-premortem]]", "[[technical-seo-ai-answer-surface-agenda-full]]", "[[technical-seo-ai-answer-surface-agenda-board]]", "[[technical-seo-ai-answer-surface-directive]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[content-production-charter]]", "[[conversion-funnel-charter]]", "[[search-demand-research-charter]]", "[[client-surfaces-charter]]", "[[platform-api-charter]]", "[[release-engineering-charter]]", "[[brand-identity-charter]]", "[[compliance-privacy-charter]]", "[[commercial]]", "[[PAGE_MAP]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Technical SEO & AI Answer Surface — Charter

Team **G4** of [[growth-charter]]. Division: Commercial.

## Mandate

G4 owns whether a **machine** can reach, parse, trust, and quote this company's content.
Two halves, and the second is why the team's name is not simply "Technical SEO":

**The classic half.** `robots.txt`, sitemap, canonical tags, status codes, crawl and index
health, Core Web Vitals, image compression — plus two items the founder placed on this
checklist that are not really SEO chores and are handled as such: **cookie consent**, which
is a legal surface co-owned with [[compliance-privacy-charter]], and **terms of service**,
which is Legal's document and G4's placement problem.

**The answer-surface half.** Making pages **extractable and citable by AI assistants**,
which is a different mechanism from blue-link ranking: `llms.txt`, schema.org markup that
describes what the page actually asserts, answer-first structure that survives being lifted
out of its page, and content whose factual claims stand alone when quoted without their
surrounding paragraph. The founder's stated strategic point is ranking **inside** assistant
answers. G4 owns the machine-readable half of that; [[content-production-charter]] owns the
words.

The two halves share a discipline that this repo has already written down in code:
`apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120` explains that a
listing with no price emits no `Offer`, because **a zero-price Offer is a valid document and
a false statement**. G4 adopts that verbatim as its markup rule. Structured data is a claim
made to a machine, and a machine cannot read a hedge.

## Boundaries

Owns outright:

- **Crawl directives** — `robots.txt`, sitemap, canonical tags, `llms.txt`.
- **Status-code correctness on public routes** — including the **404**, where G4 owns the
  status and [[conversion-funnel-charter]] owns what the page says. Named as a seam in
  [[growth-directive]] because a seam with two owners has none.
- **Structured data** — schema.org types, their accuracy, and their validation against a
  consumer rather than a linter.
- **Machine reachability of content** — a title and description present in the served HTML
  rather than assigned after mount.
- **The technical-SEO checklist**, each item bound to an outcome metric so that no item can
  be graded green in isolation.
- **The citation measurement** — the sampled check of whether assistants cite a Mudavym URL.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The words on the page | [[content-production-charter]] · G2 | G4 makes a page extractable; G2 decides whether there is anything worth extracting |
| What the 404 page says and where its CTA goes | [[conversion-funnel-charter]] · G5 | G4 owns the status code, G5 owns the page. **Neither can ship the item alone** |
| Which topics exist | [[search-demand-research-charter]] · G1 | G4 reports what got indexed and cited; G1 decides what that means for the queue |
| Shipping the router, the bundle, the host config | [[client-surfaces-charter]], [[release-engineering-charter]] | G4 states the requirement; Engineering implements it. G4 does not merge to `apps/web` |
| Auth on public endpoints | [[platform-api-charter]], [[security-charter]] | An unguarded route is a security finding even when it is convenient for crawling |
| The cookie-consent legal wording | [[compliance-privacy-charter]] | G4 may need a consent surface; it never drafts the notice |
| Terms of service, as a document | Corporate → Legal | G4 owns where it is linked and that the link is crawlable |
| The brand on the shell | [[brand-identity-charter]] · M1 | `apps/web/index.html:7` is M1's migration; G4 reports it as a crawl-visible defect |

## Metrics it moves

**Primary — `seo.indexed_pages` and `answer_surface.assistant_citations`, reported as a
pair.** The founder asked for the second and no standard SEO dashboard reports it. Indexed
without cited means the answer-surface work is not working; cited without indexed is
possible and interesting, and would change the strategy.

**`seo.soft_404_rate` — baseline 100%.** See Evidence. This is the diagnostic that makes the
checklist honest: while it reads 100%, no crawl-health item may be graded green.

**`seo.title_in_source_pct`** — share of public routes whose `<title>` is present in the
served HTML rather than assigned after mount. Baseline is effectively **0** for content:
titles are set in a `useEffect` (`apps/web/src/pages/VendorPortal.tsx:154`) and the static
shell carries one wrong title for every route (`apps/web/index.html:7`).

**`seo.checklist_items_green`** is deliberately listed **last and never alone**. It is an
activity counter and it is the department's named failure mode
([[growth-premortem]] M3). It appears only next to `seo.indexed_pages` in
[[growth-loops]] L-GRO-6, and an item whose bound outcome metric is unreadable is recorded as
*unreadable*, never as done.

**Honest limitation on the citation number.** Assistant citation is **sampled, not
enumerated**. There is no impressions report for an AI answer. The metric is a sample and is
labelled as one everywhere it appears. A sampled number described as complete is the same
class of error as a green checklist on an empty site.

## Evidence today

**PARTIAL, and thinner than it looks.** Verified 2026-08-24 against the working tree.

**The one genuine asset.** schema.org JSON-LD is emitted **server-side** at
`apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180`, on a `@Public()`
endpoint at `apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:39-41`, with the
controller comment at `:35-38` stating that it is split from the page payload precisely
because *crawlers and our own ingester* read it. A client-side mirror exists at
`apps/web/src/pages/VendorPortal.tsx:118-137`. **This is the vendor catalogue, not Mudavym's
content** — but it is real server-rendered structured data on a public route, which is more
than most greenfield sites start with, and its authoring discipline (`:119-120`) is the rule
G4 adopts.

**Against it, a verified defect list:**

- **No `robots.txt`, no sitemap, no `llms.txt`.** `apps/web/public/` contains exactly seven
  files: `badge.png`, `empty.map`, `icon-192.png`, `icon-512.png`, `logo.png`,
  `manifest.json`, `sw.js`.
- **The soft 404 is a two-layer defect.** `vercel.json:12-15` rewrites
  `/((?!api/|assets/).*)` to `/index.html`, so the host returns **HTTP 200** for every
  nonexistent URL before React loads. Then `apps/web/src/App.tsx:302` redirects unmatched
  paths to `/` client-side. A crawler asking for a URL that does not exist gets 200 and a
  shell. **Fixing this requires a hosting-layer change as well as a router change**, which is
  why it is a seam rather than a ticket. `seo.soft_404_rate` baseline: **100%**.
- **Titles are client-side.** `apps/web/src/pages/VendorPortal.tsx:154` sets
  `document.title` inside a `useEffect`. A crawler that does not execute JS sees
  `apps/web/index.html:7`: `WineOps AI - Restaurant Wine Management` — the wrong brand, on
  every route.
- **No social or canonical metadata at all.** `apps/web/index.html` contains no `og:*`, no
  `twitter:*`, and no `<link rel="canonical">`.
- **No framework-level SEO tooling.** `vercel.json:6` sets `"framework": null`; `apps/web` is
  a Vite SPA. Nothing renders on the server for content routes.
- **One public content route exists** — `/v/:slug` at `apps/web/src/App.tsx:161` — plus
  `/privacy` at `:158`. Everything else public is auth plumbing ([[PAGE_MAP]]).
- **No image pipeline.** `apps/web/vite.config.ts:8` loads `[react()]` and nothing else; the
  17 `<img>` tags in `apps/web/src` are unoptimised and unsized.
- **A cookie-consent position is already published and it is "no banner".**
  `apps/web/src/pages/Privacy.tsx:30-31`. The checklist item "cookie consent" is therefore
  not a missing widget — it is a decision about whether to change a live promise, and it is
  [[growth-premortem]] M4.

**Not verified, and stated as such** ([[commercial]] §7): **no live surface was fetched.**
The `restaurant-ai-automation-web.vercel.app` deployment was not loaded, so real index state,
served headers, and measured Core Web Vitals are unknown. Every finding above is from source.
G4's first task includes closing that gap, because "from source" and "in production" diverge
exactly where a CDN config lives.

## Why this is a team

Engineering-adjacent work measured on crawl and citation health rather than readership.
Merged into [[content-production-charter]], a checklist with no reader-facing metric would sit
in the hands of a team graded on published volume and be deprioritised every week. The
counter-argument worth acknowledging: G4 owns almost nothing it can ship by itself — the
router, the host config, and the bundle all belong to Engineering. That makes G4 a
**requirements-and-measurement** team more than a build team, and [[technical-seo-ai-answer-surface-directive]]
is written around that reality rather than pretending otherwise.
