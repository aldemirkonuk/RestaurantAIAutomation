# CellarNext — motions, canonical

Five motions, every one a token from `src/lib/mudavym/motion.ts`. The founder's
verdict on this page was *"so much crowded"*, so the ration is tight: a cellar
book is read, not watched. Nothing on the parent or on any register moves that
is not in this table.

| id | token | curve · ms | fires |
|---|---|---|---|
| `cl-stand-settle` | `settle` | HOUSE `cubic-bezier(.16,1,.3,1)` · 320ms | the reading stand opening above the register when a bottle is chosen, and closing when it is dismissed — CSS `grid-template-rows: 0fr → 1fr` on `.cl-stand`. This is the row-expand "settle" the founder singled out by name on board 053. |
| `cl-leaf-turn` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | the stand's *contents* when a different bottle is chosen while it is already open — opacity 0.2→1 plus a 4px rise, run through `animate()`. The page turns; the stand does not re-open. Deliberately slower than `settle`, per the token's own note. |
| `cl-ink` | `ink` | HOUSE · 160ms | every micro-state: register-card, shelf-card, row, chip, field and button hover/focus. Border warms to `--seal-ring`, ground lifts one paper step. Nothing translates, nothing scales, nothing moves more than 0px. |
| `cl-tally` | `tally` | sampled overdamped spring (stiffness 120 / damping 26, `linear(…)`) · 840ms | the seven figures on the parent surface — three per open register card, four in "In the building tonight" — on first arrival. Driven off `springs.tally.samples`, so the curve on screen IS the token. **An em dash never tallies**: `Tally` renders `null` instantly and returns before the rAF loop starts. |
| `cl-hold-pour` / `cl-seal-stamp` | `pour`, `stamp` (inside `HoldToApprove`) | `linear` · 620ms, then the stamp spring (500/26, ~11% overshoot) · 360ms | the only ceremony on the page: holding to send a real purchase order to a vendor. The seal appears here and nowhere else. An early release retreats on `tuck` and says what did not happen. |

## The one disclosed exception — framer-motion

`WineRegister.tsx` lazily imports `components/wines/MenuScannerModal`, shipped
legacy code that carries its own motion library: `MenuScannerModal.tsx:1` and
`MenuScannerTab.tsx:2` both `import { motion } from 'framer-motion'`, and both
live outside this page's owned paths. There is no lighter path inside this
directory — rendering the tab in a Mudavym dialog would not drop the dependency,
because the tab imports it too — so removing it means rebuilding the scanner
(page note §13.8). It is code-split, so it reaches neither the first paint nor
the bundle until an operator opens the scanner, and **none of its animations are
in the table above**: the scanner's motion is the legacy component's own, is not
tuned here, and is not claimed as house motion.

## Deliberate non-motions

- **The register does not stagger in.** 500 titles arriving one after another
  is exactly the busyness the verdict rejected. The table paints at once.
- **Switching register (Register ↔ Shelf) does not cross-fade,** and neither
  does navigating between `/cellar`, `/wines`, `/beer`… — a book does not
  animate when you put your thumb in a different section.
- **Unknowns do not animate and do not shimmer.** An em dash appears instantly
  and stays. A skeleton would say "in flight"; a dash says "unknown"; on this
  page the market-price column is *permanently* unknown, so it must never look
  like it is loading.
- **The unwired registers have no motion at all.** Beer, whiskey and cocktails
  are a static statement of what is missing. Motion there would suggest work in
  progress on screen when the work is in the gateway.
- **Reduced motion**: `.cl-stand`, `.cl-ink`, `.cl-register` and `.cl-bottle`
  drop their transitions in CSS; `cl-leaf-turn` collapses to its end state
  through `animate()`'s reduced-motion branch; `Tally` sets the final figure
  directly without a frame loop; `HoldToApprove` becomes a two-step confirm.
