PR #612 body delta, lane doortime, head 770d4c7ea (2026-10-06). Paste the block at the TOP of the body, above the f534823e0 block, then apply the in-place edits listed after it. Not pushed: the coordinator pushes.

---- TOP BLOCK ----

> **Fix round 1 after the review of `f534823e0`, 2026-10-06.** One new commit, `770d4c7ea`, on top of `f534823e0`. No history rewritten. The branch is still **15 files**, the same 15.
>
> - **A false record, corrected (major).** ADR 0286's Context said no order write accepts a sent time, and the PR body said it twice ("Founder answers"; fork (b)'s cost). That was false. `POST /providers/:id/retroactive-order` takes `invoiceDate` (`retroactive-order.dto.ts:95`, an optional string). `createRetroactiveOrder` passes it as `deliveredAt` (`providers.service.ts:1201`), and `createOrder` writes it to a new DELIVERED order's `requested_at` and `delivered_at` (`procurement.service.ts:1236`, `:1284-1288`). The route reads no role, draws no 72-hour line and marks nothing back-dated.
>   - Each sentence is corrected in place with a dated bracket: the ADR's Context and "Not changed", and both PR-body sentences.
>   - The route is not gated here. That needs the providers controller, service and spec, three files over the 15-file cap.
>   - It is now ADR 0286 **follow-up 8**, with an OPEN register entry and an open CLAIMS row `ADR-0286-RETROACTIVE-ORDER-USES-THE-RULE`.
>   - Mutation-tested in a scratch copy. The row exits 1 today. It exits 0 when `resolveFactTime(` is called in the service method or in the controller method. It reports "cannot open" if the method or the field is renamed.
>   - No web or mobile client calls the route (`grep -rln retroactive apps/web/src apps/mobile`: none). The sweep for other order writes that take a time found none: `markDelivered` stamps `new Date()` (`procurement.service.ts:5099`), and `alreadyFulfilled` has the one caller.
> - **Follow-up 2 is built (minor; it was unblocked).** The door's `apply_stock_movement` call passes `p_occurred_at: factTime.at` (`receiving.service.ts:600`), the argument #603 added. The ledger row's `transaction_date` is now the event's stored time, never later than now. A retry passes the first attempt's stored time.
>   - The purchase lot's `inventory_lots.received_at` stays the entry time. A back-dated ledger row keeps the `quantity_before`/`quantity_after` computed at entry, the same caveat ADR 0281 records for POS sales.
>   - Pinned by four `[REVERT-FAILS]` cases in `receiving.spec.ts`. All four fail with the argument removed (4 failed, 60 passed); the file was restored from a snapshot.
>   - `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED` is now resolved, and it fails with the argument removed. Its register entry is closed.
> - **Narrowed (minors).**
>   - The migration header said only the door writes `procurement_receipt_events`, and its column comment said NULL means "recorded before the rule". Both were broader than the code. `verifyReceipt` adds `reconciled` events with no basis, after the rule as well as before it (`procurement.service.ts:6477`, `:6581`).
>     - Comment text only, since the migration is unmerged. No column, CHECK or assertion changed.
>     - `ADR-0286-BASIS-VOCABULARY-CHECK` now also pins the comment's clamped and NULL clauses, statically. That is what CI can re-check while the SQL test stays outside the repo. Its claim names the scratch path and says who can run it. Mutation-tested: dropping either clause, or the comment itself, fails the row.
>   - "Stay wrong until the house is re-run" was too broad. `delivered_at` only moves forward, so a re-run on the same house does not re-date an order already dated 2 October, even when a receipt is sent again under a new idempotency key. Only new orders (a fresh or reset house) or a backfill would. Narrowed in ADR 0286 and in both register entries.
>   - The README index row (this branch's own) now says what is built: door receipts only, with the stock ledger dated too. Counts, the retroactive-order route, backfill, a refused order's `delivered_at` and a floor on back-dating are follow-ups.
>   - ADR 0286 option 10 now notes that the bell's window column, `created_at`, is nullable (`DEFAULT now()`, never overridden by the gateway) and has no index of its own. The sweep reads one house's receipt events through `idx_pre_restaurant` and filters them by stage and entry time. Not measured with EXPLAIN.
> - **Commit `d9fd02b9f`'s body is broader than its diff.** It says the rename was "git mv plus the matching line of scripts/sql_outside_migrations.txt". The commit is the rename alone. No line in `scripts/*.txt` names the migration (`grep -rn "a_door_receipt_says\|20261219140000\|20261222190000" scripts/*.txt`: none), so there was no line to change. History is not rewritten; this is the correction.
> - **Deploy order, restated with its evidence.** Both the door's insert and the bell's select name `occurred_at_basis`. If the gateway ships before the migration:
>   - a door receipt fails with a 5xx, which the web outbox retries;
>   - the bell's sweep throws on its read (`delivery-recorded.producer.ts:118-122`) and writes nothing.
>
>   Once the migration lands, receipts entered in the previous 48 hours (by `created_at`) are swept. This is read from the code. No deploy was run.
> - **Measured at `770d4c7ea`.**
>   - Gateway `receiving.spec.ts` + `delivery-recorded.producer.spec.ts`: 79/79.
>   - Typecheck (`tsconfig.spec.json`): no errors outside `@simplewebauthn/server`.
>   - ESLint on the two changed gateway files: 0 errors, rc=0. The warnings are existing prettier ones on lines this commit does not touch.
>   - All 77 `scripts/check_*.py` invocations in `ci.yml` (guards and `--self-test`s) rc=0. `check_migration_order.py --self-test` rc=0, and `--event pull_request --base-ref main` OK. `check_adr_numbers_unique.py`: no number wears two slugs.
>   - `check_decision_claims.sh`: 901 of 901 holding. `test_check_decision_claims.sh`: 31 ok, 0 failed.
>   - The web was not re-run, because no web file changed in this commit.
> - **SQL (local Postgres 17, template `28d32de36`; CI does not run it).** `doortime-occurred-at-basis_test.sql` gains T11: a `reconciled` row is accepted with a NULL basis, and the comment says NULL also marks rows the door does not write. A new out-of-repo test, `doortime-door-ledger-date_test.sql` (D1-D3), calls `apply_stock_movement` with the door's own argument set:
>   - D1: a 38-day-old `p_occurred_at` dates the ledger row; `created_at` and the lot's `received_at` stay the entry time.
>   - D2: a retry under the same key books nothing and keeps the first date.
>   - D3: a server-dated receipt is dated now.
>
> ```
> # HEAD f534823e0 (old comment):
> [fix] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T11 FAIL: the occurred_at_basis comment does not say NULL also marks rows the door does not write (verifyReceipt's reconciled events): ...
> [fix] PASS doortime-door-ledger-date_test.sql
> # HEAD 770d4c7ea:
> [fix] PASS doortime-occurred-at-basis_test.sql
> [fix] PASS doortime-door-ledger-date_test.sql
> [ctl] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T1 FAIL: occurred_at_basis is <NULL>, notnull <NULL>, hasdef <NULL> (want text, nullable, no default)
> [ctl] FAIL doortime-door-ledger-date_test.sql: ERROR:  function public.apply_stock_movement(p_inventory_id => uuid, ... p_occurred_at => timestamp with time zone) does not exist
> template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=6 tests=2
> ```
>
>   - The ledger test's `[ctl]` failure is #603's absence from the template, not this lane's migration. The pin on the gateway passing the argument is `receiving.spec.ts`.
>   - With no test argument, the five in-repo tests the branch carries over the template (all main's) PASS on `[fix]` and FAIL on `[ctl]`.
>   - The full output is in `p4-scratch/sim-run/fixes/audits/doortime-local-pg.txt`.
> - **Still not done here.** The door-count and delivery-create routes (counts; two open rows). The retroactive-order route (one open row). Backfill (fork). A late sync onto an order that refuses the receipt. A floor on back-dating (fork).

---- IN-PLACE EDITS (bracket and date them) ----

1. "## Not covered", "**Stock ledger.** The door's stock movement is still dated at entry. It waits on #603." -> [2026-10-06: built in `770d4c7ea`. The door passes `p_occurred_at`, and the row is resolved. The lot's `received_at` stays the entry time.]
2. "## Not covered", first bullet "**Counts, and the delivery-create route.**" -> append a sub-bullet: [2026-10-06: also the retroactive-order route, an order write that takes `invoiceDate` (ADR 0286 follow-up 8, open row `ADR-0286-RETROACTIVE-ORDER-USES-THE-RULE`).]
3. "## ADR, CLAIMS and register touched" -> [2026-10-06: claims 5 resolved, 3 open (door-count, delivery-create, retroactive-order). Register: 2 CLOSED (receipt dating; the stock-movement date) and 5 OPEN (door-count and delivery-create; backfill; a late sync onto an order that refuses the receipt; no floor on back-dating; the retroactive-order route).]
4. "## Not covered", the line about merge commit `745c92deb` -> append: [2026-10-06: commit `d9fd02b9f`'s body names a `scripts/sql_outside_migrations.txt` change it does not make; see the top block.]
5. The "Founder answers" sentence about orders, and fork (b)'s cost in the `f534823e0` block, are already bracketed in the draft files (`doortime.md`, `doortime.f534823e0.md`).
