# Sketch 069 · Legal agenda canvas

**Design question:** How does a department with **zero artifacts** show a real agenda on one
page without the picture becoming a wish list — when its only running evidence is a guardrail
somebody else maintains, and most of its fifteen document types presume counterparties that
do not exist yet?

**Context:** One canvas per department under [[0039-activation-plan-of-record]] Track B
(GENERATION_BRIEF §8.2 item 5). Source of truth is
`.planning/01-org/corporate/legal/legal-agenda-full.md` (2026-08-28) — 16 tasks, three
owners, six close-times. This file renders that agenda; it never adds to it. Open
`canvas.html` directly in a browser; no assets, no build, no JS.

## Direction

| | |
|--|--|
| **Domain** | Binding-surface census · DPA/BAA groundwork · register, gates, counsel, library |
| **Color world** | Docket: warm paper `#FAF8F5`, ink `#1C1917`, one burgundy `#8C3341`. Deliberately *not* the product's `#9E4249` — this is an internal thinking surface, not a customer-facing document |
| **Signature** | A close-time grid: owners as three lanes (Department · Instruments & Equity · Commercial & Workforce), close-times as seven columns. Every task chip carries its doneability in a `title` — hover, so the picture stays readable and nothing is lost |
| **Rejects** | A kanban of "todo / doing / done" — this department has no doing; a fifteen-document checklist — it reads as progress and measures nothing; any rendering of drafted clause text (directive R7) |

## Why the census is the spine and not the fifteen documents

The obvious canvas for a legal department is the fifteen instrument types with a status
each. It was drawn and discarded: fourteen of fifteen would read the same
(`NEW — no counterparty`), which is a picture of a calendar, not of work.

What is actually live is one question with running code behind it. ADR 0013 asked which
runtimes could commit the company, counted rather than trusting two "ported verbatim"
comments, and found 19 / 8 / 3 — with the runtime that could actually place an order
running the weakest list. The canvas leads with the census strip because that is the only
part of this department that has ever produced a fact.

## What the census strip shows (measured 2026-08-28, cited in the agenda)

| Channel | Guard state | Why the row exists |
|---|---|---|
| Email · gateway reply | guarded, no auto-send | 19 canon patterns, manager approval forced |
| Email · orchestrator draft | guarded **transitively** | No import of the canon; reached via `check_hard_constraints` → C-02's union. An import-grep census files a false finding here |
| Voice · vendor negotiation | **no guard on the path** | Speaks quantity + target price, gathers "press 1 if you can accommodate this order". Dormant — no in-repo caller — and one call site from live |
| SMS · transport | recipient class unsettled | Vendor sends were migrated away; "undetermined" is a legal answer, a guess is not |
| The sent corpus | **never read** | Production sorts outbound vendor mail into `DEMAND_OFFER` / `COUNTER_OFFER` / `ACCEPTANCE_CONFIRM_REQUEST`. Every guard runs at draft time |

The transitive-coverage row is the reason the sketch exists at all: it is the finding that
would have been missed by the obvious method, and it is why the census must be a specified
skill rather than a grep somebody repeats.

## Layout notes

- **Lanes over swimlane-per-task.** Instruments & Equity is almost empty by design — it
  owns checkers and refusals and no drafting skill, so an empty lane is the honest render
  rather than a gap to fill.
- **Chip tints carry grade, not priority:** burgundy = department work, amber = a reach item
  that may close as `BLOCKED` with a named holder, green = the founder decides or the
  founder sends, grey = specification only, nothing committed.
- **"Recurring" is a column, not a footnote.** Two of the department's five loops are
  event-closed and silent when nothing happens; a canvas that only showed dates would
  imply the department stops in October.
- **Three refusals get their own row.** No template drafting, no skill without a past
  instance, no opinion on what a surface means. On a page about paper, what is deliberately
  not being produced is load-bearing.

## Not built, deliberately

No status colours implying progress (there is none), no counts that would need a database
read to be true (LEG-5 is the one DB task and it is marked reach), and no rendering of any
instrument. Throwaway-grade, per the sketch conventions — a thinking surface for the
agenda, retired whenever the agenda's shape changes.

**Manifest row (added by the orchestrating session, not here):**

`| 069 | legal-agenda-canvas | How does a department with zero artifacts show a real agenda on one page — owners as lanes, close-times as columns, and the binding-surface census as the spine? | — | legal, agenda, wave3, binding-surface-census, guardrail, dpa, counsel-gate, close-times, two-teams, docket |`
