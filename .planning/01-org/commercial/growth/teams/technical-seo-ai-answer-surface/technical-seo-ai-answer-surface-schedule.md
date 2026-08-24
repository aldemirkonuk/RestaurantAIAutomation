---
type: schedule
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-agenda-board]]", "[[growth-schedule]]", "[[conversion-funnel-schedule]]", "[[content-production-schedule]]", "[[security-charter]]", "[[client-surfaces-charter]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]"]
---

# Technical SEO & AI Answer Surface — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per deploy** | Crawl-surface census — L-G4-1. Status codes on nonexistent URLs, titles fetched without JS, the three crawl files requested by name | `seo.soft_404_rate`, `seo.title_in_source_pct` |
| Per publication | Pre-publish machine check — status code, canonical, title in served source, schema validity, sitemap entry present | Publish-blocking pass/fail for [[content-production-schedule]] |
| Per markup change | Structured-data claim review — anything asserting customers, ratings, or amounts goes through [[editorial-gate-charter]] | Gate verdict on a JSON claim |
| Weekly | Crawl-surface census (scheduled run, independent of deploys) | Same two metrics, plus drift detection |
| Weekly | Requirement ownership — L-G4-3. Unowned requirements and their age | `seo.unowned_requirements`, escalations |
| Monthly | Extraction and citation — L-G4-2. Fixed question set asked of the major assistants; record citations **and which passage was lifted** | `answer_surface.assistant_citations` (sampled), page-shape feedback |
| Monthly | Exposure review — L-G4-4. Every sitemap route checked against [[security-charter]]'s classification | `seo.sitemap_routes_unclassified`, target zero |
| Monthly | Index health — coverage report, canonicalisation conflicts, crawl errors | `seo.indexed_pages` |
| Quarterly | Checklist definition review — is each item still bound to a metric that can be read? | Checklist revision |
| Quarterly | Charter staleness sweep ([[README]] §3.3, §6) | Archive or revision |

**Two jobs run today and both will report red:** the crawl-surface census and requirement
ownership. Everything else waits on a published page. **Core Web Vitals measurement is
deliberately absent from this table** — there is no public content route to measure it on,
and adding it now would be [[technical-seo-ai-answer-surface-premortem]] M1 scheduled into
existence.

**Anti-sprawl.** A job with no action for three consecutive runs is downgraded or deleted
([[README]] §6). The monthly citation check is the likely candidate: three months of zero
citations with no page-shape change means the measurement is not informing anything and
should go quarterly. Three months of zero citations *with* page-shape changes is the loop
working.

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion.

**None exist.** The repo has one project skill, `.agents/skills/railway-config/SKILL.md`
([[README]] §3.1). Each row is bound to a job above, per the creation protocol
([[README]] §3.3).

| Proposed skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `crawl-surface-census` | T3 | Per deploy and weekly | Status codes for three nonexistent URLs, titles fetched without JS, three crawl files probed. **A run that cannot reach the deployment fails rather than reporting green** | The two-layer soft 404 (`vercel.json:12-15` → `apps/web/src/App.tsx:302`) has been live and unreported. This skill is the thing that would have caught it |
| `answer-surface-audit` | T2 | Monthly L-G4-2 | Fixed question set asked, citations recorded with the lifted passage, output labelled **sampled** | `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180` emits JSON-LD that has never been validated against a consumer, only against its own shape |
| `structured-data-claim-check` | T3 | Any markup change | Every asserted schema property mapped to on-page content; a property with no backing content fails | The never-list exists because `AggregateRating` on a one-customer company is the easiest over-claim available, and it validates cleanly |
| `sitemap-classification-check` | T3 | Monthly L-G4-4, and before any sitemap change | Zero sitemap entries without a [[security-charter]] classification | 137 endpoints lack `JwtAuthGuard` and `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` passes unauthenticated requests through. Exposure and discoverability are the same act here |

**`crawl-surface-census` is the one skill in Growth worth building before its job has run
manually twice**, and the reason is specific: its failure mode is a **false green**. A census
that cannot reach the deployment and reports success is worse than no census, so the failure
behaviour has to be designed rather than discovered. Everything else on this list waits.

**Registry ownership** sits with [[skills-charter]]; the 30-day review with
[[skill-lifecycle-anti-sprawl-charter]]. G4 authors, it does not govern.
