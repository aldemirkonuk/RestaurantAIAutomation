# 0359 — A house states its tax basis, and cost carries it

- **Status:** Proposed (2026-11-07). Two kinds of content sit in this record, and they are kept apart:
  - **The founder's picks** of 2026-10-12 on F-620 / F-1537 (F1, F2, F3, §Founder picks). They are his, quoted as the ledger records them, and are not reopened here.
  - **The session's calls** (C1 to C7, §Decision), made under the founder's /goal of 2026-11-07, which the lane brief quotes as: *"Do not ask me any questions I approve you decide them all ... Change UI if needed, do not ask me (bypass rules of one create one retire or any of the ADR's reference them but do not have to stick with them)"*. They were not put to him. How far a standing delegation reaches is OD-242 (OPEN-DECISIONS.md:329 on main), still open; a lock of these calls is his.
- **Date:** 2026-11-07
- **Decider:** Aldemir (founder) for F1 to F3. The session (cost-math lane 3.4) for C1 to C7, under the delegation above. Decisions are locked by the founder, never by an agent.
- **Keywords:** tax basis, KDV, VAT, prices include tax, reclaim input tax, indirim KDV, gross cost, net cost, cost_tax_basis, tax rate bands, margin before KDV, target re-confirm, switch date, F-620, F-1537, G10, F11, Decision 12
- **Links:** [ADR 0016](0016-ledgers-must-express-unknown.md) (a rate carries its dated source; "unknown" is a value); [ADR 0020](0020-no-fabricated-answers.md); [ADR 0193](0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin.md) (the margin formula, kept); [ADR 0287](0287-a-passed-days-panel-shows-its-net-takings-the-cell-stays-covers.md) AW17 and Decision 7 "Adapter subtotal" (not edited; bracket owed); ADR 0295 (draft on open PR #615; not edited); [ADR 0298](0298-cost-of-goods-is-what-sold-and-concentration-reads-the-till.md) (cost of goods); ADR 0115 F11 (on open PR #589); OD-243 (OPEN-DECISIONS.md:330 on main); the cost-math proposal `p4-scratch/sw-walk/cost-math/proposal.md` §2f, §3 lane 3.4 (line 152), §4 F4 and §6 (outside the repo); the receipt plan `p4-scratch/sw-menu-receipts/proposal-receipt.md` Decision 12 (outside the repo)

## Context

**What the code does on `main` (`c93d6115c`).** No migration, gateway, service or package source names a tax basis: `grep -rw tax_basis` over `supabase apps services packages` finds nothing. Margin is `(price - cost) / price` (`apps/api-gateway/src/pricing/margin-to-target.ts:12`, computed at `:142`), on `menu_price_current` (`apps/api-gateway/src/pricing/margin-advice.service.ts:253-257`), with no tax term. A lot's `unit_cost` says nothing about whether KDV is inside it. The cost-math walk filed this as G10, narrowed by its verdict: whether a Turkish menu price includes KDV is an inference that no code shows (`cost-math/verdicts.json`, G10).

**Why it matters.** If a house's menu prices include KDV, the margin shown is inflated by the rate. A ₺1.200 bottle with 20 % KDV inside and a ₺400 cost shows 66.7 %; on the price without KDV (₺1.000) it is 60 %. On the cost side, whether the KDV on a supplier's invoice is part of what a bottle cost depends on whether the house reclaims it, which nothing records.

**Why an ADR now.** The founder answered the fork on 2026-10-12. His picks were written into the sim ledger and into project memory, and into a draft ADR 0341 on a local branch that was never pushed (`docs/adr-tax-inclusive-net` at `fc7097b1d`, the tip of a five-branch stack `feat/house-tax-basis-schema` to `fix/margin-advice-tax-basis`, based on `31152ab34`, 47 commits behind `main` when read). No record of them is on `main` or on any open PR. The receipt plan's Decision 12 asks for exactly this record ("A: write it as Proposed from the memory note"), and the cost-math plan's lanes 3.5a and 3.5b wait on it. This record is option A.

## Founder picks (2026-10-12, his, not reopened)

AskUserQuestion, 2026-10-12, recorded in the sim ledger as S218 (`p4-scratch/sim-ledger.md:2885-2888`, outside the repo). The quoted words are the option labels he picked; the text after each is the ledger's summary of the option, not his words.

- **F1:** *"Build it (Recommended)"*. A per-house tax basis (prices include tax, exclude tax, or no VAT). Net comes from the tax the till states, then from dated per-category KDV rates, else it is unknown. US and unset houses are unchanged.
- **F2:** *"Only from now (Recommended)"*. No backfill of past checks. Reports mark the switch date.
- **F3:** *"Yes, stamp cost basis (Recommended)"*. Cost is stamped with its tax basis. Margins are pre-tax only when the cost is proven pre-tax. The owner re-confirms the target margin on the switch.

**A related ruling on an open PR.** PR #589 (ADR 0115, open, not merged) records the founder's approval of the cocktails team's pick F11, *"pour cost's price basis and target"*. Its row reads, verbatim: *"Pour cost uses the price without KDV, taken from dated KDV bands. There is no default target until the house sets one."* F11 is a cocktail ruling. Applying its price basis to every margin is C3 below, the session's call, not his.

## Options considered

The fork the founder left to the build is F4 of the cost-math plan: what a lot's cost holds, and what a margin divides by.

1. **A. Cost before KDV when the house reclaims input KDV, else cost with the line's KDV, each lot stamped; margin on the menu price net of KDV for a house whose prices include it (chosen, C2 and C3).** It follows F1 and F3, and it is the accounting rule for inventory cost: a tax the house recovers from the state is not part of what the bottle cost, and one it cannot recover is (IAS 2, costs of purchase, cited from memory, not re-fetched).
2. **B. Assume Turkish menu prices include KDV, with no setting.** No question to answer. Rejected: it infers the basis from the country, which the G10 verdict refused and F1 replaces with a per-house answer.
3. **C. Gross cost against gross price.** Nothing to stamp. Rejected: wrong whenever the house reclaims input KDV, because the cost then carries tax the house gets back.
4. **D. Backfill old lots and checks with a basis.** One basis for all history. Rejected by the founder (F2).
5. *Doing nothing:* every Turkish house whose prices include KDV keeps margins inflated by the rate, and every lot's cost stays of unknown basis.

## Decision

**A house states its tax basis and whether it reclaims input tax. From that day, each lot's cost is stamped with what it holds, and a house whose menu prices include tax gets its margin on the price without tax, against a cost whose basis is proven. Nothing before the switch is rewritten.**

**C1. One record, on `main`.** This ADR is the record of F1 to F3 and of F4. The local draft ADR 0341 stays a draft: it was never pushed, its base is 47 commits behind, and its §Decision describes code built only on that local stack. Its number stays held by its branch, which the ADR number guard reads. Lanes 3.5a and 3.5b may reuse that stack's code where it agrees with this record.

**C2. The house's setting** (lane 3.5a builds it; nothing is built here).
- `restaurants.tax_basis` holds one of four states: `unset`, `prices_include_tax`, `prices_exclude_tax`, `not_vat_charging`. It is never defaulted from the house's country.
  - The values are tax-neutral, as the local stack spelled them, not `prices_include_kdv` / `prices_exclude_kdv` / `no_vat` as the cost-math plan wrote them. The column is on every house, US houses included; the word KDV is what a Turkish house reads in the interface, not a stored value. Rejected: the `_kdv` spelling, which names one country's tax in a column every country shares.
- `restaurants.reclaims_input_tax` is a yes/no asked beside the basis, null until answered (the plan's `reclaims_input_kdv`, renamed for the same reason).
- The switch date is when the basis is first confirmed, and reports mark it (F2). Re-sending the same answer does not move it.

**C3. What a lot's cost holds** (stamped at VERIFIED by lane 3.5a, through the receive lanes 1.2 and 1.4).
- `inventory_lots.cost_tax_basis` is `net`, `gross_cost` or null.
- A house that reclaims input tax: the lot's cost is the line's value before KDV, stamped `net`.
- A house that does not reclaim, or is `not_vat_charging`: the line's share of KDV is added to its cost, stamped `gross_cost`. That KDV is a cost the house bears, so the cost is still the true cost of the bottle; this is how C3 reads F3's "proven pre-tax": without any tax the house gets back.
- Null when the house's basis or its reclaim answer is unset, when the lot was booked before the switch (F2: no backfill), or when the paper states no KDV for a reclaiming house's line. The purchase rate is not assumed to be the sales rate. Rejected: computing a lot's KDV from the sales rate bands.

**C4. What a margin divides by** (lane 3.5b).
- Only a `prices_include_tax` house changes. Its margin is worked on the menu price without tax, `price / (1 + r)`, with `r` the rate band in force for the item's category on the day (C5). ADR 0193's formula is unchanged; only its price input moves. The advised price is shown back with tax inside. This extends #589 F11's rule from cocktail pour cost to every margin.
- The margin is stated only when every lot behind the cost carries a stamp (F3). Otherwise it reads "cost basis not stated" and shows no number.
- On the switch, every line is "target not re-confirmed" until the owner confirms the target margin again (F3). No margin is stated and no advice can be accepted until then.
- `prices_exclude_tax` and `not_vat_charging` houses get the margin they get today: their menu price has no tax to take out.

**C5. The rates.** Rates are national, dated and per category, as #589 F11 says ("dated KDV bands"). Lane 3.5b builds the table, keyed by country so it serves more than Turkey. Each row carries its effective dates and a primary source with its date (ADR 0016). Rows are never edited; a decree adds a row. An item whose category has no band in force on the day gets no margin and its reason. Rejected: each house typing its own rates (the local stack's `house_tax_rates`), which makes every owner re-enter a decree and lets two houses disagree about the law. A house-level override for an item outside its category's band is left until a house needs one.

**C6. An unset house keeps its margin.** The cost-math plan's F4 and §2f said an unset Turkish house gets no margin and one sentence. That contradicts F1 ("US and unset houses unchanged"), and it would pick out a Turkish house by its country. So an unset house of any country keeps the figures it has today. One sentence beside its margins says the margin assumes the menu price has no tax inside and links to the setting. Rejected: withholding the number from unset Turkish houses (against F1, and an inference from country).

**C7. Sales are not decided here.** F1 also covers net sales (the till's stated tax first, then the bands, else unknown). Where that netting happens, at ingest or at read, bears on ADR 0295's rule 1, a draft on open PR #615. It waits for #615. The local ADR 0341 §Decision 4-5 is the existing draft of it.

**Kill attempt on C4 and C6.** "A house that sets its basis loses its margin advice until it re-confirms its target and its lots are stamped." It does. A margin inflated by the rate (60 % shown as 66.7 %) is worse than a dash with its reason, and the gap closes with one answer and the next delivery. The attempt that did change the plan was against the plan's own F4: its "unset Turkish house gets no margin" failed against F1 and became C6. **C2 to C5 survived.**

**Retire-to-write.** This record names no document to retire. Whether a new ADR must is OD-243 (OPEN-DECISIONS.md:330 on main), open; the founder's /goal of 2026-11-07 waives the rule for this work, in the words quoted under Status.

## Consequences

- **Easier.** A Turkish house whose prices include KDV gets a true margin, and every lot booked after its switch says what its cost holds. Cost of goods (ADR 0298) can say which basis its figure is on.
- **Harder or given up.** Owner setup: two answers, then a re-confirmed target. Lots booked before the switch never get a stamp (F2), so a house's margin advice stays "cost basis not stated" on an item until its older lots are sold through.
- **Unverified.** The KDV rate bands need a primary source per category and date; none was fetched for this record. The local stack's rates (10 % food and soft drinks, 20 % alcohol) were cited from research and not re-fetched. Whether a Turkish *basit usul* house charges or reclaims KDV was not looked up. IAS 2's wording is cited from memory.
- **Owed** (in `../tech-debt.d/2026-11-07-docs-adr-house-tax-basis.md`): ADR 0287 Decision 7 "Adapter subtotal" gets a bracket naming this record, and only that; ADR 0295's wording goes into PR #615 or into a bracket after it merges; this ADR's README row, in its own PR; the cost-math plan's §2f and lane U3 words change to C6; and the lanes 3.5a and 3.5b.
- **Claims.** `claims.d/docs-adr-house-tax-basis.jsonl` holds two `resolved` rows (the picks and F11 are quoted here) and four `open` rows: the house's setting, the lot stamp, the rate table and the margin's tax term are not built. Rows 3 to 5 fail the build once their object lands in a migration under any spelling the row names, and row 6 once a non-spec pricing file names tax at all, so the lane that builds it must flip it.
- **Revisit when** a decree changes a KDV rate (add a band), a captured supplier paper shows KDV stated in a way C3 cannot read, or the founder rules on OD-242 or OD-243.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-12 | Founder (AskUserQuestion, ledger S218) | F1 build, F2 only from now, F3 stamp cost basis |
| 2026-11-07 | Cost-math lane 3.4 (session) | Created, Proposed; C1 to C7 under the founder's /goal of 2026-11-07 |
