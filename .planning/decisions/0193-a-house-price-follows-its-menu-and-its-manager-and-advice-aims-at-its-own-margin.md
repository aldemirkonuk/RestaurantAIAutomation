# 0193 — A house's price follows its menu and its manager, and advice aims at its own margin

- **Status:** Locked on the founder's pick, 2026-09-21 ("Advise to target margin"). Seven implementation forks recorded below for his confirmation (F1-F6 from the build, F7 from the last-call review). **[Answered 2026-09-21, round 2: his seven answers settle F1-F7 and add menu versions; built — see "Amendment, round 2" below.]**
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** pricing, bottle price, glass price, menu_price_current, menu_price_versions, target margin, price advice, recommendations, menu import, tenant scope
- **Links:** [[0020-no-fabricated-answers]] (an unknown stays null), [[0051-rebuilt-pages-show-live-data-only]], [[0067-a-failed-read-is-never-an-empty-one]], ADR 0160 §110 (the cellar lane; not on this branch), `supabase/migrations/20260805123951_pricing_agility.sql`, `supabase/migrations/20260921113100_a_house_names_its_target_margin.sql`, `supabase/migrations/20260921113200_a_house_price_change_is_on_the_record.sql`, `supabase/migrations/20260921113300_an_accepted_price_advice_names_its_target.sql`, `supabase/migrations/20260921115000_a_house_confirms_its_pour_before_glass_advice.sql`, `supabase/migrations/20260921115100_a_house_keeps_every_menu_it_reads.sql`, `apps/api-gateway/src/pricing/`, `apps/api-gateway/src/menus/`, [[0163-the-wine-library-is-a-ledger-of-cited-or-labelled-statements]] Q22 (on `r5/adr0163`)

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
  **[CONFIRMED 2026-09-21, answer 1; extended to a price named when a wine is added, and to
  menu price corrections — see F2.]**
- **F2. A menu correction re-prices the house for whoever may correct the menu** (any
  member of the house, as before). The menu is the price's source ("changed every time a
  menu is updated"), so its editors are not re-gated here. **[OVERRULED 2026-09-21, answer 1:
  menu price corrections are owner/manager only, audited. Built: a price field on
  `PATCH /menus/items/:id` is refused for anyone else before any write.]**
- **F3. "Close enough" is in margin POINTS, required with a target, 0 to 20, no default**
  (0 = advise on any difference). Targets are 5 to 95 percent; the bounds are a units
  check (0.65, the fraction spelling, is refused). **[CHANGED 2026-09-21, answer 2: close
  enough is a PERCENT OF THE ADVISED PRICE, required with the target, no default; his words,
  "percent is always shown everywhere". Built: `target_margin_band_pct` / `band_pct`, 0 to
  20 percent, changed in place in the two unmerged migrations.]**
- **F4. A menu has no printed date, so a line is dated when it was scanned or added.** A
  re-scan of an OLD printed menu therefore wins over a price a manager typed before the
  re-scan. It is on the record and one tap reverts it, but a printed-menu date would be
  the real fix. **[2026-09-21, answer 7: "newest scan wins". A menu may now carry an optional
  date (a day or a month), but it labels the menu and does not date its prices: the scan
  time still does, and a read menu reaches the house's prices only when an owner or manager
  makes it current. Whether an OLDER menu made current again should bring its prices back is
  put to him (Amendment, round 2, open questions).]**
- **F5. A menu line with no price leaves the house's price alone.** A scan that missed the
  glass column is not a decision to take the glass price off. **[CONFIRMED and extended
  2026-09-21, answer 3: a blank price keeps the last known price, is FLAGGED if unclear, and a
  manager can change it. Built: `menu_items.price_flag = 'blank_kept_last_known'` with a
  sentence naming the kept price.]**
- **F6. A wine added through the inventory create paths records its first price with
  `changed_by` NULL** and a reason saying no actor was named: those paths receive no actor
  today. The row is still written; the gap is visible, not hidden. **[CLOSED 2026-09-21,
  answer 5: the person is passed through on add-wine and bulk-add, so every price version
  names who set it.]**
- **F7. Glass advice uses the sizes on the row, and those sizes carry database defaults.**
  Glass cost = bottle cost x pour ml / bottle ml, reading `restaurant_inventory.pour_size_ml`
  then `restaurants.default_pour_ml`, and `restaurant_inventory.bottle_size_ml` then
  `master_wine_library.bottle_size_ml`. All four columns have a DEFAULT (150 ml pour, 750 ml
  bottle; baseline `20260805000000`), and the library's 750 was measured on all 4,226 rows
  as the default, not a stated format (`20260905140000`). So a pour nobody typed is priced
  as 150 ml. The code adds no default of its own (a NULL size gives "no cost"), but it
  cannot tell a typed size from a defaulted one. Found in the last-call review, 2026-09-21.
  **[ANSWERED 2026-09-21, answer 4: glass advice appears only after the house confirms its
  pour size (one-time); bottle advice is unaffected. Built: `pour_unconfirmed` until then;
  the per-wine `pour_size_ml` is no longer read.]**

Also: advice sentences carry no currency symbol (the house's currency is the page's to
print); the `/inventory` page prints `$` like the rest of that page does today.

## Amendment, round 2 (2026-09-21) -- the founder's seven answers, and menu versions

His answers were relayed to this lane in one message; the gist is recorded here, and the one
verbatim phrase in it is quoted as his. What each became:

1. **Price edits, the target margin, accepting advice and menu price corrections are
   owner/manager only, audited.** Unchanged for the first three. New: a `bottle_price` or
   `by_glass_price` correction on `PATCH /menus/items/:id` runs `assertCanManageRestaurant`
   before any write; a priced line added to the CURRENT menu (`POST /menus/items`) is
   refused the same way; a price named when a wine is added (`POST
   /inventory/:id/items`, `/items/bulk`) is too. Audited: the price change is a
   `menu_price_versions` row naming the person; the target and the pour are
   `settings_audit` rows (`target_margin_changed`, `pour_size_confirmed`).
2. **"Close enough" is a percent of the advised price** (within N% gets no advice), required
   with the target, no default -- in his words, *"percent is always shown everywhere"*. The
   gap is `(price - advised) / advised x 100`; every raise/lower/on-target sentence states it
   as a percent, and the Settings register says "% of advised". The column is
   `restaurants.target_margin_band_pct` (and `pricing_analyses.band_pct`), 0-20, edited in
   place in `20260921113100` / `20260921113300`, which have never been applied outside a
   proof build.
3. **A blank price keeps the last known price, is flagged if unclear, and a manager can
   change it.** When a current menu's line leaves a kind blank for which the house HAS a
   price, that price stands and the line gets `price_flag = 'blank_kept_last_known'` with a
   sentence ("... so the house kept the bottle price 60.00 it already had. A manager can
   change it on Inventory"), in the past tense so it stays true after that change. A blank
   kind the house never priced is not flagged: nothing is kept. A manager correcting the
   line's price clears the flag. A failed read of the house's own row for the wine is a
   failed line with the reason, never a guessed "no price, no flag".
4. **Glass advice only after the house confirms its pour size, once; bottle advice
   unaffected.** `restaurants.pour_size_confirmed_by/_at` (migration `20260921115000`, no
   default, no house confirmed by it); `PUT /pricing/pour-size` writes `default_pour_ml` and
   the person and moment in one update. The web's "default pour" had lived only in one
   browser's local store, so nothing had ever written `default_pour_ml`. A glass is costed on
   the confirmed house pour only; until then it is `pour_unconfirmed`, and the feed has a
   `pour_size_unconfirmed` entry asking for it.
5. **The person is passed through on add-wine and bulk-add.** The create paths no longer put
   a price in the INSERT (which the trigger recorded "by nobody"); the price is written right
   after through `set_house_menu_price` by the person on the token, and a failure is returned
   as `priceChange: { outcome: "failed", error }`, never swallowed. The add-wine form's glass
   price no longer defaults to an invented 0 (it would also have refused a staff member's
   whole add under answer 1).
6. **The per-house AI spend ceiling fails CLOSED for the menu-upload billed read** (ADR 0163
   Q22, re-answered): the scan parser's model call passes `spendLedgerUnreadable: "closed"`,
   so an unreadable ledger stops the read before anything is sent, with a 503 that says why;
   a split read stops at the first waiting chunk instead of recording a gap. Every other path
   keeps the ceiling as it was (fails open). It adds no over-allowance refusal on the first
   attempt: that would be `gateFirstAttempt`, which he did not ask for (open question 2).
7. **Menu versions.** Every read (`POST /menus/import`) is a NEW `restaurant_menus` row in
   `draft`: the source file kept content-addressed in the private `vendor-attachments`
   bucket under `<house>/menus/<sha256>` (or the reason it was not kept), the parser's lines
   as read (`extraction`), `lines_extracted`, who read it and when, and the optional cadence
   tag (weekly/monthly/quarterly/yearly/none) and date (a day or a month). A draft's lines do
   not touch inventory or prices. `POST /menu-versions/:menuId/make-current` (owner or
   manager) runs `make_menu_current()`, which archives every other active menu of the house
   with who and when -- the archived one with the latest `retired_at` is "the last one used"
   -- and then carries the menu's lines to the house's inventory and prices, dated by the
   scan ("newest scan wins"). `GET /menu-versions`, `/:menuId` and `/:menuId/source` (a
   five-minute link) serve the history. `/menu` shows it all, with a form to read a new menu
   and the choice after it; the onboarding review screen offers the same choice.
   **Embedding:** `menu_items.embedding vector(384)` + `embedding_model`, filled by the
   repo's existing path, `scripts/populate_embeddings.py` (all-MiniLM-L6-v2, local, run by
   hand with `--apply`), which now has a menu-line pass. The gateway writes no vector; until
   the script runs the column is NULL, "not embedded yet". **Connecting Drive/Notion-like
   storage** is recorded as a later option and not built.

**Technical choices made in the build (not his words; each is small to change):**
- The kept source uses the bucket the gateway already writes originals to, rather than a new
  bucket with new `storage.objects` policies. A menu is the house's own paper, not a
  vendor's; if that matters, a dedicated bucket is a follow-up.
- No unique index on one active menu per house: production may already hold two, and this
  migration will not run DDL that depends on data it cannot measure. `make_menu_current`
  archives every other active menu under the house row's lock instead.
- The per-wine `pour_size_ml` is ignored by the advice (its DEFAULT cannot be told from a
  typed value). A wine poured differently from the house (a 75 ml dessert wine) is costed at
  the house pour -- open question 3.
- The bottle size still reads `bottle_size_ml` (row, then library), both defaulted to 750:
  answer 4 named only the pour, so the bottle size is unchanged (F7's other half remains).
- The cellar and `/menu` join `LIVE_PAGES` at this merge, on his 2026-09-19 blocking answer
  (build the sketch-121 layout first, then go live for every house); ADR 0149 row 36 carries
  the bracket.

**Open, for him (listed in the lane report, not decided here):**
1. When an OLDER menu is made current again, do its prices come back (dated by the choice),
   or does the newest scan's price stand (as built: dated by the scan)?
2. Should a house that is OVER its AI allowance also be refused the menu read's first
   request (`gateFirstAttempt`, daily window, as Ask AI is), or only when the ledger is
   unreadable (as built)?
3. Per-wine pour sizes: should a wine be able to state its own pour (overriding the house's
   confirmed one) for glass advice?
4. "Flagged if unclear": is a line with no price at all, for a wine the house has never
   priced, also unclear (flag it), or only a blank that keeps a known price (as built)?

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
- Round 2: all 200 migrations build in PGlite and 42 behavioural assertions on the band, the
  pour confirmation and the menu versions pass (`p4-scratch/pglite-probe/cellar-r2/prove.mjs`;
  it caught a NULL loophole in the menu-date CHECK, fixed before staging). Seven new CLAIMS
  rows and two amended ones; the mutation run is in the lane's build report. Still not
  verified in a browser or against production.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-21 | Founder | Picked "Advise to target margin" (verbatim answer above) |
| 2026-09-21 | Cellar lane (build) | Built; forks F1-F6 recorded for confirmation |
| 2026-09-21 | Last-call review | `/menu` add form now says back what a line did to the house price (it had dropped `priceSync`); F7 (glass advice rests on defaulted pour/bottle sizes) added; Decision 4 wording corrected (a correction is dated when made) |
| 2026-09-21 | Founder (seven answers, relayed to the lane in one message) | F1 confirmed and widened to menu price corrections (F2 overruled); "close enough" is a percent of the advised price -- his words, *"percent is always shown everywhere"*; a blank menu price keeps the last known one and is flagged; glass advice waits for a one-time pour confirmation; the person is passed through on add-wine and bulk-add; the menu-upload spend ceiling fails closed (ADR 0163 Q22); menu versions (newest scan wins, optional cadence and date, keep every extraction with its source and an embedding, a current menu and the last one used, the person chooses) |
| 2026-09-21 | Cellar lane (round 2 build) | All seven built (Amendment, round 2); four follow-up questions put back to him; ADR 0149 row 36 bracketed for the cellar going live |
| 2026-09-21 | Last-call review (round 2) | Make-current reads the menu's lines BEFORE the switch (a failed read after it left the menu current with nothing carried, and a retry answered "already_current"); the house-row read that decides the blank-price flag now binds its error (read-error baseline 175 -> 174); the flag sentence is past tense; onboarding's make-current says a failed or flagged line and waits for Continue instead of moving on; onboarding's success page no longer says "your inventory is live" after a menu kept as a draft (it had become false when a read stopped reaching the inventory); a CLAIMS row pins make-current's read order |
