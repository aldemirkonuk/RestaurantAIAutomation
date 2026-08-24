---
type: premortem
division: commercial
department: growth
team: search-demand-research
status: provisional
metrics: [demand.wedge_share_of_corpus, demand.uncovered_keyword_count, demand.queue_rejection_reasons]
updated: 2026-08-24
links: ["[[search-demand-research-charter]]", "[[search-demand-research-loops]]", "[[search-demand-research-directive]]", "[[growth-premortem]]", "[[content-production-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[narrative-collateral-charter]]", "[[YC_WEDGE_PLAN]]"]
---

# Search Demand Research — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. G1 has failed. What happened?

---

### M1 — The corpus filled with generic restaurant-software terms

This is the mechanism named in [[commercial]] §1.3 and it is first because it is the most
comfortable failure available. "Restaurant inventory software", "restaurant management
system", "POS integration" all have volume, all return research results, all produce
briefs a writer can work from. The beverage-invoice wedge does not: nobody types *"my
distributor billed me for cases I did not receive"* into a search box in those words. So the
corpus grows, the queue is healthy, articles get written, traffic rises — and every visitor
is shopping for a category this product does not compete in. Growth reports rising traffic
while the wedge ([[YC_WEDGE_PLAN]]:323) starves. The failure is invisible in
`demand.uncovered_keyword_count`, which goes **down** the entire time.

**Earliest observable signal.** `demand.wedge_share_of_corpus` falling for two consecutive
close-times while total corpus size grows. Sooner and cruder: the first commissioned brief
whose primary term contains neither an invoice, a credit, a distributor, a delivery, nor a
beverage.

**What would have prevented it.** Two numbers, never one. The wedge tag is applied at
**intake** — before a term can be commissioned, not as a later audit — and it carries a
floor, so a term outside the wedge needs an explicit argument recorded against it rather
than a default acceptance. And the second number sits on the department board next to the
first ([[growth-agenda-board]]), because a team grading itself on queue size will always
find the queue healthy.

---

### M2 — The harvest was never actually possible, and a year was spent working around it

The founder's step 1 depends on capturing **the exact searches Perplexity ran**. Nobody has
verified that those queries are retrievable programmatically, or retrievable at all, at the
volume this pipeline implies ([[commercial]] §7 says so plainly). The failure is not that
the answer is no. It is that the answer is *"sort of"* — the queries are visible in the UI,
copyable by hand, and absent from any export. So the harvest becomes a manual transcription
step, it works fine for one topic a week, and it silently caps the entire pipeline at the
speed of copy-and-paste. Nobody records that the cap exists, because each individual
transcription was five minutes.

**Earliest observable signal.** The first week the harvest is skipped for one topic "because
we already know the keywords". That sentence is the tell — it means the capture cost more
than the capture was worth, which means the mechanism is not viable at volume.

**What would have prevented it.** **Verify the tooling before harvesting anything.** G1's
first task is a written finding on all three sources: what Perplexity exposes, what
AnswerThePublic's API allows at this volume, what Search Console exports. If the harvest is
manual, that is a fine answer — recorded as a **capacity constraint with a number attached**
(topics per week), so [[content-production-charter]]'s commission rate is set against
reality rather than against the diagram.

---

### M3 — The queue became a list nobody could act on

Six months of intake produces four hundred terms. Each is real. None is a brief. The
writer opens the queue, cannot tell which of four hundred to write about, picks by intuition,
and the queue's ordering — G1's actual product — turns out never to have existed. G1 reports
a large corpus as an asset while [[content-production-charter]] works from a hunch, and the
Search Console loop feeds more terms into a structure that already cannot be consumed.

**Earliest observable signal.** Any commissioned article whose primary term was not the
highest-priority unclaimed item in the queue, with no recorded reason for the skip. Second
tell: the queue has no rejection entries, so nothing has ever been looked at and refused.

**What would have prevented it.** The queue's unit is a **brief, not a term**: a primary
query, the harvested searches that surround it, the ten distinct questions, the wedge tag,
and a one-line statement of who is asking and what they are trying to do. If a term cannot
produce that, it is not queued, it is rejected with a reason and counted in
`demand.queue_rejection_reasons`. Ordering is part of the artifact, and a skip is a logged
decision.

---

### M4 — The loop closed on the wrong signal because the site could not be indexed

L-GRO-1 reads Search Console. Search Console reports impressions. A site with no sitemap, no
`robots.txt`, and a host that returns HTTP 200 for every nonexistent URL
(`vercel.json:11-13` → `apps/web/src/App.tsx:302`) produces a query report that is mostly
brand terms and noise. G1 dutifully treats that report as demand, requeues around it, and
the corpus drifts toward whatever the broken crawl surface happened to expose. The loop
closes on time, monthly, and has been amplifying an artefact of a technical defect.

**Earliest observable signal.** A Search Console query report where the top queries by
impression are navigational or brand terms, or where impressions arrive for URLs that do not
exist as pages. The second is the direct fingerprint of the soft 404.

**What would have prevented it.** L-GRO-1 has an explicit precondition, recorded in
[[search-demand-research-loops]]: the loop does not run until
[[technical-seo-ai-answer-surface-charter]] reports `seo.soft_404_rate` at zero and a
sitemap is being read. Until then the loop's close-time verdict is **blocked**, which is a
real output. Acting on a corrupted signal is worse than recording a blocked loop.

---

## Cross-cutting counter-pressure

- **G1's two failure modes are opposites** and that is why it has two metrics: M1 is a queue
  that grows in the wrong direction, M3 is a queue that grows in no direction. A single
  "corpus size" number would look identical in both.
- **M2 is the only one that can be closed this month**, and it is closed by a research
  finding rather than by building anything.
- The department reads `demand.wedge_share_of_corpus` next to
  `demand.uncovered_keyword_count` on one board precisely so M1 cannot hide behind a
  falling primary metric ([[growth-agenda-board]]).
