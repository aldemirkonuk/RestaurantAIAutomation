PR #612 body delta, lane doortime, head f534823e0 (2026-10-05). Paste the block at the TOP of the body, then apply the in-place edits listed after it. Not pushed: the coordinator pushes.

---- TOP BLOCK ----

> **Rework after the review of `d9fd02b9f` (OVERTURNED), 2026-10-05.** That call found the code sound and the records false at the head. Three new commits, no code change. `bad2fc534` merges origin/main `1c0e8a696` (#644). `bda3f2287` corrects the records. `f534823e0` merges origin/main `54f833e4b` (#627). Both merges were clean. HEAD is `f534823e0`, the worktree is clean, and the branch is **15 files** (1,441 insertions, 29 deletions against `54f833e4b`).
>
> - **Stale dependency prose, corrected in place with dated brackets.** #603 (ADR 0281) and #604 (ADR 0284) were already in the reviewed head. Migration `a_pos_sale_is_dated_by_its_check` gives `apply_stock_movement` the argument `p_occurred_at timestamptz DEFAULT NULL`, and names the door's arrival time as a caller that reuses it. ADR 0286 (Order of landing, follow-up 2), the stock-movement register entry and the claim text of `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED` now say the argument exists and the follow-up is **unblocked but not done**: the door's call (`receiving.service.ts:570`) does not pass `factTime.at`. The row stays `open`. Its verify still exits 1 ("the door stock movement carries no date"). In a scratch copy it exits 0 when `p_occurred_at: factTime.at` is added to the call. Passing it would date only the ledger row's `transaction_date`. The purchase lot keeps `inventory_lots.received_at` at `DEFAULT now()`.
> - **The `occurred_at_basis` column comment is narrowed.** It used to say `sent` is always the phone's time. A phone clock up to five minutes ahead is clamped (`fact-time.ts:119`, `clamped_ahead`). That row is `sent`, but `occurred_at` is the moment the gateway received the request, earlier than the `client_captured_at` kept beside it. The comment, the migration's header and ADR 0286 options 3 and 6 now all say so. Only comment text changed: the `--` header and the `COMMENT ON COLUMN` string. No column, CHECK or assertion changed. `ADR-0286-BASIS-VOCABULARY-CHECK` still holds.
> - **Two new OPEN register entries (not decisions).** These are in `tech-debt.d/2026-10-04-fix-door-keeps-the-arrival-time.md`, and as ADR 0286 follow-ups 6 and 7.
>   - (a) **A late sync onto an order the status trigger refuses.** These are COMPLETED, CANCELLED, REJECTED, FAILED, PENDING, APPROVAL_NEEDED and NEGOTIATING. On such an order, `delivered_at` is left as main left it, and the refusal is only logged. The trigger is `BEFORE UPDATE OF status` only, so a `delivered_at` write on its own would not be refused by it. Whether the door should make that write is not decided. A retry after a failure between the two writes meets the same refusal if the order was completed in between.
>   - (b) **Back-dating has no lower bound.** This is within the ruling's wording, but no floor was decided. The question is under "Forks deferred".
> - **Narrowed so they claim no more than the code:** ADR 0286's first consequence, the CLOSED register entry, and this branch's own index row in `.planning/decisions/README.md`. Each now says the event is always dated, `delivered_at` only when the order accepts the receipt, and the stock ledger not yet.
> - **Measured at `f534823e0`.**
>   - Gateway `receiving.spec.ts` + `delivery-recorded.producer.spec.ts`: 79/79. Web `DoorNext.test.tsx` + `doorOutbox.test.ts`: 48/48.
>   - Typecheck: gateway 0 errors outside `@simplewebauthn/server`. Web: only the existing `@simplewebauthn/browser` error in `passkeys.ts`.
>   - ESLint `--quiet` rc=0 on the 6 gateway and 4 web lane files.
>   - All 43 python guards `ci.yml` invokes: rc=0. `check_migration_order.py --event pull_request --base-ref main`: OK.
>   - Self-tests rc=0: adr_numbers_unique, migration_versions_unique, migration_order, citation_pairing, od_ids_exist, no_conflict_markers, migration_probe_safety, new_tables_are_locked_down, no_seeded_defaults.
>   - `check_decision_claims.sh`: 900 of 900 holding. `test_check_decision_claims.sh`: 31 ok, 0 failed.
> - **SQL (local Postgres 17; CI does not run it).** The out-of-repo test `p4-scratch/sim-run/fixes/audits/doortime-occurred-at-basis_test.sql` gains T10: a clamped `sent` row is accepted, and the column comment names the clamped case. Template `28d32de36`.
>
> ```
> # HEAD bad2fc534 (old comment):
> [fix] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T10 FAIL: the occurred_at_basis comment does not say a sent row can be dated by the gateway's receipt of a clock up to five minutes ahead: ...
> [ctl] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T1 FAIL: occurred_at_basis is <NULL>, notnull <NULL>, hasdef <NULL> (want text, nullable, no default)
> # HEAD bda3f2287 (comment narrowed):
> [fix] PASS doortime-occurred-at-basis_test.sql
> [ctl] FAIL doortime-occurred-at-basis_test.sql: ERROR:  T1 FAIL: occurred_at_basis is <NULL>, notnull <NULL>, hasdef <NULL> (want text, nullable, no default)
> template=28d32de368d3f57df52ce6f490758908d9fa924d lane_migrations=5 tests=1
> ```
>
>   `lane_migrations=5` is this lane's migration plus four of main's that came after the template, all applied together. With no test argument, the harness runs the four in-repo tests the branch adds over the template, all of them main's. All four PASS on [fix] and FAIL on [ctl]. The full output is in `p4-scratch/sim-run/fixes/audits/doortime-local-pg.txt`.
> - **Not done here.** The stock-movement date (open row, unblocked). The door-count and delivery-create routes (two open rows). Backfill. The two new open entries. The two merge commits carry git's default message, as `--no-edit` writes it.

---- IN-PLACE EDITS (bracket and date them) ----

1. "## What was wrong", last line "This PR does not touch `pos-hub` or `apply_stock_movement`." -> still true; append: [2026-10-05: #603 is merged and in this branch; `apply_stock_movement` now takes `p_occurred_at`, which this PR does not pass yet.]
2. "Migration `a_door_receipt_says_which_clock_dated_it`" paragraph -> append: [2026-10-05: its column comment now says a `sent` row is dated by the phone's time, or by the gateway's receive time when the phone's clock was up to five minutes ahead.]
3. "## ADR, CLAIMS and register touched", tech-debt bullet "has 1 CLOSED entry and 3 OPEN ones" -> [2026-10-05: 1 CLOSED and 5 OPEN: the door-count and delivery-create routes; the stock-movement date; backfill; a late sync onto an order that refuses the receipt; no lower bound on back-dating.]
4. "## Merge-order notes":
   - "`events` (#604, ADR 0284)" bullet -> [2026-10-05: merged as `1aa4dcb8c`, in this branch.] Its "Its migration (`20261218150000`) sorts before this one (`20261219140000`)" -> [this one is now `20261222190000`.]
   - "`postime` (#603, ADR 0281)" bullet, "The follow-up ... can only start after #603 merges." -> [2026-10-05: #603 merged as `2b6782291` and is in this branch. The follow-up is unblocked and not done.]
5. "## Not covered", "**Stock ledger.** ... It waits on #603." -> [2026-10-05: unblocked since #603 merged; not done in this PR (open row `ADR-0286-DOOR-STOCK-MOVEMENT-IS-DATED`).]
6. "## Forks deferred": add the bullet below.

- **A floor on back-dating (new, 2026-10-05).** An owner's or a manager's sent time older than 72 hours stands at any age, as `back_dated`, even one from before the order was placed. The door sends the phone's clock at the tap (`DoorNext.tsx:468`), not a typed date. A manager's phone whose clock runs more than 72 hours behind is therefore kept the same way. The ruling names no floor.
  - (a) **No floor, as built.** Recommended. Any age from an owner or a manager stands, marked `back_dated`, with the entry time beside it, and the bell says it was back-dated. A past quarter can still be back-filled, which is how the sim house's dates get fixed on a re-run. Cost: a manager's phone with a clock far behind dates a delivery wrongly, and only the mark and the bell show it.
  - (b) **Not before the order existed.** A sent time earlier than the order's own creation is dated by the server and kept as evidence. This catches a clock running behind. Cost: an order typed in after its goods arrived (a back-filled history, as in the sim) can never be dated to its real day, because no order write accepts a sent time. **[Corrected 2026-10-06: false as stated. `POST /providers/:id/retroactive-order` takes an `invoiceDate` that dates a new DELIVERED order, ungated today (ADR 0286 follow-up 8). The cost stands for an order placed through the normal order flow, whose dates are the server's.]**
  - (c) **A fixed limit, e.g. 90 days.** Older from anyone is dated by the server. Cost: a new number, and a longer back-fill stops working.

  None of these changes this PR's code under (a).
