## What changes
The /reports charts answer instead of sitting mute (design critic N-15, chart half). Stacked on the N-03 PR (#1826).
- Bars rise from the baseline over 480 ms on `cubic-bezier(.16,1,.3,1)`, 40 ms apart, once, when 40% of the plot is in view. Only transform and opacity move.
- With 8 or fewer bars each carries its figure in tabular mono (11 px); more bars leave the figures to the tooltip.
- The hover detail is a 10 px-radius card (`0 14px 28px -18px rgba(33,28,22,.35)`) that slides in over 120 ms with a 1 px ink crosshair.
- The seam where measurement stops (forecast) is a solid 1 px divider with a 4 px dot on the line.
- `prefers-reduced-motion`: no rise, no slide, no fade; everything is drawn where it ends. A browser that cannot report what is in view draws at once.

Not in this PR: no forecast band. The server publishes no 10 to 90 interval, and a band drawn from nothing would be an invented figure.

## Tests
- `rp-plot-motion.test.tsx` (12): the draw state machine (pending, drawn, stops watching, 40% threshold), reduced motion and no observer both draw still, per-bar stagger index on both bar drawings, label cut-off at 8/9 bars, seam divider and dot (threshold lines stay dashed, no dot), tooltip motion on and off, stylesheet numbers.
- Mutation-tested: eight mutants (threshold, reduced motion, stagger, label cut-off, seam style, duration, tooltip shadow, guard) all fail a test.
- `vitest run src/pages/reports`: 17 files, 324 tests pass. `tsc --noEmit`: clean.
- vite build, ReportsNext chunk vs the base: JS 176,734 B to 178,659 B (+1,925 B raw), CSS 17,448 B to 18,375 B (+927 B). No new dependency.

## Browser checks for the next walk
- /reports, owner, 1440 px, light and dark: scroll the till below the fold then into view, bars rise once, staggered, labels fade in after; scroll away and back, no second rise.
- Same with the OS "reduce motion" setting on: bars and figures present at once, hover card does not slide.
- /reports at 375 px: hover or tap the last bar, card stays on the plot; labels do not touch at 8 bars.
- "What's coming" (forecast): solid divider and 4 px dot at the seam, dashed run beyond, 1 px crosshair on hover.
- Dark: card shadow and border read, bar figures legible.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
