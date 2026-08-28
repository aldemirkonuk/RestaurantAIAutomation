# Sketch 073 · Strategy & Fundraising agenda canvas

**Design question:** How does a department whose only asset is **a document it must audit**
show a real agenda on one page — when the honest picture is that its own vault drifted at
four separate points in the four days since it was chartered, and the department's whole
job is to notice exactly that class of failure in somebody else?

**Context:** One canvas per department under [[0039-activation-plan-of-record]] Track B
(GENERATION_BRIEF §8.2 item 5). Source of truth is
`.planning/01-org/corporate/strategy-fundraising/strategy-fundraising-agenda-full.md`
(2026-08-28) — 17 tasks, two units, six close-times. This file renders that agenda; it
never adds to it. Open `canvas.html` directly in a browser; no assets, no build, no JS.

## Direction

| | |
|--|--|
| **Domain** | The claim register · per-claim verification · verb strength · the wedge · readiness held behind the split trigger |
| **Color world** | Audit ledger: cool paper `#F7F7F4`, near-black ink `#14161A`, one slate blue `#2D4B73`. Deliberately **not** Legal's warm docket and **not** the product's burgundy — this surface is a verification record, and the only colours allowed to carry meaning are the three verdict states |
| **Signature** | A **verdict strip** before anything else: all seven sources of the founding artifact with their 2026-08-28 result — `holds` / `drifted` / `gone` / `inverted` — and the counts panel that corrects the department's own baseline from ≈29% to 71% |
| **Rejects** | A funnel or a raise timeline — there is no raise, no counterparty, and no clock; a "diligence pack completeness" progress bar — R4 caps readiness at one page and a bar would read as progress toward a breach; any rendering of deck layout, instrument text, cap table or price (directive R8, and the founder's locks) |

## Why the drift strip leads and the task grid does not

The obvious canvas for this department is the register: twelve claims, four grades, done.
It was drawn and demoted to §2, for a reason the department's own premortem names.

`strategy.claim_to_evidence_coverage` is **unmeasurable** — there is no register to measure.
`strategy.claim_overstatement_count` is **0 published**, and the charter calls that an
*unread zero*. `strategy.diligence_pack_completeness` is **0% and correctly so**. Four of
this department's five metrics have no reading, so a canvas built on them shows an empty
scoreboard and implies the department has not started.

**One number exists**, and it is a number about the department's own accuracy. The 2026-08-24
charter graded the founding artifact at ≈29% drift from a two-source sample. Re-measured
across all seven sources for this agenda: **5 of 7 — 71%**, including a file that has been
**deleted** and an inverted guard claim that appears **twice** in the same document, neither
recorded by any previous sweep. That is the only fact this function has ever produced, and
leading with it is the difference between a canvas that argues and a canvas that decorates.

## The verdict strip (measured 2026-08-28, every row cited in the agenda)

| # | Source as cited in `YC_WEDGE_PLAN.md:398-406` | Result |
|---|---|---|
| S1 | `procurement/invoice-match.ts` — no line anchor | **holds** — the only §6 citation built to survive a file moving |
| S2 | `ReceivingWorkspace.tsx:233,265` · `:92` | **drifted** — inputs at `:394` / `:434` by aria-label; `invoiceQty` initialises `null` at `:168`. The vault recorded `:401,440` one day earlier |
| S3 | `InvoiceScannerModal.tsx:88,126` | **gone** — no such file under `apps/`; zero references to `invoices/scan` |
| S4 | `scan-parser.service.ts:43–65` | **drifted** — the model call is `claude-haiku-4-5` at `:289` |
| S5 | `pos-hub.controller.ts:18,44` | **drifted** — `generic_webhook` description at `:76` |
| S6 | `procurement.controller.ts:33` | **holds** — exactly to the line |
| S7 | `ux-optimizer/` — *"0 `@UseGuards`, all re-confirmed 2026-07-27"* | **inverted** — `ux-optimizer.controller.ts:55` carries the guard; a **second instance** at `:194` |

The S3 row is why the strip exists at all: a *gone* file is the failure class no partial
sweep finds, and both prior sweeps stopped at two sources. **A partial sweep reported as a
baseline is `"all re-confirmed 2026-07-27"` one level up.**

## Layout notes

- **Two lanes, one cadence.** Department (boundaries) and team (the desk) are separate lanes
  because they own different work — and share one row of close-times because splitting the
  cadence is the decision this department declined until the first term sheet. A canvas with
  one lane would erase the seam; a canvas with two grids would draw the split.
- **Chip tints carry grade, never priority:** slate = unit work · **red = a correction this
  department owes itself** · amber = a reach item that may close `BLOCKED` with a named
  holder · green = the founder decides. The red class is unusual and deliberate — §5 of the
  canvas is three claims the department got wrong about *itself*.
- **"Recurring" is a column, not a footnote.** Four of this department's ten loops are
  event-closed and silent when nothing happens; a canvas showing only dates would imply the
  function stops in October.
- **Every doneability lives in a `title`.** Hover any chip. Keeping them off the surface is
  what lets 17 tasks fit one page without the page becoming the agenda.
- **No weekly column.** The register is empty and a weekly reading of zero is the theatre the
  org's own 60-day rule marks as fiction. Both schedules refuse a weekly cadence; the canvas
  refuses to draw a slot for one.

## Three refusals rendered as absence

1. **No deck, no data room, no cap table, no instrument, no price, no investor.** The footer
   says so rather than the layout implying it. R4 permits exactly one readiness artifact
   before the split trigger — a one-page index — and the grid shows it as a single chip in
   October, not as a workstream.
2. **No progress metaphor.** No percentage-complete, no burn-down, no funnel. Three of this
   department's five metrics are legitimately unreadable today, and a chart that filled them
   with zeros would be a fabricated verdict.
3. **No resolved fork.** OD-23 is reported, CORP-F3 is made readable in both directions, and
   CORP-F1 / OD-17 is recorded as sharper. The canvas draws none of them as closed.

## What this sketch is not

Throwaway-grade per the sketch conventions — a thinking surface, not a product, and not a
customer-facing artifact of any kind. The brand and landing-visual holds are untouched: this
is an internal ledger rendered in a palette chosen to be *unlike* the product's. Nothing here
is an outward claim, and nothing here may be sent.

## MANIFEST row

Do not edit `MANIFEST.md` from this sketch's session (ADR 0039 §8.4 keeps each wave-3 agent
inside its own files); the orchestrating session adds:

```
| 073 | strategy-fundraising-agenda-canvas | How does a department whose only asset is a document it must audit show a real agenda on one page — when its own vault drifted at four points in four days? | — | strategy, fundraising, claims, claim-register, citation-drift, provenance, verb-strength, wedge, diligence, yc, agenda, canvas, wave-3 |
```
