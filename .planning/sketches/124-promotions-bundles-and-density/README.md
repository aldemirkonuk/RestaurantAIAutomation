---
sketch: 124
name: promotions-bundles-and-density
question: "How do B's sized boxes read at C's ten-plus density, and what shape is a bundle on /promotions?"
winner: null
tags: [promotions, mudavym, bundles, density, tiers, box-size, adr-0160, adr-0165, adr-0169, sketch-only]
---

# Sketch 124 · Promotions — bundles and density

**Why this exists.** ADR 0160 §113 lists two drawings as owed *before* their builds
(`.planning/decisions/0160-*.md`, Consequences, "Drawings owed before their builds can
start"): **the bundle shape** and **B's sized boxes at C's 10+ density** ("no frame shows
size-encoded boxes with ten or more offers visible, and the two pull against each other").
This sketch is those two drawings. It supersedes nothing; it discharges that line.

Open `direction-a.html`, `direction-b.html`, `direction-c.html`. Each is self-contained
(inline CSS, no network requests; font stacks fall back to Georgia / system faces), drawn on
the **paper ground** (ADR 0169's default) with the house tokens copied from
`apps/web/src/styles/mudavym.css`'s paper column, including the `--warn` / `--loss` pair the
build adds. Every file folds to one column at ≤780px with no horizontal scroll (checked at
390px, 2026-09-25). Example data only — twelve offers from seven vendors, two of them
bundles. Regenerate with the generator kept in the lane's scratchpad (not committed); the
HTML is the record.

## What is already decided — every direction draws the same rules

- **Which offer earns which size** (ADR 0165 rule 4, Locked): at most one **hero** (the top
  offer with a positive worth), up to three **large**, everything else **compact** —
  including every offer whose worth is withheld.
- **When a worth exists at all** (ADR 0165 rules 1–3): the offer qualifies (the house's
  largest single order meets the minimum, in the minimum's own unit), the worth is real,
  and the comparison price is at most 180 days old. The example docket shows each refusal:
  a minimum with no unit (Kobrand), a stale comparison (Martignetti Rioja), not shown to
  qualify (Southern Glazer's mezcal).
- **The headline number** is the verdict against the lowest *other* vendor, never the
  vendor's own percentage (sketch 113's fork 1; "their claim" sits beneath it).
- **A bundle's worth** is all-or-nothing: the sum of its bottles' worths, withheld unless
  every bottle has one; a bottle with no comparison is excluded, never estimated (ADR 0165
  Consequences, founder 2026-09-19: "keep excluding"). The *Aperitivo pair* shows the
  withheld case.

What is **not** decided, and what these three directions answer differently: how the sizes
sit together when ten or more are on screen, and what a bundle looks like.

## The three directions

| | A · The Band | B · The Span Grid | C · Lead and Ledger |
|---|---|---|---|
| Density | A row per tier: hero band full width, three large across, compact tiles five across | One 6-column grid; tier = span (hero 3×3, large 2×2, compact 1×1), packed densely | Only the hero is a box; every other offer is a ledger row, size carried as row weight (30px vs 15px figure) |
| Rank order on screen | Strict, top to bottom | Can differ: dense packing lifts small cards beside big ones | Strict, one row per offer |
| Offers visible at 1440 | All 12 | All 12 | All 12, with room for ~6 more rows |
| Bundle | **Tray** — one card, its bottles set in as a small table; takes the tier its total earns | **Tied cells** — one small cell per bottle joined by a bracket carrying the total | **Group row** — the bundle's row carries the total, its bottles as indented sub-rows |
| Cost | Tiers leave white space when a tier is short (e.g. only one large offer) | Reading order ≠ visual order; big bundles need two rows of ties | "Bigger box" becomes "heavier row" — the founder's words were boxes |
| Closest to his words | "as long as the bigger … sale, the bigger the box" | the same, plus "everything is just put down next to each other" | "more than 10 … I'm able to see everything" |

Each file ends with the questions that direction raises of its own.

## Founder questions

1. **Density: A, B or C?** (Or a mix — the density answer and the bundle answer are
   independent; any direction's bundle can sit in any direction's grid.)
2. **Bundle: tray, tied cells, or group row?**
3. **Where does a bundle rank?** At the tier its rolled-up worth earns (A and B as drawn),
   or always after the single offers? (`rankOffers` in the build already ranks a bundle by
   its rollup; nothing yet draws it.)
4. **A bundle whose worth is withheld** — compact (as drawn), or sized by the best of its
   own bottles' worths? The second contradicts nothing in ADR 0165 but is a new rule.

Still open from sketch 113 and **not** answered here (listed so the pick is not read as
answering them): its question 6, *is an offer with no end date an offer?* — every direction
here keeps undated offers on the table, labelled "no end date", which is direction B's
answer from sketch 113, not a decision; ADR 0165's three open items (the extractor's
minimum unit, adaptive recency, per-wine vs mixed minimums).

## What the build does until he picks

`feat/promotions-mudavym` (lane W2-promos, 2026-09-25) ships `/promotions` dark behind
`mudavym_design_promotions` and builds **neither** part: every offer card is one size in
rank order, the tier is carried only as `data-tier`, and bundles are listed in their own
plain fold that opens the offer sheet bottle by bottle, with no bundle total drawn. CLAIMS
row `PROMOTIONS-OWED-DRAWINGS-NOT-BUILT` pins that, so a build that jumps ahead of the pick
fails CI; the row is superseded by the build that follows his answer.
