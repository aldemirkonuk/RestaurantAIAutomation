# 0193 — A house's price follows its menu and its manager, and advice aims at its own margin

- **Status:** Locked on the founder's pick, 2026-09-21 ("Advise to target margin"). Seven implementation forks recorded below for his confirmation (F1-F6 from the build, F7 from the last-call review). **[Answered 2026-09-21, round 2: his seven answers settle F1-F7 and add menu versions; built — see "Amendment, round 2" below.]** **[Round 3, 2026-09-21: his five round-6c answers settle the four open questions of round 2; the price lock he delegated ("so think verify validate your decision and build") was decided by the lane, attacked, and built — see "Amendment, round 3".]** **[Round 3, later the same day: he confirmed the one fork it put back to him, verbatim, *"The menu sets it, locks keep"*; built as recorded there.]** **[Round 3, 2026-09-22, round 6w: the menu-read allowance's end date, left open, is answered -- *"Until I say (Recommended)"*, not a date or a spend figure; docs only, no code changed -- see "Amendment, round 3" §2.]**
- **Date:** 2026-09-21
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** pricing, bottle price, glass price, menu_price_current, menu_price_versions, target margin, price advice, recommendations, menu import, tenant scope
- **Links:** [[0020-no-fabricated-answers]] (an unknown stays null), [[0051-rebuilt-pages-show-live-data-only]], [[0067-a-failed-read-is-never-an-empty-one]], ADR 0160 §110 (the cellar lane; not on this branch), `supabase/migrations/20260805123951_pricing_agility.sql`, `supabase/migrations/20260922230300_a_house_names_its_target_margin.sql`, `supabase/migrations/20260922230400_a_house_price_change_is_on_the_record.sql`, `supabase/migrations/20260922230500_an_accepted_price_advice_names_its_target.sql`, `supabase/migrations/20260922230600_a_house_confirms_its_pour_before_glass_advice.sql`, `supabase/migrations/20260922230700_a_house_keeps_every_menu_it_reads.sql`, `supabase/migrations/20260922230800_a_house_can_hold_a_price.sql`, `supabase/migrations/20260922230900_a_wine_can_state_its_own_pour.sql`, `apps/api-gateway/src/pricing/`, `apps/api-gateway/src/menus/`, [[0163-the-wine-library-is-a-ledger-of-cited-or-labelled-statements]] Q22 (on `r5/adr0163`)

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
   web normaliser). `20260922230400` fails if a `menu_price_bottle` column exists.
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
  put to him (Amendment, round 2, open questions).]** **[Round 3, L11: a chosen menu's prices
  are now dated by the moment of the CHOICE, not the scan; an older menu chosen again brings
  its prices back, except what a lock holds. See "Amendment, round 3".]**
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
   place in `20260922230300` / `20260922230500`, which have never been applied outside a
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
   unaffected.** `restaurants.pour_size_confirmed_by/_at` (migration `20260922230600`, no
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
   attempt: that would be `gateFirstAttempt`, which he did not ask for (open question 2). **[Round 3,
   answer 2, "never refuse a menu read": a retry of the menu read is no longer suppressed for a
   house over its allowance either (`allowance: "unlimited"`); the unreadable-ledger wait stays.]**
7. **Menu versions.** Every read (`POST /menus/import`) is a NEW `restaurant_menus` row in
   `draft`: the source file kept content-addressed in the private `vendor-attachments`
   bucket under `<house>/menus/<sha256>` (or the reason it was not kept), the parser's lines
   as read (`extraction`), `lines_extracted`, who read it and when, and the optional cadence
   tag (weekly/monthly/quarterly/yearly/none) and date (a day or a month). A draft's lines do
   not touch inventory or prices. `POST /menu-versions/:menuId/make-current` (owner or
   manager) runs `make_menu_current()`, which archives every other active menu of the house
   with who and when -- the archived one with the latest `retired_at` is "the last one used"
   -- and then carries the menu's lines to the house's inventory and prices, dated by the
   scan ("newest scan wins"). **[Round 3, L11: dated by the moment of the choice instead; see
   "Amendment, round 3".]** `GET /menu-versions`, `/:menuId` and `/:menuId/source` (a
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
- **[Answered round 3, answer 3: a wine's own pour counts once an owner or manager confirms it.]**
  The per-wine `pour_size_ml` is ignored by the advice (its DEFAULT cannot be told from a
  typed value). A wine poured differently from the house (a 75 ml dessert wine) is costed at
  the house pour -- open question 3.
- The bottle size still reads `bottle_size_ml` (row, then library), both defaulted to 750:
  answer 4 named only the pour, so the bottle size is unchanged (F7's other half remains).
- The cellar and `/menu` join `LIVE_PAGES` at this merge, on his 2026-09-19 blocking answer
  (build the sketch-121 layout first, then go live for every house); ADR 0149 row 36 carries
  the bracket.

**Open, for him (listed in the lane report, not decided here):** **[All four answered 2026-09-21,
round 6c; see "Amendment, round 3".]**
1. **[Delegated, then decided and built as the price lock, round 3.]** When an OLDER menu is made current again, do its prices come back (dated by the choice),
   or does the newest scan's price stand (as built: dated by the scan)?
2. **[Answered: never refuse a menu read for allowance. Its end date was open; answered
   2026-09-22, round 6w -- "Until I say (Recommended)", not a date or spend figure; see
   "Amendment, round 3" §2.]** Should a house that is OVER its AI allowance also be refused the menu read's first
   request (`gateFirstAttempt`, daily window, as Ask AI is), or only when the ledger is
   unreadable (as built)?
3. **[Answered: "Yes, confirmed per wine".]** Per-wine pour sizes: should a wine be able to state its own pour (overriding the house's
   confirmed one) for glass advice?
4. **[Answered: "Flag it".]** "Flagged if unclear": is a line with no price at all, for a wine the house has never
   priced, also unclear (flag it), or only a blank that keeps a known price (as built)?

## Amendment, round 3 (2026-09-21) -- the price lock, and the four answers

His round-6c answers, verbatim, one per open question of round 2 plus the go-live one:

1. To "a manager re-picks an OLDER menu as current: should its prices come back?":
   *"add a section to that where you can lock price, but wha f that menu item disappears? so
   think verify validate your decision and build"*. He delegated the design on a condition: it
   is researched, adversarially validated, then built.
2. Over-allowance: *"Tier based but at the same time for at the short period of time we should
   make it unlimited right?, so never refuse a menu read"*.
3. Per-wine pour: *"Yes, confirmed per wine"*.
4. A blank price on a wine the house has never priced: *"Flag it"*.
5. Cellar and `/menu`: *"live on merge"*, with a production smoke check after the deploy.

### 1. The price lock (the lane's decision on his delegation)

**In one paragraph.** A lock is a per-house, per-kind (bottle or glass) hold on the price the
house charges now. While it is open nothing changes that price -- a menu chosen (new or older),
a menu line added or corrected, the "Your price" edit, the add-wine paths, accepted advice, a
direct SQL write -- except an explicit "change and keep locked" by an owner or manager. Locks are
set, changed, moved and released only by owners and managers, every act stays on the record, and
the product never deletes one. Choosing a menu, new or old, sets every unlocked price it states,
dated by the moment of the choice. The "section" he asked for is the plan shown before the
choice: each price the menu would change, with who set it and when and a **Keep** switch, plus
every lock whose wine is not on that menu. A locked wine that leaves the menu keeps its lock,
dormant ("Locked, not on the current menu"), and it holds again if the same wine (the same
library row) comes back. A renamed or re-vintaged wine is a different wine unless a person moves
the lock to it. Advice still shows for a locked price but cannot be accepted. Staleness is shown
as facts, never on a timer.

**The rules, as built** (the numbering is the decision's; each is tested where named):

| # | Rule | Where it is proven |
|---|---|---|
| L1 | One open lock per house wine and kind (`house_price_locks`, partial UNIQUE on `(inventory_id, kind) WHERE released_at IS NULL`); bottle and glass are independent | PGlite |
| L2 | A lock holds a price that exists: it records the house price at that moment; a kind with no price is refused (409 "nothing to hold") | PGlite, jest |
| L3 | While a lock is open the house price equals `locked_price` | PGlite (asserted after every scenario) |
| L4 | Every writer is held: `set_house_menu_price` reads the open locks under the wine row's `FOR UPDATE` and writes nothing for a held kind; a BEFORE UPDATE guard on `restaurant_inventory` refuses (HPL01) a change from any other writer; the old 12-argument form delegates | PGlite, CLAIMS |
| L5 | Outcomes per kind: bottle held and glass changed is reported as both; no sentence says "changed" without the held kind; an outcome the TS wrapper does not know still throws | PGlite, jest, vitest |
| L6 | "Change and keep locked" is one act naming the lock it saw (409 if it is no longer open) | PGlite, jest |
| L7 | Advice cannot be accepted on a locked kind: `accept` checks before any write (409, naming who and when); a lock landing between check and write is a 409 and the analysis row stays unapplied | jest, CLAIMS |
| L8 | Owners and managers only, checked before any write; staff read the locks | controller spec, CLAIMS |
| L9 | The lock table is its own audit and append-only; no product path deletes a row; `service_role` has no DELETE | PGlite, CLAIMS |
| L10 | A lock outlives its author's access; any current owner or manager may release it | PGlite |
| L11 | A chosen menu sets its prices dated by `made_current_at`, naming the menu on the version row (`menu_price_versions.menu_id`); this replaced "dated by the line" and flipped the spec that pinned it | PGlite, jest, CLAIMS |
| L12 | Silence changes nothing: a wine not on the chosen menu keeps its price; a blank kind keeps the house price and is flagged | jest |
| L13 | The plan before the choice (`GET /menu-versions/:menuId/plan`), with a fingerprint that `make-current` requires (400 without, 409 on a mismatch, nothing changed either way); onboarding goes through the same plan. The page shows every price the menu would change or leaves held (a Keep switch on each), the returned and dormant locks, and every line per kind behind an "Every line on this menu" disclosure; a price a person set after the menu was read is listed first (his L11 confirmation, below) | jest, vitest, CLAIMS |
| L14 | A person's price set after the choice but before its line is carried wins (`stale`) | PGlite |
| L15 | Nothing is dropped from a sentence: held kinds are counted and named, unknown outcomes printed | jest, vitest |
| L16 | Only a person ends a lock: leaving the menu, removal from inventory or time do not | PGlite |
| L17 | `GET /pricing/locks` and /menu's **Locked prices** group every open lock by whether its wine is on the current menu; the list never filters `is_active` | jest, vitest |
| L18 | A locked wine coming back is `returned`, shown beside the locked wine's stored name and vintage, with `vintage_mismatch` when both are years and differ | jest, vitest |
| L19 | A different library row is a different wine: the old lock stays dormant, the new row is free | PGlite |
| L20 | "Move lock" is a person's act at a price the person names (400 without it) | PGlite, jest, vitest |
| L21 | A library merge that would move an open lock aborts, naming the house and the lock; a released lock follows its wine; a locked wine cannot be deleted (NO ACTION); deleting a house still works (CASCADE) | PGlite |
| L22 | Advice for a locked kind is computed and marked `locked`; it is left out of `margin_to_target`'s actions and counted under a new feed entry, `price_locks_to_review` | jest |
| L23 | Each lock shows its age and facts computed at read time: `off_target`, `advice_unknown` (with why), `author_without_access`, `not_on_current_menu` / `no_current_menu`, `wine_removed`, `menu_differs`; nothing expires | jest |
| L24 | Releasing never changes a price; the answer says when the current menu reads another one | PGlite, jest |
| L25 | An unread lock is never "no lock": the lock list answers `readable: false`; the plan is a 5xx; advice says the lock status is unknown and accept refuses; the people behind a lock are named or the failure is said (`namesOf` no longer drops its error); a lock whose standing on the current menu cannot be read (the menu or its wine unread) is in neither group (`dormant: null`, its own group on /menu), and the feed says a lock list read in part instead of staying quiet (last-call review) | jest, vitest |
| L26 | One house only: every lock names a wine of its own house (a trigger refuses otherwise) | PGlite |
| L27 | Locks and price writes are serialised on the wine row | CLAIMS (by reading: PGlite runs on one connection and cannot race) |

**Rejected alternatives** (each attacked in the decision's adversarial pass):

| Alternative | Why rejected |
|---|---|
| Keep dating the carry by the scan (as built in round 2) | Re-picking an older menu brought back nothing that changed since (`stale`), and it backdated history: the trigger closed the previous version at the scan time, so "the price on day X" was wrong between the read and the choice (finding F-a, fixed by L11) |
| Date by the choice only for a re-pick, or only for an older scan | A draft read before a re-pick and chosen after it is refused as stale; current C, re-pick A, then C again cannot bring C back |
| A price typed after a menu was read stays automatically | A hold nobody set and nobody sees, depending on time; two ways of keeping a price where one explicit lock does the job |
| A price per menu (each menu keeps its own, the house points at one) | Rebuilds pricing: every margin, valuation and POS reader uses the one column `menu_price_current` (Decision 1) |
| One lock flag per wine, or lock columns on `restaurant_inventory` | Cannot say "bottle locked, glass free"; a release would erase who locked it and when |
| A lock held only against the menu | One Accept tap would silently end its protection |
| Hiding advice for a locked price | Hides a true margin; a cost or pour change would erode a locked glass with no signal |
| Automatic expiry, or a "lock until" date | A number nobody chose (ADR 0020), and an expiry exposes the price to the next menu with nobody acting; recorded as a later option |
| Releasing a lock when its wine leaves the menu, or carrying it to a similar wine automatically | Leaves the returning wine unprotected (his exact question) or links the wrong wine (a 2020 priced by a 2019 lock) |
| Releasing puts the current menu's price back | A price change nobody made |
| A library merge releases or carries a lock | A lock would end or change through a platform act nobody at the house took |
| A trigger refusing every DELETE on the lock table | It would block deleting a house; NO ACTION on the wine plus CASCADE on the house gets the protection without that cost |
| "Lock at all my houses" | Not asked; every key in this lane is per house |
| "Apply the current menu's prices again" (re-choosing the current menu) | Changes the `already_current` behaviour the round-2 last call relied on, and nothing asked for it; after a release the difference is stated instead (L24) |

**What was built.** Migration `20260922230800_a_house_can_hold_a_price.sql` (the table, RLS on
with no policy, the append-only and own-house trigger, the guard, `set_house_menu_price` with
13 arguments and the old form delegating, `menu_price_versions.menu_id`, `make_menu_current`
returning its moment, the four acts `lock_house_menu_price`, `release_house_price_lock`,
`change_locked_house_menu_price`, `move_house_price_lock`, all invoker-rights and granted to
`service_role` only). Gateway: `GET /pricing/locks`, `POST /pricing/locks`,
`POST /pricing/locks/:lockId/{release,change,move}`, `GET /menu-versions/:menuId/plan`,
`make-current` taking `{ fingerprint }`, the carry dated by the choice, the accept pre-check, the
lock mark on advice, the `price_locks_to_review` feed entry (filed as a price act, linked to
/menu's Locked prices). Web: /menu's **Locked prices** section (groups, facts in words, change
and keep locked, release, move for a dormant lock), the plan section (`MenuPlan.tsx`) with Keep
switches in the make-current step on /menu and in onboarding, the lock mark on /inventory's "Your
price", and `makeCurrentSentence` printing every outcome it receives. After his L11 confirmation:
the plan's `readAt` and per-kind `setAfterRead`, the rows a person set after the read listed
first, and an "Every line on this menu" disclosure giving each line's bottle and glass result in
words (an unknown result is printed, never dropped). Two refinements found by reading the build
against the rules: the plan offers no Keep on a price the house does not have yet (L2: there is
nothing to hold, and the gateway would answer 409), and /inventory's "Your price" edit says "the
price was saved; this wine's pour was not" when the second call fails (it had shown the pour
call's "Nothing was changed" after a price had been saved), and offers the pour field only once
the wine's own pour is known. The pour migration's version was moved from
`20260921170100` to `20260922230900`, inside the band this lane was given
(`20260922230800`-`20260921170099`); nothing had applied it.

**The cellar surface (round 3 finish).** L8 says everyone of the house sees a lock, read-only,
wherever they see the price. The cellar's bottle leaf shows the house's bottle and glass price
and said nothing about a lock, so a person reading the cellar could take a locked price for one
the next menu will set. It now says each lock of that wine beside the price (`PriceLockNote`,
read from `GET /pricing/locks`): the kind, the held price, who locked it and since when, "at this
house", and that an owner or a manager changes it on Menu, under Locked prices. It has no
action of its own. A lock list that could not be read, or a request that failed, is said as
"could not be read ... not the same as not locked" (L25). A name that could not be read is told
apart from one that is not on record. No lock, the ordinary state, shows nothing. Another wine's
lock is never shown. This leaf is the only place the cellar shows the house price: its other
price figures are the library's reference price (the register's list column) and, for kinds with
no inventory row, a menu line's price (the row expander); a lock holds neither.

**Two readings of the decision, recorded.** (a) `price_locks_to_review` counts `no_current_menu`
as well as the four markers L23 names. With no current menu, L17 puts every lock in the "not on
the current menu" group, so it is the same fact under another name; counting only
`not_on_current_menu` would leave those locks out of review unless another marker applied. (b) The lock
acts write no row to the settings audit. The lock row is the audit (L9: who, when, the price, the
note, the release and the lock it took over from), and a price the act writes gets its own
version row (`manual`, the person, and the reason "changed and kept locked" or "a lock moved
here from another wine").

**One fork this changes, put back to him** (not decided by the lane): L11 makes a chosen menu
set its prices from the moment of the choice, which changes one case under answer 7 ("newest scan
wins"): a price someone typed after a menu was read but before it was chosen. In round 2 it
stayed automatically; now the chosen menu replaces it, and the plan lists it first with who typed
it and when, one tap on Keep from locking it. Built as L11 on the decision's recommendation; the
lane's report asks him to confirm. **[Confirmed 2026-09-21, verbatim: *"The menu sets it, locks
keep"* -- the recommended road: the menu you choose sets its prices, except what you lock. Built:
`computePlan` marks each price it would replace `setAfterRead` when the wine's open version row
was written by a person (`manual`, or `agent_accepted` for accepted advice; never `import`, which
is another menu's price) after the menu was read (`extracted_at`, else the row's `created_at` for a
menu read before menus were kept; an unknown moment is never "after"); the plan section lists
those rows first, says "set by hand by X on DATE, after this menu was read", and says above them
how many there are and why they come first. A CLAIMS row
(`ADR-0193-A-PRICE-SET-AFTER-THE-READ-IS-LISTED-FIRST`) pins the rule and the order.]**

### 2. Never refuse a menu read for allowance (answer 2)

Round 2 already added no over-allowance refusal on the first attempt, but a RETRY of the
fail-closed menu read (after a 429/5xx) was still suppressed for a house over its allowance.
Now the scan parser passes `allowance: "unlimited"`: being over the allowance refuses nothing on
that path, first attempt or retry; every other path keeps its ceiling. An unreadable ledger still
stops the read (his round-2 answer, "spend fail closed for uploads", stands). **[2026-09-22,
round 6w: "Tiers are a later decision" is corrected -- the later decision is his word, not an
engineering call, a date, or a spend figure. Put to him as three paths (unlimited until he says;
a date; a spend figure that switches tiers back on), he picked, verbatim, "Until I say
(Recommended)": the menu read stays unlimited for allowance until he gives the word. No date or
spend trigger exists in code -- `allowance` is the two-value type `"enforced" | "unlimited"`
(`model-client.service.ts:259`), set once, statically, at the menu read's one call site
(`scan-parser.service.ts:342`), and tested as a plain `opts.allowance === "unlimited"`
(`model-client.service.ts:342`, feeding the first-attempt gate and the retry ceiling); nothing
reads a clock or a ledger total to flip it. The specs do not guard that:
`scan-parser.ledger-waits.spec.ts` and `spend-ledger-fail-closed.spec.ts` stay green (17 of 17)
under a future-dated condition. CLAIMS row `ADR-0193-A-MENU-READ-IS-NEVER-REFUSED-FOR-ALLOWANCE`
does, on the lines it pins: the literal, the `:342` test, both retry calls that pass `unlimited`
on (`model-client.service.ts:399`, `:443`), and the retry ceiling's `if (unlimited) {` (`:674`)
-- the one test of it the menu read reaches, since it never sets `gateFirstAttempt` -- plus the
first-attempt gate's test (`:344`). A date condition on any of them fails the row (mutated
2026-09-22: the call site and `:342` were caught by the row as first written; `:674` passed the
row and the specs alike, and `:399` and `:443` the row, so the row was widened to all three, and
each is now caught). A new statement inside that `if` block, or a wrapper that rewrites the options before
the call, would still pass it. The refusal
when the spend ledger itself cannot be read is unchanged and stays
(`spendLedgerUnreadable: "closed"`, `scan-parser.service.ts:338`) -- that is a different gate
from the allowance tier and his round-2 answer on it stands. Docs-only: the grep found no
trigger to contradict the answer, so no code changed.]**

### 3. A wine's own pour, confirmed per wine (answer 3)

Migration `20260922230900_a_wine_can_state_its_own_pour.sql` adds
`restaurant_inventory.pour_size_confirmed_by/_at` (FK `public.users`, no default, no wine
confirmed by it). `PUT /pricing/wines/:inventoryId/pour` (owner or manager, audited as
`pour_size_confirmed` on the wine) writes `pour_size_ml` with who and when in one update; `null`
sends the wine back to the house's pour. Glass advice uses the wine's confirmed pour, else the
house's confirmed pour, else `pour_unconfirmed`. A pour changed later by any other path loses its
confirmation (a trigger), because the confirmation no longer describes the number. /inventory's
"Your price" edit carries the pour field.

### 4. The never-priced blank is flagged (answer 4)

A current menu's line that shows no price at all, for a wine the house has no price for either,
is flagged `blank_no_house_price` with a sentence; the plan shows it before the choice. As built
the test is "the house has no price for the wine now" (bottle and glass both empty), which
includes a never-priced wine and also one whose prices were cleared: the same unclear case, and
no extra read. A single blank kind beside a priced one, for a kind the house never priced, is not
flagged: that is the ordinary shape of a wine list.

### 5. Live on merge (answer 5)

Built in round 2 (cellar and /menu in `LIVE_PAGES`). The production smoke check after the deploy
is the landing session's step, not this build's.

### Findings outside the lock, recorded here (no register rows: this lane files none)

- **F-a** (fixed by L11): dating the carry by the scan backdated price history.
- **F-b**: `make_menu_current` overwrites `made_current_at`/`_by` and clears `retired_*` on a
  re-pick, so a menu row loses its earlier period as current. The version rows now record which
  menu set each price (`menu_id`); a log of when each menu was current is recommended, not built.
- **F-c**: the stale check is per wine, not per kind (the open version row carries both prices),
  so a later glass edit makes a line's bottle price stale. Under L11 only a race reaches it.
- **F-d**: `merge_library_wines` loop 1 aborts on 23505 when both of a house's rows have an open
  price version (`idx_menu_price_versions_one_open`); this lane's trigger makes that reachable.
  Not measured against production.
- **F-e**: deleting a library row would cascade a house's wine and its price history. In the
  corpus as built, ADR 0115's guard refuses that delete first (the PGlite probe hit it); the
  lock's NO ACTION key is a second barrier for a locked wine.

### Honest limits of round 3

- The decision's adversarial pass was run by the same agent as a separate step, not by an
  independent agent (no fan-out tool in that subagent).
- L27 (serialisation across connections) is verified by reading the SQL (a CLAIMS row), not by a
  concurrent test.
- "Set after the read" is read per WINE, not per kind: the open version row carries both prices,
  so a glass typed after the read also lists the wine's bottle first (F-c's shape). It can list a
  price first that need not be; it never leaves one out.
- A price can be locked only from a menu's plan (Keep) or kept locked through the Locked prices
  section; there is no Lock button on /inventory, because the decision placed the section on the
  menu choice. `POST /pricing/locks` accepts any wine of the house.
- No browser check of /menu, the plan, /inventory or the cellar's bottle leaf against a running
  gateway; no production query. A released lock also blocks a hard delete of its wine row (NO ACTION keys on any lock
  row): nothing in `apps/` hard-deletes a wine today, and the merge repoints released locks first.

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
- Round 3: all 202 migrations build in PGlite; 80 behavioural assertions on the locks, the
  per-wine pour and the never-priced flag pass (`p4-scratch/pglite-probe/cellar-r3-locks.mjs`),
  and the round-2 probe still passes 42/42 on the same corpus. 75 mutations (gates, rules, SQL,
  CLAIMS rows, web), each caught and restored byte-for-byte (the lane's build report). The
  round-1 probe (`cellar-price-adr0193/prove.mjs`) is stale since round 2 renamed `band_pts` to
  `band_pct` and fails on that, not on this round. Not verified in a browser or against
  production.
- Round 3 finish (the cellar surface, L12's own spec): the 75 mutations above re-run on the
  finished tree, plus 6 for the cellar's lock note and 2 for L12: 83 of 83 caught and restored
  byte-for-byte. On the staged tree: gateway jest over pricing, menus, model-client, analytics,
  inventory, settings-audit, cellar and wines, 1074 passed and 11 skipped (before L12's spec was
  added; `menus.service.spec.ts` then 50 of 50); web vitest over menu, onboarding, inventory,
  recommendations, settings, cellar, `lib/mudavym` and `pages/__tests__`, 917 passed and 14
  skipped in 48 files; claims 427 of 427; PGlite 80 of 80 on all 202 migrations. Still not
  verified in a browser or against production.
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
| 2026-09-21 | Founder (round 6c, five answers) | Verbatim: to an older menu chosen again, *"add a section to that where you can lock price, but wha f that menu item disappears? so think verify validate your decision and build"* (the design delegated, on condition it is researched, adversarially validated, then built); to over-allowance, *"Tier based but at the same time for at the short period of time we should make it unlimited right?, so never refuse a menu read"*; to per-wine pour, *"Yes, confirmed per wine"*; to a blank price on a never-priced wine, *"Flag it"*; to going live, *"live on merge"* |
| 2026-09-21 | Cellar lane (round 3 decision) | The price lock decided on his delegation: a draft attacked case by case (16 attacks, 8 killed parts of it, 8 revised it), 27 rules and the decision's 17 rejected alternatives (merged into 14 rows) recorded in "Amendment, round 3"; the one fork that changes his answer 7 (a price typed after a read, before the choice) put back to him |
| 2026-09-21 | Cellar lane (round 3 build) | Built: migrations `20260922230800` (locks, guard, plan dating, never-priced flag) and `20260922230900` (per-wine pour); lock routes, the plan and its fingerprint, the accept pre-check, the feed entry; /menu's Locked prices and the plan section (also in onboarding), the lock mark and pour field on /inventory; the menu read is never refused for allowance; eight CLAIMS rows added and the pour row amended |
| 2026-09-21 | Founder (L11 confirmation) | Verbatim: *"The menu sets it, locks keep"* -- the decision's recommended road for the one fork it put back to him (a price typed after a menu was read, before it was chosen, is replaced by the chosen menu unless kept; the plan lists it first with who and when, beside its Keep switch) |
| 2026-09-21 | Cellar lane (round 3 finish, after his L11 confirmation) | A price a person set after the menu was read is marked (`setAfterRead`) and listed first in the plan; the plan shows every line per kind; no Keep where there is nothing to hold; a saved price with a refused pour is said as both; the pour migration moved into the lane's band (`20260922230900`); a ninth CLAIMS row (`ADR-0193-A-PRICE-SET-AFTER-THE-READ-IS-LISTED-FIRST`); 75 of 75 mutations caught |
| 2026-09-21 | Cellar lane (round 3 finish, the cellar surface) | The cellar's bottle leaf says each lock beside the house price, read-only, and says an unread lock list as unread (L8, L25, L26); L12 given its own spec (a wine the chosen menu does not list is not written; a blank kind is never named in the write; a priceless line is "no price", not a failure); the lock note's spec hook returned the mock, which vitest ran as a teardown, and was braced; two readings recorded (`no_current_menu` counted for review; the lock row is the lock acts' audit); 83 of 83 mutations caught on the finished tree |
| 2026-09-21 | Last-call review (round 3) | Tried to break it: a price that changes silently, a lock staff can move, a dormant lock that vanishes or re-links the wrong wine, advice that overrides a lock, a menu read refused for allowance, a pour used before confirmation, a record now false, a migration outside the band. One break: with the current menu (or a lock's wine) unreadable, every lock was put under "On the current menu" on /menu, and the dormant group vanished; now such a lock is in neither group (`dormant: null`) and /menu shows it in a group of its own, and the feed's `price_locks_to_review` says a lock list read in part instead of reading as nothing to review. A second: /inventory's add form said "added to inventory" whatever the gateway's `priceChange` answered (round 2 already returned a failed price write there, and a removed wine added back with a price its lock holds now answers `locked`); the form now says a price that did not land (held by a lock, a newer price, a failed write). On the staged tree: gateway jest 1078 passed and 11 skipped (pricing, menus, model-client, analytics, inventory, settings-audit, cellar, wines), web vitest 922 passed and 14 skipped (48 files), claims 427 of 427, PGlite 80 of 80 on all 202 migrations; 12 mutations caught and restored byte-for-byte (the five fixes above, and seven of the lane's gates replayed: the lock read in `set_house_menu_price` -- caught by the HPL01 guard refusing the write, a second barrier -- the release gate, the accept pre-check, the unlimited menu read, the confirmed wine pour both ways, the never-priced flag). Still not verified in a browser or against production |
| 2026-09-22 | Founder (round 6w) | The menu-read allowance's open end date answered (the last call's founder question: his round-6c words, *"for at the short period of time"*, named no end). Put to him as three paths -- (a) unlimited until he says, (b) a date, (c) a spend figure that switches tiers back on -- he picked, verbatim, *"Until I say (Recommended)"*: the menu read stays unlimited for allowance until he gives the word; the refusal when the spend ledger itself cannot be read stays |
| 2026-09-22 | Cellar lane (docs, round 6w) | Recorded in "Amendment, round 3" §2 and bracket-corrected two now-false sentences: "Tiers are a later decision" (§2) and "for now" (the open-questions list). Verified by grep, not by code change: `allowance` is the static two-value type `"enforced" \| "unlimited"` (`model-client.service.ts:259`), set once at the menu read's one call site (`scan-parser.service.ts:342`) with no date or spend-total check anywhere in the gateway; `spendLedgerUnreadable: "closed"` (`scan-parser.service.ts:338`) is unchanged. No trigger contradicted the answer, so no code changed |
| 2026-09-22 | Last-call review (round 6w) | Tried to break it: a sentence left calling the end open, a founder word paraphrased as his, a record now false, a trigger in code, a migration outside the band (none: docs only). The question and his pick read back from the session record: three options, "Until I say (Recommended)", "A set date", "A spend figure"; he picked the first. The code still matches: neither place `unlimited` is read (the first-attempt gate, `retryAllowedBySpendCeiling`) gates on a date or a spend total; the retry path reads the ledger only to refuse when it cannot be read. One gap, closed in the text: the jest specs do not pin "no trigger" -- a future-date condition on either line leaves `scan-parser.ledger-waits.spec.ts` and `spend-ledger-fail-closed.spec.ts` green (17 of 17), and only CLAIMS row `ADR-0193-A-MENU-READ-IS-NEVER-REFUSED-FOR-ALLOWANCE` fails (both mutations caught, restored byte-for-byte); §2 now cites it. The Founder row's quoted "no end was given" (the last call's words, not his) replaced by his round-6c words. Claims 427 of 427 |
| 2026-09-22 | Last call (round 6w, on the commit) | Tried to break the committed text again: his pick read back from the session record (the question and his answer, 2026-09-22T03:27Z); every line citation re-read; no sentence left calling the end open; no date or spend trigger in the gateway (the model client's `allowance` option is set only at the scan parser's one model call, and read only at `model-client.service.ts:342`). One break, in the guard the text leaned on: a date condition on the retry ceiling's `if (unlimited) {` (`model-client.service.ts:674`) -- the one test of `unlimited` the menu read reaches -- left the CLAIMS row and both specs green (17 of 17), and the same condition on either retry call that passes `unlimited` on (`:399`, `:443`) left the row green. The row's verify now also pins those three lines: each of the five date mutations (the call site, `:342`, `:399`, `:443`, `:674`) fails it, and the unmutated tree passes; §2 now says what the row pins and what it cannot see. The ADR index row still said F1-F7 were "recorded for his confirmation"; bracketed. Claims 427 of 427 |
