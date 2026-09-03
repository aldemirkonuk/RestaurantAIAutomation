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

| id | token | curve · ms | fires |
|---|---|---|---|
| `rp-open` | `settle` | `cubic-bezier(.16,1,.3,1)` · 420ms | the opening — wordmark, date, "What the books say." and the engine's loudest sentence — once on mount; opacity + 6px rise (`ReportsNext.tsx`, WAAPI via `animate()`) |
| `rp-rule` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the twelve-column ruling fading up when Arrange is entered and back down when the sheet is ruled off (`.rp-sheet::before` opacity) |
| `rp-lift` | `tuck` | sampled spring 380/32, `linear(…)` · 300ms | a cutting's shadow rising while it is dragged under the finger. The duration and easing are injected as `--rp-tuck` from the token itself, so the curve on screen IS `tuck` rather than a hand-copied approximation |
| `rp-ink` | `ink` | `cubic-bezier(.16,1,.3,1)` · 160ms | hover/focus micro-states on cuttings, chips, buttons and links — border, ground and colour only; nothing translates or scales |
| `rp-working` | `turn` | `cubic-bezier(.32,.72,0,1)` · 420ms | "Show the working" — the server's own `basis` sentences revealing on `grid-template-rows: 0fr → 1fr`. Deliberately the slow token: this is the "show the working" page-turn, not a disclosure toggle |
| `rp-ask` | `settle` | `cubic-bezier(.16,1,.3,1)` · 320ms | the ⌘K palette panel arriving; opacity + 6px from above (WAAPI via `animate()`) |
| `rp-sheen` | — (not a `motion.ts` token) | `cubic-bezier(.45,0,.55,1)` · 1.9s loop | skeleton bars while a register is genuinely in flight. Same treatment and timing as the dashboard's `skel-sheen`; kept identical on purpose so "in flight" looks the same everywhere. **Never** shown for an unknown — that is the static em dash |

## Deliberate non-motions

- **Figures of record do not count up.** No `tally` on this page. A figure of
  record is read, not watched — and half the figures in "Figures of record" are
  em dashes, so a ticker would be animating an absence.
- **No chart animates in.** Every recharts series carries
  `isAnimationActive={false}`. A line that draws itself makes a *projection*
  look like something happening, which is exactly the confusion the dashed
  forecast run exists to prevent.
- **The seal never takes wax here.** It appears once, pressed **dry**
  (`<Seal pressed color="var(--paper-2)" />`) beside "Ruled off." after the
  arrangement is saved. Arranging your own sheet is a routine, private act;
  the wax die is reserved for committing something to another party.
- **Cuttings do not stagger in.** A report is a reference you return to, not an
  arrival — and eight blocks cascading would fight the ruling's stillness.
- **Reduced motion**: the ruling, the lift, the ink states and the working
  expansion have their transitions removed outright; the skeleton sheen stops
  and the static bar remains; the two WAAPI motions land on their end state
  with zero duration.
