# Round 8: adversarial re-test of PRs #803, #804, #805, #806

Base `origin/main` 259feea3f. Method: `gh pr diff`, detached worktrees under `/private/tmp/claude-501/qa-wt-*` (removed), and a throwaway Supabase Postgres 17 container with all migrations applied (removed). No checkout, merge, push or comment in the shared checkout. Probe files are in `round8-tests/`.

Compared against `round5-receiving-pos-dash.md` (POS-1, POS-2, POS-9) and `round2-inventory-recipes.md` (U-1).

| PR | Round finding | Verdict |
|---|---|---|
| #803 wines ids in chunks of 100 | R2 U-1, ids URL overflow at ~420 | FIXED |
| #804 replay on mapping save | R5 POS-2, queue never replayed | PARTIAL |
| #805 glass void returns the pour | R5 POS-9, glass void returns a bottle | PARTIAL |
| #806 reply wiring for catalog approve and sale-unit | follows #804 | FIXED (inherits #804's limits) |

Not addressed by any of the four: R5 POS-1 (Toast, Square and Clover adapters never set `voided`). `pos-adapters.ts:98` is unchanged on every branch. Open PR #798 is the one aimed at it. Verdict on POS-1 here: NOT FIXED by this set.

## #803 FIXED

- Web: `apps/web/src/services/api/wines.ts:53-84`, `WINE_IDS_PER_REQUEST = 100`, de-duplicated, sequential, any failed chunk rejects the whole read.
- Gateway: `wines.service.ts:497-506` refuses more than `WINE_IDS_MAX` (dto `wines.dto.ts:38`) with 400 before reading. The controller keeps the status (`wines.controller.ts:52`).
- Boundary probes, from the PR's own specs and my reading:
  - 0 ids: no request.
  - exactly 100: one read.
  - 101 at the gateway: 400, zero reads.
  - 500 ids on the client: 5 requests, each under 4,000 characters.
  - an id named twice is asked once.
- Single caller path: `useWinesByIds` (`useInventoryNextData.ts:606`, `useInventoryPage.ts:142`), so every consumer is chunked. No mobile or other caller of `ids=`.
- Fails without the fix: web `wines.byIds.test.ts` 3 of 4 fail on main's `wines.ts`; gateway `wines-search.spec.ts` 1 of 16 fails on main's `wines.service.ts`. With the fix: 103 gateway wines tests and 4 web tests pass.
- Residual (not blocking): 5,000 wines means 50 sequential requests with no concurrency. A third-party caller sending duplicate ids is counted with duplicates at the gateway. No throttler on `/wines`.

## #804 PARTIAL

What works (probed, `round8-tests/pr804-806-replay.qa.spec.ts`):
- Replay twice (sequential, and two saves racing via `Promise.all`): stock moves once (bottles 12 to 9 for 3 sold; second save reports "had already come off stock").
- Replay after the till re-sends the check: no second movement.
- Voided check: cleared with no stock.
- Zero or negative quantity lines never queue, so replay ignores them.
- Two houses, same item id and name: house B's queue and stock are untouched.
- Item deleted before mapping: `upsertItemMapping` throws "does not belong to this restaurant" (mapping not saved, queue stays open), clean.
- Fails without the fix: all 9 of the PR's replay specs fail on main's `pos-hub.service.ts`.

What does not work:

1. **5,000 waiting sales: one save is a 500-line, ~1,500-query request and the check lookup can overflow the URL.** `REPLAY_LINE_LIMIT = 500` (`pos-hub.service.ts` replay block, around the `.limit(REPLAY_LINE_LIMIT)` reads). One save with 5,000 queued checks: 500 applied, 500 stock RPCs, 1,506 table reads, run serially in one HTTP request. Draining takes 10 saves. Against an in-memory mock this took 0.28 s; against a real database it is thousands of sequential round trips (estimate 30 to 80 s, unmeasured), which is a gateway-timeout risk. The read `pos_checks ... .in("external_check_id", checkIds)` puts up to 500 ids in the URL: 16,997 encoded characters with 29-character ids, over the 16 KB limit that caused R2 U-1, and Toast and Clover ids are uuids. On overflow the code takes the `checksError` branch, counts every line as `failed`, and the same oldest 500 are selected next time, so it never progresses. This is the U-1 failure class again, by arithmetic (the mock does not enforce URL limits). Fix: chunk the `.in()` to 100, as #803 does, and cap or background a save.
2. **Starvation by unreplayable rows.** Rows are read oldest first, 500 per lookup. 500 older rows that cannot be replayed (Toast-door rows, or checks with no stored `pos_checks` row) hide every newer replayable row. Probe: 500 Toast-door rows plus 2 hub sales for the same item id: `still_waiting: 500`, `truncated: true`, 2 hub sales never replayed, and the message says "save again", which cannot help.
3. **Toast door is not healed.** `toast.service.ts:569-579` queues `source: "toast"` rows whose `raw` is the Toast line with no `is_wine`. The replay deliberately skips them (comment in `replayUnresolvedLinesOrThrow`). Probe: one Toast-door row, map the item: `still_waiting: 1`, stock unchanged. So for a Toast house, which runs on the Toast door, R5 POS-2 is still true. The message blames "needs a pour size, or the check could not be found", which is wrong for this case.
4. Shared with the live path, not new: replay and live keys are `pos:{source}:{check}:{item}:{lineNo}`. A re-send that shifts line positions (a line inserted before the wine) books a second time: stock 10 to 8 in my probe after a replay. Same exposure exists for any live re-send.
5. Untested against real PostgREST: `ilike` with `escapeLikePattern` does not escape `*`, which PostgREST treats as `%`. An item name containing `*` could pull in other names' rows, which would then stay queued with a misleading count.

## #805 PARTIAL

What works (SQL run on a real Postgres 17 with the whole migration corpus applied; the PR's own `supabase/tests/20270307121700_..._test.sql` passes V1 to V9 and rolls back):
- 2 glasses (300 ml) voided returns 300 ml and re-seals the bottle the sale opened. Void of a 6-glass, two-bottle sale re-seals both. Sale across two bottles returns every ml.
- Half pour: 3 x 75 ml sold, void returns 225 ml, lots back to `2+0`.
- Void after the bottle it opened was finished by later pours: 150 ml comes back as open ml (`1+150`, total 900 ml), no error, ml correct.
- Other house or null house: SQLSTATE 42501, nothing moves. Void key equal to the sale key: 22023. Same void key twice: idempotent.
- Void quantity above the sale (5 voided, 2 sold): capped at the sale's 2 glasses.
- Toast door passes `p_restaurant_id` and the sale key `toast_sale_{order}_{menuGuid}`, which matches the key the Toast sale writes to `pour_events`.
- Fails without the fix: 3 jest tests fail on main's `pos-hub.service.ts` and `toast.service.ts`. The SQL test fails 42883 without the migration. 395 pos-hub plus toast tests pass on a merge of #805 and #806 (they merge cleanly).

What does not work:

1. **Two different void keys for one sale return the sale twice.** `return_glass_pour` caps by the sale's `pours` but never subtracts earlier voids of the same `p_sale_key`. Probe: sell 2 glasses from a 1,500 ml item (stock 1,200 ml), void with key `s2:a:void`, void again with key `s2:a:void-line2`: both return 300 ml, stock 1,800 ml, 300 ml more than the item ever held. A second key arises when a re-sent void shifts line position (hub key includes `lineNo`), same shape as #804 finding 4. The old bottle path had the same exposure, so this is not a regression, but the PR's "never more than the sale poured" holds per call only.
2. **The void is chosen by today's sale unit, not by how the sale was booked.** `pos-hub.service.ts` void branch: `else if (resolved.mode === "volume")` uses the current mapping.
   - Sale booked as a bottle (`apply_stock_movement`), mapping later changed to glass, then void: `return_glass_pour` answers `{"reason":"no sale pour found","returned_ml":0}` with no error. Probe confirmed stock stays at 750 ml (the sold bottle is not returned). The TS only warns when `overflow_ml > 0`, so the line counts as `booked()` and the import report shows a void that moved nothing. Before this PR such a void returned bottles, so this is a silent under-return.
   - Sale booked as glasses, mapping later changed to bottle, then void: it goes down the bottle branch and returns `qty` whole bottles, the POS-9 bug for that line.
   Verified from the code and the SQL; the TS branch itself was not run against an unmapped-then-remapped item.
3. Minor: when no live lot exists the function returns `no live lot to return to` without error, which the TS also books as a void. Not reproduced (the archived-lot probe violated a CHECK).
4. Refund vs void: a refund is not representable in `CanonicalCheck` (R5 POS-10), so there is no refund path to test; unchanged. The consumption-log row written for the sale (`wine_consumption_log`) is still not reversed by a void, so voided glasses still count as demand. Pre-existing, not claimed by the PR.

## #806 FIXED (inherits #804's limits)

- `catalog-matcher.service.ts` (auto-map `pastSales`, `approveProposal` returns `past_sales`, batch results carry it) and `pos-mapping-review.service.ts` (`setSaleUnit` returns `past_sales`; batch spreads each result). Contains #804 (stacked): `806 = 804 + 1 commit`.
- All 19 pos-hub and toast suites pass (405 tests). The replay spec extended for these paths passes. A replay failure never fails the approval, so the reply says "unavailable" rather than erroring.
- Caveats: nothing in `apps/web` reads `past_sales`, so the person only sees it if a client renders it; a batch approve or batch sale-unit answer runs one replay per row in one request, which compounds #804 finding 1. `approveProposal` reads `saved.past_sales` without optional chaining while `autoMap` uses `saved?.`, harmless today.

## Counts

FIXED 2 (#803, #806), PARTIAL 2 (#804, #805), NOT FIXED 0, REGRESSION 0. Open from the round-5 list and untouched by these four: POS-1 (see #798).
