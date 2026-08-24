---
type: charter
division: commercial
department: growth
status: new
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, content.published_units_per_week, content.faq_orphan_pages, editorial.claims_traceable_pct, editorial.gate_bypass_count, seo.indexed_pages, seo.soft_404_rate, answer_surface.assistant_citations, funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.fabricated_social_proof_count]
updated: 2026-08-24
links: ["[[growth-premortem]]", "[[growth-agenda-full]]", "[[growth-agenda-board]]", "[[growth-directive]]", "[[growth-loops]]", "[[growth-schedule]]", "[[ORG_STRUCTURE]]", "[[commercial]]", "[[search-demand-research-charter]]", "[[content-production-charter]]", "[[editorial-gate-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[conversion-funnel-charter]]", "[[brand-identity-charter]]", "[[design-partner-operations-charter]]", "[[unit-economics-pricing-charter]]", "[[analytics-bi-charter]]", "[[compliance-privacy-charter]]", "[[client-surfaces-charter]]", "[[YC_WEDGE_PLAN]]", "[[PAGE_MAP]]", "[[EXTERNAL_CONNECTIONS]]", "[[OPEN-DECISIONS]]"]
---

# Growth — Charter

Parent division: **Commercial** ([[ORG_STRUCTURE]] §2). Siblings in-division: Sales,
Media & Brand. Carries the **Finance & Pricing** sub-layer, which is chartered separately
and is not governed from here beyond the reporting line ([[commercial]] §2, fork CM-F4).

## Mandate

Growth is accountable for **being found, being believed, and being joined** — in that
order, by people who have never heard of this company. It owns one named pipeline
(research → draft → mandatory human edit → publish → FAQ layer → Search Console refeed)
and two named checklists (technical SEO and conversion/UX). Its strategic target is not
the blue link: the founder specified **ranking inside AI assistant answers**, which is a
different retrieval mechanism, a different page shape, and a different measurement than
classic search. Growth does not own what the company claims — [[narrative-collateral-charter]]
and [[brand-identity-charter]] own the claim and the voice. Growth owns whether that claim
is *reachable, extractable, and true on the page it lands on*.

**Growth is near-greenfield and this charter says so up front.** There is no marketing
site, no publishing target, no crawl directives, and no pre-login instrumentation. Every
checklist item below is graded against nothing until the first URL exists. Grading a
checklist green against an app shell that a visitor cannot enter is the department's
central failure mode ([[growth-premortem]] M3), and naming it here is cheaper than
discovering it in a quarterly review.

## Boundaries

Owns outright, as **five teams that are five different ways a stranger fails to become a
customer** ([[commercial]] §1.3):

| Team | The failure it owns | Primary metric |
|---|---|---|
| [[search-demand-research-charter]] · G1 | Nobody was searching for what we wrote | `demand.uncovered_keyword_count` |
| [[content-production-charter]] · G2 | The page exists but says nothing worth citing | `content.published_units_per_week` |
| [[editorial-gate-charter]] · G3 | We published something false | `editorial.claims_traceable_pct` |
| [[technical-seo-ai-answer-surface-charter]] · G4 | Machines cannot reach, parse, or cite it | `seo.indexed_pages` · `answer_surface.assistant_citations` |
| [[conversion-funnel-charter]] · G5 | They arrived and left | `funnel.visit_to_activated_rate` |

**The pipeline, as specified by the founder and unchanged here:**

```
G1  Perplexity research → harvest the exact searches it ran = the keyword corpus
        ↓
G2  Claude writes the long-form SEO article   (explicitly replacing ChatGPT)
        ↓
G3  MANDATORY human edit pass — every time, no exceptions
        brand voice · fact-check against hallucination · no em dashes ·
        no buzzwords ("streamlined" is the named example) · must not read as a press release
        ↓
G4  publish  →  reachable, canonical, crawlable, extractable
        ↓
G2  AnswerThePublic → the 10 most distinct questions
        → ~120-word plain answer each → one page per question → each links back to the article
        ↓
G1  Google Search Console: sort by impressions → high-demand keywords with no content
        └──────────────────── feed back into step 1 ─────────────────────┘
```

Three properties of that diagram are load-bearing and are treated as contract, not
preference:

1. **The harvested search set is the corpus.** Not a keyword tool's suggestions — the
   exact queries the research assistant chose to run. G1 owns capturing them.
2. **The human pass is unconditional.** Not sampled, not risk-weighted, not skipped for a
   launch. [[editorial-gate-charter]] is the only non-automatable stage and the only one
   with a veto.
3. **The loop closes at Search Console, or it is not a loop.** Steps 1–4 without step 5
   are a content calendar. [[growth-loops]] L-GRO-1 is the mechanism.

**The two checklists**, owned as checklists with outcome metrics attached so they cannot
be reported green in isolation:

| Technical SEO — [[technical-seo-ai-answer-surface-charter]] | Conversion / UX — [[conversion-funnel-charter]] |
|---|---|
| sitemap · `robots.txt` | custom 404 with a CTA |
| canonical tags | CTA above the fold |
| `llms.txt` | breadcrumbs |
| schema.org markup | sticky mobile CTA |
| site speed / Core Web Vitals | case studies |
| image compression | **real reviews only — never fabricated** |
| cookie consent | image alt text |
| terms of service | local business schema |

Two items in that table are not really SEO chores and are flagged as such: **cookie
consent** is a legal surface co-owned with [[compliance-privacy-charter]], and **real
reviews only** is an integrity constraint with a hard zero, not a checklist item
([[growth-premortem]] M5).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The voice guide G3 enforces | [[brand-identity-charter]] · M1 | M1 *writes* the definition; G3 *applies* it. A gate enforcing its own opinion is not a gate |
| The deck, the pitch, the demo script | [[narrative-collateral-charter]] · M2 | M2 owns the argument for a room; Growth owns the page for a stranger |
| Distribution on feeds and in communities | [[social-community-charter]] · M3 | Search mechanics vs feed mechanics. M3 is dormant until G3 passes its first article |
| The recovery number itself | [[design-partner-operations-charter]] · S1 | S1 produces *verified dollars recovered*; G3 refuses to publish anything stronger |
| Pricing, tiers, and any number attached to them | [[unit-economics-pricing-charter]] · F2 | **Founder-deferred.** Growth proposes no pricing and sketches no page for it |
| The metrics narrative and the analytics engine | [[analytics-bi-charter]] | Growth consumes insight output; owning it here would duplicate a locked department |
| Legal basis, DPAs, consent wording | [[compliance-privacy-charter]] | Growth may need a consent surface; it never drafts the notice |
| The app's own routes, bundle, and status codes | [[client-surfaces-charter]] · [[platform-api-charter]] | Growth states the requirement (a real 404, a server-rendered title); Engineering ships it |
| Paid acquisition | nobody, deliberately | No budget, no pricing, no list. Rejected at [[commercial]] §1.4 rather than chartered empty |

## Metrics it moves

Growth publishes **five team numbers plus three hard zeros**, and never rolls them into a
single "growth score". The five are not commensurable: a keyword gap and a conversion rate
do not sum, and a department that averages them can report health while the pipeline is
broken at exactly one stage.

**The five:**

- `demand.uncovered_keyword_count` — Search Console queries with ≥10 impressions and no
  published page. Direction: down. Baseline: unmeasurable, because there is no Search
  Console property and no published page.
- `content.published_units_per_week` — units that cleared G3 on first pass. Counting
  *drafts* would make the gate look like friction rather than the product.
- `editorial.claims_traceable_pct` — target 100%.
- `seo.indexed_pages` and `answer_surface.assistant_citations` — the second is the one the
  founder actually asked for and the one no standard SEO dashboard reports.
- `funnel.visit_to_activated_rate` — where *activated* means first POS-connected day, not
  signup. A signup that never connects Toast is worth nothing to this product.

**The three zeros**, which override any of the five:

- `editorial.gate_bypass_count` = 0. One bypass invalidates the pipeline, not one article.
- `funnel.fabricated_social_proof_count` = 0. Absolute, unrecoverable if breached.
- Published claims stronger than the evidence = 0. Specifically: **"dollars recovered"
  currently means *we asked*, not *we received*** ([[YC_WEDGE_PLAN]]:31-33). See
  [[editorial-gate-charter]].

**Two diagnostics** that exist to stop a checklist reading green on an empty site:
`seo.soft_404_rate` (baseline **100%** — see Evidence) and `funnel.measurable_steps`
(baseline **0** for any pre-login step).

**Neural footprint tie.** G2's drafting is an agent task and should emit `nf_a.*` like any
other — task type, model, tokens, latency, cost, doneability verdict ([[README]] §4.2).
The cost half already has an insertion point at
`services/agent-orchestrator/services/spend_logger.py`; the doneability half is exactly
G3's verdict, which makes the editorial gate the natural producer of the outcome field
rather than a step outside the metric spine. Growth touches `nf_b.*` not at all, and says
so rather than inventing a link.

## Evidence today

**NEW as a department.** Two of five teams are `PARTIAL` on machinery that exists for
another purpose; three are `NEW`. Verified 2026-08-24 against the working tree.

**What does not exist:**

- **No marketing site and no publishing target.** `apps/web` is the authenticated product.
  The only public route with real content is the vendor catalogue at
  `apps/web/src/App.tsx:161` (`/v/:slug`); `apps/web/src/App.tsx:158` (`/privacy`) is the
  only other public page that is not auth plumbing ([[PAGE_MAP]]).
- **No `robots.txt`, no sitemap, no `llms.txt`.** `apps/web/public/` contains exactly
  seven files: `badge.png`, `empty.map`, `icon-192.png`, `icon-512.png`, `logo.png`,
  `manifest.json`, `sw.js`.
- **No search or acquisition tooling.** `env.example` (187 lines) contains no Perplexity,
  Search Console, AnswerThePublic, or product-analytics key; Sentry is the only telemetry
  SDK in [[EXTERNAL_CONNECTIONS]].
- **No `<meta og:*>`, no `<meta twitter:*>`, no `<link rel="canonical">`** anywhere in
  `apps/web/index.html`.

**Two verified defects that are worse than the team doc recorded:**

1. **The soft 404 is a two-layer defect, not one line.** `apps/web/src/App.tsx:302`
   redirects every unmatched path to `/` client-side. *Above* it,
   `vercel.json:11-13` rewrites `/((?!api/|assets/).*)` to `/index.html`, so the CDN
   returns **HTTP 200** for every nonexistent URL before React ever loads. A crawler asking
   for a URL that does not exist receives 200 plus a shell titled
   `WineOps AI - Restaurant Wine Management` (`apps/web/index.html:7`). `seo.soft_404_rate`
   baseline is therefore **100%**, and fixing it requires a change at the hosting layer as
   well as in the router. The seam is named in [[growth-directive]].
2. **The instrument G5 needs exists, on the wrong side of the login wall.**
   `apps/web/src/lib/uxSignals.ts` is a real interaction-telemetry client — rage clicks,
   dead clicks, time-to-interactive — reporting to `apps/api-gateway/src/ux-optimizer/`.
   It ships dark behind `VITE_UX_OPTIMIZER === "true"` (`:15`) and buckets on the
   authenticated user id (`:20-23`). It can therefore never observe a first visit. This is
   a **correction to [[commercial]] §1.3 G5**, which recorded "no product analytics of any
   kind": the mechanism exists, it is post-authentication, and that distinction is the
   whole of G5's instrumentation problem.

**What does exist and transfers:**

- **schema.org JSON-LD is genuinely emitted**, server-side, at
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:123-141`, exposed on a
  `@Public()` route at `apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:39-41`,
  and mirrored client-side at `apps/web/src/pages/VendorPortal.tsx:118-137`. The service
  comment at `:119-120` states a principle Growth should adopt wholesale: *a zero-price
  Offer is a valid document and a false statement*, so listings with no price emit no
  Offer. That is the answer-surface discipline already written down in this repo.
- **Breadcrumbs exist as a component** (`apps/web/src/components/layout/Breadcrumbs.tsx:14`)
  and are used on exactly one page (`apps/web/src/pages/InsightCatalog.tsx:228`).
- **A 404 presentation component exists and is routed nowhere**:
  `apps/web/src/components/ui/error-state.tsx:142` exports `NotFoundError`, referenced only
  by its own Storybook file. The custom-404 checklist item is closer than it looks.
- **Human-gated publication is the shipped default in this codebase**, which is what makes
  G3 native rather than imported: vendor-reply drafts never auto-send, and one-tap
  recommendation actions require a person.
- **Claude drafting cost is already metered** at
  `services/agent-orchestrator/services/spend_logger.py`, whose header states that
  `log()` must never raise.
- **The activation path exists**: `apps/api-gateway/src/auth/auth.service.ts:650-651` →
  `apps/api-gateway/src/communications/gmail.service.ts:702`.

**One published statement that constrains the department.** `apps/web/src/pages/Privacy.tsx:30-31`
tells every reader: *no tracking or advertising cookies, no consent banner, because there
is nothing to consent to*, and `:48-49` says interaction telemetry is off unless explicitly
enabled. Growth was handed "cookie consent" as a technical-SEO checklist item and needs
funnel instrumentation to do its job. **Shipping either one makes a live page false.** This
is a department-level conflict, it is verified, and it is [[growth-premortem]] M4.

## Open forks touching this department

- **CM-F1 — Growth at 5 teams or 4?** Should [[content-production-charter]] and
  [[editorial-gate-charter]] merge? **Recorded, not resolved**, per assignment.
  *For 5:* the gate is the only mandatory human step and the only one with a veto; a gate
  reporting to the team it gates is not a gate ([[ORG_STRUCTURE]] §3 makes the same
  argument for advisory independence). *For 4:* one founder is currently both the writer
  and the editor, so the split is organizational fiction until there is a second person.
  **Neither side is acted on here.** The department is written as five teams because the
  directory layout is five teams; if CM-F1 resolves to four, the merge is a documented
  operation, not a rewrite — G3's artifacts survive intact as a section inside G2, and only
  `editorial.gate_bypass_count` needs a new owner.
- **CM-F2** — Does the FAQ answer layer need its own team? Currently inside
  [[content-production-charter]]. Charter it only if link-graph integrity becomes a
  standing defect; `content.faq_orphan_pages` is the number that would say so.
- **CM-F4** — Is Growth the right parent for Finance & Pricing? Raised, not argued.
- **OD-19 / OD-20** — `apps/api-gateway/src/analytics/analytics.controller.ts:44` declares
  `@Controller("analytics")` with no `@UseGuards`. Growth will want those numbers and must
  not become the reason the exposure is left open. Security's call, not ours.
