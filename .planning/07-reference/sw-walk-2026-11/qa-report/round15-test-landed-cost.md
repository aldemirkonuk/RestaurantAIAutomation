# Round 15 - adversarial test of the landed-cost lane (#870 1/3, #871 2/3, #872 3/3; context #815 #816 #837 #838 #844)

Read 2026-11-07. Stack head `97a622748` (#872), #871 `239153406`, #870 `695a8eb36`. Throwaway detached worktrees `/private/tmp/claude-501/qa-wt-r15-1..3` (node_modules symlinked), removed afterwards; the shared checkout was only fetched into. For the sale stamp and recipe cost, worktree 2 was the stack head with #845 (`23d577345`) and #864 (`6dc34721c`) merged locally (clean merges, nothing pushed). Probes and raw outputs: `/Users/aldemirkonuk/Projects/p4-scratch/sw-walk/qa-report/round15-probes-landed/`. SQL ran in PGlite (all migrations of the merged tree) plus a throwaway Postgres 17 container (`r15-pg`, stopped) for the two-session race. Jest at stack head: 20 suites, 354 tests green; `tsc --noEmit` shows only the missing `@simplewebauthn/server` module, unrelated.

## Verdicts

| PR | Verdict | Fails without the code? |
|---|---|---|
| #870 pure module `paper-landed-cost.ts` | **WORKS** for what it claims (value share, F2, free goods, pooling); **PARTIAL** on cent-exact allocation (not claimed, not done) | Yes. The spec cannot load without the module. Mutations of the module turn it red: short-booked line ignored -> 2 red + claim `LANE-1.4-SHORT-UNITS` red; free goods ignored -> 2 red; charges dropped (`landed-cost.ts` charge_share) -> 14 red. |
| #871 wiring in `delivery-stock.service.ts` | **PARTIAL, with the declared narrow REGRESSION confirmed** | Yes. On #870's head with #871's spec overlaid, 5 of 33 fail: (a)+(i), (d), (g), (k), and the unreadable-header test. Header read swallowed (mutation) -> 1 red, no claim red. |
| #872 costNote, edge specs, claims, debt | **PARTIAL.** costNote WORKS; the edge specs are coverage only; one tech-debt claim is FALSE (retry) | Only 1 of 94 fails without it (the costNote test). The edge specs (b)(c)(e)(e2)(f)(g2)(h)(j) all pass against #871's source: they pin behaviour, they do not fail without #872. Mutating costNote to drop the per-invoice sentence -> 1 red + claim `LANE-1.4-SETTLED-PRICE-CARRIES-NO-SHARE` red. |

## Plain answer: does the landed cost reach lot cost, the sale stamp (#845) and recipe cost (#864) consistently?

**No. It reaches all three only for bottles sold after VERIFIED, and only on the invoice-provenance route.** `results-lot-sale-recipe.txt`:

- **Lot: yes.** Door books 12 with no price (A6); `finalise_delivery_cost` at 55.00 sets the 7 remaining bottles to 55.00 `final` / `invoice`. Idempotent: the same 55 again changes nothing and writes no second revaluation row (1 row).
- **Sale stamp: after VERIFIED yes, before no.** A sale of 3 after VERIFIED is stamped `cost_total 165.00` (3 x 55). The 5 bottles sold before VERIFIED are stamped `unit_cost NULL, cost_total NULL, unpriced_qty 5` and stay so: the draws are append-only and nothing restates them. A lot sold out before VERIFIED (L2) matches zero lots (`lots_matched 0`), so the landed cost never lands anywhere and all 6 sales stay unpriced. The door books at no price on purpose (A6), so any bottle poured between delivery and the manager's VERIFIED click is permanently unpriced. Nobody reads the draws yet ("Who reads the draws: nobody yet", migration `20270410100700`), so this is not wrong money today, but it is a hole the lane does not close and does not mention. A glass pour writes no draw at all (round 12, still open).
- **Re-landing after sales:** a corrected landing (L3: refinalise 55 -> 65 after 4 sold) rewrites the 8 remaining to 65 and writes a revaluation row; the 4 sold stay stamped 55. Two costs inside one delivery, with no restatement path. Same shape for `repairPrintedCost`: a lot repaired from a printed 600 to 55 leaves earlier sales stamped 600.
- **Recipe cost: only when the lot is `invoice` provenance.** #864's `resolveUnitCost` reads `inventory_lot_rollup.wac` and trusts it only if `has_invoice_cost`. Landed lots post `invoice`, so the recipe reads 55 (basis `invoice_lot_wac`). A settled (accepted-proposal) price posts `manual`: lot 20.00, rollup `has_invoice_cost false`, so the recipe reads **unknown**, while the lot and the sale stamp carry 20.00 (L5). The wac is also rounded to 2 places by the view.
- **Tax is in none of the three.** `cost_tax_basis` is null and is stored nowhere: it lives only in `FinalisedItem.landed` and the `reason` text of the revaluation row. The lot, the draw and the rollup cannot say whether a cost holds KDV.

## Scenario results (`results-pure-stackhead.txt`, `results-service-stackhead.txt`)

| Scenario | Result |
|---|---|
| Freight 50 + fuel 10 - discount 30 + deposit 24 + tax 80 on goods 1000 | A 61.80, B 41.20; sums to 1030.00 exactly. Deposit named as "not cost"; tax ignored (no basis). |
| Allocation basis | **Value only.** A 10 @ 60 and B 100 @ 4, freight 100: A +60 (6.00 a bottle), B +40 (0.40 a bottle). No count or weight basis exists or is configurable (fork F3, decided). |
| 6 of 12 accepted, damaged (12 @ 50, freight 60) | 55.00 a bottle, 6 lots-bottles carry 330.00 of a 660.00 invoice. The accepted count does not re-spread freight: a single line's cost per bottle is landed value / listed, independent of accepted. The 330 for the other 6 bottles (300 goods + 30 freight) lands nowhere. Fork F2 as decided; there is no link to a credit note or short-pay. Two items, one half-accepted: 945 posted of 1260. 0 accepted: held with a sentence. |
| Largest remainder / cents summing to the charge | **Not implemented.** Shares are floats; the per-bottle cost is rounded to 2 places and the remainder is dropped. Three items 3 @ 10 + freight 1.00: 90.99 posted vs 91.00. 1000 bottles @ 10 + freight 4.90 (10.0049) posts 10.00: **the whole 4.90 freight vanishes**. Worst case is 0.005 x bottles per line. |
| Charge with no items | Freight 50, no lines: nothing posted, item reported with the generic "no agreed price" sentence, no note about the 50. |
| Negative charge (credit) | Freight -20 or other_charges -20: **every item on the paper held provisional** ("negative or not a number"). Safe, but a vendor rebate printed as a negative charge blocks costing for the whole delivery. Negative discount likewise. |
| Discount > goods + charges | Held. Discount = goods + charges: held (free goods never booked at 0). |
| KDV-inclusive vs reclaimable | Not distinguished. 10 @ 72 (20 percent KDV in the price, header subtotal 600, tax 120), freight 60 posts **78.00**, `final`, with the note "costed as printed, ... not stated since the house has not set its tax basis". Honest in words, but a reclaimable-KDV house gets a 20 percent overstated final cost. #815's tax treatment is unreachable from this path (inputs hard-null, `paper-landed-cost.ts:169-171, 276-277`). The header subtotal is never checked against the lines (600 vs 720 passed). |
| Multi-currency | **Currency is never read.** The header select (`delivery-stock.service.ts:838-841`) omits `currency`; a TRY invoice posts its raw number as `unit_cost`; two papers in different currencies pool by raw number. This breaks the house rule in `20260905120000_a_house_names_its_money.sql` (rule 3: a reader that would sum different currencies "refuses in words") and the founder's 2026-09-21 answer that `unit_cost` is "read everywhere as the house's own money". |
| Free goods (12 listed, 1 free @ 60, freight 33) | 57.75, sums to 693.00. Works. |
| Extras (booked 12, listed 10) | 65.00, same cost a bottle, basis says so. Works. |
| Two papers, one item | Pooled by value 67.50 (50 freight on one paper). Works; missing header holds that item. |
| Case price + freight | 2 cases of 12 @ 600, freight 120 -> 55.00. Works. |
| Line allowance / line deposit | 540 + 50 -> 59.00; deposit 20 not cost. Works. |

## Re-verify, correction, concurrency, partly-sold lot, tenant

- **Re-verify after a landed cost posted: idempotent, no double landing.** `repairPrintedCost` skips a lot already at the landed cost; the printed->landed repair posts once (600 -> 55) and the second re-verify posts nothing. Lots verified before this lane at the printed price (60 on a paper that now lands to 65) are **not** re-landed: only lots whose cost is a non-per-bottle printed price are touched. That is declared scope.
- **Declared regression against #838 confirmed, and it is the 12x case.** (`results-repair-838.txt` vs `results-repair-stackhead.txt`.) Case line 24 bottles @ 600 per case, lot final at 600, paper has freight 40 and a second unpriced line. #838 re-verify posts **50.00**; stack head posts nothing and flags: the lot keeps **600 a bottle**. Filed as tech debt, but it leaves a 12x-wrong final cost on a plausible paper, where #838 repaired it.
- **Correction of accepted quantity after landing: nothing re-lands.** `verify()` runs `finaliseAtVerified` once; after `verified_at` is set it calls only `repairPrintedCost`. A later door recount changes no cost (and for a single line the accepted count does not change the per-bottle cost anyway). Two lines 6 @ 50 + 6 @ 70, booked 12 -> 60.00; recounted to 6 -> held ("which line was short is not known").
- **FALSE claim in #872's debt note: "A retry posts the same cent-rounded values ... idempotent".** There is no retry path. A 503 partway (item B fails after A posts) leaves B provisional; the only caller of `finaliseAtVerified` is the first `verify` (`delivery.service.ts:971`), and a second verify goes to the `verified_at` branch, whose `repairPrintedCost` skips every non-final lot (`delivery-stock.service.ts:507`). Probe: first call 503, re-verify posts 0, repaired 0, flagged 0. The error text "this is safe to retry" (`:453`) is the same claim and is pre-existing. The RPC itself is idempotent; nothing calls it again.
- **Concurrent verifies.** TS: two parallel `finaliseAtVerified` post identical args. `verify()`'s state update has no `state = AGREED` guard (`delivery.service.ts` update `.eq("id")` only), so both verifies succeed and the second overwrites `verified_by`/`verified_at`; costs are unaffected. Real Postgres, two sessions (`conc-result.txt`): same cost 65/65 -> one revaluation row, second writer finalises 0; different cost 65 vs 55 -> the second waits on the `FOR UPDATE` row lock, then **overwrites** 65 with 55 (revaluation rows null->65, 65->55). No deadlock, no lost row; last writer wins. `finalise_delivery_cost` has no provenance or manual-revalue guard (loop at migration `20260906233000:327-356`), so a duplicate verify can overwrite a person's manual revaluation. Pre-existing; the lane adds nothing that protects it.
- **Lot partly sold:** the RPC touches `qty > 0` lots only; the sold bottles keep their stamp (above).
- **Tenant scope: holds.** `deliveryFor` filters by restaurant (`:732`), header and line reads filter `restaurant_id` (`:842`, `:862`), `finalise_delivery_cost(H1 delivery, H2 item)` matches 0 lots and writes nothing (L7). Booked items come from the delivery's own ledger, so a foreign `inventory_id` on an invoice line is never posted to (it can still take a share of the paper's charges).

## #872's "what each invoice left out" claims against code

- Deposit totals: left out, named ("Not cost: a deposit of 24.00"). True (probe 1). Line deposits: same (probe 14). True.
- Fee/deposit printed as a **line**: named only when the intake snapshot (`extracted->lines`) tags the line `fee`/`deposit`. An untagged priced line with no item is treated as stock and absorbs a share of the freight (probe 1b: 600 + 24 line -> A gets 48.08 instead of 50). Claim holds only where intake tags kinds; the lane says it does not know whether intake always does.
- Tax sentence: true as far as it goes ("costed as printed, ... not stated"). It does not say the paper's own tax and subtotal disagree with its lines.
- Empty case reads "No deposit on this paper is left out of cost." on every paper without a deposit, which is noise rather than wrong.
- Two static claims survive mutation; two (`LANE-1.4-LANDED-COST-REACHES-THE-LOT`, `LANE-1.4-TAX-BASIS-UNSET`) were not turned red by my mutations (header read swallowed; costNote one branch). The claim text is stronger than what the grep checks.

## Findings worth a ticket (ranked)

1. **Accepted proposals post the raw price: 240 per case of 12 posts 240 a bottle** (`delivery-stock.service.ts:936-942`; probes 5/5b). #844 (which fixes this) is **not in the stack**: `fix/reverify-repairs-printed-cost` carries #816 and a rebased #837 (`193a4f3b6`), not #844 (`ac4fe2589`) nor #837's `d45b547c3`; `gh` reports #837 based on #844's branch while #838 does not. #871 rewrites the exact block #844 edits, so landing #844 after this lane will conflict and one of them wins silently. Still the round 12 D1/D2 defect, 12x on a final cost with provenance `manual`.
2. Declared #838 regression (above): 600 stays on a held paper.
3. False retry claim (above): a partial post leaves lots provisional with no way back except hand revaluation.
4. Currency unread: a foreign-currency invoice becomes a final house-currency cost.
5. Cents: no largest-remainder; freight can vanish on large low-price lines.
6. Sales between delivery and VERIFIED (and a lot sold out first) are unpriced forever; landed cost never restates draws.
7. Freight for rejected/damaged bottles, and the goods paid for but not accepted, land in no lot and no write-off.
8. A freight/other-charge credit holds the whole delivery.

## Not run / limits

PGlite is single-session; the race was run on a minimal schema (tables and the real `finalise_delivery_cost` body) in a throwaway Postgres 17, not the full migration set, and not through the TS service. Real Supabase roles/RLS not exercised. The recipe cost was read by re-implementing `resolveUnitCost` over the real rollup row, because #864's route (#867) does not exist yet. Mocked DB for the service probes; the extractor's real line kinds were not available, so fee/deposit-line behaviour is for unlabelled lines. No production data touched. Foreign-currency and tax outcomes are from the code path as written (inputs hard-null), not from a Turkish paper.
