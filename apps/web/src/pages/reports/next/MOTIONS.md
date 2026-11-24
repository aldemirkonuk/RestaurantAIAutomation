# ReportsNext — motions, canonical

Every motion below is a token from `src/lib/mudavym/motion.ts` (or the CSS
equivalent of the same curve) and collapses to its end state under
`prefers-reduced-motion` — via `animate()`'s reduced-motion branch for the two
WAAPI motions, and via the `@media (prefers-reduced-motion: reduce)` guard in
`reports-next.css` for the CSS transitions. Nothing on this page moves that is
not in this table.

The page's one structural idea is a motion: **the twelve-column grid is the
paper's feint ruling, and it only exists while you are arranging.** Reading is
plain paper; pressing "Arrange the sheet" draws the ruling on `settle`, and
that is the promise that a cutting will land square when you let go of it.

The second pass added two controls per cutting — "Show instead" and "Draw as" —
and **no motion at all**. They appear with the ruling and leave with it; a
select that animated open would be chrome celebrating itself, and swapping a
register is a change of subject, not an arrival.

The fourth pass added the keyboard path — a grip, a placing bar and a ghost —
and, again, **no new motion**. A cutting moved with an arrow key takes the same
`rp-lift` shadow a dragged one takes, because it is the same state; the ghost
appears and disappears with the pick-up, instantly, because it is a MARK on the
paper (this is where the cutting was) and a mark that faded in would read as an
animation of the cutting rather than a note about it. Cuttings do not tween
between grid positions on a keyboard move for the same reason they do not on a
pointer drag: react-grid-layout writes CSS transforms, and adding a transition
to those would put a moving cutting somewhere the announcement says it is not.

| id | token | curve · ms | fires |
|---|---|---|---|
| `rp-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 420ms | the opening — wordmark, date, "What the books say." and the engine's loudest sentence — once on mount; opacity + 6px rise (`ReportsNext.tsx`, WAAPI via `animate()`) |
| `rp-rule` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the twelve-column ruling fading up when Arrange is entered and back down when the sheet is ruled off (`.rp-sheet::before` opacity) |
| `rp-lift` | `tuck` | sampled spring 380/32, `linear(…)` · 300ms | a cutting's shadow rising while it is dragged under the finger, **or held from the keyboard** (`.rp-cut[data-held='true']` takes the same shadow as `.react-draggable-dragging`). The duration and easing are injected as `--rp-tuck` from the token itself, so the curve on screen IS `tuck` rather than a hand-copied approximation |
| `rp-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover/focus micro-states on cuttings (`.rp-cut` border and ground), chips, buttons and links — border, ground and colour only; nothing translates or scales. Also the till's last drawing dimming to 55% opacity while a newly picked window is read (`.rp-standin[data-stale]`); none under reduced motion |
| `rp-working` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | "Show the working" — the server's own `basis` sentences revealing on `grid-template-rows: 0fr → 1fr`. Deliberately the slow token: this is the "show the working" page-turn, not a disclosure toggle |
| `rp-ask` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the ⌘K palette panel arriving; opacity + 6px from above. **Since 2026-09-04 this is the house `Panel`'s own `settle`** (`components/mudavym/Sheet.tsx`, ADR 0112) — same token, same 6px, run by the primitive rather than by this page's `animate()` call |
| `rp-grow` | `settle` | `cubic-bezier(.16,1,.3,1)` · 360ms, stagger swept inside 160ms (`min(40ms, 160ms / (N-1))` a bar) | a bar chart's bars rising from the baseline, **once per cutting and drawing** per page session (`rp-draw.ts`: `pending` → `drawn` → `settled`), so the last bar is in by 520ms for any N. A resize, rotate, remount, or switch back to the same drawing paints `settled`, with no animation; `still` under reduced motion. transform only |
| `rp-sheen` | — (not a `motion.ts` token) | `cubic-bezier(.45,0,.55,1)` · 1.9s loop | skeleton bars while a register is genuinely in flight — including the moment after a cutting is swapped to another analysis and its first read is on the wire. Same treatment and timing as the dashboard's `skel-sheen`; kept identical on purpose so "in flight" looks the same everywhere. **Never** shown for an unknown — that is the static em dash |
| `rp-tip-in` | — (ease-out, not a token) | `ease-out` · 120ms | the hover detail (`.rp-tip`) arriving beside the pointer; opacity only. Kept short and off the house curve on purpose: it follows the pointer, so a longer settle would trail it. Nothing under reduced motion |
| `rp-value-in` | — (ease-out, not a token) | `ease-out` · 160ms, delay 360ms | a bar's value label (`.rp-bar-value`) appearing once its bar has risen (after `rp-grow`'s 360ms); opacity only; shown at once under reduced motion |
| `rp-spark-draw` | `settle` | `cubic-bezier(.16,1,.3,1)` · 360ms | a header spark's line (`.rp-spark__line`) drawing left to right on mount, `clip-path` only. Was 700ms, the longest unexplained motion on the page and replayed on every mount; it now matches the 360ms of `rp-grow`, so the headline and the bars below it settle together (r105 decision, 700ms rejected as decoration) |
| `rp-spark-dot` | — (ease-out, not a token) | `ease-out` · 240ms, delay 320ms | the spark's end dot (`.rp-spark__dot`) appearing as the line arrives (320ms = when the line is in); opacity only |
| `rp-ruled-in` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | a folded strip's "Ruled off." mark (`.rp-ruled`) arriving at the left of the 72px strip; opacity and transform |
| `rp-seg-thumb` | `settle` | `cubic-bezier(.16,1,.3,1)` · 260ms | the window pill's thumb (`.rp-seg__thumb`) sliding to the picked window; transform only |

## Deliberate non-motions

- **Nothing animates when the drawing changes.** Switching a register from an
  area to a heat map replaces the drawing outright. A cross-fade would suggest
  the two pictures are the same measurement in transit; they are two readings of
  one register, and the reader asked for the second one.
- **Nothing animates when the subject changes.** A cutting swapped from the wine
  quadrants to the room simply becomes the room, and shows skeletons while its
  register is read. A slide or a flip would dramatise a choice the reader has
  already made.
- **Figures of record do not count up.** No `tally` on this page. A figure of
  record is read, not watched — and half the figures in "Figures of record" are
  em dashes, so a ticker would be animating an absence.
- **recharts' own series animation stays off, and the CSS bar rise is the one
  exception.** Every recharts series carries
  `isAnimationActive={false}`. A line that draws itself makes a *projection*
  look like something happening, which is exactly the confusion the dashed
  forecast run exists to prevent.
- **The heat map does not ramp in.** Its cells are painted at their final
  opacity; a wave across the calendar would read as time passing.
- **The seal never takes wax here.** It appears once, pressed **dry**
  (`<Seal pressed color="var(--paper-2)" />`) beside "Ruled off." after the
  arrangement is saved. Arranging your own sheet is a routine, private act;
  the wax die is reserved for committing something to another party.
- **The ghost does not pulse, and the placing bar does not slide.** Both are
  present exactly while a cutting is held. A pulsing outline would compete with
  the live region for the reader's attention at the moment they are listening to
  it, and a bar that slid in would delay the first arrow key behind an animation.
- **Cuttings do not stagger in.** A report is a reference you return to, not an
  arrival — and eight blocks cascading would fight the ruling's stillness.
- **Reduced motion**: the ruling, the lift, the ink states and the working
  expansion have their transitions removed outright; the skeleton sheen stops
  and the static bar remains; the two WAAPI motions land on their end state
  with zero duration.
