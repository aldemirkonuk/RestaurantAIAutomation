---
type: agenda-full
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: provisional
metrics: [seo.soft_404_rate, seo.indexed_pages, seo.title_in_source_pct, answer_surface.assistant_citations]
updated: 2026-08-24
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-premortem]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-directive]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[technical-seo-ai-answer-surface-agenda-board]]", "[[growth-agenda-full]]", "[[conversion-funnel-charter]]", "[[content-production-charter]]", "[[client-surfaces-charter]]", "[[release-engineering-charter]]", "[[security-charter]]", "[[brand-identity-charter]]", "[[compliance-privacy-charter]]", "[[OPEN-DECISIONS]]"]
---

# Technical SEO & AI Answer Surface — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three bodies of work, and the order is chosen so that the first thing G4 does is **stop
being wrong about the current state**.

1. **Measure production, not source.** Every finding in
   [[technical-seo-ai-answer-surface-charter]] comes from reading the repo. The deployment
   has never been fetched ([[commercial]] §7). Source and production diverge exactly where a
   CDN config lives, which is exactly where the worst defect is.
2. **The crawl floor.** A real 404 status, `robots.txt`, a sitemap, canonical tags,
   `llms.txt`, and a title in the served HTML. None of it is interesting; all of it is
   prerequisite; almost none of it is in G4's hands to merge.
3. **The answer surface.** Structured data that asserts only what the page supports, plus the
   sampled citation measurement that tells us whether any of this is working.

## How

**The production census (item 1).** One pass, written up once:

| Probe | What it settles |
|---|---|
| `curl -I` three nonexistent URLs | `seo.soft_404_rate`, measured rather than inferred from `vercel.json:12-15` |
| Fetch `/`, `/privacy`, and a `/v/:slug` with JS disabled | `seo.title_in_source_pct`; confirms whether `apps/web/index.html:7` is what a crawler sees |
| Request `/robots.txt`, `/sitemap.xml`, `/llms.txt` | Confirms the absences from `apps/web/public/` are also absences in production |
| Response headers on a content route | Cache behaviour, and whether anything upstream injects meta |
| Search Console availability | Whether the domain can even be verified today |

**The crawl floor (item 2), with the seam handled explicitly.** The 404 is not one change:

- **The status code** is G4's, and it lives at the host. `vercel.json:12-15` rewrites
  everything to `/index.html`, which serves 200. A rewrite cannot produce a 404; this needs a
  different mechanism at the hosting layer, and the acceptance criterion is a **status code
  observed in production**, never a screenshot.
- **The page** is [[conversion-funnel-charter]]'s: what it says, and where its CTA goes. The
  component already exists at `apps/web/src/components/ui/error-state.tsx:142` and is routed
  nowhere.
- **Neither team ships the item alone** ([[growth-directive]]).

**`llms.txt` deserves a note rather than a checkbox.** It is a young convention with no
guaranteed consumer, and G4 should write it while saying so: the cost is one file, the
benefit is unverified, and pretending otherwise would be the same over-claim
[[technical-seo-ai-answer-surface-premortem]] M3 warns about. It is cheap and honest, which
is enough.

**The answer surface (item 3).** Copy the discipline already in the repo. Structured data
asserting anything about customers, ratings, or recovery amounts goes through
[[editorial-gate-charter]] like prose, because it is a published claim in JSON. **No
aggregate rating, no review markup, no `LocalBusiness` premises claim** while the company has
one design partner and no office.

**On what G4 can actually merge: very little.** `robots.txt` and the sitemap need a deploy
to `apps/web`; the status code needs `vercel.json`; server-rendered titles need a rendering
change on a Vite SPA with `"framework": null` (`vercel.json:6`). G4's output is a measured
number plus a named requirement with a named Engineering owner, and a requirement with no
owner for two close-times escalates ([[technical-seo-ai-answer-surface-premortem]] M4).

## Why now

- **The soft 404 is live.** Every URL a crawler guesses today returns 200 and a page titled
  `WineOps AI - Restaurant Wine Management`. This is current behaviour, not future risk.
- **Crawl decisions are cheapest on a site with five public routes.** No redirect debt, no
  thin-page inventory, no legacy canonicals. This is the cheapest this work will ever be, and
  it stops being cheap the moment content starts shipping.
- **The rendering decision is upstream of everything and belongs to someone else.** Whether
  content is server-rendered is [[client-surfaces-charter]]'s call and it constrains every
  item on this list. Raising it now costs a paragraph; raising it after twenty articles ship
  costs a migration.

## Next steps

1. Run the production census. One page of findings. This is unblocked and it corrects the
   record.
2. Record `seo.soft_404_rate` = measured value, so the baseline is observed rather than
   asserted.
3. Write the requirement set with a named Engineering owner per item: status code, crawl
   files, title in source. File them where [[client-surfaces-charter]] and
   [[release-engineering-charter]] actually work, not in a Growth document.
4. Ask [[security-charter]] to classify every route that would appear in a sitemap. G4
   exposes only what has been classified
   ([[technical-seo-ai-answer-surface-premortem]] M5).
5. Draft the schema.org policy — which types, and the explicit never-list.
6. Do **not** start Core Web Vitals work. There is no public content route to measure it on,
   and starting it is [[technical-seo-ai-answer-surface-premortem]] M1.

## Questions for the founder

1. **Is content server-rendered?** A Vite SPA cannot put a title in the served HTML without a
   rendering change. This decides whether the crawl floor is achievable at all, and it is
   Engineering's decision, not Growth's.
2. **What is the domain?** `wineops.ai` is still live across shipped surfaces. Canonicals,
   sitemap URLs, and `llms.txt` all bake a hostname in, and doing it twice means a migration
   with redirects.
3. **`llms.txt` — worth it?** G4's read: cheap, unproven, honest to ship with that caveat.
   Confirming you understand it as a bet rather than a standard.
4. **Cookie consent.** `apps/web/src/pages/Privacy.tsx:30-31` publicly promises no banner
   because there is nothing to consent to. The checklist item asks for one. Keeping the
   promise is the better answer and it constrains [[conversion-funnel-charter]]'s
   instrumentation. Your call, with [[compliance-privacy-charter]].
5. **Terms of service** is on the checklist and does not exist. That is Legal's document; G4
   only owns where it is linked. Should it be requested now?
