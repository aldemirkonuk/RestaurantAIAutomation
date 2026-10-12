# 0341 — A house says whether its till prices include tax, and net is made pre-tax at ingest

- **Status:** Locked 2026-10-12 (founder). His three picks, made by AskUserQuestion on 2026-10-12 and quoted verbatim under §Founder answers, are **his**, not the coordinator's: F1 build it, F2 only from now, F3 stamp the cost basis. The shape under them (four states, the order of trust, the rate table) is the coordinator's draft that F1's option described and he picked. The details the draft left open were settled by the build lanes, each with its basis and the alternative rejected (§Decision, "as built"). Lane 6 (backfill) is **dropped** by F2.
  - **Amends by bracket only** [[0287-a-passed-days-panel-shows-its-net-takings-the-cell-stays-covers]] Decision 7, "Adapter subtotal" (`0287:55`).
  - **Leaves untouched** AW17 (`0287:24`), 0287 D2, D5 and D8, [[0290-the-dashboard-tells-the-houses-day-true]] count-and-say, and [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]]'s formula and targets.
  - **Does not edit** ADR 0295, a draft on open PR #615. What is owed to it is in §Records.
- **Date:** 2026-10-12
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** tax-inclusive, KDV, VAT, prices include tax, tax_basis, tax_basis_confirmed_at, gross_subtotal, tax_rate_version, house_tax_rates, effective-dated rate, cost tax basis, unit_cost_tax_basis, price_tax_basis, last_purchase_price_tax_basis, wac_pre_tax_qty, net sales, AW17, adapter subtotal, margin advice, target re-confirm, F-620, F-1537, basit usul, e-Arşiv, Z-report
- **Links:** [[0287-a-passed-days-panel-shows-its-net-takings-the-cell-stays-covers]] (D7 bracket-amended; AW17, D2, D5, D8 kept); [[0290-the-dashboard-tells-the-houses-day-true]] (count-and-say kept); [[0292-analytics-reads-the-whole-window-or-refuses]]; ADR 0295 draft on PR #615 (rule 1, rejected alternative 3, F3); [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]] (formula kept); [[0105-a-pos-connection-is-a-row-not-an-env-var]] (D4 vendor evidence); [[0020-no-fabricated-answers]]; [[0051-rebuilt-pages-show-live-data-only]]; [[0301-the-cellar-reads-the-tills-record-and-counts-the-door-checked-price]]; [[0240-register-entries-are-fragments]] (claims and debt as fragments); the draft and its lane brackets `p4-scratch/sim-run/arch/decision-tax-inclusive.md` (outside the repo); the founder's answers `p4-scratch/sim-ledger.md` S218; findings F-620 (`sim-ledger.md:1044`) and F-1537 (`:2826`); claims `claims.d/feat-house-tax-basis-schema.jsonl`, `feat-house-tax-basis-setting.jsonl`, `fix-pos-subtotal-pre-tax-at-ingest.jsonl`, `fix-margin-advice-tax-basis.jsonl`, `docs-adr-tax-inclusive-net.jsonl`; debt `tech-debt.d/2026-10-12-docs-adr-tax-inclusive-net.md`

## Context

**What AW17 says.** The founder's AW17, "Net sales (Recommended)" (`0287:24`), says owner sales figures use the **subtotal, before tax and surcharge**, labelled *net*. 0287 D2 says the figure is never `total` and never falls back to it. 0287 D7 (`0287:55`) admits net is only as true as each adapter's subtotal, and hands the adapters to lane netsales.

**What each adapter wrote before this record** (draft basis `wt-sim50` @ `5cedb1079`):

| Adapter | `subtotal` written | Where (at `5cedb1079`) |
|---|---|---|
| Square | Already pre-tax: `net_amounts.total_money − tax_money − tip − service charge` | `pos-adapters.ts:290-307,347` |
| Toast | `num(c.amount)`, as the till sends it | `:469` |
| Clover | `null` | `:414` |
| Generic webhook and CSV | Whatever the payload sends; no tax field | `:120-139`, `:204`, `:506` |

`pos_checks` had `subtotal`, `total` and `tip` and no tax column; `restaurants` had `currency` and `country` and no tax setting. `dashboard.service.ts` read whatever subtotal was written and labelled it net.

**Why that was wrong for a Turkish house.** A Turkish menu must print the final price with every tax inside (Fiyat Etiketi Yönetmeliği, 2022 amendment; cited from research, not re-fetched). A Turkish till's CSV therefore sends a KDV-inclusive subtotal, which was labelled "Net sales" and overstated net by 9–17% (F-1537). Nothing in a CSV shows that the figure includes KDV.

**Why margins were wrong too.** `margin-to-target.ts` computed `(price − cost)/price` with no tax term. A 600 TL wine with 20% KDV inside and a 200 TL cost showed a 66.7% margin; the true margin is 60% (F-620).

**ADR 0295 (draft, PR #615) shapes this.** Its rule 1 keeps one stored definition of net, its rejected alternative 3 refuses net computed at read time, and the founder's 0295 F3 pick rejected "Basis per till" labelling.

## Options considered

1. **A. A per-house tax basis plus a dated rate table, applied once at ingest, with the till's stated tax used first.** Chosen (F1). One stored definition (0295 rule 1); covers the CSV case; the house's rules come from its own country and the owner confirms them (F-155); one setting fixes net sales and margins. Costs: a schema change, owner setup, rates that change by decree.
2. **B. Detect the basis per adapter (country, currency, total equal to subtotal).** Rejected as the mechanism: it guesses (total equal to subtotal fits an inclusive price and a tax-exempt check alike); the generic and Toast adapters serve US and Turkish houses, so the adapter cannot carry the basis; it breaks ADR 0020/0051 and the never-infer-from-country rule. Kept only as a **proposal** that pre-fills the form.
3. **C. Only the tax the till states.** Exact where present (Square). Rejected alone: generic/CSV had no tax field, Clover writes null, and many Turkish ÖKC exports carry no line tax, so most Turkish houses would read "net not recorded". It became **rung 1** of A.
4. **D. Labelling only ("Sales (tax-inclusive)").** Rejected: the founder rejected "Basis per till" in 0295 F3; it would relabel US generic houses against AW17; margins would stay wrong.
5. **E. Net from e-Arşiv / e-Fatura or Z-report KDV totals.** Rejected as the source: Turkey only, integrator or GİB access, day or month totals with no lines, filed monthly, and most dine-in sales are ÖKC slips. Kept as a possible later month-close cross-check (F-1013). Not built.
6. **Do nothing.** A Turkish or EU house keeps a gross figure labelled "net" and margins overstated by 9–17%.

For F2 the founder weighed (a) a one-time backfill of past checks under a new evidence key against (b) forward only; for F3, (a) stamping a tax basis on recorded costs against (b) margin staying on gross with a named refusal. §Founder answers has his picks.

## Founder answers

AskUserQuestion, 2026-10-12 (`sim-ledger.md` S218), his option picks verbatim:

- **F1:** *"Build it (Recommended)"*. A per-house tax basis (include / exclude / no VAT); net from the till's stated tax, then dated per-category KDV rates, then unknown; US and unset houses unchanged.
- **F2:** *"Only from now (Recommended)"*. No backfill. Checks are made net from the switch date, and reports mark the switch date. Lane 6 (backfill) is dropped.
- **F3:** *"Yes, stamp cost basis (Recommended)"*. Costs carry their tax basis; margins go pre-tax only when the cost is proven pre-tax; the owner re-confirms the target margin on the switch.

[Corrected 2026-10-12, lane 5: the draft's F2 listed the backfill as "(a) … Recommended" and forward-only as (b); the ledger records the option he picked as "Only from now (Recommended)". The ledger is the record of what he was shown and picked; the draft's labels are not. This record follows the ledger.]

## Decision

**A house states its tax basis once. Ingest uses that basis, and the tax the till states, to write a pre-tax `pos_checks.subtotal`, keeps the till's figure in `gross_subtotal`, and stamps on each row the basis and rate version it used. A figure it cannot resolve is written as null with its reason, never guessed. Nothing written before the switch is rewritten. Margin advice works on the price without tax only when the cost is proven to be without tax too.**

1. **Setting: four states, never defaulted** (lane 1, migration `house_tax_basis_and_rates`). `restaurants.tax_basis` is one of `unset`, `prices_include_tax`, `prices_exclude_tax`, `not_vat_charging` (CHECK `restaurants_tax_basis_is_one_of_four`), with `tax_basis_confirmed_at` / `tax_basis_confirmed_by`. An owner or manager confirms it through `GET`/`PUT /settings/tax-basis` (lane 2), the house taken only from the token.
   - The owner sees it in plain words, with the tax named the way the house's recorded country names it (`taxWordFor`): "Prices on your till include KDV" for a Turkish house, "Prices on your till include tax" for a US one. The page itself is in English; a Turkish translation of these sentences is not built.
   - **Confirm once:** re-sending the answer already recorded writes nothing and files no audit row, so `tax_basis_confirmed_at`, the switch date reports mark (F2), moves only on a real change. Rejected: restamping on every confirm.
   - **No way back to `unset`** through the route: unset means "nobody has said", false once someone has. Rejected: reopening the no-op path for rows already stamped.
   - **A proposal, never a value.** Only the house's recorded country proposes: TR (include; 10% food and soft drinks, 20% alcohol, Decree 7346 of July 2023 and Communiqué 51 from 2024-05-01, cited from research) and US (exclude, no rates). It is never written. Rejected: a region inferred from the time zone.
   - `not_vat_charging` is for a house that charges no VAT/KDV at all; the law on Turkish *basit usul* was not looked up. The setting is not country-locked.
2. **`unset` is a strict no-op, and so is the US path.** An unset house's check row has exactly the keys it had before (spec `pos-hub.tax-basis.spec.ts`, which passes on the base too: that is the no-op proof). `prices_exclude_tax` and `not_vat_charging` keep every figure and only stamp the row. One setup line, "Say which in Settings", shows on the dashboard sales strip **in every country** while the basis is unset; it is never triggered by country. Until the owner answers, an unset Turkish house keeps a gross figure labelled "net", and this record says so. Rejected: research 2's "sales · tax basis not set" relabel for non-US houses (inference from country, and the per-house label 0295 F3 rejected).
3. **Rates are a dated, append-only table.** `house_tax_rates` (lane 1): house, key kind (`house` with key '', `pos_category`, `house_item` = a `restaurant_inventory.id`), rate (a fraction; NULL withdraws), `effective_from`, `effective_to` (exclusive), `version`. `version` is the house's running number, assigned at insert under a per-house lock; rows are never updated, and a correction is a later row. The rate in force is the highest version whose span holds the check's business date, so a late import uses the rate of its own day. RLS is on, the policy is `service_role` only, `anon` and `authenticated` are revoked, and the gateway scopes every statement to the house on the token. Rates are entered as a percent (`POST /settings/tax-rates`) and refused when they look like the fraction spelling, negative, ≥ 100, or have more than two decimals. Rates may be entered under any basis, so a house can enter them before it switches.
   - Rejected: an `authenticated` RLS policy keyed on a JWT house claim (needs a client grant, the OD-72 hole); editable `effective_to` (the table "as of version V" could not be reproduced).
4. **Order of trust at ingest** (`pos-hub/tax-basis-resolver.ts`, `resolveCheckSubtotal`; never at read time, per 0295 alt 3):
   1. **The tax the till states.** Square already takes it off (`squareNetSales`, `pos-adapters.ts`) and marks `subtotalPreTax`. Generic/CSV gains an optional check `tax` (inside the subtotal) and a per-line `tax_rate` (a percent). A till line rate is used before the house's rate for that line. A stated tax with `total − tip ≥ subtotal + tax` means the till added tax on top, which contradicts the house's answer: net is NULL with that reason. Toast's own tax figures are **not read** until a captured vendor payload shows what they mean (ADR 0105 D4); a Toast house that says its prices include tax goes through rung 2.
   2. **House rates per line, prorated from the till's own check subtotal:** `net = subtotal × Σ(lineᵢ/(1+rᵢ)) / Σ lineᵢ`. Net is never rebuilt from the lines alone, which would drop check-level discounts and comps and be the second definition 0295 alt 3 rejects.
   3. **One rate out of the whole check** only when a **whole-house** rate is in force and no other rate is in force that day. Rejected: "any single rate in force" (a house that entered only "Alcohol 20%" has said nothing about its food).
   4. **Otherwise NULL**, with the reason; 0290's count-and-say then draws "from N of M checks".
   - **No basis read, no write.** A failed house read, a basis outside the four, or an unreadable rate table refuses the check ("not imported, the house's tax basis could not be read"). Rejected: writing unstamped, which writes a KDV-inclusive figure as net for exactly the houses this fixes.
   - **An inclusive house with no time zone** writes NULL ("time zone isn't set"); the rate in force and the switch both need the house day. Rejected: UTC (ADR 0116).
5. **Every row says which basis it used; only from now (F2).** `pos_checks` gains `gross_subtotal`, `tax_basis` and `tax_rate_version`. A check whose house day (ADR 0296) is before the house day of `tax_basis_confirmed_at` keeps the till's figure and writes the three stamps NULL, whenever it arrives. Nothing is backfilled. Evidence pairs keep their basis: 0287 D5's keys and D8's never-overwrite `keepPairs` rule are unchanged.
   - Rejected: comparing instants (splits the switch day); converting late imports of pre-switch days (a backfill, against F2).
6. **Costs carry their tax basis, and margin goes pre-tax only on a proven cost (F3).**
   - Lane 1 adds `procurement_order_items.price_tax_basis`, `inventory_lots.unit_cost_tax_basis` and `restaurant_inventory.last_purchase_price_tax_basis`: NULL (not stated), `includes_tax` or `excludes_tax`. A write that changes a cost figure and leaves its basis as it was clears the basis (trigger). A lot booked from an order takes the line's basis when every same-house line for the item states the same one. `inventory_lot_rollup` appends `wac_pre_tax_qty` / `wac_tax_included_qty`. Rejected: a stamp on the order header only (invoice and door prices overwrite `unit_cost`, leaving a stale basis, the dangerous direction).
   - For a `prices_include_tax` house, lane 4 works the margin on `price / (1 + r)` and shows the advised price back with tax inside, `cost / (1 − target) × (1 + r)` (`margin-to-target.ts`); 0193's formula is unchanged. The wine's rate is its own `house_item` rate in force, else the whole-house rate only when no till-category rate is in force; otherwise `no_tax_rate` with its reason.
   - The cost is proven per source: lot WAC only when `wac_pre_tax_qty = wac_qty > 0`; the last purchase price by its stamp; the last price paid by its lot's stamp. Anything else refuses as "cost basis not stated", or its own sentence for a cost stamped `includes_tax`. Rejected: dividing an `includes_tax` cost by the sales rate (the purchase rate is not known to be the sales rate).
   - **Target re-confirm.** While `target_margin_set_at < tax_basis_confirmed_at`, every line is `target_unconfirmed`, no margin is stated and nothing can be accepted; the web says so once in Settings, Target margin. No column is added for it. Rejected: letting 0193's advice flip silently from "on target" to "raise".
   - `unset`, `prices_exclude_tax` and `not_vat_charging` houses get the advice they got before, key for key, with no rate read.
7. **Records.** 0287 D7 "Adapter subtotal" (`0287:55`) carries a bracket naming this ADR; AW17, the "net" label and 0287 D2/D5/D8 are unchanged. 0295 is a draft on open PR #615 and is **not** edited from here (§Consequences, owed).

## Consequences

**What gets better**
- A house that says its till prices include tax gets a true AW17 net from the day it says so. F-1537 closes for those checks once lanes 1–4 merge.
- Margins stop overstating by 9–17% wherever the cost is proven pre-tax (F-620), and never move silently: the owner re-confirms the target first.
- One setting serves net sales and margins. US houses and houses that have not answered see no change.

**What it costs**
- A schema change and owner setup; category or item rate mapping is owner work.
- Mixed-rate checks that cannot be resolved read "net not recorded": a visible downgrade the owner's own answer causes, mitigated by keying rates to the house's items.
- **Until something writes a cost stamp, every inclusive house's margin advice reads "cost basis not stated".** That is F3's honest consequence, not a defect.
- Checks before the switch stay as the till sent them (F2), so a window across the switch mixes two bases.

**Owed, each recorded in `tech-debt.d/2026-10-12-docs-adr-tax-inclusive-net.md`:**
- A writer of the cost stamps (receiving, door check, procurement, invoice).
- Reads that add checks across the switch say so, and reports mark the switch date (F2). Not built by lanes 1–4.
- The web picker for item rates (`house_item`); without it a house that rates by till category gets `no_tax_rate` on a wine.
- `recommendations.service.ts` is not taught the new advice states.
- ADR 0295 rule 1's bracket ("as the till sends it, made pre-tax at ingest where the house states its till prices include tax") goes into PR #615 while it is open, or into a bracket after 0295 merges. 0295 PR-3 (`fix/pos-subtotal-means-net`) must set `subtotalPreTax` on any adapter it makes pre-tax from the till's own tax, or an inclusive house would have its rates divided out twice.
- This ADR's README row, in its own PR (a pure append).
- Ordering: lane 2's settings copy describes lane 3's ingest, so lane 2 must not ship ahead of lane 3.

**Claims.** `claims.d/docs-adr-tax-inclusive-net.jsonl` holds this record's rows. The draft's "the margin math has no tax term" row is **dropped**: lane 4 made it false by design.

**Revisit when:**
- A captured Toast payload shows what its tax fields mean.
- A decree changes KDV rates (add a row; never edit one).
- More than about 10% of an inclusive house's checks land null.
- A month-close cross-check against Z-report KDV totals shows a gap of more than 1%.

## Not verified (said plainly)

- Toast `amount` semantics in a live payload, including with tax-inclusion on and in UK/IE.
- KDV-payer status of Turkish *basit usul* houses.
- Whether any Turkish generic till's CSV carries a tax column.
- The Z-report format.
- The Turkish rates and the price-label rule are cited from research (alomaliye.com, vergidegundem) and were not re-fetched.
- ADR 0295's wording was read from PR #615 / main-repo commit `6d0b4f194`, not from this branch.
- Production was not read: how many houses would answer each basis, and how many of their checks would land null, are not measured.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-12 | Two research passes + adversary | Draft survived, amended; F1–F3 to the founder |
| 2026-10-12 | Founder (S218) | F1 build, F2 only from now, F3 stamp cost basis |
| 2026-10-12 | Lanes 1–4 (local, stacked to `22ac2e665`) | Built; each lane's choices bracketed in the draft and carried into §Decision |
