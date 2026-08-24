---
type: premortem
division: commercial
department: growth
team: technical-seo-ai-answer-surface
status: provisional
metrics: [seo.indexed_pages, seo.soft_404_rate, answer_surface.assistant_citations, seo.checklist_items_green, seo.title_in_source_pct]
updated: 2026-08-24
links: ["[[technical-seo-ai-answer-surface-charter]]", "[[technical-seo-ai-answer-surface-loops]]", "[[technical-seo-ai-answer-surface-directive]]", "[[growth-premortem]]", "[[content-production-charter]]", "[[conversion-funnel-charter]]", "[[client-surfaces-charter]]", "[[brand-identity-charter]]", "[[editorial-gate-charter]]", "[[security-charter]]"]
---

# Technical SEO & AI Answer Surface — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. G4 has failed. What happened?

---

### M1 — Core Web Vitals were optimised on an app shell with no public content

The mechanism named in [[commercial]] §1.3, and it is first because it is the only work on
G4's list that can be started today without anyone else's cooperation. `apps/web` is
measurable right now: bundle size, LCP, CLS, image weight, all real numbers that improve when
worked on. Twelve of sixteen checklist items go green over two quarters. The technical-SEO
checklist is reported as substantially complete. And the only crawlable content route in the
entire product is still a vendor wine catalogue at `/v/:slug` that no prospective restaurant
will ever search for. `seo.indexed_pages` never left zero. Nobody lied; the report was simply
about the wrong site.

**Earliest observable signal.** Any checklist item marked complete in a close-time where
`seo.indexed_pages` is zero. The subtler tell arrives sooner: the first performance
measurement taken against an **authenticated** route, which is by definition a route no
crawler will ever load.

**What would have prevented it.** Every checklist item is **bound to an outcome metric** and
is never gradable in isolation ([[technical-seo-ai-answer-surface-charter]]). An item whose
outcome metric is unreadable is recorded as *unreadable*, never as done — an omitted metric
reads as green. [[growth-loops]] L-GRO-6 runs that reconciliation monthly at the department
level, deliberately one layer above the team doing the grading. And Core Web Vitals work is
explicitly **not started** until a public content route exists to measure it on.

---

### M2 — The soft 404 was "fixed" in the router and stayed broken at the host

`apps/web/src/App.tsx:302` is the obvious defect and the obvious fix: replace
`<Navigate to="/" replace />` with a real 404 component — one already exists at
`apps/web/src/components/ui/error-state.tsx:142`, currently routed nowhere. The change is a
few lines, it is visibly correct in the browser, and the checklist item goes green. But the
status code is decided **above** the router: `vercel.json:12-15` rewrites everything except
`/api/` and `/assets/` to `/index.html`, and a rewrite serves **HTTP 200**. A crawler still
receives 200 for every nonexistent URL. The page now says "not found" in a body that the
protocol says is fine. `seo.soft_404_rate` stays at 100% while the item reads done.

**Earliest observable signal.** A curl of a nonexistent URL returning `200`. That is the
whole test, it takes ten seconds, and its absence from the acceptance criteria is what
allows the failure. Secondary tell: a 404 fix merged with a screenshot as its evidence.

**What would have prevented it.** The checklist item's acceptance criterion is a **status
code observed in production**, not a rendered page. `seo.soft_404_rate` is measured by
probing real URLs against the deployment, monthly and per deploy
([[technical-seo-ai-answer-surface-schedule]]). And the seam is written down: G4 owns the
status, [[conversion-funnel-charter]] owns the page, and **neither ships the item alone**
([[growth-directive]]).

---

### M3 — Structured data was emitted, was wrong, and nobody was reading it anyway

schema.org markup is satisfying to write and trivially easy to over-claim. A `FAQPage` on a
page whose questions are headings rather than questions. An `Organization` with a review
count of one, or of zero rendered as absent-but-implied. A `LocalBusiness` on a company with
no premises. `Product` markup on a page that sells nothing. It validates. It ships. Two
things then happen: no assistant cites the page anyway, and the one time a rich result does
appear, it asserts something the company cannot support. The team that was supposed to make
the company machine-legible has made it machine-legibly wrong.

**Earliest observable signal.** Any schema type emitted for which the page has no
corresponding on-page content — the classic pair being `FAQPage` where the answers are
marketing copy, and any aggregate rating at all, given there is one design partner. Also: a
markup change that has never been validated against a **consumer**, only against a linter.

**What would have prevented it.** The rule is already in this repo, in code:
`apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120` — a listing with no
price emits no `Offer`, because *a zero-price Offer is a valid document and a false
statement*. G4 adopts it verbatim: **emit no claim rather than a weak one.** Structured data
asserting anything about customers, ratings, or recovery amounts goes through
[[editorial-gate-charter]] exactly as prose does, because it is a published claim that
happens to be in JSON. And `answer_surface.assistant_citations` is measured against real
assistants, so markup that nothing consumes is visible as effort with no effect.

---

### M4 — G4 owned requirements it could not ship, and became a ticket queue nobody prioritised

Almost nothing on G4's list lives in G4's hands. `robots.txt` and the sitemap need a deploy
to `apps/web`. The status code needs a change to `vercel.json`. Server-rendered titles need
either a rendering change or a framework change — `vercel.json:6` currently sets
`"framework": null` and `apps/web` is a Vite SPA, so there is no server render for content
routes at all. Every one of these is a request to [[client-surfaces-charter]] or
[[release-engineering-charter]], filed by a team with no engineering headcount, competing
against product work. Four quarters later, G4 has an immaculate requirements document, a
green-looking checklist of the items it could do alone, and a site that is still not
crawlable.

**Earliest observable signal.** A G4 requirement open for two consecutive close-times with no
owning Engineering unit named. Not "no progress" — **no named owner**, which is the state
that persists indefinitely.

**What would have prevented it.** Two things. **(a)** G4 is chartered honestly as a
requirements-and-measurement team, so its own output is *a measured number and a named
requirement*, and it is not graded on shipping code it cannot merge.
**(b)** Any requirement blocked for two close-times escalates to [[growth-directive]] and
then to `OPEN-DECISIONS.md` — because a permanently-deprioritised crawl surface is not an
engineering backlog item, it is a decision that the company is not doing content marketing,
and that decision deserves to be made explicitly rather than by attrition.

---

### M5 — The crawl surface was opened, and it opened more than content

Making the site machine-reachable means adding `robots.txt`, a sitemap, and public routes,
and it means thinking about what a crawler can enumerate. This repo has 137 endpoints with no
`JwtAuthGuard`, `TenantGuard` returns `true` when there is no authenticated user
(`apps/api-gateway/src/common/tenant/tenant.guard.ts:38-46`), and
`apps/api-gateway/src/analytics/analytics.controller.ts:44` declares its controller with no
guards at all. G4, wanting pages indexed, adds a sitemap and a permissive `robots.txt`, and
in the process makes it marginally easier to enumerate a surface that was only ever protected
by obscurity. The SEO win and the security incident arrive through the same door.

**Earliest observable signal.** Any `robots.txt` or sitemap entry pointing at a route that is
not deliberately, reviewably public — where "deliberately public" means carrying `@Public()`
by intent, not merely lacking a guard.

**What would have prevented it.** Every route G4 exposes in a sitemap is a route
[[security-charter]] has classified as intentionally public. G4 raises the classification
request and does not make the call: an unguarded endpoint is a security finding even when it
is convenient for crawling. And `robots.txt` starts restrictive, listing what should be
crawled rather than excluding what should not — a deny-list requires knowing every path, and
this codebase has 448 of them.

---

## Cross-cutting counter-pressure

- **M1, M2 and M3 are one disease in three organs:** work that is measurable and satisfying
  standing in for work that is blocked and slow. The single counter-pressure is that every
  green thing has an outcome number attached to it, read one level up.
- **M4 is the honest structural risk of this team existing at all.** It is stated in the
  charter rather than hidden, because a team that cannot ship its own work needs its
  escalation path defined on day one, not discovered in month nine.
- **M5 is the seam where Growth can do real damage outside its own department.** The rule is
  simple and absolute: G4 exposes only what [[security-charter]] has classified.
