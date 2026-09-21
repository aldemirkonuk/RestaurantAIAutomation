# 0193 — A house's price follows its menu and its manager, and advice aims at its own margin

- **Status:** Locked on the founder's pick, 2026-09-21 ("Advise to target margin"). Seven implementation forks recorded below for his confirmation (F1-F6 from the build, F7 from the last-call review).
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** pricing, bottle price, glass price, menu_price_current, menu_price_versions, target margin, price advice, recommendations, menu import, tenant scope
- **Links:** [[0020-no-fabricated-answers]] (an unknown stays null), [[0051-rebuilt-pages-show-live-data-only]], [[0067-a-failed-read-is-never-an-empty-one]], ADR 0160 §110 (the cellar lane; not on this branch), `supabase/migrations/20260805123951_pricing_agility.sql`, `supabase/migrations/20260921113100_a_house_names_its_target_margin.sql`, `supabase/migrations/20260921113200_a_house_price_change_is_on_the_record.sql`, `supabase/migrations/20260921113300_an_accepted_price_advice_names_its_target.sql`, `apps/api-gateway/src/pricing/`

## Context

On 2026-09-19 the founder asked for a per-house bottle price that is "dynamic". The
cellar lane added a manual column for it (`menu_price_bottle`, migration
`20260921112300`, never merged) and returned "what does dynamic mean" as an open
question. His answer, 2026-09-21, verbatim:

> "check if the code has changed before touching those areas, must have been already
> built. Dynamic means two things 1. it could be changed every time a menu is updated
> and secondly it should be changed whenever the manager wants and also ...
> recommendations ... make sure that endpoint exists that we will ask or recommend or
> advise the manager or owner to increase decrease the prices so that the profit margin
> is where it's needed. We don't want market average because that will be already shown
> in another column"

After research he picked **"Advise to target margin"**.

What the code held when this was decided (measured on `origin/main` @ `0c1422c8` and on
`r5/cellar`; no pricing file changed between the research and the build):

| Piece | State before this ADR |
|---|---|
| `GET /analytics/recommendations/:restaurantId` (`analytics.controller.ts:915`) | Live. Its one price rule, `plowhorse_repricing`, is a flat "raise 5-8%" (`recommendations.service.ts:226-235`), never "lower", no target |
| `analyzePricing` (`analytics/engine/pricing-agility.ts:256`) and tables `menu_price_versions` / `pricing_analyses` (`20260805123951_pricing_agility.sql`) | Built, tested, **called by nothing**; the tables had only the one `backfill` insert |
| The house's bottle price | `menu_price_current` (baseline `:3319`), read by every margin, valuation and POS path (analytics, advanced analytics, dashboard valuation, pos-hub consumption, simpos, `score_tasks.py`, and the pricing migration's own backfill) and **written by nothing** in `apps/`, `services/`, `scripts/` |
| The lane's `menu_price_bottle` | A second column for the same meaning, written only by the add-wine flows |
| Menu update → house price | Not built: `addToInventory` inserted a priceless row and never touched an existing one; `reviewMenuItem` synced only the name |
| Manager edits an existing wine's price | Backend PATCH accepted it; no page offered it, and `useUpdateInventoryItem` dropped the fields (`useInventoryQueries.ts:113-135`) |
| `PATCH /menus/items/:id` | **No tenant check**: no `:restaurantId` in the route and the service loaded the line by id alone (`menus.controller.ts:54-58`, `menus.service.ts:241-245` at `r5/cellar`) |
| A house's target margin | Nothing held one; `restaurant_inventory.margin_percentage` (baseline `:3282`) has no reader or writer, and the 0.65 in the engine's spec is a fixture |

The research judge's adversarial pass ran the real engine: with no price history (every
house today) `analyzePricing` assumes elasticity -1.3 (`pricing-agility.ts:109`) and aims
at cost x 4.33, a 76.9% margin, using the house's target only as a floor. For cost 20
and a 65% target it says **raise 60 to 69**, **raise 50 to 57.50**, **lower 100 to
86.67**; the founder's rule says 57.14 each time. It would tell a manager to raise a wine
already at his target, from a demand figure nobody measured.

## Options considered

1. **Advise to your target margin (picked).** One bottle price, updated when the menu
   changes or a manager types one, every change on the record. The house sets a target;
   each wine gets "raise to X" / "lower to Y" = cost / (1 - target); nothing changes until
   a manager accepts.
2. **Flag only, no price.** Same plumbing and target; the advice says "below/above your
   margin" with no number. About 20% less work; the manager does the arithmetic.
3. **Switch on the built engine.** Wire `analyzePricing` as it is. Cheapest backend work,
   but it maximises profit from a guessed elasticity and would contradict the founder's
   target on day one (the 60 -> 69 case above).
4. *(Doing nothing: the price stays unwritable, the menu keeps dropping prices, and the
   only live price advice is a flat "raise 5-8%" that never says lower.)*

And the one technical fork the lane's own work raised: **which column is the bottle
price.** (a) Keep `menu_price_current`, the column every reader already uses, and drop
the lane's second column before merge; or (b) keep `menu_price_bottle` and repoint about
eight readers. (a) was taken: nothing had merged, and two columns meaning one thing is
how advice gets computed on a stale price.

## Decision

**A house's own bottle price (`menu_price_current`) and glass price (`menu_price_glass`)
follow its menu and its manager, every change is on the record, and the product advises
-- never sets -- a raise or cut toward the house's own target margin, never from the
market average.**

What that is, concretely:

1. **One bottle-price column.** `menu_price_current` is the house bottle price and reaches
   the wire as `menuPriceBottle`. The lane's migration `20260921112300` is deleted before
   merge and every reader repointed (gateway mapper, create and bulk-create inserts, the
   web normaliser). `20260921113200` fails if a `menu_price_bottle` column exists.
2. **Every change is on the record.** An `AFTER INSERT OR UPDATE OF menu_price_current,
   menu_price_glass` trigger closes the open `menu_price_versions` row and opens a new one
   in the same transaction, so no writer can move a price without a row.
   `set_house_menu_price()` is the one gateway writer: house-scoped (it locks the item
   `WHERE id = ... AND restaurant_id = ...`, P0002 otherwise), refuses a change naming
   nobody, skips a no-op, and hands the trigger `change_source` and `changed_by` (from the
   JWT). `menu_price_versions.changed_by` gains its FK to `public.users(user_id)`.
3. **The newest dated change wins.** A change dated before the price now in effect is
   refused as `stale` and applied nowhere; the menu line keeps its own price in
   `menu_items`, the later price keeps its version row.
4. **The menu updates the price** (`change_source = 'import'`, by the person on the
   token): a menu scan or CSV import, a line added on `/menu`, and a price correction on a
   menu line all write the linked wine's price -- an imported or added line dated by its
   own `created_at`, a correction dated when it is made. Each line reports `priceSync`
   (`changed` / `unchanged` / `stale` / `no_price` / `not_linked` / `failed` with the
   reason), and `/menu`'s add form says back `changed`, `stale` and `failed` (last call,
   2026-09-21: the page had been dropping it, so a failed price write read as success).
   The onboarding review screen still does not show it, and no web page sends a price
   correction through `PATCH /menus/items/:id` today (its fields are name, producer,
   vintage, region, grape).
5. **The manager changes it any time**: "Your price" (bottle and glass) beside "Market" on
   `/inventory`, edited in place, `change_source = 'manual'`.
6. **Fixed first: `PATCH /menus/items/:id` is house-scoped** -- the house from the JWT, the
   line read and written with `restaurant_id` = that house, a foreign id a 404, a session
   with no house a 403.
7. **The house's target margin**: `restaurants.target_margin_bottle_pct`,
   `target_margin_glass_pct`, `target_margin_band_pts` ("close enough"),
   `target_margin_set_by`, `target_margin_set_at`. No default, no backfill (asserted by the
   migration); a Settings register, "Target margin"; audited as `target_margin_changed`.
   Until it is set, every wine reads "no target set".
8. **The advice**: per wine and per kind, `price = cost / (1 - target)` via
   `priceForMargin`; cost from `resolveUnitCost` (invoiced lot WAC, then last purchase
   price, else unknown); glass cost = bottle cost x pour ml / bottle ml. States:
   `raise`, `lower`, `on_target`, `no_target`, `no_cost`, `no_price` -- an unknown is
   named, never counted as healthy. `GET /pricing/advice` serves it per wine.
9. **Applied only when a manager accepts it**, one tap on the wine's row:
   `POST /pricing/advice/:inventoryId/accept` re-computes the advice, refuses (409) if it
   is not what the page showed, writes one `pricing_analyses` row (target in
   `margin_floor_pct`, `elasticity_method` NULL, `price_kind`, `band_pts`, engine
   `margin-to-target/1`) and the price as `change_source = 'agent_accepted'` pointing at
   it (`menu_price_versions.pricing_analysis_id`, now FK'd).
10. **Wired into the live recommendations endpoint**: `margin_to_target` (the wines off
    target, furthest first, with the numbers attached as `priceAdvice`),
    `margin_target_unset` (no target set, the house has priced wines), and
    `margin_advice_blind` (wines with no recorded cost). A failed advice read is reported
    as `priceAdviceReadable: false` with the reason, never as every price on target.
11. **`analyzePricing` stays unwired** until the founder decides otherwise (CLAIMS row).

### Forks decided in the build -- for the founder to confirm

These were needed to build and are not in his words. Each is the narrowest reading of
what he said; each is a small change if he says otherwise.

- **F1. Who may change a price, set the target, or accept advice: owners and managers.**
  Read from "whenever the manager wants" and "advise the manager or owner". Staff see the
  price and the advice, with no controls, and the gateway refuses them (403). This is new
  on the inventory PATCH's price fields, which any house member could send before.
- **F2. A menu correction re-prices the house for whoever may correct the menu** (any
  member of the house, as before). The menu is the price's source ("changed every time a
  menu is updated"), so its editors are not re-gated here.
- **F3. "Close enough" is in margin POINTS, required with a target, 0 to 20, no default**
  (0 = advise on any difference). Targets are 5 to 95 percent; the bounds are a units
  check (0.65, the fraction spelling, is refused).
- **F4. A menu has no printed date, so a line is dated when it was scanned or added.** A
  re-scan of an OLD printed menu therefore wins over a price a manager typed before the
  re-scan. It is on the record and one tap reverts it, but a printed-menu date would be
  the real fix.
- **F5. A menu line with no price leaves the house's price alone.** A scan that missed the
  glass column is not a decision to take the glass price off.
- **F6. A wine added through the inventory create paths records its first price with
  `changed_by` NULL** and a reason saying no actor was named: those paths receive no actor
  today. The row is still written; the gap is visible, not hidden.
- **F7. Glass advice uses the sizes on the row, and those sizes carry database defaults.**
  Glass cost = bottle cost x pour ml / bottle ml, reading `restaurant_inventory.pour_size_ml`
  then `restaurants.default_pour_ml`, and `restaurant_inventory.bottle_size_ml` then
  `master_wine_library.bottle_size_ml`. All four columns have a DEFAULT (150 ml pour, 750 ml
  bottle; baseline `20260805000000`), and the library's 750 was measured on all 4,226 rows
  as the default, not a stated format (`20260905140000`). So a pour nobody typed is priced
  as 150 ml. The code adds no default of its own (a NULL size gives "no cost"), but it
  cannot tell a typed size from a defaulted one. Found in the last-call review, 2026-09-21.

Also: advice sentences carry no currency symbol (the house's currency is the page's to
print); the `/inventory` page prints `$` like the rest of that page does today.

## Rejected alternatives

- **The market average as a target or an input.** The founder, verbatim: "We don't want
  market average because that will be already shown in another column." A CLAIMS row
  fails the build if a non-spec file in `apps/api-gateway/src/pricing` names the
  library's market columns.
- **`analyzePricing` as the advice.** See Context: it answers a different question (profit
  maximisation from an assumed demand curve) and contradicts the house's own target.
- **Applying advice automatically.** Never: he asked to "ask or recommend or advise".
- **A default target (e.g. 65%) or a default band.** A default is a number nobody chose
  underneath every "raise to"; [[0020-no-fabricated-answers]] and the carrying-cost precedent
  (`20260906140000`) refuse it.
- **Keeping `menu_price_bottle`.** Two columns for one meaning; every margin reader would
  have kept reading the other one.
- **Last write wins for menu imports.** The schema already names the sources
  (`change_source`) and dates the rows; "newest dated wins" costs one comparison.

## Consequences

- Easier: every margin, valuation and POS figure now reads a price a manager or the menu
  actually set, and every change says who, when and from where.
- Easier: price advice has an owner (the house's target) and an audit trail
  (`pricing_analyses` + the version row).
- Harder: most wines may get "no cost recorded" until invoices flow. A code comment says
  ~70 of 72 production rows had no measured cost (`advanced-analytics.service.ts:84-86`,
  undated; not re-measured here). The feed says so (`margin_advice_blind`) rather than
  staying quiet.
- Given up: the lane's manual-only column and its round-5 tests for it (rewritten against
  `menu_price_current`).
- Revisit when: a printed-menu date exists (F4); a house asks for per-wine targets (the
  unused `restaurant_inventory.margin_percentage`); real price history accumulates in
  `menu_price_versions` and the founder wants demand-aware advice (then `analyzePricing`,
  by a new ADR); a POS menu (Toast/Square) should count as "the menu" (not read today).

## Verification

- PGlite build of all 194 migrations in the worktree + 30 behavioural assertions on the
  three migrations (`p4-scratch/pglite-probe/cellar-price-adr0193/prove.mjs`), all pass.
- 26 code/SQL mutations of the gates, each caught by its test and restored byte-for-byte
  (`mutate.py`); 17 mutations of the six CLAIMS rows, each caught (`mutate_claims.py`).
- Jest and Vitest suites listed in the lane's build report; `gw_tsc`, `gw_tsc_spec`,
  `web_tsc` clean.
- Not verified: the page in a browser against a running gateway, and production row
  counts (how many wines have a cost or a price). No database was queried.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Founder | Picked "Advise to target margin" (verbatim answer above) |
| 2026-09-21 | Cellar lane (build) | Built; forks F1-F6 recorded for confirmation |
| 2026-09-21 | Last-call review | `/menu` add form now says back what a line did to the house price (it had dropped `priceSync`); F7 (glass advice rests on defaulted pour/bottle sizes) added; Decision 4 wording corrected (a correction is dated when made) |
