## A wine's default 150 ml pour still comes before the house's confirmed pour — OPEN — 2026-11-07

Filed by `fix/one-pour-size-for-the-house` (recipes walk lane A4, call F11; founder /goal 2026-11-07, every fork the session's call).

**What is true.** `record_glass_pour` now resolves one glass as `p_pour_ml`, then `restaurant_inventory.pour_size_ml`, then the house's confirmed `restaurants.default_pour_ml`, then 150 (migration one_pour_size_for_the_house). But `pour_size_ml` carries a database `DEFAULT 150` (baseline), and the add-wine form sends one, so most items have a pour of their own that nobody stated. For those items the house's pour changes nothing: only an item whose `pour_size_ml` is NULL draws it. Price advice reads a wine's pour only when it is confirmed (`target-margin.service.ts` `confirmedWinePourFrom`), so stock and advice still disagree for an unconfirmed wine. Production was not read (lane rule), so how many items have a NULL pour is unmeasured. Re-run: `select count(*) filter (where pour_size_ml is null), count(*) from restaurant_inventory where deleted_at is null`.

**What closes it.** ADR 0115 step S (serve sizes per kind) replaces this chain. Before that, a slice can make the stock draw read an item's pour only when it is confirmed, the rule price advice already keeps. That changes what unconfirmed wines pour and needs its own red/green test.

## The Measurement register's title still says "& recipes" — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** The recipe switches are gone from `MeasurementSection.tsx`, but `apps/web/src/pages/settings/next/st-format.ts` still names the register "Measurement & recipes", describes it as covering "whether recipes are tracked", and marks it `kind: 'browser'`, while the house pour on it is kept on the restaurant. The lane held its 15-file cap, so this was not changed. `SettingsNext.test.tsx` pins the title.

**What closes it.** Retitle to "Measurement & pour", rewrite the description, and update the title list in `SettingsNext.test.tsx`.

## `TargetMarginSection` is built but mounted nowhere — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** `apps/web/src/pages/settings/next/TargetMarginSection.tsx` (ADR 0193) holds the target-margin inputs and a pour-confirm control, and is imported only by its own test. `git grep TargetMarginSection apps/web/src` on main 7221901d6 finds no other importer. So no page let a house confirm its pour, and glass price advice could never stop waiting. This branch puts the pour confirmation on the Measurement register through the same `PUT /pricing/pour-size`. The target-margin inputs are still unreachable.

**What closes it.** Mount the target-margin half on settings, or retire the component. Either way, drop its pour row, since Measurement now carries it.

## Two lanes may add `apps/web/src/utils/volumeUtils.test.ts` — OPEN — 2026-11-07

Filed with the entry above.

**What is true.** Recipes lane A5 (`fix/no-invented-glass-cost`) lists `volumeUtils.test.ts` among its files. This branch creates it to cover the 10 ml pour minimum and the deletion of `costPerGlass`. If A5 also creates it, git gives an add/add conflict.

**What closes it.** Whichever lane merges second appends its cases to the existing file.
