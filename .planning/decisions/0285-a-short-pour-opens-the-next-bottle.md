# 0285 — A short pour finishes the open bottle and opens the next, from any lot

- **Status:** Locked for the ruling, and Proposed for the method. The ruling is the founder's: AskUserQuestion, 2026-10-04 ~00:15Z, verbatim pick *"Finish it, open next (Recommended)"*. The option text read: *"Take the remainder and pour the rest from a newly opened bottle, even one in another lot, as a bartender does. Stock matches the shelf, and it fits ADR 0115 A6 (stock in ml)."* The method below (the total-ml draw, location tiers, multi-bottle pours, the 0 ml refusal and the unchanged short-item refusal) is lane glasspour's proposal, built for his review.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** record_glass_pour, glass pour, by-the-glass, open bottle, open_bottle_ml, stranded lot, remainder, inventory_lots, FIFO, cross-lot draw, pour_events, inventory_transactions, stock_live, cover, velocity, AW08, A-001, A-012, 22023, 23514, Tuzlu Rüzgar
- **Links:** migration `a_short_pour_opens_the_next_bottle` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/fix-a-short-pour-opens-the-next-bottle.jsonl:1`; `tech-debt.d/2026-10-04-fix-a-short-pour-opens-the-next-bottle.md`; [[0011-pos-sale-volume-contract]] (1b corrected in place); [[0115-the-house-item-is-the-ledgers-key]] as amended by the drinks lock on PR #589 (A6, R6, R7, R19, R26, M1, D3); the lane brief `p4-scratch/sim-run/fixes/briefs/glasspour.md` and the repair `p4-scratch/sim-run/fixes/repair/glasspour-tuzlu-stranded-pours.sql` (both outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found the cellar total at 1,250 bottles (A-012). It found Yakut on /inventory at 159 bottles with 80 days of cover and no reorder (A-001), where the app's own inputs give about 31. Çankaya read 110 against about 30. AW08 traced both to one function. Every cite below is at `8c673db4b`.

`record_glass_pour` has had exactly one definition, the baseline's: `supabase/migrations/20260805000000_baseline_from_production.sql:1132`. It picks one lot per glass, preferring the lot holding an open bottle (`:1156-1165`). It opens a new bottle only from that same lot (`:1170-1173`). When that lot has no sealed bottle and less than one pour, it raises "insufficient stock for a full pour" (`:1175`), even though other lots of the item hold sealed bottles. Nothing clears the remainder. `apply_stock_movement` draws only lots with `qty > 0` (`20260912163000_a_stock_write_names_its_house.sql:239`). `sync_lots_from_inventory` (`baseline:1750`) has no trigger anywhere in `supabase/migrations`. The gateway logs the failure and moves on (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:880-883`). It writes no pour row, no ledger row and no consumption row, so the bottles stay in `stock_live`. That column is what the cellar total sums (`apps/api-gateway/src/dashboard/dashboard.service.ts:544-547`). They also stay in the lots and the `inventory_analytics` view (`baseline:3332`), which /inventory's cover and velocity read. The dashboard arithmetic is right; the book it adds up is wrong.

A PGlite build of all 284 migrations at `8c673db4b` reproduces it. With lots of 0 sealed + 25 ml and 3 sealed, a 150 ml pour raised, the next four raised too, and stock stayed at 3. The same probe found two more defects in the function. A 1000 ml pour from 750 ml bottles failed on `inventory_lots_open_bottle_ml_check` (23514); ADR 0011 had said it "does not raise", which is corrected in place. A manual pour of −150 ml **added** 150 ml (open 300 → 450).

## Options considered

1. **Finish the open bottle and open the next, from any lot (chosen, the founder's pick).** Stock follows the shelf, the remainder is used, and no lot can strand an item. It changes which lot a pour draws from when lots differ, which matters only for per-lot cost and history. Those carry no `lot_id` today (ADR 0115 R6 adds it).
2. **Skip the remainder, or write it off as waste.** It never strands, but it books ml that were poured into a glass as lost, so the ledger stops matching the shelf by up to one pour per bottle. It would also need a waste-row shape the drinks program has not designed.
3. **Combine only within one lot (today's behaviour).** This is the defect. One short lot blocks every later glass sale of the item.
4. **Do nothing.** Every house that receives the same item more than once strands it eventually, and the cellar total, cover and reorder drift upward without bound.

## Decision

A glass sale finishes open bottles and then opens sealed ones, oldest lot first, across every live lot of the item. The method, proposed for review:

- **A total-ml draw.** The call's need is `p_pours × pour_ml`. It takes `LEAST(open, need)` from each open bottle, oldest lot first. Then each lot with sealed bottles opens `n = LEAST(qty, ceil(need / bottle_ml))` bottles, and the leftover becomes that lot's open bottle. This gives the same result as pouring glass by glass, in O(lots) statements instead of O(pours).
- **Location tiers kept.** With `p_location_id`, the lots at that location (open, then sealed) come before every other lot. Without the fix, that location's stranded lot was the one that raised.
- **Multi-bottle pours.** A pour larger than a bottle opens as many bottles as it needs. ADR 0011 1b still has the POS hub queue such a line. The manual route can send one, and Toast can only when an item's `pour_size_ml` exceeds its `bottle_size_ml`, a data error, because it passes `p_pour_ml` null (`apps/api-gateway/src/toast/toast.service.ts:672-675`).
- **Refusals.** A pour of 0 ml or less, and a bottle size of 0 ml or less, are refused with 22023. A missing pour count is refused with 22004, as the old FOR loop already did. The 750 ml and 150 ml fallbacks stay (ADR 0115 R7's interim).
- **Drained lots stay.** A lot drained to 0 sealed and 0 ml is kept with its status unchanged, consistent with R6. The depleted status is M1's.
- **Fork 1: the whole item is short.** When the item holds less than the call needs, the function raises and nothing moves, as before. The founder's ADR 0115 R26 ("Take to zero, name the gap") replaces this in D3. Its variance row and feed shape are D3's to design, so this ADR does not pre-empt them.
- **Unchanged.** The signature, the jsonb keys, SECURITY INVOKER, privileges, the error texts and the idempotency early return all stay. So do the single `sale` ledger row of `−bottles_opened` (before and after over all live lots, written only when a bottle opened) and the `pour_events` row.

What carried it: the founder's ruling settles *whether* to cross lots. The method keeps everything a caller can see except the refusal itself, so no gateway or web code changes.

## Relations

- **ADR 0115 (drinks lock, PR #589, unmerged).** R19 lists "the last ml below one measure" among D3's four ledger fixes. The founder's 2026-10-04 pick ships that item now. When #589 merges, its D3 row should mark R19's item as shipped by this ADR. `lot_id`, the decomposition record and per-lot idempotency keys stay with D3. There is no table-shape change here.
- **ADR 0011.** 1b is unchanged, and its "does not raise" sentence is corrected in place. B19 (glass voids return whole bottles, OD-67) is untouched.
- **Lane postime** (`fix/pos-sales-dated-at-sale-time`, ADR 0281, local commit `589b3bc4d`, not pushed) redefines this function. Its migration `a_pos_sale_is_dated_by_its_check` drops the 8-argument form and creates a 9-argument one (`p_occurred_at`) from the **baseline** body. Measured on PGlite with both files in the tree, 2026-10-04: with postime's version sorting first, this migration halts on its closing assertion (*found 2*); with postime's sorting after (it would be renumbered at merge if this lane merged first), the build succeeds and the function silently loses the cross-lot draw. Only the claims row catches that order, and it does fail. So whichever lane merges second rebuilds on the other's body: postime keeps this draw and the guards under its `p_occurred_at`, or this lane becomes the 9-argument form and updates its identity assertion and T11.

## Consequences

- **Easier.** New pours stop stranding. A remainder that is already stranded clears itself at the item's next pour, because the open ml is taken first. The cellar total, cover, velocity and reorder track pours again, with no dashboard or /inventory code change.
- **Not repaired by this.** Pours already lost (Tuzlu's ~752 Jul-Aug lines, per the walk; not re-measured, since the lane had no production access) are not put back by this migration. Two paths can put them back. One is the repair. The other is any re-import or redelivery of an old closed check, which is not controlled. The POS hub re-runs a closed check's stock effects on every upsert (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:538`). A line that failed left no `pour_events` row for its key, so once this migration is live, a re-sent old check pours that line. The pour is dated now(), not the check's `closed_at`, and that inflates the 30-day velocity the cover reads. So no Jul-Aug re-import should run before fork 2 is answered. The repair is written, unrun, at `p4-scratch/sim-run/fixes/repair/glasspour-tuzlu-stranded-pours.sql`. It has a read-only dry run (§1) and an apply block that ends in ROLLBACK (§2), and it backdates the replayed ledger and pour rows to each check's `closed_at`. It was exercised only on a synthetic house in PGlite. **Fork 2, the founder's:** run it, re-import Jul-Aug through the gateway instead, or leave the past as it is. The recommendation is the SQL replay, after this migration is live (and after postime, if that lands a date parameter).
- **Harder.** The per-lot pour history now spans lots within one call, and nothing records which lots one call drew from. That record is R19's, in D3.
- **Revisit when** ADR 0115 D3 lands (R26, named variance, `lot_id`), or when postime adds a date parameter to this function.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | Aldemir | Ruled: *"Finish it, open next (Recommended)"* |
| 2026-10-04 | Claude (lane glasspour) | Built the method above. SQL test T1-T12 on PGlite (all migrations): T1-T5 and T12 fail without the migration and pass with it; the rest pass on both. The migration re-applies cleanly |
| 2026-10-04 | Claude (lane glasspour, verification pass) | Re-ran the SQL test on PGlite (285 migrations): all pass, twice around a re-apply; on the control build T1-T5 and T12 fail. Re-ran the claim's three mutations (each fails it). Measured the collision with lane postime's migration in both orders and recorded it under Relations |
| 2026-10-04 | Claude (lane glasspour, last call) | Narrowed "stay lost until a production repair runs" under Consequences, from the verifier's finding: a re-sent closed check also replays a failed line, dated now(). Re-ran the SQL test (fixed and control) and the guards at the new head |
