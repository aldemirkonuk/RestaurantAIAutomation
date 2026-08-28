---
type: agent-stack
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: designed
updated: 2026-08-27
metrics: [seo.indexed_pages, answer_surface.assistant_citations, seo.soft_404_rate, seo.title_in_source_pct, seo.checklist_items_green]
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-directive]]", "[[0034-agent-stack-artifact]]", "[[growth-agent-stack]]", "[[conversion-funnel-charter]]", "[[client-surfaces-charter]]", "[[security-charter]]", "[[skills-charter]]"]
---

# Technical SEO & AI Answer Surface — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> G4 is a **requirements-and-measurement** team: it owns almost nothing it can ship, because the
> router, the host config and the bundle belong to Engineering. Its card is shaped to that — it
> fetches, compares, counts, and files requirements, and it never merges to `apps/web`.
> Mechanisms referenced only: harness → [[harness-runtime-charter]] (**OD-03 open**), model choice
> → [[model-routing-inference-economics-charter]], the skill envelope → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `crawl-surface-sentinel` | Ask the live deployment the questions a machine asks — status codes on URLs that do not exist, titles fetched without JS, the three crawl files by name — and report what came back, without touching what it measures | NEW |

## 2. Agent cards

```yaml
agent: crawl-surface-sentinel
unit: technical-seo-ai-answer-surface
triggers:
  - schedule: "weekly — crawl-surface census (L-G4-1, close_time weekly)"   # [[technical-seo-ai-answer-surface-schedule]]
  - schedule: "monthly — extraction and citation (L-G4-2), sampled by construction"
  - schedule: "monthly — exposure review (L-G4-4) against [[security-charter]]'s classification"
  - topic: deploy.succeeded        # publisher: NONE (gap — [[release-engineering-charter]] owns deploys; no event exists)
consumes:
  - the live deployment over HTTP — status codes, served HTML, the three crawl files
  - "apps/web/public/ (seven files, none of them robots/sitemap/llms.txt), vercel.json:12-15, apps/web/index.html:7"
  - "the emitted structured data at apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180"
  - the sitemap route list, once one exists
emits:
  - "seo.soft_404_rate, seo.title_in_source_pct, seo.indexed_pages → [[technical-seo-ai-answer-surface-agenda-board]]"
  - "answer_surface.assistant_citations, labelled **sampled**, with the lifted passage → page-shape feedback to [[content-production-charter]]"
  - "proposed schema.org properties asserting customers, ratings or amounts → [[editorial-gate-charter]] for a verdict on a JSON claim"
  - "requirements (a real 404 status, a server-rendered title) → [[client-surfaces-charter]] / [[release-engineering-charter]]; they ship, this agent does not"
  - nf_a events (task_type: crawl_census)
routing_class: mechanical        # fetch, compare, count. The monthly citation read is extraction-shaped; whether it needs its own class is aio-model-routing's call, not this card's
quality_bar: "a census that cannot reach the deployment **fails**; it never reports green ([[technical-seo-ai-answer-surface-schedule]]). Every citation number carries the word *sampled* wherever it appears"
autonomy:
  read: autonomous               # fetching a public URL and asking an assistant a fixed question set are reads
  propose: autonomous            # requirements and findings land as PRs
  mutate_stock_money_outbound: confirm   # constant, plus the hard rule below
memory: technical-seo-ai-answer-surface
escalates_to: "[[growth-charter]]"
```

**The card's own hard rule.** `crawl-surface-sentinel` never edits `apps/web`, `vercel.json`, or
the router. G4 states the requirement and Engineering implements it (charter §Non-goals); a
sentinel that patches the layer it measures loses the only thing it was for. Structured data it
proposes is a **claim made to a machine**, and a machine cannot read a hedge — so it goes through
the gate like any other published claim.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `crawl-surface-census` | T3 | Per deploy and weekly | Status codes for three nonexistent URLs, titles fetched without JS, three crawl files probed. **A run that cannot reach the deployment fails rather than reporting green** | The two-layer soft 404 — `vercel.json:12-15` rewriting to `/index.html` above `apps/web/src/App.tsx:302` redirecting `path="*"` — has been live and unreported; it was found by source reading on 2026-08-24, which is exactly the check this automates | NEW |
| `answer-surface-audit` | T2 | Monthly L-G4-2 | Fixed question set asked, citations recorded **with the lifted passage**, output labelled sampled | `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180` emits JSON-LD that has never been validated against a consumer, only against its own shape | NEW |
| `structured-data-claim-check` | T3 | Any markup change | Every asserted schema property mapped to on-page content; a property with no backing content fails | The rule is already applied once in this repo: `.../vendor-portal.service.ts:119-120` suppresses the `Offer` on a priced-at-nothing listing, because a zero-price Offer is a valid document and a false statement | NEW |
| `sitemap-classification-check` | T3 | Monthly L-G4-4 and before any sitemap change | Zero sitemap entries without a [[security-charter]] classification | The classification read has been done by hand once: 137 endpoints lack `JwtAuthGuard`, and `apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46` passes unauthenticated requests through — discoverability and exposure are the same act here | NEW |

Consumed, owned elsewhere: the registry ([[skills-charter]]); route classification
([[security-charter]]); the words being extracted ([[content-production-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: crawl_census`. Needs `context.route`, `context.check` and
  `context.status_code` as jsonb keys; the sampled citation runs additionally need
  `context.question_id` and the lifted passage, or a page-shape change can never be attributed to
  the citation it produced and L-G4-2 stops being a loop.
- **Semantic** — `memory/` beside this file, index `technical-seo-ai-answer-surface-MEMORY.md`.
  Three founding facts, all measured: `seo.soft_404_rate` = 100% **and the two layers causing it**;
  `seo.title_in_source_pct` ≈ 0, because titles are set in a `useEffect`
  (`apps/web/src/pages/VendorPortal.tsx:154`) over a shell carrying one wrong title for every route
  (`apps/web/index.html:7`); and the honest limit that **no live surface has been fetched** — every
  finding is from source, `last_verified: 2026-08-24`, `confidence: source-only`. That third fact is
  the clearest case in Growth for the 90-day expiry: a CDN config is exactly where source and
  production diverge.
- **Working** — this card, the MEMORY index, charter §Mandate. `vercel.json`, `index.html` and the
  vendor-portal service are retrieval targets by `path:line`, never preloaded.

**Consolidation** — monthly, with L-G4-2. Failures first: a census that regressed becomes a fact
naming **the layer** (host rewrite vs router vs bundle), never "soft 404 got worse"; a citation
that appeared becomes a fact naming the passage that was lifted; expire at 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[technical-seo-ai-answer-surface-loops]], NF-A events, vault
PRs and skill candidates. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `deploy.succeeded` has no publisher | Nothing emits on a deploy; the per-deploy census degrades to the weekly one, bounding the blind spot at seven days |
| `seo.indexed_pages` has no source | No verified domain, no Search Console property, no indexed page. The metric reads *blocked*, not 0 |
| Assistant citation has no enumerable source | There is no impressions report for an AI answer. The number is a sample **by construction** and is labelled one everywhere — a sampled number described as complete is the same error class as a green checklist on an empty site |
| The 404 seam has two owners and no event | G4 owns the status code, [[conversion-funnel-charter]] owns what the visitor reads; neither ships the item alone ([[growth-directive]]). Nothing connects them but the shared monthly probe |
| Requirements to Engineering are doc edits | An acceptable async path, and `seo.unowned_requirements` with an age is the only thing that keeps an unshipped requirement visible |

## 6. Evidence today

- **PARTIAL — one genuine asset.** Server-side schema.org JSON-LD is really emitted at
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180` on a `@Public()` route
  (`.../vendor-portal.controller.ts:39-41`), mirrored client-side at
  `apps/web/src/pages/VendorPortal.tsx:118-137`. It is the vendor catalogue, not Mudavym content.
- **EXISTS — the defect list the sentinel would report**, all verified from source on 2026-08-24:
  no `robots.txt`/sitemap/`llms.txt` in `apps/web/public/`; the two-layer soft 404; client-side
  titles; no `og:*`, `twitter:*` or canonical in `apps/web/index.html`; `vercel.json:6` sets
  `"framework": null` so nothing server-renders; no image pipeline (`apps/web/vite.config.ts:8`).
- **NEW — the agent and all four skills.** Each was performed once by hand in the generation pass,
  which is what justifies them and nothing more.
- **Not verified, and stated as such:** the live deployment has never been fetched — closing that
  is the sentinel's first run, and until then every number above is source-only.
