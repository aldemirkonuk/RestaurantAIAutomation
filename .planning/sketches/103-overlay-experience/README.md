---
sketch: 103
name: overlay-experience
question: "Given ADR 0112's three shapes, what does the reader EXPERIENCE inside them — and which ceremonies end in the seal?"
winner: accepted
tags: [modal, sheet, panel, overlay, ceremony, seal, peek, detents, mudavym, design-system, adr-0112, claude-design]
---

# Sketch 103 · Ten live sketches on the overlay experience

## Design question

Sketch 102 gave every overlay its shape. This canvas, reviewed by the founder on
2026-09-06 in Claude Design (his comments on 1b and 1c are applied in the file), argues
about the reader rather than the container: two turns, ten live sketches, every one
clickable, typeable, holdable. It is the accepted experience layer for BUILD-PROMPT
packet 5 (the behaviours) and the contract every packet-1/packet-2 builder is judged
against.

## The ten sketches

Turn one — the experience (census 102 · ADR 0112):

| # | Name | Shape | Fault it answers | What changes for the reader |
|---|---|---|---|---|
| 1a | The Pass | sheet · no scrim · non-modal | interruption | the sheet takes width, never light; the list keeps its pulse behind it |
| 1b | The Stub | sheet · torn, not closed | losing your place | Esc tears the sheet; a stub with your unwritten words stays on the row (resume · discard) |
| 1c | The Spindle | sheet ×3 · spine, not stack | nesting · the phone | each level collapses to a named spine; a fourth level is refused in words; on the phone the same three levels are detents with one breadcrumb (fork F9, answered once) |
| 1d | Weight | panel · seal | unsaved work | the paper gains weight as you edit, so a stray click cannot lift it; the seal reads back exactly what it bound |
| 1e | Announced | panel · the contract is the title | discovery · keyboard | one sentence states what it asks, what it writes, what leaving costs — and it is the accessible name |

Turn two — the ceremonies, on the house's own motion (`lib/mudavym/motion.ts` tokens verbatim: `pour` fills the hold, an early release retreats on `tuck`, the wax lands on `stamp`):

| # | Name | Shape | Fault it answers | What changes for the reader |
|---|---|---|---|---|
| 2a | Peek, then promote | peek → sheet · keyboard first | a sheet for a glance | Space opens a peek beside the list, arrows step, Enter promotes to the sheet only when the reader leaves the list (fork F8) |
| 2b | Two hands | panel · seal ×2 · step-up | one click moves money | approve and release are two seals seen at once; step-up first on a stale session; separation of duties is a sentence on the paper (forks F11–F12) |
| 2c | Grey until you say so | in place · ticks choose, the seal commits | AI that looks already done | the engine's three proposals sit grey beside the ink; one cell, one record or one batch is a tick, never a write; provenance never fades (ADR 0113) |
| 2d | The passcode at the pass | panel · seal · shared tablet | a device left open | a manager's four digits at the point of action, then the hold; the tablet locks itself when idle (fork F11) |
| 2e | Queued is never confirmed | bottom sheet · seal · four states | a tick that lies | offline, the record says how far it got — written here · sent · received · sealed by the house; the wax lands only when the house has it |

## How to view

```
open .planning/sketches/103-overlay-experience/canvas.dc.html
```

A Claude Design canvas export (`.dc.html`); renders from `file://`. The founder's own copy
lives outside the repo; this file is the record. Turn one sits 1a and 1c on warm charcoal,
the rest on paper — both grounds are checked, not assumed.

## What it decides, and what it does not

Accepted as the experience layer: the ten behaviours above are the contract for
`BUILD-PROMPT.md` packet 5 and the bar for packets 1–2 (a re-skin fails; each sketch changes
what the reader can do). It does not add a fourth shape, a second chromatic colour, or a
glyph for close — the policy (ADR 0112, Locked) stands unchanged.

## Related

- [[102-modal-census]] — every overlay in its shape; `BUILD-PROMPT.md` packets 1–5
- `087-mudavym-motion-canvas/founder-curation.dc.html` — the founder's curated motion
  canvas (136 demos, ten families incl. "Signatures — the unafraid set"), committed the
  same day
- ADR 0112 · ADR 0113 · DESIGN-FOUNDATION §6f
