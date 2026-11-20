# r88 web lane (r87 findings 1 and 2)

Stacked draft PR #1960 (fix/r88-taste-basis, base fix/r86-recipe-sheet-fix = #1957). Diff 17,731 chars; #1957 stays 19,907.

## What
- services/api/taste.ts: TasteLayer.basis?: {notKnown: AxisKey[], lineSources: {name, from}[], unknownNames: string[]} | null, parsed defensively (unknown axis, bad `from`, blank names dropped; non-recipe layers null). getTaste returns UNREACHABLE_WORDS when isUnreachable(e) (no response).
- TasteCard: notKnown axes not already shown as rows -> "<Axis> / not known" rows (empty bar slot, no band word); "Worked out from: Gin (its own taste), Lime juice (typical of its kind)."; "Left out because its taste is not known: X." Failed card prints UNREACHABLE_WORDS when that is the reason.
- RecipeTasteLine: same for the top line.

## Decisions (rationale, rejected)
- Copy for a class prior: "typical of its kind". Rejected "typical lime": the wire carries the line name, not a class name, so any "typical <x>" would be invented.
- Unknown lines are not in "Worked out from" (they were not worked from); they get their own sentence. Rejected folding them in as "(not known)": reads as if used.
- A card whose only news is not-known axes counts as known (shows the rows) rather than "Nobody has described it": silence would read as nothing to say.
- An axis both in the effective rows and in notKnown shows the row only (the fused value won; the roll-up layer did not produce it).
- #1957 would have been 35.9K with this; I first pushed to #1957 by mistake, then restored it with a plain revert commit (b680d602a) and re-applied on the stacked branch. History on fix/r86-recipe-sheet-fix has commit + revert; net diff unchanged. No force-push.
- getTaste (services/api/taste.ts) is from #1954 but the file is present at #1957's tip with lib/unreachable.ts, so the change compiles there; no change on #1954/#1955 needed.

## Propagation (plain merges, no rebase)
- fix/r88-taste-basis -> resolve/r85-dish-taste-meet (40bee2957) -> fix/r85-dish-sheet-taste (0e61ad4ef). #1956 diff 4,040.
- resolve/r84-recipe-taste-meet, #1954, #1955 untouched (below #1957).

## Tests
vitest taste.test.ts, TasteCard.test.tsx, RecipeTaste.test.tsx: 79 pass; web inventory+cellar+services/api at stack tip 910 pass; at both r85 tips 1384/1385 pass; tsc --noEmit apps/web clean at each tip.
Mutations (each killed): parseLayer drops basis; getTaste unreachable branch removed; card ignores reason; line ignores reason; notKnown forced empty; shown-filter removed.

## Not done
Not opened in a browser (brief forbids). Gateway role gate on rollup (finding 3), CLS (4), roll-up content (5) not in this lane.
