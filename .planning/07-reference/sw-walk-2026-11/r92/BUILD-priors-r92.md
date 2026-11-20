# BUILD r92 taste priors (2026-11-19)
PRs: #1963 (part 1, base #1959 branch, diff 29,770) and #1964 (part 2, base #1963, diff 25,700). Both DRAFT. Split because the whole was 42K.

## Built
- 79 classes (was 36). New `tight`/`not` fields; matcher `taste-class-match.ts` (fold, singular, synonyms, PREPARED words). Ambiguity rule: one match wins; several only if exactly one is `tight`; else unknown. Behaviour changes: bare "Vermouth", "Liqueur", "Lemon zest/syrup", "Tomato soup" are now unknown (were guessed); "Sugar syrup" -> simple syrup; tomato paste/canned have own classes.
- Gin, brandy, agave, anise spirits split from dark/clear; Aperol (11 %) split from Campari; red/white/sparkling/fortified wine, IPA, stout; cheeses, egg, pork, bacon, anchovy, garlic, carrot, bell pepper, greens, mushroom, potato, spice, nut, stock, sauces.
- Calibration: salty k 0.9 -> 1.4. Solid 1.2 % = 5.0 medium, 2 % = 6.9, 3 % = dominant; r87 kofta (3 g/248 g, grilled) = about 6.4 pronounced, below fat. Bitter k 25 kept: lager 20 IBU 5.5, IPA 50 IBU 8.6, gin 40 % diluted 3:1 with staff bitter 6 = 5.0 medium. Gimlet with the staff gin reads light-medium (about 3): gin is 47 % of the glass, so by concentration that is correct; left as is.
- Sources: taste-prior-sources.ts (part 2).

## Decisions (rationale / rejected)
- Salt k 1.4, not 1.2 or 0.9: 1.4 centres a normal 1.2 % on "medium" (noticeably salty). Rejected: lowering only the "mainly" word threshold (hides the curve, wrong for the other axes); a liquid/solid split (already 0.8 release).
- Bitter unchanged: linear dilution already gives medium at 3:1; rejected lowering k (would push beer to pronounced).
- Lemon/lime acid kept at R3 6.0 although Penniston 2008 measured 4.9/4.7 g/100 mL: changing moves R3's whiskey-sour anchor (6.2). House titration should replace it.
- Dropped to hold 80 classes: grenadine, amaretto, elderflower, apple juice, tomato juice, Worcestershire, miso, mozzarella, cucumber, scallion.

## Sources actually read (web)
Free glutamate: parmesan 1200, soy 412-1264 (782 typical), fish sauce 621-1383, tomato 140-246 mg/100 g (umami white paper citing Ninomiya/Yamaguchi). Campbell's tomato soup about 0.8 % NaCl (US patent 5,260,091). USDA FDC SR Legacy API read for: spirits, coffee liqueur, red/white wine, beer, dessert wine (ABV there is g/100 g, converted to vol %).

## NOT verified (honest gaps)
- USDA FDC API (DEMO_KEY, 10 calls/h) rate-limited after 9 lookups: dairy, meat, veg, sauce, juice, stock sodium/fat/sugar values are recalled SR Legacy numbers, not re-read.
- Anchovy glutamate 0.5 g from a commercial page, no primary source. Bitter-equivalents for liqueurs/bitters/wine tannin, vermouth acid, fish-sauce nucleotides, grenadine-like acids: EST.
- Pre-existing, not touched: poultry/fish rows (nuc 0.12/0.1) make the Yamaguchi synergy saturate umami to about 10 for plain chicken. Needs its own fix.
- "Mainly salty" wording lives in the web summary, not in this branch; not re-walked in a browser (told not to start the stack).
- Full gateway jest not run; only src/taste (126 passed) and tsc.
