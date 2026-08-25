---
type: premortem
division: commercial
department: growth
team: content-production
status: provisional
metrics: [content.faq_orphan_pages, content.published_units_per_week, content.first_pass_clear_rate]
updated: 2026-08-24
links: ["[[content-production-charter]]", "[[content-production-loops]]", "[[content-production-directive]]", "[[growth-premortem]]", "[[editorial-gate-charter]]", "[[search-demand-research-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[brand-identity-charter]]", "[[inference-cost-charter]]"]
---

# Content Production — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. G2 has failed. What happened?

---

### M1 — The FAQ layer became ten doorway pages and buried the article it was built to feed

The mechanism named in [[commercial]] §1.3, and it is first because the pipeline's own shape
invites it. Ten questions, ~120 words each, one page each. Written quickly, from the same
research, in the same voice, on the same day. Seven of the ten turn out to be the same
question phrased differently — *how do I check a wine invoice*, *how do I verify a wine
invoice*, *how do I audit a wine invoice* — and each gets its own thin page linking back to
the long-form article. A search engine sees a cluster of near-duplicate low-value pages
pointing at one target, which is the textbook shape of a doorway network. The long-form
article's authority is diluted by the exact layer built to feed it, and the site's overall
quality signal drops.

**Earliest observable signal.** Two answer pages whose primary question resolves to the same
searcher intent. Detectable **before publication**, at the point G1 hands over ten questions
and G2 reads them. Later and worse: the article's impressions falling in the month after its
FAQ layer ships.

**What would have prevented it.** Distinctness is decided **before drafting**, not
discovered after publishing. The ten questions arrive from
[[search-demand-research-charter]] already scored for pairwise distinctness, and G2 refuses a
set that fails — sending back eight distinct questions is a valid outcome, ten is not a
quota. Each answer page must contain **something the article does not**, stated as a
publication condition rather than an aspiration. And `content.faq_orphan_pages` counts
duplicate-intent pairs in the same number as missing back-links, so one metric cannot go
green while the other rots.

---

### M2 — Volume was the metric, so the gate became the enemy

`content.published_units_per_week` is a throughput number and throughput numbers are
motivating, which is the point and the danger. A quarter in, G2 is drafting faster than
[[editorial-gate-charter]] can read. The queue grows. Each week the published count misses,
and each week the visible cause is the gate. The conversation shifts from "is this true" to
"how do we get through faster", pre-approved templates appear, low-risk categories are
proposed for expedited handling, and the mandatory human pass has been renegotiated into a
sampling policy without anyone deciding to do that.

**Earliest observable signal.** The first proposal to exempt any category of content from
the gate — "these are just FAQ answers", "this one has no numbers in it". Also: draft queue
depth exceeding two weeks of gate throughput.

**What would have prevented it.** The capacity rule in [[growth-directive]]: **published
throughput is capped at gate throughput**, and G2's commission rate is set from the gate's
demonstrated rate, not from drafting capacity. Drafting is cheap and getting cheaper; that is
exactly why it must not set the pace. A draft queue deeper than two weeks is treated as an
intake problem for [[search-demand-research-charter]], not a gate problem.

---

### M3 — Cheap drafting produced a corpus nobody would cite

Claude drafts a competent 1,800-word article in one pass. It is accurate, readable, and
contains nothing a reader could not get from four other pages on the same subject. The
answer-surface strategy depends on being **the most citable source for a specific question**,
and a competent summary of the consensus is by construction never that. Thirty articles
later the site ranks for nothing, is cited by nothing, and every individual piece passed the
gate because none of them was *wrong*. The gate checks truth; nobody was checking whether
there was anything in the page worth taking.

**Earliest observable signal.** An article that contains no number, no named source, and no
claim traceable to this company's own data. Concretely: a draft whose provenance record cites
only third-party pages and nothing from `apps/api-gateway/src/procurement/invoice-match.ts`'s
domain, the design partner's experience, or the repo's own analysis.

**What would have prevented it.** Every long-form unit must carry at least one thing the
company knows and the internet does not — an observed discrepancy pattern, a document shape,
a real 812 credit-memo mechanic ([[YC_WEDGE_PLAN]]:31-33). Brief-level requirement, checked
at commissioning, not at the gate: the gate's job is truth, and a true article with no
original content passes it correctly every time. This is also the answer to *why Claude and
not a template* — the model's leverage is drafting around a hard-won fact, not manufacturing
the fact.

---

### M4 — The link graph decayed and nobody owned it

Articles get revised. Questions get merged. A topic gets re-covered from a better angle and
the old article is quietly retired. Every one of those is correct in isolation, and each one
breaks a back-link from an answer page to its parent. Eight months in, a third of the answer
pages point at redirects or at articles that no longer answer them, and the internal link
structure that was supposed to concentrate authority is now leaking it. Nobody noticed
because no team's primary metric moves when a back-link breaks.

**Earliest observable signal.** The first answer page whose back-link resolves through a
redirect rather than to a live URL. `content.faq_orphan_pages` leaving zero at all.

**What would have prevented it.** The link graph is an owned artifact with a target of zero
defects, checked **per publication and per revision**, not periodically. Any article
retirement is a G2 decision that carries its answer pages with it — retire the cluster or
re-parent it, never orphan it. This is the standing defect that would justify chartering the
answer layer as its own team; fork **CM-F2** exists for exactly that, and
`content.faq_orphan_pages` is the number that would settle it.

---

## Cross-cutting counter-pressure

- **M1 and M4 are the same asset failing twice**, at birth and by decay, which is why one
  metric counts both.
- **M2 and M3 pull in opposite directions and both are real.** M2 says do not let volume set
  the pace; M3 says a slow trickle of inoffensive summaries is also failure. The resolution
  is not a middle number, it is the originality requirement at commissioning: fewer units,
  each carrying something only this company can say.
- **Cost is not a listed mechanism, deliberately.** Drafting spend lands in
  `services/agent-orchestrator/services/spend_logger.py` and is [[inference-cost-charter]]'s
  premortem to own. G2 inherits one warning from it: `log()` never raises, so a silent
  logging failure looks exactly like a cheap month.
