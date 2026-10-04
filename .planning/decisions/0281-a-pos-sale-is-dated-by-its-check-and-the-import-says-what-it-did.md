# 0281 — A POS sale is dated by its check, and the import says what it did

- **Status:** Proposed 2026-10-03 (lane `postime`, branch `fix/pos-sales-dated-at-sale-time`). The build follows the coordinator's plan. Three forks wait on the founder and are **not** decided here: F1 (how old a closed_at the server trusts), F2 (repairing rows already written) and F3 (which lane owns the two RPC signatures).
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** closed_at, p_occurred_at, transaction_date, apply_stock_movement, record_glass_pour, wine_consumption_log, recorded_at, created_at, back-fill, late webhook, saleInstant, backdatedOver72h, datedAtImportTime, stock tally, errors[], pos_unresolved_lines, sale-unit review, sale_volume_ml, next_sale, effect_if_unanswered, queue_on_next_sale, A-007, A-009, A-029, A-041, AW03, AW08, AW11, C02, F-088
- **Links:** migration `a_pos_sale_is_dated_by_its_check` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); [[0011-pos-sale-volume-contract]] (the sale-volume order the review now reads); [[0141-a-stock-write-names-the-house-it-is-for]] (the function body this migration copies); [[0093-a-scenario-is-replayed-and-verified-against-its-own-expectation]] (the void key); [[0240-register-entries-are-fragments]]; `claims.d/fix-pos-sales-dated-at-sale-time.jsonl`; `tech-debt.d/2026-10-03-fix-pos-sales-dated-at-sale-time.md` (the Toast door and the phantom void); OD-161 (amended in place with the dashboard's out-of-stock alert); the analytics walk on Tuzlu Rüzgar, 2026-10-03, read-only (brief `p4-scratch/sim-run/fixes/briefs/postime.md`, outside the repo)

## Context

The owner-quarter sim back-filled July and August through the generic POS import in October. `pos_checks.closed_at` kept each check's own close time. Everything the import derived from the check did not:

- **The stock ledger (A-007).** `apply_stock_movement` and `record_glass_pour` took no instant and stamped `inventory_transactions.transaction_date = now()` (0141's body, and the baseline's for the pour). Two months of sales landed on one October day. /inventory velocity read about double (median 2.04x the truth over 112 rows) and runway about half; 34 rows showed five days of cover or less where the truth had 11.
- **The demand series (A-009).** `wine_consumption_log` rows took their column defaults, `recorded_at = created_at = now()`. /reports' week shape and the 14-day forecast were built from one import day, so Friday was the only trading day and the backtest error read 100%.
- **The import result (A-029).** About 811 July–August POS lines (847 pours) and 8 bottle lines moved no stock: 752 on the stranded-lot cause (AW08), 59 on rows whose book was already empty. `ingest()` had an `errors[]`, but `applyStockEffects` returned `void` and a refused write was only logged, so the import read as clean and the unresolved queue was empty.
- **The sale-unit review (A-041, AW11).** The review read each mapping without `sale_volume_ml`, called every row with a null `sale_unit` unanswered, and hard-coded `effect_if_unanswered: "depletes_nothing"` on every row. The import reads `sale_volume_ml` first (ADR 0011), so 57 glass, single and carafe buttons were reported as depleting nothing while their sales took stock out.

The same mis-dating happens in a real house whenever a webhook arrives late or is replayed, and on every CSV back-fill. The sim only made it large.

## Options considered

**Where the sale's instant goes.**

1. **Do nothing.** Every late or replayed check keeps landing on its arrival day, and every rate built on the ledger or the demand series is wrong by the size of the lag. Rejected.
2. **The gateway rewrites `transaction_date` after the RPC.** A second write per line, outside the function's transaction, against a table whose writes ADR 0141 routed through the wrappers on purpose. Rejected.
3. **A new `occurred_at` column beside `transaction_date`.** Every reader would have to change to use it, and `transaction_date` already means "when it happened" to all of them. Rejected.
4. **An optional `p_occurred_at` on both RPCs, written as `LEAST(COALESCE(p_occurred_at, now()), now())` (chosen).** NULL keeps today's behaviour, so the gateway that is still running during the deploy window keeps working. A future instant is clamped to now, so no caller can book stock into the future. `created_at` stays the entry time, so the ledger still shows when a row was typed in.

**How the function changes.** `CREATE OR REPLACE` with a new argument creates a second overload, and PostgREST resolves a named call by its argument names, so the old 8-argument pour call would become ambiguous. The migration drops each old signature and creates the new one with its body copied verbatim, then asserts that exactly one of each function survives with the new argument last. The two positional SQL callers (`set_stock_absolute` and `record_stock_count`, 11 arguments) still resolve; the SQL test proves it.

**What the consumption row's dates are.** `recorded_at` is the sale's instant. `created_at` is set to it too, because every reader of the series filters on `created_at` today. Moving those readers to `recorded_at`, so `created_at` can go back to meaning entry time, belongs to the cap lane, which owns them. Setting only `recorded_at` would have left A-009 standing until then.

**What the import reports.** Logging alone is what A-029 measured as invisible. One `errors[]` line per failed line would put 800 lines into one response. Chosen: a `stock` block that counts every line on a closed check into exactly one of `notStock`, `booked`, `alreadyBooked`, `queued.unmapped`, `queued.no_sale_volume` and `failed`, with `consumptionNotWritten`, `backdatedOver72h` and `datedAtImportTime` as sub-counts of what moved, plus `errors[]` lines grouped by (failure kind, item), at most 50 groups and one line that counts the rest.

**What the review reports.** A per-row `next_sale`, computed by the import's own `resolveSaleVolume` and the shared `inventoryVolumesFromRow` over the same columns, replaces the hard-coded constant.

## Decision

A POS sale's stock movement and its consumption row are dated by the check's `closed_at`, never later than now, and the import result counts and names every line that moved no stock. What carried it: the database already held the true time on `pos_checks`, so the only honest date for what the import derives from a check is that one. A count that partitions every line is the only shape in which "nothing failed" can be checked rather than assumed (the absence-reported-as-health failure A-029 measured).

How it is built:

- **Migration `a_pos_sale_is_dated_by_its_check`.** It gives `apply_stock_movement` (now 19 arguments) and `record_glass_pour` (now 9) a last argument, `p_occurred_at timestamptz DEFAULT NULL`, and dates the ledger row by `LEAST(COALESCE(p_occurred_at, now()), now())`. ADR 0141's house refusal and the pour's stranded-lot refusals are copied unchanged, and the migration asserts they are still in the bodies. AW08's stranded-lot behaviour is not changed here; its failures are now counted and said.
- **`saleInstant(closedAt, nowMs)`** (`pos-hub.service.ts`, exported, pure). It is read once per check. A readable closed_at that is not in the future is passed through as the string the till sent, so Postgres reads it exactly as it read `pos_checks.closed_at`, and a sale's stock and its revenue cannot land on different days. A future one is clamped to now. An unreadable one falls back to import time and is counted (`datedAtImportTime`) and said in `errors[]`.
- **Voids.** A void is dated by the voided check's `closed_at` too, the same instant as the sale it cancels.
- **`recordConsumption`** takes the instant, writes `recorded_at` and `created_at` from it, and returns `logged`, `already` (a 23505 replay) or `failed`. The one `logger.error` on failure is kept.
- **`queueUnresolvedLine`** returns ok or failed. A 23505 means already queued and counts as queued. Any other error counts as failed, because a line that moved no stock and is not in the queue is lost from every list a person reads. The three queue call sites are left as they were, because the `iswine` lane edits that branch. The queue counts its own outcome into the check's report.
- **`ingest()`** returns `stock` and appends the grouped stock lines to `errors[]`.
- **The sale-unit review.** It selects `sale_volume_ml`, reads the inventory of every mapping, and gives each row `sale_volume_ml` and `next_sale` (`whole_bottle`, `volume` with its ml, or `depletes_nothing` with a reason and `queued_as`). `needing_unit` counts the mappings whose sale volume the import cannot resolve. The default list is those rows. `queue_on_next_sale` counts every mapping whose next sale lands in `pos_unresolved_lines`. `EFFECT_IF_UNANSWERED` is deleted, and the DTO's stale `?? "bottle"` docstring is corrected.
- **`setSaleUnit`** now passes the mapping's own `sale_volume_ml` back to `upsertItemMapping`. Before, answering "glass" on a 150 ml button wiped the volume the import reads first, so the button's next sale queued. Found while building this; adjacent to A-041.

## Deviations from the plan, said plainly

- **`queue_on_next_sale` also counts wine rows that queue as `unmapped`** (no inventory id, or an id this house's scoped read does not return), and it counts over all mappings, not only the returned rows. The plan named the `no_sale_volume` rows. The field's name is "lands in the queue on its next sale", and an `unmapped` row does land there, so counting only half of them would repeat the A-041 error in the other direction. In the existing spec this moves the count from 1 to 2.
- **`needing_unit` reads a `'glass'` label as unanswered** while the inventory row it reaches has no pour size, because that is how the import resolves it. Two existing review tests gained an inventory fixture with a pour size for this reason.
- **The stock counters drop `noQuantity`.** A zero-quantity line counts as `notStock`, under the plan's own list of counters.
- **The defect-register lines went to `tech-debt.d/`**, not to `v3.0-TECH-DEBT.md`. That file is frozen by ADR 0240, and the build fails on any added line.

## Forks left to the founder

- **F1. How old a closed_at the server trusts.** As built, option (a): any past closed_at is trusted, however old, and `stock.backdatedOver72h` counts the lines this import booked more than 72 hours after their check closed. The alternatives are (b) refusing or queueing a check older than a bound until a manager confirms it, which the sim triage's C02 asks of door receipts, counts and orders, or (c) a per-house setting. Changing it later is one branch in `saleInstant` plus a queue reason.
- **F2. Repairing rows already written.** The ledger rows and consumption rows already written by back-fills and late webhooks keep their import-day dates. A repair would re-date `inventory_transactions` rows whose `idempotency_key` starts with `pos:` from their `pos_checks.closed_at`, and `wine_consumption_log` rows whose `notes` key does the same. It writes production rows, so the founder runs it. Nothing is written by this branch.
- **F3. Which lane owns the two RPC signatures.** The recommendation is (a): this lane owns `p_occurred_at`, and any other lane that redefines either function starts from this migration's body. **This has a live consequence.** The `glasspour` lane (ADR 0285, migration `a_short_pour_opens_the_next_bottle`, read 2026-10-03 in its worktree) redefines `record_glass_pour` with `CREATE OR REPLACE` and the 8-argument signature. Whichever of the two lands second must carry the other's change, or the result is wrong:
  - If `glasspour` lands after this migration, its 8-argument `CREATE OR REPLACE` adds a second overload instead of replacing the 9-argument one. The gateway's 9-argument call keeps the old pour body, and an 8-argument named call becomes ambiguous.
  - If it lands before, this migration's verbatim copy of the baseline body undoes its short-pour fix.

  The claims `TD-2026-10-03-POS-SALE-DATED-POUR` and `TD-2026-10-03-POS-SALE-DATED-MOVEMENT` read the **last** migration that defines each function, so the first case fails the build, not production. Nothing mechanical catches the second case: its body still carries `p_occurred_at`, so the claim passes. Whoever merges must check it by hand.

## Consequences

- **Easier.** A late webhook, a replay and a back-fill all land on the day the check closed, in the ledger and in the demand series. Velocity, runway, the week shape and the forecast read the true days without any reader changing. An import that moved no stock says so, with counts that add up to the lines it received. The review's "does nothing" now means what the import does.
- **Harder or given up.**
  - `wine_consumption_log.created_at` no longer means entry time for POS rows until the cap lane moves the readers to `recorded_at`.
  - Both RPCs gained an argument, and any lane redefining them now has to carry it (F3).
  - `stock.booked` is read from the consumption row on a sale, so a line whose consumption write failed on its first import counts as booked again when it is replayed. A replayed void always counts as booked, because the RPC answers a known key exactly as it answers a new one.
  - A check that arrives already voided still adds stock it never took (`tech-debt.d/2026-10-03-fix-pos-sales-dated-at-sale-time.md`). It is now dated and counted, but it is not fixed.
  - The Toast door still dates its stock at arrival (same fragment).
- **Assumptions, not verified.**
  - The gateway runs in UTC, and the database session time zone is UTC. JavaScript reads a closed_at with no zone as local time while Postgres reads it in the session zone. Because the string itself is passed through, both stored dates match `pos_checks.closed_at` whatever the zones are. Only the 72-hour count and the future clamp use JavaScript's reading.
  - The SQL test ran in PGlite on a build of every migration, not in Postgres 15 on Supabase.
- **Revisit when** F1 is ruled, when the cap lane moves the consumption readers, or when a second writer of either RPC appears (the Toast door is the known one).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | — | Created (lane `postime`, local commit, not pushed) |
