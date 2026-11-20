# VERIFY r93 taste priors (2026-11-19)
Branch feat/r92-taste-priors (#1964). Gate: full gateway jest 656 suites / 12106 tests passed (2 skipped), tsc -p tsconfig.spec.json exit 0, both at the unchanged tip b9f4a3fa2 and again after the corrections. The priors broke nothing outside src/taste.

Method: USDA FDC API (DEMO_KEY) still 429 (limit 10/h, remaining 0). Checked against nutritionvalue.org pages that state "USDA SR Legacy" as source, per-serving values scaled to 100 g by me. NaCl g = Na mg x 2.54 / 1000. se uses R3 s2 factors (glucose 0.75, fructose 1.4, lactose 0.2). A "verified" is within about 10 % of the page. Where this source and my recall of SR disagree, the row is unverified, not corrected.
The confidence model (taste-rollup.ts) reads only the class `q`, never the citation text; so UNV is recorded in CLASS_SOURCES (code UNV), not wired into q. Lowering q for UNV classes is a product call, not made.
PRIORS_VERSION 3 -> 4 (values changed; stored layers read stale). Worked-example expectations: none needed changing; all 126 taste tests pass as written.

## Corrected (from -> to)
- honey-agave se 75 -> 85: honey sugars 82.1 g, fructose 40.9 x1.4 + glucose 35.8 x0.75 + other 5.4 x0.4 = 86; the old note's "= 76" did not follow from the SR split. Maple (67) now reads high; class not split (diff cap).
- ketchup nacl 2.8 -> 2.3 (Na 906 mg).
- butter nacl 1.5 -> 1.6 (salted, Na 640 mg).
- meat-lamb fat 20 -> 23, nacl 0.18 -> 0.15 (raw ground lamb 23.4 g fat, Na 60 mg).
- soy se 1 -> 0.5 (sugars 0.38 g).
- red-wine se 0.2 -> 0.6 (residual sugars 0.6 g/100 g).
- mushroom se 0.8 -> 1.5 (sugars 2.0 g read as glucose x0.75; sugar split not read, so this one is an estimate).
- yogurt nacl 0.17 -> 0.12 (Na 42-46 mg).
- milk fat 3.5 -> 3.3 (whole 3.25 %: 3.27 g).

## Verified (no change)
salt (Na 38,750 mg = 98.4 % NaCl; 100 kept), sugar (pure sucrose), ice-water, oil (fat 100), gin/clear/dark/agave/brandy 40 % (86-proof page 36 g alcohol/100 g, 80 proof = 40 % ABV), red-wine abv 13.5 (10.5 g/100 g), beer abv 5 (4.04 g/100 g), orange-juice se 8.5 (8.4), lemon-lime se 2.5 (2.5), cheddar-type (Na 653 -> 1.66, fat 33.3), egg (fat 9.5, Na 142 -> 0.36), anchovy nacl 9.3 and fat 9.7 (Na 3668), mayonnaise (fat 74.8, Na 638 -> 1.6), cream (fat 36.1 vs 35, Na 27 -> 0.07; heavy whipping, kept), milk nacl 0.1 and se 1 (lactose 5.05 x0.2), carrot (4.74 sugar, Na 69 -> 0.175, fat 0.24), garlic (sugars 1.0, Na 17, fat 0.5), onion se 4 (4.2 sugars), potato (0.81, Na 5, fat 0.09), bell-pepper se 3.5 (red 4.2, green about 2.4 by recall), pineapple se 10.5 (sugars 9.98, factor weighted), cranberry se 12.5 (sugars 11.9, factor weighted), soy nacl 14 (Na 5494 -> 13.96), butter fat 81, butter-like fat, pork fat 14 (loin 12.6, cut dependent, kept) and pork nacl 0.17 (loin Na 50 -> 0.13, kept), ketchup se 24 (sugars 21.3), glutamate: parmesan 1.2, soy 0.8, fish sauce 1.0, tomato 0.15 per the sources the r92 build read (ranges in BUILD-priors-r92.md).
Not rechecked this pass but read from SR in r92: coffee liqueur, white wine, fortified wine.

## Unverified estimate (code UNV in CLASS_SOURCES)
- hard-cheese: nacl 3.9 / fat 26 are SR as I recall them (Na about 1530); the page read 1175 mg Na, fat 25.0. Sources disagree.
- feta: nacl 2.3 (SR Na about 917 by recall); the page read 1139 mg (= 2.9). Sources disagree.
- bacon: nacl 2.1 / fat 40 fit raw bacon by recall; the cooked page read NaCl 4.3, fat 35. Raw page not reached.
- meat-beef: fat 15 is a cut-blend; ground 80/20 raw reads 20.0, Na 66 -> 0.17. Cut dependent, kept.
- poultry: fat 8; meat-and-skin raw reads breast 9.3, thigh 16.6; skinless is lower. Cut dependent, kept.
- fish: no page read.
- pork: cut dependent (see verified note).
- tomato, tomato-paste (unsalted paste reads Na 59 = 0.15 vs 0.3 kept for a mix of salted/unsalted), tomato-canned, stock, balsamic, tonic-cola, grapefruit-juice (sugars not on the page), herb, spice, nut, starch, leafy-greens: page not reached or no figure on it.
- anchovy glutamate 0.5: commercial page only.
- mushroom se 1.5: see corrected; sugar split not read.
- beer se 0.3: SR sugars 0, carbs are dextrins; value is an estimate.
- Carried from r92 as EST: bitter-equivalents, vermouth/fruit-juice acids, fish-sauce and stock nucleotides, rich-syrup, the Penniston gap for lemon/lime (R3 6.0 kept vs 4.9/4.7 measured).
