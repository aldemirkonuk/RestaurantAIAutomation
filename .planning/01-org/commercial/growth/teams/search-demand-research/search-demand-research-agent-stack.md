---
type: agent-stack
division: commercial
department: growth
team: search-demand-research
status: designed
updated: 2026-08-27
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, demand.queue_rejection_reasons]
links: ["[[search-demand-research-charter]]", "[[search-demand-research-schedule]]", "[[search-demand-research-loops]]", "[[search-demand-research-directive]]", "[[0034-agent-stack-artifact]]", "[[growth-agent-stack]]", "[[content-production-charter]]", "[[skills-charter]]", "[[OPEN-DECISIONS]]"]
---

# Search Demand Research — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> G1's card is written around a hole it must not paper over: **OD-53 records that step 1 of the
> founder's pipeline is UNVERIFIED** — no confirmed API path returns a Perplexity session's own
> search set. The harvest therefore appears in this document as a **gap**, never as a working
> trigger. Mechanisms referenced only: harness → [[harness-runtime-charter]] (**OD-03 open**),
> model choice → [[model-routing-inference-economics-charter]], skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `demand-queue-keeper` | Keep the topic queue true — capture what a research session actually searched before its context is discarded, tag each term inside or outside the beverage-invoice wedge, and record a written reason for every term not queued | NEW |

## 2. Agent cards

```yaml
agent: demand-queue-keeper
unit: search-demand-research
triggers:
  - schedule: "weekly — harvest to brief (L-G1-1, close_time weekly)"   # [[search-demand-research-schedule]]
  - schedule: "monthly — wedge drift (L-G1-3, close_time monthly)"
  - topic: research.session_completed   # publisher: NONE (gap — OD-53; see §5. This is the harvest and it does not work yet)
consumes:
  - the topic queue and its rejection record (this team's own vault artifacts)
  - a research session's exact search set — **publisher unconfirmed, OD-53**
  - Google Search Console gap export — publisher: NONE (gap — no verified domain, so no property)
  - an AnswerThePublic question set — publisher verified as an API, unprovisioned (§5)
emits:
  - "briefs → [[content-production-charter]] (consumer: its per-unit brief-completeness job)"
  - "demand.queue_rejection_reasons and demand.wedge_share_of_corpus → [[search-demand-research-agenda-board]]"
  - "a blocked verdict for L-G1-2 naming the failed precondition — consumer: [[growth-agent-stack]]'s board"
  - nf_a events (task_type: demand_harvest)
routing_class: judgment          # capture is extraction, but the wedge tag decides what gets written and sets the card's shape
quality_bar: "a session that ran searches and produced no capture is a failure, not a partial ([[search-demand-research-schedule]]); NONE (gap) — no verdict grader exists for a harvest, ADR 0017 defines none"
autonomy:
  read: autonomous
  propose: autonomous            # queue entries and rejections land as PRs
  mutate_stock_money_outbound: confirm   # constant, plus the hard rule below
memory: search-demand-research
escalates_to: "[[growth-charter]]"
```

**The card's own hard rule.** `demand-queue-keeper` may not reach a third-party scraper to
obtain a search set. OD-53 records scrapers as the only non-manual path anyone found; using one
is an outbound act against a vendor, it is confirm-gated at minimum, and choosing it would
settle OD-53 by accident — which [[search-demand-research-directive]]'s first node forbids.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `search-harvest-capture` | T2 | End of any research session on a queued topic | The search set is written to the corpus with topic, timestamp and wedge tag; a session that searched and captured nothing fails | `services/agent-orchestrator/api/research_routes.py` runs external research at scale for wine enrichment and retains **the facts, not the queries** — every query it has ever run is lost, which is the exact loss this exists to prevent | NEW |
| `intake-source-verification` | T3 | Before any intake is relied on, and on OD-53's next review | A dated line per source: vendor URL, retrieval date, what the API does and does not return; "probably" is a fail | Run once already: the 2026-08-24 search pass recorded at `.planning/05-library/perplexity-search-harvest.md` (`status: unverified`) and the 2026-08-27 half-settlement of OD-53 against `.planning/05-library/answerthepublic.md` (`verified: 2026-08-24` — Alpha API, per-workspace tokens, paid only, 60 req/min) | NEW |

The schedule's other two proposals — `gsc-gap-report` and `brief-completeness-check` — cite no
past instance and are therefore **not rows here**, per README §3.3. They stay proposals in
[[search-demand-research-schedule]] until their job has run manually twice.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: demand_harvest`. Needs `context.topic` and
  `context.wedge_tag` as jsonb keys: wedge drift is a per-term question, and without the tag on
  the event the monthly read becomes a re-derivation instead of a filter.
- **Semantic** — `memory/` beside this file, index `search-demand-research-MEMORY.md`. Its two
  founding facts are the halves of OD-53, each with `source` = the library note and
  `last_verified` = its date. **The 90-day expiry matters more here than anywhere else in
  Growth**: a vendor API fact rots without anything in this repo changing, and an expired
  Perplexity fact must return to *unverified*, not to a remembered "no".
- **Working** — this card, the MEMORY index, charter §Mandate, and the two library notes.
  The queue itself is a retrieval target; it is never loaded whole.

**Consolidation** — monthly, beside the wedge-drift read. Failures first: every term that was
queued and later rejected downstream becomes a fact naming the mechanism (thin brief, outside
the wedge, no demand) rather than "the article underperformed"; expire at 90 days; propose skill
candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[search-demand-research-loops]], NF-A events, vault PRs and
skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `research.session_completed` has no publisher — **OD-53** | No confirmed API path returns a user's own Perplexity search set; only a manual export and third-party scrapers were found (`.planning/05-library/perplexity-search-harvest.md`, `status: unverified`, 2026-08-24). Until settled, the harvest is a manual capture, the weekly schedule is the only real trigger, and step 1 of the pipeline is a design, not a mechanism |
| AnswerThePublic is verified but unprovisioned | The API half of OD-53 **is** settled (`.planning/05-library/answerthepublic.md`: Alpha, paid, 60 req/min) — and `env.example` (187 lines) carries no key. Verified-but-unprovisioned is a different gap from unverified and is recorded as one |
| Search Console export has no publisher | No verified domain and no indexed page means no property (charter §Evidence). L-G1-2 returns *blocked*, which the schedule counts as an action rather than an idle run |
| Briefs → G2 | **Not a gap.** The consumer is named and its job exists in [[content-production-schedule]]; what is missing is the brief, not the reader |

## 6. Evidence today

- **NEW across the board** — the agent, both skills, the queue, the corpus. Nothing in the repo
  serves this purpose and the charter says so plainly.
- **PARTIAL — the nearest prior art, and only the harness half transfers.**
  `services/agent-orchestrator/api/research_routes.py` does scheduled external research with
  structured capture, metered by `services/agent-orchestrator/services/spend_logger.py`. It
  harvests facts about wines, not demand signals about buyers; citing it as half-built demand
  research would be a misreading, and the charter already says so.
- **The blocking fact is OD-53, not the code.** G1's first task is the verification, ahead of
  any harvesting — and this stack is written so that a card cannot quietly assume it resolved.
