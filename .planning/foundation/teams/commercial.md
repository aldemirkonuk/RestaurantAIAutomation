---
type: division-teams
division: commercial
status: proposed
date: 2026-08-24
departments: [growth, sales, media-and-brand]
sublayers: [finance-and-pricing]
team_count: 13
keywords: [teams, growth, seo, aeo, editorial, sales, brand, consent, unit-economics, premortem]
links:
  - "[[ORG_STRUCTURE]]"
  - "[[README|foundation-README]]"
  - "[[EXTERNAL_CONNECTIONS]]"
  - "[[PAGE_MAP]]"
  - "[[YC_WEDGE_PLAN]]"
  - "[[OPEN-DECISIONS]]"
---

# Commercial — team layer

- **Status:** PROPOSED. Departments are locked ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)); the teams below are not.
- **Scope:** Growth (with the Finance & Pricing sub-layer), Sales, Media & Brand.
- **Count:** 13 teams. Growth 5 · Finance & Pricing 2 · Sales 2 · Media & Brand 4.
- **Two things this document deliberately does not do:** propose a pricing model, or
  sketch a target list. Both are founder-deferred. Each has a named owner and nothing more.

---

## 0. What earned a team

Per-team justification uses one test: **a team exists when its metric, its craft, and its
failure mode all differ from its siblings.** Two out of three is a sub-mandate inside an
existing team, not a new one.

Applied honestly, that produced an asymmetric division: Growth carries five teams because
the founder specified a six-stage pipeline plus two checklists that genuinely pull apart;
Sales carries two because its first target list is deferred and there is exactly one
customer. The asymmetry is the finding, not a gap to fill.

Each department also carries a **Considered and not chartered** list. That list is doing as
much work as the charters — it is the record of what was rejected and why, so the next
session does not re-propose it.

**Evidence grades:** `EXISTS` (running code or shipped schema), `PARTIAL` (machinery exists
but not for this purpose), `NEW` (nothing in the repo; must be built). Every `EXISTS` and
`PARTIAL` carries a `path:line`.

---

## 1. Growth

### 1.1 The mandate as specified

Growth owns one named pipeline and two named checklists.

**The pipeline** (founder-specified, verbatim in shape):

```
Perplexity research  →  harvest the exact searches it ran = the keyword set
        ↓
Claude writes the long-form SEO article
        ↓
MANDATORY human edit pass  (brand voice · fact-check · no em dashes · no buzzwords)
        ↓
publish
        ↓
AnswerThePublic → 10 most distinct questions
        ↓
~120-word Perplexity answer per question → one page each, each linking back to the article
        ↓
Google Search Console: high-impression / no-content keywords  ──┐
        ↑                                                       │
        └───────────────────────── back to step 1 ──────────────┘
```

The stated strategic point is **ranking inside AI assistant answers**, not only classic
search. That is why G4 below is not simply "technical SEO."

**The checklists:** technical SEO (sitemap, canonical tags, `llms.txt`, schema.org, Core Web
Vitals) and conversion/UX (custom 404, CTA above fold, breadcrumbs, sticky mobile CTA, case
studies, real reviews only).

### 1.2 The ground truth this pipeline lands on

Verified 2026-08-24, and it is thinner than the plan assumes:

- **There is no marketing site.** `apps/web` is the authenticated product. The only public
  HTML route with real content is the vendor catalogue at `apps/web/src/App.tsx:161`
  (`/v/:slug`); the rest of the public list is auth plumbing — login, register, reset,
  verify, invite, no-access, privacy ([PAGE_MAP.md](../PAGE_MAP.md)).
- **No `robots.txt`, no sitemap, no `llms.txt`** anywhere under `apps/`.
- **No search or analytics tooling is configured.** `env.example` (187 lines) has no
  Perplexity, Search Console, or product-analytics key; Sentry is the only telemetry SDK in
  [EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md).
- **Titles are set after mount** (`apps/web/src/pages/VendorPortal.tsx:154`), so a crawler
  that does not execute JS sees only the static shell — which still says WineOps
  (`apps/web/index.html:7`).

Growth is close to greenfield. Saying so up front is what keeps the checklists from being
graded green against an app shell nobody can reach.

### 1.3 Teams

---

#### G1 · Search Demand Research

**Mandate.** Own the topic queue. Harvest the exact searches Perplexity runs during research
and treat that set as the keyword corpus; mine AnswerThePublic for the ten most distinct
questions per topic; ingest Google Search Console high-impression/no-content keywords back
into the queue. The corpus is the asset, not any single article.

**Why distinct from siblings.** This is data acquisition, not writing. Its output outlives
every article that consumes it. Folded into Content Production, the queue would only ever be
as long as the next deadline, and the Search Console loop — the one mechanism that makes the
pipeline self-correcting — would be the first thing dropped under pressure.

**Evidence.** `NEW`. No search tooling is configured (§1.2). The nearest prior art is the
enrichment research path (`services/agent-orchestrator/api/research_routes.py`), which
harvests external sources at scale — but for wine facts, not demand signals. The harness
transfers; the purpose does not.

**Primary metric.** *Queue coverage*: share of Search Console keywords with ≥10 impressions
and no published page. Direction: down.

**Premortem.** It harvests generic restaurant-software keywords instead of the
beverage-invoice niche, produces volume nobody in the wedge searches for, and Growth reports
rising traffic while the pipeline the company actually needs ([YC_WEDGE_PLAN.md:323](../../YC_WEDGE_PLAN.md)) starves.

---

#### G2 · Content Production

**Mandate.** Claude drafts the long-form article against G1's brief, then the ~120-word
answer page per question. Owns the article↔FAQ link graph: one page per question, each
linking back to the long-form piece.

**Why distinct from siblings.** Writing against a brief is a different craft from finding the
brief (G1), and production is agent-scalable where the gate (G3) structurally is not. Keeping
them together would let the cheap step set the pace of the expensive one.

**Evidence.** `PARTIAL`. Claude drafting for outward-facing prose is already shipped and
human-gated — the vendor-reply draft path drafts and never auto-sends, and templated outbound
lives at `apps/api-gateway/src/communications/email-templates/vendor-action.template.ts`.
Drafting cost is already metered at
`services/agent-orchestrator/services/spend_logger.py`. What does not exist: a content repo,
a CMS, or a publishing target.

**Primary metric.** *Published units per week that clear G3 first-pass.* Counting drafts
rather than published units would make the gate look like friction instead of the product.

**Premortem.** The FAQ layer becomes ten near-identical thin pages that read as doorway
pages, and the long-form article's authority is diluted by the exact layer built to feed it.

---

#### G3 · Editorial Gate

**Mandate.** The mandatory human pass. Nothing publishes without it. Three checks: every
factual claim traced to a source; the banned-construction list enforced (em dashes,
"streamlined" and its family); conformance to the voice guide that Media & Brand owns (M1).

**Why distinct from siblings.** It is the only non-automatable step in the pipeline, and the
founder specified it as mandatory. A gate that reports to the team it gates is not a gate —
the same argument [ORG_STRUCTURE §3](../ORG_STRUCTURE.md) makes for advisory independence.
It also carries a fact-check obligation no other Growth team has:
[YC_WEDGE_PLAN.md:31-33](../../YC_WEDGE_PLAN.md) establishes that "dollars recovered"
currently means *we asked*, not *we received* — verified recovery requires watching an 812
credit memo arrive. Publishing the stronger claim would not be marketing gloss; it would be
false.

**Evidence.** `NEW` as a function. The rules exist only as founder instruction, and the voice
guide it is supposed to enforce does not exist yet (M1 owns writing it). The structural
precedent in the repo is real, though: human approval before send is already the shipped
default for vendor email and one-tap recommendations, so the pattern is native here rather
than imported.

**Primary metric.** *Published claims traceable to a cited source* — target 100%. Rejected
draft rate is the health signal, not the goal; a 0% rejection rate means the gate is not
reading.

**Premortem.** The founder is the only editor, becomes the bottleneck, and the gate is
quietly suspended for one launch week. The first bypassed article is the one that publishes
an unverified recovery number, and a number is the one thing a reader will check.

---

#### G4 · Technical SEO & AI Answer Surface

**Mandate.** Sitemap, canonical tags, `llms.txt`, schema.org markup, Core Web Vitals, crawl
and index health — plus the answer-surface half: making pages extractable and citable by AI
assistants, which is a different mechanism from blue-link ranking.

**Why distinct from siblings.** Engineering-adjacent work measured on crawl and citation
health, not readership. Merging it into Content would put a checklist with no reader-facing
metric in the hands of a team graded on published volume, and it would be deprioritized every
week.

**Evidence.** `PARTIAL`, and thinner than it looks. schema.org JSON-LD is genuinely emitted —
`apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:127`, exposed through a
`@Public()` endpoint at `apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:39-41`
and mirrored client-side at `apps/web/src/pages/VendorPortal.tsx:123`. But that is the vendor
catalogue, not Mudavym's content. Against it: no `robots.txt`, no sitemap, no `llms.txt`;
client-side titles (`apps/web/src/pages/VendorPortal.tsx:154`); and a static shell still
branded WineOps (`apps/web/index.html:7`).

**Primary metric.** *Indexed-and-cited pages*: pages in the index, plus assistant answers
citing a Mudavym URL. The second half is the one the founder actually asked for and the one
no standard SEO dashboard reports.

**Premortem.** The team optimizes Core Web Vitals on an app shell with no public content,
reports a fully green checklist, and nothing is indexable because the only crawlable route is
a vendor catalogue nobody searches for.

---

#### G5 · Conversion & Funnel

**Mandate.** The conversion/UX checklist — custom 404, CTA above the fold, breadcrumbs,
sticky mobile CTA, case studies, real reviews only — plus funnel instrumentation from first
visit to activated restaurant.

**Why distinct from siblings.** Content earns the visit; this earns the account. Its failure
is invisible to every other Growth team, all of which would report success while conversion
sat at zero.

**Evidence.** `PARTIAL`, with two verified gaps. **There is no custom 404**:
`apps/web/src/App.tsx:302` redirects every unmatched path to `/`, which is a dead end for a
visitor and a soft 404 for a crawler. **There is no product analytics of any kind** — Sentry
is the only telemetry SDK in [EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md), so no
funnel step is currently measurable. What does exist: the activation email path,
`apps/api-gateway/src/auth/auth.service.ts:651` →
`apps/api-gateway/src/communications/gmail.service.ts:702`.

**Primary metric.** *Visit → activated restaurant*, where activated means first POS-connected
day. Not signups; a signup that never connects Toast is worth nothing to this product.

**Premortem.** "Real reviews only" collides with having one customer. The team either ships
an empty social-proof section or invents one. The first is merely weak; the second is
unrecoverable, and it would be Growth that did it, not Sales.

---

### 1.4 Considered and not chartered — Growth

| Candidate | Why not |
|---|---|
| **Answer Layer / FAQ** as its own team | Different page shape, but same writers, same brief, same gate. Charter it only if link-graph integrity becomes a standing defect. See fork CM-F2. |
| **Analytics narrative** | The metrics story belongs to Intelligence → Analytics & BI ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)). Growth consumes it; owning it here would duplicate a locked department. |
| **Paid acquisition** | No budget, no pricing, no target list. There is nothing to own yet, and chartering it would produce a document that cannot change for a year. |
| **Community/forum content** | Distribution, not production. Sits with M3. |

---

## 2. Finance & Pricing *(sub-layer under Growth)*

Two teams, deliberately unequal: one has live data, one has none. Merging them would let the
first launder credibility onto the second.

---

#### F1 · Inference Cost

**Mandate.** Cost per agent task, per model, per provider. Budget caps and breach handling.
The economic input to model-routing decisions.

**Why distinct from F2.** Per-task grain, and its consumer is Technology → Research & Math's
routing loop, not a revenue conversation. It is also the only part of this sub-layer with
real data today.

**Evidence.** `EXISTS`, and it is the strongest evidence in this division.
`services/agent-orchestrator/services/spend_logger.py` is the single insertion point for
every Claude and Gemini call, recording provider, model, input/output tokens, `cost_usd` and
`restaurant_id`. It writes `public.api_spend`
(`supabase/migrations/20260805000000_baseline_from_production.sql:2231`), indexed by
provider+timestamp (`:8548`) and restaurant+timestamp (`:8555`). Caps run hourly:
`services/agent-orchestrator/jobs/spend_tasks.py:24-27` sets Anthropic $40 / Google $16 at
80% of hard caps, alerting on breach. One gap worth naming: Anthropic and Gemini are called
over raw HTTP rather than their SDKs
([EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md), SDK note), so token accounting is
hand-rolled and can drift from provider billing.

**Primary metric.** *Cost per completed task*, by task type — the NF-A `cost` field
([foundation README §4.2, §4.4](../README.md)).

**Premortem.** `SpendLogger.log()` is designed never to raise; its own header says a logging
failure must not interrupt the pipeline. That is correct engineering and a reporting hazard:
a silent logging failure looks exactly like a cheap month. The team reports falling cost per
task while the provider invoice climbs, and nobody reconciles the two because reconciliation
was never anyone's job.

---

#### F2 · Unit Economics & Pricing

**Mandate.** Cost to serve one restaurant, gross margin per account, acquisition cost
attributable to Growth's own content effort — and ownership of the pricing decision when it
un-defers.

> **Pricing is founder-deferred.** This team is chartered to own that decision and proposes
> no model, no tier, and no number here.

**Why distinct from F1.** Per-account grain rather than per-task; its consumers are Corporate
→ Strategy & Fundraising and Sales, not the harness. Kept separate so "we have cost data" is
never mistaken for "we have unit economics."

**Evidence.** `NEW`, deliberately dormant. There is no revenue, no billing code, and no
pricing surface: no payment processor appears among the 50 runtime hosts in
[EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md), and there is no `/pricing` route among
the web pages ([PAGE_MAP.md](../PAGE_MAP.md)). The one ingredient that does exist is
per-restaurant cost attribution via `api_spend.restaurant_id`.

**Entry trigger** (explicit, matching the pattern used for NF-C at
[foundation README §4.3](../README.md)): the first restaurant that is not the design partner,
or the founder un-deferring pricing, whichever comes first. Until then the team publishes one
number and nothing else.

**Primary metric.** *Gross margin per restaurant-month* after the trigger. Before it: *cost
to serve per restaurant-month*, computed from `api_spend`.

**Premortem.** Pricing gets set implicitly by the first invoice the founder sends a friend,
and that number anchors the company before this team writes its first document. Deferring the
decision is not the same as deferring the anchor.

---

### 2.1 Considered and not chartered — Finance & Pricing

| Candidate | Why not |
|---|---|
| **Billing / RevOps** | No revenue, no payment processor, no invoices. Would be pure fiction. |
| **Infrastructure cost** (Vercel/Supabase/Railway) | Real but tiny — the stated deployment budget is $10–20/month ([PROJECT.md:136](../../PROJECT.md)). A line item inside F1, not a team. |
| **Fundraising model** | Corporate → Strategy & Fundraising owns it. F2 supplies the inputs. |

---

## 3. Sales

**Context that shapes the count.** [OD-09](../../decisions/OPEN-DECISIONS.md) is resolved:
the founder overruled the recommendation to merge Sales into Growth, so Sales is a department
by intent. But the first outbound target list is **founder-deferred**, and there is exactly
one known user — a friend's Turkish restaurant in San Francisco on Toast
([PROJECT.md:127](../../PROJECT.md)). Two teams is what that honestly supports. Proposing
five would be inventing an org for a pipeline that does not exist.

---

#### S1 · Design Partner Operations

**Mandate.** Own the single Toast restaurant end to end: get it connected, keep it running,
maintain weekly contact, and extract the evidence the rest of the division depends on — the
recovery number, the case study, the sixty-second demo.

**Why distinct from S2.** Operational relationship work with one named counterparty. It is
the only real sales surface that exists today, and its craft (being present, unblocking,
observing) has nothing in common with building a sending machine.

**Evidence.** `EXISTS` as a relationship, `PARTIAL` as an operation. The customer is real
with full API access ([PROJECT.md:127](../../PROJECT.md)) — but the connection is not made:
`DEP-06: Toast API credentials configured for friend's restaurant` is still unchecked
([PROJECT.md:101](../../PROJECT.md)). The value to be demonstrated is
`apps/api-gateway/src/procurement/invoice-match.ts` (sound and tested,
[YC_WEDGE_PLAN.md:129](../../YC_WEDGE_PLAN.md)), whose headline check currently cannot fire
because the invoice half is typed by hand per line item —
`apps/web/src/pages/inventory/command/ReceivingWorkspace.tsx:401,440`. *(The YC plan cites
`:233,:265` for these inputs; the file has since changed and the current lines are `:401` and
`:440`. The finding holds; the line numbers in that document are stale.)*

**Primary metric.** *Verified dollars recovered* — credits that landed, not credits
requested. The distinction is load-bearing and comes from the repo's own analysis:
[YC_WEDGE_PLAN.md:31-33](../../YC_WEDGE_PLAN.md).

**Premortem.** The friendship carries the account. The restaurant never opens the product
unprompted, the founder reads politeness as product-market fit, and the first real prospect
meets a product validated by nobody. This is the highest-probability failure in the division
and it will feel like success the entire time it is happening.

---

#### S2 · Outbound Engine

**Mandate.** The mechanics of reaching restaurants that do not know us: sequence
infrastructure, sending reputation and deliverability, reply routing, and the qualification
rubric. **Not the target list — that is founder-deferred and is not sketched here.**

**Why distinct from S1.** Separating the machine from the list is precisely what lets the
machine be designed while the list stays deferred. It also isolates a risk nothing else owns:
the platform's transactional mail already flows through a single Gmail identity
(`apps/api-gateway/src/communications/gmail.service.ts:78`,
`apps/api-gateway/src/communications/communications.controller.ts:1031`). Cold outbound sent
from that same identity would couple sales deliverability to vendor-facing and
customer-facing delivery — one spam complaint, three broken systems.

**Evidence.** `NEW` for Mudavym's own outbound; `PARTIAL` as reusable machinery. The
inbound-capture shape is built, wired, and dormant:
`apps/api-gateway/src/common/orchestrator/prospects.service.ts:32-45` captures unknown-sender
email, dedupes by domain, never auto-replies, and offers one-tap promotion;
[PROSPECTS_ATTRIBUTION_ARCHITECTURE.md:3-9](../../07-reference/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md)
confirms both controllers are registered and the feature is gated on `INBOUND_EMAIL_DOMAIN`.

> **Read that correctly.** Those "prospects" are *vendors approaching a restaurant*, not
> restaurants Mudavym is selling to. It is a reusable pattern, not an existing sales
> pipeline. Anyone citing it as sales evidence is misreading the module.

**Primary metric.** *Qualified conversation rate* per 100 first-touches. Dormant until the
list un-defers.

**Premortem.** Outbound ships before S1 has a verified recovery number, so the sequence sells
a claim the product has not earned; and deliverability burns on the same domain the product
needs for vendor mail, taking procurement down with it.

---

### 3.1 Considered and not chartered — Sales

| Candidate | Why not |
|---|---|
| **Distributor Connectivity** | Genuinely evidence-backed: [YC_WEDGE_PLAN.md:41](../../YC_WEDGE_PLAN.md) states the X12 feed problem "is a commercial problem, not a technical one." But Product already owns a **Partnerships & Integrations** department ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)), and this is a partnership, not a sale. Raised as fork **CM-F3** rather than claimed. |
| **Target list / ICP research** | Founder-deferred. Not chartered and not sketched. |
| **Sales engineering** | One customer, one POS. Folds into S1 until a second POS is live in a paying account. |
| **Inbound / SDR** | No inbound exists. The `prospects` module is not this (see S2). |

---

## 4. Media & Brand

---

#### M1 · Brand Identity

**Mandate.** Own the name, the marks, and the voice guide that Growth's Editorial Gate (G3)
applies. **Founding assignment: finish the WineOps → Mudavym migration below the doc layer.**

**Why distinct from siblings.** It owns the *definition*; Growth owns the *application*. That
split is what stops "brand voice" from meaning whatever the person writing that day thinks it
means — and it gives G3 something external to enforce rather than an opinion to defend.

**Evidence.** `EXISTS` as a live defect. Verified 2026-08-24; full audit in §4.1 below.

**Primary metric.** *Legacy-brand references remaining in shipped surfaces* — target 0 — plus
a CI check so the class cannot recur. Same recurrence-guard shape Security's first assignment
uses ([foundation README §2.3](../README.md)); a one-time cleanup without the guard is a
cleanup that gets undone.

**Premortem.** The visible references get renamed and the invisible ones do not: the outbound
`From:` address, the crawler User-Agent, the OpenAPI production server. The first vendor, the
first crawled site owner, and the first API partner each meet a company with two names, and
each of those is a person we were trying to look credible to.

---

### 4.1 The WineOps → Mudavym audit (verified 2026-08-24)

**On the count.** [EXTERNAL_CONNECTIONS.md:15](../EXTERNAL_CONNECTIONS.md) reports **10**
references. That is correct *within its scope* — host/URL references under `apps/**` and
`services/**` — and it is the wrong number to plan against, for two reasons. It excludes
non-URL uses of the domain (addresses, Message-IDs, account names), and being host-based it
structurally **cannot see the product name where it is most visible**: `apps/web/index.html`
and `manifest.json` contain "WineOps AI" but no domain, so no host scan will ever flag them.

Verified totals: **33 lines across 26 tracked files**, excluding `md/`, `md_files/`,
generated `openapi.json`, and `dist/` build output.

**Customer- and third-party-visible** (this is the migration that matters):

| Surface | Location | What a third party sees |
|---|---|---|
| Browser tab + any SEO snapshot | `apps/web/index.html:7,8,15` | `WineOps AI - Restaurant Wine Management` |
| PWA install name | `apps/web/public/manifest.json:2-4` | `WineOps AI` / `WineOps` |
| Outbound mail `From:` | `apps/api-gateway/src/communications/gmail.service.ts:78` | `notifications@wineops.ai` |
| Message-ID domain on every sent mail | `apps/api-gateway/src/communications/gmail.service.ts:599` | `@wineops.ai` |
| Links inside vendor-facing email | `apps/api-gateway/src/communications/email-templates/vendor-action.template.ts:31,207` | `https://app.wineops.ai` |
| Email footer site + support address | `apps/api-gateway/src/communications/email-templates/template-config.ts:35,36` | `https://wineops.ai`, `support@wineops.ai` |
| Crawler User-Agent in vendors' server logs | `apps/api-gateway/src/vendor-intel/vendor-page-extractor.service.ts:17` | `WineOpsBot/1.0 (+https://wineops.ai/bot; …)` |
| Public API docs contact + production server | `apps/api-gateway/src/main.ts:127,128,130` | `WineOps Team`, `https://api.wineops.ai` |
| In-product support link | `apps/web/src/pages/Help.tsx:18`, `apps/web/src/pages/Profile.tsx:445` | `support@wineops.ai` |
| Push notification VAPID subject | `apps/api-gateway/src/notifications/notifications.service.ts:66` | `mailto:admin@wineops.ai` |
| Agent-sent dashboard links | `services/agent-orchestrator/agents/notification_agent.py:1623`, `services/agent-orchestrator/services/email_composer_service.py:652` | `https://app.wineops.ai` |
| Agent-sent Message-ID domain | `services/agent-orchestrator/agents/provider_conversation_agent.py:2604` | `@wineops.ai` |

**Internal / lower urgency:**
`apps/api-gateway/src/common/orchestrator/inbound-address.service.ts:27` ·
`apps/api-gateway/src/communications/communications.controller.ts:1031` ·
`apps/api-gateway/src/communications/tests/procurement-email.e2e.spec.ts:35` ·
`services/agent-orchestrator/services/push_notification_service.py:225` ·
`services/agent-orchestrator/demo/demo_weekly_report.py:85,91` ·
`services/agent-orchestrator/demo/demo_ordering_scenario.py:117` · `env.example:31` ·
`scripts/gmail-reauth.js:18` · `scripts/init_database_local.sql:118` ·
`scripts/fix_uuid_migration.sql:24` · `scripts/render_system_atlas.py` ·
`scripts/start_label_studio.sh` · `scripts/test_label_studio.sh` ·
`docker/label-studio/docker-compose.yml:10,31`.

Generated artifacts follow a rebuild rather than an edit: `apps/api-gateway/openapi.json`
(4 refs) and `apps/api-gateway/dist/`. `SKILLS.md:3` is already tracked separately as
[OD-14](../../decisions/OPEN-DECISIONS.md).

**Package and infrastructure identifiers** (`package.json:2`, `@wineops/*` workspace scopes,
`docker-compose.yml` container and network names, `.railway/railway.ts` service names,
`vercel.json:4` build filter) are a **separate decision, not part of this cleanup**. Renaming
a workspace scope touches every import and every deploy target. Flagged as fork **CM-F5**.

---

#### M2 · Narrative & Collateral

**Mandate.** The deck, the one-sentence pitch, the demo script, the case study. The argument,
built for a specific room.

**Why distinct from M1.** Identity is what we are called; narrative is what we claim, to
whom, in what order. Deadline-driven, audience-specific, and it fails differently: a brand
inconsistency is noise, a wrong narrative loses the room in ninety seconds.

**Boundary.** Corporate → Strategy & Fundraising owns the YC path and the process. This team
owns the craft of the artifact, never the decision to apply.

**Evidence.** `PARTIAL`. The narrative is already written and peer-reviewed —
[YC_WEDGE_PLAN.md:312](../../YC_WEDGE_PLAN.md) gives the sentence, `:315` names the metric,
§3 gives the sixty-second demo and an honest competitive read against MarginEdge. What does
not exist is any produced artifact: no deck, no case study, no recorded demo anywhere in the
repo. The surface-area problem named at [YC_WEDGE_PLAN.md:323](../../YC_WEDGE_PLAN.md) is
this team's central design constraint.

**Primary metric.** *One headline claim* — measured by whether every outward artifact leads
with the same sentence. A binary, checked per artifact, because the failure here is
proliferation.

**Premortem.** The deck lists everything the repo contains — the sommelier, the calendar,
promotions, the insight catalogue — because it all exists and was expensive to build. The
reader concludes there is no wedge, which is exactly the failure
[YC_WEDGE_PLAN.md:323](../../YC_WEDGE_PLAN.md) predicts. Nothing needs deleting from the
product; one thing has to be the headline.

---

#### M3 · Social & Community

**Mandate.** Public presence where Growth's output gets distributed and where restaurant
operators actually gather.

**Why distinct from Growth.** Feed mechanics, not search mechanics. G1–G4 optimize for a
query that already exists; this reaches people who are not searching. Different trigger,
different rhythm, different content shape.

**Evidence.** `NEW`. Zero artifacts — no handle, account, or scheduling tool appears among
the 50 runtime hosts in [EXTERNAL_CONNECTIONS.md](../EXTERNAL_CONNECTIONS.md).

**Chartered dormant, with an entry trigger:** the first long-form article clears G3's gate.
Before that there is nothing to distribute, and a dormant feed reads worse than no feed. Same
treatment NF-C gets at [foundation README §4.3](../README.md) — preserved as ambition, not
carried as weight. See fork **CM-F6**.

**Primary metric.** *Referred sessions that reach an activated account.* Not followers.

**Premortem.** Posting starts before the article pipeline does. The account becomes a
low-signal feed of product screenshots, and it is the first result a prospect finds when they
search the company name — which is the one search we are guaranteed to be ranked for.

---

#### M4 · Customer Relationship Research

**Mandate.** Consent-gated research into the people the product serves — what guests and
operators actually do — asked only of those who opted in.

**Why distinct from siblings.** It is the only function in Commercial that touches identified
individuals under a legal gate. Its failure is not a weak quarter, it is a privacy incident.
That risk profile does not belong inside a team whose metric is reach, because reach and
restraint pull in opposite directions.

**Evidence.** `EXISTS` as a substrate, `NEW` as a practice. Consent is modelled and shipped:
`supabase/migrations/20260819000000_guest_identity_minimal_slice.sql:58-64` carries
`consent_purpose`, `consent_notice_version`, `consent_captured_via` (CHECK-constrained),
`consent_captured_at`, and `consent_withdrawn_at`; `:79` and `:114` define an erasure
tombstone where identifiers are hard-deleted and consent fields nulled while the row survives
for referential integrity. A pre-login `/privacy` page already exists
(`apps/web/src/App.tsx:158`). What does not exist is any research practice on top of it.

**Boundaries.** Corporate → Compliance & Privacy owns the legal basis and DPAs; Ethics &
Responsible AI (advisory, [ORG_STRUCTURE §3](../ORG_STRUCTURE.md)) reviews the use; Product →
Guest Experience owns the guest product. This team owns the questions and the findings, and
nothing else.

**Primary metric.** *Findings per consented cohort*, with a hard secondary that overrides it:
**zero** research touching any record whose `consent_withdrawn_at` is set.

**Premortem.** Consent is captured for `service_personalisation` — the schema default at
`:58` — and research quietly reuses it for marketing. The schema records a purpose precisely
so this cannot happen by accident, which means doing it anyway would be deliberate and
permanently documented in the migration history.

---

### 4.2 Considered and not chartered — Media & Brand

| Candidate | Why not |
|---|---|
| **Design / Creative Ops** | One founder and no outward design system yet. Folds into M1 until there is a second person or a recurring output. |
| **PR / Press** | No news, no funding round, no customer count. Nothing true to announce, and announcing something untrue is the failure M2's premortem already covers. |
| **Brand migration** as a standing team | It is a founding assignment plus a CI check, not a permanent mandate. Lives inside M1. |

---

## 5. Boundaries this document asserts

Each row is a claim another division may dispute. Disputes belong in
[OPEN-DECISIONS.md](../../decisions/OPEN-DECISIONS.md), not in a quiet rewrite here.

| Boundary | Commercial owns | The other side owns |
|---|---|---|
| Brand voice | M1 writes the guide | G3 enforces it on published content |
| Metrics narrative | Growth consumes it | Intelligence → Analytics & BI produces it |
| YC | M2 crafts the artifacts | Corporate → Strategy & Fundraising owns the path |
| Guest/customer consent | M4 asks the questions | Compliance & Privacy owns the legal basis; Ethics & Responsible AI reviews the use |
| Cost per task | F1 owns the economics | Research & Math owns the routing decision it feeds |
| Distributor feed access | contested — fork CM-F3 | Product → Partnerships & Integrations |
| Public route auth | — | Intelligence → Security ([OD-19](../../decisions/OPEN-DECISIONS.md)). Noted in passing: `apps/api-gateway/src/analytics/analytics.controller.ts:44` declares `@Controller("analytics")` with no `@UseGuards`, and Growth will want those numbers. |
| Workspace/package renaming | — | Engineering. Fork CM-F5. |

---

## 6. Forks raised by this document

Numbered `CM-Fn` to avoid colliding with parallel division sessions; the Decision Office
should assign OD IDs when these land in
[OPEN-DECISIONS.md](../../decisions/OPEN-DECISIONS.md).

> **Kept as-is 2026-08-24.** `CM-Fn` was the only division namespace that never collided;
> the Decision Office adopted its shape org-wide. See [FORK-REGISTRY](../../02-advisory/decision-office/FORK-REGISTRY.md).

| ID | Fork | The argument on both sides |
|---|---|---|
| **CM-F1** | Growth at 5 teams, or 4 — merge Content Production and Editorial Gate? | **For 5:** the gate is the only mandatory human step, and a gate inside the team it gates is not a gate. **For 4:** one founder is currently both writer and editor, so the split is organizational fiction until there is a second person. |
| **CM-F2** | Does the FAQ answer layer need its own team? | **For:** its risk is link-graph integrity and thin-content penalties, which differ from long-form's risk. **Against:** same writers, same brief, same gate. |
| **CM-F3** | Distributor connectivity — Sales or Product → Partnerships & Integrations? | [YC_WEDGE_PLAN.md:41](../../YC_WEDGE_PLAN.md) calls it a commercial problem; the org already has a partnerships department. Unowned today either way. |
| **CM-F4** | Finance & Pricing sits under Growth ([ORG_STRUCTURE §2](../ORG_STRUCTURE.md)). Correct parent? | Unit economics feeds Strategy & Fundraising and Sales more than it feeds Growth. Raised, not argued — the placement is locked and this is a note for whoever revisits it. |
| **CM-F5** | Brand migration scope: shipped surfaces only, or also `@wineops/*` workspace scopes, container names, and Railway/Vercel service identifiers? | The second set is an Engineering change touching every import and deploy target. Cheap now, expensive later. |
| **CM-F6** | Social & Community: chartered dormant with an entry trigger, or not chartered at all? | Same shape as NF-C ([foundation README §4.3](../README.md)) — preserved ambition versus dead weight. |

---

## 7. What this document did not verify

Stated plainly, per [CLAUDE.md §0.4](../../../CLAUDE.md):

- **No external tooling was checked.** Whether Perplexity, AnswerThePublic, or Search Console
  offer usable APIs at the volume this pipeline implies was not researched. Every `NEW` grade
  in Growth describes the repo, not the vendor landscape.
- **No live surfaces were fetched.** The `restaurant-ai-automation-web.vercel.app` deployment
  was not loaded, so index state, live meta tags, and real Core Web Vitals are unknown. Every
  SEO finding is from source, not from production.
- **The `wineops.ai` audit excludes** `md/`, `md_files/`, `.planning/` history, `dist/`
  output, and git worktrees under `.claude/worktrees/`. Those contain many more references
  and are historical rather than shipped.
- **Loop frontmatter is not written.** [ORG_STRUCTURE §5](../ORG_STRUCTURE.md) requires each
  unit's `loops.md` to carry machine-readable frontmatter. Metrics are named per team above,
  but the loops themselves — what each measures, what it changes, close-time — belong in the
  per-unit artifacts, which do not exist yet.
