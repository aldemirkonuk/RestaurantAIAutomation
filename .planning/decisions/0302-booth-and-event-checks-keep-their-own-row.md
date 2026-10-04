# 0302 — Booth and event checks keep their own row, and the POS names the channel

- **Status:** Locked for the ruling, and Proposed for the method (the convention of [[0285-a-short-pour-opens-the-next-bottle]]). The ruling is the founder's: AskUserQuestion, 2026-10-04 ~00:30Z, verbatim pick *"Own row, POS field (Recommended)"*. The order-type fork (AW24-b) is also the founder's: AskUserQuestion, 2026-10-04 ~20:50Z, verbatim pick *"Wait, then owner maps (Recommended)"*. The method below (the column, the vocabulary, the import tally, the reader exclusions and the row) is lane booth's proposal, built for his review.
- **Date:** 2026-10-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** pos_checks.channel, booth_event, Booth & events, check channel, order type, Clover orderType, tableRef, CanonicalCheck, checkChannelOf, waiter performance, peer comparison, table-adjusted fit, hot tables, takings, street fair, AW24, A-050, Kerem, Tuzlu Rüzgar
- **Links:** migration `a_check_carries_its_channel` and its `supabase/tests` file of the same slug (cited by slug, [[0235-a-migration-is-numbered-at-merge-and-cited-by-its-slug]]); `claims.d/feat-a-check-carries-its-channel.jsonl`; `claims.d/feat-booth-and-event-checks-own-row.jsonl`; ADR 0281 (lane postime, `fix/pos-sales-dated-at-sale-time`, not on main at the time of writing: the import-result tally pattern); ADR 0292 (lane cap, `fix/analytics-reads-past-row-cap`, not on main at the time of writing: it brings the booth checks into the window); the lane brief `p4-scratch/sim-run/fixes/briefs/booth.md` and plan `p4-scratch/sim-run/fixes/cont/booth-plan.json` (both outside the repo)

## Context

The owner-quarter sim's analytics walk on Tuzlu Rüzgar (2026-10-03, read-only) found A-050 and filed it as fork AW24. The street-fair booth's two checks ($4,201.10 on Aug 22 and $3,508.42 on Aug 23, rung up under Kerem, no covers, tip 0) count as Kerem's table service. At 42 days his average check reads $248.16, 27.6% above the staff mean, against a booth-free $192.25, and his tip rate reads 9.82% against 12.87%. Over the true 90 days he tops revenue ($134,007 against Priya's $127,689; $126,298 without the booth). Today the 1,000-check sample hides it; lane cap (ADR 0292) reads the whole window and turns it on.

The root cause is that no check says how it was rung up. Every cite is at `e2cbe426a`:

- `CanonicalCheck` (`apps/api-gateway/src/pos-hub/pos-types.ts:24-45`) has no channel, and neither has `pos_checks` (`supabase/migrations/20260805000000_baseline_from_production.sql:4192-4209`; `source` is the provider key, not the channel).
- Clover folds its order type into the table slot: `tableRef: o.orderType?.label ?? null` (`pos-adapters.ts:155`). An order type is a name the house makes up ("Dine In", "To Go"), not a table.
- `/analytics/waiters` credits every check with a server name to that server (`apps/api-gateway/src/analytics/table-analytics.service.ts:418-444`), and the same check feeds the table-adjusted fit when it has a table.
- The insight loop accumulates the table and the server for every check (`apps/api-gateway/src/analytics/insights/insight-generator.service.ts:1111-1155`), the peer block ranks on it (`:1283-1322`), and the hot-table filters take every check (`:1350-1395`).
- The sim posts `TR-2026-08-22-BOOTH` and `TR-2026-08-23-BOOTH` as Kerem with `tableRef: 'BOOTH'`, and `TR-2026-09-17-EVENT` ($5,283.47, 60 covers) as Owen, who is not one of the five servers. None carries a channel (`p4-scratch/sim-run/rebuild/run/gen.py:188-194`).

## The question and the options

The question as the lane brief framed it (the AskUserQuestion question text itself is not recorded in any file this lane can read; the picks and option texts below are verbatim): *"(a) do booth, event and off-premise checks count for staff as excluded, revenue only, or their own row; (b) does the channel come from a POS adapter field or from the house tagging it?"*

1. **"Own row, POS field (Recommended)" — chosen.** Option text, verbatim: *"Booth/event checks show as their own row ('Booth & events') in staff and table figures and still count in takings. The channel is read from the POS order type where the adapter has one (Clover orderType), else the check counts as table service."*
2. **"Revenue only" — rejected.** Option text, verbatim: *"They count in takings, but no staff or table figure includes them."*
3. **"House tags them" — rejected.** Option text, verbatim: *"The owner tags a check or a day as booth/event on the page. The POS field is ignored."*

### Fork AW24-b: which POS order types are booth or event

Asked 2026-10-04 ~20:50Z, after the plan found that no POS has a booth or event type of its own. The question, verbatim from the plan: *"A POS order type is a name the house makes up: Clover orderType labels ('Dine In', 'To Go', 'Street Fair'), Toast dining options and Square fulfilment types. None of the three POS has a booth or event type of its own; Clover's system types are DINE-IN, TAKE-OUT and DELIVERY. Which POS order types should count as booth/event?"*

- (a) *"Every order type that is not dine-in. Cost: one adapter line and no UI. But take-out and delivery checks would then sit under 'Booth & events', so the row would need renaming to something like 'Off the floor'. That is a second product call."*
- (b) *"Only the house's own custom types, meaning those linked to no Clover system type. Cost: one adapter line and no UI. It is a guess: a custom 'Patio' or 'Bar' type would land in Booth & events."*
- (c) *"The owner marks each POS order type once in Settings. Cost: a mapping table, an endpoint and a Settings control (about 8 files, its own PR and ADR), and it needs a connected Clover, Toast or Square house to test against."*
- (d) *"Not until a Clover, Toast or Square house connects. Their checks stay table service, and the order type stays in raw, so (c) can map it later. Cost: none now. No such house exists (Clover's registry status is 'scaffolded'), and Tuzlu's canonical feed is unaffected."*

The founder picked *"Wait, then owner maps (Recommended)"*: (d) now, then (c) in its own PR once a Clover, Toast or Square house connects. No OPEN-DECISIONS row is filed, because the fork is answered.

## Decision

A check names its channel, and a booth or event check is its own row in staff and table figures while it still counts in takings. The method, proposed for review:

1. **The column.** `pos_checks.channel` is `text`, null, bounded by the CHECK `pos_checks_channel_known` to `'table'` and `'booth_event'`. Null means the POS named no channel, which is table service. The CHECK is added validated, in one step. The Supabase CLI runs the file as one transaction, so the `ADD COLUMN`'s ACCESS EXCLUSIVE lock is held until commit, and the CHECK's one pass over `pos_checks` runs under it, blocking reads and writes for that pass. Adding it `NOT VALID` and validating it in the same file would scan under the same held lock, so it is not done (measured on local Postgres 17, 2026-10-04, in one rolled-back transaction: `pg_locks` showed AccessExclusiveLock beside ShareUpdateExclusiveLock after `VALIDATE`). Every value is the new column's null, so the pass cannot fail; its length against production's row count is not measured (no production reads from this lane). [Corrected 2026-10-04 after the round-1 review: this item first said the `NOT VALID` / `VALIDATE` pair kept the lock catalogue-only and ran the scan under a lock that blocks nothing. That is false inside one transaction. The body of commit 27bae89a2 says the same, and history is not rewritten.] No backfill (nothing has ever sent a channel) and no index (readers fold it in memory).
2. **An exact vocabulary.** `CanonicalCheck.channel` is `'table' | 'booth_event' | null`. `checkChannelOf` trims and lower-cases a string, then requires an exact member; anything else is null. Nothing is guessed from `tableRef` ("BOOTH") or from an order-type label.
3. **Said, not swallowed.** The import result carries a `channels` tally (`booth_event`, `table`, `none`, `unrecognised`). A check that names a channel outside the vocabulary is stored as table service, counted as `unrecognised`, and named in one `errors[]` line (the first five names, then "and N more"), the ADR 0281 pattern, so absence is never reported as health.
4. **An order type is not a table.** Clover's adapter writes `tableRef: null` and `channel: null` under fork pick (d); the order type stays in `raw` for the later mapping. Clover's registry capabilities become `CAP_NO_TABLES`. Square and Toast are unchanged: neither ever mapped an order type to a table.
   - *Source.* Clover's order object has no table field. Its field list (`docs.clover.com/dev/reference/ordercreateorder`, read 2026-10-04) has `orderType` and the string fields `title` and `note`, and the docs call none of them a table. Their null-fields example (`docs.clover.com/dev/docs/displaying-null-fields`) shows `"title": "5"`, which some houses may use for a table number. Reading `title` as a table would be a guess, as the order type was, so it is left to the owner's mapping PR. [Sourced 2026-10-04 after the round-1 review: this item, the adapter comment and the body of commit 27bae89a2 first said *"Orders v3 carries no table"* with no cite.]
   - *Beyond the pick.* Pick (d)'s option text says only that Clover checks stay table service and the order type stays in raw, at *"Cost: none now"*. Taking the order type out of `tableRef` and the registry change go further. They are method, proposed for review: no Clover house exists (registry status 'scaffolded'), so no figure moves today, and undoing them is two lines (`tableRef`, `capabilities`).
5. **Written only when named.** The ingest row carries `channel` only when the check names one. A gateway deployed before the column exists never names it, and a re-send that names nothing leaves a stored channel alone (skew-safe).
6. **Readers (PR-2).** A `booth_event` check leaves the per-table, per-server, peer, table-adjusted fit, correlation, driver and hot-table figures. Those checks form one "Booth & events" row in /reports' "The room" and "Who served it" registers and in both exports, computed with the same per-check money basis as the server rows. They stay in takings, the revenue series, the basket and `feedStatus`. A payload without the row renders exactly as before.
7. **Order of merge.** PR-2 selects `channel`, so it merges only after PR-1's column is verified live in production; otherwise every analytics read fails with 42703.
8. **Lane tables.** Lane tables (learned tables from the POS) must not learn a table from a `booth_event` check. If it lands first, PR-2's per-table exclusion skips a learned "BOOTH" table's booth checks anyway.

What carried it: the founder's ruling settles *that* booth checks are their own row and *that* the POS names them. The method keeps the vocabulary closed, so the CHECK, the reader and the row all agree on two values, and it moves every guess (a table called BOOTH, an order type called "Street Fair") to the owner's later mapping.

## Rejected alternatives (method)

- **Match `tableRef` 'BOOTH' or 'EVENT'.** A guess from a name the house chose; it would credit a real table someone named "Event" and miss a booth rung on table 7.
- **Read the channel from `raw` jsonb on every read.** No vocabulary, no CHECK, and a per-row jsonb parse in the hottest readers.
- **A flagged row inside `waiters[]` or `tables[]`.** It breaks every ranker that reads those arrays (the significance gates, the recommendation registers, scenario-verify). The row is a separate key, `boothAndEvents`.
- **A side table `pos_check_channels`.** A join on every read for no gain over one nullable column.
- **A backfill.** No feed has ever sent a channel, so it would match nothing anyone can show exists. Not checked against production (no production reads from this lane).
- **Unknown values refused by the gateway.** It would drop a real sale from takings because of a label; storing it as table service and saying so keeps the money and the warning.

## Consequences

- **Not changed by this alone.** Tuzlu's figures change only after the sim's generator (`gen.py`) emits `channel: 'booth_event'` on its BOOTH and EVENT checks and the coordinator re-posts 2026-08-22, 2026-08-23 and 2026-09-17. The upsert updates `channel` in place and a re-post is stock-idempotent. Until then Kerem keeps $7,709.52 of booth takings and Owen keeps a $5,283.47 server row. That work is outside this lane (production writes).
- **Unasked, and filed.** Take-out and delivery checks are also credited to a server as table service. The ruling covers booth and event checks only; this ADR does not touch them. The fork is filed in `OPEN-DECISIONS.md` (the section appended from `feat/a-check-carries-its-channel`, OD-TBD, its number assigned at merge) and is not decided here.
- **Later.** The owner's order-type mapping (fork pick (c), after (d)) is its own PR and ADR once a Clover, Toast or Square house connects.
- **Harder.** Every new analytics reader of `pos_checks` that attributes a check to a server or a table must skip `booth_event` checks. Today's other readers (ask-readings, scenario-verify, the sale-record producer, goals, calendar, logs, dev-truth, beverages) attribute no check to a server or table, so they need no change.
- **Revisit when** the first Clover, Toast or Square house connects, or when the founder asks about take-out and delivery.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-04 | Aldemir | Ruled: *"Own row, POS field (Recommended)"* |
| 2026-10-04 | Aldemir | Fork AW24-b: *"Wait, then owner maps (Recommended)"* |
| 2026-10-04 | Claude (lane booth, PR-1) | Built method 1-5: the column, the vocabulary, the import tally, Clover's order type out of the table slot, the skew-safe write. Gateway specs fail before and pass after; SQL test on local Postgres passes on the fix build and fails on the control |
| 2026-10-04 | Claude (lane booth, PR-1 round-1 fixes) | Method 1 corrected: the CHECK is added in one step, since `NOT VALID` / `VALIDATE` in one transaction scans under the held ACCESS EXCLUSIVE lock (measured). Method 4 sourced against Clover's docs and marked as going beyond pick (d). Take-out and delivery filed as an open fork |
