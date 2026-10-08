TITLE: fix(orders): print each order in its own currency, never one sum across currencies (PROCURE-01)

> **Coordinator note, 2026-10-08 00:42Z — new head `0643e76696ace9e3f06a8c314416562c961e2968`.** The independent verifier (verdict: should; no wrong behaviour, no false claim found) raised four shoulds; each is answered below.
> 1. *origin/main not an ancestor.* Answered by merging origin/main `62f8967b4` into the branch (merge `0643e7669`, no conflicts). Still 15 files against origin/main.
> 2. *Three surfaces print "currency not read" in the interim.* Answered in words, not code: the 15-file cap leaves no room. A new **Merge note** section below states the interim regression and recommends shipping the follow-up with this PR or right after it.
> 3. */dashboard sibling missing from the sibling list.* Answered: added under "Sibling defects" below. The cited lines were re-read at this head.
> 4. *The DRAFT-RAIL open row checked only for a comma; AGREEMENT-SHEET was shape-only too.* Answered in commit `a9d8fe663`, which makes each row check what its claim says. DRAFT-RAIL now needs four things: `currency` inside `getActiveConversations`' `procurement_orders!inner(...)` select, the `currency: row.procurement_orders?.currency` mapping, the `ActiveConversationDto` field, and every DraftRail `fmtMoney` call ending in `<name>.currency`. AGREEMENT-SHEET now needs `, currencyToRecord` on every `fmtMoney` call and `currency: currencyToRecord` in `agreementTotal`, and its claim text is narrowed to match. Evidence: both exit 1 at this head. On a scratch copy with the full fix both exit 0. Dropping any one of the four DRAFT-RAIL parts exits 1, and so does passing `null`. AGREEMENT-SHEET exits 1 with `null` or without the agreementTotal currency.
>
> Re-measured at this head: orders/next vitest 12 files, 223/223. Web tsc shows 1 error, the known `@simplewebauthn` one in `passkeys.ts`. `check_decision_claims.sh`: 952 checked, 952 holding. `lanecheck.sh wt-fix-ordersccy` exits 0, files=15, ownership []. Nits (LedgerRow regex nesting, baseline not lowered, " · " separator ambiguity, all-unpriced "0") are not addressed here.

**Branch:** `fix/orders-print-their-own-currency`, cut from origin/main `ca3582988`.
- Two commits; 15 files changed against main. [2026-10-08: now three commits plus a merge of origin/main `62f8967b4`; still 15 files.]
- origin/main is now `a323cc80b`. That commit touches none of these files. [2026-10-08: superseded; origin/main `62f8967b4` is merged in.]
- Local only: not pushed, not audited.

## Why

PROCURE-01 is a P0 from the 2026-10-07 scenario walk, and the refuter confirmed it.

/orders printed every amount as US dollars. `format.ts` used an en-US `Intl.NumberFormat` pinned to USD, and `price-unit.ts` built its money strings with a literal `$`:
- A 1,200 EUR order read "$1,200.00".
- The month figure and the bulk-approve total added lira, euros and dollars into one "$" sum. That sum is true of nothing.

The gateway already sends each order's currency (`mapOrderRow` → `OrderResponseDto.currency`). The web `Order` type never declared it, and `toRow` dropped it.

**No new ADR.** ADR 0117 rule 3 (`.planning/decisions/0117-…md:1521`) already rules this: *"Nothing converts. There is no exchange rate anywhere in this system. A reader that would compare or sum figures in different currencies refuses in words instead."* ADR 0104 says the same for documents (`0104-…md:367`). So this PR groups per currency and converts nothing; it makes no new choice.

## What changed

**Web `services/api/types.ts`:** `Order.currency?: string | null` is declared, mirroring `OrderResponseDto.currency`.

**`orders/next/useOrdersNextData.ts`**
- `toRow` reads the currency in three states:
  - an ISO code;
  - `null`, when the order names none → "currency not recorded";
  - absent, when the route never sent the key → "currency not read".
- A value that is not a three-letter code is read as naming none. It is never defaulted to USD.
- `OrderRowVM.currency` carries the value, and the row's `agreementTotal` working receives it.
- `MonthFigure.thisMonth` and `lastMonth` become `MoneyLine[] | null`, one line per currency. The cross-currency `s + (r.total ?? 0)` is gone.
- The month figure is built by a new exported pure function, `monthFigure(rows, now)`. Unpriced orders are still counted, not zeroed, and cancelled orders are still excluded.

**`orders/next/format.ts`**
- `fmtMoney` and `fmtMoneyWhole` print through `lib/currency.ts` `formatMoney`, in the currency's own decimal places (yen has none).
- A null currency prints "N (currency not recorded)". An omitted currency prints "N (currency not read)".
- New helpers:
  - `sumByCurrency` groups amounts per currency, skipping unknown amounts and keeping all three states apart.
  - `moneyLineKey` gives each currency line a stable key.
  - `fmtMoneyLines` joins the lines with " · ", never "+".

**`orders/next/price-unit.ts`:** `describeStatedPrice`, the `agreementTotal` working and `describeFees` take the order's currency. Every `$${x.toFixed(2)}` is gone.

**`orders/next/LedgerRow.tsx`:** all eight money calls pass `row.currency`:
- the row total;
- the agreement total;
- the price in the "no working" sentence;
- the listed total;
- the Hold-to-approve label;
- the stated price;
- the fees (two calls).

**`orders/next/OrdersNext.tsx`:** the month figure is one `Tally` per currency line.
- Each Tally is keyed by its currency, so it never animates one currency into another.
- When there are two or more currencies, the lines are smaller and a caption reads "N currencies — each its own total, not added together".
- Last month prints line by line.
- An empty month prints "0". An unread month prints "—".

**`orders/next/BulkApproveBar.tsx`:** the selection's worth is printed one line per currency, e.g. "€1,500.00 · TRY 1,200.00 known · 1 unpriced". When nothing selected has a price, it says "no price known", never "$0.00".

**Tests**
- `LedgerUnit.test.tsx` gains 9 cases:
  - three-state read;
  - lira row with no "$" and no "currency not" anywhere, its agreement-total span and hold aria-label pinned to TRY;
  - yen in its own decimals;
  - null → "not recorded";
  - absent → "not read";
  - listed-vs-computed disagreement in TRY;
  - `monthFigure` grouping (EUR/TRY/null this month, GBP last month, unpriced counted, cancelled excluded);
  - bulk bar with mixed currencies;
  - bulk bar with nothing priced.
- The existing fixtures now state `EUR`, not `USD`, so a "$" anywhere in these rows is the defect. Stating USD would also have tripped `check_money_states_its_currency.py`.
- `OrdersNext.deep-link.test.tsx` gains 3 render cases: two currencies with the caption, one currency at full size, and the empty and unread months.
- `AgreementUnit` / `AgreementFees` pass a currency to the pure helpers and assert TRY, EUR, null and omitted.
- The `receipt` and `row-click` fixtures move to the new `MonthFigure` shape.

**Records:** `claims.d/fix-orders-print-their-own-currency.jsonl` adds 7 resolved rows and 3 open rows.

## Evidence (worktree `wt-fix-ordersccy`, HEAD `4e9efc8aa` [2026-10-08: re-measured at `0643e7669`, see the coordinator note])

**Web vitest, touched directory.** `cd apps/web && npx vitest run src/pages/orders/next` gives 12 files and 223 tests, all passing. The baseline at `ca3582988` was 211; 12 tests were added and none removed.

**Web vitest, full suite.** `npx vitest run` ran before three tests were added, one was strengthened and four doc comments were edited; the touched directory was re-run after all of them (223/223 above). It gave 5340 passed and 1 failed out of 5341, with 3 of 362 files failing. None of the three imports a touched file:
- `Login.signInNote.test.tsx` and `authPages.publicDesign.test.tsx` fail to load because `@simplewebauthn/browser` is missing from the shared node_modules. This is environmental.
- `receiving/next/RcLineHistory.test.tsx` "a highlighted line past the fifth opens its box" failed under full-suite load. It passes alone (19/19). It is a load flake, not this change.

**Web tsc.** `cd apps/web && npx tsc --noEmit | grep -v '^../../packages'` reports one error, `src/services/api/passkeys.ts(14,81)`. This is the same missing `@simplewebauthn/browser` package, in an untouched file.

**Gateway jest and tsc:** not run, because no gateway file is touched.

**Lint.** `npx eslint --quiet --resolve-plugins-relative-to p4-scratch/web-lint <all 14 touched web files>` exits 0.

**Guards**
- `scripts/check_money_states_its_currency.py` → PASS. `format.ts` drops from 2 sites to 0 and `price-unit.ts` from 12 to 0. The baseline rows are **not** lowered (file cap); the claims rows below hold those two files at zero meanwhile.
- `scripts/check_web_reads_gateway_dto_keys.py` → PASS. web `Order` declares 32 keys against `OrderResponseDto`'s 35.

**Lane check.** `lanecheck.sh wt-fix-ordersccy` exits 0:
- all six fast guards rc=0;
- `files=15`;
- `ownership []`.

**Mutations.** 22 in all, each one behaviour, applied as: `cp -p` snapshot, mutate, run, restore, `cmp`. Every one went red and every file was restored byte-identical.

| # | Mutation | Red |
|---|---|---|
| M1 | toRow drops `currency` | 9 tests |
| M2 | null currency read as USD | 3 |
| M3 | omitted currency printed as USD | 4 |
| M4 | `sumByCurrency` one key | 2 |
| M5 | month collapses to one currency | 1 |
| M6 | month renders the first line only | 1 |
| M7 | month line format drops its currency | 2 |
| M8 | last month one sum | 1 |
| M9 | bulk collapses to one currency | 1 |
| M10 | row total drops currency | 1 (after the lira test was strengthened; it first survived) |
| M11 | agreement total drops currency | 1 (likewise) |
| M12 | listed total drops currency | 1 (likewise) |
| M13 | hold label drops currency | 1 (likewise) |
| M14 | row stated price drops currency | 5 |
| M15 | row fees line drops currency | 1 |
| M16 | "no working" price drops currency | 1 |
| M17 | working drops currency | 4 |
| M18 | `describeStatedPrice` drops currency | 2 |
| M19 | `describeFees` drops currency | 1 |
| M20 | multi-currency caption removed | 1 |
| M21 | bulk "no price known" → "0 known" | 1 |
| M22 | empty month printed as unread | 1 (after a test was added; it first survived) |

**Claims rows, run by hand from the worktree root**
- All 7 resolved rows exit 0.
- On a scratch tree, each resolved row exits 1 when any file it reads is replaced by origin/main's copy.
- All 3 open rows exit 1 now, and exit 0 on a scratch copy holding the fixed call shape. [2026-10-08: the DRAFT-RAIL and AGREEMENT-SHEET rows were tightened in `a9d8fe663`; see the coordinator note.]
- No row uses `2>`. A missing file raises Python's "No such file or directory", which the runner counts as cannot-run.
- `scripts/check_decision_claims.sh` was **not** run, as instructed. [2026-10-08: run at `0643e7669`: 952 checked, 952 holding.]

## Merge note (interim regression)

If this PR merges alone, three /orders surfaces change from "$2,100.00" (correct for US houses) to "2,100.00 (currency not read)":
- ResponsesSheet (`ResponsesSheet.tsx:356,399,544`), including the "Hold to confirm" label shown during approval. In that same sheet, the working built by `toRow` already prints in the order's currency.
- AgreementSheet (`AgreementSheet.tsx:266,732`), next to the `currencyToRecord` it already holds.
- DraftRail (`DraftRail.tsx:748`).

None of them prints a wrong currency; each says it did not read one. The follow-up (the three open claims rows) should ship with this PR or right after it.

## Not done, or not verified

**AgreementSheet (owed).** Its preview total and working still call the formatters without a currency. They print "2,100.00 (currency not read)", never "$". Open claim `PROCURE-01-AGREEMENT-SHEET-OWES-ITS-CURRENCY`. The fix is to pass `currencyToRecord` to `fmtMoney` and `agreementTotal`. It was left out because of the 15-file cap.

**ResponsesSheet (owed).** The agreed price, "Hold to confirm" label and total print "currency not read", never "$". Open claim `PROCURE-01-RESPONSES-SHEET-OWES-ITS-CURRENCY`. The fix is three `row.currency` arguments.

**DraftRail (owed, needs the gateway).** The card prints "currency not read". The fix needs three parts:
- `getActiveConversations` (`procurement.service.ts` ~10068) must select `procurement_orders.currency`;
- the web `ActiveConversationDto` must carry it;
- `DraftRail.tsx:748` must pass it.

Open claim `PROCURE-01-DRAFT-RAIL-OWES-ITS-CURRENCY`.

**No tech-debt.d note.** The 15-file cap left no room. The three open claims rows and this section are the record of what is owed.

**Money baseline rows not lowered.** In `scripts/money_currency_baseline.json`, `format.ts` 2 → 0 and `price-unit.ts` 12 → 0 are not lowered (file cap). The guard only fails on increases, so it stays green. Resolved claims rows hold both files at zero until the baseline is lowered.

**Sibling defects, out of scope**
- The gateway `agreed-price.ts` builds `$` money strings (lines ~211, 287, 354, 370-371, 607-610, 815).
- receiving's `rc-format.ts:96` `fmtMoneyWholeCcy` falls back to USD.
- /dashboard prints the same Order's `totalCost` and `finalPrice` through `dashboard/next/format.ts` `money()` / `approveLabel()`, which call `lib/utils.ts:16` `formatMoney`, which hard-codes `$` and en-US. Sites: `WaitingOnYou.tsx:132,145,156` (156 is the Hold-to-approve label) and `DayDetail.tsx:327-328`. The new `Order.currency` makes this a small follow-up.

**Locale.** Figures use the viewer's locale via `formatMoney`. Under the test runtime's en-US default, TRY prints "TRY 1,200.00"; a tr-TR browser would print "₺1.200,00". The locale-specific output was not checked in a browser.

**No browser-pane check.** The page was not looked at in the browser pane; the evidence is unit and render tests only. No production reads or writes were made.

**Not audited.** An ADR 0090 audit is owed before merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
