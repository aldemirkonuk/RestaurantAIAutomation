---
type: loops
division: commercial
department: growth
status: provisional
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, content.published_units_per_week, content.faq_orphan_pages, editorial.claims_traceable_pct, editorial.gate_bypass_count, seo.indexed_pages, seo.soft_404_rate, answer_surface.assistant_citations, funnel.visit_to_activated_rate, funnel.measurable_steps]
updated: 2026-08-24
links: ["[[growth-charter]]", "[[growth-premortem]]", "[[growth-directive]]", "[[growth-schedule]]", "[[search-demand-research-loops]]", "[[content-production-loops]]", "[[editorial-gate-loops]]", "[[technical-seo-ai-answer-surface-loops]]", "[[conversion-funnel-loops]]", "[[LOOP-MAP]]", "[[decision-office-charter]]"]
loop_count: 6
loop_count: 6
loop_ids: ["growth-search-console-refeed", "growth-editorial-gate-health", "growth-publish-index-cite", "growth-visit-to-activation", "growth-claim-provenance-audit", "growth-checklist-outcome-reconciliation"]
loop_close_times: ["monthly", "weekly", "monthly", "monthly", "quarterly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed", "proposed", "proposed", "proposed"]
---

# Growth — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

**L-GRO-1 is the department's reason to exist.** The founder's pipeline is only a pipeline
because of its return path: Search Console impressions with no matching content feed back
into the keyword corpus. Steps 1–4 without step 5 are a content calendar. Every other loop
here exists to stop one of the five stages from silently reporting success.

One honesty note applied to all six: **none of these can close today.** There is no Search
Console property, no published page, and no pre-login instrument. Each loop below carries
its blocking dependency explicitly, so the first close-time that produces "blocked" is
recorded as blocked rather than skipped.

---

## L-GRO-1 — The Search Console refeed

```yaml
type: loop
id: growth-search-console-refeed
owner: growth
measures: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, seo.indexed_pages]
changes: [demand.topic_queue, content.commission_list]
inputs_from: [technical-seo-ai-answer-surface, content-production]
outputs_to: [search-demand-research, content-production, decision-office]
close_time: monthly
status: proposed
```

The founder's step 5 → step 1. Sort Search Console queries by impressions; every query with
≥10 impressions and no page that answers it is either **in the queue or explicitly
rejected** within one month. Rejection is a recorded verdict with a reason, never silence —
silence is how a keyword gets re-litigated every month forever.

Monthly rather than weekly because impressions need a sample: a week of Search Console data
on a site with five public routes is noise, and acting on noise is how
[[search-demand-research-premortem]] M1 starts.

**Blocked by:** no Search Console property, no verified domain, no indexed page.
**Counters:** [[growth-premortem]] M1 — a pipeline that never closes is a calendar.

---

## L-GRO-2 — Gate throughput and gate health

```yaml
type: loop
id: growth-editorial-gate-health
owner: growth
measures: [editorial.claims_traceable_pct, editorial.rejection_rate, editorial.gate_bypass_count, content.published_units_per_week]
changes: [content.commission_rate, editorial.banned_construction_list, growth.capacity_cap]
inputs_from: [editorial-gate, content-production, brand-identity]
outputs_to: [content-production, growth, red-team]
close_time: weekly
status: proposed
```

Two numbers read together, never apart. `editorial.rejection_rate` at 0% for two
consecutive weeks means the gate is not reading, not that the drafts are clean;
`editorial.rejection_rate` climbing means the brief or the voice guide is wrong, not that
the writer is. The loop's output is a **change to the commission rate** — if the gate
cannot clear what is queued, production is reduced, never the gate.

`editorial.gate_bypass_count` is carried here and read weekly because a bypass is
discovered, not reported. The weekly read is what makes it discoverable.

**Blocked by:** nothing published yet; the provenance format is unwritten.
**Counters:** [[growth-premortem]] M2.

---

## L-GRO-3 — Publish → index → cite

```yaml
type: loop
id: growth-publish-index-cite
owner: growth
measures: [seo.indexed_pages, answer_surface.assistant_citations, content.faq_orphan_pages, seo.soft_404_rate]
changes: [seo.markup_policy, content.page_shape, answer_surface.llms_txt]
inputs_from: [content-production, technical-seo-ai-answer-surface]
outputs_to: [search-demand-research, content-production, decision-office]
close_time: monthly
status: proposed
```

The answer-surface loop, and the one no standard SEO dashboard runs. Publication is not the
end state; **being cited inside an assistant's answer is.** Each close-time asks a set of
the corpus's own questions of the major assistants and records whether a Mudavym URL is
cited, then feeds the answer back into page shape: which headings got extracted, which
paragraphs got quoted, which schema types produced a rich result.

Monthly because indexing and assistant-index refresh both have latency measured in weeks,
and because the measurement is manual until proven worth automating.

**Honest limitation, recorded rather than glossed:** assistant citation is sampled, not
enumerated. There is no impressions report for an AI answer. The loop measures a sample and
says so; a sampled number described as complete is the same failure as a green checklist on
an empty site.

**Blocked by:** zero published pages.
**Counters:** [[growth-premortem]] M3, and [[content-production-premortem]]'s thin-page risk.

---

## L-GRO-4 — Visit → activation

```yaml
type: loop
id: growth-visit-to-activation
owner: growth
measures: [funnel.visit_to_activated_rate, funnel.measurable_steps, funnel.step_dropoff]
changes: [conversion.page_layout, conversion.cta_policy, content.commission_list]
inputs_from: [conversion-funnel, content-production, design-partner-operations]
outputs_to: [growth, analytics-bi, product-vision]
close_time: monthly
status: proposed
```

The only loop that measures whether any of the rest mattered. *Activated* means first
POS-connected day, not signup: the activation email path exists
(`apps/api-gateway/src/auth/auth.service.ts:650-651` →
`apps/api-gateway/src/communications/gmail.service.ts:702`), and everything before it does
not.

`funnel.measurable_steps` is measured **first and reported alongside the rate**, because a
conversion rate computed over one visible step is not a funnel. Baseline is 0 pre-login:
`apps/web/src/lib/uxSignals.ts:15` ships dark and buckets on an authenticated user id
(`:20-23`).

**Blocked by:** no pre-login instrument that keeps `apps/web/src/pages/Privacy.tsx:30-31`
true. That constraint is the work, not an obstacle to it.
**Counters:** [[growth-premortem]] M4.

---

## L-GRO-5 — Claim provenance re-audit

```yaml
type: loop
id: growth-claim-provenance-audit
owner: growth
measures: [editorial.claims_traceable_pct, editorial.claims_now_stale, funnel.fabricated_social_proof_count]
changes: [content.published_corpus, editorial.provenance_record]
inputs_from: [editorial-gate, design-partner-operations, narrative-collateral]
outputs_to: [editorial-gate, content-production, red-team, decision-office]
close_time: quarterly
status: proposed
```

Every published number is re-checked against its source, because a claim that was true at
publication decays: a recovery figure, a customer count, a "used by" logo, an integration
list. The loop's specific obligation is the recovery number — if *dollars recovered* is
published anywhere, this loop verifies quarterly that an 812 credit memo still backs it
([[YC_WEDGE_PLAN]]:31-33). A stale claim is corrected on the page, not quietly removed;
removal without correction leaves the screenshot in circulation.

Quarterly because re-auditing a small corpus more often is theatre, and because the corpus
is small enough to audit **completely rather than by sample**. When that stops being true,
the close-time changes and the loop says so.

**Counters:** [[growth-premortem]] M2 and M5.

---

## L-GRO-6 — Checklist versus outcome

```yaml
type: loop
id: growth-checklist-outcome-reconciliation
owner: growth
measures: [seo.checklist_items_green, seo.indexed_pages, seo.soft_404_rate, funnel.measurable_steps, funnel.visit_to_activated_rate]
changes: [growth.agenda_board, seo.checklist_definition, growth.team_allocation]
inputs_from: [technical-seo-ai-answer-surface, conversion-funnel]
outputs_to: [growth, architecture-review, decision-office]
close_time: monthly
status: proposed
```

The department's own honesty check, and structurally the same mechanism Engineering uses to
pair a grep-shaped guard with an outcome-side twin. For each green checklist item, assert
that its bound outcome metric is **readable and moving in the right direction**. Green
checklist plus zero indexed pages is the alarm state, and only the department sees both
numbers.

Two rules make it work: an item whose outcome metric is unreadable is recorded as
*unreadable*, never as done; and if the checklist count moves for three consecutive
close-times while `seo.indexed_pages` and `funnel.visit_to_activated_rate` do not, the
department reallocates rather than continuing.

**Counters:** [[growth-premortem]] M3.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-GRO-1 Search Console refeed | monthly | premortem M1 | No — no GSC property |
| L-GRO-2 gate throughput and health | weekly | premortem M2 | No — nothing published |
| L-GRO-3 publish → index → cite | monthly | premortem M3 | No — zero pages |
| L-GRO-4 visit → activation | monthly | premortem M4 | No — no pre-login instrument |
| L-GRO-5 claim provenance re-audit | quarterly | premortem M2, M5 | Partly — the recovery claim can be audited now |
| L-GRO-6 checklist versus outcome | monthly | premortem M3 | Yes — and it will report red |

**Five of six are blocked, and that is the accurate picture of a near-greenfield
department.** A blocked loop that records "blocked" every close-time is doing its job; a
blocked loop that is quietly not run is how a department discovers in month nine that
nothing was ever measured.
