# BUILD rollup r86 (R85 walk finding 4)

Branch feat/taste-r86-rollup-layers, DRAFT PR #1958 on #1942 (diff 27,778; #1941 is 29,793 so it could not take more).
Carried up by plain merges into resolve/r84-recipe-taste-meet, fix/r84-taste-client (#1954), fix/r84-recipe-sheet-taste (#1955), resolve/r85-dish-taste-meet, fix/r85-dish-sheet-taste (#1956). PR diffs after: 1954 10,007, 1955 27,139, 1956 4,040 (unchanged).

## What
- (a) RollupLine.own = the good's fused layers (measured > dataset/standard > staff line/note; AI drafts and other houses never). Service reads recipe_lines.inventory_id, then taste_profile_current for those goods, restaurant-scoped. Each axis the good states beats the class prior; axes it does not state fall back to the label's prior. Good's 0-10 value is turned back into pooled chemistry by undoing the saturating curve (cap 9.5); aroma axes become strength v/10. basis.lineSources lists per line from good | class_prior | unknown; basis.staff counts staff-layer lines.
- (b) "none" (v under 0.5, or a typed 0) is stated only if every line is known on that axis: field in the good's layer, in the prior's chem, or in NONE_BY_CLASS (the prior says absent). No amount, or no reading, makes it unknown. Skipped axes are named in basis.notKnown. PRIORS_VERSION 1 -> 2 (meaning changed) so stored layers re-roll.
- (c) Worked example gin+lime+syrup shaken, staff gin bitter 6 + herbal 7: bitter not-known -> light, herbal absent -> medium (test pins the bands).
- Goods table unreadable = 500 with a sentence, never "no good has a taste" (ADR 0020).

## Decisions (taken, not asked)
- Field-wise precedence (good over prior per axis) over all-or-nothing: a staff line on one axis should not drop the label's alcohol. Rejected: replace the prior wholly (loses abv, woody), average the two (hides which one spoke).
- Invert the saturating curve to get chemistry from a 0-10 layer. Rejected: add the layer's v straight onto the output axis (breaks dilution and quantity: 5 ml of gin would read as strong as 50 ml).
- Absence is stated per class in NONE_BY_CLASS, not guessed from "field missing". Rejected: treat every missing field as known zero (the bug), or every missing field as unknown (a plain gin+syrup could never say "no fat").
- Table beside the priors, not a field on each prior line: first form made the PR 32,095 chars; the table form is 27,778.
- Belief for a line with a layer: the layer's source q; averaged with the prior's q only while the prior still supplies a field the good did not state.
- Chemistry-by-body (line.chem) path left as it was (replaces the prior); only the new own path merges.

## Proof
- taste-rollup-layers.spec.ts 13 tests, taste-recipe.spec.ts +5 service tests. Ten mutants (own ignored, old zero rule, identity inverse, NONE list dropped, service drops own, read error swallowed, AI draft counted, no restaurant scope, null qty counted known, lineSources always prior) each fail 1-6 tests; NONE-dropped re-killed (4) after the refactor.
- api-gateway: tsc --noEmit exit 0; jest 654 suites passed (2 skipped), 12,076 tests passed. After merges: taste suites 96 passed, tsc exit 0.

## Not done
- Web: the card prints what the gateway returns; no web change to say "not known" for basis.notKnown axes or to show lineSources. Absent axis is simply not drawn today (not checked in a browser; no stack per brief).
- Goods with no inventory_id link (untracked lines) still use the label prior.
- #1957 (sheet-fix, another lane) does not contain this change; it will on its next merge from #1955.
- Only the taste suites re-run on the merged meets; full jest ran on the PR branch.
