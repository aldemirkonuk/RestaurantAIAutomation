# Judge: house bottle/glass price, "dynamic", and margin advice

Judged: `price-code.md` (the only researcher report on this question).
Code read: `wt-r5-E` (r5/E), `wt-r5-cellar` (r5/cellar), plus read-only git
object queries (`git --no-optional-locks log/diff/grep/show`, no status,
checkout, fetch or commit). No `.env` read, no database query, no write in any
worktree. The engine was run from copies in this scratchpad (`q921/pa/`).

## 0. Has the code changed since the researchers looked?

- `origin/main` is no longer 79dfea023. The reflog shows two fast-forwards:
  `b8e8ff8a8` (#349, nightly E2E) and `0c1422c8d` (#408, Jev). A diff-stat of
  `79dfea023..0c1422c8` touches no pricing, menu, inventory or analytics
  file, so the report's picture of main still holds.
- `menu_price_bottle` is **not on main**. `git grep` at `0c1422c8` finds no
  match. It lives only on `r5/cellar`: committed in `56c1cabe3` as
  `20260919160000_a_house_sets_its_own_bottle_price.sql`, then renamed in the
  working tree (not committed) to `20260921112300_...`. The report called
  this lane work uncommitted. That is half right: the column is committed, and
  only the renumbering is uncommitted.
- One small error in the report: `AddToInventoryFromLibraryModal.tsx` sets only
  `menuPriceGlass` (`:129,288,365,439,1044`), not a bottle price. The cellar
  lane's own notes agree (`wt-r5-cellar/.planning/06-pages/wines.md`, the
  "Not done this pass" list).

**Answer to "must have been already built":** some of it exists and some does
not.

| Piece | State |
|---|---|
| Recommendations endpoint `GET /analytics/recommendations/:restaurantId` (`analytics.controller.ts:915`) | Live |
| Price engine `analyzePricing` (`analytics/engine/pricing-agility.ts:256`) and tables `menu_price_versions` / `pricing_analyses` (`20260805123951_pricing_agility.sql`) | Built, called by nothing |
| Inventory PATCH accepts `menuPriceGlass` (`inventory.service.ts:1439-1440`), tenant-scoped (`:1446-1447` cellar) | Live, but no page calls it for an existing wine |
| Menu update writes the house price | Not built |
| Manager edits the price of an existing wine | Not built |
| Target margin per house | Not built: no column and no setting, on main or in the cellar lane |
| Advice to raise or lower toward a target margin | Not built |

## 1. Adversarial pass: trying to break the leading answer

The report's leading answer is: "`analyzePricing` is exactly the mechanism the
founder describes. Wire it to an endpoint, persist to `pricing_analyses`, and
decide which column." Four of the claims behind it do not hold up.

**K1. `analyzePricing` does not aim for the founder's margin. It maximises
profit and uses his margin only as a floor.**
- With no price history it assumes elasticity −1.3 (`pricing-agility.ts:109`).
  No source is given for that figure.
- Every house has no usable history today. `menu_price_versions` holds only
  `backfill` rows, and the engine excludes those (`:121-131`).
- At −1.3 the Lerner optimum is cost × 4.33 (`finance.ts:387-394`), a 76.9%
  margin. The house's own target acts only as a floor (`:329-336`).

I compiled and ran the real files (cost $20, target 65%, so the target-margin
price is $57.14):

| Current price (margin) | Engine says | Founder's rule says |
|---|---|---|
| $60 (66.7%) | **raise to $69** | hold, or trim to $57.14 |
| $50 (60.0%) | raise to $57.50 | raise to $57.14 |
| $100 (80.0%) | lower to $86.67 (toward 76.9%) | lower to $57.14 |

Wired as-is, it would tell a manager to raise a wine that already meets his
target, based on a demand figure nobody measured. The piece that does fit is
`priceForMargin` (`:241-249`, cost ÷ (1 − target)) plus the margin-health flag.

**K2. The cellar lane added a second bottle-price column. The first one already
exists.**
Every reader in the backend treats `menu_price_current` as the house's bottle
price:
- analytics: `analytics.service.ts:157`, `advanced-analytics.service.ts:89`
- POS consumption: `pos-hub.service.ts:625,646,1023`
- SimPOS seed: `simpos.service.ts:41`
- markup job: `score_tasks.py:357-364`
- the pricing migration's own backfill copies it into `bottle_price`
  (`20260805123951_pricing_agility.sql:162-175`)

`menu_price_bottle` (cellar lane) is a second copy of the same meaning. If
edits and advice go to one column while margins read the other, the advice is
computed on a stale price. `r5/cellar` has not merged, so this is cheap to
settle now.

**K3. The one live price recommendation never sees a wine priced in the app.**
- `menu_price_current` has no writer anywhere. I checked `apps/`, `services/`,
  `supabase/migrations` and `scripts` at `0c1422c8`.
- Menu engineering keeps only rows with `unitPrice > 0`
  (`advanced-analytics.service.ts:194`).
- So every wine a manager adds through the app (which sets the glass price or
  the new bottle column) is left out of menu engineering and out of
  `plowhorse_repricing`.
- That rule is also fixed at 5–8% and only ever says "raise"
  (`recommendations.service.ts:226-235`).

**K4. There is no target to aim at.**
- Nothing stores a house's target margin. The 0.65 appears only in spec
  fixtures.
- `restaurant_inventory.margin_percentage` exists in the baseline (`:3282`),
  but no app code reads or writes it.
- Inventing a default would break the house rule that an unknown number stays
  null (ADR 0020, cited at `simpos.service.ts:30-38`). The advice has to say
  "set your target" until the owner sets one.

**K5. Cost may be missing for most wines.**
- The advice needs cost. `resolveUnitCost` returns null when there is no
  invoiced WAC and no `last_purchase_price`.
- A code comment says this was the case for "~70 of 72 production rows"
  (`advanced-analytics.service.ts:84-86`). The comment is undated and I did not
  check the database.
- If that still holds, the advice stays silent on most wines until invoices
  flow. It must show why it is silent, not report a healthy margin.

**K6. The path from the menu to the price is missing, and the route it would
use has a tenant hole.**
- `menu_items` holds the menu's `by_glass_price` / `bottle_price`. The cellar
  lane's `/menu` page shows them (`MenuNext.tsx:210-211`).
- None of those prices reach `restaurant_inventory`:
  - `addToInventory` drops the price (main `menus.service.ts:536-564`).
  - `reviewMenuItem` syncs only the name (main `:218`).
- `PATCH /menus/items/:id` has no tenant check. The route has no
  `:restaurantId` (main `menus.controller.ts:54-58`), and the service loads
  `menu_items` by id alone (cellar `menus.service.ts:241-245`).
- If this route starts writing the house's selling price, a caller from
  another house who knows the item id could change it. This is pre-existing on
  main and must be fixed in the same build.

**K7. A re-scan is not a menu replacement.**
- `importMenu` reuses the one active menu and appends lines
  (`menus.service.ts:88-97,508-536` cellar).
- If a re-scan of an older printed menu is synced with "last write wins", it
  would overwrite a price the manager typed later.
- The schema already provides the rule: `menu_price_versions.change_source` is
  `'import'` for a menu/POS sync and `'manual'` for a typed price
  (`20260805123951_pricing_agility.sql:44-49`). Each change closes the open row
  and opens a new one, so the newest dated change wins and both stay on the
  record.

**K8. The "Market" column exists, but may be empty.**
- It is in the inventory table (`InventoryCommandPage.tsx:1150`, reading
  `retail_price_avg`).
- The cellar lane notes `retail_price_avg` is "null on every row today"
  (`useCellarNextData.ts:220`). That is a code comment, not a query I ran.
- The same table has no column for the house's own price.

**What survives:**
- The endpoint exists.
- The rule-engine pattern (`rule(key, fired, make)`) is the right place for the
  advice: it comes with act, dismiss and snooze, goals, and the existing
  `/recommendations` page.
- The price-history table already has the two sources the founder named.
- The target-margin formula already exists as `priceForMargin`.

## 2. The founder's words settle the fork the cellar lane left open

The cellar migration explicitly left "dynamic" open: cost-plus, track the
market, or manual. His answer:

- the price follows the **menu**;
- the **manager** can change it any time;
- the software **advises**, and does not set, a raise or cut toward a
  **target margin**;
- the **market** figure is not used.

So: manual plus menu sync for the price, target margin for the advice, never
auto-applied, and no market figure. This should be recorded as an ADR; take the
number from the guard.

## 3. Options

1. **Advise to your target margin (recommended).** One bottle price, updated
   whenever the menu changes or a manager types a new one, every change on the
   record. You set a target margin, and each wine gets "raise to $X" or "lower
   to $Y" (cost ÷ (1 − target)); nothing changes until a manager accepts.
   Cost: about one build round, with one small migration and around ten files.
2. **Flag only, no price.** Same price plumbing and target, but advice only
   says "this wine is below/above your margin" with no number. Cost: about 20%
   less work, and the manager does the arithmetic himself.
3. **Switch on the built engine.** Wire `analyzePricing` as it is. Cheapest
   backend work, but with no sales history it assumes a demand figure nobody
   measured and pushes wines toward about 77% margin, so it would tell you to
   raise a wine already at your target.

## 4. Why, in 20 seconds

You set the margin you need. For each wine, the system takes what it cost you
and what it sells for, and says "raise to $X" or "lower to $Y" to hit that
margin. It never changes a price on its own and never uses the market average,
which stays in its own column. The price it reads updates when the menu changes
or when your manager types a new one, and every change is logged. The "smart"
engine already in the code was built for a different job, maximising profit
from guessed demand. It would tell you to raise wines that are already where
you want them.

## 5. What gets built if he takes option 1

1. **One bottle-price column.** Keep `menu_price_current`, which every margin,
   valuation and POS path already reads. Show it on the wire as the house
   bottle price, and drop the cellar lane's `menu_price_bottle` migration and
   fields before `r5/cellar` merges. This is a technical fork the owning lane
   should confirm with an ADR. The alternative is to keep `menu_price_bottle`
   and repoint the roughly eight readers in K2.
2. **Manager edit, any time.** Add a "Your price" column (bottle and glass) with
   an inline edit on `/inventory`, next to "Market"
   (`InventoryCommandPage.tsx`). Stop `useUpdateInventoryItem` from silently
   stripping price fields (`useInventoryQueries.ts:113-135`). Add a
   bottle-price field to the inventory DTO/PATCH.
3. **Price history on every change.** In `inventory.service.ts`
   `updateInventoryItem`, close the open `menu_price_versions` row and open a
   new one with `change_source='manual'` and `changed_by` taken from the JWT.
4. **Menu changes update the house price.**
   - In `menus.service.ts` `addToInventory`, carry the scanned glass/bottle
     price into the insert.
   - In `reviewMenuItem`, a price correction writes the linked inventory row.
   - Adding a line on `/menu` does the same.
   - All of these are recorded as `change_source='import'`, and the newest
     dated change wins (K7).
   - Before any of this, fix the tenant check on `PATCH /menus/items/:id`
     (K6).
5. **Target margin setting.** A per-house target for bottles and one for
   glasses, plus a "close enough" band. No default: until the owner sets it,
   the advice reads "no target set". Migration and a section in the Settings
   page.
6. **The advice rule.** Add `margin_to_target` in `recommendations.service.ts`,
   using `priceForMargin` from `pricing-agility.ts` (the margin-health half
   only). Per wine, it compares the current margin with the target and gives
   an exact raise or lower price.
   - Glass cost is bottle cost × pour ml ÷ bottle ml.
   - A wine with no cost or no price is named as "cannot advise: no cost/price",
     never counted as healthy.
   - It never reads `retail_price_avg` or `price_reference`.
   - Accepting the advice writes the price with
     `change_source='agent_accepted'`.
   - Each run is optionally persisted to `pricing_analyses`, with the target in
     `margin_floor_pct` and `elasticity_method` null.
7. **A per-wine advice read.** Either a "margin" facet on the existing
   endpoint or a small `GET /analytics/pricing/:restaurantId`, so the inventory
   page can show an "Advice" cell beside "Your price".
8. **Tests.** Cover the three worked cases in K1 (they must give $57.14, not
   $69 / $57.50 / $86.67), no target, no cost, the tenant refusal on the menu
   PATCH, and the version rows.
9. **Records.** An ADR for §2 and §5.1. A CLAIMS row: `analyzePricing` has no
   non-spec caller until someone decides otherwise.

## 6. What I could not verify

- The actual production state: how many rows have a cost, a
  `menu_price_current`, or a `retail_price_avg`. I ran no database query, so
  K5 and K8 rest on code comments.
- Whether the POS menu (Toast/Square) should also count as "the menu". I read
  "menu" as Mudavym's scanned/managed wine list (`menu_items`). No code pulls
  POS menu prices today; only observed sale prices are read
  (`pos-mapping-review.service.ts:418-436`).
- Uncommitted work in lanes other than E and cellar. I only grepped
  `wt-r5-recs`, `wt-pg-recs`, `wt-r5-vprices` and the sketch lanes for pricing
  terms. None calls `analyzePricing` or writes the price tables, but I did not
  read them in full.
- The build size in §3 is an estimate, not a measurement.

## Sources (web)

- BevSpot, drink price = ingredient cost ÷ target pour cost; 22% named for wine:
  https://bevspot.com/blog/bar-management-pricing-drinks-pour-costs/
- Backbar, set an ideal pour cost and get a suggested menu price:
  https://www.getbackbar.com/free-pour-cost-calculator
- MarginEdge, price = total cost ÷ target cost %, reprice as costs move:
  https://www.marginedge.com/blog/restaurant-plate-and-menu-costing-101

All three price to a target cost percentage, which is the same thing as a
target margin. None prices from a demand elasticity. That supports option 1 as
standard practice. They are vendor blogs, not studies.
