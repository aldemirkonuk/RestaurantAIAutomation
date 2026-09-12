---
type: agent-stack
division: commercial
department: growth
team: content-production
status: designed
updated: 2026-08-27
metrics: [content.published_units_per_week, content.faq_orphan_pages, content.first_pass_clear_rate, nf_a.cost_per_task]
links: ["[[content-production-charter]]", "[[content-production-schedule]]", "[[content-production-loops]]", "[[content-production-directive]]", "[[0034-agent-stack-artifact]]", "[[growth-agent-stack]]", "[[editorial-gate-charter]]", "[[search-demand-research-charter]]", "[[skills-charter]]"]
---

# Content Production — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> G2 is the one Growth unit whose core work is genuinely an agent task — the founder specified
> that **Claude writes the article** — which makes its card the one most at risk of quietly
> acquiring a publish button. It does not have one: this card drafts and submits, a human
> publishes. Mechanisms referenced only: harness → [[harness-runtime-charter]] (**OD-03 open**),
> model choice and cost policy → [[model-routing-inference-economics-charter]] and
> [[inference-cost-charter]], the mutation gate → [[action-safety-the-human-gate-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `content-drafter` | Draft the long-form article and each ~120-word answer page against G1's brief, assemble the provenance record in the same pass, keep the article ↔ FAQ link graph whole, and submit to the gate | PARTIAL — Claude drafting outward-facing prose under a mandatory human gate is shipped (`apps/api-gateway/src/communications/email-templates/vendor-action.template.ts`); nothing drafts editorial content |

## 2. Agent cards

```yaml
agent: content-drafter
unit: content-production
triggers:
  - topic: brief.commissioned      # publisher: [[search-demand-research-charter]]'s queue — a design, not a store yet (§5)
  - topic: gate.unit_returned      # publisher: [[editorial-gate-charter]]'s verdict artifact
  - schedule: "weekly — draft to verdict read (L-G2-1, close_time weekly)"
consumes:
  - a brief with a wedge tag and its ten distinct questions, from G1
  - the voice guide — publisher [[brand-identity-charter]]. **NONE today (gap)**
  - "the answer-surface rule already written in code: apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120"
emits:
  - "a draft + provenance record → [[editorial-gate-charter]] (consumer: its per-unit human pass)"
  - "content.faq_orphan_pages and content.first_pass_clear_rate → [[content-production-agenda-board]]"
  - "nf_a events (task_type: article_draft) — cost half via services/agent-orchestrator/services/spend_logger.py; outcome half is G3's verdict (ADR 0017)"
routing_class: judgment
quality_bar: "the gate's verdict is the doneability verdict (charter §Metrics). A draft submitted without a provenance record is a failure, not a partial ([[content-production-schedule]])"
autonomy:
  read: autonomous
  propose: autonomous              # drafts and revisions land as PRs the gate reads
  mutate_stock_money_outbound: confirm   # constant. Publishing is an outbound act: this card proposes, a human publishes
memory: content-production
escalates_to: "[[growth-charter]]"
```

**Two hard rules on this card.** (1) It never marks its own draft publishable.
`editorial.gate_bypass_count` = 0 is absolute, and a published page with no committed verdict
artifact is a bypass regardless of what produced it. (2) It writes no statement implying a price,
a tier, or a "starting at" — F2 is founder-deferred and a drafted price is the easiest way to
publish a decision nobody made.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `seo-article-pipeline` | T2 | A commissioned brief carrying a wedge tag and a publishing target | A draft plus a provenance record with a source per claim; a draft without provenance is a failure, not a partial | The shipped precedent for Claude drafting outward-facing prose that is staged and never auto-sent is the vendor-reply path, with its outward copy living at `apps/api-gateway/src/communications/email-templates/vendor-action.template.ts` and shared config at `.../template-config.ts`; its spend is already metered at `services/agent-orchestrator/services/spend_logger.py` | NEW |

The schedule's three other proposals — `answer-page-set`, `link-graph-check` and
`banned-construction-check` — cite no past instance and so are **not rows here** (README §3.3).
One of them carries a constraint worth repeating even without a row:
**`banned-construction-check` has no verdict field, by design.** If it ever becomes the thing
that decides whether a unit publishes, [[growth-premortem]] M2 has happened quietly.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); the model and cost
policy this agent's drafting consumes ([[inference-cost-charter]]).

## 4. Memory

- **Procedural** — the §3 skill; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: article_draft`. Needs `context.brief_id`,
  `context.unit_shape` (`article` | `answer_page`) and `context.gate_verdict` as jsonb keys.
  The cost half has a real insertion point today (`spend_logger.py`, whose header warns `log()`
  must never raise); the outcome half arrives from G3 as a sidecar claim, which is what makes
  the gate part of the metric spine rather than a step beside it.
- **Semantic** — `memory/` beside this file, index `content-production-MEMORY.md`. Its facts are
  gate returns, and each one records **which check failed and whether the cause was the brief or
  the prose** — the charter's own reading: a falling first-pass rate usually means the brief was
  thin, not that the writing got worse. Provenance frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, the brief, and the banned-list
  once it exists. The corpus and the published set are retrieval targets, never preloaded.

**Consolidation** — monthly, after the fourth weekly L-G2-1 read. Failures first: every return
becomes a fact naming the failed check and its cause; a duplicate-intent pair that reached
publication becomes a fact about the question set, not about the writer; expire at 90 days;
propose skill candidates. One PR, "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[content-production-loops]], NF-A events, vault PRs and
skill candidates — never a synchronous call, and never a publish. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The voice guide has no publisher today | [[brand-identity-charter]] owns writing it and it does not exist (charter §Evidence). Until it does, this agent drafts against an unwritten standard and the gate enforces an opinion |
| `brief.commissioned` has no store | G1's queue is a design, not a system, and OD-53 leaves its main intake unverified. The weekly L-G2-1 read is the only bounded trigger this card actually has |
| No publishing target, so `emits` stops at the gate | `apps/web` is the authenticated product; its only public content route is `apps/web/src/App.tsx:161`. The agent has no publish path even if it were permitted one — which is a safeguard by accident, not by design, and should not be mistaken for the gate |
| `content.published_units_per_week` has no denominator | It counts units clearing G3 on first pass. Zero published, zero drafted: the metric reads 0 for the reason "nothing exists", never "nothing cleared" |

## 6. Evidence today

- **PARTIAL, and the split is precise.** The *drafting* half has shipped precedent — outward-
  facing prose drafted in-repo, staged, human-approved, cost-metered. The *publishing* half does
  not exist at all: no content repository, no CMS, no article, no FAQ page, no draft.
- **EXISTS — the discipline this agent writes to.**
  `apps/api-gateway/src/vendor-portal/vendor-portal.service.ts:119-120`: a listing with no price
  emits no Offer, because a zero-price Offer is a valid document and a false statement.
- **EXISTS — a crawl-visible defect that constrains launch.** `apps/web/index.html:7` still reads
  `WineOps AI - Restaurant Wine Management`; publishing under a name being migrated away from
  spends the credibility the content is buying. Reported, not fixed here — the shell is M1's.
- **NEW — the agent, its skill, and every memory layer** except the NF-A tables themselves
  (ADR 0006/0008) and the spend logger.
