Stacked on #1840 (Landing.tsx / landing.css owner).

## What changes
Design need N-11, the landing on a phone. The sticky bar and the bottom dock no longer both offer "Start free": the bar's button is hidden under 960 px while the dock shows, and returns when the closing section's own button is in view. The seven platform cells are one row of 86% scroll-snap cards (under 680 px) instead of seven screens of scroll.

## Not in this PR
The 11 sub-44 px targets on the landing and its page height are not addressed.

## Tests
- `Landing.phone.test.tsx` (3): dock on hides the bar button and dock off restores it (driven through the IntersectionObserver callbacks); the css media rules; the carousel rule.
- Mutation (caught): docked class removed, 86% to 100%, hide widened to every width.
- `vitest run src/pages/landing` 5 files / 55 tests pass; `tsc --noEmit` clean.

## Browser checks owed
Landing at 375: scroll past the hero, only the dock offers Start free; near the close only the close's button; the platform row swipes and snaps with the next card peeking; the reveal animation still fires on cards swiped into view. 1440 unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
