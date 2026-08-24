---
type: agenda-full
division: commercial
department: growth
status: provisional
metrics: [seo.indexed_pages, seo.soft_404_rate, demand.uncovered_keyword_count, content.published_units_per_week, editorial.claims_traceable_pct, funnel.visit_to_activated_rate, funnel.measurable_steps]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[growth-premortem]]", "[[growth-directive]]", "[[growth-loops]]", "[[growth-schedule]]", "[[growth-agenda-board]]", "[[search-demand-research-agenda-full]]", "[[content-production-agenda-full]]", "[[editorial-gate-agenda-full]]", "[[technical-seo-ai-answer-surface-agenda-full]]", "[[conversion-funnel-agenda-full]]", "[[client-surfaces-charter]]", "[[brand-identity-charter]]", "[[compliance-privacy-charter]]", "[[design-partner-operations-charter]]", "[[OPEN-DECISIONS]]"]
---

# Growth — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Growth's first year of work is not the pipeline. It is **building the thing the pipeline
needs in order to run at all**, and then running it slowly enough that the gate can keep up.

Three bodies of work, in dependency order:

1. **A publishing surface that exists.** One reachable, server-rendered content route with
   a real title, plus `robots.txt`, a sitemap, canonical tags, and `llms.txt`. Today none of
   these exist and every unmatched URL returns HTTP 200 (`vercel.json:11-13` →
   `apps/web/src/App.tsx:302`). Until this lands, everything downstream is inventory.
2. **The pipeline, at gate speed.** Corpus → draft → mandatory human pass → publish → FAQ
   layer → Search Console refeed. Throughput is set by the editor, never by the drafter.
3. **A funnel that can be seen.** Today `funnel.measurable_steps` is **0** for every
   pre-login step: `apps/web/src/lib/uxSignals.ts:15` ships dark and buckets on an
   authenticated user id (`:20-23`), so it cannot observe a first visit by construction.

## How

**The order matters more than the content**, which is why it is stated as a sequence rather
than a backlog.

| # | Work | Owner | Blocks | Done when |
|---|---|---|---|---|
| 1 | Decide the publishing target: a route inside `apps/web`, a separate marketing surface, or a static generator. This is an **open decision**, not a task | Growth → [[client-surfaces-charter]] | everything | An entry in [[OPEN-DECISIONS]] with a chosen option and a reason |
| 2 | Fix the soft 404 at both layers: a real 410/404 status at the host, and [[conversion-funnel-agenda-full]]'s page behind it. `apps/web/src/components/ui/error-state.tsx:142` already has the component | [[technical-seo-ai-answer-surface-agenda-full]] + [[conversion-funnel-agenda-full]] | crawl trust | A nonexistent URL returns a non-200 status |
| 3 | `robots.txt`, sitemap, canonical tags, `llms.txt` | [[technical-seo-ai-answer-surface-agenda-full]] | indexing | Files served, sitemap non-empty |
| 4 | Server-rendered `<title>` and `<meta description>` for content routes. Titles are set after mount today (`apps/web/src/pages/VendorPortal.tsx:154`) and the static shell still says WineOps (`apps/web/index.html:7`) | [[client-surfaces-charter]], brand copy from [[brand-identity-charter]] | extractability | View-source shows the real title |
| 5 | Stand up Search Console and Perplexity/AnswerThePublic access. `env.example` has no key for any of them | [[search-demand-research-agenda-full]] | the loop closing | First GSC export with a non-zero row count |
| 6 | Write the provenance format the gate runs on, before the first draft | [[editorial-gate-agenda-full]] | publishing anything | One file format, one worked example |
| 7 | First article, at gate speed. Then the ten FAQ pages | [[content-production-agenda-full]] | — | Published, indexed, linked both ways |
| 8 | Pre-login funnel measurement that does not falsify `apps/web/src/pages/Privacy.tsx:30-31` | [[conversion-funnel-agenda-full]] + [[compliance-privacy-charter]] | the activation number | A visit count exists and the privacy page is still true |

**Item 1 is genuinely undecided and is not quietly assumed here.** Publishing marketing
content inside the authenticated SPA means fighting the client-side rendering that already
makes titles invisible to a non-JS crawler; a separate surface means a second deploy target
and a second place for the brand to drift. Growth states the requirement and the tradeoff;
the decision belongs in [[OPEN-DECISIONS]].

**On the FAQ layer.** Ten ~120-word answers, one page each, each linking back to the
long-form article. The obvious failure is ten near-identical thin pages that read as doorway
pages and dilute the article they were built to feed. The counter is enforced at authoring
time: the ten questions must be the ten *most distinct*, distinctness is checked before
drafting rather than after, and `content.faq_orphan_pages` counts both orphans and
duplicate-intent pairs.

## Why now

- **The near-greenfield state is an advantage exactly once.** There is no legacy content,
  no accumulated redirect debt, and no thin-page inventory to clean up. Every technical-SEO
  decision is being made for the first time on a site with fewer than five public routes.
  That is the cheapest this work will ever be.
- **The soft 404 is live.** Every URL a crawler guesses today returns 200 and a page titled
  WineOps AI. This is not a future problem; it is the current behaviour of the deployed app.
- **The answer-surface bet has a real precedent in this repo.**
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:123-141` already emits
  server-side schema.org JSON-LD on a public route, with a stated discipline at `:119-120`
  worth copying verbatim: emit no claim rather than a false one. Growth is extending a
  pattern, not inventing one.
- **The gate has an obligation that expires.** The recovery number is being formed now, at
  the design partner. Establishing that *dollars recovered* means **we asked** until an 812
  credit memo lands ([[YC_WEDGE_PLAN]]:31-33) is cheap today and expensive after the first
  article claims otherwise.

## Next steps

Immediate, in order, and none of them is "write an article":

1. Raise the publishing-target decision in [[OPEN-DECISIONS]] with the three options and
   their costs.
2. Measure `seo.soft_404_rate` once, so the 100% baseline is recorded rather than asserted.
3. Draft the provenance format ([[editorial-gate-agenda-full]]) and the banned-construction
   list ([[brand-identity-charter]] supplies the voice guide it enforces).
4. Ask the founder the five questions below.
5. Nothing in the pipeline starts until items 1–3 have owners and dates.

## Questions for the founder

1. **Where does content get published?** Inside `apps/web`, or a separate surface? This is
   the one decision blocking everything and Growth cannot make it alone.
2. **What is the domain?** `wineops.ai` is still live across shipped surfaces
   ([[commercial]] §4.1). Publishing under one name and mailing from another costs the
   credibility the content is buying. Does the migration land before the first article?
3. **Gate throughput.** If you are the only editor, what is the sustainable number of
   articles per week? Growth will cap production at that number rather than build a queue.
4. **Pre-login measurement.** `apps/web/src/pages/Privacy.tsx:30-31` promises no tracking
   cookies and no consent banner. Do we keep that promise and measure the funnel with
   cookieless, server-side counting, or do we change the promise? Growth has a strong
   preference for the first and will not act on either without you.
5. **Which claim leads?** [[narrative-collateral-charter]] owns the sentence; Growth needs
   to know it before writing anything, because the corpus is built around it.
