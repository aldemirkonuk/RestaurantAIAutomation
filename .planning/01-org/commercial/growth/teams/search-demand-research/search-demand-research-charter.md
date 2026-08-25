---
type: charter
division: commercial
department: growth
team: search-demand-research
status: new
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, demand.queue_rejection_reasons]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[search-demand-research-premortem]]", "[[search-demand-research-agenda-full]]", "[[search-demand-research-agenda-board]]", "[[search-demand-research-directive]]", "[[search-demand-research-loops]]", "[[search-demand-research-schedule]]", "[[content-production-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[analytics-bi-charter]]", "[[narrative-collateral-charter]]", "[[commercial]]", "[[YC_WEDGE_PLAN]]", "[[EXTERNAL_CONNECTIONS]]"]
---

# Search Demand Research — Charter

Team **G1** of [[growth-charter]]. Division: Commercial.

## Mandate

G1 owns the **topic queue**, and the queue is the department's only compounding asset.
Three intakes feed it:

1. **The harvested search set.** During Perplexity research on a topic, the assistant runs
   a set of web searches. **Those exact queries are the keyword corpus** — not a keyword
   tool's suggestion list, not a volume estimate. This is the founder's specification and
   G1 treats it as a contract: the corpus is what a competent researcher actually asked in
   order to understand the subject, which is a far better proxy for what a restaurant owner
   asks than a search-volume export.
2. **AnswerThePublic.** Per topic, the **ten most distinct** questions. Distinctness is
   G1's job and it is decided before drafting, not discovered afterwards as duplicate
   content ([[content-production-charter]] owns the pages; G1 owns which ten).
3. **Google Search Console.** Queries sorted by impressions; every query with real demand
   and no page that answers it is a gap, and the gap is the input that makes the pipeline
   self-correcting.

The corpus outlives every article that consumes it. An article is a spend of the queue; the
queue is the balance.

## Boundaries

Owns outright:

- **The topic queue** — its contents, its ordering, and the rejection record. A query that
  is looked at and not queued gets a written reason, so it is not re-litigated monthly.
- **The harvest itself** — capturing the searches a research session ran, before that
  session's context is discarded. This is a capture problem, not a research problem, and
  nobody else is positioned to notice the loss.
- **The distinctness call** on the ten AnswerThePublic questions.
- **The Search Console read** and the monthly gap report ([[growth-loops]] L-GRO-1).
- **The wedge test.** Every corpus term is tagged as inside or outside the
  beverage-invoice wedge before it can be commissioned.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Writing anything | [[content-production-charter]] | G1 produces a brief and a queue, never a draft |
| Whether a page is indexed or cited | [[technical-seo-ai-answer-surface-charter]] | G1 says what demand exists; G4 says whether we can be found answering it |
| The metrics narrative and the analytics engine | [[analytics-bi-charter]] | Search Console is an external data source G1 reads, not an analytics platform G1 owns |
| Which claim the company leads with | [[narrative-collateral-charter]] · M2 | G1 finds the questions; M2 owns the answer's headline |
| Paid keyword bidding | nobody, deliberately | No budget, no pricing. Rejected at [[commercial]] §1.4 |
| Target-account or ICP research | Sales, and **founder-deferred** | Search demand is not a target list, and G1 does not sketch one |

## Metrics it moves

**Primary — `demand.uncovered_keyword_count`.** Search Console queries with ≥10
impressions and no published page that answers them. **Direction: down.** Baseline:
unmeasurable, because there is no Search Console property and no published page.

**Secondary — `demand.wedge_share_of_corpus`.** Share of corpus terms tagged inside the
beverage-invoice wedge. Direction: up, with a floor rather than a target. This exists
because G1's failure mode is producing a large, healthy-looking corpus of generic
restaurant-software terms while the pipeline the company actually needs starves
([[YC_WEDGE_PLAN]]:323 names surface area as the biggest risk in this repo). A corpus can
grow and get worse; one number cannot show that, so there are two.

**Diagnostic — `demand.queue_rejection_reasons`.** A count by reason. A month with zero
rejections means the queue is accepting everything, which is the same signal a 0% editorial
rejection rate gives ([[editorial-gate-charter]]): not clean input, absent judgement.

Neural footprint: G1's harvest is itself an agent task and should emit `nf_a.*` like any
other once the spine is live ([[README]] §4.2). No `nf_b.*` tie exists and none is invented.

## Evidence today

**NEW.** Nothing in the repo serves this purpose, and the honest statement is that G1 has
no tooling, no data, and no account.

- **No search or demand tooling is configured.** `env.example` (187 lines) contains no
  Perplexity, Search Console, or AnswerThePublic key. Sentry is the only telemetry SDK in
  [[EXTERNAL_CONNECTIONS]], whose 50 runtime hosts include none of the three.
- **No Search Console property exists**, because there is no verified domain with indexed
  content: no `robots.txt`, no sitemap, and one public content route
  (`apps/web/src/App.tsx:161`).
- **Nearest prior art, and it is genuinely near.**
  `services/agent-orchestrator/api/research_routes.py` runs an external-source research path
  at scale for wine-fact enrichment. The harness transfers — scheduled research, external
  fetch, structured capture, cost metering via
  `services/agent-orchestrator/services/spend_logger.py` — but the purpose does not: it
  harvests *facts about wines*, not *demand signals about buyers*. Citing it as evidence
  that demand research is half-built would be a misreading.

**One risk this charter does not resolve** and which [[commercial]] §7 flagged: **no
external tooling was checked.** Whether Perplexity exposes the queries it ran, whether
AnswerThePublic has a usable API at this volume, and whether Search Console's export limits
matter at this scale are all unverified. The `NEW` grade above describes the repo, not the
vendor landscape. If Perplexity does not expose its search set programmatically, the
founder's step 1 becomes a manual capture, which is workable at one topic a week and
impossible at ten. **Verifying that is G1's first task**, ahead of any harvesting.

## Why this is a team and not a section of Content Production

Its output outlives every article that consumes it, and its craft is data acquisition, not
writing. Folded into [[content-production-charter]], the queue would only ever be as long
as the next deadline, and the Search Console loop — the single mechanism that makes the
pipeline self-correcting rather than a content calendar — would be the first thing dropped
under pressure, because it is the only stage with no visible weekly output.
