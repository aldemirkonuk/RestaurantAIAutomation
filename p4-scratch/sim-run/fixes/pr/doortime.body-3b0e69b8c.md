> **[2026-10-07 21:07Z, coordinator, push] Pushed head `3b0e69b8c`.** It merges origin/main `a323cc80b` (#613, the location editor) onto `12a1c6b6f`; the only conflict was the README index (both rows kept by `merge_main.sh`). At this head: the six fast guards exit 0, gate ownership `[]`, files 15, decision claims **936/936** (Python 3.11). The fresh audit owed after the BLOCK at `f930e6958` runs on this head.

> **[2026-10-07 20:49Z, coordinator, push] Pushed head `12a1c6b6f`** for the ADR 0090 BLOCK at `f930e6958` (comment 6046510692), which was on prose only. One docs commit:
> - ADR 0286:15 brackets the Context sentence that still called the as-of control open, with the founder's 13:51:58Z answer "Add a date control (Recommended)". The as-of revisit trigger (:59) is marked fired with what the revisit found; the `too_old` trigger stays. A changelog row records the audit.
> - This body: the stale "not asked and stays open", "Not pushed" and "renumber at merge" lines are bracketed in place (old words kept).
>
> At this head: the six fast guards exit 0, gate ownership is `[]`, files = 15. Only ADR 0286 changed since `f930e6958`, and no CLAIMS row reads that file, so the claims guard was **not re-run** (929/929 at `f930e6958`). A delta re-audit is owed.

> **[2026-10-07 20:01Z, coordinator, push] Pushed head `f930e6958`.** It merges origin/main `ca3582988` (#649: a tables spec fixture and one claims row) onto `796aab9ce`. The merge was clean and touched no lane file. At this head:
> - Lane jest with `read-whole-window.spec.ts` passes **123/123**, and lane vitest **18/18**.
> - The six fast guards exit 0, gate ownership is `[]` and files = 15.
> - Decision claims hold **929/929** (Python 3.11).
>
> A delta re-audit against the PASS at `78c0f16e5` is still owed before merge.

> **[2026-10-07 13:59Z, coordinator, push]** Pushed head **`796aab9ce`**. It builds on `78c0f16e5`, where the fresh ADR 0090 audit **PASSED** (both reviews APPROVE WITH NOTES, final HOLDS; comment 6039021685), with two commits:
> - `a7ed34b80` (docs only) records the founder's answer to **follow-up 5, the read-side as-of control**, given 2026-10-07 at 13:51:58Z. The verbatim pick is *"Add a date control (Recommended)"*. ADR 0286 quotes the question, the pick and both rejected options. The work goes to two follow-up PRs: the till's last-day dash per ADR 0290, then the control itself. Nothing changes here. README row 0286 no longer calls follow-up 5 unasked. The commit also corrects follow-up 7's answer time from "~15:10Z" to **15:13:54Z**, the transcript's stamp, in the ADR and the tech-debt note. The audit asked for that correction.
> - `796aab9ce` merges origin/main `b270a45b8` (#609). The merge was clean, and it touches none of this PR's files except the README index (by row).
>
> At this head the fast guards all exit 0, the branch is 15 files, gate ownership is `[]`, and decision claims hold 929/929 (Python 3.11). Jest was not re-run, because no code file changed since the PASS and the merge brought only analytics files. **This head is not audited:** a delta re-audit against the PASS at `78c0f16e5` is owed before merge.
>
> Owed and not done here (from the PASS): trim this body's superseded blocks below.

> **[2026-10-07 12:55Z, coordinator, push]** Pushed head **`78c0f16e5`**. It answers the ADR 0090 BLOCK at `be073f594` (comment 6037732398). That BLOCK was on prose only: three records called open what the same tree records as decided. Two commits since `be073f594`:
> - `4d0ac8a22` merges origin/main `5e6c0684e` (#620). The merge is clean. #620's migration is `20261223030000`; this PR's `20261223040000` stays later.
> - `78c0f16e5` changes docs and comments only. The migration header line and the `delivered_at` comment in `receiving.service.ts` now say the backfill was declined (ADR 0286 follow-up 3); no SQL statement or code changed. README row 0286 now names only what is still open: follow-ups 1 and 8, and 5 (not asked, not filed). ADR 0286 and the tech-debt entry get dated brackets on their stale headings and lines, each keeping the old words.
>
> Lines in this body that called answered forks open were corrected in place on 2026-10-07. The 04:16Z block below describes `be073f594`; this block replaces it for `78c0f16e5`.
>
> At `78c0f16e5`:
> - The fast guards all exit 0. The branch is 15 files against `5e6c0684e`, and gate ownership is `[]`.
> - Decision claims hold 926 of 926 (Python 3.11).
> - Gateway jest (`receiving.spec.ts` and `src/notifications`): 29 suites, 506 tests pass.
> - Local Postgres was not re-run. The migration change is one `--` line, and the column comment is untouched.
>
> This head is not audited. A fresh full audit is owed before merge.

> **[2026-10-07 04:16Z, coordinator, push; updated 04:32Z]** Pushed head **`be073f594`**. It builds on this body's last-call head `d14e8f1cd` (the branch was at `d9fd02b9f` before this push) with these commits:
> - `7ff9cb737` merges origin/main `5c07cfb23` (#622). Its one conflict was the ADR index README, resolved by keeping both rows. Against main, the README gains only this PR's row.
> - `8e80e296c` renumbers the migration from `20261222190000` to **`20261223040000`**. It is a rename only, with no content change.
> - `5c286489a` quotes the founder's answer on the back-dating floor in ADR 0286 follow-up 7 and closes its register entry. Docs only.
> - `75a4ad9ba` quotes the founder's answer on the backfill in ADR 0286 follow-up 3 and closes its register entry. Docs only.
> - `4b1dd3910` merges origin/main `42fe1252b` (#651). This merge was clean (`git merge-tree` exit 0).
> - `be073f594` quotes the founder's answers on follow-ups 4 and 6 (below) in ADR 0286 and closes follow-up 6's register entry. Docs only.
>
> The renumber is the merge-step renumber that the body below asks for. Every `20261222190000` below is the old version, and the other in-flight versions it lists are stale too. The current versions are, all prefixed 20261223: #650 `…000000`, #617 `…010000`, #618 `…020000`, #620 `…030000`, and this PR `…040000`.
>
> At this head:
> - The fast guards all exit 0: migration order and uniqueness, OD ids, conflict markers, citation pairing, ADR numbers.
> - The branch is 15 files against origin/main `42fe1252b`.
> - Gate ownership is `[]`.
> - Decision claims PASS, 920 of 920 holding. They were run with Python 3.11, because `/usr/bin/python3` here is 3.9 and cannot run ADR 0224's host check.
> - Local Postgres was run at `8e80e296c`; the migration and tests are unchanged since. The result is in the coordinator's `audits/612-local-pg.txt`: every `[fix]` line PASS, every `[ctl]` line FAIL.
>
> This head is not audited. The BLOCK at `d9fd02b9f` stands until a fresh full audit of this head.
>
> **Founder answers to the "Forks answered" below, all by AskUserQuestion:**
> - **Back-dating floor**, 2026-10-06 ~15:10Z: verbatim pick *"No floor (Recommended)"*. The build stands as it is.
> - **Backfill of door rows written before the 72-hour rule**, 2026-10-06 19:52Z: verbatim pick *"Forward-only (Recommended)"*. The data migration that would re-date rows within 72 hours, and the variant that also re-dates older rows, are both rejected. No backfill migration and no production write follow. Rows recorded before this rule keep their entry date.
> - **A late sync onto an order whose status refuses the receipt**, 2026-10-07 04:29:14Z: verbatim pick *"Leave it, logged (Recommended)"*. This is as built: the order's `delivered_at` stays as it was, and the refusal is logged. *"Write it forward-only"* is rejected.
> - **Late-sync surfaces**, 2026-10-07 04:29:14Z: verbatim pick *"Door screen + bell (Recommended)"*. This is as built. A sync notice and a "taken X, dated Y" line stay possible follow-ups; neither is owed.
>
> No fork this branch raised is left open. The read-side as-of control (ADR 0286 follow-up 5) was not asked and stays open. It is outside this PR and is not filed yet. **[Corrected 2026-10-07: the founder answered follow-up 5 at 13:51:58Z, "Add a date control (Recommended)"; it is built in a follow-up PR, not here.]**

**Head `d14e8f1cd` (last call, 2026-10-06).** Not pushed; the coordinator pushes. **[Superseded: pushed since; the notes above are current.]** The branch is **15 files** against `origin/main` `4528b9689` (1,468 insertions, 29 deletions), and the worktree is clean. Since the last pushed head (`d9fd02b9f`) it adds:
- `bda3f2287` and `770d4c7ea`: record corrections, plus follow-up 2, which dates the stock ledger row;
- `d14e8f1cd`: claim text only;
- three clean merges of main: `bad2fc534` (#644), `f534823e0` (#627) and `72056f65c` (#621).

**[Done at `8e80e296c`: the migration is now `20261223040000`, past main's newest `20261223030000`. The rest of this block is the old state.]** **The merge step must renumber the migration.** Its version, `20261222190000`, is now behind main's newest, `20261222230000` (#621). `check_migration_order.py` fails on this until the file is renamed past main's newest version and past every open-PR version that merges first. Those are `20261222200000` (#617), `20261222210000` (#618), `20261222220000` (#620) and `20261223000000` (#650). The rename is a pure `git mv`. No prose cites the version: `git grep 20261222190000` outside `supabase/migrations/` finds nothing, because every record cites the migration by its slug (ADR 0235).

## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03, read-only)

The door works offline. The phone sends the moment of the tap as `clientCapturedAt`. The gateway stored that only in `procurement_receipt_events.client_captured_at`, and nothing read it.
- The event's `occurred_at` took `DEFAULT now()`.
- The order's `delivered_at` took the gateway's `new Date()` (`receiving.service.ts:565-566` at `661068ab3`).
- So every receipt that synced late was dated on the day it was entered.

What the owner saw:
- **A-011.** The 100 newest of 549 door deliveries read 2 October. That is 31 to 44 days after the tap times their phones sent (median 38). The sim sent each delivery's real date. That all 549 read 2 October is inferred.
- **A-008.** The vendor scorecard reads `delivered_at`. It said all five drinks suppliers were 0% on time (0 of 548) and 31 to 87 days late. The truth is 100% on time.
- **A-010.** `/reports` pacing put $39,302.50 of spend in the last 30 days, against $0 before. The real spend was July $24,588.50, August $20,169.00 and September $754.
- **The door's half of A-007.** A sampled item's `/inventory` activity read in 98 and out 48 on 2 October, and 0 on every other day. The door's stock movement was stamped `now()` too.

Out of lane: the POS half of AW03 (A-007's sales velocity, A-009) belongs to `postime`, #603, which is merged. This PR does not touch `pos-hub`, and it does not change `apply_stock_movement`. It only passes that function the `p_occurred_at` argument #603 added.

## What changed and why

The founder ruled on C02 (see "Founder answers"). ADR 0286 records the ruling, which is **Locked**, and this lane's method, which is **Proposed**.

**`resolveFactTime`** (`apps/api-gateway/src/common/fact-time.ts:84`) holds the rule in one place. It is shared code because the ruling also covers counts and orders.
- A sent time up to 72 h old is the fact's time (basis `sent`). The 72 h are measured from when the gateway receives the request, inclusive: exactly 72 h stands, and 72 h plus 1 ms does not.
- An older sent time stands only when the token's role in its house is owner or manager (basis `back_dated`). The role comes from the token (`receiving.controller.ts:294`), never from the body.
- A phone clock up to five minutes ahead is clamped to the receipt (basis `sent`, reason `clamped_ahead`). A clock further ahead is not trusted from anyone.
- Otherwise the server's own time dates the receipt (basis `server`). Whatever the phone sent is kept as evidence in `client_captured_at`.

**The door** (`recordDoorReceipt`):
- The event writes `occurred_at` (the fact's time) and `occurred_at_basis` (`receiving.service.ts:373-374`). For `server` it sends no `occurred_at`, so `DEFAULT now()` stamps it, equal to `created_at`. `created_at` stays the entry time.
- **A retry never decides again.** On the duplicate key (23505) it reads back the stored `occurred_at`, basis and `client_captured_at` (`:433`, `:461`). A retry that arrives after the 72-hour line therefore cannot re-date a receipt.
- **The stock ledger row is dated by the event's stored time.** The door passes `p_occurred_at: factTime.at` (`:600`), which `apply_stock_movement` applies as `LEAST(COALESCE(p_occurred_at, now()), now())`.
- **`delivered_at` follows the event's time, forward only.** The write is `.or(delivered_at.is.null,delivered_at.lt."<at>")` (`:692-695`), so a truck that syncs late cannot pull back a later truck's time.
- **The order write no longer swallows errors.** It is two updates: the status, then `delivered_at`.
  - A class-23 refusal from the order's own transition trigger (for example a CANCELLED order) is permanent. It is logged at error level, and the order is left as main left it (`:663`).
  - Any other status error, and any `delivered_at` error, returns a 503 (`order_write_failed`, `order_delivered_at_failed`). The outbox retries it, and the retry converges because the event and stock keys are idempotent.
- The response carries `factTime { at, basis, sentAt, reason }` (`:756`).

**The bell** (`delivery_recorded`) now windows and orders its sweep on `created_at`, the entry time (`delivery-recorded.producer.ts:114`). Before this change, a receipt dated 60 hours ago and synced an hour ago would never ring. Its sentence (`:317`) now says when a receipt was back-dated, or why the phone's time was not used.

**The door screen** shows one quiet line (`data-ux-key="door:dated"`, `DoorNext.tsx:866`) when the receipt sends while the screen is open and the phone's time did not stand, or stood only as back-dated. A receipt that sends later from the queue is announced by the bell, per ADR 0262.

**Migration `a_door_receipt_says_which_clock_dated_it`** adds `occurred_at_basis` (text, nullable, no default) and two CHECKs:
- the basis is `sent`, `back_dated`, `server` or NULL;
- a `sent` or `back_dated` row carries the `client_captured_at` it was judged by.

NULL marks a row the rule did not date. That is either a door receipt from before the rule or a row the door does not write, such as `verifyReceipt`'s `reconciled` events. The migration has no time CHECK (ADR 0286 option 6). It rewrites no row and does not touch the append-only trigger (ADR 0227).

## Tests, guards and the local Postgres harness

Measured at last call on `72056f65c`. `d14e8f1cd` changes only the claim text in one JSONL file.

- **Gateway.** `receiving.spec.ts` and `delivery-recorded.producer.spec.ts`: **79 of 79 pass**.
  - Mutation at last call: with the `delivered_at` write changed back to `new Date().toISOString()`, `receiving.spec.ts` gives **4 failed, 60 passed**. The file was restored from a snapshot and the tree is clean.
  - Earlier rounds, at `770d4c7ea`:
    - main's `receiving.service.ts` swapped in: 8 failed, 56 passed;
    - main's `delivery-recorded.producer.ts` swapped in: 5 failed, 10 passed;
    - the `p_occurred_at` argument removed: the 4 `[REVERT-FAILS]` cases that assert it fail.
- **Web.** `vitest run DoorNext.test.tsx src/lib`: **49 files, 682 tests pass**. In an earlier round, with main's three web files swapped in, 4 failed.
- **Typecheck.**
  - Gateway (`tsconfig.spec.json`): 0 errors outside the existing `@simplewebauthn/server` ones.
  - Web: only the existing `@simplewebauthn/browser` error in `passkeys.ts`.
  - Both of these errors are on main too.
- **ESLint.**
  - The 6 gateway lane files: 0 errors. The 44 warnings are existing prettier ones.
  - The 4 web lane files: `--quiet` rc=0.
- **CI guards.**
  - The 81 `scripts/check_*` invocations in `ci.yml` (guards and `--self-test`s) all return rc=0. So do `check_new_tables_are_locked_down.py --self-test` and `check_migration_order.py --self-test`.
  - `check_migration_versions_unique.py`: OK against `origin/main` plus 73 open PRs.
  - `check_adr_numbers_unique.py`: OK, checked against 1,732 refs.
  - `check_migration_order.py --event pull_request --base-ref main`: **FAILS** (behind `20261222230000`). See the top note: the merge step renumbers. **[Superseded: passes since the renumber at `8e80e296c`.]**
  - `check_gateway_boots.sh` was not run.
- **CLAIMS.** `check_decision_claims.sh`: **908 of 908 holding** at `d14e8f1cd`. `test_check_decision_claims.sh`: 31 ok, 0 failed. Earlier rounds mutation-tested every lane row:
  - each resolved row fails when its target is reverted;
  - each open row exits 1 today and holds when its fix is pasted into a scratch copy.
- **SQL (local Postgres 17; CI never runs `supabase/tests`).** The two tests live outside the repo because this PR is at the 15-file cap:
  - `p4-scratch/sim-run/fixes/audits/doortime-occurred-at-basis_test.sql` (T1-T11): the column's shape, both CHECKs, the clamped case, NULL for `reconciled` rows, and the append-only trigger still refusing.
  - `doortime-door-ledger-date_test.sql` (D1-D3): `apply_stock_movement` with the door's own argument set.
  - Both are synthetic, run in one transaction and roll back. Output at `72056f65c`, appended to `p4-scratch/sim-run/fixes/audits/doortime-local-pg.txt`:

```
applied 7 migration(s) to doortime_fix
[fix] PASS doortime-occurred-at-basis_test.sql
[fix] PASS doortime-door-ledger-date_test.sql
[ctl] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T1 FAIL: occurred_at_basis is <NULL>, notnull <NULL>, hasdef <NULL> (want text, nullable, no default)
[ctl] FAIL doortime-door-ledger-date_test.sql: ERROR:  function public.apply_stock_movement(p_inventory_id => uuid, ... p_occurred_at => timestamp with time zone) does not exist
template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=7 tests=2
# no test args (the in-repo tests the branch carries over the template, all main's):
[fix] PASS 6/6  (…order_letter…, …pos_sale_is_dated…, …ledger_lists_only…, …old_pos_rows…, …tills_own_record…, …tables_learned_from_the_pos…)
[ctl] FAIL 6/6
```

  The ledger test's `[ctl]` failure comes from #603 being absent from the template (`28d32de36`), not from this lane's migration. What pins the door passing the argument is `receiving.spec.ts`.

## ADR, CLAIMS and register touched

- **ADR 0286** (new): *A sent time is the fact's time for 72 hours; older needs a manager.* The ruling is Locked and the method is Proposed. Its index row in `.planning/decisions/README.md` is this branch's own, and it says "Built for door receipts only".
- **`claims.d/fix-door-keeps-the-arrival-time.jsonl`**: 5 resolved rows and 3 open ones.
  - Resolved: the door dates by the rule; `delivered_at` moves forward only; the basis vocabulary and column comment; the bell's window on entry; the door's stock movement is dated.
  - Open, each exiting 1 today: `ADR-0286-DOOR-COUNT-ROUTE-USES-THE-RULE`, `ADR-0286-DELIVERY-CREATE-USES-THE-RULE` and `ADR-0286-RETROACTIVE-ORDER-USES-THE-RULE`.
- **`tech-debt.d/2026-10-04-fix-door-keeps-the-arrival-time.md`**: 4 CLOSED entries, 1 ANSWERED and 2 OPEN.
  - CLOSED: receipt dating; the stock-movement date; a late sync onto an order that refuses the receipt (no change); no floor on back-dating (no change). ANSWERED: backfill (forward-only, no change).
  - OPEN: the door-count and delivery-create routes; the retroactive-order route.

## Founder answers (verbatim)

- **C02, 2026-10-04 ~00:15Z, AskUserQuestion.** Pick: *"72 h; older needs a manager (Recommended)"*. Option text: *"A sent time within 72 hours is kept as the fact's time. An older one is kept only from an owner or manager and is marked back-dated. Applies to door receipts, counts and orders."* **Built for door receipts.** Counts and orders are not built here; see "Not covered".
- **Door split, ~00:50Z.** Pick: *"You build, R3 rebases (Recommended)"*: this session builds `doortime` with surgical edits, and R3's later door-release PR builds on top.
- The read-side as-of control (which date a report reads by) was **not asked** and stays open. **[Corrected 2026-10-07: answered at 13:51:58Z, "Add a date control (Recommended)"; follow-up PR.]**

## Forks answered (each was the founder's; he picked the recommended option every time, so none changes this PR's code)

- **Backfill of rows written before the rule.**
  - (a) Forward-only. **This is what the PR does, and the recommendation.**
  - (b) A data migration that re-dates `delivered_at` from the latest door event's `client_captured_at`, where that is within 72 h of the event's `occurred_at`. It fits the rule and needs no role. It fixes none of Tuzlu's rows, whose captures were 31-44 days old.
  - (c) (b), plus older rows where the receiver is an owner or a manager today. That guesses the role at the time, and the append-only trigger refuses marking the events `back_dated`. Not recommended.

  Under (a), Tuzlu's existing orders keep 2 October, and its scorecard (0 of 548), pacing ($39,302.50) and sales chart stay as they are. A re-run on the same house does not fix them, because `delivered_at` only moves forward. Only new orders (a fresh or reset house) or a backfill would. (b) was rejected on 2026-10-06, so nobody needs to run this sizing query; it is kept for the record (it was run only on an empty local database):

  ```sql
  BEGIN READ ONLY;
  WITH latest AS (
    SELECT DISTINCT ON (e.order_id) e.order_id, e.restaurant_id, e.occurred_at, e.client_captured_at
      FROM public.procurement_receipt_events e
     WHERE e.stage = 'case_count'
     ORDER BY e.order_id, e.occurred_at DESC, e.id DESC
  )
  SELECT l.restaurant_id,
         count(*) FILTER (WHERE l.client_captured_at IS NOT NULL
                            AND l.occurred_at - l.client_captured_at BETWEEN interval '0' AND interval '72 hours'
                            AND o.delivered_at > l.client_captured_at) AS option_b_would_redate,
         count(*) FILTER (WHERE l.client_captured_at IS NOT NULL
                            AND l.occurred_at - l.client_captured_at > interval '72 hours') AS older_than_72h_left_as_is,
         count(*) AS door_booked_orders
    FROM latest l
    JOIN public.procurement_orders o ON o.id = l.order_id AND o.restaurant_id = l.restaurant_id
   GROUP BY l.restaurant_id;
  ROLLBACK;
  ```
- **A floor on back-dating.** An owner's or a manager's sent time stands at any age as `back_dated`, even one from before the order was placed. The door sends the phone's clock at the tap (`DoorNext.tsx:468`), so a manager's phone whose clock runs more than 72 h behind is kept the same way. The ruling names no floor.
  - (a) No floor, as built. **Recommended.** The mark, the entry time and the bell's sentence show every back-dated receipt. Cost: a manager's phone with a clock far behind dates a delivery wrongly, and only the mark shows it.
  - (b) Not before the order existed. Cost: an order placed through the normal flow after its goods arrived, as in a back-filled history, could never be dated to its real day. (The retroactive-order route does take an `invoiceDate`, but it is ungated today; that is follow-up 8.)
  - (c) A fixed limit, for example 90 days. Cost: a new number, and a longer back-fill stops working.
- **A late sync onto an order whose status refuses the receipt** (COMPLETED, CANCELLED, REJECTED, FAILED, PENDING, APPROVAL_NEEDED, NEGOTIATING). The event and the stock are booked and dated, but the order's `delivered_at` is left as main left it, and the refusal is logged.
  - (a) As built. **Chosen on 2026-10-07: "Leave it, logged (Recommended)".** It is main's behaviour, now no longer silent.
  - (b) Write `delivered_at` forward-only even when the status write is refused. The status trigger fires only on `OF status`, so it would allow this. Cost: a closed or cancelled order's date moves.
- **Late-sync surfaces.**
  - (a) Built: the door screen while it is open, and the bell.
  - (b) A notice from each background sync result: one more file, a follow-up.
  - (c) "Taken X, dated Y" in the receiving desk's line history: a follow-up.

## Merge-order notes

- **No code file is shared with any open PR.** The only overlap is `.planning/decisions/README.md` (index rows, about 20 open PRs). On a conflict, keep both rows by number. This branch took current main (#621) at `72056f65c` with no conflict.
- **Migration**: renumber at merge (see the top note). **[Done at `8e80e296c`, `20261223040000`; renumber again only if main passes it before merge.]** It depends on #603's `apply_stock_movement(… p_occurred_at)`, which is on main. It must apply before the new gateway serves door receipts (see "Production effect").
- **`events` (#604, ADR 0284) and `postime` (#603, ADR 0281)** are merged and in this branch. The #604 trigger `AFTER UPDATE OF status, delivered_at` fires on both of the door's writes and ends on the fact's time.
- **R3 ref `fix/receipts-paper-owed`** (pushed, no PR) touches `receiving.service.ts` and `receiving.controller.ts`. Under the founder's door-split pick, R3 rebases onto this PR. `fix/receive-price-as-printed` touches no file of this lane.

## Production effect at merge

- **No existing row is changed.** The migration adds a nullable column with no default (catalog only) and two CHECKs. Each CHECK makes one validating scan of `procurement_receipt_events` under ACCESS EXCLUSIVE, with `statement_timeout` 120 s. Read-only sizing, if wanted: `SELECT count(*) FROM public.procurement_receipt_events;`.
- **Deploy order.** The door's insert and the bell's select both name `occurred_at_basis`. If the gateway comes up before the migration:
  - a door receipt fails with a 5xx, and the web outbox retries it;
  - the bell's sweep throws on its read and writes nothing, and a later sweep picks up the receipt inside its 48 h entry window.

  This is read from the code. No deploy was exercised.

## Not covered (shortcuts and limits, per CLAUDE.md §0.5)

- **Counts and orders, the other two-thirds of C02, are not built.** Doing them needs about 3 to 4 more files per route, which does not fit the 15-file cap, so it needs its own follow-up PR. Until then the routes stay ungated, though no client sends a time to them today:
  - `POST /procurement/documents/door-count` still accepts any `countedAt` from any role (`documents.controller.ts:862`, `:916`). The only web caller (`CanonicalDocumentPage.tsx:671` via `DoorFrame.tsx:88-92`) sends no `countedAt`.
  - `POST /procurement/deliveries` still accepts any `deliveredAt` from any signed-in role (`deliveries.controller.ts:102` → `canonical/delivery.service.ts:296`). The web only reads that path.
  - `POST /providers/:id/retroactive-order` still writes any `invoiceDate` to a new DELIVERED order's `delivered_at` and `requested_at` (`providers.service.ts:1201`, `procurement.service.ts:1236`). It has no web or mobile caller.

  Each route has an open CLAIMS row and a register entry (ADR 0286 follow-ups 1 and 8).
- **Old rows are not re-dated**: the founder declined a backfill on 2026-10-06 (ADR 0286 follow-up 3). Tuzlu's measured numbers (0 of 548, $39,302.50, 2 October) do not change when this merges.
- **The sim driver's role was not checked.** Its door calls (`recovered/inject-src/03987.js:27`) send 31-44-day-old capture times. On a fresh run they stand only if the session's house role is owner or manager; from staff, they are dated by the server.
- **The purchase lot is still dated at entry.** Its `inventory_lots.received_at` stays the entry time. A back-dated ledger row keeps the `quantity_before` and `quantity_after` computed at entry, as ADR 0281 records for POS sales.
- **The SQL tests are outside the repo** and run only on the local harness. CI re-checks the column comment's clauses statically through `ADR-0286-BASIS-VOCABULARY-CHECK`.
- **No Browser-pane check** of the `door:dated` sentence was run. It is covered only by `DoorNext.test.tsx`. The one-line `factTime` pass-through in `doorOutbox.submitDoorReceipt` has no test of its own.
- **`check_gateway_boots.sh` was not run.** The bell's `created_at` window was not measured with EXPLAIN. `created_at` is nullable and has no index of its own, and the sweep reads one house's events through `idx_pre_restaurant`.
- **`listUnverified`'s 500-event window is ordered by `occurred_at`.** A very old back-dated receipt can fall outside it. The response's `capped` flag says so.
- **Commit messages.** The merge commits `745c92deb`, `10a0ba06b`, `dbcb15e9c`, `bad2fc534`, `f534823e0` and `72056f65c` carry git's default message, with no body or trailer. `d9fd02b9f`'s body names a `scripts/sql_outside_migrations.txt` change that the commit does not make: no such line exists, and the commit is the rename alone. History is not rewritten.
- **Not seen by the lane verifier:** the last-call commits `72056f65c` (a clean merge of #621) and `d14e8f1cd` (the forward-only claim now quotes its two tests by their real titles). I checked both here with the tests, the guards and the harness above.
- **No live check.** Nothing was run against production or a live house; this lane forbids it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)





