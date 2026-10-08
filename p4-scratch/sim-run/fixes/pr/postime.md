## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03, read-only)

The owner-quarter sim back-filled July and August through the generic POS import in October. `pos_checks.closed_at` kept each check's own close time, but nothing the import derived from the check used it.

- **A-007, /inventory velocity about 2x and runway about half.** `apply_stock_movement` and `record_glass_pour` took no date and stamped `inventory_transactions.transaction_date = now()`. So two months of sales landed on 2026-10-02, the only day with movement (out 48 / in 98).
  - Median velocity was 2.04x the truth (n = 112, range 0.65 to 4.12).
  - 34 rows showed five days of cover or less, against 11 in the truth, and only 7 of those overlap.
  - S.Pellegrino read 13.5/day with 3 days of cover, against a true 6.64/day and 5.44 days.
- **A-009, the /reports week shape and 14-day forecast were built from one import day.** `wine_consumption_log` rows took their defaults, `recorded_at = created_at = now()`.
  - Friday was the only trading day (78.46, every other weekday 0).
  - The forecast history had one non-zero day (2026-10-02 = 1,020).
  - "Next 14 days" read 4,543, with a backtest MAPE of 100%.
- **A-029, about 811 Jul-Aug POS lines (847 pours) plus 8 bottle lines moved no stock, and the import read as clean.** Of these, 752 failed on the stranded-lot cause (AW08) and 59 on rows whose book was already empty. `applyStockEffects` returned `void` and a refused write was only logged. `errors[]` never carried it, and the unresolved queue was empty.
- **A-041 (AW11), the sale-unit review said 57 glass, single and carafe buttons "deplete nothing" while their sales took stock out.** The review read mappings without `sale_volume_ml` and hard-coded `effect_if_unanswered: "depletes_nothing"`. The import reads `sale_volume_ml` first (ADR 0011). For example, Moscofilero glass lines depleted 35 units against a true 34.4.
- **A-064 (register only).** 17 never-counted made-to-order drinks raise critical "completely out of stock" alerts. They are added to OD-161's citation, and no code changes for them here.

Out of lane: the door half of AW03 (A-008, A-010, A-011, where `delivered_at` = now) is lane `doortime`, under the founder's C02. `receiving.service.ts` is not touched.

## What changed and why

- **Migration `a_pos_sale_is_dated_by_its_check`** (cited by slug; it now sorts after `a_short_pour_opens_the_next_bottle`, past every migration on main, and the final number is assigned at merge).
  - `apply_stock_movement` goes from 18 to 19 arguments and `record_glass_pour` from 8 to 9. Each gains a last argument, `p_occurred_at timestamptz DEFAULT NULL`, and dates its ledger row `LEAST(COALESCE(p_occurred_at, now()), now())`.
  - Each function is dropped and recreated rather than overloaded, because a second overload makes PostgREST's named call ambiguous.
  - The `apply_stock_movement` body is copied verbatim from ADR 0141's migration. The `record_glass_pour` body is copied verbatim from ADR 0285's `a_short_pour_opens_the_next_bottle` (#600, merged first): it finishes the open bottle and opens the next from any lot. The only change in each is the argument and one marked line. A diff against the sources confirms it.
  - ADR 0285's draw writes one ledger row for every bottle a pour opens, whichever lot it came from, so the one dated line dates the bottles opened from the next lot too. `pour_events.created_at` stays entry time, since nothing reads it as the time of the pour.
  - A DO block asserts:
    - exactly one of each function, with the argument counts and defaults;
    - ADR 0141's refusal is still in `apply_stock_movement`;
    - ADR 0285's cross-lot draw, its 22004/22023 guards and its two refusals are still in `record_glass_pour`, which still returns jsonb and is still SECURITY INVOKER.
  - NULL means now(), as before, so the old gateway and every other caller (Toast, door, counts) behave exactly as they did yesterday.
- **`pos-hub.service.ts`**
  - **`saleInstant(closedAt, nowMs)`** reads the check's `closed_at` once, with `readClosedAt`, which reads only a strict ISO-8601 instant whose written date and time survive a round trip through the UTC calendar. `ingest()` calls it before it stores the check, and every date the import writes for that check comes from that one reading, sent as an ISO-8601 UTC string (changed after the ADR 0090 BLOCK at `01ac04eaa`, and made strict after the BLOCK at `1a7a4137d`; see the two sections below).
    - `pos_checks.closed_at` gets the reading as it is, not clamped.
    - `p_occurred_at` on both RPCs, and the consumption row's `recorded_at` and `created_at`, get the same string when it is not in the future. A future one is clamped to import time on these rows only, so the check keeps its future close time.
    - The ledger row is `LEAST(p_occurred_at, now())` with the database's clock, so it is earlier than the other rows only when the database's clock runs behind the gateway's.
    - A check whose `closed_at` is present and is not read by `readClosedAt` is refused before anything is written for it: no `pos_checks` row, no stock, no consumption. `errors[]` names it with "date not readable — write it as 2026-10-03 21:00", and `refusedUnreadableDate` counts it (founder ruling F4, 2026-10-05; see "Founder ruling F4"). Until F4, such a check went to Postgres as the till sent it and its stock took import time.
    - Outside those cases, the check, its ledger rows and its consumption rows carry one instant. A zone-less date and time is read in the gateway's zone on all of them, revenue included (see Not covered).
    - A line booked more than 72 h after its check closed is counted in `backdatedOver72h`. Exactly 72 h does not count.
  - **Voids** are dated by the `closed_at` the voided check carries.
  - **The consumption row** gets `recorded_at` and `created_at` set to the sale instant. Every existing reader filters on `created_at`, and those readers belong to the `cap` lane, so writing both columns fixes them without touching that lane's files. One reader's meaning shifts with it. For a `bottles_sold` goal, `goal-reached.producer.ts:263-269` reports the newest `created_at` as the moment the goal was crossed. For POS rows written from now on, that is the newest sale's instant, not the newest import. Its code is unchanged, and ADR 0281's Consequences say so.
  - **`ingest()` returns a `stock` block** and appends grouped failures to `errors[]`.
    - The block puts every line on a closed check it stored into exactly one of `notStock`, `booked`, `alreadyBooked`, `queued.unmapped`, `queued.no_sale_volume` or `failed`.
    - `consumptionNotWritten` and `backdatedOver72h` are sub-counts. (`datedAtImportTime` was a third until F4 removed it with the fallback it counted: an unread `closed_at` no longer dates stock at import time. A future close time is still clamped to import time, as above.)
    - A check refused under F4 is in none of these counts. `ingest()` counts it in `refusedUnreadableDate` and in `received`, not in `upserted` or `wineItemsDetected`.
    - Failures are grouped by kind and item: at most 50 groups, then one line that counts the rest.
    - `queueUnresolvedLine` and `recordConsumption` now return their outcome. A queue insert that fails is `failed`, never `queued`.
  - `inventoryVolumesFromRow` is exported, so the review reads sizes by the import's own rule.
- **The sale-unit review (`pos-mapping-review.service.ts`, DTO)**
  - It selects `sale_volume_ml` and reads the inventory of every mapping, in chunks of 150 ids.
  - Each row gets `next_sale` (`whole_bottle`, `volume` with its ml, or `depletes_nothing` with a reason and `queued_as`), computed by the import's own `resolveSaleVolume`.
  - `needing_unit` counts what the import cannot resolve. `queue_on_next_sale` counts every mapping whose next sale lands in `pos_unresolved_lines`.
  - `EFFECT_IF_UNANSWERED` is deleted.
  - Found while building: `setSaleUnit` now passes the stored `sale_volume_ml` back. Answering "glass" on a 150 ml button used to wipe the volume the import reads first.
  - The other side of that, now written in ADR 0281's Consequences: the import reads `sale_volume_ml` before `sale_unit` (ADR 0011), so answering `bottle` on a button that stores 150 ml still imports 150 ml a sale. Only a stored volume equal to the inventory row's bottle size imports as a whole bottle. The answer's response says `sale_unit: "bottle"` and nothing about the volume, and the row then drops out of the default review list (with `includeAnswered=true` its `next_sale` reads `volume`, 150 ml). The volume is changed through `POST /pos-hub/mappings/:restaurantId`. This PR does not change that behaviour.
- **The review's API text now says what it returns** (added after the audit).
  - The DTO's `includeAnswered` description said the default returns "only rows still missing a unit", which was main's selection. It now says the default returns mappings whose sale volume the import cannot resolve. The DTO was already one of this PR's files.
  - The route's Swagger summary and description in `pos-hub.controller.ts` said "every mapping whose sale_unit is null" and named a `unit_if_unanswered` field. This PR removed both. The text now describes the resolver-based selection and `next_sale`. This is the PR's 16th file (commit `5148767bb`); the founder allowed 16 files for this PR as a one-off.
- **ADR 0285's SQL test is not in this PR.** Its T11 pins the 8-argument identity of `record_glass_pour`, so it **will FAIL once this migration lands, by design**. The 1-file follow-up PR #605 (a draft as of 2026-10-04) moves T11 to the 9-argument identity. **#605 must merge right after this PR.** It cannot go first: T11 cannot pass against main before this migration. CI does not run `supabase/tests`, so nothing goes red in between. ADR 0285's applied migration is not edited.
- **Why:** the database already held the true time on `pos_checks`, so that is the only honest date for what the import derives from a check. A count that partitions every line is the only shape in which "nothing failed" can be checked rather than assumed.

## After the BLOCK at 01ac04eaa

The ADR 0090 audit of `01ac04eaa` overturned that head (BLOCK; both reviewers approved with notes, the planner overturned). That BLOCK stands; this is a new head.

- **What it found.** `saleInstant` read `closed_at` with JavaScript only to decide past, future and 72 h, then handed the till's own string on, and Postgres read it a second time. The two readings differ for a zone-less string when the gateway's zone and the database session's differ, for a POSIX-style `UTC+3`, and for a two-digit year from 50 to 69. When either reading fell in the future, the ledger, `pos_checks.closed_at` and the consumption row came apart, while four sentences (the ADR's Decision and Assumptions, the docstring, and this body's "land on the same day") said they could not.
- **The fix, the auditor's option (b).** `ingest()` calls `saleInstant` once per check, before the `pos_checks` upsert, and hands the result to `applyStockEffects`. The check row, `p_occurred_at` on both RPCs, and the consumption row's `recorded_at` and `created_at` all take that one reading, sent as `new Date(parsed).toISOString()`. The clamp semantics are unchanged (the founder's F1, "No: trust the till"; C02's "older needs a manager" does not apply): a future close time is clamped on the stock and consumption rows only, and the 72 h count is a count. Two files changed in code: `pos-hub.service.ts` and `pos-hub.sale-time.spec.ts`, both already in this PR.
- **Two choices made in that fix, for the gate to judge:**
  - A string JavaScript cannot read is still stored on the check exactly as the till sent it (Postgres reads it or refuses it, as before), while its stock and consumption take import time, counted and said. Storing import time on the check as well was the other option; it would have changed what an unreadable check's revenue date is without anyone deciding that. (The founder has since decided it: under F4 such a check is refused, not stored. See "Founder ruling F4".)
  - A future close time stays on the check, as UTC, unclamped, as `pos_checks.closed_at` held it before. Only the stock and consumption rows are clamped, as before.
- **What changed for revenue.** `pos_checks.closed_at` used to hold Postgres's reading of the till's string; when JavaScript can read it, it now holds JavaScript's reading, as UTC. For formats both read alike (the audit measured ISO with an offset, RFC 2822, `04.10.2026 15:00` and `10/04/2026 3:00 PM`, with the session in UTC; the last two carry no zone, so they agree only while the two zones match) nothing changes. For the three kinds above, a check's revenue day is now JavaScript's reading, the same as its stock's. The generic adapter still keeps the whole payload in `pos_checks.raw`, so the till's own string is still on the row. `opened_at` is still stored as sent. (The fix for the BLOCK at `1a7a4137d` narrows this paragraph: only a strict ISO-8601 instant is read now, so RFC 2822, `04.10.2026 15:00`, `10/04/2026 3:00 PM`, `1/1/50` and `UTC+3` are not read, and under F4 a check carrying one is refused. See "Fix for the BLOCK at 1a7a4137d" and "Founder ruling F4".)
- **The four sentences now say what the code does**, and what is still assumed (see Not covered): ADR 0281's Decision paragraph and `saleInstant` bullet, its Assumptions, the `SaleInstant`/`saleInstant` docstrings, and this body. The index row in `decisions/README.md`, the bracket in `08-softwares/pos-bridge.md` and the Toast entry in `tech-debt.d` say "one reading" too.
- **Also from the audit's notes:** ADR 0281's Consequences now say that answering `bottle` over a stored 150 ml still imports 150 ml (see the review bullets above), in its own commit; and #605 must merge right after this PR.
- **Commits on top of `01ac04eaa`:** `592cc04d4` (the one reading, its spec cases, the claims row, the timing prose) and `f9c0d2ef5` (the `setSaleUnit` consequence). No migration, SQL test, DTO, controller or review-service code changed.

## Tests and guards at `f9c0d2ef5`, condensed (this head's are under "Founder ruling F4")

That head's full record is kept verbatim in `p4-scratch/sim-run/fixes/pr/postime.4bef334b4.md`, under its "Tests and guards at `f9c0d2ef5`" heading. It covers the jest cases and their red/green counts, typecheck, lint, the guards, and the claims mutation table for the BLOCK at `82e087f34`. It is cut here so that this body stays under GitHub's 65,536-character limit. What still applies at this head:

- **SQL, local Postgres** (PostgreSQL 17.11 in Docker, synthetic fixtures, one rolled-back transaction each). No SQL has changed since.
  - `pgtest.sh lane`, on a template built from every migration at `28d32de36`, gives `[fix] PASS` and `[ctl] FAIL` at T1. The output is in `p4-scratch/sim-run/fixes/audits/603-local-pg.txt`.
  - This lane's test is T1 to T6. T1 to T5 cover:
    - one overload of each function;
    - past, future and NULL dating;
    - a pour that opens a bottle;
    - the 11-argument positional callers;
    - ADR 0141's refusal.
  - T6 covers ADR 0285's draw, dated, in two cases:
    - a stranded lot (0 sealed + 25 ml) beside a lot of 3 sealed: the pour opens the next lot's bottle, and its ledger row carries the sale's date;
    - a 1500 ml pour that opens two bottles in one ledger row of -2, dated by its own sale.
  - ADR 0285's test fails T11 on [fix] **by design**, because T11 pins the 8-argument identity this migration replaces. It passed on [ctl] (`audits/postime-local-pg.txt`). #605's T11 passed on [fix] (`followup/glasspour-t11/`). Neither has been re-run since.
  - Postgres reads an ISO-8601 UTC string as the same instant in any session time zone. This was checked under UTC, Europe/Istanbul and America/Los_Angeles (`snap/postime-block2/pg-reads-iso-the-same.txt`). It is what lets the gateway send one reading and have every row keep it.
- **Claims, after the BLOCK at `82e087f34`.** All six rows then in the shard were rewritten as static Python:
  - the two DATED rows tokenize the migrations, skipping comments, strings and dollar-quoted text, and read the last real definition of each function;
  - the gateway and review rows strip comments and check the structure each claim names.

  61 mutation cases were run in a `git archive` copy. The full table and harness are in `p4-scratch/sim-run/fixes/audits/603-claims-mutations/`. The commit message of `1cf469ec0` says the old rows stayed green on "33 of the 52" breaking cases. That was an estimate, and the harness count is **37 of 53**.
- **Merges.** origin/main was merged in at these commits, in order:
  - `fb862aa57` (#599, #600);
  - `e2cbe426a` (#601);
  - `f5f658934` (#602);
  - `1aa4dcb8c` (#604);
  - `28d32de36` (#595), at `1a7a4137d`.

  The coordinator made the last three merges. The only conflicts were decision-index rows and `scripts/sql_outside_migrations.txt` lines. Both sides were kept, and after the first merge the second file was regenerated with `check_migrations_single_home.py --update`.

  #604's `20261218150000` landed on main, so this migration was renamed `20261218101500` → `20261218180000` (`01ac04eaa`, name only). The rename was needed because `check_migration_order.py` (ADR 0212) rejects a version behind main's newest. ADR 0284's review trail names the old version; it is main's file and stays as written.

## ADR, CLAIMS and register touched

- **ADR 0281** (new): "A POS sale is dated by its check, and the import says what it did", plus its index row in `decisions/README.md`. `check_adr_numbers_unique` passes. After the merge it says that glasspour merged first, that F3 was applied as the coordinator's option (a), why the migration sorts after ADR 0285's, and what the local Postgres run showed. After the audit, the F3 paragraph says only what the claims rows check, names the T11 follow-up as #605 and records the local Postgres re-run. Consequences gains the `goal-reached` reader, and the review trail records the BLOCK. After the BLOCK at `01ac04eaa`: the Decision paragraph and the `saleInstant` bullet describe the one reading and where it goes; Assumptions name the three kinds JavaScript reads its own way, the unverified Railway zone and the jest zone injection; Consequences gain "revenue's date for an ambiguous closed_at moves with its stock" and the `setSaleUnit` 150 ml case; the local Postgres paragraph records the re-run at `1aa4dcb8c`; and the review trail records the second BLOCK. After the BLOCK at `1a7a4137d`: the Decision paragraph and the `saleInstant` bullet describe the strict read and its three rules, and say why RFC 2822 is not read; Consequences say which formats are no longer read (with `03.10.2026` spelled out); Assumptions add the fourth kind, a string Postgres refuses and V8 reads, and say the strict read closes it, plus that vendor formats are not checked against the grammar; the local Postgres paragraph records the `28d32de36` re-run; and the review trail records the founder's "Allow 16 for #603" (a one-off) and the third BLOCK. The index row in `decisions/README.md` and the bracket in `08-softwares/pos-bridge.md` now say only a strict ISO-8601 instant is read. After F4 (2026-10-05): a "Founder ruling F4" bullet quotes the question, the pick and the option text, and says how it is built (an open check, numbers and blank strings included); the Options section says what happened to an unread `closed_at` at `4bef334b4`; the Decision paragraph and the `saleInstant`, RFC 2822 and ingest bullets say such a check is refused; Consequences say which formats are refused and what F4's cost is (a re-export; a row stored before is left as it is); Assumptions say a vendor format outside the grammar is refused until it is added, and that the session's zone and `DateStyle` no longer read any till string; Revisit adds F4's cost; and the review trail records the build. The index row and the pos-bridge bracket now say such a check is refused.
- **`claims.d/fix-pos-sales-dated-at-sale-time.jsonl`** has 7 rows, all `resolved`:
  - DATED-MOVEMENT and DATED-POUR read the last real definition of each function, structurally (see the condensed f9c0d2ef5 section; DATED-POUR's prose also names glasspour's merge);
  - DATED-GATEWAY, extended after the BLOCK at `01ac04eaa` to read the check row and `saleInstant`'s returns (its mutations are in `postime.4bef334b4.md`), and after the BLOCK at `1a7a4137d` to read `readClosedAt` (see the fix section);
  - IMPORT-SAYS-STOCK, which after the BLOCK at `1a7a4137d` also checks the partition code (see the fix section), and whose prose after F4 says `datedAtImportTime` is gone;
  - UNREAD-CLOSED-AT-REFUSED, added for F4 (see "Founder ruling F4");
  - SALE-UNIT-REVIEW-READS-VOLUME;
  - SALE-UNIT-ANSWER-KEEPS-VOLUME.

  `CLAIMS.jsonl` itself is not touched.
- **OD-161** is amended in place with `dashboard.service.ts:714-718` and `:759-775` (A-064). No row is added, so no citations shift.
- **`tech-debt.d/2026-10-03-fix-pos-sales-dated-at-sale-time.md`** adds two OPEN entries: the Toast door still dates stock at arrival (its fix now also says to write `toast_closed_at` from the same `saleInstant` call), and a check that arrives already voided adds phantom stock. Its citations are re-measured at this head (`pos-hub.service.ts:213`, `:1331`, `:1334`; the strict read and then F4 moved them). After F4 the Toast entry also says that when that call reports `fellBack`, `.at` is import time: `ingest()` refuses such a check, and whether the Toast door does the same is for that lane to ask. `v3.0-TECH-DEBT.md` is frozen by ADR 0240.
- **`08-softwares/pos-bridge.md`**: a bracketed supersession note where it described `effect_if_unanswered` as live, which now also says stock and consumption are dated by one reading of the check's `closed_at`, and that a check carrying a `closed_at` other than a strict ISO-8601 instant is refused and said, per F4.

## Founder answers (verbatim, AskUserQuestion)

- **F1 (2026-10-04 ~02:10Z), does C02's 72-hour rule also bound a POS check's closed_at?** "No: trust the till (Recommended)". It is built as worded: closed_at is trusted at any age, and lines older than 72 h are counted in `stock.backdatedOver72h`. It is quoted in ADR 0281 under "Founder ruling".
- **F4 (2026-10-05, relayed by the fix-lane coordinator), "A till that sends a date like 03.10.2026 is read today as March 10. What should happen to dates written that way?"** "Refuse, say why (Recommended)". The option text he saw: "Accept only unambiguous dates (2026-10-03 21:00, ISO). Anything else is not imported and the import result says 'date not readable — write it as 2026-10-03 21:00'. Cost: a house whose CSV uses 03.10.2026 or 10/03/2026 must re-export. Nothing is ever silently misdated." Quoted in ADR 0281 under "Founder ruling"; the build is under "Founder ruling F4" below.

## Forks deferred (not decided here)

- **F2 (founder): repairing rows already written at import time.** These are `inventory_transactions` rows keyed `pos:` and `wine_consumption_log` rows keyed by `notes`, which a repair would re-date from `pos_checks.closed_at`. No repair SQL was written. The recommendation on record is a separate, unrun script with a dry-run SELECT first, for the founder to run.
- **Phantom void (product call, in `tech-debt.d`).** Should a void whose sale was never booked be skipped, queued or booked?
- **Already owned by other lanes:** C02 (the door's capture time) is `doortime`'s. AW08 (the stranded-lot behaviour) was `glasspour`'s and is now on main as ADR 0285; this migration carries its body unchanged.

## F3, applied (coordinator, not product)

Which lane owns the two RPC signatures: the coordinator took option (a). This lane owns `p_occurred_at` on both functions, and the lane that merges second copies the other's body verbatim and keeps the exactly-one-overload assertion. Glasspour merged first (#600, fb862aa57), so this branch carries its body, as described above.

## Merge-order notes

- **Deploy order: the migration first, then the gateway.** Migrations auto-apply when the PR merges, and the gateway deploys after.
  - If the new gateway ever runs against the old functions, every line that reaches either RPC fails. Each failure is counted as `failed` and said in `errors[]`, so nothing is silently mis-dated, but that stock does not move and is not queued, so those checks would need a replay.
  - The old gateway against the new functions is fine, because the argument defaults to NULL.
- **`glasspour` has merged** (#600, fb862aa57). This branch already carries its `record_glass_pour` body plus `p_occurred_at`, and its migration sorts after glasspour's.
  - Left at its old version, this migration sorted before glasspour's. A fresh `supabase db reset` would then have applied glasspour's 8-argument `CREATE OR REPLACE` after it, added a second overload and halted on glasspour's exactly-one assertion, while production would apply them in the other order (ADR 0212). `check_migration_order.py` failed on that before the rename and passes after it.
  - A plain rebase without the body change would have silently restored the baseline body. Glasspour's claims row catches that (it reads the last definer for the cross-lot draw), and so does the new T6 on local Postgres. This migration's DO block now also refuses any later edit of it that drops the cross-lot draw.
  - If another migration lands on main before this PR merges, this one must be renumbered past it again (by slug, ADR 0235).
- **Shared files are textual conflicts only.**
  - `.planning/decisions/README.md` index rows are shared with lanes caltakings, cap, dash, doortime, events, glasspour, logs, rec, recregisters, sig, sighting and stateeditor (glasspour's and logs' rows are now on main).
  - `scripts/sql_outside_migrations.txt` (tail) is shared with cellar and events (glasspour's line is now on main).
  - No other lane worktree touches `pos-hub.*`, `pos-mapping-review.*` or OD-161, and none defines either stock RPC in a migration of its own (cap, logs and sig hold glasspour's migration only because they merged main). I re-checked this on 2026-10-04 after the merge across every `wt-fix-*`.
- **`cap`** keeps the `wine_consumption_log` readers on `created_at` (branch as read 2026-10-04), which is what this PR writes the sale instant into, so the two are compatible in either order.
- **`stockout`** (wave 3) depends on this landing first.
- **`doortime`** must reuse `p_occurred_at` and start from this migration's body if it ever redefines `apply_stock_movement`. Its worktree, read 2026-10-04, does not touch either function.

## Not covered (shortcuts, stated per CLAUDE.md §0.5)

- **Tuzlu's numbers do not change on merge.** Only checks imported after the migration are dated by their check. The July-August back-fill keeps its 2026-10-02 dates, and so keeps inflating 30-day velocity and runway until it ages out of that window or F2's repair runs. Longer windows (the 90-day and 120-day demand series) carry it longer.
- **No screen shows the new fields.** The `stock` block, `refusedUnreadableDate` and `next_sale` are API-only: the web has no caller of the POS import or webhook route (`apps/web/src/services/api/posHub.ts` calls neither) or of `/sale-unit-review`. An owner sees the effect only through the corrected dates on new imports, not as a new message on a page.
- **A check refused under F4 is said only to whoever sent the import.** Its line is in the HTTP response's `errors[]`, and the gateway's log line counts it; nothing is stored for it, so no page or status route can show it. A till that posts by webhook and ignores the response leaves those checks missing with no word an owner can see. F4 says the import result says why, and it does; surfacing it to the owner is not built here.
- **Production was not touched or re-measured.** The Tuzlu figures above are from the 2026-10-03 walk. The production ACL on the two functions was not read. Dropping and re-creating them restores the default EXECUTE, as ADR 0141's migration already did. No migration grants or revokes them, and the baseline dump carries no GRANT at all.
- **SQL proof is PGlite and local PostgreSQL 17.11 in Docker**, not Supabase's hosted Postgres. I found no CI job that runs `supabase/tests`.
- **The till's string is read only when it is a strict ISO-8601 instant, and under F4 a check carrying any other `closed_at` is refused.** Four kinds were measured where V8's `Date.parse` and Postgres read a string differently. Each is now settled by the strict read and F4:
  - a zone-less date and time (`2026-10-04 15:00:00`) is still read, in the gateway's own time zone, on every row of the sale, revenue included; Postgres no longer reads it, because the gateway sends `pos_checks.closed_at` as a UTC string;
  - a two-digit year from 50 to 69 (`1/1/50`), which V8 reads as 19xx and Postgres as 20xx, is no longer read; its check is refused;
  - a POSIX-style zone (`… UTC+3`), which V8 reads three hours ahead of UTC and Postgres three hours behind, is no longer read; its check is refused;
  - a string Postgres refuses and V8 reads (`12`, `Table 12`, `0`, `2026-02-30`, `2026-09-31T21:00:00Z`) is no longer read; its check is refused by the gateway, before Postgres sees it, and it is never counted as back-dated. This is the fourth kind, from the BLOCK at `1a7a4137d`.
- **A date alone is read as UTC midnight**, where Postgres reads midnight in its session zone. It was read the same way at `1a7a4137d`.
- **The strings each vendor's API sends were not checked against the grammar.** A format outside it is refused on every check that carries it, so that till's closed checks import nothing until the format is added, and each import says so (F4's cost).
- **A refused check leaves any row already stored for it as it is.** A check main stored from a dotted or slashed string keeps Postgres's reading until it is re-sent in ISO, which the upsert then replaces; its ledger rows, keyed on the check and the line, are not written again, so they keep the date they were booked on (F2). Not repaired here.
- **What `03.10.2026` meant was not settled by reading it.** The local container's `DateStyle` (`ISO, MDY`) reads it as 10 March; production's `DateStyle` was not read. F4 makes that moot for new imports: the check is refused whichever way a reader would take it.
- **The gateway's time zone on Railway is not verified.** If it is not the house's zone, a zone-less `closed_at` is dated in the wrong zone, the same way on every row of that sale. The jest case for it injects an Istanbul reading through a `Date.parse` spy; it does not run a gateway process in that zone.
- **The ledger still uses the database's clock** for `LEAST(p_occurred_at, now())`, so a sale that closed moments before the import, or a clamped one, can sit a little earlier on the ledger than on the check if the database's clock runs behind the gateway's. Not measured.
- **The Toast door still dates its stock at arrival** (three RPC call sites, OPEN in `tech-debt.d`).
- **A check that arrives already voided still adds phantom stock.** It is now dated and counted, but not fixed.
- **Two counting limits:**
  - A replayed void counts as `booked`, because the RPC answers a known key the same as a new one.
  - A sale whose consumption write failed on its first import counts as `booked` again when it is replayed.
- **`get_inventory_balance_at` can read wrong for an instant inside a back-dated span**, because a back-dated row carries its entry-time `quantity_after`. It read wrong there before too. No web caller exists. This is written in ADR 0281's Consequences.
- **`setSaleUnit` edge cases:**
  - A stored volume outside 10 to 30000 ml (writable only by SQL) now makes the answer fail.
  - A stored volume larger than the bottle stays unresolved after the unit is answered.
  - Answering `bottle` over a stored 150 ml still imports 150 ml a sale, and the answer's response does not say so (written in ADR 0281's Consequences; behaviour unchanged here).
- **Not re-run by me:**
  - `check_gateway_boots.sh` was not run locally. The local tree lacks `@simplewebauthn/server`, and no module wiring changed.
  - The 31-suite adjacent jest run is the verifier's result at an earlier head. At this head (`e46fa92a3`) I ran `src/pos-hub` and `src/inventory` (26 suites, 440 tests) and 4 adjacent suites (read-errors, simpos ×2, team-ops-entry; 65 tests), all passing.
  - Neither SQL test was re-run at this head. Neither the fix after the BLOCK at `1a7a4137d` nor F4's commit touches SQL; this lane's test last ran on a template built at `28d32de36` (`[fix] PASS`, `[ctl] FAIL` at T1). ADR 0285's test belongs to #605.
  - `check_migration_order.py` and `check_migration_versions_unique.py` were not re-run by me; no migration changed after the coordinator ran them at `1a7a4137d`.
  - No F4 import ran end to end through an adapter, PostgREST and a database; the spec calls `ingest()` with normalized checks and a mock database. Which `closed_at` values each adapter's `normalize` hands on (a JSON number, for example) was not traced for this commit.
- **This head has not been gated.** The ADR 0090 audits BLOCKED `82e087f34`, `01ac04eaa` and `1a7a4137d`, and all three BLOCKs stand; the PASS at `f9c0d2ef5` does not carry over. No gate result for `4bef334b4` has reached this lane. This head is new and goes to a fresh gate. It adds two commits on `1a7a4137d`: `4bef334b4` (see "Fix for the BLOCK at 1a7a4137d") and `e46fa92a3` (see "Founder ruling F4"). I re-checked it with jest, tsc, eslint, prettier, claims and the guards listed under F4; local Postgres was not re-run after either.
- **What the rewritten claims rows still cannot see:**
  - A function defined through `EXECUTE` inside a DO block.
  - An `E'...'` string with a backslash-escaped quote.
  - A TypeScript regex literal that contains `//` or a quote. The tokenizer does not parse regex literals.
  - An RPC call written without `.rpc(`.
  - `IMPORT-SAYS-STOCK` checks the four code lines that carry the stock block and, statically, the partition code (`decidedLines`, the `tally.lines` increment and `decidedBefore` beside it, the `notStock` remainder, and that those are the only writes to `.lines` and `.notStock`). It does not check that a line lands in only one decided bucket, or the sub-counts; the jest case "partitions every line" tests the first on its fixtures.
  - `DATED-GATEWAY` checks that `saleInstant` reads through `readClosedAt` and that `readClosedAt` opens on the anchored grammar, not the grammar's content, the calendar round trip or the zone-less bound; the jest spec tests those.
  - `UNREAD-CLOSED-AT-REFUSED` does not check that the refusal's `continue` belongs to the per-check loop, that the bound reads `<=`, what the counting line says beyond its key phrase, or which values make `saleInstant` fall back; the F4 jest block tests the refusal end to end on its fixtures.
- **ADR 0285's own claims row** (`ADR-0285-A-SHORT-POUR-OPENS-THE-NEXT-BOTTLE`, merged in #600) still matches its needles in the last definer's body text with comments included. A body that keeps them only in comments would pass it. That row belongs to glasspour's shard and is not edited here.
- **The PR is 16 files.** On 2026-10-04 the founder answered "Allow 16 for #603" (a one-off). It is recorded here and in the fix-lane log, not in ADR 0281 (see "Re-head onto main 1c9eeff00"); neither fix after a BLOCK added a file, and nor did F4's commit. Glasspour's SQL test is main's content (the coordinator's call). So between this merge and #605, main holds a test whose T11 fails against main's own migrations. CI does not run it, so nothing goes red, and **#605 must merge right after this PR**.

Branch `fix/pos-sales-dated-at-sale-time`, PR #603. This body describes head `af7e68990`, which has 16 files against origin/main `1c9eeff00` (merged in at `e0340924c`). The F4 build is `e46fa92a3`; the coordinator's three commits after it are under "Re-head onto main 1c9eeff00". Follow-up: #605 (1 file), which must merge right after this one. The bodies for the blocked heads are kept as `p4-scratch/sim-run/fixes/pr/postime.01ac04eaa.md` and `postime.1a7a4137d.md`, and the body for `4bef334b4` as `postime.4bef334b4.md`.

## Re-head onto main 1c9eeff00 (coordinator, 2026-10-05)

- **`217bddb1f`: the 16-file answer leaves ADR 0281.** CI's PR Audit Gate at `e46fa92a3` returned ESCALATED (run 37262979404): the ownership classifier read ADR 0281 as stating a rule about the audit gate. The match was the review-trail row recording "Allow 16 for #603", which the fix at `4bef334b4` added directly above the row for the audit at `1a7a4137d`. That answer waives ADR 0231's file cap for this PR. It is a fact about merging, not about how a POS sale is dated, and a lane ADR carries no audit, merge or gate rules, so the row was removed. The answer stays in this body and in the fix-lane log. The classifier returns RELEASED at `217bddb1f` and at `af7e68990`.
- **`e0340924c`: main merged in.** #591 landed as `1c9eeff00`. It touches the conversations service and its spec, two orchestrator agents, a new `order_letter_door.py` service, three orchestrator test files, `communications.md`, ADRs 0260 and 0266, two claims files and `scripts/sql_outside_migrations.txt`, and adds migration `20261221093000_an_order_letter_is_staged_once`. Only `decisions/README.md` conflicted, and `merge_main.sh` resolved it by keeping both sides' rows.
- **`81f070a7d`: the migration is renumbered.** `20261221093000` is now production's newest version, so this branch's `20261218180000` sorted behind it (`check_migration_order.py`: OUT OF ORDER). The migration and its test moved to `20261222100000`, well past the ceiling (ADR 0212), and the SQL inventory line moved with them. ADR 0281 cites the migration by slug, so nothing else changed. `check_migration_order` is OK, and `check_migration_versions_unique` passes against main and 55 open PRs.
- **`af7e68990`: SQL re-run, recorded in ADR 0281.** `pgtest.sh lane` on the `28d32de36` template, with #591's migration and this one applied in order: `[fix] PASS`, and `[ctl] FAIL` at T1 (`p4-scratch/sim-run/fixes/audits/603-local-pg-217.txt`).
- **Re-run at `af7e68990`:** jest `src/pos-hub`, 12 suites and 210 tests passed. `tsc -p tsconfig.spec.json` shows only the 2 pre-existing `@simplewebauthn` errors. `check_adr_numbers_unique`, `check_od_ids_exist`, `check_decision_claims.sh` and `check_migrations_single_home` pass.
- **File count:** 16 against origin/main `1c9eeff00`.

## Re-head onto main 28d32de36 (coordinator)

The ADR 0090 audit PASSed at `f9c0d2ef5`. Before it could merge, main moved: #595 landed as `28d32de36`. That change touches only Python and docs (`provider_communication_agent.py`, its test, ADR 0260, one claims file) and has no migration. The coordinator merged it in at `1a7a4137d`, with no conflicts. The PASS at `f9c0d2ef5` does not carry over, so this head is audited afresh. Re-run at this head:
- `check_adr_numbers_unique`, `check_od_ids_exist`, `check_decision_claims` and `check_migration_versions_unique` all pass.
- `check_migration_order` is OK: `20261218180000` sorts after main's newest, `20261218150000`.
- The file count is still 16.
- `pgtest.sh lane` on a template rebuilt at `28d32de36` gives `[fix] PASS`, and `[ctl] FAIL` at T1. This is appended to `603-local-pg.txt`.

## Fix for the BLOCK at 1a7a4137d

The ADR 0090 audit of `1a7a4137d` overturned that head (BLOCK; both reviewers approved with notes, the planner overturned). That BLOCK stands. The fix is `4bef334b4`, one commit on `1a7a4137d`. This section describes that commit; where it says "this head" or "here", it means `4bef334b4`. Founder ruling F4 then changed what happens to a check whose `closed_at` the strict read does not read; the sentences below that F4 made stale say so, and the next section has the rest.

- **What it found.** `saleInstant` read `closed_at` with V8's `Date.parse`, which reads strings Postgres refuses: `"12"` and `"Table 12"` as 1 December 2001, `"0"` as 1 January 2000, `"2026-02-30"` as 2 March, `"2026-09-31T21:00:00Z"` as 1 October. On main, Postgres refused such a check and `errors[]` said so. At `1a7a4137d` it was stored with V8's instant, and its stock and consumption were dated by it; a reading more than 72 hours old was counted only in `backdatedOver72h`, and one inside 72 hours left no trace. The ADR and this body named three kinds of disagreement and missed this fourth.
- **The fix, the auditor's first option.** `saleInstant` now reads through `readClosedAt` (`pos-hub.service.ts`). A string, trimmed, is read only when it matches one shape, an extended date `YYYY-MM-DD`, optionally `T` or one space and `hh:mm`, `hh:mm:ss` or `hh:mm:ss.f` (1 to 9 digits, cut to the millisecond), optionally `Z` or an offset `±hh`, `±hhmm` or `±hh:mm` (at most 14 hours, minutes up to 59). Its written year, month, day, hour, minute and second must also come back unchanged from the UTC calendar. Then:
  - with `Z` or an offset, the instant is the written wall clock minus the offset, by arithmetic, with no `Date.parse`;
  - a date alone is UTC midnight, as at `1a7a4137d`;
  - a date and time with no zone keeps `Date.parse`'s reading in the gateway's zone, as at `1a7a4137d`, but only when it lies within 14 hours of the written wall clock.

  At `4bef334b4`, anything else took the existing fallback: the check kept the till's value for Postgres to read or refuse, and `backdatedOver72h` stayed false. When Postgres stored the check, its stock and consumption took import time, counted in `datedAtImportTime` and said in `errors[]` as "carried a closed_at that is not an ISO-8601 date the import reads"; when Postgres refused it, nothing was stored, no stock moved, and `errors[]` said so, as on main. **F4 replaces that fallback:** a check whose `closed_at` is present and not read is now refused by the gateway before anything is written, `errors[]` says "date not readable — write it as 2026-10-03 21:00", and `datedAtImportTime` and its sentence are gone (see "Founder ruling F4"). One file of code changed, plus its spec.
- **RFC 2822 is not read** (decided here, reasons in ADR 0281). No adapter builds one: Clover sends `new Date(modifiedTime).toISOString()`, and Square, Toast, the generic webhook and CSV pass the payload's value as sent. It is a second grammar with its own zone names. Its weekday was not checked by either reader when measured: `Mon, 03 Oct 2026 22:00:00 +0300` (a Saturday) reads as 19:00 UTC in both. A check that carries one is refused and said (F4), so the format can be added with its own tests.
- **What else changed from `1a7a4137d`, for the gate to judge:**
  - `"1/1/50"`, `"… UTC+3"`, RFC 2822, `"04.10.2026 15:00"`, `"10/04/2026 3:00 PM"` and `"03.10.2026"` are no longer read. **Under F4 a check carrying one is refused**: it is not imported, moves no stock, writes no consumption, and `errors[]` says "date not readable — write it as 2026-10-03 21:00". (At `4bef334b4` such a check kept Postgres's reading, as on main, and its stock and consumption took import time, counted and said; F4 replaced that.)
  - `"03.10.2026"`: Postgres (`DateStyle` `ISO, MDY`, the local container) and V8 both read it as 10 March. **Under F4 it is refused**, so it is neither stored as 10 March nor dated at all; the house re-exports it as `2026-10-03 21:00`. (At `4bef334b4` the check kept Postgres's 10 March, as on main, and its stock took import time. The founder decided on 2026-10-05 that it is refused, not read either way.)
  - `"…T22:00:00+03"` (a short offset, which Postgres reads and V8 does not) is now read. At `1a7a4137d` it fell back.
  - `24:00`, a leap second `:60` and an offset beyond 14 hours are not read, so **under F4 their checks are refused**. (At `4bef334b4` Postgres read the first two as the next day or minute, and the check kept that.)
- **Measured readings.** `p4-scratch/sim-run/fixes/audits/603-closed-at-casts.txt`: read-only `SELECT` casts in the local PostgreSQL 17.11 container (`TimeZone` UTC, `DateStyle` `ISO, MDY`) beside Node v22.22.2's `Date.parse` on this Mac (America/Detroit, not the production gateway). No production call was made.
- **Tests at `4bef334b4`** (from `apps/api-gateway`, `env LC_ALL=C`; outputs in `p4-scratch/sim-run/fixes/snap/postime-block3/`; F4 replaced the import cases below for the five strings Postgres refuses, for `"1/1/50"` and `"… UTC+3"`, and for the unreadable `closed_at`; see "Founder ruling F4"):
  - `pos-hub.sale-time.spec.ts` grows from 25 to 55 cases. `saleInstant` falls back on `"12"`, `"Table 12"`, `"0"`, `"2026-02-30"`, `"2026-02-30T10:00:00Z"` and `"2026-09-31T21:00:00Z"` with `backdatedOver72h` false; on nine other strings that are not a strict instant; and it reads nine strict forms (offsets `+03`, `+0300`, `-02:30`, `Z` without seconds, a 6-digit fraction, a date alone, 29 February 2024, year 0050, padded whitespace). A zone-less reading is kept at 14 hours from the wall clock and dropped 1 ms past it. With the database mock refusing the check as Postgres does, an import of each of the five refused strings sends it as written, stores no check, moves no stock, writes no consumption and puts exactly one line in `errors[]`. The ingest cases for `"1/1/50"` and `"… UTC+3"` now assert the fallback on all six stock and consumption dates. The `"not a date"` case is kept.
  - **Red, then green**, the final spec against three services. The fixed service was copied aside with `cp -p`, `git show <ref>:<path>` put the old one in place, and the copy was put back after each run (no stash):
    - `1a7a4137d`'s service: 22 failed, 33 passed (`run-at-1a7a4137d.txt`). Every case for a string Postgres refuses fails, both in `saleInstant` and on import. The 33 that pass pin behaviour the strict read keeps;
    - origin/main `28d32de36`'s service: 54 failed, 1 passed, the open check (`run-at-main-28d32de36.txt`);
    - this head: 55 passed (`green-4bef334b4.txt`).
  - `npx jest src/pos-hub src/inventory --runInBand --forceExit`: 26 suites, 428 tests, all passing. The 4 adjacent suites (read-errors, simpos ×2, team-ops-entry): 65 tests, all passing.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.spec.json` shows 2 errors, both the missing `@simplewebauthn/server` in `src/passkeys/passkeys.service.ts`. **Lint:** eslint on the two changed TS files reports nothing, and prettier `--check` passes on both.
- **Claims** (`claims.d/fix-pos-sales-dated-at-sale-time.jsonl`, static Python, comments stripped):
  - `TD-2026-10-03-POS-SALE-DATED-GATEWAY` now checks `const parsed = raw ? readClosedAt(raw) : NaN` in `saleInstant`, that `saleInstant`'s body names no `Date.parse`, that `readClosedAt` opens by matching `ISO_CLOSED_AT` and returning NaN on no match, and that `ISO_CLOSED_AT` is anchored by `^` and `$`. It does not check the grammar's content, the round trip or the zone-less bound; the spec does. It exits 0 here, 1 at `1a7a4137d` and 1 on origin/main `28d32de36`.
  - `TD-2026-10-03-POS-IMPORT-SAYS-STOCK` said the tally "counts every line" while checking four strings (the audit's note). It now also checks that `decidedLines` sums exactly the five decided buckets, once each; that `applyStockEffects` adds `items.length` to `tally.lines` and reads `decidedBefore` in the next statement; that `notStock` takes the remainder; and that those are the only two writes to `.lines` or `.notStock` in the file. Its prose says it does not check that a line lands in only one bucket (the jest case "partitions every line" does, on its fixtures) or the sub-counts. It exits 0 here and at `1a7a4137d` (that code did not change), and 1 on origin/main `28d32de36`.
  - Mutated in a scratch copy of the service. Each mutation must find its anchor exactly once, so none can be a no-op. Every one exits 1 (`mutations.txt`, re-run at `4bef334b4` with the same results):
    - GATEWAY: `saleInstant` back to `Date.parse(raw)`; a second `Date.parse` beside `readClosedAt`; `readClosedAt` without its no-match return; `ISO_CLOSED_AT` without `^`, or without `$`; `readClosedAt` renamed so the call has no definition; and two earlier mutations re-run (one RPC's `p_occurred_at` dropped, `closed_at` back to `check.closedAt ?? null`);
    - STOCK: `tally.lines` not incremented; incremented by one less; `decidedBefore` read after the loop; `notStock += 0`; `failed` dropped from `decidedLines`; `alreadyBooked` replaced by a second `booked`; a stray `tally.notStock++` on the food line; a stray `++tally.lines`.
- **Docs.** ADR 0281's Decision, Consequences, Assumptions, local Postgres paragraph and review trail are updated (see "ADR, CLAIMS and register touched"). The `tech-debt.d` citations moved with the new code (`:208`, `:1288`, `:1291` at `4bef334b4`; F4 moved them again).
- **Guards at `4bef334b4`**, each exit 0: `check_adr_numbers_unique.py` (1688 refs; 0281 introduced here), `check_od_ids_exist.py`, `check_decision_claims.sh` (862 checked, 862 holding), `check_read_errors_not_swallowed.py` (151 sites, all baselined, 0 new), `check_citation_pairing.py`, `check_no_conflict_markers.py`. A sweep of every `scripts/check_*.py` not left out below (51 scripts, those above included): 46 exit 0. The other 5 cannot run without a database or a `.env` (`check_beverage_identity_parity`, `check_beverage_kind_regression`, `check_display_name_parity`, `check_house_item_invariants`, `check_migration_ledger`) and were not pointed at one. Left out of the sweep because a grep found a network or database client in them: `check_ask_ai_is_gated`, `check_data_terms_name_every_host`, `check_definer_functions_closed`, `check_deployed_sha`, `check_fk_repoint_by_referenced_column`, `check_migration_order`, `check_migration_versions_unique`, `check_new_tables_are_locked_down`, `check_queried_tables_exist`, `check_web_deployed_sha`. Five shell guards (`check_no_direct_stock_writes`, `check_no_direct_type_attributes_access`, `check_no_guest_name_matching`, `check_no_raw_guest_channels`, `check_model_calls_logged`) exit 0. Sweep output: `guard-sweep.txt`.
- **File count:** 16 against origin/main `28d32de36` (fetched before the commit). This fix added no file.

## Founder ruling F4 (commit `e46fa92a3`)

The founder ruled F4 on 2026-10-05: "Refuse, say why (Recommended)". The question and the option text are quoted under "Founder answers". `e46fa92a3` builds it as one commit on `4bef334b4`. It touches 7 files, all already in this PR.

- **What it builds** (`pos-hub.service.ts`):
  - `ingest()` still takes one reading of each check's `closed_at` (`saleInstant`) before it stores the check. If that reading fell back and the `closed_at` is present (neither `null` nor `undefined`), the check is refused right there, before the `pos_checks` upsert. No check row is written, no stock moves, and no consumption row is written.
  - `errors[]` gets one line per refused check, for example `c-bad: not imported, date not readable — write it as 2026-10-03 21:00 (closed_at was "03.10.2026")`. The value is JSON-quoted and cut at 80 characters.
  - The first 50 refused checks are named. Past that, one line says how many more were not imported, "counted in refusedUnreadableDate, not named here". An export written in one unread format is refused check by check, and this keeps it from flooding `errors[]`.
  - The result gains `refusedUnreadableDate`. A refused check counts there and in `received`. It is not counted in `upserted`, `wineItemsDetected` or the `stock` block, so it is not in `backdatedOver72h` either. Every other check received is upserted or named in `errors[]` as not stored, as before.
  - **An open check** (`closed_at` null or absent) is not refused. It is stored with no `closed_at` and moves no stock, as before.
  - **Values that are not strings, and blank strings, are refused** like any other unread value. That covers a number, a boolean, any other non-string, and an empty or blank string. A number could be epoch seconds or milliseconds, and the import does not guess which. ADR 0281 records this under "Founder ruling F4".
  - **Removed:** the fallback that dated an unread check's stock and consumption at import time, with its count `datedAtImportTime` and the stock report's `closed_at` failure kind. A future close time is still clamped to import time on the stock and consumption rows (F1); that is not a fallback and is unchanged.
  - **A correction to the commit body.** `e46fa92a3`'s message says "With nothing left to date at import time". That is broader than the code: what is gone is the fallback for an unread `closed_at`, and the future-time clamp above still dates those rows at import time. The commit is not rewritten; this sentence is the correction.
  - In `ingest()`, `fellBack` now covers only two cases, an open check and a refused one, and neither reaches a stock write. `applyStockEffects` throws if it is handed a reading that fell back, so a later caller cannot use it to date stock at import time.
  - `saleInstant` and `readClosedAt` are unchanged in code. Their docstrings now say what `ingest()` does with a fallback.
- **What changes from `4bef334b4`, for the gate to judge:**
  - Every `closed_at` the strict read does not read is now refused, not stored with Postgres's reading. The list is under "What else changed from `1a7a4137d`", and the founder's five examples are among them: `03.10.2026`, `10/03/2026 3:00 PM`, `12`, `2026-02-30` and an RFC 2822 date.
  - A string Postgres would have refused (`12`, `2026-02-30`, …) is now refused by the gateway, before the upsert. The F4 line replaces Postgres's error message, and only the first 50 such checks are named.
  - A refused check leaves any row already stored for it as it is. This is ADR 0281's "The cost F4 names".
  - `datedAtImportTime` is gone from the `stock` block. No web code calls the POS import route (see Not covered).
- **Measured readings.** `p4-scratch/sim-run/fixes/snap/postime-ruling/casts-ruling.txt` holds read-only casts in the local PostgreSQL 17.11 container (`TimeZone` UTC, `DateStyle` `ISO, MDY`), taken 2026-10-05:
  - `03.10.2026` reads as 2026-03-10;
  - `10/03/2026 3:00 PM` reads as 3 October 15:00;
  - the RFC 2822 string reads as 19:00 UTC;
  - `12`, `2026-02-30`, `""`, `"   "`, and two epoch values written as digit strings (`1784000000000`, `1784000000`), are errors.

  Production's `DateStyle` was not read, and no production call was made.
- **Tests** (from `apps/api-gateway`, `env LC_ALL=C`; outputs in `p4-scratch/sim-run/fixes/snap/postime-ruling/`):
  - `pos-hub.sale-time.spec.ts` goes from 55 to 67 cases. A new block, "a closed_at the import does not read is refused, not imported (ADR 0281, F4)", has 19 of them:
    - The founder's five strings: `03.10.2026`, `10/03/2026 3:00 PM`, `"12"`, `2026-02-30` and `Sat, 03 Oct 2026 22:00:00 +0300`.
    - Eight more strings: `1/1/50`, `2026-10-04 15:00:00 UTC+3`, `Table 12`, `0`, `2026-09-31T21:00:00Z`, `sometime on Tuesday`, `""` and `"   "`.
    - Three values that are not strings: `1791061200000`, `1791061200` (the same instant as epoch milliseconds and as seconds) and `false`.
    - Each of those 16 cases asserts that there is no check row, no RPC, no consumption row and nothing queued. It also asserts `received` 1, `upserted` 0, `refusedUnreadableDate` 1, `wineItemsDetected` 0, a zero `stock` block, and `errors[]` equal to exactly the one line with the message.
    - An import of an ISO check from July, a `03.10.2026` check and an open check gives:
      - `received` 3, `upserted` 2, `refusedUnreadableDate` 1 and `wineItemsDetected` 2;
      - a `stock` block of `lines` 1, `booked` 1, `backdatedOver72h` 1 and the rest 0;
      - one RPC, one consumption row and one error line.
    - 53 refused checks give 51 error lines. The 50th names `c-49`, and the 51st reads "3 more checks were not imported, …; counted in refusedUnreadableDate, not named here".
    - `applyStockEffects`, handed `03.10.2026` directly, rejects with `closed_at "03.10.2026" was not read` and makes no RPC or consumption call.
  - The open-check case is now two cases, `null` and `undefined`.
  - Eight cases are removed, and F4 refuses each of their inputs before the upsert:
    - the case that dated an unreadable check's stock at import time;
    - the five where the mock database refused the check as Postgres does;
    - the `1/1/50` and `UTC+3` ingest cases that asserted import-time dates.

    The new block covers each of those strings.
  - The partition case's expected tally no longer has `datedAtImportTime`.
  - **Red, then green**, the final spec against four services. The new service was copied aside with `cp -p`, `git show <ref>:<path>` put the old one in place, and the copy was put back after each run (no stash):
    - `4bef334b4`: 20 failed, 47 passed (`run-at-4bef334b4.txt`). All 19 F4-block cases fail. So does the A-029 partition case, whose expected tally no longer has `datedAtImportTime`.
    - `1a7a4137d`: 34 failed, 33 passed (`run-at-1a7a4137d.txt`).
    - origin/main `28d32de36`: 65 failed, 2 passed (`run-at-28d32de36.txt`). The two that pass are the open-check cases.
    - This head: 67 passed (`green-sale-time.txt`).
  - Wider runs, all passing:
    - `src/pos-hub`: 12 suites, 210 tests;
    - `src/pos-hub src/inventory`: 26 suites, 440 tests;
    - the 4 adjacent suites (read-errors, simpos ×2, team-ops-entry): 65 tests.
- **Typecheck:** `npx tsc --noEmit -p tsconfig.spec.json` shows 2 errors, both the missing `@simplewebauthn/server` in `src/passkeys/passkeys.service.ts`.
- **Lint:** eslint on the two changed TS files exits 0 with no output, and prettier `--check` passes on both.
- **Claims** (`claims.d/fix-pos-sales-dated-at-sale-time.jsonl`, static Python, comments stripped). A new row, `TD-2026-10-03-POS-UNREAD-CLOSED-AT-REFUSED`, checks:
  - the message string, and the bound of 50;
  - that exactly one refusal `if` (`when.fellBack && check.closedAt !== null && check.closedAt !== undefined`) sits after the reading and before every `pos_checks` upsert;
  - that the refusal block counts, pushes the named line and ends with `continue;`;
  - that the counting line exists, and that the result returns `refusedUnreadableDate`;
  - that every object `saleInstant` returns has `fellBack: false` exactly when its `closedAt` is `read`;
  - that `applyStockEffects` opens with the `fellBack` throw and names `fellBack` nowhere else;
  - that `datedAtImportTime` appears nowhere in the code.

  Its limits are under Not covered. `IMPORT-SAYS-STOCK`'s prose now says `datedAtImportTime` was removed. The verify for that row did not change.

  | Row | This head | `4bef334b4` | origin/main `28d32de36` | Mutations that exit 1 | Control exits 0 |
  |---|---|---|---|---|---|
  | UNREAD-CLOSED-AT-REFUSED | 0 | 1 | 1 | 13 of 13 | 1 of 1 |
  | DATED-GATEWAY | 0 | 0 | 1 | 8 of 8 | — |
  | IMPORT-SAYS-STOCK | 0 | 0 | 1 | 8 of 8 | — |

  The mutations were made in a scratch copy of the service, and each must find its anchor exactly once, so none can be a no-op. Harness: `mutate.py`; results: `mutations.txt`.
  - The REFUSED mutations:
    - the refusal removed, or moved after the upsert;
    - its `continue` dropped;
    - the message reworded without the instruction;
    - its `errors.push` dropped;
    - the condition narrowed to `typeof check.closedAt === "string"`, so numbers pass;
    - `refusedUnreadableDate` left out of the result;
    - the `applyStockEffects` guard removed;
    - an import-time count put back in `booked()`;
    - `saleInstant`'s fallback returning `fellBack: false`;
    - the bound set to 0;
    - the counting line dropped;
    - `datedAtImportTime` put back in the tally.
  - The control changes only the words after the instruction.
  - The GATEWAY and STOCK mutations are the 16 listed under "Fix for the BLOCK at 1a7a4137d", re-run at this head.
- **Guards at `e46fa92a3`**, run before the commit on the same tree:
  - Each of these exits 0:
    - `check_decision_claims.sh`: 863 checked, 863 holding (862 before, plus the new row);
    - `check_adr_numbers_unique.py`: 1692 refs, and 0281 is introduced here;
    - `check_od_ids_exist.py`;
    - `check_read_errors_not_swallowed.py`: 151 sites, all baselined, 0 new;
    - `check_citation_pairing.py`;
    - `check_no_conflict_markers.py`.
  - The same sweep as at `4bef334b4` covers 51 `scripts/check_*.py` and the same 10 left out (output in `guard-sweep.txt`):
    - 46 exit 0;
    - the same 5 cannot run without a database or a `.env`;
    - each script's exit code is the same as at `4bef334b4`.
  - The five shell guards exit 0 (`guard-shell.txt`).
- **Docs** (see "ADR, CLAIMS and register touched"):
  - ADR 0281: the ruling, Options, Decision, Consequences, Assumptions, Revisit and the review trail;
  - the index row in `decisions/README.md`;
  - the `08-softwares/pos-bridge.md` bracket;
  - the `tech-debt.d` entry, whose citations moved again, to `:213`, `:1331` and `:1334`.
- **File count:** 16 against origin/main `28d32de36`, fetched after the commit. F4 added no file.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
