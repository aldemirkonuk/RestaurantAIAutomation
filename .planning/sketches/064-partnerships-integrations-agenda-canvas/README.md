---
sketch: "064"
name: partnerships-integrations-agenda-canvas
question: "Can a department whose three headline metrics are moved by counterparties, not by itself, show its agenda as one picture without the zeroes reading as failure?"
winner: null
tags: [agenda, partnerships, integrations, pos-bridge, connector-trust, vendor-network, counterparty, canvas, wave-3, adr-0039, throwaway]
---

# Sketch 064: Partnerships & Integrations — Agenda Canvas

## Design Question

**Can a department whose three headline metrics are moved by counterparties, not by itself, show
its agenda as one picture without the zeroes reading as failure?**

[[partnerships-integrations-agent-stack]] states this department's whole job unusually plainly:
three of four counterparty classes are blocked on something no agent can produce — a merchant
token, a signature, a distributor saying yes — so the department agent's value is *"keeping four
zeroes readable rather than making them move."* A canvas that renders those zeroes as red
progress bars would be a lie about what the department controls. This one renders **who moves each
number** beside the number, and gives every task a lane, a close date and a carrier.

## How to View

```
open .planning/sketches/064-partnerships-integrations-agenda-canvas/canvas.html
```

Self-contained: one file, no external requests, no fonts fetched, system font stack. Dark by
design — it is a thinking surface, not a product page. Verified in-pane at 1440×1000 on
2026-08-28: no horizontal overflow, 24 task chips, 8 metric tiles, 5 lanes × 6 time columns.

## What it shows

| Region | What it answers |
|---|---|
| **Metric strip** (8 tiles) | Where every department number stands *today*, with `not emitted` written out rather than shown as 0 — the ADR 0020 convention this department's card is held to |
| **Lane × close-time grid** | All 24 tasks placed by owning team (5 lanes) and close date (6 buckets, W1 → W12+). The picture the agenda text cannot give: which team is idle in which week, and where the load actually falls |
| **The finding panel** | The one thing worth taking to the founder — why the "second POS provider" is blocked on an unregistered fork rather than on engineering |
| **Open forks** | Four registered, **four drafted-and-never-registered**, colour-separated |
| **Seams touched** | The eight units and one ADR track that have to agree for this agenda to land |
| **Rules in force** | The deliberately inconvenient constraints, including the two locks |

## What the picture made visible that the prose did not

1. **Connector Platform & Trust carries the W2 week almost alone** — three of the six W2 tasks are
   theirs. The lane grid shows it instantly; the task list does not.
2. **Partner & Alliance Development has an empty W1 column and that is correct.** Its first
   deliverable is a ledger, not contact, and the blank cell is the honest rendering of a team whose
   clock belongs to someone else.
3. **Supplier & Distributor Network's last column is not a task — it is a clock.** The 90-day
   dissolution clause (2026-11-22) sits in the grid as a red cell, so the team's own possible
   dissolution is on the same surface as its work. That is premortem M4's counter-pressure made
   visible instead of filed.
4. **The department lane runs the full width.** Board, drift repair, fork hand-off — the
   coordination work is continuous, which is what a one-card department looks like.

## Colour

One hue per team, carried from lane border into every chip's left rule: pos-bridge amber,
connector-trust blue, supplier-distributor green, partner-alliance mauve, department gold. Red is
reserved — it marks a zero that matters, an unregistered fork, and the dissolution clock. Nothing
else is red, so red always means the same thing.

`REACH` chips (PI-02, PI-09, PI-16) are raised with an inset ring: ambitious, and fully carried by
a card or loop. A **dashed** left rule (PI-16, PI-18) means aspiration pending a decision — the
§8.2 honesty requirement rendered rather than footnoted.

## Status

**Throwaway.** A thinking surface for the 2026-08-28 agenda under
[[0039-activation-plan-of-record]] Track B, not a design proposal and not a route. Its companion
of record is
`.planning/01-org/product/partnerships-integrations/partnerships-integrations-agenda-full.md`;
if the two disagree, the agenda is right and this file is stale.

Every citation shown on the canvas was re-verified against the working tree on 2026-08-28.
