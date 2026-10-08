TITLE: fix(receiving): print each credit in its own currency, never summed across currencies (PROCURE-03)

> **Coordinator note, 2026-10-08 00:42Z.** New head `450c127c7310b009afd270be84af0bf46a467bb3`, with origin/main `62f8967b4` merged in (clean, no conflicts). 10 files against main. The independent verifier's two shoulds at `f38a208f5`, and how each was answered:
>
> 1. **The draft card's headline amount (`RcCreditDrafts.tsx:93`) had no test of its own.** `fmtMoney(draft.claimed_amount, null)` there survived the suite, because the draft test matched "TRY 250.00" anywhere and the folded line and the hold label carry it too. The draft test in `ReceivingNext.test.tsx` now reads the element beside each "Drafted by the house · unsent" stamp and expects exactly `TRY 250.00` and `88.50 (currency not recorded)`. Re-run on a scratch copy, that mutation fails the test (1 failed). The file was restored and `git diff --quiet` confirmed it.
> 2. **/receiving still prints `$` in one place, and nothing said so.** The manager queue prints the match engine's sentence verbatim (`RcManagerQueue.tsx:430`, `:498`, from `discrepancy_notes` via `receiving.service.ts:1319`), and `invoice-match.ts:296` writes money there as `$n`. This is gateway code outside this web-only lane. It is now filed in this branch's tech-debt fragment and cross-referenced to `2026-10-01-fix-review-communications.md:22` item 2, which has the same root. It is also listed under Not done below. The title is narrowed from "never summed or in dollars" to "never summed across currencies". The first commit's subject still says "or in dollars", because commits are not amended.
>
> Evidence at the new head:
> - `npx vitest run src/pages/receiving`: 9 files, 156 tests, all pass. The count includes the tests the merge brought from main.
> - Web tsc: only the known `passkeys.ts(14,81)` `@simplewebauthn/browser` error.
> - `check_decision_claims.sh`: 946 checked, 946 holding.
> - Money guard: PASS.
> - `lanecheck.sh`: every check rc 0, files=10, ownership rc 0.
>
> The verifier's 6 nits were not acted on, apart from the stale lines bracket-corrected below. Those nits are the RcArrivalAsks sibling format, a malformed-code caption, a duplicate JSDoc, two prose gaps on the older-gateway and "Nothing yet" paths, and the flake evidence.

**Branch** `fix/receiving-prints-its-own-currency`, from origin/main `ca3582988`. Two commits (`87b014d70`, `f38a208f5`), 10 files changed against main. It merges cleanly onto origin/main `a323cc80b` and shares no file with it. [corrected 2026-10-08: now four commits plus a merge of origin/main `62f8967b4`, head `450c127c7`; still 10 files.] Local only: not pushed, not audited.

## Why

Scenario walk 2026-10-07, finding PROCURE-03. /receiving printed vendor-credit money in US dollars whatever the house's currency, and added currencies together:

- `rc-format.ts`'s money formatters were two `Intl` instances pinned to USD. `fmtMoneyWholeCcy` also fell back to USD for an order with no currency.
- The owner ledger printed the combined figures from `/procurement/credits/stats` (recovered, still owed, promised, refused), which add every claim together whatever its currency. A house with €90 and ₺250 recovered saw "≥$340".
- The "this month / last month" trend summed the settled list across currencies the same way.
- Every credit draft printed its claimed amount as `$`.

The rule is already the product's, so this branch takes no new decision and creates no ADR:
- `formatMoney` in `apps/web/src/lib/currency.ts` never falls back to USD.
- The founder's batch 63 (2026-09-06): the house states its currency, and nothing is converted.
- ADR 0117 Q25.
- The rebuilt /receipts credits lane (`ReceiptsCredits.tsx`) already reads `byCurrency`.

## What changes (web only)

- **`rc-format.ts`**
  - Every money formatter takes the money's own currency.
  - A missing or unreadable code (blank, or the gateway's `UNRECORDED` key) prints the number followed by "(currency not recorded)", using lib/currency's `CURRENCY_NOT_RECORDED`.
  - A code `Intl` cannot format prints beside the number.
  - The currency's own minor units are used (yen 0, dinar 3).
  - `fmtMoneyWholeFloor`'s currency argument is now required.
- **`useReceivingNextData.ts`**
  - `useOwnerRecovery` returns `trendByCurrency` (from `trendByCurrencyOf`, keyed by the claim's currency, with `UNRECORDED` for none) in place of the summed `creditedThisMonth`/`creditedLastMonth`.
  - A month in which a settled claim has no readable credited amount is null (a dash), not a sum that counted that claim as zero.
  - `recoveryGroups` makes one group per currency in either read.
- **`RcOwnerLedger.tsx`**
  - One block per currency from the stats payload's `byCurrency` (served since #476, `a605dabdc`). Each block has its own headline, trend, still owed / promised / refused, and open-claims hint.
  - With more than one currency, each block is captioned "Claims in EUR — kept apart, nothing is converted".
  - An empty ledger says "Nothing yet".
  - A gateway older than `byCurrency` gets its combined figures once, under a caption saying the currency was not stated and the figures may mix currencies. No symbol is borrowed.
- **`RcCreditDrafts.tsx`**: each draft's amount, at all three places it appears (including the hold-to-send label), prints in the draft's own currency.
- **`RcManagerQueue.tsx`** is not edited, but its queue rows and at-risk totals for an order with no currency now read "N (currency not recorded)" instead of `$N`, through `fmtMoneyWholeCcy`.
- **`scripts/money_currency_baseline.json`**: the `rc-format.ts` row (2 sites) is removed, and the guard passes with it gone.
- **Claims**: 4 static rows in `.planning/decisions/claims.d/fix-receiving-prints-its-own-currency.jsonl`, all python-only and `resolved`.
- **Debt**: `.planning/tech-debt.d/2026-10-07-fix-receiving-prints-its-own-currency.md`.

`DoorNext.tsx` and `receiving.service.ts` are not touched (open PR #612 owns them). [corrected 2026-10-08: #612 is now merged; neither file is touched.]

## Evidence

- **vitest, `npx vitest run src/pages/receiving`** (from `apps/web`): 9 files, 148 tests, all pass. [corrected 2026-10-08: 156 at `450c127c7`, after the merge.]
  - New: `rc-format.test.ts` (10 tests), plus 8 page tests in "PROCURE-03 — money on /receiving is in its own currency, never summed across them" in `ReceivingNext.test.tsx`.
  - Existing expectations moved from `$` to the fixture's currency.
- **Mutations**: 10 against `src/pages/receiving/next` (8 files, 143 tests). Every one was killed, and every file was restored and confirmed with `cmp` and `git diff --quiet`.

  | Mutation | Failed |
  |---|---|
  | Missing currency → USD | 6 |
  | Combined figures despite `byCurrency` | 9 |
  | Trend keyed to one currency | 2 |
  | Draft label without currency | 1 |
  | Ledger headline without currency | 3 |
  | Unreadable amount counted as 0 | 2 |
  | Two decimals for every currency | 1 |
  | "Nothing yet" dropped | 1 |
  | Older-gateway caption dropped | 1 |
  | `UNRECORDED` read as a code | 2 |

- **Claims**: each of the 4 rows was run by hand with `bash -c "$verify"` and exits 0 on the branch. Each exits 1 against origin/main's versions of the same files (`git archive origin/main …`). Each also exits 1 against 11 targeted mutations on scratch copies. `scripts/_claims_parse.py` parses the register with the new fragment (rc 0).
- **Money guard**, `python3 scripts/check_money_states_its_currency.py`: PASS.
- **Web tsc**, `npx tsc --noEmit | grep -v '^../../packages'`: one error, `src/services/api/passkeys.ts(14,81)`, which cannot find `@simplewebauthn/browser`. It is in a file this branch does not touch, and the module is missing from the shared `node_modules`. Nothing else.
- **eslint** on the 7 touched web files: 0 errors. The 3 `react-hooks/exhaustive-deps` warnings in `useReceivingNextData.ts` are already on main (main's copy gives 4).
- **`lanecheck.sh wt-fix-receivingccy`**: migration order, migration versions, OD ids, conflict markers, citation pairing and ADR numbers all rc 0. files=10, ownership rc 0.

## Not done

- **PROCURE-09, the /receiving half.** The trend's months are the viewing browser's, not the house's. No house time-zone helper exists on main (the dashboard's `houseDateOf` is local to its page). This is filed in the tech-debt fragment. The other pages in PROCURE-09 are outside this branch.
- **`procurement_credits.currency DEFAULT 'USD' NOT NULL`.** A claim on an order with no currency is still stored as USD, so it prints `$` and is filed under USD. That needs a database and gateway fix (already filed at `tech-debt.d/2026-10-01-fix-review-communications.md:23`, item 3). It is cross-referenced in this branch's fragment.
- **The manager queue's match-engine sentence still prints `$`.** `invoice-match.ts:296` formats money as `$n`, and the text reaches /receiving verbatim through `discrepancy_notes` (`receiving.service.ts:1319`, `RcManagerQueue.tsx:430`, `:498`). This is gateway code, outside this lane. It is filed in this branch's fragment and cross-referenced to `tech-debt.d/2026-10-01-fix-review-communications.md:22`, item 2.
- **The owner ledger's floor marker** still ignores the stats payload's `capped` flag (filed).
- **Not run:**
  - `scripts/check_decision_claims.sh`: the coordinator runs it alone. The rows were run by hand instead.
  - The gateway was not touched, so no jest.
  - No browser or visual check of the rendered page was done. The evidence is the jsdom tests only.
- **One test flake:** `RcLineHistory.test.tsx` ("Wine 6") failed once under parallel load earlier in the session and passed alone (19/19) and in every later run. It is not related to this change. [corrected 2026-10-08: the verifier saw it fail alone twice under heavy load on the branch and also on an origin/main copy, so the evidence that it is unrelated is that it reproduces on main.]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
