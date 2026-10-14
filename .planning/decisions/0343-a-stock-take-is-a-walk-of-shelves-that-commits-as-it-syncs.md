# 0343 — A stock-take is a walk of shelves that commits as it syncs

- **Status:** Locked 2026-10-12 (founder) on four picks. **F1 (b), F2 (a), F3 (a) and F4 (a) are his picks**, made by AskUserQuestion on 2026-10-12 and recorded in `p4-scratch/sim-ledger.md` S224; they are **not** the coordinator's call. The shape under them (commit-on-sync rather than approve-then-post) is the coordinator's draft that his F2 option described and he picked. The rest of §Decision is the coordinator's call under the founder's 2026-10-07 delegation (industry-standard, no fork) or a lane's as-built choice, each with its basis and the alternative rejected.
  - **Amends by bracket only** [[0334-a-month-is-closed-by-keeping-its-snapshot]] Decision 3 (F1 b: a stock-take count is filed in its session's month).
  - **Keeps, unchanged:** [[0078-a-count-is-a-record-in-its-own-right]] (one count writer; it gains parameters, never a twin), [[0070-a-quantity-states-its-own-unit]] (integer ml), [[0143-the-arrival-the-desk-the-sommelier-and-the-two-rooms]] (a typed count posts at once; F2 a keeps it), [[0241-an-offline-change-belongs-to-its-person-and-house-and-is-never-dropped-for-failing]], [[0296-a-sale-belongs-to-the-houses-day]] (the counted moment and its day are never moved), [[0238-zone-setup-is-owners-managers-and-the-people-they-assign]], [[0286-a-sent-time-is-the-facts-time-for-72-hours-older-needs-a-manager]] (now applied to stock-take lines), [[0335-a-house-brings-its-vendors-and-opening-stock-in-from-a-spreadsheet]] (its map/preview/confirm reused).
  - **Lane 7 (the phone app) is deferred** until OD-109's first run. It is not built.
- **Date:** 2026-10-12
- **Decider:** Aldemir (founder) for F1–F4 — decisions are locked by the founder, never by an agent
- **Keywords:** stock-take, closing count, month-end count, count session, stock_count_sessions, stock_count_session_shelves, stock_count_parked_lines, stock_count_held_lines, shelf walk, blind count, shelf done, open bottle, tenths, open_ml, p_counted_open_ml, p_session_id, p_resolves_held_line, attributed_period, last_counted_at, count sheet, /count, F-076, F-1544, F-1542, F-1165, F-249, F-880, F-291, F-945
- **Links:** the draft and its lane brackets `p4-scratch/sim-run/arch/decision-phone-stock-count.md` (outside the repo); the founder's answers `p4-scratch/sim-ledger.md` S224; findings F-076 (`sim-ledger.md:100`), F-1542 (`:2831`), F-1544 (`:2833`); migrations (cited by slug, ADR 0235) `a_count_session_groups_a_walk_of_shelves`, `a_count_names_its_open_bottles`, `a_whole_walk_stamps_last_counted`, `a_count_files_in_its_sessions_period`; claims `claims.d/feat-count-session-envelope.jsonl`, `feat-count-open-bottles.jsonl`, `feat-count-walk-web.jsonl`, `feat-count-review.jsonl`, `feat-count-month-period.jsonl`, `feat-count-sheet-import.jsonl`, `docs-adr-phone-stock-count.jsonl`; debt `tech-debt.d/2026-10-14-docs-adr-phone-stock-count.md`; ADR 0115 (Proposed, PR #589, "carry this"); OD-109 (the phone app has never run)

## Context

A full stock-take was one Spot-count dialog per item on a 1330px web canvas; a 112-wine cellar was 112 dialogs (F-076). The phone app had no count tab, "Export count sheet" had no import, and nothing counted an open bottle: `inventory_lots.open_bottle_ml` was written only by pours and sales.

Four facts in the code shaped the answer (draft basis `wt-sim51` @ `3a91de4a8`, re-read by each lane):

- **One count writer.** `record_stock_count` writes a `stock_counts` row every time, agreeing or not (ADR 0078, guarded by `scripts/check_a_count_is_recorded.py`).
- **Expected is the lot sum when the writer runs**, whatever `p_counted_at` says. So a count posted hours after it was taken is compared with stock that has since moved.
- **A queued count overtaken by stock is refused, never re-based** (`refuseCountOvertakenByStock` in `inventory.service.ts`; F-249, F-880), past a 2-minute grace.
- **The house day ends at midnight** (ADR 0296). A 01:30 closing count belongs to the next day, and month close summed every non-opening count by `counted_at`.

## Options considered

1. **A thin phone port**: a list that posts the existing per-item route shelf by shelf. No coverage (a half count looks finished), no open bottles, no unknown items, no review. Rejected: it does not close F-076.
2. **A draft session a manager approves, then the server posts every line** (all three research passes led with this). Rejected by the adversary pass: because expected is read when the writer runs, a 01:30 count of 12 posted at 11:00, after brunch sold 2, books +2 and brings the sold bottles back. Wiring in the F-249 refusal instead refuses nearly every moved item on a morning review. Back-dating `p_counted_at` presents an as-of as the counted moment (F-777), and a manager posting loses `counted_by`. It would need a ledger replay, a second meaning for the one writer.
3. **Commit-on-sync session.** The session groups a walk and records its coverage; it is never a draft layer. Each line posts as its counter, when it reaches the server, through the existing route and writer. **Chosen** (F2 a).
4. **A sheet round trip only.** Rejected as the design; kept as a second source of lines (lane 6).
5. **Freeze and re-base, or lock stock during the count.** Rejected: a re-based figure is not what anyone counted (F-249), ADR 0334 refused locks, and the till sells during a closing count.
6. **A separate open-bottle writer.** Rejected: a second writer next to ADR 0078's, whose counts never land in `stock_counts`, so open-bottle variance could not be audited.
7. **Month close reads only the month-end session.** Rejected: it drops every mid-month spot variance, which is real loss already moved in stock. Only the *filing month* of an after-midnight count was open (F1).
8. *Doing nothing:* stock-takes stay 112 dialogs on a desktop, and month close has no closing count.

## Founder answers

AskUserQuestion, 2026-10-12, recorded in `sim-ledger.md` S224. The ledger records his picks in the coordinator's words, not the option labels verbatim, so they are given here as the ledger has them. Each was the recommended option.

- **F1 (b):** a session states its period, and month close files its counts by that period, **only for counts made within 6 h after the period ends**; the counted moment stays honest.
- **F2 (a):** no approval. Each line posts when it syncs, as the person who counted it; the manager signs off for completeness; only a duplicate on the same shelf is held.
- **F3 (a):** open bottles are counted now. Staff enter tenths of a bottle; they are stored as integer ml through the one count writer.
- **F4 (a):** a phone-width web page first, then the phone app. The phone app (lane 7) waits for OD-109's first run.

## Decision

**A stock-take is a count session over a house's leaf shelves. Every line commits through `record_stock_count`, as its counter, when it reaches the server. The session adds coverage, review and sign-off, and never holds stock back. Only a second count of the same shelf in the same session is held for a manager.**

As built in lanes 1–6 (stacked, local, not pushed). Where a lane corrected the draft, the basis and the rejected alternative are given.

1. **The session** (lane 1, migration `a_count_session_groups_a_walk_of_shelves`). `stock_count_sessions` (kind `closing | month_end | full | opening`, `opened_by`, status `open → signed_off | abandoned`), `stock_count_session_shelves` (claim, done, done by) and `stock_count_parked_lines`. Each table has RLS on, a service-role-only policy and anon/authenticated revoked; the house comes from the token. `stock_counts.session_id` is nullable, keyed `(session_id, restaurant_id)` so a count can never name another house's session; a spot count leaves it NULL. An owner or a manager opens a session. An `opening` session takes lines only from an owner or a manager and posts them as the opening count.
   - **The scope is the house's leaf shelves**, by `leafShelvesInScope` in `count-sessions.service.ts`: a place that holds other places is never a shelf (F-945, F-1542). [Corrected 2026-10-14: the draft named the web's `shelvesFor`; the session is opened by the gateway, which carries the same leaf rule as its own function. Rejected: importing a web component's helper into the gateway.]
2. **The walk is blind** (lane 3). The phone pulls the shelves in walk order and the items expected on each, never the expected quantities, differences or money.
3. **A line commits on sync** (lanes 2 and 3). One counter, one item on one leaf shelf: sealed bottles, and for a pourable item, open bottles. It rides the spot-count queue (ADR 0241) to the existing per-item count route with the shelf, its age (`countedAgoMs`), `clientCountId` as its key and `sessionId`. The person comes from the token (ADR 0078). The F-249/F-880 refusal still guards a stale line; it comes back as "count this shelf again". Nothing is posted later against a later expected figure, so no replay is needed. A replayed line posts nothing twice.
4. **"Shelf done" is said, never assumed** (lanes 1 and 3). It lists the expected items not counted on that shelf, asks for confirmation, then posts a zero for each through the same route, as the person who said it, with no open bottle either. A shelf never marked done reads **not counted** in review. Absence is never read as zero. An item counted whole (F-945) is not counted in the walk and never zeroed by a shelf done.
5. **A second count of the same shelf is held** (F2 a; lane 2). Inside `record_stock_count`, under the item's lock: when the session already has a count of that item on that shelf, the line goes to the service-role-only `stock_count_held_lines` and the writer answers `held: true` with no stock change. A spot count is never held. [Lane 2: rejected a gateway pre-check (two phones race past it) and a held `stock_counts` row (month close would sum it).]
6. **Open bottles go through the one writer** (F3 a; lane 2, migration `a_count_names_its_open_bottles`). `record_stock_count` gains `p_counted_open_ml` and `p_session_id`; `stock_counts` gains `expected_open_ml` and `counted_open_ml`. Tenths become ml in the gateway (`openTenthsToMl`, from the item's `bottle_size_ml`, else 750 ml, ADR 0297), so the writer only ever sees integer ml (ADR 0070). Open ml reconciles against the open lots on the counted shelf only. A surplus with no open lot there lands on a new uncosted lot (rejected: inventing a cost for ml nobody bought). An open-ml count overtaken by a pour is refused (409) in the gateway, because a pour that opens no bottle writes no stock movement and the overtaken check would miss it.
7. **Fact time** (lane 2). A stock-take line more than 72 h old needs an owner or a manager (`resolveFactTime`, ADR 0286); staff get 409, never a re-dated count. Applied to stock-take lines only, so a spot count behaves exactly as before. Rejected: gating every count, which would change today's spot count without a decision.
8. **Unknown bottles are parked** (lanes 1 and 4): free text, shelf, counter. In review the manager matches a parked line to an item the house already carries, which posts it through the same route as its counter at its moment, or drops it. [Corrected by lane 4: the draft's "carry this" through ADR 0115 is narrowed to matching, because ADR 0115 is still Proposed and no item-creation action exists. Rejected: creating an item from the review.]
9. **A bottle on the wrong shelf is named, not moved** (lane 4). The review says "probably moved, not lost" and posts nothing. [Corrected: under F2 (a) both shelf counts already posted, so a transfer on top would move the bottles twice. Rejected: a transfer, and reversing both counts to post one transfer (rewriting two posted counts).]
10. **Review and sign-off** (lane 4, migration `a_whole_walk_stamps_last_counted`, `/count/:sessionId/review`). Per shelf: not counted, no count sent, held lines, parked lines, lines that arrived after sign-off (`stock_counts.arrived_at`). The books, the difference and its value go **only to an owner or a manager**; anyone else sees what was counted. Sign-off states the count complete; it does not gate posting. A held line is posted by naming it (`p_resolves_held_line`, still the one writer) or set aside. A recount is a round (`recount_round`): the ask clears done and claim, and a done from before the ask closes nothing. On sign-off an item gets `last_counted_at` only when every live lot of it sits on a done shelf this walk counted (F-1165). [Lane 4: the stamp lives in sign-off, not the writer, so a shelf count never reads as a whole count. Refused lines are not kept on the server, because a refusal posts nothing.]
11. **Month close files a stock-take count by its session's month** (F1 b; lane 5, migration `a_count_files_in_its_sessions_period`). `stock_count_sessions.attributed_period` is a `YYYY-MM` month, set when the count opens and never changed, none on an opening count. A session that names none is this month on the house's clock; the page offers the month just ended only in the 6 h after it ends. Month close (`count-period.ts`, `month-close.service.ts`) files a session's count in that month when it was made within 6 h after the month ended; `counted_at` is never moved. Month close still sums **every** non-opening count's variance, and now its open ml too. A late session line made after a close is listed as changed after close. [Lane 5: filing is derived in the close, not stamped by the writer. Rejected: a `filed_month` column, which would redefine the one writer for a value the close can derive. No back-fill: sessions opened before the migration file by `counted_at`.]
12. **A count on paper** (lane 6, `/count/:sessionId/review`, "Count on paper"). The session's own blind sheet (CSV): shelf, item, then blank full bottles, open tenths and a counted-at time per shelf. Only an owner or a manager loads it, through ADR 0335's map → preview → confirm. A line posts as the person who loads it (ADR 0078); a blank is not counted; keys come from what the sheet says, so loading the same sheet twice posts nothing twice. [Lane 6: the inventory page's "Export count sheet" is left as it is, because it prints the books' figure.]
13. **The surface** (F4 a; lane 3). Phone-width web pages `/count`, `/count/:sessionId` and `/count/:sessionId/review`, outside the shell like the door, with no flag (a new page with no legacy and no money on the walk). Find is by search; scan is not built, because no item carries a barcode yet.

## Consequences

- **Easier.** A bar or cellar is one walk per shelf on a phone; two people split shelves; a dead cellar signal loses nothing; month close gets real per-shelf closing counts and their open bottles; paper counts land in the same place.
- **Given up.** A count cannot be approved before it moves stock (F2 a). A closing count must reach the server before the item next moves, or that shelf is counted again. That is the honest cost of refusing to re-base.
- **Harder.** `record_stock_count` now takes open ml, a session, and a held line to post; every caller and its guard must be re-read when it changes. Open ml on another shelf's lot (ADR 0285 pours from any lot) is not reconciled per item.
- **Revisit when** refused "count this shelf again" lines pass ~10% of a closing session's lines in a house's first month (the commit-on-sync bet is wrong for that house; the 10% is unmeasured); or a house asks for scale weighing; or ADR 0115 changes "carry this".
- **Owed** (`tech-debt.d/2026-10-14-docs-adr-phone-stock-count.md`): ~~a nav entry to `/count`, zone choice,~~ [BUILT 2026-10-14, owed-count-ux `6c762112c` (sim ledger S232): "Stock count" is a cellar room in the shell (`apps/web/src/lib/mudavym/rooms.ts`), and `/count` offers the house's places as `zoneIds` (`apps/web/src/pages/count/CountIndex.tsx`).] Turkish words on the count pages, open-ml changes in "changed after close", lane 7, and this ADR's README row in its own PR.

## Not verified (said plainly)

- Lanes 1–6 are committed locally, stacked to `59302df4c`; none is pushed, merged or run in production. F-076 and F-1544 close only when they merge.
- The picks are recorded from the ledger's summary (S224). The option labels he was shown are not in the ledger verbatim.
- The 6 h window and the ~10% revisit signal are coordinator estimates, not measured.
- Industry practice (R365, Fourth, xtraCHEF, WISK, BevSpot: count by area, offline then sync, tenths) was cited from vendor help pages in one research pass and from memory in two; not re-fetched here.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-12 | coordinator (3 research passes + 1 adversary) | Drafted; the research design was rejected, the adversary's commit-on-sync adopted |
| 2026-10-12 | founder | F1 (b), F2 (a), F3 (a), F4 (a), sim-ledger S224 |
| 2026-10-13 | lanes 1–6 | Built on his picks; corrections bracketed in the draft and carried into §Decision |
| 2026-10-14 | ADR lane (`docs/adr-phone-stock-count`) | Numbered 0343 by the guard (0342 taken by an uncommitted draft); ADR 0334 D3 bracket; leaf-scope correction; CLAIMS rows the lanes did not add |
