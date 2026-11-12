# Round 11: adversarial re-test of PRs #839, #840, #841

Base `origin/main` 259feea3f. Heads tested: #839 `6b45d68c0`, #840 `5d3a861ff`, #841 `06d4f9c6e`. Method: `gh pr diff` only; detached worktrees `/private/tmp/claude-501/qa-wt-r11-{1,2,3}` with `node_modules` symlinked (removed after); a throwaway Postgres 17 container (`qa11-pg`, removed) with all 301 migrations applied, one database at main (`ctl`) and one at main plus #839 (`fix`). No checkout, merge, push or comment in the shared checkout. Probes: `round11-probes-pos/` (`p839_precision.sql`, `p839_finalise.sql`, `p840_realkey.sql`, `r11-pos-replay-probe.qa.spec.ts`, `r11-results.jsonl`, `claim_mut.py`, `build_db.sh`, `bootstrap.sql`).

| PR | Target | Verdict |
|---|---|---|
| #839 lot cost keeps six decimals | G24, per-gram cost read as 0.04 | FIXED for the lot and WAC path; three residuals below, one is a merge-order hazard with #783 |
| #840 replay reaches Toast rows, pages, chunks | round 8 #804 PARTIAL items 1-3 | FIXED for all three named gaps; PARTIAL on two neighbours (see below). #805 double-void phantom stock: NOT FIXED, untouched |
| #841 docs | ADR 0011, claims, POS-2 debt | FIXED with one overstated sentence (a claim the code contradicts) |

Counts: FIXED 3 (with residuals), PARTIAL 0 as a headline, NOT FIXED 0, REGRESSION 0. Residuals are listed per PR and are not hidden in the headline.

## #839 FIXED (lot cost and WAC path)

What I ran (`ctl` = main, `fix` = main + migration; `p839_precision.sql`, everything rolled back):

| Case | main | #839 |
|---|---|---|
| 264 / 12 = 22 (one lot of 12) | 22.00, value 264.00 | 22.000000, value 264.000000 |
| 100 / 3, one lot of 3 | 33.33, value 99.99 | 33.333333, value 99.999999 |
| 100 / 3, three lots of 1 | 33.33, sum 99.99 | 33.333333, sum 99.999999; rollup WAC 33.333333 |
| 3333.33 per 100 kg as 0.0333333 per g, 1,000,000 g | 0.03, value 30000.00 | 0.033333, value 33333.000000 (true 33333.30) |
| JPY 0.5 per g, 1,000 g | 0.50 | 0.500000 |
| KWD 0.0125 per g, 1,000 g | 0.01, value 10.00 | 0.012500, value 12.500000 |

- Same value in `inventory_lots`, `inventory_transactions`, `inventory_lot_rollup` and `inventory_location_breakdown`.
- The PR's own pgtest `supabase/tests/20270302143700_a_lot_cost_keeps_small_units_test.sql` passes on `fix` and fails on `ctl` at `T1 FAIL inventory_lots.unit_cost is numeric(10,2)`. That is the "fails without the fix" evidence. CI does not run `supabase/tests/*.sql` (the PR says so); the claim `G24-LOT-COST-KEEPS-SMALL-UNITS` verify passes (rc 0) but only checks migration shape and that no later file undoes it.
- Migration keeps view columns, comments, owner, options and grants identical: md5 of `reloptions/relacl/owner` for the three views is the same on `ctl` and `fix`. It applies cleanly after all 300 earlier migrations. Local grants are empty, so production grants are not modelled (PR says so too).
- Re-verification: `finalise_delivery_cost` compares the stored cost with the incoming one (`IS NOT DISTINCT FROM`). Verifying a delivery three times at an invoice price of 33.3333 (what `procurement_document_lines.unit_price numeric(12,4)` can hold) wrote 3 revaluation rows on main and 1 on #839. So the widening also fixes duplicate history rows for 3-4 decimal prices. A 10-decimal price (100/3 unrounded) still writes 3 rows on both (pre-existing, no caller sends one today: `delivery-stock.service.ts:748` reads the 4-decimal column).
- Currencies: `numeric(14,6)` has the same 8 integer digits as `(10,2)`, so no new overflow for large-denomination currencies; 0-decimal (JPY) and 3-decimal (KWD) costs are stored exactly.

Residuals (none is a regression):

1. **A lot's stored cost times quantity does not reproduce the invoice total at scale.** Six decimals cap the error at 5e-7 per unit: 100/3 x 3 = 99.999999; 1,000,000 g at 0.0333333 stores 33333.00 against 33333.30. There is no stored line total to reconcile against. Small, but it is the "rounding drift" answer: bounded, not zero.
2. **The web still shows two decimals.** `useInventoryNextData.ts:480-486` `cellMoney` formats with the currency's minor units (`fmtMoney`) or `maximumFractionDigits: 2`, so a per-gram WAC of 0.035 displays as 0.04 (USD) or 0 (JPY, 0 minor units). Stored value is right, display is not. CSV export writes the raw number (`iv-export.ts:61` `blank(r.wac)`), so exports keep all six places. Latent today because nothing creates a per-gram lot yet (the PR's own debt entry says so).
3. **Table rewrite.** Measured: `relfilenode` of `inventory_lots` and `inventory_transactions` both change (19547 to 28301, 19569 to 28311), so the two `ALTER COLUMN TYPE` take a full rewrite under ACCESS EXCLUSIVE, and `inventory_transactions` is the ledger. Not measured on production size. The PR does not mention the lock.
4. **Merge-order hazard with #783 (open, `fix/lots-are-never-deleted`).** Its migration `20270303100000_a_used_up_lot_is_kept.sql` sorts after #839's and recreates both views with `CREATE OR REPLACE`. Applied on top of `fix`: the `inventory_lot_rollup` WAC rounding is back to 2 places (`wac_places = 2`), while the column stays `numeric(14,6)`. #839's claim would fail on a tree that has both, so the guard works, but whichever merges second must carry the 6-place rounding.
5. Sources that stay at 2 places by design: `auction_lot_records.booked_unit_cost/house_unit_cost numeric(12,2)` and the TS `cents()` in `auction-lot-cost.ts:41`, consistent with the lot; `log_order_delivery` declares `v_unit_cost DECIMAL(10,2)` (legacy trigger on `procurement_orders`; it calls `record_inventory_transaction`, which does not exist in the migrated schema, so that trigger path cannot book anything). Not touched by this PR.

## #840 FIXED for the three gaps; two neighbours open

All 21 specs pass (`pos-hub.unresolved-replay.spec.ts`); 405 pos-hub plus toast tests pass; `check_stock_wrappers_check_ownership.py` passes (8 reviewed). Against the PR's base service (`d4e37214c`) with the new spec copied in: 5 of the 6 new tests fail (Toast sale, Toast glass, voided Toast order, 500-stuck-rows, 450-ids URL); the "500 lines per save" test passes there too because main already capped at 500. So the fix is covered by tests that fail without it. (`tsc --noEmit` shows only the pre-existing missing `@simplewebauthn/server` module from the shared symlink.)

My probes (`r11-pos-replay-probe.qa.spec.ts`, results in `r11-results.jsonl`; the live Toast door code `ToastService.applyOrderSaleEffects` ran against the same fake database, so the queue rows are the door's own):

| Probe | Result |
|---|---|
| 1,000 hub rows with no stored check, then 1 fresh sale | fresh sale applied (bottles 12 to 11), `still_waiting` 1000, `truncated` false. Round 8 starvation FIXED |
| 1,000 stuck Toast rows (no events) + a fresh live-queued Toast order + a fresh hub sale | both fresh sales applied, `still_waiting` 1000 |
| 99 / 100 / 101 / 200 / 201 / 450 hub checks, uuid ids | `pos_checks` reads of [99], [100], [100,1], [100,100], [100,100,1], [100x4,50]; widest 3,897 encoded characters; every check applied. The 100/101 boundary is exact |
| 100 / 101 Toast orders, uuid order and item guid | `events` reads 100 (3,897 chars) then 1; `inventory_transactions` key reads 100 (8,697 chars) then 1. Under 16 KB; the key list is the widest and has about half the margin |
| Two saves racing, 30 hub rows | stock moves once; second save reports `already_applied: 30` |
| Two saves racing, 30 Toast rows, glass | stock moves once; second reports `already_applied: 30` |
| Two saves racing, 30 Toast rows, bottle | stock moves once (-13,500 ml as expected) but **both saves report `applied: 30`**: the `inventory_transactions` "seen" read runs before either write, so the reply double counts. Stock is right, the sentence is wrong |
| Toast row replayed, replayed again after a lost clearing write, live re-send closed then paid, then live void | stock 12 to 10, stays 10, 10, 10; void returns to 12. Keys are `toast_sale_T1_merlot-1` throughout: the replay key equals the live door's key, so once only |
| Toast sale queued, void event, then mapped | cleared with no stock, bottles stay 12 |
| Item deleted before the mapping is saved | throws "does not belong to this restaurant", mapping not saved, queue untouched |
| Item deleted mid-replay (hub, Toast bottle, Toast glass) | no throw; hub `applied 2 / failed 1 / still_waiting 3`, Toast `applied 2 / failed 4`; rows stay open, message says "save the mapping again to retry", which cannot help once the item is gone |

Real-database checks of what the mock cannot prove (`p840_realkey.sql` on the full schema):
- `inventory_transactions.restaurant_id` and `idempotency_key`, `events.restaurant_id/event_type/payload`, `pos_unresolved_lines.id` (uuid, so the keyset `gt("id", after)` order is sound) all exist.
- `apply_stock_movement` with the Toast key and `p_occurred_at` run twice returns the same transaction id and leaves one ledger row, so the "seen key" read works as the PR assumes. `record_glass_pour` run twice returns `{"idempotent": true, ...}`, which is what the code tests for.
- No index serves `payload->>toast_order_guid`: each 100-order chunk reads the house's `pos_order_*` events through `idx_events_restaurant_type` and filters in the database. Fine at a restaurant's volume; archived events stay waiting (the PR's debt entry says so). PostgREST itself was not run.

Residuals:

1. **Persistent write failures still starve newer rows** (same class as the round 8 finding, narrower cause). 1,000 hub rows whose stock write keeps failing, then 1 fresh row: three saves in a row each `failed: 500`, the fresh row never applied. This is stated in the PR's debt entry ("500 lines whose stock write keeps failing still take a save's whole budget"), so it is disclosed, not hidden. The realistic trigger is an item that cannot cover a glass pour (`record_glass_pour` raises when the item holds less than the pour); then a fresh row of the same item would fail the same way, so the harm is the repeated "save again" message rather than a lost sale.
2. **Same shape for rows that keep asking the narrower question.** 1,000 sales of an item mapped as glass with no pour size: every save reports `still_waiting 500, truncated true`, forever, and "save the mapping again" cannot help. These rows spend the line budget.
3. **Void arriving after the mapping but before the replay reaches the row creates phantom stock.** 501 Toast orders waiting, save, 500 replayed, one waiting; the till then voids the waiting order. The live door books `toast_void_` (+1 bottle) for a sale that was never taken, then the next save clears the sale row without stock. Net +1 bottle (-488 expected, -487 measured). Pre-existing (before #840 the sale row never replayed at all) and the same family as #805's two-keys-one-sale return; #840 does not close it. A fix would have the live void check for a still-queued sale of that order and clear it instead of returning stock.
4. **#805 double-void phantom stock: NOT FIXED here.** #805 is still open and not in this stack (`return_glass_pour` does not exist on main). #840 does not touch voids beyond clearing voided rows.
5. **Overshoot and cost, minor.** A check with several lines spends `targets.length` slots, so one save can exceed 500 lines by up to (lines per check - 1). The queue is read whole into memory per save (pages of 500, no ceiling): 100,000 stuck rows is 200 sequential page reads inside one request. Not measured against a real database.
6. Claim guard weakness: `POS-2-REPLAY-REACHES-EVERY-ROW` caught 7 of 8 mutations I applied (ids per read 500, unchunked `pos_checks`, renamed Toast key, cursor removed, page stop removed, unchunked events; "budget never decremented" is not claimed). It does not catch the Toast call being turned into `if (false) await this.replayToastDoorRows(`, because it greps for `await this.replayToastDoorRows(`. A plain deletion of the call is caught.

## #841 docs: claims checked against code

Verified true against `5d3a861ff`:
- Toast-door rows replayed under `toast_sale_{order}_{menuGuid}`, item id only, a missing sale unit read as a bottle (`replayToastDoorRows`, `glass = m.sale_unit === "glass"`); voided order cleared with no stock; dated by `toast_closed_at`; no readable close stays queued (specs and my D2 probe).
- Rows read in pages of 500 keyed on `id` until a short page; ids read 100 at a time (`pos_checks`, Toast `events`; also the Toast `inventory_transactions` key list, which the ADR does not mention).
- The new debt text ("an order whose events were archived stays waiting", "500 lines whose stock write keeps failing still take a save's whole budget") matches the code and my A2 probe.
- `POS-2-REPLAY-REACHES-EVERY-ROW` verify exits 0 on the 841 head; `check_stock_wrappers_check_ownership.py` passes with the new `replayToastDoorRows` entry; the ADR-0141 claim text matches that entry.

Overstated, one place: ADR 0011 call 6 says "a row that cannot replay (no stored check, a question still open) costs a read and never a slot". True for a row with no stored check. False for a row whose mapping is saved but still lacks a pour size: `replayOneCheck` returns `targets.length`, so those rows spend the budget (probe A3: 1,000 such rows, every save `still_waiting 500, truncated true`). The sentence should say "a question the mapping does not answer" or drop the parenthesis.

Also unstated: the replay of a Toast bottle sale does not report its own race (the double "applied" count above).

## Not done

- PostgREST and a real HTTP stack were not run (URL length checked by arithmetic and the mock's 16,000-character refusal; real `.in()` on `payload->>...` not exercised).
- Production size and lock time of the #839 rewrite not measured.
- #783 was applied on top of #839 for the view rounding only; its own correctness was not audited.
- Real concurrency (two connections) not run; races were two interleaved saves on the in-memory fake.
