# Sketch 060 · Analytics &amp; BI — Agenda Canvas

**Design question:** Can a department whose whole product is *"the number means the same
thing everywhere"* show its own agenda on one page **without violating its own rule** —
no roll-up, no health score, every figure carrying its denominator or the words *not
computed*?

**Context:** The wave-3 canvas for `01-org/intelligence/analytics-bi`
([ADR 0039](../../decisions/0039-activation-plan-of-record.md) Track B,
`GENERATION_BRIEF.md` §8.2 requirement 5). It renders
[`analytics-bi-agenda-full.md`](../../01-org/intelligence/analytics-bi/analytics-bi-agenda-full.md)
as one picture: 21 tasks, their owning team, their close_time, and the seams they touch.
Throwaway-grade — a thinking surface, not a product.

## The constraint that shaped it

Most agenda canvases resolve into a progress bar or a score. This department's
`abi-orchestrator` card carries a **hard rule against exactly that**
(`analytics-bi-agent-stack.md:61-64`): it never averages, ranks or totals the five
department numbers, because `kpi_ground_truth_agreement` is 0% and blocked, and any
aggregate would hide the one number the department exists to publish.

So the canvas has **no summary tile anywhere.** The five numbers sit as five separate
cards, each with its denominator and its next task, under an explicit line saying no
roll-up exists. Every count in the census panel is shown per-bucket and never added up.
That refusal *is* the design.

## What is on it

| Band | What it shows |
|---|---|
| **The five numbers** | Each with denominator, state (`measured` / `not computed` / `blocked` / `divergent`) and the task that moves it. Colour-coded by state, not by health |
| **The matrix** | 4 team lanes (department · AB-1 engine · AB-2 narrative · AB-3 truth-assurance) × 5 close_time columns (09-04 → 10-30). Every chip carries its task id, its one-line doneability, and its cadence where it is recurring |
| **The census** | The 375-vs-573 divergence in four buckets — 5 assertive code sites, 7 assertive lines in one reference file, 10 stale-as-unresolved rows in three other units, and **7 citational uses that must not be edited** because editing them deletes the audit trail |
| **The seam** | 28 loops elsewhere name this department `inputs_from`; 25 send outputs to it; it publishes nothing. Counted from `00-index/loops.json` |
| **Three strips** | Locks respected · findings no card or loop can carry · reach items with their grades |

## Colour legend

Programme, not priority: **A** amber (truth board — the spine), **B** burgundy
(375→573 reconciliation), **C** teal (grounding expansion), **D** violet (measure the
unmeasured). Team is the row, close_time is the column, so a chip's position already
says who and when — colour is free to carry programme.

## Evidence behind the numbers on the canvas

Everything printed on the page was measured on **2026-08-28** in this worktree, not
copied forward from the 2026-08-24 charter (several charter figures had moved):

- `28` / `25` / `22` loops — `.planning/00-index/loops.json`
- `5` assertive code sites — `commands.ts:84,105`, `InsightCatalog.tsx:2`,
  `analytics.controller.ts:226`, `insight-generator.service.ts:55`
- `7` assertive lines — `07-reference/UX_PATHS_CATALOG.md:1548,1550,1569,1571,1583,1598,1603`
  (the charter's anchors `:1543,1564,1566,1593` have drifted)
- `69` distinct `catalogIds`, max `352`, none in Batch 6 — extracted from `metric-registry.ts`
- `149` engine/catalogue spec cases vs `23` service-adjacent — `it()` count across
  `apps/api-gateway/src/analytics/**/*.spec.ts`
- `6` `Promise.allSettled` collapse sites in `analytics/`, one of which builds the
  consultant evidence pack (`consultants.service.ts:119`)

## Deliberately not on it

- **A percentage-complete indicator.** There is no such number, and inventing one would
  be the exact ADR 0020 failure this department polices.
- **Team comparison.** AB-1 is rewarded for computing more, AB-2 for saying less, AB-3
  for telling both they are wrong. Ranking the lanes would collapse the tension the
  department is built out of.
- **Anything past a lock.** No pricing figure, no landing/brand visual.

## Open

- Whether the matrix should carry the **blocked** loops as a fifth lane, or keep them in
  the numbers band where their blocker is named. Kept in the band for now — a blocked
  loop with a named owner is a *reading*, not a task.
- Whether the seam panel should list all 28 consumers. Truncated at 8 + a count here;
  task **A2** produces the full mapping, and that belongs on the board, not on a sketch.

## Manifest row

Not added by this agent (wave 3 forbids editing `MANIFEST.md` directly — the
orchestrating session merges the rows):

```
| 060 | analytics-bi-agenda-canvas | Can a department whose product is "the number means the same thing everywhere" show its own agenda on one page without a roll-up — every figure carrying its denominator or the words "not computed"? | — | agenda, analytics, wave-3, org, truth-board, metric-contract, loops, no-roll-up, census, canvas |
```
