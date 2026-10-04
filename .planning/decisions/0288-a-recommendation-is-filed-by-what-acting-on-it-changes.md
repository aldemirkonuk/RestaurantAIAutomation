# 0288 — A recommendation is filed by what acting on it changes

- **Status:** Locked for the filing of the two rules (founder, 2026-10-04 ~00:30Z, verbatim pick: "Money / Stock (Recommended)"). The section-head words, the efficiency → Unfiled fallback and the composite-key reading are this lane's method, not the founder's words; they are stated below so they can be overturned on their own.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** recommendations, register, stake, stakeOf, stakeFilingOf, RULE_STAKE, CATEGORY_STAKE, efficiency, plowhorse_repricing, puzzle_activation, Price it, Move stock, Money, Stock, The floor, Unfiled, section head, rc-act-elsewhere, rc-register-why, AW28, A-054, analytics walk
- **Links:** [[0191-the-recommendations-catalogue-is-actionable-not-a-read-only-leaf]] (the composite stored key `rule#subject#grain`), [[0193-a-house-price-follows-its-menu-and-its-manager-and-advice-aims-at-its-own-margin]] (`pricing` → Money), [[0240-register-entries-are-fragments]] (F3: an OD row shifts every citation below it, so the open questions below stay here), the page note `.planning/06-pages/recommendations.md` (the register paragraph and the axis table), the analytics walk on Tuzlu Rüzgar (`p4-scratch/sim-run/analytics/FINDINGS.md`, AW28 / A-054), memory `founder-answers-2026-10-03-analytics-fixes.md:29`

## Context

`/recommendations` files every entry twice. The **act** (the docket's sections, `rec-docket.ts`) is filed by rule key, from each rule's own sentence. The **register** (the rail: Money · Stock · Vendors · The floor · Unfiled) promises *"what acting on an entry would change"* (`RecommendationsNext.tsx:13-15`, `:755` @8c673db4b), but it was filed from the engine's **category** alone.

For two rules the category and the promise disagree. The engine gives `plowhorse_repricing` (*"Raise those prices 5–8% or renegotiate cost on the next PO"*, `recommendations.service.ts:349-355`) and `puzzle_activation` (*"Put one puzzle wine by-the-glass this week"*, `:363-369`) the category `efficiency`. They are its only efficiency rules, and `rec-format.ts:75` mapped `efficiency → 'floor'`. The docket files the first under **Price it** (`rec-docket.ts:156-158`) and the second under **Move stock** (`:172-174`). So, with Money pressed, the filter at `RecommendationsNext.tsx:303` (`e.stake === stake`) left **Price it** holding only `pairing_promotion` and `margin_to_target`. The walk saw *"Price it — 2 entries"* with the price change missing (A-054). The section head printed only `{list.length} entries` (`:905-907`) and named nothing filed under other registers. The rail counts (`:353-357`) were correct.

Rows on the Snoozed, Dismissed and History leaves come from `recommendation_actions`. Their `ruleKey` can be the composite item key (`rule#subject#grain`, `recommendation-actions.service.ts:338-353`, ADR 0191). A lookup by the raw key would miss those rows.

## Options considered

1. **File by rule where the prescription says so, otherwise by category, and say which** — a `RULE_STAKE` table in `rec-format.ts`, shaped like `rec-docket.ts` `RULE_ACT`, with each row quoting the rule's own sentence. **Chosen.** It touches only the web page, and each filing can be checked.
2. *Change the engine's category* (efficiency → pricing / inventory). Rejected. The category feeds other things: the goal levers (`goals.service.ts:85,105,110`; `rec-daybook.ts:167-172`), the insight scheduler and the reports pill (`rp-format.ts:80`). The register's question is not the engine's question.
3. *Derive the register from the act.* Rejected. The axes disagree on purpose (`06-pages/recommendations.md:585-593`), and *Order it* alone spans four registers (stockout → Stock, margin_advice_blind → Money, revenue_concentration → Vendors, spend_acceleration → Vendors). The founder's pairing (*Price it → Money, Move stock → Stock*) is kept as a **test invariant** instead (`rec-format.test.ts`, "every Price it rule is Money and every Move stock rule is Stock").
4. *Re-key all 17 rules by name.* Rejected for now. Fifteen rules' categories already say what acting on them changes. Two open questions (below) may add a row each, and a full table would restate fifteen correct filings with nothing new behind them.
5. *Doing nothing.* A pressed register keeps hiding a price change from Money while the head reads as the whole act.

## Decision

The register files an entry **by its rule where the rule's prescription says what it changes**, and otherwise by its category. The page states which in the entry's working.

- `plowhorse_repricing` → **Money**, and `puzzle_activation` → **Stock**. This is the founder's pick.
- `efficiency` is removed from `CATEGORY_STAKE`. Both of its rules are now filed by name, so a new efficiency rule lands in **Unfiled** on purpose. *(Method.)*
- The rule is read with `readKey(ruleKey).ruleId`, so a composite stored key on the leaves files the way the standing entry does. *(Method.)*
- With a register pressed, a section head that holds entries filed under other registers says so inside its count: `Order it · 1 entry · 1 more filed under Stock`. The names follow rail order ("Stock", "Stock and Vendors", "Stock, Vendors and The floor"). The count uses the same day-scoped book as the rail, so the two cannot disagree. A section with nothing under the pressed register stays hidden, as before, because the rail's counts carry it. On a phone (below 640px) such a head wraps: the count and its words drop to their own full line under the title, so the title is not squeezed onto two lines (`rec-next.css`, keyed on the head's `data-elsewhere`; checked in the Browser pane at 1280px and 375px on a static fixture of the rendered markup). Desktop is unchanged. *(Method.)*
- The entry's working gains *"Why it would change {register}"* (`rc-register-why`): the rule's own sentence, or the category it fell back on. The rail note now reads *"Filed by the rule where its prescription says so, otherwise by its category; the working says which."*

## Consequences

- With Money pressed, Price it holds every price change. With Stock pressed, Move stock holds the by-the-glass move.
- The gateway is unchanged. Goals, levers, the scheduler and the reports pill still read `efficiency`.
- A new rule with a category no register knows shows as Unfiled. The claim row `ADR-0288-PRICE-AND-STOCK-FILED-BY-WHAT-THEY-CHANGE` re-reads `recommendations.service.ts` and fails CI when an engine rule has neither a rule row nor a mapped category.
- **Revisit when** a rule's prescription changes what it moves, or a new engine rule lands. Its register is then a deliberate row, not a fall-through.

### Open (non-blocking; to be asked as short questions; no OD rows, per ADR 0240 F3)

- **F1 — `revenue_concentration`** (*"Protect the top sellers’ stock first (raise their service level to 98%)"*) is filed under **Vendors** because its category is `risk`. Should it move to **Stock**? The lane recommends Stock: the prescription changes stock cover, not which vendor is paid or what they are paid. Its act is already *Order it* and its hand is Inventory. An answer adds one `RULE_STAKE` row and one test line.
- **F2 — `weekday_gap`** (*"Move staff training, deliveries, and inventory counts to <worstDay>; test a <worstDay>-only offer"*) is filed under **Money** because its category is `sales`. Should the register follow the leading-clause rule the founder set for this rule's act on 2026-09-04 (`rec-docket.ts:164-167`), which would file it under **The floor**? The lane's confidence is low; it is the founder's call. An answer adds one row and one test line.

### Adjacent, not built here

- `actOf` and `handOf` look up the raw `ruleKey`. On the Snoozed, Dismissed and History leaves, a composite stored key (e.g. `sales_below_weekday_baseline#wednesday#d:2026-09-02`) is therefore filed under *Not yet filed*, and its hand falls back to the category. The register no longer has this gap; the act and the hand still do.
- `pour_size_unconfirmed` (`recommendations.service.ts:455-464`, category `pricing`) has no act in `RULE_ACT` and shows as *Not yet filed*. It has no hand by name either, and `pricing` has no category hand, so it falls back to Reports. Its register is Money, by category. `rec-docket.test.ts`'s hard-coded rule list does not include it.

### Retire-to-write

Retires nothing. It amends the page note's register paragraph and axis-table row in place.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | lane `recregisters` (fix/recommendations-file-by-what-changes) | Created; built with tests (10 new, each shown failing at 8c673db4b) |
