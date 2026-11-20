# Round 10 - PR re-test: #837, #838, #828 (context #816, #815)

Heads tested: #838 ce0d3f780 (stack: #816 850b45571 -> #837 193a4f3b6 -> #838), #828 315648ce9 (on #812 a3b168e79), #815 15f28c8d7 (context).
Method: `git worktree add --detach` at /private/tmp/claude-501/qa-wt-r10 (838 tip) and qa-wt-r10b (828/815), node_modules symlinked, both removed afterwards. Shared checkout: only `git fetch` of `pull/N/head` into temporary refs/qa/r10-*, deleted. No checkout, merge, push or comment.
Probes: `round10-probes-cost/` (`r10-cost-probe.spec.ts`, `r10-results-838tip.json`, `claims_mut.py`, `r10-taxsaid-fuzz.spec.ts`, `taxsaid-*.json`).
How the cost probes run: the real `DeliveryStockService` (`finaliseAtVerified`, `repairPrintedCost`) over `makeMockDb`, with `finalise_delivery_cost` and `apply_stock_movement` executed as the REAL plpgsql lifted from `supabase/migrations/20260906233000_...` and `20260912163000_...` inside PGlite. Fidelity limit: fixture tables, superuser, no RLS, no PostgREST (the mock ignores `.eq()` filters, so tenant scope in TS was tested by answering the tenant read with null, not by a real filter).

## Answer to the key question

**The per-bottle blocker is NOT fully closed.** After #837 and #838, the filed case (264 per case, pack 12) books 22 on a first verify (#816), an unmapped unit (`kutu`, `ml`, `pcs`) is refused (#837), a printed total that contradicts the price is refused (#837), and a lot already booked at 264 is corrected by a re-verify (#838). Routes still open, each reproduced or read in code:
1. **Accepted proposal still posts its raw number** with provenance `manual` and no unit (`delivery-stock.service.ts:867-896`). Neither PR touches it. On a re-verify it is also neither repaired nor flagged (T4 `accepted_proposal_264`: lot stays 264, no message).
2. **A bottle-uom row carrying a case price with no `line_total` still books 264.** The total cross-check only fires when a total is printed (`lot-unit-cost.ts:151-155`, silently skipped when `line_total` or `qty_bottles` is null, zero or negative: T6 `qty_bottles_missing`, `total_zero`, credit-note rows).
3. **Existing wrong lots are corrected only if someone POSTs `/procurement/deliveries/:id/verify` again, delivery by delivery.** No web button does it (the verify gate is offered only for AGREED; `CanonicalDocumentPage.tsx:559`), no backfill, no flag on lots nobody re-verifies. A lot is silently skipped, uncorrected and unflagged, when its invoice line was edited, remapped, detached or deleted since (T3).
4. **Nobody is ever told.** The web discards the verify response (`CanonicalDocumentPage.tsx:287` `await fn()`; the only `costNote` in `apps/web/src` is the type at `services/api/deliveries.ts:240`). Every refusal sentence and the repair note exist only in the API JSON.

## #837 - refuse an unmapped unit and a contradicting line total as a lot cost: PARTIAL

Test fails without the fix: **yes.** Sources restored to #816 (850b45571), PR specs kept: 8 failed / 126 passed across the four touched suites, 5 of them #837's (stock D1, stock QA 9a total, lot-unit-cost, extractor x2). With the PR: `src/procurement/canonical` + extractor spec, 18 suites, 339 tests pass; `tsc --noEmit -p tsconfig.spec.json` clean apart from the known `@simplewebauthn/server`. Claim `AUDIT-816-D1-UNMAPPED-UNIT-AND-TOTAL-REFUSED` exits 0 and 5 of 5 mutations of it exit 1 (tolerance, inverted unit test, helper no longer given `printed`, extractor stops keeping the glyph, dead total check). The static claim only proves wiring; the behaviour is the specs.

Where: extractor keeps the glyph `document-extractor.service.ts:371,373` (persisted: `document-intake.service.ts` line insert writes `printed`); refusal `lot-unit-cost.ts:79-84`; total check `lot-unit-cost.ts:151-157`; `agreedPrices` passes `line_total`, `printed`, `qty_bottles` (`delivery-stock.service.ts` ~815-830).

Executed (T5/T6/T7, `finaliseAtVerified` over PGlite-booked stock; cost = what reaches `finalise_delivery_cost`):

| Case | Result |
|---|---|
| `2 kutu @ 264`, pack 12, stored each, total 528 | refused, nothing posted, lot stays provisional |
| same, no total | refused (the glyph, not the total, does the work) |
| `ml` each | refused |
| `KUTU ` upper case / trailing space | refused |
| `adet` | maps to each, posts 22 |
| **`pcs`** each, 24 @ 22 | **refused** (false refusal, see below) |
| uom `bottle`, printed.uom `kutu` | posts 264 (guard fires only for `each`; the extractor cannot produce this shape, a model-supplied `printed.uom` could) |
| price base `magnum` unmapped | refused ("prices per \"magnum\""); with a mapped `price_base_uom` present, 22 |
| printed.uom empty string / array / number | ignored, posts 22 |
| `__proto__`, `constructor` as the unit | kept as an inert string in the null-prototype `printed`, no pollution; JSON round trip `{"uom":"kutu"}` |
| 24 bottles @ 264, total 528 (the QA 9a shape) | refused ("totals 528 for 24 counted, but 264.0000 each makes 6336") |
| 24 @ 22 total 528 / 528.01 / 528.05 / 528.06 / 527.94 / 533.29 | posts 22 (tolerance is max(0.05, 1% of total), so 1c and 5c pass) |
| total 522.72 / 522.71 (just over 1%) | refused |
| 1 @ 22 with total 22.06 | posts 22 |
| 264 x 24 vs total 6300 / 6272 | 264 / refused (1% of a big total is 63; a 0.6% gap passes) |
| case 142/12 total 142; case of 7 at 100 total 100; 1 per 3 total 1 | 11.83 / 14.29 / 0.33 (rounding drift passes, as disclosed) |
| KDV: price excl, total incl 18 % (24 @ 22, total 622.04) | **refused** (mixed bases) |
| KDV: price incl 25.96 and total incl 623.04 | posts 25.96 (the tax-inclusive price is the cost; unchanged) |
| KDV: price incl, total excl | refused |
| free goods inside `qty_bottles` (26 counted, total for 24) | refused (disclosed) |
| allowance 5 % (total net of allowance) / deposit added to total | refused / refused |
| case line where `qty_bottles` slipped to `qty` (2) with total 528 | refused (false refusal if the extractor ever mis-converts) |
| credit note, negative price | `no_price` |
| credit note filed as `invoice`, negative qty and negative total, positive price | **posts 22: the check needs total > 0 and qty > 0, so it is skipped** |
| `qty_bottles` null or 0, or `line_total` 0 or a "528,00" string, with a wildly wrong total | check skipped, posts the price |

Does the refusal reach the user? It reaches the API response only. First verify: `delivery.service.ts:992-1004` builds `costNote` = "No cost was posted: 1 item(s) stay provisional. The invoice prices this item, but not per bottle: the invoice prints its unit as \"kutu\", which this house does not count in, so what one bottle costs is not known. The lot stays provisional." It names no item. The web throws the response away (above), so no screen shows it. A person's way out (correct the line's unit to bottle or case) is not in the sentence, and a person-corrected `each` line keeps `printed.uom = kutu` and stays refused with a now-wrong reason (T3 `person_corrects_kutu_to_each_but_printed_stays` and the `kutu_no_total` shape).

Findings that survive:
1. **False refusal of ordinary units.** `normalizeUom` maps `adet`, `unit`, `ea`, `koli`, `ks`, `kasa` but not `pcs`, `pc`, `piece`, `stk`, `St.`, `btl.`, `bt.`, `bottle(s)`, `bouteille`, `botella`, `fles`, `fl.`, `bottiglia` (T12). Before #837 those lines cost at the printed per-bottle price; now the lot stays provisional with a sentence no screen shows. Safe direction (nothing wrong is booked) but a real availability regression for any such invoice. `carton`, `box`, `ctn`, `palet`, `ml`, `cl` are correctly refused. Same cause for the KDV mixed-basis refusal.
2. **The total cross-check is skipped on credit-note-shaped rows and on null/zero counts**, so those shapes still book the raw price.
3. **Guard only fires for stored `each`.** A bottle-uom row with a model-supplied unmapped glyph is not caught (low reach).
4. Lines entered or corrected by a person carry no glyph (disclosed).
5. Tolerance admits any gap up to 1 % of the total.

Verdict **#837: PARTIAL.** The two routes it targets (unmapped unit stored as each; total contradicting the price) are closed for extractor-read lines, with a test that fails without the fix. Not a regression of correctness (no probe produced a worse number than #816); finding 1 is a conservative availability regression.

## #838 - a re-verify corrects a lot finalised at the printed price: PARTIAL

Test fails without the fix: **yes.** `delivery-stock.service.ts` / `delivery.service.ts` restored to #837 with the PR specs kept: the three #838 tests fail (re-verify revalues 264 to 22; line now refuses keeps cost and returns reason; `verify()` reports the repair). With the PR all pass. Claim `QA-R9A-2-REVERIFY-REPAIRS-PRINTED-COST` exits 0; 4 of 4 mutations exit 1 (repair not called, final-state guard dropped, printed-price guard dropped, proposal price allowed).

Where: `delivery.service.ts:911-925` (re-verify branch calls the repair); `delivery-stock.service.ts:458-497` (`repairPrintedCost`), guards at `:482-483`, `:490`; `lot-unit-cost.ts` returns the rounded printed price so a booked cost can be recognised.

Executed against the real RPC (T1-T4, T10, T11):

| Case | Result |
|---|---|
| lot at 264 final, line 264/case pack 12 | repaired to 22, one `inventory_lot_revaluations` row 264 -> 22, reason names the printed 264 |
| **re-verify twice more** | idempotent: 0 repairs, 0 RPC calls, 0 new revaluation rows (the second pass finds 22, which is not a printed price) |
| 5 of 24 poured, then repair | remaining 19 revalued to 22; revaluation row `qty_at_revaluation` 19 |
| **consumed lots: are past margins rewritten?** | **No.** The sale ledger row is byte-identical before and after (`inventory_transactions` unit_cost null on the sale, 25 on the door purchase; no cost snapshot is stored on a sale). Poured bottles are deleted lots (FIFO), so they are gone and unrestated, by design (`20260902150000_lot_cost_truth.sql:294-300`). Only the bottles still on hand change. Anything computed live from current lot cost (WAC, `margin-advice`, dashboard) shifts from now on |
| fully sold out | no lots left, nothing repaired, nothing flagged (silent) |
| two lots of one item, 15 of 24 poured | one lot left (9), revalued to 22 |
| line since edited: price 270/case | **lot stays 264, silent** (264 is no longer a printed price of the item) |
| line since edited to bottle @ 22 | **lot stays 264, silent** (the person fixed the paper, the lot is still wrong) |
| line remapped to another item / detached / deleted | lot stays 264, silent |
| qty edited only (3 cases) | repaired to 22 |
| line now refuses (pack unknown, or unmapped unit) | lot keeps 264, flagged: "its lot was finalised at the printed price 264, which is not known to be a cost per bottle: ... It keeps that cost until someone revalues it." |
| hand revaluation to 30 (manual) | untouched |
| **hand revaluation that equals the printed 264** | **overwritten to 22 / invoice** (disclosed fork 1) |
| provisional lot (cost post failed earlier), at 25 or at 264 | **skipped, stays provisional forever**: a retry of a failed post lands in this branch (`verified_at` already set), which the PR does not retry. Pre-existing but the error text still says "safe to retry" |
| accepted proposal at 264 | lot stays 264, no repair, no flag |
| multi-item: A at 264, B hand-set 40 | A repaired to 22, B untouched |
| bottle-priced item at 22 | no-op |
| tenant: other house calls the repair for this delivery | 404 "Delivery not found", lot untouched (`deliveryFor` filters by restaurant) |
| RPC with a foreign house's item on this delivery id, or my item with a wrong delivery id | `lots_matched 0`, nothing written. The RPC takes no restaurant argument; it is safe because it is keyed on (delivery_id, inventory_id) and the TS passes only ids read through tenant-filtered queries |

Findings that survive:
1. **No trigger and no backfill.** Only an API call to an already-VERIFIED delivery repairs; the web never makes one. The tech-debt entry says a one-off correction needs the founder's word. Until then every wrong lot in production stays wrong. This is the main reason the verdict is not FIXED.
2. **Silent skip when the invoice line changed since booking** (T3): neither repaired nor flagged. The recognition rule is "booked cost equals a printed price of the item now", so an edit that moves the printed price hides the error.
3. **The correction message does not reach a person** and names the item by UUID ("Item aaaaaaaa-...: ..."), not by name.
4. **The idempotent re-verify is now a write path** reachable by any signed-in member: `deliveries.controller.ts:57` is `JwtAuthGuard` only, and the route description (`:42`, `:275`) still says "idempotent / writes NO cost". The first verify had the same gate, so authority is not widened, but a repeat call can now revalue stock cost. Each change is a revaluation row with the caller's id.
5. Failed-post retry leaves provisional lots provisional (above; pre-existing).

Verdict **#838: PARTIAL.** It does what it says for the one recognisable shape (a final lot whose cost equals an unedited printed price), is idempotent and does not touch past sales, but it repairs nothing unless someone re-verifies by API, and it is silent on the shapes above.

## #828 - tax_said says what was done to each line's own tax: FIXED

Test fails without the fix: **yes.** Spec at #828 with `landed-cost.ts` swapped to #812 (a3b168e79): 3 failed / 21 passed (the PR's own 3). With the PR: 24/24; stacked #815 15f28c8d7: 27/27.

No money moved: 6000 randomised papers (three houses, 1-3 lines, rates null/0/8/18/20/118/-5, bases null/incl/excl, non-stock, allowance, zero accepted, negative, charges, discounts up to larger than stock, header tax) produce **byte-identical** `cost_value`, `landed_value`, `tax_taken_out`, `tax_in_cost`, `cost_tax_basis` at #812 and #828. Only the sentence changed.

Sentence oracle (derives each claim from the returned line facts): at #828, no violations of: taken-out amount equals the sum of `tax_taken_out`; in-cost amount equals the sum of `tax_in_cost`; taken-out only for a reclaiming house, in-cost only for a non-reclaiming one; a taken-out/in-cost amount always said; "N lines could not be costed" equals the unresolved count; "Nothing carries tax" never beside a printed header tax or a costed stock line with a non-zero rate; "Cost is before tax" never with an unstamped line. At #812 the same oracle found 3669 "Nothing ... carries tax" beside unresolved lines, 1629 beside a header tax, 60 unsaid taken-out amounts, 125 unsaid in-cost amounts, 53 wrong "Cost is before tax". Targeted cases at both heads (`taxsaid-targeted-*.json`) match the PR body: reclaiming house, 120 with 20 % inside plus freight 10 now says "Tax of ... taken out of cost" plus the share-only sentence instead of "costed as printed"; credit note and big-discount papers now say the tax "could not be treated"; header tax 18 on a non-stock line says it prints tax no costed line carries.

Residuals (wording only, no number affected; `landed-cost.ts:702-734`):
1. "Nothing on this paper carries tax." still appears when the only line is unresolved and its rate is null or 0 with no header tax (231 of 6000 draws). With a null rate that is "not printed", not "none".
2. A reclaiming house with a printed header tax 18 and only rate-0 stock lines says "Cost is before tax" and drops the header tax; a non-reclaiming house gets the "prints tax ... none of its costed lines carries it" sentence. The same paper reads differently by house (#815's header check covers the stacked case).
3. Still unwired (`git grep` finds no importer of `landed-cost` outside specs), so no lot cost changes.

Verdict **#828: FIXED** for the two false sentences it names; wording residuals above.

## Context: #816 and #815

Unchanged from round 9 and re-run: #816 sources are inside the #838 stack (all 339 canonical + extractor tests pass); #815 27/27 on #828. Round 9 verdicts stand (#816 PARTIAL, #815 FIXED for its own claim). #837 and #838 close the round 9 items (1) bottle row with total, and half of (3) no repair of existing lots; item (2) accepted proposal is untouched.

## Verdicts

| PR | Verdict | Fails without the fix | Per-bottle blocker |
|---|---|---|---|
| #837 | PARTIAL | yes, 5 of 8 reverted-suite failures are #837's; claim 5/5 mutations caught | closes unmapped-unit and total-contradiction routes for extractor lines; false refusals for pcs/btl./bottle(s); skip on null/zero/negative counts |
| #838 | PARTIAL | yes, 3 tests; claim 4/4 mutations caught | repairs unedited wrong lots on an API re-verify; no trigger, no backfill, silent on edited lines and proposals |
| #828 | FIXED | yes, 3 of 24; money identical over 6000 papers | not applicable (tax wording) |

**Per-bottle blocker: not fully closed.** Open: accepted-proposal raw price; bottle-uom case price with no total; every lot nobody re-verifies; lots whose line was edited; refusal and repair text that no screen shows.

## Not done
- No Postgres/PostgREST: RPC behaviour ran in PGlite on fixture tables (superuser, no RLS); the mock ignores `.eq()` filters, so TS tenant filtering was read in code (`deliveryFor`, `agreedPrices`), not executed.
- Production not queried; the count of lots at a printed price is unmeasured.
- Web not run in the browser pane: "the UI discards the response" is from reading `CanonicalDocumentPage.tsx:283-294,556-560` and a grep of `apps/web/src`/`apps/mobile` for `costNote`.
- Extractor probed through `normalize()` with synthetic model JSON, not a real vendor paper or model call.
- Concurrent re-verifies were reasoned (RPC takes `FOR UPDATE` on the item and is idempotent), not raced.
