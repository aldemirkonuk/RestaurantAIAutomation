---
type: agenda-board
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-agenda-full]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-schedule]]", "[[growth-agenda-board]]", "[[conversion-funnel-charter]]"]
---

# Technical SEO & AI Answer Surface — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth/teams/technical-seo-ai-answer-surface"
SORT type ASC
```

## Where this team sits in Growth

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — untouched in 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/growth/teams/technical-seo-ai-answer-surface"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- [ ] `seo.indexed_pages` — **0**. No `robots.txt`, no sitemap, one public content route
- [ ] `answer_surface.assistant_citations` — **0**, and **sampled not enumerated** wherever reported
- [ ] `seo.soft_404_rate` — **100%** (from source). `vercel.json:12-15` serves 200 for every
      unmatched URL; `apps/web/src/App.tsx:302` then redirects client-side. **Not yet measured
      in production**
- [ ] `seo.title_in_source_pct` — effectively **0**. Titles set in `useEffect`
      (`apps/web/src/pages/VendorPortal.tsx:154`); shell says `WineOps AI` (`apps/web/index.html:7`)
- [ ] `seo.checklist_items_green` — listed **last and never alone**. It is an activity counter
      and the department's named failure mode

## The technical checklist — each item bound to an outcome metric

Nothing here may be graded green while its bound metric is unreadable. An unreadable metric
is recorded as **unreadable**, never as done.

- [ ] `robots.txt` — absent. Bound to `seo.indexed_pages`. Starts **restrictive**: list what to crawl
- [ ] Sitemap — absent. Bound to `seo.indexed_pages`. Only routes [[security-charter]] has classified public
- [ ] Canonical tags — absent. `apps/web/index.html` has no `<link rel="canonical">`
- [ ] `llms.txt` — absent. **A bet, not a standard.** Cheap, unproven, shipped with that caveat
- [ ] schema.org — **present but only on the vendor catalogue**
      (`apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:122-180`). Nothing for Mudavym content
- [ ] Site speed / Core Web Vitals — **deliberately not started.** No public content route exists to measure
- [ ] Image compression — no pipeline. `apps/web/vite.config.ts:8` is `[react()]` only; 17 `<img>` tags
- [ ] Cookie consent — **not a missing widget.** `apps/web/src/pages/Privacy.tsx:30-31` publicly
      promises no banner. Changing that is a decision, not a task
- [ ] Terms of service — does not exist. Legal's document; G4 owns only that the link is crawlable

## Seams — neither side ships alone

- [ ] **The 404.** G4 owns the **status code** (host layer). [[conversion-funnel-charter]] owns
      **the page and its CTA**. Component already exists at
      `apps/web/src/components/ui/error-state.tsx:142`, routed nowhere
- [ ] **Sitemap contents.** [[security-charter]] classifies; G4 exposes only what is classified

## Blocking

- [ ] **Production never fetched** — every finding is from source. First task, unblocked
- [ ] **Rendering decision** — a Vite SPA with `"framework": null` (`vercel.json:6`) cannot put a
      title in served HTML. [[client-surfaces-charter]]'s call
- [ ] **Domain undecided** — canonicals and sitemap URLs bake in a hostname
- [ ] **No requirement has a named Engineering owner yet** — the state that persists indefinitely

## Standing rules

- [ ] **Emit no claim rather than a weak one** — adopted verbatim from
      `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120`
- [ ] No aggregate rating, no review markup, no `LocalBusiness` premises claim. One design
      partner, no office
- [ ] Structured data asserting anything about customers or amounts goes through
      [[editorial-gate-charter]]. It is a published claim in JSON
- [ ] Acceptance criteria are **observed in production**, never a screenshot
