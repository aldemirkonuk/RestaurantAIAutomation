---
type: loops
division: commercial
department: growth
team: content-production
status: provisional
metrics: [content.published_units_per_week, content.first_pass_clear_rate, content.faq_orphan_pages, content.draft_queue_weeks, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[content-production-charter]]", "[[content-production-premortem]]", "[[content-production-directive]]", "[[content-production-schedule]]", "[[growth-loops]]", "[[editorial-gate-loops]]", "[[search-demand-research-loops]]", "[[technical-seo-ai-answer-surface-loops]]", "[[inference-cost-charter]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_ids: ["g2-draft-to-verdict", "g2-link-graph-integrity", "g2-originality-citation-feedback"]
loop_close_times: ["weekly", "per-event", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed"]
---

# Content Production — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

---

## L-G2-1 — Draft to verdict

```yaml
type: loop
id: g2-draft-to-verdict
owner: content-production
measures: [content.first_pass_clear_rate, content.published_units_per_week, content.draft_queue_weeks]
changes: [content.template, content.commission_rate, demand.brief_format]
inputs_from: [editorial-gate, search-demand-research, brand-identity]
outputs_to: [search-demand-research, growth]
close_time: weekly
status: proposed
```

The team's core loop, and its output is a **change to the template or the brief**, never a
change to the gate. Every return is classified at the point it arrives: was the problem the
prose, or the brief? A return classified as *brief* goes back to
[[search-demand-research-loops]] and is the only honest way G1 learns what a usable brief is.

`content.draft_queue_weeks` is measured in weeks of **gate** throughput. Beyond two weeks the
loop's change is to reduce commissioning, never to ask the gate to move faster
([[content-production-premortem]] M2).

**Blocked by:** no publishing target, no gate, no brief. This loop is the last of G2's three
to become runnable.

---

## L-G2-2 — Link-graph integrity

```yaml
type: loop
id: g2-link-graph-integrity
owner: content-production
measures: [content.faq_orphan_pages, content.duplicate_intent_pairs, content.backlink_via_redirect_count]
changes: [content.published_corpus, content.answer_page_set]
inputs_from: [technical-seo-ai-answer-surface, search-demand-research]
outputs_to: [technical-seo-ai-answer-surface, growth, decision-office]
close_time: per-event
close_time_note: "per publication, and monthly as a sweep"
status: proposed
```

Runs **twice**: at every publication and revision, and as a monthly sweep over the whole
corpus. The per-publication check catches a defect at birth; the monthly sweep catches decay
([[content-production-premortem]] M4), which is a different failure with the same
fingerprint.

Target is **zero**, and it counts three things in one place: answer pages with no back-link,
answer pages whose back-link resolves through a redirect, and pairs of answer pages resolving
to the same searcher intent. Sustained non-zero is the evidence that would settle fork
**CM-F2** — whether the answer layer needs its own team.

**Note on the `close_time` field.** It carries `monthly` because the machine-readable field
takes one value and the sweep is the slower of the two. The per-publication check is a gate
condition rather than a loop close, and saying so here is more honest than inventing a
cadence for it.

---

## L-G2-3 — Originality and citation feedback

```yaml
type: loop
id: g2-originality-citation-feedback
owner: content-production
measures: [answer_surface.assistant_citations, content.units_with_original_claim, seo.indexed_pages]
changes: [content.template, content.commission_criteria, demand.brief_format]
inputs_from: [technical-seo-ai-answer-surface, design-partner-operations, editorial-gate]
outputs_to: [search-demand-research, growth]
close_time: monthly
status: proposed
```

The loop that counters [[content-production-premortem]] M3, and the only one that can. Each
month it reads which published units were actually cited or extracted
([[technical-seo-ai-answer-surface-loops]] supplies the sample) and asks the one question the
gate cannot: **did the units carrying original material get cited more than the competent
summaries?** The change is to the commissioning criteria — what counts as enough originality
to be worth writing.

Original material comes from inside the company: an observed discrepancy pattern, a document
shape, the 812 credit-memo mechanic ([[YC_WEDGE_PLAN]]:31-33), the design partner's
experience via [[design-partner-operations-charter]]. `content.units_with_original_claim` is
a count, not a rate, and a month where it equals zero is a commissioning failure regardless
of how many units published.

**Blocked by:** zero published pages and no citation sample.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-G2-1 draft to verdict | weekly | premortem M2 | No — no gate, no target, no brief |
| L-G2-2 link-graph integrity | per publication + monthly sweep | premortem M1, M4 | No — no pages |
| L-G2-3 originality and citation feedback | monthly | premortem M3 | No — no citation sample |

**All three are blocked, and the blocker is the same one in every row:** there is nowhere to
publish. That is [[growth-premortem]] M1 stated as a loop table, and it is the argument for
why G2's first work is templates and one complete unit rather than volume.

**Cost note.** `nf_a.cost_per_task` for drafting is carried in this team's frontmatter but
has no loop here. The economics belong to [[inference-cost-charter]], whose insertion point
already exists at `services/agent-orchestrator/services/spend_logger.py`. G2 inherits one
warning rather than a loop: `log()` never raises, so a silent logging failure looks exactly
like a cheap month.
