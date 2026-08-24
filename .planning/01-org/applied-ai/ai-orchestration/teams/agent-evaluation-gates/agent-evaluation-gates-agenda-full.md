---
type: agenda-full
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: provisional
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-premortem]]", "[[agent-evaluation-gates-agenda-board]]", "[[agent-evaluation-gates-directive]]", "[[agent-evaluation-gates-loops]]", "[[agent-evaluation-gates-schedule]]", "[[ai-orchestration-agenda-full]]", "[[research-math-charter|research-and-math-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[decision-office-charter]]"]
---

# Agent Evaluation & Gates — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

One real gate, running per-commit, on one task family. Every other evaluation artifact
in the repo is a script somebody ran once.

And an open question about whether this team should exist at all.

Both belong at the top of the agenda, and in that order — because the *work* below is
worth doing under either answer to the seam. If this team merges into Research & Math
tomorrow, the backlog moves with it unchanged. That is a useful property of an agenda
whose owning team is provisional, and it is deliberate.

## How

### 1. Publish coverage per task family — including the zeros

`nf_a.doneability_verdict_coverage`, split by family, with the families at zero
**named** rather than omitted. Today that table has one non-zero row (identity/merge
policy) and a long list of zeros: vendor reply quality, negotiation stance,
recommendation usefulness, invoice field accuracy in production, menu parse accuracy in
production.

That table is uncomfortable, and the discomfort is the point. An aggregate would read
as a plausible percentage and hide exactly the rows that matter
([[agent-evaluation-gates-premortem]] #1).

### 2. Build one judgment-task rubric, badly, now

Not extraction. The hard one: **was this a good reply to a vendor?**
`inbound-responder.service.ts` drafts them today (`claude-haiku-4-5`, `:21`) and the
vendor-reply AI never auto-sends (project memory: *autonomous-email-replies*), which
means there is a **human decision on every draft already happening** — approve, edit,
discard. That is a free label source, and it is being thrown away.

Start with 30 samples, a written rubric, two raters, and a measured inter-rater
agreement. A rubric with n=30 and a known disagreement rate beats a 10,000-row metric
of the wrong thing. **Methodology here is [[research-math-charter|research-and-math-charter]]'s** — this
team's job is to run it, and to ask for it rather than write it
([[agent-evaluation-gates-premortem]] #2).

### 3. Every new gate declares how its set grows — as a required field

`eval_merge_policies.py:9-16` already has the discipline: *"Every new menu added to
`datasets/menu_corpus/extracted` strengthens this gate automatically; nobody hand-labels
anything."* That sentence is the most valuable line in the repo's evaluation corpus and
it exists in exactly one file.

Make it a required field at gate-authoring time. A gate whose set cannot grow from
production traffic is a snapshot, and it should be labelled one rather than discovered
to be one ([[agent-evaluation-gates-premortem]] #4).

### 4. Build the weekly AI eval workflow — D-25

`.github/workflows/e2e-prod.yml:7` reserves it explicitly: *"Phase 42 will add a
separate weekly AI eval workflow — do not implement here (D-25)."* Reserved, named,
unbuilt. Build it in the shape `.github/workflows/ci.yml:226-230` already proves works:
rebuild the labelled set from the committed corpus, run the eval, exit non-zero on
regression.

### 5. Calibrate the confidence scores, or demote them

`services/quality_scorer.py`, `services/field_confidence.py`, and
`governance.py:227 compute_overall_confidence` produce numbers that already influence
autonomy — `governance.py:20`'s tiers run from `CANONICAL` to `UNRESOLVED`. None has a
calibration curve, because that needs paired confidence/outcome data and NF-A is not
emitting.

Interim position, stated plainly: **an uncalibrated confidence score is a sort key,
not a threshold.** It may order a review queue. It may not decide whether a human sees
something ([[agent-evaluation-gates-premortem]] #5).

## Why now

1. **The imbalance is structural, not incidental.** Every gate running today scores an
   extraction-shaped task. Judgment tasks will never get easier to score, and every
   month of extraction-only progress makes the aggregate look better while the gap
   widens.
2. **The vendor-reply label source is being discarded daily.** Humans already approve,
   edit or discard every draft. Those decisions are labels, and they are not being
   captured.
3. **The seam gets more expensive to resolve with every gate built.** Merging one team
   into another is cheap now and costs a migration later.

## Next steps

| # | Step | Blocked by |
|---|---|---|
| 1 | Coverage table per task family, zeros named | — |
| 2 | Capture approve/edit/discard decisions on vendor-reply drafts as labels | — |
| 3 | Required "how does this set grow" field on every gate | — |
| 4 | Vendor-reply rubric, n≈30, two raters, measured agreement | methodology from [[research-math-charter|research-and-math-charter]] |
| 5 | Weekly AI eval workflow (D-25) | NF-A emission for production families |
| 6 | Confidence calibration curves | NF-A paired outcome data |

Steps 1–3 are unblocked, and step 2 is the one that quietly decides whether step 4 is
possible in a month or in six.

## Questions for the founder

1. **The seam — and this is the question this agenda most wants answered.** Does this
   team exist alongside Research & Math (methodology vs. operations), or is it one team
   in Intelligence? The team's own stated fallback is **merge, never duplicate**
   (`technology.md:406`). We would rather merge now than discover duplication in six
   months, and the backlog above survives either answer.
2. **⚠️ The fork has no usable ID.** `technology.md:845` calls it OD-21;
   `OPEN-DECISIONS.md:25` already spends OD-21 on the Obsidian workflow. It needs a
   free number before it can enter the decision log — a fork that cannot be cited
   cannot be closed. → [[decision-office-charter]].
3. **Which judgment task matters most commercially?** We propose vendor-reply quality
   because the label source already exists. If negotiation stance or recommendation
   usefulness matters more, that changes step 2.
4. **Are the `governance.py` confidence tiers currently gating anything a human would
   otherwise see?** If yes, [[agent-evaluation-gates-premortem]] #5 is not a forecast —
   it is a description, and the calibration work moves up the list.
