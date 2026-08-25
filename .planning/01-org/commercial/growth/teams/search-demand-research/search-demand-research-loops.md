---
type: loops
division: commercial
department: growth
team: search-demand-research
status: provisional
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus, demand.queue_rejection_reasons, demand.queue_depth_weeks]
updated: 2026-08-24
links: ["[[search-demand-research-charter]]", "[[search-demand-research-premortem]]", "[[search-demand-research-directive]]", "[[search-demand-research-schedule]]", "[[growth-loops]]", "[[content-production-loops]]", "[[technical-seo-ai-answer-surface-loops]]", "[[LOOP-MAP]]"]
loop_count: 3
loop_ids: ["g1-harvest-to-brief", "g1-search-console-gap-requeue", "g1-wedge-drift"]
loop_close_times: ["weekly", "monthly", "monthly"]
loop_statuses: ["proposed", "proposed", "proposed"]
---

# Search Demand Research — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

G1 owns the return path of the founder's pipeline. Its department-level expression is
[[growth-loops]] L-GRO-1; the three loops here are the team-level mechanisms that keep that
one honest.

---

## L-G1-1 — Harvest to brief

```yaml
type: loop
id: g1-harvest-to-brief
owner: search-demand-research
measures: [demand.queue_depth_weeks, demand.wedge_share_of_corpus, demand.queue_rejection_reasons]
changes: [demand.topic_queue, demand.intake_rate]
inputs_from: [narrative-collateral, content-production]
outputs_to: [content-production, growth]
close_time: weekly
status: proposed
```

Each research session's harvested search set becomes briefs or rejections **within the same
week**, while the session's context still exists. A harvest that sits unconverted for longer
than a week is not a backlog, it is a loss: the searches were the artifact, and the reason
each one was run is what decays.

`demand.queue_depth_weeks` is measured in **weeks of gate throughput**, not in rows. Depth
beyond four weeks means intake is outrunning [[content-production-loops]] and the correct
change is to slow intake, never to speed the gate.

**Blocked by:** nothing. This loop can run the week the brief format exists.

---

## L-G1-2 — Search Console gap requeue

```yaml
type: loop
id: g1-search-console-gap-requeue
owner: search-demand-research
measures: [demand.uncovered_keyword_count, seo.indexed_pages, seo.soft_404_rate]
changes: [demand.topic_queue, content.revision_list]
inputs_from: [technical-seo-ai-answer-surface, content-production]
outputs_to: [content-production, growth, decision-office]
close_time: monthly
status: proposed
```

The founder's step 5 → step 1, at team grain. Sort by impressions; every query with ≥10
impressions and no page that answers it is queued or rejected with a reason inside one
month. Queries whose intent an existing page already covers become **revisions**, never new
pages — that rule is what stops the refeed manufacturing duplicate content out of its own
success.

**Explicit precondition, and it is not a formality.** This loop does not run until
`seo.soft_404_rate` is zero and a sitemap is being read. Today every unmatched URL returns
HTTP 200 (`vercel.json:12-15`, then `apps/web/src/App.tsx:302`), so a query report from this
property would describe a defect rather than a market. While the precondition is unmet the
loop's monthly verdict is **blocked**, recorded, and reported — which is a real output, and
after three consecutive blocked verdicts it escalates
([[search-demand-research-directive]]).

**Counters:** [[search-demand-research-premortem]] M4.

---

## L-G1-3 — Wedge drift

```yaml
type: loop
id: g1-wedge-drift
owner: search-demand-research
measures: [demand.wedge_share_of_corpus, demand.corpus_size, demand.queue_rejection_reasons]
changes: [demand.intake_policy, demand.wedge_floor]
inputs_from: [narrative-collateral, content-production, growth]
outputs_to: [growth, red-team, decision-office]
close_time: monthly
status: proposed
```

The only loop that can see [[search-demand-research-premortem]] M1, because M1 is invisible
in the primary metric: `demand.uncovered_keyword_count` falls steadily the entire time the
corpus is drifting toward generic restaurant-software terms. This loop reads **share against
size** and treats *share falling while size grows* as the alarm.

Its change is a policy change, not a cleanup: intake is restricted to wedge terms until
share recovers above the floor. Cleaning the corpus afterwards is not offered as an option,
because by then the articles have been written against it.

**Counters:** [[search-demand-research-premortem]] M1.

---

## Close-time summary

| Loop | Close-time | Counters | Can it close today? |
|---|---|---|---|
| L-G1-1 harvest to brief | weekly | premortem M2, M3 | Yes, once the brief format exists |
| L-G1-2 Search Console gap requeue | monthly | premortem M4 | No — precondition unmet, verdict is *blocked* |
| L-G1-3 wedge drift | monthly | premortem M1 | Not yet — needs a corpus to measure |

**Note on L-G1-2's blocked state.** It is recorded here rather than left implicit because a
loop nobody runs and a loop that reports *blocked* look identical in a status update and are
opposites in practice. The first is a team that stopped measuring; the second is a team
holding a dependency visible until it is fixed.
