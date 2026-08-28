# 063 — Motion canvas

One surface dedicated to movement. Founder brief, 2026-08-27: *"create one canvas only
dedicated to motion, at least 50 different motion ideas or total of many motions to
explore."* **62 motions**, live, replayable, in five families.

## Families

| Prefix | Family | n | Covers |
|---|---|---|---|
| `ent` | Entrances & reveals | 12 | Staggered arrivals, skeleton→content, scroll reveal, empty→first row, FLIP into a grid, a late async row slotting into a sorted list without shoving, dense table painting by column, thumbnail resolving |
| `st` | State & feedback | 12 | Toggles, ticks, presses, **hold-to-approve landing the wax seal**, the undo window draining, a confirm that retreats, success as a rule under a total, an error that shows its working, optimistic actions where one confirms and one comes back |
| `num` | Numbers & data | 12 | Count-ups, odometers, delta flips, a figure correcting downward after a discrepancy, sparklines, bars, a stock level crossing par, gauges, cost drift showing its working, and an **em-dash unknown that never animates as a number** |
| `nav` | Navigation & structure | 12 | The `settle` row expand (0fr→1fr, chevron on the same token), show-the-working, tab indicator travel, the vendor drawer, modals, route change, accordion, condensing chrome, filtering where rows *leave* rather than repaint, sort where rows travel, shared-element master→detail, command palette |
| `srf` | Product surfaces | 14 | The founder's own list: media display, order bars, comms, mail, team, invitations |

The `srf` set is the one the founder named directly: invoice opening full-bleed, a
document page turning, a scan resolving from capture to a read document; a purchase
order advancing through its states, ordered-against-landed, order lines rebalancing
when one is short; the vendor thread opening and waiting; **the AI draft stopping at
the human** — the never-auto-send guardrail expressed as motion, not as a label;
an inbox row triaging itself, an attachment detaching into a record; a shift dropping
into a slot, a call-out opening a gap and a cover closing it; an invite code becoming
a person, and a pending invite expiring.

## How it works

- **Skin toggle.** Branded (Warm Charcoal ground + İznik seal + Fraunces) ↔ neutral
  greys, so movement can be judged with the brand argued for it and without. Every
  part is authored against a fixed variable set (`--m-bg`, `--m-accent`, …) and holds
  **no hard-coded colour**, which is what makes the toggle reach inside every demo.
- **Speed** from 0.2× to 2×, so a 240ms spring can actually be watched.
- **Family filter**, per-card **Replay**, hover-to-replay, and **Play all**.
- Every demo states its own curve — real spring numbers sampled into CSS `linear()`,
  or a named cubic-bezier with its duration.
- Reduced motion collapses every demo to its end state.

## Build

Five agents wrote five fragments against a shared contract
(`scratchpad/CONTRACT.md`): scoped class prefixes, variables-only colour, and a
`window.MUDAVYM_MOTIONS.push({id, name, family, purpose, spec, html, play})`
registration. `scratchpad/build_motion_canvas.py` concatenates them into the host
and checks the contract (fragment-only, no stray hex). The pipeline was proven with a
throwaway probe before the parts existed — registration, render, replay and the skin
toggle were all verified reaching inside a part.

## Declared honestly

- **62 motions registered, 62 cards rendered, 0 empty stages, 0 console errors** —
  measured in the assembled page, not assumed.
- The Browser pane stopped compositing frames partway through the check (five agents
  had been contending for it all session), so the **Entrances** family was seen
  rendered in full and the rest were verified through the DOM and computed styles
  rather than watched. Per-frame playback of every demo is therefore *asserted from
  parameters and structure, not filmed.*
- Each agent verified its own set in isolation before assembly. The **Entrances** set
  went further than the rest: blocked out of the shared pane entirely (the tab cap was
  held by siblings), it drove real headless Chrome over CDP instead — frame captures at
  t=0/320/600/1000/1600/2500 in both skins, and a genuine `prefers-reduced-motion`
  reload confirming every demo lands within 180ms. The **Numbers** set separately
  proved teardown is clean: ten rapid replays of its live demo leave exactly one
  interval running, zero after kill.
- **`color-mix()` has no fallback** — 45 uses across `ent`, `st`, `num` and `srf`.
  It has shipped in Chrome, Safari and Firefox since 2023, so this is a real gap only
  for genuinely old browsers. Left deliberately unpatched: writing 45 fallback
  declarations into a sketch is the gold-plating the "keep it as simple as possible"
  rule exists to prevent. If any of this motion is promoted into the product, that
  is the moment to add them — not before.
- **A process mistake worth recording, and its consequence.** The canvas was first
  assembled, published and committed the moment the five part files *existed* — but
  three agents were still working, and kept revising. The published build was
  therefore stale, and shipped without: the State set's replay fix (`st-04/05/06`
  stranded on a stale closure and only animated correctly on first play), the
  Product-surfaces `box-sizing` fix (all fourteen of its demos overflowed their cards
  by 22px), and its drag fix (a shift grabbed mid-flight jumped, because the drag read
  the block's target rather than its live matrix). All three are present in the
  rebuild. The assembly step also deleted an agent's test harness mid-verification;
  it recreated it and lost nothing.
  **The rule this earns:** the parts directory is agent-owned until every agent has
  *reported* — file existence is not completion, and neither is a harness being
  cleaned up (one agent deleted its harness and then worked for another thirty
  minutes). Assemble on the last completion notification, nothing earlier.
- One host-level defect found in the rebuild and fixed: the widest demo measured 303px
  inside a 278px stage and was clipping silently. The grid's minimum column went
  304px → 332px rather than editing an agent's part. Re-measured after: **62 cards,
  zero overflowing stages, no horizontal page scroll, no console errors.**

| 063 | mudavym-motion-canvas | 62 motions on one surface — which movements belong to Mudavym? | null | motion, canvas, animation, springs, skin-toggle, entrances, feedback, numbers, navigation, product-surfaces, od-106 |
