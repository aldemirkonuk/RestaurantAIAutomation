# 0269 — /orders reads the whole order book, page by page, and never hides an open order

- **Status:** Proposed
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** F-140, F-117, orders, paging, order book, hasMore, open orders, backorder, partially received, delivered, rate limit, 429, single-flight, fence
- **Links:** [[0255-orders-walk-through-r5-rulings]], [[0256-waiting-on-you-is-flagged-first-then-oldest-by-the-houses-own-rules]], [[0192-received-is-the-shelf-count-from-the-ledger]] (the `received` block); lane 3 (wt-review-11), PR-A of two; claims in `claims.d/fix-orders-paged-fetch-f140.jsonl`

## Context

The /orders page lists only the house's newest 50 orders, and counts only them too.

- `useOrdersNextData.ts:401` reads `useOrders()`. That calls `getOrders` (`services/api/orders.ts:47-59`), which sends no `page` and no `limit`, and turns any other body into `?? []` (`:58`).
- The gateway's `listOrders` then answers its default page: `const limit = query.limit ?? 50` (`procurement.service.ts:3048`).
- It orders by `created_at` alone (`:3100`), counts exactly, and reports `hasMore: fromIndex + orders.length < total` (`:3162`).
- `OrderFilterDto.limit` is `@Max(100)` (`procurement.dto.ts:839`).

A house with 51 orders loses its oldest from the page, its counts and its month figures. The sim's F-140 (and F-117) found this.

Other screens read the same 50-row default. Whether that cuts anything off for what they do was **not measured** here:

- `useCalendarNextData.ts:538`;
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
  - It is written at the door on every door receipt (`receiving.service.ts:565`).
  - It is also written at the check when `backorderQty > 0 || awaitingInvoice` (`procurement.service.ts:6690-6694`).
  - So it means counted-not-checked, checked-in-full-awaiting-the-invoice, or checked-and-short.
- **`getOrder` uses `.single()`** (`procurement.service.ts:3166-3190`), so an id that does not exist comes back as a 500, not a 404.

## The founder's rulings (verbatim)

Asked by the lane coordinator through AskUserQuestion. These are quoted from the coordinator's record (project memory `founder-answers-2026-10-02-sim-share-out.md`); this session did not see the exchange itself.

**2026-10-02:**

- **List:** "Open always, older on tap (Recommended)".
  - Every open order is always listed. Closed orders sit behind 'Show older', 50 per tap.
  - Counts and month figures cover the whole book.
- **Partly received:** "Open, marked backorder (Recommended)". **Superseded on 2026-10-03.**
  - The question's premise was wrong: it said `PARTIALLY_RECEIVED` meant short.
  - The status covers the three states above, so "marked backorder" would have labelled every door-counted order and every order awaiting its invoice as a backorder.

**2026-10-03 (re-asked):**

- **Mark:** "Say what's owed (Recommended)". All three states stay open, and the mark reads:
  - 'Backorder: N bottles still owed' only when `verifiedAt` is set and `backorderBottles > 0`;
  - 'Counted, not checked yet' when `verifiedAt` is null;
  - 'Waiting on the invoice' when the order was checked in full;
  - 'Receipt could not be read' when `received.readable` is false.
- **Delivered:** "Open, 'Not counted yet' (Recommended)".
  - An order the vendor reports delivered, but nobody has counted at the door, is listed as open on /orders.
  - Today it is filed closed.
- **Scope:** "/orders now, hand off rest (Recommended)".
  - This covers the web and phone /orders only. Everything else gets a written handover (below).

## Options considered

1. **A per-status reader** (ask the gateway for each open status, and read closed orders lazily). Rejected.
   - Twelve statuses mean at least twelve requests even for a house with ten orders.
   - The counts would then be a sum of twelve reads taken at different moments.
   - A status the client does not know would never be asked for, so its orders would be hidden.
   - It is kept as the *fallback* (the open sweep), where it is the only thing that can still prove the open set complete.
2. **A gateway order-book controller** (one request returns the whole book, or open plus counts). Rejected for now.
   - It is PR-6-sized gateway work on a route O4 is changing.
   - Editing `@RateLimit` on these routes collides with O4's #538/#541 stack.
   - The client reader is the part that has to exist either way: it is the reader such a route would be swapped in under.
3. **Cross-tab leader election** (one tab reads, and the others listen over BroadcastChannel). Rejected.
   - Each tab caps itself at 40 of the 100-per-60s bucket instead.
   - Leader hand-off on tab close and sleep is a failure mode of its own, for a gain only a three-tab user sees.
   - Revisit if 429s are seen from one browser.
4. **A runtime kill switch** (a flag that falls back to the 50-row read). Rejected.
   - The fallback is the defect.
   - PR-A has no consumer, and PR-B is the switch: it moves /orders onto the book, and reverting it is the off switch.
5. **Do nothing.** /orders keeps losing everything past the 50th order, and its counts keep lying by omission.

## Decision

/orders will read the house's whole order book through one reader and one per-house runner. **PR-A (this change) builds them with no consumer and no visible change; PR-B moves the page onto them.**

**The reader** is `fetchOrderBook` in `apps/web/src/services/api/order-book.ts`.

- **Requests:** it pages `GET /procurement/orders/history?page=p&limit=100` until `hasMore` is false. `/history` keeps book reads out of the bucket `POST /orders` lives in.
- **Page checks:** every page is compared with what was asked. A page that differs is a `BookShapeError`, never an empty book.
  - `page` and `limit` must echo the request;
  - there are no more rows than `limit`;
  - no id appears twice on one page;
  - every row's `restaurantId` equals the house (a `HouseChangedError` if not);
  - `hasMore` agrees with `total`.
- **The house:** the token's house is compared with the house asked for before and after every page.
- **Completeness:** a read is called whole only when the distinct ids equal `total`.
  - Otherwise it reads once more.
  - Then it **degrades**: every open status is swept on its own, and every closed status is counted with a `limit=1` read.
  - The result is marked `partial`, with the reason `unstable`.
  - Open orders are never dropped. A status this client cannot read is filed open.
- **The ceiling** is 30 pages (3,000 orders). Past it the result is `capped`. It holds:
  - the 3,000-row prefix;
  - the complete open sweep;
  - per-status totals;
  - `nextClosedPage: 31`, for Show older through `fetchOrderBookPage`.
- **429:** the reader waits the body's `retryAfter` plus a uniform 0 to 30 s of jitter, then asks for the **same** page again. It gives up with `RateLimitedError` after the third 429 on one page.
- **`fetchOrderById`** confirms one order before a screen says it is not in the book. Every failure reads as "could not be read", never as "does not exist".
- **Open and closed:** closed is COMPLETED, VERIFIED, CANCELLED, REJECTED, and FAILED (which `canonicalStatus` reads as cancelled, `lib/mudavym/status.ts:18`). Everything else is open, including DELIVERED and PARTIALLY_RECEIVED.
- **`markFor(row)`** returns the ruling's marks. It never reads the mark from the status alone.

**The runner** lives in `apps/web/src/hooks/queries/useOrderBook.ts`, at module level, one per house.

- **One read at a time.** Requests that arrive during a read wait for one trailing read.
- **A 400 ms settle** absorbs the double invalidation.
- **A per-tab window** of 40 list requests per 60 s.
- **After a 429**, no request is sent until `retryAfter` has passed.
- **Urgent by default.** A read is background only when `markBackground(house)` is called in the same tick. The runner owns its 60 s interval and the tab-visibility refresh, and treats both as background.
  - Only background reads wait out the 30 s gap after the last read.
  - Background reads wait while the tab is hidden.
  - This PR wires no outside caller to `markBackground`, so every websocket-triggered read is urgent until PR-B.
- **The fence.** `noteLocalWrite(house)` bumps the house's write epoch. A read that started before the bump is not written to the cache; an urgent read replaces it.
- **A house switch** aborts the other house's read. A book is only written under `orders.book(<the house it read>)`.
- **`useOrderBookFreshness(house)`** returns `{asOf, failing, stale}`. `stale` means older than twice the interval, or failing.
- **Retries.** `retryOrderBook` turns off TanStack's retry for 429s, house changes and bad pages.
- **The approve write stays where it is.** The optimistic approve write on `orders.list` (`useOrderQueries.ts:147-182`) is unchanged.
- **The key** is `queryKeys.orders.book(house)`. It sits under `['orders']`, so every existing invalidation reaches it.

**Tests and mutation proof.** `order-book.test.ts` (33 tests) and `useOrderBook.test.tsx` (14 tests) use a fake gateway that pages as `listOrders` does (`__tests__/utils/fakeOrderGateway.ts`). Six mutations each failed at least one test and passed again when restored:

- dropping the paging loop;
- dropping the `restaurantId` check;
- pointing the reader at `/procurement/orders`;
- removing the fence;
- making background the default;
- restarting from page 1 on a 429.

## Consequences

- **Easier.**
  - PR-B can show every open order and whole-book counts from one cached value.
  - Every later screen that needs the whole book has a reader with a 429 path, a house check and a completeness check, instead of `?? []`.
- **Weaknesses, stated.**
  - **`created_at` ties.** Until G2 adds `.order('id')` as a tiebreak, two orders with one `created_at` can swap across a page boundary.
    - The count check catches a swap that shows one row twice (distinct < total). That leads to a re-read, then the degrade.
    - It cannot make the read stable, and a house with many tied rows may live in `partial`.
  - **The insert-only assumption.** The count check proves a whole read only while no order *leaves* the unfiltered list mid-read.
    - A row deleted mid-read shifts the later pages up and skips one row, while the stale deleted row is still counted, so distinct = total and the read is accepted.
    - What was checked:
      - `DELETE orders/:id`, the only `@Delete("orders` route in `apps/api-gateway/src`, is documented as a cancel (`procurement.controller.ts:307-310`); its service body was not read;
      - a grep of `.from("procurement_orders")` call sites in `apps/api-gateway/src` and `services/` found no `.delete(` within three lines.
    - That is evidence, not proof. SQL functions and crons were not swept.
  - **Mobile shares the bucket.** The phone reads `/history` too (`apps/mobile/src/api/queries.ts:111`). A phone behind the same network address shares the bucket.
  - **The dashboard shares the bucket.** The dashboard reads `/history` (`useDashboardNextData.ts:265-299`, `useOrderQueries.ts:93`) from the same browser, outside this runner's window.
  - **The window does not cover them.** The 40-per-tab window counts only book reads, so book reads, dashboard reads and a second tab can still reach 100 together. The 429 path absorbs that; it does not prevent it.
  - **Request cost.** A capped read costs at least 42 requests: 30 pages, 8 open sweeps and 4 counts. Under the 40-per-60s window it spans more than a minute.
- **Revisit when:**
  - 429s are observed from one browser (reconsider option 3);
  - a house's book is routinely `partial` (G2 is late, or the insert-only assumption is wrong);
  - a gateway book route lands (option 2): swap it in under `fetchOrderBook`.

## Handovers (the ruling's "hand off rest")

| What | To | Note |
|---|---|---|
| G2: add `.order('id')` after `.order('created_at')` in `listOrders` (`procurement.service.ts:3100`) | O4 | Tracked as an `open` claim row in this PR's claims fragment; it flips when G2 lands |
| Dashboard in-transit count; `useDayOrders` (`useDashboardNextData.ts:273`) | R1b | The ruling names the in-transit count. This PR did not locate its line |
| Scorecard overdue list | vendors lane | `scorecard-types.ts:57` declares the field. Its source read was not traced here |
| /receiving door lane | R3 | DELIVERED orders are open ("Not counted yet") and are not listed on /receiving today, per the ruling's record |
| Phone /orders | this lane, a later PR | Mobile is not touched here |
| `DayDetail.tsx:200` links `/orders?highlight=` | follow-up | Check whether /orders reads `?highlight=` or `?order=` |
| `markBackground` from `lib/websocket.tsx:646`/`:664` | PR-B | Until wired, websocket-triggered book reads are urgent (settled, not gapped) |

## Open forks for PR-B (not decided; asked before PR-B builds)

1. **Which station holds open delivered and partly received orders?**
   - `stageOf` (`useOrdersNextData.ts:49-70`) files DELIVERED and PARTIALLY_RECEIVED under `delivered`, together with VERIFIED and COMPLETED.
   - Sketch: (a) they stay at `delivered`, and the station splits into open and closed; (b) a new "At the door" station sits before `delivered`; (c) they show at `ordered` with their mark.
2. **Do cancelled orders appear under Show older?**
   - Sketch: (a) yes, mixed in date order with a cancelled mark; (b) only behind their own filter; (c) a count only.
3. **What does a station with no open rows show?**
   - Sketch: (a) "Nothing open", with Show older under it; (b) the station is hidden until it has rows; (c) the latest closed row, dimmed.
4. **What do undecidable `PARTIALLY_RECEIVED` rows read as?** These are rows whose `received` block cannot tell the three states apart: absent, `verifiedAt` not sent, or checked with `backorderBottles` null (not a bottle count).
   - `markFor` reads them as 'Receipt could not be read'.
   - The ruling names that text for `readable: false` only, so this extension is a default for review, not a ruling.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Proposed) with PR-A on `fix/orders-paged-fetch-f140` |
