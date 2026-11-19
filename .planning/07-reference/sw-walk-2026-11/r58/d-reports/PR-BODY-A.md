## What changes
Every chart on /reports (the till, the week, the bench, the combination and the scatter) names what it draws once, in an 11 px caption above the plot, instead of a rotated title standing on the tick labels (design critic N-03). Ticks are 11 px tabular, the value-axis gutter is worked out from the widest tick label, gridlines are a 6% ink hairline, there is no axis line, and the plot's spoken name now says its highest and lowest point.

Stacked on #1509 (the newest open PR owning `rp-plot.tsx`). Replaces its `SideTitle`/`fitTitle` (the rotated titles) and re-pins the tooltip bound to the per-plot gutter.

## Tests
- `rp-axis-caption.test.tsx` (19): no rotated title on any of the five drawings, caption above the plot in document order, ticks 11 px, no axis line, hairline grid, gutter grows with the label, reading names high and low, stylesheet rule.
- `rp-tip-bound.test.tsx`, `rp-plot.test.tsx` updated.
- Mutation-tested (tick size, caption removed, constant gutter, grid opacity, reading removed): each makes at least one new test fail.

## Browser checks for the next walk
- /reports, owner, 1440 and 375 px, light and dark: no text overlaps on any chart (till bars and line, week, bench combination, menu-engineering scatter); caption reads "Taken, ... · by day"; left numbers sit clear of the plot edge at 4-digit and 6-digit figures.
- /reports at 375: tooltip stays on the plot when hovering the last bar.
- Dark: gridlines still visible but quiet; caption legible.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
