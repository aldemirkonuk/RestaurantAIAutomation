---
sketch: 099
name: modal-shapes
question: "Three named overlay shapes with stated boundaries, or one shape everywhere?"
winner: null
tags: [modal, sheet, panel, popover, primitive, mudavym, design-system, accessibility]
---

# Sketch 099 · The three modal shapes

## Design question

The founder, 2026-09-03: *"create sketches for each because all have diff purposes …
Three main shape one primitive is a good start."*

A primitive is being built in parallel (`apps/web/src/components/mudavym/Sheet.tsx`,
`sheet.css`) exporting `Sheet`, `Panel` and `Popover`. This sketch does not build it —
it **draws what it will look like on the real pages that will use it**, so the founder
can see the taxonomy before it is enforced across thirteen overlays.

## How to view

```
open .planning/sketches/099-modal-shapes/index.html
```

Renders at 1440 from `file://`, no server. Both grounds: the page follows the viewer's
`prefers-color-scheme`, and each file also carries at least one specimen pinned to
charcoal via `data-ground="charcoal"` — which is the portal rule the primitive depends on,
demonstrated rather than described.

## The rule this sketch proposes

> **An object gets a sheet. A question gets a panel. A choice gets a popover.**

The shape is chosen by *what the reader must do next*, never by how much content there is
and never by which page it is on — so the shape itself carries information.

## Files

- **`index.html`** — the three side by side, when a page reaches for each, what each may
  never be, **the three hard cases** (the invite form, deleting one record, the composer),
  the seven outside sources, and the three forks for the founder.
- **`sheet.html`** — the right sheet on three real objects: the provider twin, a calendar
  entry carrying a **failed save said in words**, and a team member's ten fields drawn on
  the charcoal ground. Plus the primitive's measured numbers and the four "never"s.
- **`panel.html`** — ⌘K with its four real sections, Ask the book with its verbatim
  refusal line, and a publish-week confirmation carrying the seal on charcoal.
- **`popover.html`** — the bell, the branch switcher, the user menu, and the invite dialog
  anchored under its button; why this shape does not trap focus; why the seal never
  appears in it.

## What to look for

- Does the rule survive the three hard cases on `index.html`, or does it need a fourth shape?
- Is the sheet's **words-not-an-X** close control right everywhere it appears?
- The seal appears exactly twice in this sketch (delete a series; publish a week) and never
  in a popover. Is that the right ration?
- `sheet.html` stage 3 and `panel.html` stage 3 are charcoal on a paper page on purpose —
  that is the portal carrying the ground. Check they read.

## Every claim is cited

Each page ends with the `file:line` it was drawn from (re-verified 2026-09-03 on
`feat/mudavym-design-p4`) and the URL for every outside reference. Nothing here is
imported by the app.

**Example data, not a tenant** — every name, figure and date is invented for the drawing.
