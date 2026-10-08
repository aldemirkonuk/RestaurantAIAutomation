# 0269 — /orders reads the whole order book, page by page, and flags an open list it can tell may be short

- **Status:** Proposed
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** F-140, F-117, orders, paging, order book, hasMore, open orders, backorder, partially received, delivered, rate limit, 429, single-flight, fence
- **Links:** [[0255-orders-walk-through-r5-rulings]], [[0256-waiting-on-you-is-flagged-first-then-oldest-by-the-houses-own-rules]], [[0192-received-is-the-shelf-count-from-the-ledger]] (the `received` block); lane 3 (wt-review-11), PR-A of two; claims in `claims.d/fix-orders-paged-fetch-f140.jsonl`

## Context

The /orders page lists only the house's newest 50 orders, and counts only them too.

- `useOrdersNextData.ts:401` reads `useOrders()`. That calls `getOrders` (`services/api/orders.ts:47-59`), which sends no `page` and no `limit`. A body with no `.orders` is returned as it is, cast to `Order[]`; only a missing body (null or undefined) becomes `[]` (`:58`).
- The gateway's `listOrders` then answers its default page: `const limit = query.limit ?? 50` (`procurement.service.ts:3155`).
- It orders by `created_at` alone (`:3207`), counts exactly, and reports `hasMore: fromIndex + orders.length < total` (`:3269`).
- `OrderFilterDto.limit` is `@Max(100)` (`procurement.dto.ts:839`).

A house with 51 orders loses its oldest from the page, its counts and its month figures. The sim's F-140 (and F-117) found this.

Other screens read the same 50-row default. Whether that cuts anything off for what they do was **not measured** here:

- `useCalendarNextData.ts:564`;
- `useProvidersNextData.ts:51`;
- `OneTapActionCenter.tsx:573-574`;
- `InventoryCommandPage.tsx:372,377`;
- `RowExpansion.tsx:89`.

Facts that shaped the design:

- **Two routes, one handler.**
  - `GET /procurement/orders` and `GET /procurement/orders/history` both call `listOrders(user.restaurantId, query)` with the same DTOs (`procurement.controller.ts:162-177`, `:219-234`).
  - The rate guard allows 100 requests per 60 s (`rate-limit.guard.ts:28`). It keys on the client IP and `request.route.path`, not on the method (`:294-295`).
  - So `GET /orders` shares a bucket with `POST /orders` (`controller.ts:123`), which places an order.
- **What a 429 tells the client.** Its body carries `retryAfter` in seconds (`rate-limit.guard.ts:189`). CORS exposes no headers (`main.ts:20-23`), so the body is the only place the client can read the wait.
- **One order event invalidates twice.**
  - A websocket order event invalidates `['orders']` at `lib/websocket.tsx:646` and then dispatches `order_change` at `:650` (`:664`/`:668` for the other event).
  - While a screen using `useOrders` is mounted, its subscription (`useOrderQueries.ts:26-32`) turns that event into a second `['orders']` invalidation.
- **The app's query defaults** are a 5 s staleTime, focus refetch, `refetchOnMount: 'always'` and one retry (`App.tsx:150-161`).
- **`PARTIALLY_RECEIVED` covers three states, not one.**
  - It is written at the door on every door receipt (`procurement/receiving.service.ts:658`).
  - It is also written at the check when `backorderQty > 0 || awaitingInvoice` (`procurement.service.ts:6657-6660`).
  - So it means counted-not-checked, checked-in-full-awaiting-the-invoice, or checked-and-short.
- **`getOrder` uses `.single()`** (`procurement.service.ts:3273-3288`), so an id that does not exist comes back as a 500, not a 404.

## The founder's rulings (option labels quoted; the rest paraphrased)

Asked by the lane coordinator through AskUserQuestion. The labels in quotes are verbatim from the coordinator's record (project memory `founder-answers-2026-10-02-sim-share-out.md`, "Lane forks, answered 2026-10-02 evening" and "F-140 re-asked, 2026-10-03"). The bullets under them paraphrase that record; the four mark texts are quoted from it. This session did not see the exchange itself.

**2026-10-02:**

- **List:** "Open always, older on tap (Recommended)".
  - Every open order is always listed. Closed orders sit behind 'Show older', 50 per tap.
  - Counts and month figures cover the whole book.
  - This build narrows that ruling past 3,000 orders (the ceiling, below). There only the per-status counts (`statusTotals`) cover the whole book. Month figures past the 3,000th order need a gateway aggregate, which is not built.
- **Partly received:** "Open, marked backorder (Recommended)". It counts as open everywhere and is listed with the open orders. **Superseded on 2026-10-03.**
  - The record says the question's premise was wrong: it said `PARTIALLY_RECEIVED` meant short.

**2026-10-03 (re-asked):**

- **Mark:** "Say what's owed (Recommended)". All three states stay open, and the mark reads:
  - 'Backorder: N bottles still owed' only when `verifiedAt` is set and `backorderBottles > 0`;
  - 'Counted, not checked yet' when `verifiedAt` is null;
  - 'Waiting on the invoice' when the order was checked in full;
  - 'Receipt could not be read' when `received.readable` is false.
- **Delivered:** "Open, 'Not counted yet' (Recommended)".
  - An order the vendor reports delivered, but nobody has counted at the door, is listed as open on /orders.
  - Today it is filed closed, and /receiving does not list it either.
- **Scope:** "/orders now, hand off rest (Recommended)".
  - This covers the web and phone /orders only. Everything else gets a written handover (below).

Why the superseded answer could not stand (this session's reading, not in the record): `PARTIALLY_RECEIVED` covers the three states listed under Context, so "marked backorder" would have labelled every door-counted order and every order awaiting its invoice as a backorder.

## Options considered

1. **A per-status reader** (ask the gateway for each open status, and read closed orders lazily). Rejected.
   - Twelve statuses mean at least twelve requests even for a house with ten orders.
   - The counts would then be a sum of twelve reads taken at different moments.
   - A status the client does not know would never be asked for, so its orders would be hidden.
   - It is kept as the *fallback* (the open sweep), the best a client can do past the ceiling or when the read does not hold still. It cannot prove the open set complete: its reads are taken at different moments (see "The known set" under Weaknesses).
2. **A gateway order-book controller** (one request returns the whole book, or open plus counts). Rejected for now.
   - It is PR-6-sized gateway work on a route O4 is changing.
   - Editing `@RateLimit` on these routes collides with O4's #538/#541 stack.
   - The client reader is the part that has to exist either way: it is the reader such a route would be swapped in under.
3. **Cross-tab leader election** (one tab reads, and the others listen over BroadcastChannel). Rejected.
   - Each tab caps itself at 40 of the 100-per-60s bucket instead.
   - Leader hand-off on tab close and sleep is a failure mode of its own.
   - It would cover only the tabs of one browser. The guard keys on the client IP (its own comment says it always does in practice, `rate-limit.guard.ts:246-251`), so tabs and devices behind one address, such as a restaurant's network, share one bucket. Only a server-side summary (option 2) lowers their total.
   - Revisit if 429s are seen from one address.
4. **A runtime kill switch** (a flag that falls back to the 50-row read). Rejected.
   - The fallback is the defect.
   - PR-A has no consumer, and PR-B is the switch: it moves /orders onto the book, and reverting it is the off switch.
5. **Do nothing.** /orders keeps losing everything past the 50th order, and its counts keep lying by omission.

## Decision

/orders will read the house's whole order book through one reader and one per-house runner. **PR-A (this change) builds them with no consumer and no visible change; PR-B moves the page onto them.**

**The reader** is `fetchOrderBook` in `apps/web/src/services/api/order-book.ts`.

- **Requests:** it pages `GET /procurement/orders/history?page=p&limit=100` until `hasMore` is false. `/history` keeps book reads out of the bucket `POST /orders` lives in.
- **Page checks:** every page is compared with what was asked. A page that differs is an error (a `BookShapeError`, or a `ForeignRowError` for a row of another house), never an empty book.
  - `page` and `limit` must echo the request;
  - there are no more rows than `limit`;
  - no id appears twice on one page;
  - every row's `restaurantId` equals the house (a `ForeignRowError` if not, which the runner counts as a failed refresh);
  - `hasMore` agrees with `total`.
- **The house:** the token's house is compared with the house asked for before and after every page (a `HouseChangedError`, which is not a failed refresh of the house).
- **Completeness:** a read is called whole only when the distinct ids equal `total` and `total` did not move between pages.
  - Otherwise it reads once more.
  - Then it **degrades**: every open status this client can name is swept on its own, and every closed status is counted with a `limit=1` read.
  - The result is marked `partial`, with the reason `unstable`.
  - A status this client cannot read is filed open, and a whole read lists it with the open orders. The sweep cannot ask for a status it cannot name, so a degraded read keeps such an order only as the unfiltered pages it read showed it, and counts the rest in `unclassifiedCount` (`total` less the per-status counts, floored at 0).
  - `openComplete` is true for a degraded read only when every open sweep held still and the per-status counts add up to `total` exactly. Both are necessary, not sufficient: "The known set" under Weaknesses lists how an open order can still be missing, and which of those cases a "KNOWN GAP" test pins.
  - **Held still**, for the unfiltered read and for each sweep, means the distinct ids equal `total` and `total` did not move between its pages. The second half was added at the third gate round: before it, an order that left a swept status between two of its pages made the next page skip a row while the sizes still agreed, and `openComplete` read true.
  - A sweep that does not hold still is read once more; if it still does not, `openComplete` is false.
- **The build's picks, not the founder's.** The ceiling (30 pages), the 40-per-60 s window, the 400 ms settle, the 60 s interval, the 30 s background gap, the 0 to 30 s jitter and the 60 s cap on a 429's wait were picked by the agent that built PR-A. None of them is a founder ruling.
- **The ceiling** is 30 pages (3,000 orders). Past it the result is `capped`. It holds:
  - the 3,000-row prefix;
  - the open sweep (complete only when `openComplete` is true);
  - per-status totals;
  - `nextClosedPage: 31`, for Show older through `fetchOrderBookPage`.
- **429:** the reader waits the body's `retryAfter`, capped at one 60 s window, plus a uniform 0 to 30 s of jitter, then asks for the **same** page again. It gives up with `RateLimitedError` after the third 429 on one page.
- **`fetchOrderById`** confirms one order before a screen says it is not in the book. Every failure reads as "could not be read", never as "does not exist".
- **Open and closed:** closed is COMPLETED, VERIFIED, CANCELLED, REJECTED, and FAILED (which `canonicalStatus` reads as cancelled, `lib/mudavym/status.ts:18`). Everything else is open, including DELIVERED and PARTIALLY_RECEIVED.
- **`markFor(row)`** returns the ruling's marks. For `PARTIALLY_RECEIVED` it reads the mark from the row's `received` block, never from the status alone.

**The runner** lives in `apps/web/src/hooks/queries/useOrderBook.ts`, at module level, one per house.

- **One read at a time.** Requests that arrive during a read wait for one trailing read.
- **A 400 ms settle** absorbs the double invalidation.
- **A per-tab window** of 40 list requests per 60 s.
- **After a 429**, no request is sent from the tab until `retryAfter` has passed.
- **Urgent by default.** A read is background only when `markBackground(house)` is called in the same tick. The runner owns its 60 s interval and the tab-visibility refresh, and treats both as background.
  - Only background reads wait out the 30 s gap after the last read.
  - Background reads wait while the tab is hidden, including one that was timed before the tab was hidden.
  - This PR wires no outside caller to `markBackground`, so every websocket-triggered read is urgent until PR-B.
- **The fence.** `noteLocalWrite(house)` bumps the house's write epoch. A read that started before the bump is not written to the cache; an urgent read replaces it.
- **A house switch** aborts the other house's read. A book is only written under `orders.book(<the house it read>)`.
- **`useOrderBookFreshness(house)`** returns `{asOf, failing, stale}`, with `stale = failing || (asOf !== null && Date.now() - asOf > ageLimit)` and `ageLimit` twice the 60 s interval (`useOrderBook.ts:450`, `:459`). `asOf` and `failing` are the values `finish` last passed to `setFreshness` (`:246`, `:267`), and `{asOf: null, failing: false}` before that (`NO_FRESHNESS`, `:110`). The tests that pin them are listed under "The runner outlives a forget" below.
- **Retries.** `retryOrderBook` turns off TanStack's retry for 429s, house changes, rows of another house and bad pages.
- **The approve write stays where it is.** The optimistic approve write on `orders.list` (`useOrderQueries.ts:148-182`) is unchanged.
- **The key** is `queryKeys.orders.book(house)`. It sits under `['orders']`, so every existing invalidation reaches it.

**Tests and mutation proof.** `order-book.test.ts` (65 tests) and `useOrderBook.test.tsx` (24 tests) use a fake gateway that pages as `listOrders` does (`__tests__/utils/fakeOrderGateway.ts`). Mutations were run from `cp -p` snapshots, never `git stash`, and every restore was compared byte for byte. 40 were run; 39 each failed at least one test and passed again when restored:

- the six the design rests on: dropping the paging loop; dropping the `restaurantId` check; pointing the reader at `/procurement/orders`; removing the fence; making background the default; restarting from page 1 on a 429;
- 16 more in the reader: `openComplete` set from the floored `unclassifiedCount` instead of an exact sum (the per-status counts above `total`); `retryAfter` not capped at the window; no house check after a page; no rows-over-limit, total-is-a-count, `hasMore`-is-boolean or status-echo check; `sweepStatus` always complete, or one attempt; `degrade` keeping every prefix row, or dropping prefix rows of a status it cannot name; `openComplete` ignoring `unclassifiedCount`; a row of another house read as `HouseChangedError`; `fetchOrderById` without its id check, its house check before the GET, or its house check after it;
- 2 more in the reader, added at the third gate round: `sweepStatus` ignoring a `total` that moved between its pages (fails the two "an order that leaves the swept status" tests, partial and capped); the unfiltered read ignoring it (fails "a row deleted between pages");
- 15 more in the runner: no 429 gate; a background mark that never clears; a fence that does not move its waiters; the aborted branch off; `HouseChangedError` counted as failing; no staleness guard; callers resolved with the book read instead of the book kept; freshness dated from the book read instead of the book kept; a read nobody waits for started anyway; `retry: 1`, `refetchOnWindowFocus: true` or the default `refetchOnReconnect` in `useQuery`; `start()` ignoring a hidden tab; a hidden tab deferring an urgent read too; `retryOrderBook` retrying `ForeignRowError`.

The tie test added at the second gate round (see the review trail) pins a gap rather than guarding code, so it was checked separately, from `cp -p` snapshots with byte-for-byte restores: changing `counted === total` to `counted < total` in `degrade` fails it (and four other tests when it was added; 12 tests in all when re-run against the 61 tests the file held after the third round); counting COMPLETED at 3,002 instead of 3,001 in its fixture fails it alone; moving the ON_HOLD order inside the first 3,000 fails it alone. So it sits on the tie, not above it, and its "order missing" assertion is live. These three are not in the 40.

The "KNOWN GAP" tests added at the third gate round were checked the same way, each by removing one move from its fixture: without the delete, the placed-and-deleted test fails; without the leave, the leave-and-enter-above test fails; without the enter, the leave-above-enter-below test fails; without the surplus, the nameable tie test fails. So each sits on its gap. The fourth round's older-`created_at` W4 test was checked the same way: without the backdated insert it fails. Two detection checks were also re-run against the third round's tests: `sweepStatus` without its size check fails the sweep-ceiling test and the repeat-in-a-sweep test; `openComplete` without the exact sum fails five tests, among them both shortfall tests. None of these is in the 40.

At the fourth round, real-move tests were added for W1, S1 and S3 (W1 and S1 had only a test that feeds a repeat). Checked against them: `sweepStatus` ignoring a moved `total` also fails the S3 test. The W1 and S1 tests are caught by either check, the repeat (size) or the moved `total`, so neither single mutation fails them; turning off both checks in the unfiltered read fails the W1 test, and turning off both in `sweepStatus` fails the S1 test. None of these is in the 40 either.

One survives, re-run against the final tests: removing `run.next = null` from `stopOtherHouses`, so the house switched away from keeps its queued read. It gets no test. In the app the token is stored before the house changes (a house switch stores the token at `AuthContext.tsx:678`, forgets the reads at `:686` and sets the house at `:688`; the second switch does the same at `:921`, `:927` and `:929`; sign-out removes the tokens at `:1054-1055` before it forgets the reads at `:1078`), and `assertHouse` runs before every GET, so that queued read sends nothing for the old house; its cost is one window slot and a swallowed `HouseChangedError`.

## Consequences

- **Easier.**
  - PR-B can show every open order the reader found. When `openComplete` is false, the book says the open list may be short. When it is true, that is not proof: "The known set" under Weaknesses lists how an open order can still be missing, in a whole read (W4, W5) and in a degraded one (S4, C3). So PR-B must not promise completeness on `openComplete` alone (see the handovers).
  - Per-status counts cover the whole book in every mode: from the rows of a whole read, or from `statusTotals` in a capped or partial one. A whole read's counts come from one cached value. A degraded read's counts are separate reads taken at different moments. Month figures cover the whole book only in a whole read (see the narrowed ruling above).
  - Every later screen that needs the whole book has a reader with a 429 path, a house check and a completeness check, instead of `?? []`.
- **Weaknesses, stated.**
  - **`created_at` ties.** Until G2 adds `.order('id')` as a tiebreak, two orders with one `created_at` can swap across a page boundary.
    - The count check catches a swap that shows one row twice (distinct < total). That leads to a re-read, then the degrade.
    - It cannot make the read stable, and a house with many tied rows may live in `partial`.
  - **The known set: how an open order can be missing from `rows` while the book does not say so.** Reasoned from the offset paging in `listOrders` (`procurement.service.ts:3185-3208`) and from the reader, after the third gate round found an entry the earlier text left out. It is the set this reasoning found, not a proof that no other exists; at the fourth round both reviewers fuzzed the fake gateway (about 4,000 seeds; about 8,600 single events and 400,000 pairs) and found no open-order loss outside it. Each entry is detected (with the test that shows it), a pinned **KNOWN GAP** (a test that asserts today's behaviour and should flip when the gap is closed), or marked "reasoned, not tested".
    - **Moves after the reader has read an order** (not losses of an open order, but stated so the list is honest):
      - An open-to-open move to a status swept later (a forward move): the order is read by that later sweep under its new status (if it moved after its old status was swept, it is in both sweeps and counted twice: C1). In a whole read it shows under its old status until the next read, as with any read that is not one query.
      - An open-to-closed move after the unfiltered pages read it and before its old status is swept: the sweep no longer has it and the prefix copy is dropped, so it is in **no row**, while the closed status's count in `statusTotals` includes it, and nothing flags it. It is closed, so no open order is missing. Pinned: "does not list a row as open once the sweep no longer finds it open" asserts it absent, COMPLETED counted 100 against 99 COMPLETED rows, `openComplete` true.
      - A move into a status already counted from one not yet counted (backward against the sweep order): C2, or C3 when a surplus cancels it.
    - **The unfiltered read** (a whole read; also the prefix of a degraded one):
      - **W1.** An order placed between pages (newest first, so above the page being read): the next page repeats a row, the distinct ids fall short of `total`, and `total` moves. Detected. Tests: "whole read: an order placed between pages (a real insert, newest first)", and "reads again once when a page repeats an order" (which feeds a repeat).
      - **W2.** Two orders with one `created_at` swapped across a page boundary: one row twice, one skipped, distinct ids short of `total`. Detected by the repeat. The fake gateway sorts stably, so no test produces a real tie: "reads again once when a page repeats an order" feeds the repeat a tie would cause. The tie itself is reasoned, not tested; probed at the fourth review (fuzz: `p4-scratch/audits/598-dc180e428/auditor.md:4`, "created_at ties detected by pigeonhole") and at the fifth (a tie swap re-read pages [1,2,1,2] and was detected, `p4-scratch/audits/598-39a2977f9/auditor.md:3`).
      - **W3.** An order deleted between pages: the later pages shift up and skip a row, and the sizes agree, but `total` moved. Detected since the third gate round. Test: "whole read: a row deleted between pages moves the count".
      - **W4.** An order placed and another deleted between the same two pages: `total` holds. KNOWN GAP, pinned ("whole read, an order placed and another deleted"). When the placed order is the newest, as a new order is, only it is missed, as one placed after the read would be. An order inserted with an older `created_at`, below the page being read, lets the delete skip an order that existed throughout. Reproduced at the fourth review and pinned ("a delete above the page read and an insert dated older than every order"). Whether any writer back-dates `created_at` was not checked.
      - **W5.** A null count: `listOrders` sets `total = count ?? orders.length` (`procurement.service.ts:3262`), so a first page of 100 would report `total` 100 and `hasMore` false, and be read as the whole book. KNOWN GAP, pinned ("a null count from the gateway"). With `count: "exact"` it is not expected.
      - How rare deletes are:
        - `DELETE orders/:id`, the only `@Delete("orders` route in `apps/api-gateway/src`, is documented as a cancel (`procurement.controller.ts:307-310`); its service body was not read;
        - a grep of `.from("procurement_orders")` call sites in `apps/api-gateway/src` and `services/` found one `.delete(` within three lines, in an e2e test's cleanup (`communications/tests/email-convo-flow.e2e.spec.ts:129`), and none outside spec files.
        - That is evidence, not proof. SQL functions and crons were not swept.
    - **Each open sweep** (one status, offset-paged, in a degraded read):
      - **S1.** An order enters the status above the page being read (moved in, or placed): a row repeats, and `total` moves. Detected: the sweep reads again, and if the second try does not hold still either, `openComplete` is false. Tests: "sweep: an order that enters the status above the page read (a real move)", and "says the open set is not complete when an open sweep does not hold still either" (which feeds a repeat).
      - **S2.** An order leaves the status after its page was read (a forward move, a cancel): the later pages shift up and skip a row, the sizes agree, `total` drops. Moving out of a status mid-sweep is routine. Detected since the third gate round, which found it. Tests: "sweep, partial: an order that leaves the swept status" and "sweep, capped: …".
      - **S3.** An order enters below the page being read: it is read; `total` moved, so the sweep reads again. Nothing is lost. Test: "sweep: an order that enters the status below the page read".
      - **S4.** One order leaves and another enters between the same two pages: `total` holds and no row repeats. KNOWN GAP, pinned by two tests: entering above the page read, the entrant is not read ("an order that leaves and another that enters above the page read"); leaving above and entering below, the shift skips an order that never moved ("an order that never moved is lost"). The per-status counts add up when the entrant's old status and the leaver's new status are both counted after this sweep, as in both tests. Otherwise one of them is counted twice or not at all, and `openComplete` is false unless the two cancel (C3) (reasoned, not tested).
      - **S5.** More than 3,000 orders in one open status: the sweep stops at 30 pages, short of `total`. Detected. Test: "sweep: one status past its own 30 pages".
    - **The per-status counts** (taken at different moments; they must add up to `total` exactly):
      - **C1.** An order counted twice: after its status was counted it moved into one counted later, or it was placed after the unfiltered read and before its status was counted. A surplus; `openComplete` false. Detected, conservatively (nothing need be missing). Test: "does not call the open set complete when the per-status counts add up to more than the total".
      - **C2.** An order in no count: it moved from a status not yet counted into one already counted (an open-to-open move against the sweep order: the legal ones are NEGOTIATING → APPROVAL_NEEDED, APPROVED → NEGOTIATING, CONFIRMED → NEGOTIATING and PARTIALLY_RECEIVED → DELIVERED, from the edges in `20260905230000_an_order_changes_state_by_the_table.sql`; or a reopen into a swept status, which has no legal edge, since closed statuses have none out, and needs a writer that bypasses the trigger), or it has a status no sweep can name and lies outside the pages read (past the ceiling, or skipped by a read that did not hold still). A shortfall; `unclassifiedCount` above 0, `openComplete` false. Detected. Tests: "across sweeps: an order that moves into a status already swept" and "an order of a status no sweep can name, past the ceiling, with no surplus".
      - **C3.** A shortfall (C2) cancelled exactly by a surplus (C1): the counts add up, `unclassifiedCount` is 0, `openComplete` is true, and the order in no count is missing. KNOWN GAP, pinned by two tests: the second round's tie (ON_HOLD past the ceiling, COMPLETED counted 3,001) and "across sweeps, that shortfall cancelled by an order counted twice" (every status nameable).
    - **Capped and partial** run the same sweeps and counts; they differ only in the prefix (the newest 3,000, or the rows of the last unstable unfiltered read). For a swept status the sweep is trusted over the prefix: a prefix row of a swept status is dropped and only what the sweep found is kept, so a row the sweep skips (S4) is lost, and an order that closed before its sweep is in no row (above). Closed rows and rows of a status no sweep can name are kept as last read.
  - **100 per page is transport only.** The reader asks for 100 rows a page. The ruling's "50 per tap" is display, and PR-B slices 50 per tap from what was read.
  - **The runner outlives a forget.** Sign-out (`AuthContext.tsx:1078`) and both house switches (`:686`, `:927`) call `forgetHouseReads`, which resets every query in the React Query cache, the book included. The runner is module-level (`useOrderBook.ts:112`) and does not listen for a forget. Two things survive a sign-out followed by a sign-in to the same house in the same tab:
    - **An in-flight read.** A read paused (in a 429 wait or the window's sleep) across a sign-out and a sign-in to the same house in the same tab is not stopped by the code: `assertHouse` compares the house, not the session (`order-book.ts:314-317`, called after `acquireSlot` at `:406-407` and after each response at `:423`); `forgetHouseReads` cancels only the query's waiter; `stopOtherHouses` aborts `run.inFlight` (`useOrderBook.ts:280`) but skips the house it is called for (`:275`); and only `noteLocalWrite` bumps the epoch fence (`:364`). No committed test pins what such a read writes or what freshness then reports; the owed work is in the PR-B handovers. No page consumes the book yet. What the committed tests pin about freshness and the kept book, in `useOrderBook.test.tsx`: "is fresh after a read, and flips to failing when a refresh fails" (after a read, `failing` and `stale` are false and `asOf` is set; after a refresh answered 500, both are true); "a row of another house on a page is a failed refresh" (both true); "a token that names another house mid-read is not a failed refresh of this house" (both false); "goes stale past twice the interval with no read" (with the tab hidden, `stale` is false after `2 * BOOK_INTERVAL_MS - 1_000` ms more and true, with `failing` false, 2 s later); "a book dated later than the one finishing stays in the cache, and the query gets it" (a cached book with a larger `readStartedAt` stays in the cache, the query returns it, and `asOf` is its `readStartedAt`); and "a read that started before a local write is not written; a fresh read replaces it" (the cache holds the earlier book after the fenced read, then a book whose `readStartedAt` is at or after the write, the `invalidateQueries` call that asked settles, and the hook's data is that book).
    - **`run.freshness`** (`asOf`, `failing`): set only by `finish` (`useOrderBook.ts:246`, `:267`, through `setFreshness`, `:142-143`); `forgetHouseReads` (`AuthContext.tsx:57`) does not reset it.

    Both are carried to PR-B (see the handovers); the code is unchanged here.
  - **Mobile shares the bucket.** The phone reads `/history` too (`apps/mobile/src/api/queries.ts:111`). A phone behind the same network address shares the bucket.
  - **The dashboard shares the bucket.** The dashboard reads `/history` (`useDayOrders`, `useDashboardNextData.ts:415-470`, its `getOrderHistory` call at `:447`; `useOrderQueries.ts:93`) from the same browser, outside this runner's window.
  - **The window does not cover them.** The 40-per-tab window counts only book reads, so book reads, dashboard reads and a second tab can still reach 100 together. The 429 path absorbs that; it does not prevent it.
  - **Request cost.** A capped read costs at least 42 requests: 30 pages, 8 open sweeps and 4 counts. Under the 40-per-60s window it spans more than a minute. A read that does not hold still reads its pages twice and then degrades: at least 2 × its pages + 12.
  - **A status this client cannot name, in a degraded read.** Such an order is kept only as the unfiltered pages the read went through showed it. One those pages did not show is in no count (C2 above) unless a surplus cancels it (C3).
    - How likely such an order is: the gateway references only the twelve enum members (a grep of `ProcurementOrderStatus.` in `apps/api-gateway/src`); string-literal and SQL writers were not swept. The status trigger in `20260905230000_an_order_changes_state_by_the_table.sql` refuses an UPDATE to or from a status outside the twelve, but it fires `BEFORE UPDATE OF status` only (`:174-176`), so an INSERT is not guarded. That migration measured 0 rows outside the twelve, of 2 orders in production, on 2026-09-05 (`:42-43`); nothing here re-measured it.
- **Revisit when:**
  - 429s are observed from one address (reconsider options 2 and 3);
  - a house's book is routinely `partial` (G2 is late, or orders move mid-read more often than expected);
  - a gateway book route lands (option 2): swap it in under `fetchOrderBook`.

## Handovers (the ruling's "hand off rest")

| What | To | Note |
|---|---|---|
| G2: add `.order('id')` after `.order('created_at')` in `listOrders` (`procurement.service.ts:3207`) | O4 | Tracked as an `open` claim row in this PR's claims fragment; it flips when G2 lands |
| Dashboard in-transit count; `useDayOrders` (`useDashboardNextData.ts:415`) | R1b | The ruling names the in-transit count. This PR did not locate its line |
| Scorecard overdue list | vendors lane | `scorecard-types.ts:57` declares the field. Its source read was not traced here |
| /receiving door lane | R3 | DELIVERED orders are open ("Not counted yet") and are not listed on /receiving today, per the ruling's record |
| Phone /orders | this lane, a later PR | Mobile is not touched here |
| `pages/dashboard/next/DayDetail.tsx:302` links `/orders?highlight=` | follow-up | Check whether /orders reads `?highlight=` or `?order=` |
| `markBackground` from `lib/websocket.tsx:646`/`:664` | PR-B | Until wired, websocket-triggered book reads are urgent (settled, not gapped) |
| Abort or ignore the in-flight read on a forget (e.g. abort `inFlight` or bump `writeEpoch` on forget, or a session generation), and reset `run.freshness`; cover a switch from house A to B and back to A with no B subscriber (`stopOtherHouses` runs only from `subscribeOrderBook`, `useOrderBook.ts:368-369`) and a read mid-HTTP at the sign-out (`order-book.ts:413-423`); pin each with a test | PR-B | `forgetHouseReads` resets the cached book; the module-level runner's in-flight read and `run.freshness` are not reset by it (see Weaknesses, "The runner outlives a forget") |
| Handle a backwards clock step in the keep rule and the stale timer (`useOrderBook.ts:264`, `:451-459`): for example a per-run read sequence number or `performance.now` in place of wall-clock `readStartedAt` for the keep, negative ages in the stale check, and a timer that re-arms or recomputes after a step; and make the keep rule hold for two overlapping reads of one house (a second module instance in a dev hot reload) | PR-B | Owed; no committed test pins a clock step or two module instances. Reviewer runs that reached them: `p4-scratch/audits/598-152c893/adversary.md`, `p4-scratch/audits/598-4fb013e/adversary.md`, `p4-scratch/audits/598-4fb013e/auditor.md` |
| No completeness promise on `openComplete` alone | PR-B | `openComplete` true can hide an open order: in a whole read, an order placed and another deleted between the same pages, or a null count (W4, W5); in a degraded read, a leave and an enter in one sweep (S4), or a shortfall cancelled by a surplus, with nameable statuses or not (C3). Each is pinned by a "KNOWN GAP" test. PR-B must not render "every open order" or the like from it. Proof needs the open set, or its count, from one gateway query; when that lands, the "KNOWN GAP" tests should flip |

## Forks for PR-B

Forks 1 to 3 were asked through AskUserQuestion and answered by the founder on 2026-10-03 (re-asked after a reboot lost the first ask). The labels are verbatim; the text after each paraphrases the coordinator's record (project memory `founder-answers-2026-10-02-sim-share-out.md`, "F-140 PR-B forks, answered 2026-10-03"). The questions and their previews are saved in `p4-scratch/f140/prb-forks-asked-2026-10-03.json`. This session did not see the exchange itself.

1. **Station:** "Top of Delivered (Recommended)".
   - The four open arrivals (not counted yet, counted but not checked, waiting on the invoice, backorder) stay in Delivered, listed first with their mark and always shown.
   - Finished deliveries sit below, behind 'Show older'.
   - No new tab, and no backorder moved to Ordered.
   - Today `stageOf` (`useOrdersNextData.ts:49-70`) files DELIVERED and PARTIALLY_RECEIVED under `delivered`, together with VERIFIED and COMPLETED.
2. **Empty tab:** "Newest 50 at once (Recommended)".
   - A station with nothing open opens on its newest 50 finished orders, with 'Show older' below.
   - The sketch this ADR first offered, "Nothing open" over Show older, was not picked.
3. **Cancelled:** "Keep them out (Recommended)".
   - 'Show older' leaves cancelled and rejected orders out, as today. The separate cancelled count stays.
4. **Open, not decided: what do undecidable `PARTIALLY_RECEIVED` rows read as?** These are rows whose `received` block cannot tell the three states apart: absent, `verifiedAt` not sent, or checked with `backorderBottles` null (not a bottle count).
   - `markFor` reads them as 'Receipt could not be read'.
   - The ruling names that text for `readable: false` only, so this extension is a default for review, not a ruling. It is asked before PR-B builds.
   - Filed in `OPEN-DECISIONS.md` (the section filed 2026-10-08 from this branch) as `OD-TBD`; its number is assigned at merge.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Proposed) with PR-A on `fix/orders-paged-fetch-f140` |
| 2026-10-03 | Internal audit (correctness and adversarial), branch head `752189ac2` | Findings fixed in `833776ac9` |
| 2026-10-03 | Internal re-audit, branch head `833776ac9` | Findings fixed in `86224761d` |
| 2026-10-08 | PR audit gate (ADR 0090), head `1e5f3bae3` | BLOCK, on the record only: forks 1 to 3 shown open, stale citations, the cap narrowing the ruling unstated. Two code findings (the `openComplete` sum, the `retryAfter` cap) answered with tests in `15e98ec7f` |
| 2026-10-08 | PR audit gate (ADR 0090), head `15e98ec7f` | BLOCK, on the record only. Finding #4 (the `openComplete` sum) was narrowed, not closed, at `15e98ec7f`: the exact-sum check rejects counts above `total`, but not a surplus that exactly cancels a deficit. It is now recorded as a known gap, pinned by a test, with a PR-B handover; the reader's behaviour is unchanged (comments only). Also fixed: the comment on 429 waits (counted per page, not per read) |
| 2026-10-08 | PR audit gate (ADR 0090), head `ddf35eddc` | BLOCK: both reviewers reproduced a nameable open order lost with `openComplete` true. An order leaving a swept status between two of its pages made the next page skip a row while the sizes agreed (S2). This round found it; the round-2 text claimed more than the code. Fixed in code: a sweep, and the unfiltered read, no longer count as held still when `total` moves between pages, with tests in both modes and two new mutations. The ways an open order can still be missing were then enumerated as "The known set" (W1-W5, S1-S5, C1-C3), each detected with a test or pinned as a KNOWN GAP [corrected at the round-5 update: not each; some entries are marked "reasoned, not tested" (W2's tie, and what S4's counts do when the leaver's or the entrant's status is not counted after the sweep), as the known set says] |
| 2026-10-08 | PR audit gate (ADR 0090), head `dc180e428` | BLOCK on the record only; both reviewers found the code held under fuzzing, with no open-order loss outside the known set. The text claimed more: "stale, not missing" was false for an order that closes before its old status is swept (it is in no row, though counted); S3 had no test, and W1 and S1 only a fed repeat; the `degrade` comment said a dropped prefix row "has left that status", which S4 contradicts; a stale "38". Fixed in wording, with real-move tests for W1, S1 and S3, a pinned older-`created_at` W4 test, and an absence assertion in the close-before-sweep test; no logic changed |
| 2026-10-08 | PR audit gate (ADR 0090), head `39a2977f9` | PASS. Owed at the update commit: merge main (6 commits behind); main's #654 made sign-out and both house switches call `forgetHouseReads`, so the sign-out weakness was restated as the runner's `run.freshness` outliving a forget, with a PR-B handover [corrected at round 6: that was not all that outlives a forget; an in-flight read survives too and can write a mixed-age book shown as fresh, see "The runner outlives a forget"]; the AuthContext cites re-checked on the merged tree; a bracketed correction to the round-3 row; the third tag and the null sweep count named in `order-book.ts` comments. Wording only |
| 2026-10-08 | PR audit gate (ADR 0090), head `52f081dbf` | BLOCK on wording. Both reviewers reproduced an in-flight read surviving a sign-out and a same-house sign-in, writing a mixed-age book shown as fresh [corrected at round 7: both reviewers reproduced the write; only the adversary showed a mount making 0 calls with `stale` false, and only for a 30 s wait; a read taking more than 120 s is reported stale, see "The runner outlives a forget"] [corrected at round 8: "only for a 30 s wait" names what round 6 ran (a 30 s wait, mount at +40 s), not a limit on the behaviour; round 7 also showed `stale` false for a 90 s read mounted at the write, and whether a mount is reported stale depends on the read's length plus the time since the write] [corrected at round 9: "mounted at the write" is not on the record; read "with the mount 0 to 10 s after the write (the round-8 adversary's reading; the round-7 timing was not recorded)"] [corrected at round 10: that dependence is by age; `stale` is also true while `failing` is set, at any read length, see "The runner outlives a forget"]; the round-5 text named only `run.freshness`, and the round-5 PASS's "does not occur in the app" was retracted by the gate. Fixed in wording: "The runner outlives a forget" states both, the PR-B handover says to abort or ignore the in-flight read on a forget and reset `run.freshness`, a bracketed correction to the round-5 row, `useCalendarNextData.ts` re-cited at `:564`, `useOrderQueries.ts` at `:148-182`, and every file:line cite in this ADR re-checked on the merged tree. No logic changed |
| 2026-10-08 | PR audit gate (ADR 0090), head `a961496e0` | BLOCK on wording; both reviewers approved, the planner overturned. "Reports it not stale" held only for a read of 120 s or less (the round-7 adversary measured `stale` true at 132 s and 180 s); [corrected at round 8: the fix this row describes made "120 s or less" a sufficient condition, which it is not; `stale` is true when the read's length plus the time from the write to the mount exceeds 120 s] "resumes after the sign-in" held only if the sign-in comes before the pause ends; the round-6 row overstated what the auditor showed. Fixed in wording: "The runner outlives a forget" states both conditions, names its triggers as examples and adds the A-B-A and mid-HTTP paths as reasoned, not tested; a bracketed correction to the round-6 row; cites re-checked. No logic changed |
| 2026-10-08 | PR audit gate (ADR 0090), head `11184278c` | BLOCK on wording; both reviewers blocked. "A read that took 120 s or less is reported not stale" used the wrong clock: `stale` is true when the read's length plus the time from the write to the mount exceeds 120 s, and both reviewers showed it true for a 100 s read mounted 30 s after the write. Fixed in wording: "The runner outlives a forget" states the d + m rule, says the round-7 figures were taken with the mount at the write and cites the round-8 runs; [corrected at round 9: read "taken with the mount 0 to 10 s after the write (the round-8 adversary's reading; the round-7 timing was not recorded)"] brackets on the round-6 and round-7 rows; the fail-closed case and the window-sleep variant attributed to round 8. No logic changed |
| 2026-10-08 | PR audit gate (ADR 0090), head `81b3e2554` | BLOCK on wording; the auditor blocked, the adversary approved with a body fix owed. "Mounted at the write" for the round-7 figures was prescribed by the round-8 gate report and is not on the record (the round-8 adversary's reading is a mount 0 to 10 s after the write); the PR body's "reported stale only when ... exceeds 120 s" left out a consumer that stays mounted. Fixed in wording: the mount timing restated, brackets on the round-6 and round-8 rows, the 0-call statement narrowed to what the hand-backs state, the round-9 stays-mounted repro cited. No logic changed |
| 2026-10-08 | PR audit gate (ADR 0090), head `edc643dd0` | BLOCK on wording; both reviewers blocked. `stale` is `failing` or an age over 120 s (`useOrderBook.ts:459`), and the sentences on staleness left out `failing`: "a read of 60 s or less is therefore never reported stale" here, and the PR body's "never reported stale" and "reported stale at mount only when ..."; "`stale` is true once `Date.now() - asOf` is more than 120 s" was true but incomplete; "in every case the book is shown without a refetch" held at mount only. The adversary showed a failed later read setting `stale` true inside the window while the same book stayed shown (H6a at sinceWrite 30.1 s, H6b at 65.1 s, `p4-scratch/audits/598-edc643dd0/adversary.md`). Fixed in wording: "The runner outlives a forget" states the `:459` rule in full, scopes the quantifiers to age, narrows the no-refetch statement to the mount, says what a later read does and cites the round-10 run; a bracket on the round-6 row; the sweep found that the `asOf` doc comment (`useOrderBook.ts:82-85`) said `failing` and `stale` are both false while `asOf` is null, which a first read that fails makes false [round 11: that comment, and the `failing` doc at `:88`, were rewritten at the next head, comment only; the record says when `failing` is set and cleared, including the fence and the kept-book cases] [round 11 gate: two of those sentences were broader than the code, the replacement read's outcome and the kept book under a backwards clock step; both, and the comment at `:260-261`, were narrowed at the head after `152c89334`, with a PR-B handover] [round 12 gate: four sentences and one test title were still broader than the code (the replacement read when fenced, the stays-mounted sentence under a clock step, the size of the clock step, the single-module-instance premise, the "read later" test title); narrowed at the head after `4fb013ef9`] [round 12 gate + coordinator ruling DISPATCH.md:85: unpinned freshness claims deleted, not refined]. No logic changed |
