# Round 5 PR re-test (2026-11-07)

Read-only on the shared checkout. Tests ran in detached worktrees (`/private/tmp/claude-501/qa-wt-785`, `-787`, `-784`) at the PR head SHAs, node_modules symlinked, all removed afterwards. Heads tested: 784 `f0b71e75c`, 785 `79adc622d`, 786 `8c2660b34`, 787 `69658cf01`. Base `origin/main` `c93d6115c` for all four.

| PR | Verdict | One line |
|---|---|---|
| 785 Turkish dotless i | **PARTIAL** | The named defect is fixed in the wine library normaliser, but rows already stored keep the old hash, and two other normalisers still split. |
| 787 repeat verify claims once | **PARTIAL** | A sequential repeat is now a no-op, and two racing verifies cannot open two claims. The race still writes duplicate events and price history, and a correction can leave a stale claim. |
| 784 ADR 0359 (docs) | **FIXED** | The claims check out against code, the ledger and the plans. Two minor nits. |
| 786 latency measurements (docs) | **FIXED** (code cites verified; numbers not re-measured) | All code citations in the new text hold. The measurements need Docker + PostgREST, which is not available here. |

Counts: FIXED 2, PARTIAL 2, NOT FIXED 0, REGRESSION 0.

---

## #785 PARTIAL

Round-1 B-1 was `Kavaklıdere` vs `KAVAKLIDERE` producing different signatures (`wines/wine-signature.ts:139`, `wine_normalize_text`).

**What works (run, not read).**
- `jest src/wines`: 117 passed with the fix. With `wine-signature.ts` reverted to `origin/main`: 7 failed, so the TS spec does fail without the fix.
- `scripts/test_synth_identity.py`: 17 passed with the fix. With `identity.py` reverted: `test_normalize_folds_turkish_dotless_i_like_sql` fails, so that test does fail without the fix.
- A probe through `normalizeSignatureText`:
  - NFC and NFD forms of `Kavaklıdere` both give `kavaklidere`.
  - `İstanbul` (precomposed) gives `istanbul`. So does `i`+U+0307, and `İSTANBUL`.
  - `ŞÇĞÖÜ` and `şçğöü` give `scgou`, in both NFC and NFD.
  - `ıİiI` gives `iiii`.
  - `toLocaleUpperCase("tr")` of both `kavaklıdere` and `kavaklidere` normalises to `kavaklidere`.
  - The producer+name+vintage hash is equal for `Kavaklıdere`/`Öküzgözü` and `KAVAKLIDERE`/`ÖKÜZGÖZÜ`.
- The SQL half, checked by diffing against `20260813060000_expand_trade_abbreviations.sql`: the diacritic class is byte-identical, all 13 abbreviation patterns are identical, and the only change is `translate(..., 'ı', 'i')` placed after the strip and before `lower()`. No expression index or generated column uses `wine_normalize_text`, so redefining it does not strand an index. The migration version `20270311100000` is unique.
- **Not run:** the SQL function itself. There is no psql, postgres or PGlite in this environment, so the PR's "run in PGlite" claim is taken on trust. The static diff is clean.

**Why PARTIAL.**
1. **Existing rows are not backfilled (the migration/backfill you asked about).**
   - `master_wine_library.signature_hash`, `normalized_*`, the submissions, `restaurant_wine_roster.signature_hash` and `menu_changes.wine_signature_hash` all keep the old key for any wine with an `ı`.
   - After deploy, a new `KAVAKLIDERE` invoice line or a fresh `Kavaklıdere` menu insert hashes with the new rule and misses the already-stored `kavakl dere` row. The fix therefore creates a new split against old data until someone runs `fn_repair_signature_hashes` and merges the collisions.
   - The PR discloses this in `.planning/tech-debt.d/2026-11-07-fix-wine-name-folds-turkish-i.md` and says the count was not measured. It is honest, but B-1 is not closed for the existing library.
2. **Two other normalisers still have the gap** (both disclosed in that tech-debt file):
   - `vendor-intel/wine-identity.ts:49` `normalizeIdentityText`. It feeds `hashWineIdentity`, `identity-join`, `lwin-file` and `beverage-identity`.
   - SQL `beverage_normalize_text` (`20260817070000_beverages_table.sql:25`).
   - The same Turkish wine still keys apart in vendor comparison and in the beverages identity.
3. **Same class still open:** ß, ø, ł, đ, æ, œ. The probe shows `Weißburgunder` giving `wei burgunder` and `Łódź` giving `odz`. Also unfolded: fullwidth forms and the Roman numeral Ⅰ, which give an empty string. Pre-existing and disclosed.

## #787 PARTIAL

Round-1 H-1 was a repeat `POST /procurement/orders/:id/verify-receipt` doubling the credit claim and the price history.

**What works.**
- `jest verify-receipt.spec.ts` plus `shelf-received`: 93 passed with the fix. With `procurement.service.ts` and `shelf-received.ts` reverted to `origin/main`, 2 of the 67 verify-receipt tests fail:
  - `a second identical verification opens no second claim and writes nothing else`
  - `if the earlier verification could not be read back, nothing is changed`
  - So the spec does fail without the fix.
- Sequential double-submit (retry or second tab): `repeatsTheLatestVerification` (`shelf-received.ts`, new) proves a repeat. It writes 0 events, 0 claims, 0 price-history rows, 0 order updates and 0 RPCs.
- A different count, price or note is not a repeat. A then B then A writes again, because the latest event is B, which is correct.
- A whitespace-padded `rejectedReason`, or the price as 40.0 instead of 40, still counts as a repeat.
- `uq_pc_order_match_reason` is correctly scoped. The only other order-level writer is `never_arrived`, which is excluded and has its own index. `state` has a `written_off` value in the baseline CHECK constraint.

**Why PARTIAL (all reproduced with a throwaway spec built on the PR's own `makeDb`, deleted afterwards).**
1. **A concurrent verify is only half covered.**
   - Two `Promise.all` verifies on a never-verified order both pass the guard. `match_verified_at` is null, so the guard is skipped. Result: 2 `reconciled` events, 2 price-history rows, 2 order updates and 2 credit-insert attempts.
   - In production only the credit insert is stopped, by the new unique index (its 23505 is swallowed). The `reconciled` insert sets no `idempotency_key`, though `uq_pre_idempotency` exists. The price-history row is not deduplicated either, so both stay duplicated.
   - The PR's text says the index covers "two submits racing". That is true for the claim and not for the other two rows.
2. **A correction leaves a stale claim.**
   - Verify 8 accepted / 2 rejected (claim $80), then correct to 7/3. The code attempts a second `damaged` claim for $120, the index rejects it, and the claim stays at $80.
   - A downward correction would leave an overstated claim. Before the PR you got two claims; now you get one that may be wrong.
   - No code updates or withdraws the earlier open claim. This is arguably out of scope, but H-1's "claimed amount" concern is only solved for the identical-repeat case.
3. **A currency change is swallowed as a repeat.** Same counts and price with `invoiceCurrency` USD changed to TRY wrote 0 events and 0 updates. The guard never compares currency.
4. **Existing duplicates:** the migration is wrapped, so if production already holds duplicate open order-level claims the index is skipped with only a WARNING. Nothing cleans them, and the PR does not say how to find them.
5. **A cancelled order can still be verified.** H-1 also named "a cancelled order". There is no status guard in `verifyReceipt`; I grepped lines 6196 to 6600 and found none. Not addressed, and not claimed as addressed.
6. **Race window in the guard itself:** it is read-then-write with no lock.

No regression found. The retry-after-timeout case that H-1 described is fixed.

## #784 FIXED (docs, ADR 0359)

Checked against code and sources:
- `margin-to-target.ts:12` is the formula (`margin = (price - cost) / price`) and `:142` is the computation.
- `margin-advice.service.ts:253-257` actually brackets `resolveUnitCost` (253) and `menu_price_current` at `:257`, so the cite is loose by a few lines.
- `git grep -w tax_basis` on `origin/main` finds nothing, as claimed.
- `OPEN-DECISIONS.md:329/330` are OD-242 and OD-243.
- ADRs 0016, 0020, 0193, 0287, 0298 exist on main. 0359 is free on main and on every ref except this branch. 0341 and 0295 are correctly absent from main.
- The base is 47 commits behind main (`git rev-list` confirms 47), and `fc7097b1d` exists locally.
- The ledger S218 lines 2885-2888 carry F1 to F3 with exactly the quoted labels.
- `proposal.md` line 152 is lane 3.4. `proposal-receipt.md` Decision 12 reads "A: write it as Proposed from the memory note".
- The F11 sentence appears verbatim in the PR #589 diff, and #589 and #615 are both OPEN.
- The worked example is correct: 1200 gross at 20% gives 1000 net, so margin is 66.7% gross and 60% net.
- Claims: `scripts/check_decision_claims.sh` on the branch reports 1068 checked, 1068 holding. I also ran the six new rows: the two `resolved` ones return 0, and the four `open` ones return 1, as required.

Nits (not blocking):
- The README row for 0359 is absent. It is disclosed as its own PR.
- C1 to C7 are the session's own calls under the /goal delegation. The ADR flags this clearly and stays Proposed, which is consistent with CLAUDE.md §0.1.
- The IAS 2 citation and the 10%/20% rates are admitted as not fetched.

## #786 FIXED (docs, measurements)

Verified against `origin/main`:
- `goals.service.ts` is under `analytics/`. `:1202` is `getPosRevenueWindow` and `:1070` is `readWholeWindow`.
- The route does `Promise.all([hasPosHistory, readHouseZone])` and then `computeMetricWithSeries("pos_revenue", …)`, so it reads no consumption. This confirms the corrected claim.
- `DEAD_STOCK_WINDOW_DAYS = 90`, `getInventoryScience` `sinceDays = 90`, `getRiskProfile` `loadConsumption(…, 90)`, and `getMenuEngineering`/`getSeasonality` default to 90. Five lenses at 90 days, as stated.
- `idx_consumption_restaurant (restaurant_id, recorded_at DESC)` is the only index, as stated.
- 299 migrations at `c93d6115c`, as stated.

Not re-checked: the timings and `EXPLAIN` figures (850 ms, 724 ms, 1,033 ms, the 3,056 discarded rows). These need Docker, PostgREST and a 21k-row seed, and `docker` is not installed here. They are labelled local and synthetic with production unread, which is the honest scope.

Nit: the pre-existing text still cites `recommendations.service.ts:319` for the `Promise.allSettled`. On main it is at `:329`. The PR did not touch that cite, but it is a measurement pass that could have re-pointed it.

Also: the `getFinancialSummary` lens loads 365 days of delivered orders alongside the 90-day consumption. The 5-lens timing covers the consumption windows only, and the PR says so.
