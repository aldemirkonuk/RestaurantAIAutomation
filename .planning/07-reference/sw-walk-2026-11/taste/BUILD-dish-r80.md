# BUILD dish - recipe roll-up (taste S5, gateway) (2026-11-19, r80)

PRs (DRAFT): #1941 (base feat/taste-split-1920-b = #1928 head 7fc3604b7) head e67c945e0, 29,793 chars; #1942 (base #1941 branch) head f77332e86, 22,297 chars (merge of #1941 head up, plain merge).
Worktree wt/taste-dish-r80 (removed after push).

## What shipped
- taste-priors.ts: PRIORS (class chemistry, belief q, relative sd, aroma), METHODS (yield, browning, fat uptake, char), DILUTION_BY_METHOD, curve constants K, suppression, ROAST_K. All labelled starting values.
- taste-rollup.ts: pure `rollup(input)`: R3 steps 1-8 (cook, dilute, mass-pool, saturating curves, suppression, p-norm aroma, bite-weighted mean/peak, 200 seeded draws). Returns axes {v, lo, hi, sd, conf} and a basis (lines by provenance, unknown names, dilution, mean, contrast, input hash).
- 1942: `POST /taste/:rid/:kind/:id/rollup` (cocktail|dish) reads recipe_current(_dish) -> recipe_versions.method -> recipe_lines, appends a `recipe` layer (method computed, stated_by null); idempotent on input hash; `POST /taste/:rid/rollup/preview` pure. Layer read-out gains `basis`.

## Decisions (no founder asked)
D-a. Layer axes carry sd = max(interval sd, 3*(1-conf)): fusion recomputes conf from sd and source prior (ignores a stored conf), so doubt must live in sd for "confidence drops with unknown lines" to survive the read. Rejected: changing fusion (another PR's file, and it is right to ignore self-reported conf).
D-b. Class priors have their own belief q (tight 0.5-0.6: sugar, syrup, citrus juice, spirit, salt, oil; loose 0.3: meat, cheese, produce). R3 gave one 0.3 for all; that would put every cocktail under the 0.4 summary line. Cap 0.6 so a prior never reads like a dataset. Rejected: single 0.3 (every roll-up withheld).
D-c. Provenance on the wire is source `recipe`; the class-prior share lives in ext.rollup (classPrior, dataset, measured, unknown counts) and comes back as layer.basis. Rejected: a new source value 'class_prior' (needs a migration, and the layer is still "from recipe").
D-d. A zero is stated only when every line is understood; otherwise the axis is absent (unknown stays unknown). Unknown-class lines add no chemistry, count as unknown mass, name themselves in basis.unknownNames.
D-e. Stored layer is "nobody" (stated_by null) so versions chain and a re-run never touches staff layers; same input hash = no new row.
D-f. Stated ABV from master_wine_library.abv_percent is NOT read: it needs the inventory -> library join; the pure function accepts `chem`/`chemProv` for it. The spirit class prior (40%) is used instead, tagged class prior; test shows 3.6 warmth (R3's 4.4 needs the labelled 45%, also tested).
D-g. Ingredient chemistry from a good's own taste layers (ext.chemistry) is NOT built: no writer exists for it and the house layer body refuses it. Pure fn takes chemistry; nothing sends it yet. Records as not done.
D-h. A dish is one part (recipe lines have no group column). Mean = peak for a dish today; multi-part works in the pure fn (tested) and in preview.
D-i. Missing recipe relation (tables only in #863/#1222 stacks): 503 recipes_unavailable sentence, nothing written. Dish also needs `dishes` (absent from main): answers "not in this house" via #1928's existing check. dish_id linking waits for the dishes stack; no code change needed then.
D-j. Preview takes typed lines only and never takes chemistry from the body (a caller must not be able to state "measured").
Not decided by me / left: fitted constants (fit target 40 items, 3 staff, Spearman 0.7), taste of a recipe's sub-recipe (a prep as an ingredient), 'each' lines weight (left out as unquantified).

## Tests
- gateway jest taste-rollup 21 pass; taste-recipe 19 pass; whole `src/taste` 6 suites 78 pass; earlier full gateway run at slice-1 content: 653 suites, 12056 tests pass.
- tsc --noEmit -p tsconfig.json: clean except ignored TS2307.
- Worked examples: whiskey sour (sweet 3.7, sour 6.2, bitter 1.4, alcohol 3.6; 4.4 with stated 45%), seared kofta/yogurt/charred tomato (peaks salty 4.8, umami 6.4, fat 7.1, sour 3.7; smoky peak 3.1 vs mean 1.2).

## Mutants (committed first, each restored)
Slice 1 (19): M1 no dilution, M2 unknown share ignored, M3 zero stated despite unknown, M4 sour not g/L, M5 yield skipped, M6 peak=mean, M7 no suppression, M8 missing qty not counted, M9 random seed, M10 measured believed like prior (first SURVIVED, test added), M11 accent fold (first SURVIVED, Turkish names added), M12 spread not widened, M13 fry fat (SURVIVED, test added), M14 char bitter (SURVIVED, test added), M15 aroma linear, M16 ice unknown, M18 interval collapsed: all killed. M17 (sd cap 3 -> 30) survives: only reachable with an interval wider than 9.9, unreachable at these relative sds; equivalent.
Slice 2 (14): S1-S14 all killed; S7, S8 (unit scale) and S9 (retry; first mutation hit the sibling line in appendHouse) fixed in test/mutator.

## Browser checks owed
None for these PRs (no UI). Later, with local stack and #863/#1222 stacks merged: POST rollup on a cocktail with a saved recipe returns 201 with a recipe layer; again returns same layers; edit a line and POST gives version 2.

## NOT DONE
(b) Web: TasteCard mounted on the cocktail/dish recipe sheet. Unreachable under 30K: the card stack is #1923 (17,032 chars) + #1924 (22,362) + #1925 (28,829) + #1926 (6,829) = 75K on the #1912 inventory base, and the recipe sheet lives on the #863 -> #1141 chain (and #1229/#1829/#1915 for dishes), a separate stack. A PR needs one base; any single base lacks the other stack. Recorded, not forced through a throwaway meet branch.
- Recipe tables absent from main, so the endpoint cannot run against main's database until #863 (cocktail) and #1222 (dish) land.
- dish_id FK/linking waits for dishes stack; ingredient chemistry from goods' own layers; ABV from the library; fitted constants; component groups for dishes.
