## Glass pours and voids carry cost only once #809/#805 call stamp_lot_draws — CLOSED — 2026-11-13

Filed by `fix/a-void-gives-back-its-cost` (QA round 20, #919 S4/S4c/S6). Merge #809/#805 after this PR.

**What is true.** `20270520100000_a_void_gives_back_its_cost`: a return naming its sale (`sale_key`) gives the bottles back to the sale's lots as negative draws, so the two net to 0; `stamp_lot_draws` is the helper for writers that move lots themselves. Until #809 and #805 land with the contract below, glass pours and glass voids on main still carry no cost; QA S6 is not fixed on main. Bottle voids carry a `sale_key` only through #805's `return_glass_pour`.

**OWNER CONTRACT.**
- #809 record_glass_pour: in the sealed-bottle loop accumulate `v_draw_lot := v_draw_lot || v_lot.id; v_draw_qty := v_draw_qty || v_n;` when v_n > 0; capture the ledger INSERT's id (`RETURNING id INTO v_txn`) and after it `IF v_bottles_opened > 0 THEN PERFORM public.stamp_lot_draws(v_txn, v_draw_lot, v_draw_qty); END IF;`. A pour from an already-open bottle writes no draw: its cost left when the bottle was opened.
- #805 return_glass_pour, fold path: after the `IF v_folds > 0` INSERT (`RETURNING id INTO v_txn`), `PERFORM public.stamp_lot_draws(v_txn, ARRAY[v_lot.id], ARRAY[-v_folds]);`. Known approximation to state: the folded bottle is returned at v_lot's price, which may not be the lot it was opened from.

**Residuals:** see the PR body.

**What closes it.** #809 and #805 calling `stamp_lot_draws` per the contract, and the POS void passing `sale_key`.

**Closed 2026-11-13** by `fix/a-glass-pour-carries-its-cost` (migration `a_glass_pour_carries_its_cost`) and `fix/a-glass-void-gives-back-its-cost` (migration `a_glass_void_gives_back_its_cost`), stacked on an integration of the cost chain with #809 and #805 rather than written into those PRs. Both halves of the contract are built as written: the pour stamps one draw per lot it opens a sealed bottle from, and the fold stamps `-v_folds` on `v_lot`. Proof: the two paired tests in `supabase/tests/`, and `what_sold_cost_is_its_draws` C8 flipped to cost 40, uncosted 0. Still true: glass rows written before these migrations stay unstamped (`rows_unstamped`, never 0); a folded bottle is costed at the lot it is folded into, not the lot the sale opened (the approximation this contract named).
