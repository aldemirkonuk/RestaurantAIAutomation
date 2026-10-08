# 0269 — /orders reads the whole order book, page by page, and lists every open order or says it could not

- **Status:** Proposed
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder). Decisions are locked by the founder, never by an agent.
- **Keywords:** F-140, F-117, orders, paging, order book, hasMore, open orders, backorder, partially received, delivered, rate limit, 429, single-flight, fence, Show older, PR-B, hold
- **Links:** [[0255-orders-walk-through-r5-rulings]], [[0256-waiting-on-you-is-flagged-first-then-oldest-by-the-houses-own-rules]], [[0192-received-is-the-shelf-count-from-the-ledger]] (the `received` block); lane 3 (wt-review-11), PR-A of two; claims in `claims.d/fix-orders-paged-fetch-f140.jsonl`; PR-B on `fix/orders-wire-order-book-f140`, claims in `claims.d/fix-orders-wire-order-book-f140.jsonl`

## Context

The /orders page lists only the house's newest 50 orders, and counts only them too.

- `useOrdersNextData.ts:401` reads `useOrders()`. That calls `getOrders` (`services/api/orders.ts:47-59`), which sends no `page` and no `limit`. A body with no `.orders` is returned as it is, cast to `Order[]`; only a missing body (null or undefined) becomes `[]` (`:58`).
- The gateway's `listOrders` then answers its default page: `const limit = query.limit ?? 50` (`procurement.service.ts:3155`).
- It orders by `created_at` alone (`:3207`), counts exactly, and reports `hasMore: fromIndex + orders.length < total` (`:3269`).
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

**2026-10-03 (PR-B forks; re-asked after the reboot lost the first ask):**

Labels quoted verbatim from the coordinator's record (project memory `founder-answers-2026-10-02-sim-share-out.md`, "F-140 PR-B forks, answered 2026-10-03"); the sentences are that record's. The questions and previews are saved in `p4-scratch/f140/prb-forks-asked-2026-10-03.json`. They close forks 1–3 below.

- **Station:** "Top of Delivered (Recommended)". The four open arrivals (not counted yet, counted but not checked, waiting on the invoice, backorder) stay in Delivered, listed first with their mark and always shown. Finished deliveries sit below, behind 'Show older'. No new tab, and no backorder moved to Ordered. (PR-B's design input had placed backorders under Ordered; this ruling overrides it.)
- **Empty tab:** "Newest 50 at once (Recommended)". A station with nothing open opens on its newest 50 finished orders, with 'Show older' below. It never looks empty when it isn't.
- **Cancelled:** "Keep them out (Recommended)". 'Show older' leaves cancelled and rejected orders out, as today, and the separate cancelled count stays.
- **Fork 4** was **not** ruled. PR-B keeps PR-A's reading; it stays open below.

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
- **Completeness:** a read is called whole only when the distinct ids equal `total`.
  - Otherwise it reads once more.
  - Then it **degrades**: every open status this client can name is swept on its own, and every closed status is counted with a `limit=1` read.
  - The result is marked `partial`, with the reason `unstable`.
  - A status this client cannot read is filed open, and a whole read lists it with the open orders. The sweep cannot ask for a status it cannot name, so a degraded read keeps such an order only as the unfiltered pages it read showed it, and counts the rest in `unclassifiedCount` (`total` less the per-status counts, floored at 0).
  - `openComplete` is true for a degraded read only when the per-status counts add up to `total` exactly. Below it, orders of a status no sweep can name may be missing. Above it, an order moved status (or was placed) between the sweeps and the counts, and the surplus can hide such an order while the floor reads 0.
  - `openComplete` is also false when an open sweep does not hold still after two tries.
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
  - This PR wires no outside caller to `markBackground`, so every websocket-triggered read is urgent until PR-B. [PR-B, 2026-10-03: `lib/websocket.tsx` is not changed, and still no caller is wired to `markBackground`. Fork 6 (how soon a realtime push re-reads) was not answered before the build, so `useOrderBook` does **not** yet hear the window `order_change` itself, and no option of fork 6 was built. A websocket order event still reaches the book, urgent, through its `orders.all` invalidation (`websocket.tsx:646`, `:664`). An `order_change` from `RealtimeContext.tsx` alone (the cross-device bridge, `:288-306`, and `dispatchOrderUpdate`, `:394`) reached /orders through `useOrders` (`useOrderQueries.ts:32-38`) and now reaches it only at the runner's 60 s interval. See "PR-B" below.]
- **The fence.** `noteLocalWrite(house)` bumps the house's write epoch. A read that started before the bump is not written to the cache; an urgent read replaces it.
- **A house switch** aborts the other house's read. A book is only written under `orders.book(<the house it read>)`.
- **`useOrderBookFreshness(house)`** returns `{asOf, failing, stale}`. `stale` means older than twice the interval, or failing. `asOf` null means the book has not been read yet, not that it is fresh.
- **Retries.** `retryOrderBook` turns off TanStack's retry for 429s, house changes, rows of another house and bad pages.
- **The approve write stays where it is.** The optimistic approve write on `orders.list` (`useOrderQueries.ts:147-182`) is unchanged. [PR-B, 2026-10-03: the list write stays byte for byte. The approve also patches its one row in the book and holds the house's book reads (`holdLocalWrite`): a read under way stops, and its callers wait for the next one; no read starts until the approve settles, or 35 s at most. Past 35 s reads run again, but the row keeps the approve's status until it settles. A failed approve puts back only that row, only while it still reads as this tab wrote it. See "PR-B" below.]
- **The key** is `queryKeys.orders.book(house)`. It sits under `['orders']`, so every existing invalidation reaches it.

**Tests and mutation proof.** `order-book.test.ts` (49 tests) and `useOrderBook.test.tsx` (24 tests) use a fake gateway that pages as `listOrders` does (`__tests__/utils/fakeOrderGateway.ts`). Mutations were run from `cp -p` snapshots, never `git stash`, and every restore was compared byte for byte. 38 were run; 37 each failed at least one test and passed again when restored:

- the six the design rests on: dropping the paging loop; dropping the `restaurantId` check; pointing the reader at `/procurement/orders`; removing the fence; making background the default; restarting from page 1 on a 429;
- 16 more in the reader: `openComplete` set from the floored `unclassifiedCount` instead of an exact sum (the per-status counts above `total`); `retryAfter` not capped at the window; no house check after a page; no rows-over-limit, total-is-a-count, `hasMore`-is-boolean or status-echo check; `sweepStatus` always complete, or one attempt; `degrade` keeping every prefix row, or dropping prefix rows of a status it cannot name; `openComplete` ignoring `unclassifiedCount`; a row of another house read as `HouseChangedError`; `fetchOrderById` without its id check, its house check before the GET, or its house check after it;
- 15 more in the runner: no 429 gate; a background mark that never clears; a fence that does not move its waiters; the aborted branch off; `HouseChangedError` counted as failing; no staleness guard; callers resolved with the book read instead of the book kept; freshness dated from the book read instead of the book kept; a read nobody waits for started anyway; `retry: 1`, `refetchOnWindowFocus: true` or the default `refetchOnReconnect` in `useQuery`; `start()` ignoring a hidden tab; a hidden tab deferring an urgent read too; `retryOrderBook` retrying `ForeignRowError`.

One survives, re-run against the final tests: removing `run.next = null` from `stopOtherHouses`, so the house switched away from keeps its queued read. It gets no test. In the app the token is stored before the house changes (`AuthContext.tsx:625` before `:630`, `:835` before `:839`), and `assertHouse` runs before every GET, so that queued read sends nothing for the old house; its cost is one window slot and a swallowed `HouseChangedError`.

## PR-B: what /orders shows (2026-10-03)

PR-B (`fix/orders-wire-order-book-f140`) moves /orders onto the book: `useOrdersNextData` reads `useOrderBook()` in place of `useOrders()`. Reverting PR-B puts the page back on the newest 50.

**Each view, from the rulings.**
- **Pending, Approved, Ordered** hold open orders only (`stageOf`), so each lists every order it holds, newest first.
- **Delivered** lists every open arrival first, newest first, each with its mark (the Mark ruling; 'Receipt could not be read' also covers fork 4's rows). Finished deliveries follow under "Finished deliveries", 50 per tap of Show older. With no open arrival, the newest 50 show at once; once shown, they stay when an open order arrives (fork 8).
- **The All view** follows the same rule over every one-time order (fork 7).
- **Recurring** lists as before (fork 5): every order that carries a rule, open, finished and cancelled, newest first, an open arrival with its mark. Such an order is listed only there, even when it is open and owed; a child occurrence carries no rule and stays in its own stage.
- **Cancelled and rejected one-time orders** are in no list and not under Show older; the line under the list still counts them. Recurring lists its cancelled orders, as before (fork 5). A deep-linked cancelled order is said to be unlisted only when it is one-time.
- Show older says how many are not shown yet only in a whole read. A tap that needs older orders read counts only once they are in; a failed read leaves the tap unspent. Changing station or house starts again. A deep-linked order is always listed.

**Counts.** A whole read counts every order read. In a capped or partial read, Pending, Approved and Ordered are exact only when `openComplete`, and show — otherwise; Delivered, Recurring and both month figures show —, with a sentence giving the floor read; the cancelled count is the per-status count (CANCELLED + REJECTED + FAILED). A notice says which kind of read it was, one fact per line. At Recurring, a capped or partial read with nothing listed says it cannot tell whether any order repeats. These capped figures are fork 9: the List ruling says the figures cover every order, and past the cap they cannot.

**Show older past the cap** reads on from `nextClosedPage`, at most five pages a tap, through the same window and 429 gate as the book (`readOlderPage`). Rows already seen are skipped by id; a house switch aborts it.

**Deep links.** An id not among the rows read is asked for on its own (`fetchOrderById`, a query outside `['orders']`, per house and id) before the page says anything: up to three tries, about 3 s, since the reader folds a 429, a timeout and the gateway's not-found 500 into one 'unreadable'. Found, it is listed but not counted, and it is not refreshed while the page stays open. Not readable, the page says it could not be read and how many orders it was checked against, never that it does not exist, and offers Try again. The order is named by the first 8 characters of its id.

**Freshness and errors.** Rows are dated by `useOrderBookFreshness(house).asOf`, the start of the kept read. A failed refresh, the runner's own included, shows as a failed re-read over the kept rows. Reader errors are said in the house's words, never their own messages.

**Writes.** The approve patches its row and holds the house's reads until it settles. A read under way when it begins is stopped (`abort(HELD)`) and its callers wait for the read after the hold, so the page shows no error; the requests it already sent are spent. Without the hold, a read that starts after the optimistic write but before the gateway commits writes the old status back while the approve button is live again; the fence alone catches only reads already in flight. The hold lets reads run again after 35 s (past the client's 30 s timeout), but until the approve settles every read is written with the approve's row patched in, only while that row still has the status it had before; so a paused (offline) approve is not undone by a read. A bulk approve runs its approves one after another, and the next hold begins before the last release's read can start, so the whole batch costs one read. Cancel and mark-delivered write nothing optimistically and are not held. The two order sheets no longer ask for a second read after the one their own invalidation starts.

**Realtime: not built (fork 6 unanswered).** Fork 6 was to be asked before the build and was not answered, so PR-B adds **no** `order_change` listener to `useOrderBook`, wires no `markBackground` caller and adds no `notePush`; every option of fork 6 needs the listener, and a listener without `notePush` is option (a), so building one would have answered the fork. `lib/websocket.tsx` is not changed. What this costs until fork 6 is answered: a websocket order event (`websocket.tsx:646`, `:664`) still reaches the book through its `orders.all` invalidation and re-reads it urgently, as before; but an `order_change` dispatched by `RealtimeContext.tsx` alone (the cross-device bridge, `:288-306`, and `dispatchOrderUpdate`, `:394`) used to reach /orders through `useOrders`' subscription (`useOrderQueries.ts:32-38`) and now reaches it only at the runner's 60 s interval. The builder of fork 6's answer adds the listener in `useOrderBook.ts`, its test, and its claim rows (`BOOK-KEEPS-REALTIME-PUSHES`, and `NO-BACKGROUND-CALLER-WHILE-FORK-6-OPEN` under (a) or `PUSH-WAITS-PAST-ONE-REQUEST` under (b) or (c)); both drafted rows are in `.scratch/ecb5eae2/prb-revise/fix-orders-wire-order-book-f140.jsonl`.

**Weaknesses, stated.**
- Until fork 6 is answered, a change pushed only through `RealtimeContext` (another device, a local `dispatchOrderUpdate`) shows on /orders up to 60 s later (above).
- The hold pauses all of that house's book reads, pushes and the interval included, for one approve (at most 35 s).
- A status this app cannot name is still filed as pending (`normalizeOrderStatus`), so in a whole read it is listed at Pending with a live Approve.
- The order sheets still wait, before closing, for the whole read their invalidation starts.
- In a capped read the month figures show — even when the newest 3,000 cover the month: the read is ordered by `created_at`, the month by `requestedAt`.
- Show older past the cap is offset paging: an order placed meanwhile pushes later pages down (repeats are skipped by id); an order removed meanwhile would skip one.
- "Newest" is by `requestedAt`, as before; an order without one sorts last.
- No line says the rows are old while reads succeed but lag (a tab just brought back); only a failed read is said.
- During a failing refresh, a deep link that cannot be read is said only by the error alert.
- In a capped or partial read, Show older gives no count.
- A capped house's first read is at least 42 list requests against the tab's 40 a minute, so the list first shows after more than a minute; so does an unstable read above about 1,400 orders (2 tries plus the sweeps). Show older waits on the same window. The fix needs `order-book.ts` (open sweeps before closed pages, or a lower ceiling): PR-C.
- The 40-a-minute window is per tab. The gateway's 100 a minute is per address and route, and `/history` is shared with the dashboard and the phone. PR-A's 429 gate learns only from this tab's own 429s. A window shared across tabs is PR-C.
- Rewording Recurring's existing sentences, which say "page" and "book" (`recurrence.ts:141`, `:261`, `:268`, `:278`), was left to a later PR to keep PR-B at 15 files.

**Tests and mutation proof (PR-B).** 67 new tests: `useOrdersNextData.book.test.tsx` (29: the pure `stationView` and `figuresFor` cases, the hook's freshness, errors, Show older and deep-link cases, A15 (a)–(f)), `OrdersNext.older.test.tsx` (18), `OrdersNext.deep-link.test.tsx` (15 → 20) and `useOrderBook.test.tsx` (24 → 39: holds, overlays, `readOlderPage` and `useApproveOrder`). E3, the listener's test, is not written (fork 6). The full web suite passes, 5,438 with 11 skipped, against 5,371 and 11 at `86224761d`; `tsc --noEmit` is clean. 55 mutations of the five source files, each made from a `cp -p` copy and restored from it, the worktree diff hashed equal after every run: 52 fail a test. Two failed only after a test was added for them: asking for a deep-linked order over a failed re-read of kept rows (A15 (f)), and a hold that its timer already let go letting go again when released (H3b). Three survive, each a second guard behind one a test holds: the release's own `released` flag (`unblock`'s `blocking` flag keeps the count right), `resetOrderBookRunnerForTests` zeroing `holds` (`runs.clear()` drops the run) and the hold bumping `writeEpoch` (the `HELD` abort stops the read the fence would catch). The 11 claim rows hold, and 21 named mutations each make one fail. /orders was not opened in a browser: every user-visible claim above rests on jsdom tests.

## Consequences

- **Easier.**
  - PR-B can show every open order when `openComplete` is true; when it is false, the book says the open list may be short.
  - Per-status counts cover the whole book in every mode: from the rows of a whole read, or from `statusTotals` in a capped or partial one. A whole read's counts come from one cached value. A degraded read's counts are separate reads taken at different moments. Month figures cover the whole book only in a whole read (see the narrowed ruling above).
  - Every later screen that needs the whole book has a reader with a 429 path, a house check and a completeness check, instead of `?? []`.
- **Weaknesses, stated.**
  - **`created_at` ties.** Until G2 adds `.order('id')` as a tiebreak, two orders with one `created_at` can swap across a page boundary.
    - The count check catches a swap that shows one row twice (distinct < total). That leads to a re-read, then the degrade.
    - It cannot make the read stable, and a house with many tied rows may live in `partial`.
  - **The insert-only assumption.** The count check proves a whole read only while no order *leaves* the unfiltered list mid-read.
    - A row deleted mid-read shifts the later pages up and skips one row, while the stale deleted row is still counted, so distinct = total and the read is accepted.
    - What was checked:
      - `DELETE orders/:id`, the only `@Delete("orders` route in `apps/api-gateway/src`, is documented as a cancel (`procurement.controller.ts:307-310`); its service body was not read;
      - a grep of `.from("procurement_orders")` call sites in `apps/api-gateway/src` and `services/` found one `.delete(` within three lines, in an e2e test's cleanup (`communications/tests/email-convo-flow.e2e.spec.ts:129`), and none outside spec files.
    - That is evidence, not proof. SQL functions and crons were not swept.
  - **A null count passes as whole.** `listOrders` sets `total = count ?? orders.length` (`procurement.service.ts:3262`). If the exact count ever came back null, a first page of 100 would report `total` 100 and `hasMore` false, and the reader would accept it as the whole book. With `count: "exact"` this is not expected; it is not guarded.
  - **100 per page is transport only.** The reader asks for 100 rows a page. The ruling's "50 per tap" is display, and PR-B slices 50 per tap from what was read.
  - **The cached book outlives a sign-out.** Nothing clears the React Query cache on sign-out. A second user who signs in to the same house in the same tab could see the first user's cached book until it is refreshed (up to the 60 s interval). `orders.list(house)` has the same hole today; the book holds more rows.
  - **Mobile shares the bucket.** The phone reads `/history` too (`apps/mobile/src/api/queries.ts:111`). A phone behind the same network address shares the bucket.
  - **The dashboard shares the bucket.** The dashboard reads `/history` (`useDayOrders`, `useDashboardNextData.ts:415-470`, its `getOrderHistory` call at `:447`; `useOrderQueries.ts:93`) from the same browser, outside this runner's window.
  - **The window does not cover them.** The 40-per-tab window counts only book reads, so book reads, dashboard reads and a second tab can still reach 100 together. The 429 path absorbs that; it does not prevent it.
  - **Request cost.** A capped read costs at least 42 requests: 30 pages, 8 open sweeps and 4 counts. Under the 40-per-60s window it spans more than a minute. A read that does not hold still reads its pages twice and then degrades: at least 2 × its pages + 12.
  - **A status this client cannot name, in a degraded read.** Such an order is kept only as the unfiltered pages the read went through showed it. One those pages did not show (past the ceiling, or skipped by a read that did not hold still) is not listed at all, and the book says so (`unclassifiedCount`, `openComplete` false). The gateway references only the twelve enum members (a grep of `ProcurementOrderStatus.` in `apps/api-gateway/src`); string-literal and SQL writers were not swept.
- **Revisit when:**
  - 429s are observed from one address (reconsider options 2 and 3);
  - a house's book is routinely `partial` (G2 is late, or the insert-only assumption is wrong);
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
| `markBackground` for realtime pushes, and the `order_change` listener | the founder (fork 6, unanswered at the build) | Neither is built in PR-B. Websocket-triggered book reads stay urgent (settled, not gapped); an `order_change` from `RealtimeContext` alone reaches /orders only at the 60 s interval. Fork 6's answer brings the listener, its test and its claim rows (see "PR-B") |
| `useOrders` still reads the newest 50 for /calendar (`useCalendarNextData.ts:538`) and /vendors (`useProvidersNextData.ts:51`) | their lanes | Outside /orders, so outside PR-B by the Scope ruling |
| The sheets await a whole read after a save (`AgreementSheet.tsx:333`, `NewOrderSheet.tsx:380`, `RecurrenceSheet.tsx:210`) | this lane, a later PR | About 400 ms more under 100 orders; a capped house can keep a sheet saving past a minute. Stop awaiting the invalidation |
| An unknown wire status reads as pending with a live approve die | O4 | Pre-existing; PR-B lists every such order now, so it shows more often |
| First paint of a capped house (≥ 42 list requests against 40 a minute per tab) and of an unstable read above about 1,400 orders; a request window shared across tabs | this lane, PR-C | Needs `order-book.ts` (open sweeps before closed pages, or a lower ceiling) and, for the shared window, the runner and a cross-tab channel. Outside PR-B's 15 files |
| Recurring's sentences that say "page" or "book" (`recurrence.ts:141`, `:261`, `:268`, `:278`) | this lane, a later PR | Named for founder review in PR-B; rewording them would be a 16th file |

## Forks for PR-B (1–3 answered by the founder on 2026-10-03; 4–9 open)

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
   - The ruling names that text for `readable: false` only, so this extension is a default for review, not a ruling.
   - **Not ruled (2026-10-03). PR-B keeps PR-A's reading: these rows show 'Receipt could not be read'.**
5. **Does the Recurring station follow the open-first rule, and where do open recurring orders show?** It lists every order that carries a rule — open, finished and cancelled — newest first, as before, now over every order read; in a capped read its count shows —. Such an order is listed only there, so a recurring order that arrived and is not counted, or a recurring backorder, is not at the top of Delivered (the Station ruling does not name recurring orders). A child occurrence carries no rule and stays in its stage.
   - Sketch: (a) as before (PR-B builds this); (b) open first, finished behind Show older, cancelled out, like the one-time stations; (c) as (a), and an open recurring arrival is also listed at the top of Delivered with its mark.
6. **How soon does a realtime push re-read the orders?** Before PR-B a push re-read one request of 50. A book read is about 6 list requests at Tuzlu (about 525 orders, sim ledger, not re-measured), and 42 or more past 3,000. The tab's window allows 40 list requests a minute; the gateway allows 100 a minute per address on `/history`, a bucket the dashboard and the phone share.
   - (a) **Urgent:** a push re-reads after the 400 ms settle. A change shows within about half a second. A steady stream costs up to 40 list requests a minute per open tab, so three tabs or devices on one address can ask 120 against 100, and the 429 is said as "too many reads in a short time".
   - (b) **Background:** every push waits out the 30 s gap after the last read. About 2 reads a minute, about 12 list requests a minute per device at Tuzlu. A change made elsewhere can show up to 30 s later, in every house.
   - (c) **Background only where a read costs more than one request** (the plan's recommendation): a house of 100 orders or fewer keeps (a), at 1 request a read as before; a bigger house gets (b).
   - **Not answered at the build (2026-10-03), so none is built:** PR-B has no `order_change` listener (see "PR-B: Realtime"). Each option is a change to `useOrderBook.ts` only; `lib/websocket.tsx` stays unchanged.
7. **Does the All view follow the Empty tab ruling?** The rulings name stations. PR-B treats the All view as one: every open order first; with nothing open, the newest 50 finished at once; Show older below.
   - Sketch: (a) as PR-B does; (b) only open orders until Show older is tapped.
8. **Once a station has opened on its newest 50, does an open order arriving fold them away?** The Empty tab ruling covers a station with nothing open; it does not say what happens when an open order then arrives (a push, another device).
   - Sketch: (a) the 50 stay shown, the open order on top (PR-B builds this); (b) they fold back behind Show older, as if the station had opened with that order.
9. **Past the cap, what do the figures show?** The List ruling says the figures cover every order; past 3,000 orders, or in a read that kept changing, they cannot.
   - Sketch: (a) Delivered, Recurring and both month figures show — with a floor sentence; open stations exact when every open order was read; cancelled from the per-status totals (PR-B builds this); (b) Delivered from the per-status totals, which also count recurring orders, so Delivered would mean something different in a whole and a capped read; (c) a count route at the gateway, outside PR-B (no gateway change).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (Proposed) with PR-A on `fix/orders-paged-fetch-f140` |
| 2026-10-03 | Internal audit (correctness and adversarial), branch head `752189ac2` | Findings fixed in `833776ac9` |
| 2026-10-03 | Internal re-audit, branch head `833776ac9` | Findings fixed in `86224761d` |
| 2026-10-03 | — | PR-B on `fix/orders-wire-order-book-f140` (stacked on #598): /orders reads the book. Records the Station, Empty tab and Cancelled rulings; forks 1–3 closed, fork 4 kept open, forks 5–9 added. Fork 6 was not answered before the build, so no `order_change` listener was built. Still Proposed |
| 2026-10-08 | PR audit gate (ADR 0090), head `1e5f3bae3` | BLOCK, on the record only: forks 1 to 3 shown open, stale citations, the cap narrowing the ruling unstated. Two code findings (the `openComplete` sum, the `retryAfter` cap) fixed with tests in the same round |
