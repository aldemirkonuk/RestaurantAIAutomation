# DESIGN - every good and every dish has its details and a taste profile

Design lead, 2026-11-19. Inputs: R1-CODE-STATE.md, R2-SOTA.md, R3-DERIVE.md, plus a read of the
#1912 tip (SHA 63fe7cc14, head `feat/g2-inventory-quantities-carry-their-unit`) and origin/main.
File:line cites below are at that SHA unless marked `main:`; lines move, builders re-grep.
Nothing was built, run or queried in production. The constants in R3 are priors, not fits.

## 0. Verdict in six lines

1. The wine-only export has three causes (columns, row data, gateway join). The founder's header
   list ("Wine", "Bottle size (ml)", "Last counted") matches no builder on main (legacy says "Wine" without
   "ml"; Next says "Title" and has "ml" and "Last counted"). The Next page is on for every house since
   2026-10-31 (App.tsx:385), so the file is a stale deploy or a hand edit. Fix target: the Next page.
2. The count sheet and every goods export become kind-aware: a `Kind` column, a `Unit` column, a vendor
   column, and detail columns that appear only when some exported row has a value for them.
3. Taste becomes ONE layered schema for every subject (good, cocktail, dish): stored layers per source,
   fused on read. Unknown is a missing key, never 0. Every value carries provenance and confidence.
4. Taste is filled in a fixed order: staff entry first (works on day one), read-through of structured
   data we already own, recipe roll-up (cocktails before dishes), house measurements, note extraction,
   and last guest liking.
5. The UI is a Taste card beside the nutrition card on a good's drawer (this round), then on the dish and
   cocktail sheets and as a summary column in exports (later slices, because they sit on other PR stacks).
6. This round is three draft PRs: A (exports, stacked on #1912), B (taste schema + gateway + roll-up),
   C (web taste card, stacked on #1912). B has no dependency on A or C; C degrades in words without B.

## 1. The target

Every row the house keeps has the details its kind needs, and a taste description where taste applies.

| Kind (ledger `kind`) | Details the sheet and export carry | Taste |
|---|---|---|
| wine | producer, vintage, type (style), bottle size, grape, region, by-glass / bottle price | native (wine_structure read-through) + house + recipe n/a |
| spirit, liqueur, whiskey, sake, cider, beer, non_alcoholic, soft_drink | brand/producer, expression, ABV, size, type | house; native body/acidity from `beverages` later |
| cocktail (house-made drink) | recipe link, glass, garnish, price | recipe roll-up + house |
| food (produce, dry, dairy, protein, prep) | unit, vendor, pack, allergens (later), nutrition (later) | house; recipe roll-up for prep items |
| supply | unit, vendor, pack | none (no card, no column) |
| dish (not counted, costed) | price, plate cost, allergens, nutrition (later) | recipe roll-up + house + staff note |
| coffee, tea | origin, roast or type, lot | house with the same axes |

Rules every surface follows (they already hold in the nutrition card and are reused):
- a value nobody stated reads "not known", never 0 and never a default (wineData.ts:222-223 is the
  counter-example: `body || "medium"` invents a value; it is removed in slice S3);
- no number without its provenance mark; a `class_default` is never shown as a plain value;
- a failed read says so in words and shows nothing as known;
- a mixed house's file has a Kind column; no row shows a heading that is wrong for it. Drink-only headings
  appear only when an exported row has a drink value for them, so a food row is never under "Wine" or
  "Vintage" unless the file also holds drinks. In that mixed file the food row's drink cells are blank
  and the Kind column says why.

## 2. Unified taste-profile schema

### 2.1 Axes (closed vocabulary, our own word list)
Numeric, 0-10, all optional. Basic: sweet, sour, salty, bitter, umami. Trigeminal and texture: fat (richness),
burn (ethanol or chili heat), astringency, body, carbonation. Aroma: aroma_intensity plus 13 family strengths
fruit, citrus, floral, herbal, spice, nutty, roasted, smoky, savoury, earthy, dairy, woody, funky.
Word list is ours (published wheels' words are free to use, their artwork is not; SCA wheel is CC BY-NC-ND,
nothing of it is copied). Derived on read, never stored: balance (sweet over sour), contrast (peak minus mean).
Texture words (crisp, creamy, chewy, flaky...) and CATA descriptors are controlled-list text tags, not axes.
Facts (ABV, IBU, SRM, pH, Brix) are never sensory scores; they stay in `ext.facts` or the nutrition table.

### 2.2 Per-axis value (R3 section 1 shape, adopted)
```
axes[axis] = { v: 0..10, lo?: 0..10, hi?: 0..10, sd?: >0, conf: 0..1, prov: [{kind, share}] }
prov.kind in: measured | recipe | dataset | class_default | staff_note | staff_line | standard | ai_draft
```
An axis not present is unknown. `prov` shares sum to 1 (+-0.01). Confidence per source class (priors, fitted later):
measured 1.0, label/analytical 0.9, standard 0.7, dataset 0.7, recipe 0.7 x quantity completeness, staff_line 0.6,
staff_note 0.6, ai_draft 0.35, class_default 0.3.

### 2.3 DB shape (lane B, one migration, past 20271202100000)
```
taste_profiles (append-only; a correction is a new version, nothing is updated or deleted)
  id uuid pk, restaurant_id uuid not null -> restaurants,
  subject_kind text check in ('good','cocktail','dish'),
  good_id uuid -> restaurant_inventory (cascade), cocktail_id uuid -> cocktails (cascade),
  dish_id uuid  (no FK yet: `dishes` is in open #1222; FK is added by the stack that carries it),
  num_nonnull(good_id,cocktail_id,dish_id) = 1 and equals subject_kind,
  source text check in ('house','recipe','measured','standard','dataset','note','ai_draft'),
  version int not null, unique (restaurant, subject, source, version)   -- via an expression index
  method text check in ('line','cata','ordinal','panel','instrument','computed'),
  axes jsonb not null default '{}'  check jsonb_typeof = 'object',
  descriptors text[], texture text[], summary text,
  note_text text           -- the raw staff note, verbatim, never overwritten
  ext jsonb not null default '{}'  -- native vocabularies (WSET steps, BJCP style, coffee family), facts
  stated_by uuid -> users(user_id), stated_by_name varchar(200), created_at timestamptz
taste_profile_current (view): the highest version per (restaurant, subject, source)
RLS: enabled; service_role policy; REVOKE from anon/authenticated (the gateway scopes by JWT restaurant),
same as auction_lot_records (main: 20261116100400:100-120).
```
The effective profile is NOT stored. It is computed on read by the pure `fuse(layers)` (precision weighting,
R3 step 9): per axis `mu = sum(v_i/sd_i^2)/sum(1/sd_i^2)`, `sd = (sum 1/sd_i^2)^-0.5`; default `sd` by source:
measured 0.3, standard 1.5, dataset 1.8, recipe from its own interval (else 1.2), staff_line 1.2, staff_note 1.0
(1.5 hedged, 2.0 relative), ai_draft 2.5. Layers that disagree by more than 2.5 on an axis raise
`conflict` (listed, never averaged away). Storing inputs and computing outputs means refitting a constant
needs no data migration.

Deferred tables (not this round): `ingredient_chemistry` (R3 section 2: sucrose-eq sugar, citric-eq acid,
NaCl, fat, free glutamate and nucleotides, bitter-eq, ABV, aroma strengths, each with value/sd/prov),
`taste_liking` (guest hedonic 1-9, separate, never averaged into a profile).

## 3. How profiles are filled, and in what order

| # | Fill path | Layer `source` | Why this order |
|---|---|---|---|
| 1 | Staff entry: pick descriptor chips (CATA), set a 5-step level per axis, optional note | house | Needs no data, no recipe, works for a food, a spirit, a coffee today; ships in lane C |
| 2 | Read-through of what we own: `master_wine_library.wine_structure` + `sensory_profile` (wine), `beverages.body/acidity/serving_temp` (spirit, beer, sake) | standard | Real structured data already in main; mapped by a pure adapter, unknown stays unknown (S3) |
| 3 | Recipe roll-up (R3 pipeline): cocktails first (one homogeneous component, dilution measurable), then dishes by component with bite-weighted mean and peak | recipe | Needs ingredient chemistry (S3: USDA FDC + Open Food Facts, public/open; class priors flagged) and a recipe stack |
| 4 | House measurement of intermediates (Brix, titratable acid, ABV, IBU) | measured | Highest quality input; replaces computed fields, prov = measured |
| 5 | Staff note extraction (closed lexicon, evidence spans, 3 samples, review queue) | note | Closed-form task, Haiku tier; needs layers 1 and 3 to exist so conflicts are meaningful |
| 6 | Guest aggregate + Flavor Lab liking | liking (own table) | Needs a guest-rating write path that does not exist (R1 G11) |

The roll-up pipeline is R3's: cooking modifiers, dilution, mass-weighted pooling, saturating intensity curves,
sweet/sour/bitter suppression, sub-additive aroma, bite-weighted dish mean and peak, interval by seeded
sampling, then fusion. Lane B ships it as a pure function over caller-supplied ingredient chemistry.

## 4. The UI

1. A good's drawer: a Taste card in a slot directly after the nutrition slot (ItemDrawer.tsx:292 region),
   shown for every kind except `supply` (the same rule that hides the nutrition card, ItemDrawer.tsx:114).
   Top line: a one-sentence summary built only from axes with conf >= 0.4. Then one row per known axis:
   label, 0-10 bar with a whisker for [lo, hi], a band word ("light", "medium", "pronounced") and a provenance
   mark (solid = measured, tick = recipe or dataset, hatched = class default, speech bubble = staff note or line).
   Tap a row: sources and shares, interval, last updated, who tasted, and the one next action
   ("add salt in grams to the recipe", "measure this batch's acid"). Below conf 0.4 the value shows as a band only.
   Footer: "Stated by Name, date, N sources". Empty state in words: "Nobody has described how this tastes yet."
2. Staff entry: "Describe the taste" opens a form: descriptor chips by category, a five-step level per axis
   (none, hint, light, medium, pronounced, dominant mapped to 0, 1.5, 3, 5, 7, 9), a note box. Nothing is
   prefilled; skipping an axis leaves it unknown. Saving appends a `house` layer attributed to the person.
3. Dish and cocktail sheets (slice S5): the same card component mounted on the recipe sheet beside its
   nutrition card, fed by the recipe layer; the sheet shows the dish mean and the peak.
4. Exports (slice S4): `Taste` (the one-line summary), `Taste confidence`, and per-axis columns behind a
   "Include taste detail" choice, read from a batch summaries endpoint (one request, no N+1).
5. Words, not codes: no raw enum or axis key reaches a screen; a failed or absent endpoint shows a sentence.

## 5. DECISIONS (every fork decided here; the founder is not asked)

Format: decision, why, rejected.

D1. Fix the Next page; do not touch the 1,916-line legacy page this round. Why: Next is on for every house
since 2026-10-31 (App.tsx:385); the founder's own columns include "Bottle size (ml)" and "Last counted", which only Next
has. Rejected: editing legacy `InventoryCommandPage.tsx:605` (flag-off houses only; a one-line header rename is queued as a
deferred item D-legacy). Open fact, not a decision: why the founder's file says "Wine"; recorded as unverified.

D2. Lane A stacks on #1912, not on the #1373 chain and not on an integration branch. Why: #1912's ancestry holds
#1792 (`forHouse`, `DRINK_ONLY_HEADERS`), #1888 and the nutrition card chain; #1373 is a separate 40-deep tree (R1
section 8) and a merge of two such trees is not reviewable. Lane A re-applies only the `Unit` column (cheap, `row.uom`
already exists at useInventoryNextData.ts:112/290) and cites #1373 for the kg/l conversion, which is NOT re-applied
(quantities stay in the ledger's base unit, the Unit column says which). Rejected: stacking on #1373 (loses #1792);
a new integration PR (violates the 15-file rule, breeds conflicts).

D3. Detail columns are data-driven, not house-type-driven. A detail column (Producer, Vintage, Bottle size (ml),
Your bottle price, Your glass price, and the new Vendor) is kept iff at least one exported row has a value
for it. This generalises #1792's all-goods rule to a mixed house without a second code path (`forHouse` is
re-expressed in terms of it, so its tests still hold). Rejected: a fixed schema with blanks (the bug), separate
files per kind (founder wants one sheet), a boolean "goods house" (cannot express a mixed house).

D4. Kind comes from the ledger `kind` (restaurant_inventory.kind, already on the wire through `...result`,
inventory.service.ts:~126), falling back to the library kind (`InvRow.kind`, :96); labels are words ("Food",
"Supply", "Spirit", "Beer", "Wine"). Rejected: inferring kind from the name (guessing), adding a gateway field
(not needed; the raw column is already sent).

D5. Count sheet order: Location, then Kind, then name (stable). Valuation and selection keep list order.
Why: every competitor orders the sheet by storage area (R2 section 1) and a Kind grouping makes a mixed sheet walkable.
Rejected: shelf-order (needs a new field, deferred), keeping list order (interleaves wine and flour).

D6. Taste is stored as append-only layers per source and fused on read; `axes` is jsonb with a closed key list
enforced by a SQL check function and by the gateway validator. Kill attempts and outcome:
(a) "jsonb cannot be queried" - for "show sweet >= 6" a generated column or a GIN index is added when a filter exists;
no screen needs it now. (b) "compute on read is slow" - fusion is a few axes over at most ~7 layers per subject; the batch
endpoint does one query. (c) "a column per axis is simpler" - 24 axes x (v, lo, hi, conf, prov) is over 100 columns and
changes the table for each vocabulary tweak. Rejected: a column per axis (R2's draft); an EAV table (one row per axis;
queryable but every read joins and per-layer unity is lost); one stored fused row (stale after any refit);
overwriting in place (loses who said what).

D7. Subject keyed by three typed columns with FKs where the parent is on main (restaurant_inventory, cocktails);
`dish_id` carries no FK until the dishes stack lands. Rejected: a polymorphic `subject_id` with no FK anywhere
(orphan rows); making lane B wait for #1222 (violates "no lane depends on unmerged code").

D8. Vocabulary is R3's (11 numeric + 13 aroma strengths) with CATA tags and per-category `ext`; R2's draft schema
(13 columns, aroma_families[] only) is superseded. Native scales (WSET steps, BJCP stats) live in `ext` and are also
normalised to 0-10 `standard` layers so any two goods compare. Rejected: only native scales per category (no common
comparison, no pairing engine); only a common scale (loses the standard each trade recognises).

D9. Unknown is an absent key. The DB, gateway and web all refuse a 0 that nobody typed (the ordinal "none" is a
real, typed 0 with prov staff_line). Same rule as the nutrition card.

D10. Anyone on staff may add a `house` layer, attributed and append-only; there is no delete. A wrong layer is
outvoted by a later one or flagged `conflict`, not removed. Why: tasting is staff work; roles gate money, not
palates; a layer ledger needs no moderation. Rejected: manager-only entry (the cook who knows the dish cannot
describe it); free overwrite (no audit).

D11. The roll-up lives in the gateway as a pure TypeScript function (no I/O, no clock, no RNG except a seeded one).
Python reference `R3-reference.py` remains research. Rejected: the Python orchestrator (queue hop, latency, a second
runtime for a pure function); a SQL function (untestable, opaque).

D12. Interval by deterministic sampling: mulberry32 seeded from a hash of the inputs, 200 draws, so the same recipe
always shows the same interval (a tooltip that changes on refresh reads as a bug). Cut rule: if lane B exceeds its
diff budget, replace sampling with first-order propagation (first-order is exact enough for the saturating curves);
say so in the PR.

D13. Constants in the roll-up are labelled priors in one table (`PRIORS`), each with a comment saying it is a
starting value and the fit target (40 items, 3 staff blind, Spearman >= 0.7 on sweet/sour/salty/fat). No constant is
presented as a literature fact in the UI. Rejected: hiding them in formulas.

D14. Datasets: USDA FoodData Central (public domain) and Open Food Facts (ODbL; kept in a separable table) are the
only ingredient sources planned; FlavorDB, FooDB, FlavorGraph and the Flavor Lab corpora are evaluation-only
(R3 section 8; not legal advice, re-verify licence text before any load). No dataset row is loaded in this round.

D15. `ai_draft` is a permitted source but weighted 0.35, always marked, and never counted as measured or shown as
a plain value. No model call is made in this round.

D16. Liking is a separate table and layer, built after a guest rating path exists. The contract is fixed now: Flavor
Lab consumes `value, conf` per axis and returns `liking_estimate`; it never writes a profile.

D17. Allergens and nutrition columns in exports wait for slice S4, not this round. Why: the allergen/nutrition data
is on open PRs (#922 chain) that are NOT in #1912's ancestry for the gateway half; shipping a column that reads a
missing endpoint violates the rule that a lane works without unmerged code. Rejected: stacking lane A on #922 plus
#1912 (two bases).

D18. Lane C mounts on the good's drawer only. The dish sheet and cocktail sheet live in the recipe/dishes stacks
(#1829, #1915, #1141), which are not in #1912's ancestry. Rejected: a lane C on the dishes tip (a different base, so
it could not be reviewed with the goods card, and it would need B's data to exist).

D19. Migration version 20271203100000 (high-water over main and every open PR at 2026-11-19 is 20271202100000,
#1917). The builder re-runs the open-PR file listing and takes the next free version past every open PR at build
time (the memory rule: pick past everything on main and every open PR).

D20. Supplies carry no taste: no card, no export column value. Chemicals and smallwares are not tasted.

D21. The Flavor Lab branch is local-only and unpushed; none of its code is used. Only its shape lesson (named,
measured axes with an explicit unknown) is taken, which is already decision D9.

## 6. Slice plan

| Slice | Content | Stack on | Status |
|---|---|---|---|
| S1 (this round) | A: kind-aware exports; B: taste schema, gateway, roll-up; C: taste card (good drawer) | A, C on #1912; B on main | briefs below |
| S2 | Gateway list joins `beverages` (producer, brand, ABV, expression, age, cask) and drops the 750-ml default for non-bottled goods (inventory.service.ts:~87-90 and :148); web reads them; per-kind detail columns for spirits and beer | newest tip of the A or inventory chain after A merges | next round |
| S3 | `ingredient_chemistry` table + FDC/OFF seed script, class priors, recipe-layer writer for cocktails, wine/beverages read-through adapter, delete invented defaults (wineData.ts:222-223) | B, plus the cellar recipe chain tip for the writer | next round |
| S4 | Exports: Taste summary/confidence/axes, Allergens, Nutrition; batch summaries endpoint; export for dishes, cocktails, recipes, menu | A, B, #922 chain | next round |
| S5 | Taste card on dish and cocktail sheets, dish roll-up wiring with component groups | #1829/#1915 and #1141 tips, C | next round |
| S6 | Staff note extraction (Haiku, closed lexicon, spans, 3 samples, review list, golden set of 100 notes) | B | later |
| S7 | Measured capture (Brix, TA, ABV) and the constant fit (40 items, 3 staff blind) | S3 | later |
| S8 | Liking layer and Flavor Lab consumption | S1-S7, guest rating path | later |
| S9 | Partial counts (tenths, bottle and keg weight), storage-area walk order, vendor SKU, catch weight, expiry, legacy page header | inventory chain | later |

## 7. Lanes for this round

Common to all lanes (the orchestrator's hard rules apply and are not restated): one worktree per lane in
`~/Projects/p4-scratch/sw-walk/wt/<name>`; node_modules symlinks from wt/new-device-code; DRAFT PR, <=15 files,
<=30K diff (if over, split into a stacked second draft and say so); heavy commands through heavy.sh; commit before
mutation-testing; plain behaviour descriptions in the PR body; trailer and PR footer as ordered. Before building,
re-run `gh pr list --state open --limit 500` and confirm the stack base is still the tip (#1912 has no child today).

### Lane A - `kind-aware-exports` (stack on #1912)

Outcome: the count sheet, valuation, selection and "Export this row" files carry a Kind column, a Unit column
and a Vendor column for every row, drop a drink-only column only when no exported row has a value for it, and the
count sheet is ordered Location, Kind, name. A food row is never under a wine-only heading in a food-only file; a
mixed file carries every heading with food rows blank in the drink cells.

Files (all `apps/web/src/pages/inventory/next/` unless noted), about 8:
1. `useInventoryNextData.ts` - add `ledgerKind: string | null` to `InvRow` (:73) read from raw `r.kind` in `toRow` (:251-310,
   beside `uom` at :290); add `kindLabel(kind)` (words: Wine, Spirit, Beer, Sake, Cider, Liqueur, Cocktail, Non-alcoholic, Soft drink,
   Food, Supply, Other; unknown kind => 'Not recorded'); `goodKind(row)` = ledgerKind ?? library kind.
2. `iv-export.ts` - add `kindColumns` (Kind, Unit, Vendor), `dropEmptyDetail(rows, columns)` driven by `DRINK_ONLY_HEADERS` (:82) plus
   'Vendor'; re-express `forHouse` (:77) through it and keep its signature so existing callers and tests hold; add
   `unitWord(row)` (uom, else 'bottle' for a drink with no uom, else blank) and `sortCountSheet(rows, zoneName)`.
3. `InventoryNext.tsx` - `exportCountSheet` (:561-597): insert Kind after the name, Unit after Bottle size, Vendor before
   Observation, run `dropEmptyDetail` over `visible`, sort via `sortCountSheet`; valuation (:599) and selection (:996) use the same
   column set; no other change.
4. `RowDropdown.tsx:489` - "Export this row" uses the same shared column function (one row, so a detail column with a value stays).
5. `iv-export.test.ts` (new) and extend `InventoryNext.test.tsx` and `RowDropdown.test.tsx` with export cases. 3 test files.
6. `docs`: none required (no new top-level planning doc).

Behaviour spec:
- Kind column: `kindLabel(goodKind(row))`. Unit column: `unitWord(row)` from `row.uom` ('g','ml','each','bottle','case','keg','pack', ...);
  quantity columns remain the ledger's base units; the header is unchanged so spreadsheets keep working.
- Vendor: `row.providerName ?? ''`.
- `dropEmptyDetail`: for each header in DRINK_ONLY_HEADERS (+Vendor) drop the column iff every exported row's cell is '' or null.
- Count sheet order: zone name asc (no-zone last), then Kind label asc, then name asc (locale compare, numeric).
- Cost columns: `costColumnsFor` stays the last filter (staff never get WAC or Value at cost).
- Cells follow `tableExport.neutraliseFormula` already (`tableExport.ts:73`); nothing new is written raw.

Tests that prove it (write, commit, then mutation-test):
- food-only fixture: headers contain Good, Kind, Unit, Vendor and none of Producer, Vintage, Bottle size (ml), Your bottle price,
  Your glass price; Kind cells say Food or Supply.
- mixed fixture (1 wine, 1 spirit, 2 foods): all drink headings present; the food rows' Producer, Vintage, Bottle size cells are ''
  and Kind says Food; wine row Kind says Wine.
- wine-only fixture: Producer/Vintage kept; Kind says Wine; still no Wine-only wording on any food (none).
- a row with uom 'g' reports Unit 'g'; no uom and a drink reports 'bottle'; neither a drink nor uom reports ''.
- count sheet ordering and stability (equal keys keep input order).
- staff reader: no WAC, no Value at cost, still has Kind and Unit.
- `forHouse` regression: the #1792 test cases still pass untouched.
- Mutation set: (1) remove Kind column; (2) make `dropEmptyDetail` a no-op; (3) swap the comparator's Kind and name keys;
  (4) read `r.kind` as the library kind only; (5) drop the Unit fallback to 'bottle'. Each must fail at least one test.

Browser checks for a later walker (local stack, a house with a carried food in grams, a wine and a spirit):
1. `/inventory` with all three goods on screen: click Export, choose count sheet. Open the CSV. Header row has Location, Title (or Good if
   only goods), Kind, ..., Unit, Vendor. The food row says Food and Unit g; the wine row says Wine and Unit bottle.
2. Filter to the food only (Kind filter), export again: no Producer, Vintage, Bottle size (ml), Your bottle/glass price columns.
3. Open the food's row menu, "Export this row": the one-row file has Kind Food and Unit g.
4. Sign in as staff: the files have no WAC, Value, Value at cost columns, and still have Kind and Unit.
5. Confirm the toast text is the existing "Exported N rows" and the file name keeps `inventory-count-YYYY-MM-DD`.

stackOn: #1912 (head `feat/g2-inventory-quantities-carry-their-unit`). Names #1373 (Unit with kg/l conversion, not re-applied) and #1792 (kept).

### Lane B - `taste-profile-schema-gateway` (base main)

Outcome: the database can hold a layered taste profile for any good, cocktail or dish; the gateway reads the effective (fused) profile and
every layer, lets staff append a house layer, and exposes a pure, tested recipe roll-up; unknown stays unknown everywhere.

Files (about 13):
1. `supabase/migrations/20271203100000_every_good_and_dish_has_a_taste_profile.sql` (version re-checked at build): table, check
   constraints (one subject, closed source/method sets, axes is an object, a SQL function `taste_axes_valid(jsonb)` that keys are in the
   closed list and each `v` is 0..10, `conf` 0..1), expression unique index, view `taste_profile_current`, RLS + service_role policy + REVOKE,
   column comments. Additive; no existing table altered.
2. `apps/api-gateway/src/taste/taste-axes.ts` - AXES, AROMA_FAMILIES, PROV_KINDS, ORDINAL_MAP, DEFAULT_SD, CONFIDENCE_BY_PROV, `validateAxes()`,
   `bandWord(v)`.
3. `.../taste-fusion.ts` - `fuse(layers) => { axes, conflicts, sources }`, `tasteSummary(effective)` (axes with conf >= 0.4 only).
4. `.../taste-rollup.ts` - `rollup(input) => profile` (R3 steps 1-7: methods table with yield and browning, dilution, mass-weighted pooling,
   saturating curves, suppression, p-norm aroma, bite-weighted mean/peak, interval); `PRIORS` table; seeded sampler.
5. `.../taste.service.ts` - `read(restaurantId, kind, subjectId)`, `appendHouse(...)`, `preview(...)`; subject must belong to the restaurant
   (a foreign id is a 404 sentence, same pattern as `stock-wrappers-refuse-foreign-items.spec.ts`).
6. `.../taste.controller.ts` - JwtAuthGuard, `assertTenantMatch` as `beverages.controller.ts` does.
7. `.../taste.module.ts` and the one-line registration in `apps/api-gateway/src/app.module.ts` (:121 region).
8. `.../dto/taste.dto.ts`.
9. specs: `taste-axes.spec.ts`, `taste-fusion.spec.ts`, `taste-rollup.spec.ts`, `taste.service.spec.ts`.

The contract (lane C codes against this; it is fixed here so neither lane waits for the other):
```
GET  /taste/:restaurantId/:subjectKind/:subjectId           (subjectKind: good | cocktail | dish)
  200 { subject: {kind, id}, effective: null | { axes, descriptors, texture, summary, confidence, conflicts[] },
        layers: [{ source, version, method, statedByName, statedAt, hasNote, noteText|null }] }
  404 { message } only when the subject is not in this house
POST /taste/:restaurantId/:subjectKind/:subjectId/house
  body { axes?: { [axis]: { v, sd? } }, descriptors?: string[], texture?: string[], note?: string, method: 'line'|'cata'|'ordinal' }
  201 same body as GET (re-read). 400 with a sentence when an axis key, value or descriptor is outside the closed lists,
  when nothing at all is stated, or when v is not a number in 0..10.
POST /taste/:restaurantId/rollup/preview
  body { kind: 'cocktail'|'dish', method?, components: [{ name, lines: [{ name, qty, unit: 'g'|'ml', prep?, chemistry? }] }] }
  200 { axes, peak?, mean?, conflicts: [] }    (pure; reads no table, writes nothing)
```
Roll-up writes to the table are NOT in this lane (no recipe stack on main); the preview is pure so the cocktail writer in S3
can call the same function.

Tests that prove it:
- `taste-axes.spec.ts`: rejects unknown key, v < 0 or > 10, NaN, string numbers, conf outside 0..1; accepts a typed 0; absent key stays absent.
- `taste-fusion.spec.ts`: R3 example (recipe sour 6.2 sd 0.6 + staff 7 sd 1.2 => 6.36 within 0.05, sd about 0.54); measured sd 0.3 dominates; conflict
  at a gap > 2.5; a single layer returns itself unchanged; empty layers returns null (not zeros); summary uses only conf >= 0.4 axes.
- `taste-rollup.spec.ts`: whiskey-sour fixture reproduces R3 section 4 within tolerance (sweet 3.8 +-0.3, sour 6.2 +-0.3, burn 4.4 +-0.3); kofta
  fixture gives peak > mean on smoky; dilution scales concentrations by 1/(1+d); an ingredient with no chemistry yields `class_default` prov and
  confidence <= 0.3 and a wider interval; same inputs give the same interval twice; "salt to taste" (no quantity) caps confidence at 0.5;
  no negative, no NaN, all outputs clipped to 0..10; grams-in equals ml-in-by-density.
- `taste.service.spec.ts`: foreign subject refused; append increments version; a read of a subject with no layers returns `effective: null`; the raw
  note is stored verbatim; the stated_by comes from the JWT, not the body.
- Static check: tsc --noEmit -p tsconfig.json (jest does not typecheck; ignore TS2307 for @simplewebauthn/server). Migration check: apply the corpus through the repo's PGlite or local Postgres recipe and prove insert and select only: axes `{"sweet":{"v":4,"conf":0.6}}` is accepted; `{"sweet":{"v":11}}` is refused; two subject ids on one row are refused. Append-only is held by the gateway (no UPDATE or DELETE path exists) and says so in the table comment.
- Mutation set: (1) allow v = 11; (2) default a missing axis to 0 in fuse; (3) drop the dilution step; (4) remove the foreign-subject check;
  (5) take stated_by from the body; (6) fuse by plain mean. Each must fail a test.

Cut order if over budget: first drop sampling for first-order intervals (D12), then drop `preview` and keep fuse/read/append, and push roll-up to a
stacked draft PR on this one. Never drop validation or the tenant check.

No browser checks (no UI). A later walker with a curl-equivalent through the web: after lane C merges, the drawer check below exercises GET and POST.

stackOn: main.

### Lane C - `taste-card` (stack on #1912)

Outcome: a good's drawer shows a Taste card under the nutrition card for every kind except supply: a summary line, an axis row per known axis with
bar, whisker, band word and provenance mark, the layers' authors, and a form for staff to describe the taste. When the gateway has no taste route or fails,
the card says so in a sentence and shows nothing as known.

Files (about 9, all `apps/web/src/`):
1. `services/api/taste.ts` - typed client: `getTaste(kind, id, restaurantId)`, `addHouseTaste(...)`, types `TasteProfile`, `TasteLayer`, `TasteRead =
   { state: 'ready', data } | { state: 'absent' } | { state: 'failed', reason }`. A 404 with no JSON body or a 501/405 is `absent`; any other non-2xx or a
   network error is `failed`; a 404 whose JSON has `message` means "subject not in this house" => `failed`. Never throws to the caller. Parses defensively
   (a value outside 0..10, an unknown axis key or a missing `conf` is dropped, not shown).
2. `pages/inventory/next/taste-words.ts` - AXIS_LABEL, BAND (v to word), PROV_MARK (kind to glyph and word), SOURCE_WORDS, ORDINAL_STEPS (none, hint, light,
   medium, pronounced, dominant => 0, 1.5, 3, 5, 7, 9), DESCRIPTOR_GROUPS (controlled chips), `summaryLine(profile)`, `nextAction(axis, profile)`.
3. `pages/inventory/next/TasteCard.tsx` and `taste-card.css` - the card and its states (loading, ready, empty, absent, failed).
4. `pages/inventory/next/TasteForm.tsx` - chips, five-step level per axis, note box, Save; owners, managers and staff all see it.
5. `pages/inventory/next/ItemDrawer.tsx` - a `TasteCard?` slot prop like `NutritionCard` (:95), default the real card; mounted after `.ivd-nutrition`
   (:292) guarded by the same `hasContents` (:114).
6. tests: `services/api/taste.test.ts`, `taste-words.test.ts`, `TasteCard.test.tsx`, extend `ItemDrawer.test.tsx`.

Behaviour spec:
- Ready with `effective: null`: "Nobody has described how this tastes yet." and the Describe button.
- Ready with axes: summary line from axes with conf >= 0.4; rows sorted by value descending, only known axes; below conf 0.4 a row shows the band
  word only, no number; every row has its provenance mark; the whisker draws [lo, hi] when present; a `conflicts` entry shows "Sources disagree on sour".
- Absent: "Taste notes are not switched on for this house yet." (no button). Failed: "Taste could not be read just now." plus Try again; nothing shown as known.
- Form submit sends only the axes the person set; none set and no chips and no note => button disabled, hint in words. Server 400 sentence shown verbatim.
- All text via words, no enum keys on screen; the card is keyboard reachable; bars have text alternatives; respects reduced motion (a 150 ms bar fill only
  when motion is allowed).

Tests that prove it:
- client: 200 parse; 404 empty body => absent; 404 with `message` => failed; 500 => failed; thrown network error => failed; a value of 11 or an unknown axis
  is dropped; a `conf` below 0.4 is flagged `bandOnly`.
- words: ordinal map; band edges at 0.5/2/4/6/8 (document the edges in the test); no key leaks (every AXIS key has a label).
- card: renders each of the five states; never renders a number for a band-only axis; every rendered axis row carries a provenance mark (assert by
  testid); supply row renders no card; saving posts only set axes and re-reads.
- drawer: the slot renders after nutrition; supply renders neither.
- Mutation set: (1) render `v` for a low-conf axis; (2) treat 404 body as absent always; (3) drop provenance marks; (4) map "none" to missing instead of 0 (the
  typed 0 must be sent); (5) show the card for a supply. Each must fail a test.

Browser checks for a later walker (needs lane B live on the local gateway for 3-6; 1-2 work without it):
1. Local gateway WITHOUT lane B: `/inventory`, open a food good's drawer, scroll to the nutrition area: below it the Taste card says "Taste notes are not
   switched on for this house yet." No console error, no red toast.
2. Open a supply's drawer: no Taste card.
3. With lane B: open the food's drawer: "Nobody has described how this tastes yet." Click Describe the taste, tap chips "savoury" and "rich", set Salty to
   Medium, type a note, Save. The card now shows a summary line, a Salty row with a bar, the word "medium" and a speech-bubble mark, and the footer
   "Stated by <name>, <date>".
4. Reload: the card is unchanged. Open a wine good: still empty (no invented profile).
5. Add a second description with Salty = Dominant from a second account: the Salty row shows a wider whisker or a "sources disagree" line only if the gap
   exceeds 2.5; otherwise one fused value; the footer says 2 sources.
6. Narrow the window to a phone width (375): no horizontal scroll; the form is usable.

stackOn: #1912. Reads lane B's contract through the typed client, which degrades when the endpoint is absent.

## 8. Deferred (and why)

- Allergens, nutrition and taste columns in exports; dish, cocktail, recipe and menu exports (S4): need B plus the #922 gateway half, which is not in #1912's ancestry.
- Taste card on dish and cocktail sheets, dish roll-up wiring (S5): live on the recipe/dishes stacks.
- `ingredient_chemistry`, FDC and Open Food Facts seed, class priors, cocktail recipe-layer writer (S3).
- Wine and `beverages` read-through adapter; removal of invented wine defaults (wineData.ts:222-223) (S3).
- Gateway join of `beverages` into the inventory list; drop the 750-ml default for non-bottled rows (inventory.service.ts:~87-90 and :148) (S2). Until S2, a spirit
  or beer row exports Producer and Vintage only when library-matched; this lane A does not claim otherwise.
- kg/l conversion of exported quantities (#1373): not re-applied; Unit says the base unit.
- Staff note extraction, golden set and review list (S6); measured capture and constant fit (S7); guest liking and Flavor Lab (S8).
- Partial counts (tenths, bottle and keg weight), storage-area walk order beyond Location, vendor SKU, catch weight, expiry (S9).
- Legacy `InventoryCommandPage.tsx:605` header "Wine" (flag-off houses only): D-legacy, one-line rename queued with S9.
- Dish to POS draw (#1914 states it is missing) and `menu_items` being wine-shaped (R1 G10, G12): separate lanes owned by the POS and menu work.
- Low-stock view omits foods (R1 G14): separate fix on #934's line.

## 9. Not verified, shortcuts taken

- No code, test or query was run; every claim is static reading of #1912's tree and origin/main, plus the three research files.
- The founder's CSV was not seen; the header mismatch is unresolved (D1 records it as an unverified fact, not a decision).
- Open-PR facts come from the 2026-11-19 fetch in `.openprs.json`/`.openfiles.jsonl`; the builder re-checks the base tip and the migration high-water.
- R3 constants are priors; the roll-up gives orderings, not calibrated absolutes, and the UI says "estimated from the recipe".
- Licence statements (R3 section 8) came from search summaries and are not legal advice.
- Diff budgets were estimated, not measured: Lane B is the one at risk (cut order given). I did not deploy the Workflow fan-out CLAUDE.md section 3
  asks for on ADR-bound decisions; the three prior researcher passes plus the kill attempts in D6 are the substitute, and that is a shortcut.

## 10. KILL-PASS (adversarial review, 2026-11-19; checked against #1912 tip 63fe7cc14, origin/main c459b0a12, 1,246 open PRs)

Verdict: A survives with 5 fixes; C survives with 4 fixes; B survives only if cut in two and 4 contract bugs are fixed. Findings, each with evidence.

K1 (A, blocks the outcome). Dropping a detail column "iff no row has a value" cannot work for Bottle size (ml) as briefed. The gateway
defaults an unsized good to 750 (inventory.service.ts:87-90, :148) and toRow copies it (useInventoryNextData.ts:288), so a food-only
file keeps the column and every food says 750. Fix: the bottle-size cell is blank unless the good is a drink; for a drink it stays
`bottleSizeMl` (wine files unchanged); `bottleSizeRecordedMl` (:99-107) is the field to use when the kind is unknown.
K2 (A). Sorting by "zone name" is not the Location cell: the cell can read 'Unassigned' or `noZoneWord(stock)` (InventoryNext.tsx
:566-573). Sort on one shared `locationCell(row)` so the sort key is what the person sees.
K3 (A). `forHouse(words.one === 'good')` is a house-type rule: a house holding food AND wine drops Producer from the wines. Data-driven
columns change that on purpose. #1792's tests may pin the old behaviour; the builder updates only those cases, says why in the PR, and
deletes `forHouse` if no caller remains (no dead code).
K4 (A). D4's "kind is already on the wire" holds only by spread (`{...row}`, :125) of a select that must include `kind`; services/api/
inventory.ts:573-586 already reads `kind`, `uom` from a list row, so it holds, but the test fixture must be the real payload shape.
K5 (A, public repo). #1759 (open) commits the founder's real count file (docs/inventory-count-2026-10-01.csv). Fixtures here are
synthetic; nothing is copied from it. Flagged for the founder, not touched.
K6 (premise). The founder's 12-column header (Wine, Bottle size (ml), Last counted, no Days since/Velocity/WAC/Observation) matches no
builder at any commit: Next never said Wine (#677 says Title; legacy :571/:616 say Wine but lack (ml) and Last counted). Most likely a
hand-edited file. The code gap is real either way (no kind, no unit, wine-only headings); D1 stays "unverified".
K7 (B, contract bug). Layers keyed (subject, source, version) with `taste_profile_current` = highest version per source mean a second
staff member's house layer REPLACES the first. Lane C's check 5 ("second account ... footer says 2 sources") could not pass, and a cook's
note would silently overwrite a manager's. Fix: a house layer is identified by (source, stated_by); version counts per that; the view keeps
the latest per (subject, source, stated_by); fusion runs across those. Insert retries once on unique violation (two writers at once).
K8 (B/C, contract bug). Nest's default 404 for an unregistered route has a JSON body with `message` ("Cannot GET /taste/..."), so C's rule
"404 with a message => failed" shows 'could not be read' on every house without B and fails C's own check 1. Fix: B's subject-not-found
answer carries `code: 'subject_not_in_house'`; C treats 404 as absent unless the body has that code (405/501 absent; 5xx/network failed).
K9 (B, schema). `burn` "ethanol or chili heat" conflates two sensations: a vindaloo and a 60% spirit would fuse into one axis, and a
dish's heat has no honest home. Split into `heat` (chili, pepper, mustard, pungency) and `alcohol` (ethanol warmth). Spirit proof and
beer IBU stay facts in `ext.facts` (never a sensory score) and map to `alcohol` / `bitter` only through a labelled standard layer.
Vocabulary is now 12 numeric (sweet sour salty bitter umami fat heat alcohol astringency body carbonation aroma_intensity) + 13 aroma
(fruit citrus floral herbal spice nutty roasted smoky savoury earthy dairy woody funky). Not expressible, deferred: finish length,
cooling/tingle, serving temperature.
K10 (B, D6 contradiction). D6(c) rejects columns because "the table changes per vocabulary tweak", yet a closed key list inside the SQL
check function needs a migration per tweak. Fix: SQL enforces shape (object, key pattern ^[a-z_]{2,24}$, v in 0..10, conf in 0..1,
sd > 0); the closed list is owned once, by the gateway (`AXIS_KEYS`), and both lanes copy the list above verbatim.
K11 (B, false precision). Precision weighting shrinks sd with every layer, so two staff lines look like a measurement, and a conflicted
axis (gap > 2.5) would still get a tight pooled sd. Fix: on conflict the effective value is withheld from the summary and sd = max of the
layers; sd floor 0.3; confidence is defined, not implied: conf = min(best source prior, 1 - min(sd,3)/3) (sd 1.2 -> 0.6, matching the
staff prior). The card shows no numerals at all (band word, bar, whisker; integers nowhere), so 6.36 never reads as 6.36.
K12 (B, scope/size). The roll-up (R3 steps 1-7, PRIORS, seeded sampler, preview endpoint) has no caller this round (no chemistry table, no
recipe writer, no UI) and its constants are unfitted; it is roughly half of lane B's diff and the likeliest to breach 30K. Moved to lane D,
stacked on B, built only after B is green. Preview also gets input caps (<=12 components, <=60 lines, finite qty <= 1e6, 200 draws
fixed) and the tenant check, and its route is declared before the `:subjectKind/:subjectId` routes.
K13 (B). D20 (supplies carry no taste) was UI-only; the service must refuse a supply subject with a sentence, cap `note` (2,000 chars) and
descriptors (<=12, closed list), and store the note verbatim as text (the web renders it as text, never HTML).
K14 (C). The contract pinned only `axes`; C parses `{v, lo?, hi?, sd?, conf, prov:[{kind, share}]}`, `confidence`, `conflicts:[{axis, gap,
sources[]}]`. Pinned in the lane briefs now. C drops unknown keys, so a vocabulary mismatch hides data silently; both lanes carry the K9
list and C tests that its label table equals it.
K15 (C/walker). Checks 3-6 need B's route and migration; the walker builds a throwaway merge of B and C on the local stack, never prod.
K16 (process). `gh pr list --limit 500` sees 500 of 1,246 open PRs. Re-run with --limit 1000 plus `--search "sort:created-asc"` for the
rest. Done here: no open PR touches taste or the exports beyond #1792/#1744/#1373; migration high-water is 20271202100000 (main's own
latest is 20270302100000), so 20271203100000 stands, re-checked at build.
K17 (A, money). Export math is untouched: Value, WAC and Value at cost columns keep their formulas; Unit only labels the ledger base unit;
the sort reorders rows, not figures; staff filter (`costColumnsFor`) still runs last. A food at g with WAC per g is now readable, not changed.
Not killed: stacking A and C on #1912 (disjoint files), 15-file and 30K budgets for A and C (about 8 and 10 files), no secrets in briefs.
Shortcut recorded: static reading only; nothing was run, no PGlite proof, no Workflow fan-out.
