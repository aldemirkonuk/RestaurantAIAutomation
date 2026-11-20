# R3 - Deriving taste profiles without tasting everything

Researcher R3, 2026-11-19. Scope: how a dish or cocktail profile is computed from recipe lines, where
ingredient-level inputs come from (with licences), how a staff note becomes schema, how confidence and
provenance are shown, and where the Flavor Lab liking work plugs in. Numbers in the worked examples are
produced by `R3-reference.py` (same folder, runs with `python3 -I`); every constant is a starting value to be
fitted against house measurements and staff ratings, not a literature fact (see section 8).

Principle: the profile is *descriptive and guest-independent*. Liking is a separate layer (section 7).

## 1. Output schema (what every item gets)

Per item (dish, cocktail, drink, or a component of a dish), per axis:
`{ value 0-10, lo, hi, conf 0-1, prov: [{kind, share}] }`

- Basic taste axes: `sweet, sour, salty, bitter, umami`.
- Trigeminal and texture axes: `fat` (richness), `burn` (ethanol/chili heat), `astringency`, `body`, `carbonation`.
- Aroma families (own word list, informed by published wheels; words are not copyrightable, wheel artwork is): `fruit, citrus, floral, herbal, spice, nutty, roasted, smoky, savoury, earthy, dairy, woody, funky`, plus `aroma_intensity`.
- Derived: `balance = sweet_p / sour_p`, `brix_acid_ratio`, `contrast = peak - mean` (dishes).
- Provenance kinds: `measured` (house refractometer, pH/titration, hydrometer ABV, lab IBU), `recipe` (computed from quantities),
  `dataset` (ingredient value from an open dataset), `class_default` (category prior), `staff_note`, `guest_aggregate` (later).

## 2. Ingredient layer: what one ingredient row stores

Per 100 g or 100 mL, as pooled *chemistry*, not as a taste score (taste is computed after mixing, because
sweet/sour/salt are concentration phenomena and the mix changes the concentration):

| field | meaning | typical source |
|---|---|---|
| `water_g, density` | for dilution and volume-to-mass | USDA FDC |
| `se` | sucrose-equivalent sugar g (glucose 0.75, fructose 1.4, lactose 0.2, maltose 0.4 x grams) | FDC sugars by type, house Brix |
| `ce` | citric-equivalent acid g (malic ~0.9, tartaric ~1.1, lactic ~0.6, acetic ~0.5; values to fit) | FooDB (eval), literature, house titration (TA) |
| `nacl` | Na mg x 2.54 / 1000 plus added salt | FDC, label (Open Food Facts) |
| `fat` | g fat | FDC |
| `glu, nuc` | free glutamate and 5'-nucleotide (IMP/GMP) g | literature tables, FooDB (eval), class default (FDC only gives *total* glutamic acid, mostly protein-bound; it cannot be used directly) |
| `be` | bitter equivalents in IBU-eq (hops, tannin, caffeine, quinine, bitters) | house/lab IBU, literature, staff |
| `abv` | % ethanol | label |
| `aroma[f]` | descriptor strength 0-1 per family | FlavorDB (eval), staff panel, LLM from description (flagged) |
| per field: `value, sd, prov` | every field carries its own provenance and uncertainty | |

Rule: a field with no value falls back to the ingredient's class prior with `prov=class_default` and a wide `sd`.
Never leave it blank, never imply it was measured.

## 3. Algorithm (pseudo-code)

```
function profile(recipe):                     # recipe = lines, each (ingredient, qty, unit, prep)
  comps = group lines into components         # dish: protein / sauce / garnish ; cocktail: one component
  for comp in comps:
    lines = [resolve(l) for l in comp.lines]  # qty -> grams via density; each field -> (value, sd, prov)
    for l in lines: l = apply_method(l, l.prep)          # step 1: cooking modifiers, per ingredient
    dil = dilution(comp.method)                          # step 2: cocktail water or sauce reduction
    pool = mass_weighted_sum(lines) / (total_mass*(1+dil))   # step 3: pooled concentrations
    T = taste_from_chemistry(pool, solid=comp.is_solid)  # step 4: psychophysics
    T = mixture_interactions(T)                          # step 5: suppression
    A = aroma_pnorm(lines, p=2)                          # step 6: aroma, sub-additive
    comp.profile = T + A + methodDelta(lines)            # roasted/smoky/bitter from cooking
  item = combine(comps)                                  # step 7: bite-weighted + peak
  item = uncertainty(item)                               # step 8: Monte Carlo over sd
  item = fuse(item, measured, staff_notes)               # step 9: precision-weighted fusion
  return item
```

**Step 1, cooking-method modifiers** (per ingredient, before pooling). Each method has
`yield y` (mass after / before), `browning B in 0..1`, `fat_uptake`, and aroma deltas:

| method | y | B | effects |
|---|---|---|---|
| raw / cold | 1 | 0 | none |
| boil, poach, steam | 0.9-1.0 | 0 | leach salt/sugar into water, aroma x0.7 |
| saute, sear, pan-fry | 0.7-0.85 | 0.5-0.8 | solutes /y; `roasted += 10*B*k_matrix`; umami +10-20% x B for protein+reducing sugar |
| roast, bake | 0.6-0.8 | 0.4-0.9 | as above, plus `nutty`, onion/carrot `sweet` x1.2 (caramel) |
| grill, char | 0.7-0.85 | 0.8-1.0 | `smoky += 6*B`, `bitter += 2*B^2` (char is nonlinear, only the high-B tail is bitter) |
| deep-fry | 0.85-0.95 | 0.5-0.8 | `fat += uptake` (5-15 g/100 g), roasted, crisp (texture only) |
| braise, stew | 0.7-0.9 | 0.2 | gelatin `body`, `umami` extraction x1.15 |
| reduce | 0.3-0.6 | 0 | all non-volatile solutes /y |
| pickle, ferment, cure | 1 | 0 | `ce += brine acid`, `funky`, `salty` from brine |

B comes from a method class plus doneness label (rare/medium/well, blond/golden/dark), not from a thermometer;
Maillard intensity is also limited by reducing sugar x amino acid availability, so `B_eff = B * min(1, reactants/ref)`.

**Step 2, dilution.** Cocktail: `V_final = V0*(1+d)`; d by method (stirred ~0.20-0.25, shaken ~0.25-0.30,
built on ice 0.10-0.40 rising with time, blended higher; fitted from house refractometer before/after
measurements, until then these are a prior with sd 0.05). Concentrations scale by `1/(1+d)`, ABV likewise.
Dishes: sauce reduction handled by `y` in step 1.

**Step 3, pool.** `pool.x = sum(m_i * x_i) / M` for each chemistry field x (mass-weighted; liquids use density).
Glutamate and nucleotides are pooled separately and combined *after* pooling, because their interaction is nonlinear.

**Step 4, chemistry to perceived intensity** (saturating, Stevens-like; k are fit constants):
```
sweet  = 10*(1-exp(-se/12))               # se g per 100 mL; 10 g/100 mL ~ 5.7
sour   = 10*(1-exp(-ce_g_per_L/8))        # citric-eq g/L
salty  = 10*(1-exp(-r*nacl_pct/0.9))      # r = 1 liquids, 0.8 solids/fatty matrix (release)
bitter = 10*(1-exp(-be/25))               # IBU-eq
fat    = 10*(1-exp(-fat_g/12))
burn   = 10*clip((abv-8)/32, 0, 1)
EUC    = glu + 1218*glu*nuc               # g MSG-eq/100 g (Yamaguchi synergy)
umami  = 10*(1-exp(-EUC/0.5))
```
Measured inputs beat computed ones: if house Brix (refractometer, corrected for ethanol), TA, ABV or IBU exist for the
finished item or an intermediate (syrup, shrub, sauce), they replace the pooled value for that field, `prov=measured`.

**Step 5, interactions** (mutual suppression; fit from staff ratings):
`sweet_p = sweet*(1-0.03*sour)`, `sour_p = sour*(1-0.035*sweet)`, `bitter_p = bitter*(1-0.04*sweet)*(1-0.03*salty)`.
`balance = sweet_p/sour_p`; also report the classic Brix:TA ratio.

**Step 6, aroma.** Odour mixtures are sub-additive. `dose_i = 1-exp(-m_i/ref_i)`; for family f:
`A_f = ( sum_i (aroma_i[f]*dose_i)^p )^(1/p)`, `p=2`, then x10. Volatile loss in heat: x0.7 for boil, x0.5 for long braise,
partly replaced by Maillard aroma (step 1).

**Step 7, combine components.** Beverages are homogeneous: one component. Dishes are eaten in different bites:
`w_k = mass_k^0.7`; `mean = sum(w_k x_k)/sum(w)`; `peak = (sum(w_k x_k^3)/sum(w))^(1/3)`.
Show *peak* as the headline (a salty garnish is what the diner tastes) and `contrast = peak-mean` as a feature.

**Step 8, uncertainty.** Draw each field from `N(value, sd)` (200 draws, cheap), rerun steps 2-7,
`lo/hi` = 5th/95th percentile. `conf` per axis:
`conf = sum_i(infl_i * q(prov_i)) / sum_i(infl_i)`, with `infl_i` = ingredient i's share of that axis value and
`q`: measured 1.0, label/analytical 0.9, dataset 0.7, staff_note 0.6, class_default 0.3. Then times quantity-completeness
(1 - share of mass with unknown quantity, e.g. "salt to taste").

**Step 9, fusion with staff and measured data.** Precision weighting per axis:
`mu = (mu_c/s_c^2 + mu_s/s_s^2) / (1/s_c^2 + 1/s_s^2)`, `s = (1/s_c^2 + 1/s_s^2)^-0.5`. A measured value has
`s ~ 0.3` and dominates. If `|mu_c - mu_s| > 2.5` flag `recipe_vs_note_conflict` for review: in practice this finds wrong
quantities, a missing line, or an item that changed without the recipe changing. Several staff notes: median first, then fuse.

## 4. Worked example A - cocktail (Whiskey Sour, shaken, no egg white)

Recipe: 60 mL bourbon (45% ABV), 22.5 mL lemon juice, 15 mL 1:1 syrup. Inputs: lemon 6.0 g citric/100 mL (sd 0.8),
lemon sugar 2.5 g (sd 0.4), syrup 61.5 g sucrose/100 mL, bourbon bitter-eq 10 IBU-eq (class default), dilution 0.25 (range 0.18-0.32).

- V0 = 97.5 mL, V_final = 121.9 mL. Pooled: sugar 8.03 g/100 mL, citric 11.1 g/L, ABV 22.2%.
- Raw: sweet 4.87, sour 7.49 -> after interaction **sweet 3.8, sour 6.2**; burn 4.4; bitter 1.4; balance 0.61 ("tart-leaning"; Brix:TA about 7.2).
- Aroma (single source per family so p-norm is trivial): oak/woody ~6.6, vanilla/caramel ~3.9, citrus ~4.0.
- 2000-draw Monte Carlo (lemon acid, lemon sugar, syrup, dilution): sour 6.2 [5.3, 6.8]; sweet 3.8 [3.6, 4.0]; burn 4.4 [4.1, 4.8].
  Lemon acidity and dilution drive nearly all the width, so the system asks for **one** measurement: house TA on the juice batch.
- Axis confidence: sweet 0.85 (syrup house-measured), sour 0.7 (acid from dataset, qty exact), bitter 0.3 (class default).
- Staff note: "bright, tart, a little sweet, big oaky finish, bit boozy". Extraction: sour 7 (s 1.2), sweet 3 (s 1.2), woody 7, burn 5.
  Fusion on sour: (6.2/0.36 + 7/1.44)/(1/0.36 + 1/1.44) = **6.36**, s = 0.54, provenance "recipe 80% / staff note 20%".
  No conflict (|6.2-7| < 2.5).

## 5. Worked example B - dish (pan-seared lamb kofta, garlic yogurt, charred tomato)

Components: kofta 150 g raw (20% fat, 1.2 g added salt + inherent sodium = 0.98 g NaCl/100 g raw, free glutamate 0.012 g and
nucleotide 0.03 g /100 g raw - class default, FDC only gives total glutamate), seared y=0.75, B=0.7; yogurt 60 g (lactic 0.9 g x 0.6,
lactose x 0.2, fat 3.3 g); tomato 50 g (sugar 2.6 g, acid 0.4 g, free glutamate 0.15 g), charred y=0.7, B=0.8.

| component | sweet | sour | salty | bitter | umami | fat | roasted | smoky |
|---|---|---|---|---|---|---|---|---|
| kofta | 0.0 | 0.0 | 6.9 | 0.0 | 8.0 | 8.9 | 6.3 | 0 |
| garlic yogurt | 0.6 | 4.8 | 1.7 | 0.0 | 0.1 | 2.4 | 0 | 0 |
| charred tomato | 2.3 | 4.6 | 0.1 | 0.5 | 3.5 | 0.0 | 4.0 | 4.8 |
| **dish mean (w = mass^0.7)** | 0.7 | 2.3 | 3.9 | 0.1 | 4.8 | 5.1 | 4.1 | 1.1 |
| **dish peak** | 1.4 | 3.7 | 5.5 | 0.3 | 6.4 | 7.1 | 5.2 | 3.0 |

Reading: a savoury, rich, salty dish with sour relief in the sauce and tomato (contrast 1.4) and a smoky note that exists only in
the garnish (mean 1.1, peak 3.0). Honest weak points the system must show: umami `conf` ~0.35 (class-default nucleotides, no
measurement), bitter = 0 for the kofta because char on meat is not modelled (tail case: add `B^2` char term when "well done" or
"blackened"), salt depends on "salt to taste" if the recipe lacks grams (conf capped at 0.5). Salt is the single most valuable field
to capture in recipe entry (grams), then sear doneness.

## 6. Staff tasting note (free text) to schema

Pipeline (closed-form task, Haiku tier per the model routing memory; no human in the loop except a review queue):
1. **Input** item id, note text, taster role, date. Store the raw note verbatim, never overwrite it.
2. **Constrained extraction** to JSON schema: `[{axis, level, direction?, ref_item?, evidence_span, hedge}]` plus `other_terms[]`
   for words outside the lexicon. Closed lexicon of axes/families (section 1), with a synonym map (tart, bright -> sour; jammy -> fruit+sweet;
   boozy -> burn; toasty -> roasted; grippy -> astringency).
3. **Ordinal to number**: none 0, hint 1.5, light 3, medium 5, pronounced 7, dominant 9; negation ("not too sweet") lowers one step
   and widens sd; relative claims ("sweeter than the Negroni") become `value(ref) +/- 1.5` using the referent's profile.
4. **Guards**: `evidence_span` must be a substring of the note (rejects invented content); a second pass verifies each axis
   against its span; 3 samples at low temperature, disagreement raises `sd` (self-consistency as confidence).
   `sd` = 1.0 for plain ordinal, 1.5 hedged ("kind of", "maybe"), 2.0 relative.
5. **Fusion** per section 3 step 9; conflicts go to a review list, not silently averaged.
6. **Evaluation**: golden set of ~100 notes with staff-labelled axes (stratified by drinks/dishes); gate on span validity 100%,
   axis agreement within 1.5 points for >=85%. Notes are cheap training data for fitting the section-3 constants.

## 7. Showing confidence and provenance

- One badge per axis (not per item): solid bar = `measured`, bar with tick = `recipe + dataset`, hatched = `class_default`,
  speech-bubble mark = includes `staff_note`. Tap opens: contributing sources, shares, interval `[lo, hi]`, last updated, who tasted.
- Item-level summary is "profile confidence" = the lowest-confidence axis among the top two axes (a profile is only as trustworthy as what it leads with).
- Interval whiskers on the axis bar; below conf 0.4 the value is shown as a band ("medium-high") not a number.
- Never render a number without a provenance mark; never render a `class_default` as a plain value.
- Next best action is shown beside the weakest axis: "measure TA of this lemon batch", "add salt grams".

## 8. Datasets and licences

Checked this session by web search (secondary sources, **not legal advice**; re-verify the licence text before shipping anything):

| dataset | what it gives | licence found | commercial use | status |
|---|---|---|---|---|
| FlavorDB / FlavorDB2 (IIIT-Delhi Cosylab) | ~900+ natural ingredients mapped to flavour molecules and descriptors | site says CC BY-NC-SA 3.0; one paper record says CC BY-NC-ND 4.0; Kaggle copy says Apache 2.0 (not the authors' terms, ignore) | **No** without written permission | **EVAL-ONLY** |
| FooDB (foodb.ca) | compounds per food, concentrations, taste/flavour tags | free to the public; commercial use or redistribution needs explicit permission of the authors | **No** without permission | **EVAL-ONLY** |
| USDA FoodData Central | sugars, fat, sodium, protein, total amino acids, some organic acids | U.S. public domain (CC0-like) | Yes | **USE** (main source for sugar/fat/sodium proxies; free glutamate and acids are missing) |
| Open Food Facts | label nutrition for packaged goods (sugars, salt, fat), ingredient lists | database ODbL, contents DbCL, images CC BY-SA | Yes, with attribution; share-alike applies to a publicly used *derived database* | **USE** with caution: keep OFF-derived columns in a separable table, do not publish a merged ingredient DB |
| FlavorGraph (lamypark) | food-chemical graph embeddings, pairing | code Apache-2.0; paper CC BY 4.0; data inherits upstream (FlavorDB, recipes) | code yes; data unclear | **EVAL-ONLY** for the embeddings until upstream terms are confirmed |
| Flavor Lab liking-study corpora (13 public sets) | tasted liking data | per-dataset cards in `data/MANIFEST.json`; four sets already flagged evaluation-only (FINDINGS section 10) | per card | **EVAL-ONLY** unless card says otherwise |
| House measurements (refractometer, TA, ABV, IBU, scale) | the highest-quality inputs | ours | Yes | **USE** and prefer |
| Published psychophysics constants (Stevens exponents, EUC synergy, sourness factors) | facts and equations | facts are not copyrightable; cite the papers | Yes | **USE** as priors, fit locally |
| Published sensory wheels/lexicons (wine aroma wheel, beer flavor wheel, coffee lexicon) | descriptor vocabularies | **not checked this pass**; artwork is typically copyrighted, words are not | words yes | use our own word list; do not reproduce wheel graphics until checked |
| FoodOn ontology, LanguaL, CIQUAL (ANSES) | ingredient identity and composition | **not checked this pass** (believed open: FoodOn CC BY, CIQUAL Etalab open licence) | verify first | verify before use |

Rule: eval-only sets may be used to *check* our computed profiles (rank correlation of descriptors, sanity of acid/sugar ranges)
and to pick priors by hand, but no row from them is copied into the product database. Commercial licence enquiries to the FlavorDB and
FooDB owners are a cheap parallel track (founder's call; recorded as an option, not requested).

Fill order for ingredient fields: house-measured > FDC/label > literature table cited per row > class default > (staff-estimated, flagged).
Coverage target before launch: the 150 ingredients that make up ~90% of recipe mass in a house, found by ranking recipe-line mass (not menu count).

## 9. Plugging in the Flavor Lab liking work later

What the study (FINDINGS.md, summary sections 2, 7, 10, 13) licenses us to build: the crowd favourite is the base everywhere; personal
prediction adds lift only on lists where guests split, via one stated-preference question or a guest's own first tastings; item features
are a stand-in for new items with no scores; a "reason" form ("this has X, you respond to X") only survived for acidity in apples.
So the integration is staged and gated:

```
liking(guest, item):
  if item.n_scores >= N_crowd:        base = shrunk_mean(item)                         # stage 1
  else:                               base = category_mean + beta . profile(item).value  # cold start from our taste vector
                                      # regression weights x profile.conf (errors-in-variables: low-conf axes count less)
  if list.split_check_passed and guest has answer/tastings:                             # stages 3-4, per list, held-out gate
       delta = guest_slope[axis] * (profile.value[axis] - list_mean[axis])  for validated axes only
  return {score, interval, basis: crowd|features|personal, n, reasons: top axes}
```
- Contract: Flavor Lab consumes `value, conf` per axis as feature columns and returns `liking_estimate`. It never writes back to the profile.
- The taste vector replaces the ad-hoc item features used in the study; the study's split check decides, per list, whether a personal term is shown at all.
- Reasons come only from axes that passed the trait test for that list; otherwise show the crowd basis honestly ("popular with guests", n).
- Open measurement (study section 11): run the one-question test on our own lists (wine by style, beer lager-to-stout, cocktails sweet-to-bitter);
  our taste vector makes those splits observable per item.

## 10. Risks and limits (stated plainly)

- All constants in section 3 are priors that I set, not fitted: they produce sensible orderings, not calibrated absolute values.
  First fit target: 40 items rated blind by 3 staff on the 0-10 axes; check rank correlation per axis (acceptance: Spearman >= 0.7 for sweet/sour/salty/fat; aroma axes lower).
- Texture (crisp, creamy), temperature and serving context are mostly outside this model; `body`/`fat` are crude proxies.
- Mixed dishes assume components are eaten together in mass-ish proportion; "build-a-bite" dishes (tapas, mezze) should be profiled per component only.
- Free glutamate, nucleotides and organic acids have the thinnest open data; expect `class_default` for umami and acid until house measurement or a licensed table.
- I did not read FlavorDB/FooDB licence texts directly; findings are from search summaries. Reference code: `R3-reference.py` (not in the repo).
