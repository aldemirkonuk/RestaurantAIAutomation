## What was wrong for the owner

On Tuzlu Rüzgar, the house's calendar showed every delivery as still due, on a day nobody chose. Finding F-152 / A-034 (register cluster C16), from the read-only analytics walk on 2026-10-03:

- The October calendar held **534 delivery events**. **All 534 were `pending`**, all dated **9 October 10:00** and created 2 October. All **87 of 87** whose orders were read had already **COMPLETED**.
- `/calendar` drew 500 of the 534 (its page limit), and the reminder read counted 534 pending.
- July and August showed **0** events, although the truth file has 571 lines expected and delivered between 1 July and 1 September.

Three defects caused this, all cited at the lane's original base 8c673db4b (none of the cited files changed on main through fb862aa57):

1. **Placement ignored the order.** `createCalendarEventForOrder` dated every event approval + 7 days (`procurement.service.ts:7013`), even though the order row has its own `expected_delivery_date` (written at `:1278`). A batch approved on one day therefore landed on one day.
2. **Only two paths closed an event**, `cancelOrder` (`:3722`) and `markDelivered` (`:5642`). None of these touched the event:
   - the door receipt (`receiving.service.ts:565-566` writes `PARTIALLY_RECEIVED` and `delivered_at`);
   - `verifyReceipt`;
   - `PATCH /procurement/orders/:id`;
   - the Python agent's out-of-stock cancel;
   - `REJECTED` or `FAILED` after approval.
3. **Closing never moved the date**, so even a closed event stayed on the estimate.

A fourth defect sat next to these, found in the code. `procurement_agent.py:928-962` (`_cancel_order_calendar_event`) selected a `tags` column that `calendar_events` does not have, filtered on uppercase statuses the table never holds, and swallowed the error. It never cancelled anything, and the manager was still told the delivery was "removed from calendar". This is the same fault ADR 0073 removed from the gateway, still alive in Python.

## What changed, and why

**ADR 0284 rule: a delivery event follows its order, and the table keeps it so.**

- **Placement (gateway).**
  - `createCalendarEventForOrder` now puts the event on the order's own `expected_delivery_date`. `approveDraft` reads that date off the row, because `OrderResponseDto` does not carry it.
  - The new `statedDeliveryDayOf` cuts a timestamp to its day and treats an impossible day as no date.
  - With no date, the event stays at approval + 7, and its text now says "estimated 7 days after approval; the order states no date".
- **Closing (database).** Migration `a_delivery_event_follows_its_order` adds:
  - one function, `delivery_event_follows_its_order(order, house)`;
  - an `AFTER UPDATE OF status, delivered_at` trigger on `procurement_orders`;
  - an `AFTER INSERT` trigger on `calendar_events`, so an event written for an order that has already closed is closed when it is created;
  - a partial index on `calendar_events(order_id)` for delivery events.

  What the function does:
  - **Arrived** (`DELIVERED`, `PARTIALLY_RECEIVED`, `COMPLETED`): the event becomes `completed` and moves to the house-local date and time of `delivered_at`.
    - It writes both date pairs, because `sync_calendar_dates_trigger` would otherwise undo an `event_time`-only write.
    - The reminder is turned off.
    - If `delivered_at` is empty, the event keeps its date and its text says so.
    - A house with no zone, or a zone Postgres cannot read, falls back to UTC, and the text says which.
  - **Not coming** (`CANCELLED`, `REJECTED`, `FAILED`): the event becomes `cancelled`, keeps its date, and the reminder is turned off.
  - **Open**: the event is untouched.
  - ADR 0073 stays in force where it was right: the match is by `order_id` within the house, in lowercase `CalendarEventStatus` words, with its asymmetry. An arrival completes even a cancelled event, and a cancellation never touches a completed one.
  - The arrived and not-coming sets are generated from `order-transitions.ts` and pinned character for character by the spec.
  - Both trigger functions catch every error and raise `WARNING`, so an order write never fails over a calendar row (ADR 0066). The function itself raises, so a future direct caller is told.
  - The migration is additive: no table, no column, no row written, no backfill.
- **Why the table and not the gateway.** The founder answered this class in ADR 0125 Q2 ("Enforce the table as a database trigger"): a gateway rule cannot reach `procurement_agent.py`, the sim harness or the SQL console. The trigger reaches every writer, including ones not yet written, and it edits no receiving file, which R3 is rewriting.
- **Removed:**
  - the gateway's `closeDeliveryCalendarEvent`, `cancelCalendarEventForOrder`, `updateCalendarEventForDelivery` and `TERMINAL_CALENDAR_STATUSES`; each call site now points to the migration. Kept, they would race the trigger and log a false "nothing matched" on every delivery;
  - the Python `_cancel_order_calendar_event` and its call. The out-of-stock message now says "Order cancelled." and no longer claims a calendar removal.

Files (15 against `origin/main` fb862aa57, at the cap):
- the migration `20261218150000_a_delivery_event_follows_its_order.sql` and its SQL test (registered in `scripts/sql_outside_migrations.txt`);
- `procurement.service.ts`;
- 3 gateway specs;
- `procurement_agent.py` and its test;
- ADR 0284, ADR 0073's status line, the decisions `README.md` index (a new 0284 row only), `CLAIMS.jsonl`, the `claims.d` file and the `tech-debt.d` fragment.

## Tests and guards

Re-run on 2026-10-04 at head **e50108732**, after taking `origin/main` fb862aa57 and renumbering the migration. A line marked *earlier* was measured before the merge and not repeated; each says why it still holds.

- **Gateway jest**, `order-calendar-event.spec.ts`, `order-calendar-event-lifecycle.spec.ts` and `tests/approve-draft-concurrency.spec.ts`: **110/110 pass** (3 suites, `--runInBand --forceExit`). The lifecycle spec finds the migration by slug, so it read the renamed file.
  - New cases: 15 for placement plus `statedDeliveryDayOf`, 2 for `approveDraft` handing over the date, and a 14-case lifecycle spec that pins the migration's SQL.
  - *Earlier* (builder and verifier): with `origin/main`'s service swapped in, 18 of the 110 fail. Main has not changed `procurement.service.ts` since, so the comparison stands.
  - *Earlier* (verifier): ten mutations of the migration were each caught by exactly one lifecycle case. The migration is byte-identical since (the rename is a 100% match).
- **SQL behaviour test**, 16 cases with a verdict block that raises unless every case ran and held. CI does not run it.
  - **At this head, Docker PostgreSQL 17** (`pgtest.sh lane`: a template built from `origin/main` fb862aa57's 285 migrations, plus this branch's one; synthetic fixtures, local container). Full output:
    ```
    applied 1 migration(s) to events_fix
    [fix] PASS 20261218150000_a_delivery_event_follows_its_order_test.sql
    [ctl] FAIL 20261218150000_a_delivery_event_follows_its_order_test.sql:  T7  | f  | FAILED: status=pending date=2026-10-09 10:00:00 reminder=t text=Expected delivery for order T-0284-o4  T8  | f  | after DELIVERED pending, after FAILED pending, ctid (0,5) -> (0,5) ERROR:  ADR 0284 test FAILED: 16 of 16 tests ran; not true: T1, T2, T3, T4, T5, T6, T7, T8, T9, T11, T12, T13, T16
    template=fb862aa574f710d4e1faf06df0ea50f1a5ce18cf lane_migrations=1 tests=1
    Read: every [fix] line must PASS; a test that also PASSES on [ctl] pins kept behaviour, not the fix.
    ```
    With the migration, 16/16 (the verdict did not raise). The control raises with 13 of 16 not true; T10, T14 and T15 hold by construction, as the test header says.
  - *Earlier*, on a full-corpus PGlite build (PostgreSQL 18), before the merge: control 284/284 files, the verdict raises with 13 of 16 not holding; with the migration (285 files), 16/16, and the migration re-applies cleanly. The verifier also ran it on Docker PG 17 then: 16/16 with the fix, 3/16 on the control.
  - *Earlier* (builder and verifier): eight SQL mutants were each caught. The migration and test are byte-identical since.
- **Python:** `tests/test_procurement_agent_vendor_decline.py` gives **6 passed** in the lane's existing 3.11 scratch venv. *Earlier* (verifier): the new case fails against the base agent; main has not changed `procurement_agent.py` since.
- **eslint** on the 4 changed TS files: **0 errors, 306 warnings**. *Earlier* (verifier): the warnings are existing prettier warnings, none on changed lines; the four files are unchanged since.
- **tsc** (`tsconfig.spec.json`): **2 errors**, both TS2307 for the missing `@simplewebauthn/server` module in this worktree, identical on the base.
- **CI guards, rc=0 at this head, each plain and with `--self-test`:** check_adr_numbers_unique (1666 refs), check_migration_order (`--event pull_request --base-ref main`), check_migration_versions_unique (against `origin/main` and 43 open PRs, a read-only `gh` listing), check_migration_probe_safety, check_new_tables_are_locked_down, check_order_status_literals, check_order_transition_sql, check_citation_pairing, check_od_ids_exist, check_no_conflict_markers, check_no_seeded_defaults, check_proposal_preservation, check_fk_targets_exist, check_read_columns_exist, check_queried_tables_exist (not its `--against-production` arm), check_read_errors_not_swallowed, check_orders_column_writes and check_order_capture_contract. check_migrations_single_home has no self-test and passes plain.
- **`check_migration_order`** now says: 1 migration added since the merge base fb862aa57, `20261218150000_a_delivery_event_follows_its_order.sql`; newest on `origin/main` is `20261217112500`.
- **`check_decision_claims.sh`:** **845 checked, 845 holding**. `test_check_decision_claims.sh`: 31 ok, 0 failed.

## ADR and CLAIMS

- **New: ADR 0284**, `0284-a-delivery-event-follows-its-order.md`, Proposed. It records the rule, the five options considered, consequences, hand-offs, the founder answers verbatim and four open forks. 0284 is on no ref on `origin/main`; the uniqueness guard passes across 1666 refs. Its review trail records this update pass (the merge and the renumber).
- **Amended: ADR 0073.** Its status line now reads "Superseded in part by 0284: closing moved to the table". A 0284 row is added to the `README.md` index. The 0073 index row is left as it is on main: editing an existing index row is gate-owned, and the founder chose on 2026-10-04 "Drop the row edit (Recommended)", so the supersession is recorded in ADR 0073's own status line and in the 0284 row.
- **`CLAIMS.jsonl` row ADR-0073** is restated in place with a bracketed correction. The "two closers share one implementation" half no longer applies; the order_id-match and lowercase-vocabulary halves now check the migration.
- **New `claims.d/fix-delivery-events-follow-the-order.jsonl`:**
  - ADR-0284-TABLE-CLOSES-THE-EVENT
  - ADR-0284-NO-GATEWAY-CLOSER
  - ADR-0284-EVENT-ON-THE-STATED-DATE
  - ADR-0284-AGENT-LEAVES-THE-CALENDAR-TO-THE-TABLE
- **New `tech-debt.d/2026-10-03-fix-delivery-events-follow-the-order.md`:** the stale events written before this fix, and the residuals below.

## Founder answers this rests on (verbatim)

- **Door split, 2026-10-04, AskUserQuestion, session 05c659bb (checked in the transcript):** "You build, R3 rebases (Recommended)". The door-path close is the `PARTIALLY_RECEIVED` arm of the trigger, and no receiving file is edited, so R3's door-release PR rebases on top. The coordinator's condition, that 'events' merges only after #592 (event-prep mail off), is met: #592 merged as 619a068a9, and this branch contains it (merge 9d57e0b7e).
- **Door versus verify, 2026-10-02:** "At the door (Recommended)". This is why every door receipt (`PARTIALLY_RECEIVED`) completes the event.
- **Tuzlu repair precedent, 2026-10-02:** "Yes, dry-run first (Recommended)". It is the basis for fork 1's recommendation; no repair is in this PR.
- **House with no time zone, ADR 0149 item 61 (given for the low-stock digest hour):** "UTC, said on the page (Recommended)". It is applied here as precedent. Whether it binds calendar events was not asked.
- **DELIVERED on /orders, F-140 re-ask, 2026-10-03:** "Open, 'Not counted yet' (Recommended)". That ruling covers the order list and is unchanged by this PR.
- **Merging, 2026-10-04:** "Merge when audited (Recommended)". This PR merges only after the ADR 0090 three-role audit passes and CI is green.
- **Precedent, ADR 0125 Q2:** "Enforce the table as a database trigger."

## Forks deferred (the founder's)

1. **Repair the events written before this fix?** That is about 534 at Tuzlu Rüzgar, plus any at other houses. Recommended: (b), a follow-up PR that shows a read-only dry-run count and sample, where merging it is his yes. **Nothing is backfilled here.**
2. **Where does an event go when the order states no date?** Built as the recommendation, (a): approval + 7, labelled as an estimate. The alternatives are the vendor's `lead_time_days` or no event at all.
3. **Does a short door count open a new event for what is still owed?** Built as the recommendation, (a): no. The event closes at the door and the backorder shows on `/orders`.
4. **Trigger or gateway?** Built as the trigger, on the ADR 0125 Q2 precedent, and recorded as Proposed so he can overturn it.
5. **Should a vendor-reported `DELIVERED` order complete its event?** Not asked; it appears only in ADR 0284's founder-answers prose and is not one of its numbered forks.
   - It does today, as it did under ADR 0073's `markDelivered`, and the event now also moves to `delivered_at`.
   - If he reads "At the door" as "the event closes only at the door", `DELIVERED` leaves the arrived set.
   - This PR keeps the existing behaviour and does not decide the question.

## Merge order

- **Main is taken.** Merge 9d57e0b7e brought in `origin/main` fb862aa57 (#592, #599, #600) on top of the original base 8c673db4b. It had two row conflicts, and both sides were kept in each:
  - `.planning/decisions/README.md`: the 0284 row, then #600's 0285 row;
  - `scripts/sql_outside_migrations.txt`: both test lines, then the inventory was regenerated with `check_migrations_single_home.py --update` (152 entries).
  - No other file was changed on both sides since the base.
- **The migration is renumbered** from `20261216140500` to **`20261218150000`** (1243da5a5, `git mv`, same slug, both files byte-identical).
  - Why: #600 put `20261217112500` on main, and ADR 0212 requires a new version to sort after everything on main. The open postime lane holds `20261218101500`, so the new version clears it too.
  - The only citation of the old number was the inventory line, now regenerated. The specs, the CLAIMS rows and the ADR find the migration by slug.
  - No function body was carried forward: none of the migration's three functions, two triggers or index exist on main, and under `supabase/` main added only #600's migration (whose one function is `record_glass_pour`) and its test since the base.
- **Renumber again if main passes `20261218150000` first.** The known case is cellar (`fix/cellar-invoice-book-and-menu-copy`), which holds `20261219104500`. If cellar merges before this PR, `check_migration_order` fails here until this migration is renumbered past it. postime merging first changes nothing.
- **Sibling fix lanes that share files.** Checked with `git merge-tree` of head e50108732 against each `wt-fix-*` branch as it stood on 2026-10-04; branches already merged or with no commits past main are left out.
  - **`README.md` index:** row conflicts with logs, postime, sig and sighting, all mechanical. dash also conflicts there, but it conflicts with `origin/main` alone too (#600's row), not because of this branch. caltakings, cap, doortime, rec, recregisters and stateeditor share the file and auto-merge.
  - **`CLAIMS.jsonl`:** cap, rec and sig touch different rows and auto-merge.
  - **`scripts/sql_outside_migrations.txt`:** cellar and postime, append conflicts.
  - **`procurement.service.ts`:** sighting auto-merges cleanly.
  - **doortime** (`fix/door-keeps-the-arrival-time`, ADR 0286) merges cleanly with this branch and complements it. It makes the door's `delivered_at` the time of the fact, and this PR puts the event on whatever `delivered_at` says. Either order works.
- **R3's door-release PR** (wt-review-3, ADR 0267) rebases on top of this one. No receiving file is touched here.
- **Event-prep mail stays off (#592).** Its sweep reads `calendar_events` by `event_date` with no `event_type` filter (`scheduled-tasks.service.ts:785-824` on main). Delivery events will now sit on real dates, so whoever arms F-154 must exclude delivery events.

## Not covered (shortcuts, named)

- **The 534 stale Tuzlu events are not repaired.** The fix acts on future order moves and new events only, so A-034, as measured, stays visible until fork 1 is answered. An old event is corrected only if its order moves again, and a COMPLETED order has no further move to make.
- **Audit.** An independent verify passed, with minor issues only. The ADR 0090 three-role audit has not run; under "Merge when audited" it is owed before merge.
- **Where the SQL behaviour was proven.** It was proven on PGlite (PG 18, superuser, Supabase platform stubbed) before the merge, and on Docker PG 17 (a local container on synthetic fixtures) before and after it, not on production. CI does not run `supabase/tests/*.sql`, so CI pins the migration only statically, through jest.
- **Suites not re-run.** The full gateway jest suite and the full orchestrator pytest suite were not run, only the lane's own files. `check_gateway_boots` could not go green locally (the missing `@simplewebauthn/server` module, the same on the base), so it rests on CI.
- **Open-PR overlap was checked only at the base.** The plan checked open PRs #577, #561, #558, #543, #542, #541 and #538 at 8c673db4b and found no shared hunks in `procurement.service.ts`. That was not re-checked at this head. At this head only migration versions were checked against open PRs (43, by check_migration_versions_unique), plus the `wt-fix-*` sibling branches by `git merge-tree` above.
- **A sentence in the migration header goes beyond the evidence.** It says, as fact, that the sim went "door receipt, then verify, so no closer ever ran". That is inferred from F-143 (the door path never released shadow stock, so `markDelivered` never ran) and from cluster C16, not measured order by order. The code fix does not depend on it. It was not softened at the renumber, which kept the file byte-identical. It can still be softened before merge: the file has been applied only to local test databases.
- **Calendar failures are quieter.** A failure is a Postgres `WARNING` in the database log, not the gateway's `logger.error`, and PostgREST does not pass it on.
- **Residuals, stated in the ADR and the tech-debt fragment:**
  - A later edit of `expected_delivery_date` on an open order does not move its pending event.
  - The +7 fallback is still computed in UTC.
  - A second door receipt with a later `delivered_at` moves the completed event to that later time. That follows the rule, but no test pins it.
- **Unrelated diff.** `approve-draft-concurrency.spec.ts:375-377` carries a one-line prettier reformat of an existing assertion.
- **Handed off, not built:**
  - the dashboard week panel draws no event status (`RailPanels.tsx:76-87`);
  - the 100-row calendar read cap (`calendar.service.ts:275`);
  - AW12 (the month read pulls every full row);
  - the canonical delivery path, which never moves the order's status.
- **Small memory discrepancy, left unedited (outside this lane).** Memory `founder-answers-2026-10-03-analytics-fixes.md:35` dates the door-split question "~00:50Z". The transcript shows it was asked at 00:29Z and answered at 01:56Z.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
