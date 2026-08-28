# Sketch 059 · Security Agenda Canvas

**Design question:** Can a department's whole quarter — tasks, owners by team, close-times,
the six metrics, and the seams it depends on — be read in one screen *without* collapsing
into a single security score? Security's founding rule is that its numbers are a **set,
never summed**; most one-page dashboards exist precisely to sum things.

**Context:** Wave 3 (ADR 0039 Track B, `GENERATION_BRIEF.md` §8) — one HTML canvas per
department, alongside the rewritten
[`security-agenda-full.md`](../../01-org/intelligence/security/security-agenda-full.md) and
[`security-agenda-board.md`](../../01-org/intelligence/security/security-agenda-board.md).
Throwaway-grade: a thinking surface, not a product page. Self-contained, no assets, no fonts.

## Direction

| | |
|--|--|
| **Domain** | Endpoint classification (OD-19), ingress verdicts, the adversarial corpus, the §12C checklist |
| **Color world** | Near-black ops board with sketch-family burgundy `#CD2D5B` as the only accent; amber = reach, blue = seam- or escalation-gated, green = discharged |
| **Signature** | The **denominator ledger** strip across the top — `86 → 103 → 94 → 40 → 6` — the department's own recurring defect rendered as the first thing you see |
| **Rejects** | A single security score; a burn-down chart (it would show 94→6 as triumph and hide that the lid never shipped); RAG status dots; any percentage |

## What the canvas shows

1. **Denominator ledger** — five statements of the same count in four days, with the current
   residual highlighted and the six routes named inline. This is the visual argument for
   task S19 (one committed script per metric).
2. **The board** — four lanes (SEC-1 access control · SEC-2 perimeter · SEC-3 AI surface ·
   department) × five close-time columns from 2026-09-04 to 2026-10-30. Each card carries
   its id, title, close date, and **its doneability in the card itself** rather than in a
   tooltip — a close-time you cannot see is the failure the agenda format exists to prevent.
3. **Metrics strip** — twelve readings with their arcs (`94 → 40 → 6`), captioned with the
   never-summed rule. Two are green because *other units* discharged them since founding.
4. **Seams** — six cards distinguishing *we specify → they author*, *audit only*, *blocks
   us*, *handed over unruled*, and one **declared gap** with no publisher at all.
5. **Founder questions + locks** side by side, so the honest half of an ambitious agenda is
   not below the fold.

## Layout decisions

- **Lanes are teams, columns are close-times.** The alternative — lanes as campaigns —
  hides that SEC-2 has nothing due in week one and that the department lane is nearly empty
  until October. Empty cells are information here, so they are drawn, not collapsed.
- **Doneability rides on the card.** Tried it as `title=` hover text first; a doneability you
  have to hover for is a doneability nobody reads, and the agenda's hard requirement is that
  every task names one.
- **Closed items are struck through on the board doc, not shown here.** The canvas is what
  is *owed*; the severity queue's four closures live in `security-agenda-board.md`.
- **No JavaScript.** Nothing on the page needs state, and a sketch that needs a runtime to
  be legible has stopped being a sketch.

## Honest notes

- The layout goes single-column under 1100px. It is designed for a laptop screen and is
  legible, not pretty, on a phone.
- Card positions encode close-time buckets, not dependencies. S1 → S2 → S3 is a real chain
  and the canvas does not draw it; the agenda's §2 carries the ordering argument instead.
  A dependency-arrow version was considered and rejected as unreadable at 20 tasks.

**MANIFEST row:**

`| 059 | security-agenda-canvas | Can a department's quarter — tasks, teams, close-times, metrics, seams — be read in one screen without collapsing into a single security score? | — | security, agenda, wave-3, org, endpoints, od-19, injection-corpus, ingress, metrics-set, ops-board |`
