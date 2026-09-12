---
type: agenda-board
division: commercial
department: growth
status: active
metrics: []
updated: 2026-08-28
links: ["[[growth-charter]]", "[[growth-agenda-full]]", "[[growth-loops]]", "[[growth-schedule]]", "[[growth-premortem]]", "[[growth-agent-stack]]", "[[growth-questions]]", "[[0039-activation-plan-of-record]]"]
---

# Growth — Board

**Active, dated 2026-08-28.** Bullets and queries only. Prose belongs in
[[growth-agenda-full]]; the sixteen tasks and their evidence live there, not here.

## Every Growth artifact, live

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth"
SORT default(team, "") ASC, type ASC
```

## Agendas still provisional — the wave-3 burn-down

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth"
WHERE (type = "agenda-full" OR type = "agenda-board") AND status = "provisional"
SORT default(team, "") ASC
```

## Charters by evidence grade

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT status ASC, team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  default(team, "— dept —") AS Unit,
  updated AS "Last touched"
FROM "01-org/commercial/growth"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/commercial/growth"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Premortem coverage — every team must have one

```dataview
LIST
FROM "01-org/commercial/growth"
WHERE type = "premortem"
SORT default(team, "") ASC
```

## Findings routed here — advisory is findings-only, and nothing blocks

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  open_questions AS Open,
  updated AS Updated
FROM "01-org/commercial/growth"
WHERE type = "questions" AND open_questions > 0
SORT open_questions DESC
```

## The five team outcomes (hand-entered until the jobs exist)

No activity counters on this board by design — no drafts written, no keywords harvested, no
checklist percentage. [[growth-premortem]] M1 and M3 are both the department reporting
activity instead of outcome. Every row carries a value, the word **blocked**, or
**unmeasurable** with its failed precondition named — never a composite score
([[growth-agent-stack]] §2 `quality_bar`).

- [ ] `demand.uncovered_keyword_count` — **unmeasurable**: no Search Console property, no verified domain
- [ ] `content.published_units_per_week` — **0**, correctly, until a publishing target exists (GRO-4)
- [ ] `editorial.claims_traceable_pct` — **n/a → computable at GRO-11**: nothing published, provenance format unwritten until GRO-10
- [ ] `seo.indexed_pages` — **0**: no `robots.txt`, no sitemap, no content route. GRO-6 tests whether `/v/:slug` changes this without any decision
- [ ] `answer_surface.assistant_citations` — **0, unmeasured**. GRO-7 builds the instrument; every number it prints carries the word *sampled*
- [ ] `funnel.visit_to_activated_rate` — **unmeasurable**: `funnel.measurable_steps` = 0 pre-login

## The three zeros — any non-zero is a department-level escalation

- [ ] `editorial.gate_bypass_count` — **0**. One bypass invalidates the pipeline, not one article
- [ ] `funnel.fabricated_social_proof_count` — **0**. Absolute; unrecoverable if breached
- [ ] Published claims stronger than the evidence — **0**. *Dollars recovered* means **we asked**, not we received ([[YC_WEDGE_PLAN]]:31-33)

## Diagnostics that stop a checklist reading green on an empty site

- [ ] `seo.soft_404_rate` — **100%** baseline, asserted not measured until GRO-5. `vercel.json:13-16` returns 200 for every unmatched URL; `apps/web/src/App.tsx:328` then redirects client-side *(both citations re-verified 2026-08-28; wave-1 docs cite `:12-15` and `:302` — drifted)*
- [ ] `funnel.measurable_steps` — **0** pre-login. `apps/web/src/lib/uxSignals.ts:15` ships dark; `:21` buckets on the authenticated user id
- [ ] `demand.wedge_share_of_corpus` — **n/a**: no corpus yet. GRO-2 creates the first one

## OD-53 — settled 2026-08-28, both halves, by fetch

- [x] **(a) Perplexity search-history endpoint — NO.** No endpoint in the published index returns a user's own searches/threads/Library; the API is zero-retention by policy. `https://docs.perplexity.ai/llms.txt`, `https://docs.perplexity.ai/faq/faq` — retrieved 2026-08-28
- [x] **(b) AnswerThePublic API — Alpha, per-workspace, personal access token, 60 req/min, paid plans only.** `https://answerthepublic.zendesk.com/hc/en-us/articles/15219088022555-Does-AnswerThePublic-Have-an-API` — retrieved 2026-08-28. Pricing: Starter $20/mo · Growth $99/mo · Business $199/mo, `https://answerthepublic.com/pricing` — retrieved 2026-08-28
- [ ] **Residual unknown, not closed:** which paid tier actually carries API access. The help centre says "paid plans"; the pricing page lists no API line on any tier. GRO-3 confirms with the vendor before any spend proposal
- [ ] Register row is [[decision-office-charter]]'s to write. Growth supplies the dated lines and does not edit the register

## Blocking decisions

- [ ] **Publishing target** — inside `apps/web`, separate surface, or static generator. Blocks eight items. **Still not in [[OPEN-DECISIONS]]** as of 2026-08-28; GRO-4 delivers the brief with a recommendation
- [ ] **CM-F1** — merge [[content-production-charter]] and [[editorial-gate-charter]]? **Recorded, not resolved**
- [ ] **Domain** — `wineops.ai` still live; `apps/web/index.html:7` still titles every page *WineOps AI*
- [ ] **Pre-login measurement vs. the published privacy position** (`apps/web/src/pages/Privacy.tsx:31`) — [[compliance-privacy-charter]] holds the pen

## Standing prohibitions

- [ ] Growth proposes **no pricing** — founder-deferred, [[unit-economics-pricing-charter]] owns it
- [ ] Growth designs **no brand or landing visuals** — HELD (ADR 0039, founder re-confirmed 2026-08-28)
- [ ] Growth sketches **no target list** — founder-deferred, Sales owns it
- [ ] No social proof without a named, consenting counterparty and a dated artifact
- [ ] **No agent publishes.** Drafts propose; a human publishes. `mutate_stock_money_outbound: confirm` is a constant on the department card
