# 0360 — A recipe is a versioned list of house items in base units, built on restaurant_inventory now

- **Status:** Proposed (2026-11-07). Every fork below is the session's call under the founder's 2026-11-07 /goal ("Do not ask me any questions I approve you decide them all ... reference [the ADRs] but do not have to stick with them"). A lock is his.
- **Date:** 2026-11-07
- **Decider:** executor (recipes walk, wave 4 lane 1), under the /goal.
- **Keywords:** recipe, cocktail, ingredient, base unit, tenths of a ml, version, cost per serve, WAC, house item
- **Links:**
  - [ADR 0115](0115-the-house-item-is-the-ledgers-key.md): H3 (`restaurant_inventory.id` is the house item) is what a line points at; R81 (tenths of a ml) is honoured in this lane's own column.
  - [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) and [ADR 0053](0053-analytics-cost-unknown-not-invented.md): unknown cost is null, never 0.
  - [ADR 0020](0020-no-fabricated-answers.md): a failed read says it failed (503 with a sentence). ADR 0104 as the brief cites it: no confidence number in any response.
  - Proposal: `p4-scratch/sw-walk/recipes/proposal.md` §3 Phase B (B1, B2) and §4 F1-F7, F13, F17. QA round 7c BLOCKER 2.

## Context

QA round 7c found `cocktail_ingredients` written and never read, no recipe linked to a good, no drink with a cost, and the till skipping every non-wine line. The proposal's F1 put the recipe engine behind PR #589 (ADR 0115's drinks lock) and its steps M1, M2, M3, D1, D2, F and S: about eight migrations, with #589 open for a month.

## Decision

1. **Build on what main has (supersedes proposal F1's gate).** A line points at `restaurant_inventory(id)`. On main that table already takes every kind (`spirit`, `liqueur`, `food`, `supply`) and every unit (`ml`, `l`, `mg`, `g`, `kg`, `each`), per migration `the_house_item_is_the_ledgers_key` (H3). When ADR 0115's D1/D7 move rows into kind tables, `recipe_lines.inventory_id` is one more arc that moves with them. The inventory walk's "used in" contract already expects this column name.
   - *Rejected:* waiting for D1/D2/M3 and #589. Cocktail cost stays empty for that whole time, and the merge later is the same either way.
2. **F2. What a line points at.** A `stocked` line names a house item, or is "not linked yet" (null). The sale of such a recipe will wait and take nothing (F6). An `untracked` line (garnish, ice, water) is text only. It never has an item, never depletes and is never costed. *Rejected:* catalogue ids (no lot) and free text.
3. **F3. Units.** Closed vocabulary: ml, cl, l, oz (US fluid ounce, 29.5735 ml), tsp 5 ml, tbsp 15 ml, dash 1 ml, barspoon 5 ml, g, kg, each. The line keeps what was typed, and the database stores an integer `qty_base` in tenths of a ml, mg, or thousandths of an each. Rounding is half-up. `recipe_qty_base` computes it inside `save_recipe_version`, never the client. House-editable dash and barspoon are **deferred**: they are fixed for now.
4. **F4. History.** Versions and lines are append-only: a trigger refuses UPDATE and DELETE. `recipe_current` is the only mutable row, and a composite FK keeps it pointing at a version of the same drink. A save carries the version it opened; a stale one is refused (409) and writes nothing.
5. **F5.** A recipe belongs to the drink and yields N serves (`yield_serves`). Each line's cost is divided by N.
6. **F6.** It is modelled here (a null `inventory_id` on a stocked line) and enforced by the sale in the next wave.
7. **F7. Cost on the sheet.** Today's cost per inventory unit comes from `resolveUnitCost` (invoiced lot WAC, then the recorded last purchase price). It is turned into cost per base unit:
   - bottle and keg: divided by `bottle_size_ml`;
   - ml and l, mg, g and kg, each: by their own factors.
   It is computed on read. The total exists only when every stocked line is linked and priced; otherwise the response says "2 of 3". A unit-family mismatch is unpriced as `size_not_known`, never guessed.
   - **Session's call, narrower than the lane brief:** a `case` or `pack` is also `size_not_known`. No column records how many bottles one holds, so dividing a case price by one bottle's ml would overstate the cost twelvefold.
8. **No pour-cost percentage.** Main has no house tax basis (ADR 0359 is open as #784), and F8 shows no percentage without one.
9. **F13. Who writes.** Owner or manager (`RolesGuard`). Anyone in the house reads. A role whose ROLE_POLICY row does not see `money` (`seesHouseAmounts`, the dashboard's rule) gets `price: null` and `cost: null`, and the gateway never reads lot cost for that role.
10. **F17.** The server takes numbers only. Parsing a pasted spec and decimal commas belong to the sheet (lane 2), and every parsed row is confirmed there.
11. **One write path.** The RPC `save_recipe_version` checks the drink is a live row of this house (a corpus drink with no house is refused) and every linked item is a live row of this house (not soft-deleted). It takes 1 to 40 lines, each with a positive qty and a known unit, all in one transaction. It is SECURITY INVOKER and executable by service_role only.
12. **Grants (session's call, against the lane brief).** The brief asked for an authenticated SELECT scoped to the house. Main's lockdown guard (`check_new_tables_are_locked_down`, OD-72/OD-94) refuses any client grant on a new table, and `auth.uid()` is NULL in production. So clients get no grant. A house-read policy in the predicate of `vendor_price_observations_authenticated_read` states who may read. The pgtest proves the policy keeps house B from house A's rows when a grant is added for the probe.
13. **Legacy rows:** `cocktail_ingredients` is counted with a NOTICE and nothing is moved (skip-and-flag). The GET returns its rows as `legacyLines`, so the sheet can prefill unconfirmed rows. The old route stays until #650 merges.

## Not in this record

These come later:
- sale depletion (next wave, on #805 once #804 lands);
- house-editable dash and barspoon;
- preps and batches;
- food;
- the till-to-recipe map;
- retiring the old ingredients route.
