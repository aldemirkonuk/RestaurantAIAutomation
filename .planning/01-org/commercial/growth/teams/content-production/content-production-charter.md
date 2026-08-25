---
type: charter
division: commercial
department: growth
team: content-production
status: partial
metrics: [content.published_units_per_week, content.faq_orphan_pages, content.first_pass_clear_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[content-production-premortem]]", "[[content-production-agenda-full]]", "[[content-production-agenda-board]]", "[[content-production-directive]]", "[[content-production-loops]]", "[[content-production-schedule]]", "[[search-demand-research-charter]]", "[[editorial-gate-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[brand-identity-charter]]", "[[narrative-collateral-charter]]", "[[inference-cost-charter]]", "[[commercial]]", "[[README]]"]
---

# Content Production — Charter

Team **G2** of [[growth-charter]]. Division: Commercial.

## Mandate

G2 turns a brief into published words. Two page shapes, one link graph:

1. **The long-form article.** **Claude writes it** — this is a founder decision that
   explicitly replaces ChatGPT in the original workflow, and it is recorded here as a
   specification rather than a tooling preference. Drafted against
   [[search-demand-research-charter]]'s brief, never against a bare keyword.
2. **The FAQ layer.** After the article publishes, the ten most distinct questions from
   AnswerThePublic each get a **~120-word plain answer** on **its own page**, and **each
   links back to the long-form article**. Not a section, not an accordion: one page per
   question, per the founder's specification.

G2 also owns the **link graph between the two shapes**, which is the part most likely to go
wrong and the only part no other team will notice going wrong.

**What G2 does not do is decide when something is good enough to publish.** Every unit goes
to [[editorial-gate-charter]], every time, and the gate can reject. G2 revises; it never
overrules. That relationship is the subject of open fork **CM-F1** and is recorded, not
resolved, at [[growth-charter]].

## Boundaries

Owns outright:

- **Drafting** — the long-form article and each ~120-word answer.
- **Page shape** — headings, answer-first structure, the paragraph a machine can lift. This
  is where the answer-surface strategy is actually executed, even though
  [[technical-seo-ai-answer-surface-charter]] owns the markup around it.
- **The article ↔ FAQ link graph** — every answer page links back to its parent article;
  the article links out to its answer set.
- **Revision after a gate return** — including deciding that a returned draft should be
  abandoned rather than revised.
- **Its own cost** — drafting is an agent task and its spend is real.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Whether it publishes | [[editorial-gate-charter]] · G3 | G3 has a veto and no throughput target. G2 has a throughput target and no veto |
| Which topic, and the ten questions | [[search-demand-research-charter]] · G1 | G2 writes to a brief. Choosing the brief from the queue by intuition is a G1 ordering failure, and G2 reports it rather than absorbing it |
| The voice guide | [[brand-identity-charter]] · M1 | M1 defines, G3 enforces, G2 writes inside it |
| The headline claim | [[narrative-collateral-charter]] · M2 | G2 does not invent positioning mid-article |
| Markup, canonicals, sitemap, status codes | [[technical-seo-ai-answer-surface-charter]] · G4 | G2 owns the words and their structure; G4 owns whether a machine can reach and parse them |
| Any statement about price | [[unit-economics-pricing-charter]] · F2 | **Founder-deferred.** No article implies a price, a tier, or a "starting at" |
| Model routing and cost policy | [[inference-cost-charter]] · F1, [[model-routing-inference-economics-charter]] | G2 consumes the routing decision; it does not make it |

## Metrics it moves

**Primary — `content.published_units_per_week`**, counting only units that **cleared
[[editorial-gate-charter]] on first pass**. Counting drafts would make the gate look like
friction instead of the product, which is the exact reading that precedes a gate being
suspended ([[growth-premortem]] M2).

**`content.first_pass_clear_rate`** — the share of submitted units that clear without a
return. This is G2's quality signal and it is deliberately **not** the same as the gate's
rejection rate: the gate reads rejection as a health signal about itself, G2 reads first-pass
clearance as a signal about its briefs and its drafting. A falling rate usually means the
brief was thin, not that the writing got worse.

**`content.faq_orphan_pages`** — target zero. Counts two defects in one number: an answer
page with no link back to its parent article, and a pair of answer pages resolving to the
same searcher intent. Both are the thin-content failure ([[content-production-premortem]] M1)
and both are invisible from any other team's vantage point.

**`nf_a.cost_per_task`** — drafting is an agent task and emits a footprint like any other
([[README]] §4.2): task type, model, tokens, latency, cost, and a doneability verdict. The
verdict field has an unusually clean source here — it is the gate's decision. That makes
[[editorial-gate-charter]] the natural producer of the outcome half of G2's NF-A record
rather than a step standing outside the metric spine.

## Evidence today

**PARTIAL**, and the split is worth stating precisely: the *drafting* half has real,
shipped precedent; the *publishing* half does not exist at all.

**What exists:**

- **Claude drafting outward-facing prose under a mandatory human gate is already the shipped
  default.** The vendor-reply path drafts and never auto-sends; one-tap recommendation
  actions require a person. G3's gate is therefore native to this codebase rather than an
  imported process, which materially raises the odds it survives contact with a deadline.
- **Templated outbound copy exists** at
  `apps/api-gateway/src/communications/email-templates/vendor-action.template.ts`, with
  shared configuration at
  `apps/api-gateway/src/communications/email-templates/template-config.ts`. It is
  transactional email rather than editorial content, but it is the repo's only existing
  answer to "where does outward-facing copy live and who owns its wording".
- **Drafting cost is already metered.**
  `services/agent-orchestrator/services/spend_logger.py` is the single insertion point for
  every Claude and Gemini call, recording provider, model, input/output tokens, `cost_usd`
  and `restaurant_id`. G2's spend will land there for free. Its header also warns that
  `log()` must never raise, which is [[inference-cost-charter]]'s premortem, inherited.
- **An answer-surface discipline is already written down in this repo.**
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120`: a listing with no
  price emits no Offer, because *a zero-price Offer is a valid document and a false
  statement*. That sentence is the standard G2 writes to.

**What does not exist:**

- **No content repository, no CMS, and no publishing target.** There is nowhere for an
  article to go. `apps/web` is the authenticated product; its only public content route is
  the vendor catalogue at `apps/web/src/App.tsx:161`.
- **No article, no FAQ page, no draft** anywhere in the repo.
- **No voice guide** — [[brand-identity-charter]] owns writing it, and until it exists the
  gate is enforcing an opinion rather than a document.
- **The brand on the shell is still wrong.** `apps/web/index.html:7` reads
  `WineOps AI - Restaurant Wine Management`. Publishing under a name being migrated away
  from spends the credibility the content is buying.

## Why this is a team and not part of the gate

Writing against a brief is a different craft from judging whether a claim is true, and
production is agent-scalable where the gate structurally is not. Keeping them together lets
the cheap step set the pace of the expensive one — which is precisely how gates get
suspended. **Fork CM-F1 disputes this** on the grounds that one founder is currently both
writer and editor, so the split is organizational fiction until there is a second person.
That argument is recorded at [[growth-charter]] and is not resolved here.
