# 0347 — The floor builder draws and adds tables, and the till still teaches them

- **Status:** Proposed (2026-10-31)
- **Parts:** 1 of 3. The other parts land in later PRs of this series; until the last one merges, Consequences and the Review trail below are stubs.
- **Amends:** [ADR 0303](0303-tables-learned-from-the-pos.md), which is itself still `Proposed` (`0303:3`). A lock is his. If he locks 0303, he locks it as amended here, or he rejects this amendment.
- **Date:** 2026-10-31 (rulings of 2026-10-30 EDT and 2026-10-31, session ca58311b)
- **Decider:** the founder, in AskUserQuestion. His 2026-10-30 EDT picks, quoted in *Context*, decide D1 and D2: his typed builder answer, *"Optional seats (Recommended)"*, *"Both, one shared form (Recommended)"* and *"Builder starts from the till"*. His 2026-10-31 answers to F1 and F3 decide what D2 says of residuals 5 and 17. Which 0303 sentences change and which stand is the executor's reading of those picks, and so is reading his builder answer as setting aside 0303's *"No drawing."* (D1). D3 to D6 and D8 are the executor's design and mapping. The picks they build are his: seats in D4, the till start in D5, and his F3 and F4 answers in D3 and D8. D7 moved to ADR 0353. D9's mechanics are the executor's design. D10 to D12 build his F1, F2 and F5 picks with the executor's mechanics. D10's rule that a kept table may be hidden while a twin points at it, D11's Put back and D12's straight line are the executor's call under the founder's 2026-10-31T16:57:09Z delegation (OD-242 (OPEN-DECISIONS.md:329 on main)), not his pick.
- **Keywords:** floor builder, Floor Checker, restaurant_tables, Add a table, shared form, twin table, twin guard, pos_table_for_ref, till_words, former_labels, tray, till-taught, learned_at, x_pos, y_pos, plan units, scale, shape, seats NULL, dash, no guessed 2, upsertTable, POST /analytics/tables, create-only, hide not delete, residual 4, residual 5, residual 12, residual 17, addtable, seatsnote, fold, folded_into, twin rule on rename, Not a table, pos_not_table_words, plan scale, plan marks, derived distance
- **Links:**
  - His answers are cited by the UTC time each question was asked (session ca58311b's transcript, outside the repo).
  - [ADR 0303](0303-tables-learned-from-the-pos.md) (Proposed): amended. See *D1* for each sentence that changes and *D2* for each that stands.
  - [ADR 0345](0345-floor-checker-is-ported-into-mudavym.md) (Proposed): the port (`/floor`, `/floor/builder`, `/floor/me`, `floor_sections`, seatings, merges). This record cites its § Context › The founder's rulings › Round 2, § Context › His fourteen picks › pick 9, and § Options considered.
  - [ADR 0353](0353-a-closed-till-check-marks-paid-only-a-person-ends-a-seating.md) (Proposed): the Paid rule, which was this record's D7.
  - Research: the feature run wf_3808bfdb-c92 (ADR 0345 § Options considered › The research behind the choice) ranked the Paid tap and *the builder starts from what the till already knows*. What this record takes from it is stated inline: a scale step so plan units are never stored as metres (D6, D12).
  - [ADR 0346](0346-waiter-scores-and-rankings-ship-to-managers.md): who sees per-waiter figures.
  - [ADR 0020](0020-no-fabricated-answers.md) and [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) (both Locked): an unset seat count is shown as unknown, never filled in.
  - [ADR 0302](0302-booth-and-event-checks-keep-their-own-row.md): booth and event checks.
  - [ADR 0164](0164-sessions-follow-membership-and-several-houses-choose.md): RolesGuard is exact.
  - [ADR 0093](0093-a-scenario-is-replayed-and-verified-against-its-own-expectation.md): the scenario runner, the one in-repo caller of `POST /analytics/tables`.
  - [ADR 0348](0348-staff-are-refused-the-table-and-server-takings-and-the-rest-is-withheld-after-617.md) (PR #701, merged): the create route's owner/manager roles.

Repo citations are at `origin/main` `5e966c8b6`: measured at `037452ebe` on 2026-10-31; of the files cited only `analytics.controller.ts` changed since, re-measured 2026-11-01.

## Context

ADR 0303 made a table something the till teaches. A check's word with a digit in it learns a `restaurant_tables` row with `seats` and `is_outdoor` NULL (`supabase/migrations/20261222230000_tables_learned_from_the_pos.sql:303-310`). An owner or manager renames or hides it (`apps/api-gateway/src/analytics/analytics.controller.ts:676-678`). Its ruling's option text ended *"No drawing."* (`0303:3`), and it rejected option 2, "Draw the room", with those words (`0303:24`). On 2026-10-05 the founder made Add a table a follow-up lane in Settings → Point of sale (`0303:65`). He also rejected the 0303 option *"Add a seats field"* (`0303:67`). Floor Checker (ADR 0345) brings a builder that draws tables, adds them with a seat count, shapes them, groups them into sections and deletes them. That collides with each of those sentences.

**The founder's words, 2026-10-30 EDT** (verbatim; a picked label is his pick, an option text is what he was shown):

- The task, his session-opening message, is quoted whole in ADR 0345 § Context.
- Asked what the builder may do under ADR 0303's "No drawing" (asked 2026-10-31T03:03:50Z, Q2; offered "Position + hand-add guarded (Recommended)", "Position only" and "Full checker builder"), he typed in place of an option: *"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*. D1 and D6 call this *his builder answer*.
- Sections: *"Separate floor sections (Recommended)"* (asked 03:03:50Z, Q4). Old checker data: *"Start fresh (Recommended)"* (asked 02:52:37Z, Q3). What a waiter's phone shows: *"Nothing for now"* (asked 03:03:50Z, Q3).
- Seats: *"Optional seats (Recommended)"* (asked 03:46:17Z, Q2). Its option text: "The builder can set seats; a table without them shows a dash, never a guessed 2 (fixes the old POST that writes seats=2). Amends 0303."
- Where Add a table lives: *"Both, one shared form (Recommended)"* (asked 03:46:17Z, Q3). Its option text: "The builder and Settings → Point of sale use the same add-table form and the same twin-table guard."
- A closed till check: *"Auto-Paid, never auto-leave (Recommended)"* (asked 03:46:17Z, Q4), now ADR 0353's. Its option text: "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored."
- His multi-select of new features included *"Paid tap"* (asked 03:41:53Z, Q1; ADR 0353's now) and *"Builder starts from the till"* (asked 03:41:53Z, Q3), whose option text read: "Tables the till already taught wait in a tray to be named, placed and sectioned. 'Bar' or 'Window' can become a table once, with old checks linked. Placing the kitchen and bar fills the room-distance analytics. Amends ADR 0303." D12 records how its distance sentence is met.

**This record's forks.** On 2026-10-31 he answered F1 to F5 in AskUserQuestion (asked 06:00:41Z, Q4; 16:54:31Z, Q4; 16:55:36Z, Q1 to Q3), before his 2026-10-31T16:57:09Z delegation, so each answer is his pick, quoted where it is decided: F1 in D10, F2 in D11, F3 in D3, F4 in D8, F5 in D12. F6, a void after Paid, moved with the Paid rule to ADR 0353 § Decision › Voids.

## Decision

**The floor builder places, shapes, sections, adds and hides the same `restaurant_tables` rows the till teaches. One owner/manager route creates a table for both the builder and Settings → Point of sale, behind one twin-table guard. A seat count is asked for and never guessed.**

The Paid rule that this record first held, that a closed, unvoided, live till check marks its table's open seating Paid, which a person can undo, and that only a person ends a seating, is ADR 0353 § Decision.

### D1. What in ADR 0303 is amended

- **`0303:3`, the last sentence of the 2026-10-04 option text, *"No drawing."*, and `0303:24`, option 2's rejection *"Rejected by the ruling: "No drawing.""*.**
  - Superseded, on the executor's reading, by his builder answer of 2026-10-30 (*Context*). Tables are drawn in the builder (D6).
  - The rest of `0303:3` stands, as narrowed on 2026-10-05: a till word with a digit in it becomes a table (within `0303:47`'s limits), the owner renames or hides it, and past checks re-link.
- **`0303:62`, the bullet headed *"Nothing is drawn."*, and its sentence *"No copy claims a screen that adds a table (residual 12)."*.**
  - Amended once the shared form ships (D3). From then on, copy may say a table can be added under Settings → Point of sale or in the builder, and the register and export copy quoted there gains that clause (D9). Until it ships, the sentence binds as written.
  - `:62`'s rules for hidden tables stand: a check that sat only at hidden tables drops the absent-attribution clause, and the all-hidden sentence, *"Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale."*, still applies.
- **`0303:21`, *"No screen adds one yet (residual 12)"*, and `0303:104`, residual 12.** Closed by D3 when built.
- **`0303:65`, the Add-a-table pick.** It stands and is extended. Its option text, *"A small separate PR adds 'Add a table' to Settings → Point of sale, for owners and managers. Waiting checks with that word link to it automatically."*, still holds. Under *"Both, one shared form (Recommended)"*, the same form also opens from the builder.
- **`0303:67`, *"So a learned table keeps `seats` NULL and no screen asks for it"*, and his rejection there of *"Add a seats field"*.**
  - Amended by *"Optional seats (Recommended)"*: the shared form and the builder ask for seats, and leaving them empty is allowed. A learned table still starts with `seats` NULL; that half stands.
  - A chart of per-seat figures can still be empty when no table states its seats (`apps/web/src/pages/reports/next/rp-registers-house.tsx:433`). The sentence that says why is still owed to the `seatsnote` lane.
- **`0303:96`, residual 4, and three clauses inside residual 12's text at `0303:104`: "no role guard beyond the class JwtAuthGuard", "it upserts on the label" and "it writes `seats` 2 and `is_outdoor` false when none is given".** The role clause is closed on main: PR #701 (ADR 0348) put owner/manager roles on the route (`analytics.controller.ts:596-597`). The upsert, `seats` 2 and `is_outdoor` false close by D3 and D4 when built.

### D2. What in ADR 0303 stands, unchanged

- **`0303:36`, option 6 (no default of 2).** It stands, and it now binds hand-added tables too (D4).
- **`0303:37`, option 7 (no delete).** It stands. The builder's Delete becomes Hide (D6).
- **The learning, `0303:45-58`.** All of it holds unchanged: `table_ref`; the trigger and its order of rules; the digit rule `~ '[0123456789]'` and the 60-character cap (`20261222230000_tables_learned_from_the_pos.sql:303-304`); every spelling kept in `till_words`/`former_labels` (`:142-143`, `:348-410`); the belt, by which an update that leaves a check's word unchanged keeps its table (`:279-286`); re-link fills NULL links only (`:418-470`); the backfill.
  - The builder writes the same rows through the same routes, so a rename made from the tray fires `restaurant_tables_keep_till_names` (`:406-410`) and `relink_on_change` (`:458-462`). A hand add fires `relink_on_add` (`:451-455`).
- **`0303:59`, rename and hide through `PATCH`, owner or manager, with the 409 on a name clash.** It stands. D6 adds fields to the same route (an executor proposal).
- **`0303:60`, 0303's fork F2, *"Out of every figure (Recommended)"*.** It stands, and it is extended to the floor's per-table figures (D8). A hidden table still catches its checks, and they stay in takings.
- **`0303:61`, *"Keep them in the control (Recommended)"*.** It stands.
- **`0303:63`, the room reads only what was recorded.** It stands, and it binds any distance the builder derives (D12).
- **`0303:66`, the digit rule applies to Square tab names.** It stands.
- **`0303:91`, a table whose name has no digit is added once by hand.** It stands. That is now possible in both places, and the tray lists the words waiting for one (D5).
- **Residuals 15 (`0303:107`) and 16 (`0303:108`) stand.**
- **Residual 17 (`0303:109`)** closes for adds by D3's guard, and for renames by his F3 pick (D3).
- **Residual 5 (`0303:97`), "Two till words cannot be merged into one table",** closes for new checks by D10's fold, his F1 pick. Past checks stay where they were.

### D3. One create route, one twin-table guard (executor's design)

- **One route.** `POST /analytics/tables/:restaurantId` becomes the only way to create a table by hand. Both screens call it through one form component.
- **Who may call it.** Owner or manager, which is 0303's F1 role set and `0303:65`'s "for owners and managers". PR #701 (ADR 0348) put `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")` on this route (`analytics.controller.ts:596-597`), so D3 adds no role guard of its own.
- **It only creates.** It never upserts and never overwrites.
- **What the body may say:** name, required, trimmed, 1 to 60 characters, as PATCH requires (`table-analytics.service.ts:105`); seats, optional, a whole number from 1 to 999; outdoor, optional, true or false; section, position and shape, optional (D6). A value the body leaves out is stored as NULL.
- **No `learned_at`.** The insert carries none, so `relink_on_add` links the waiting checks in the same statement. No matching rule is copied into the gateway. The answer reports how many checks the new table took, or null when that count could not be read.
- **The twin guard.** A name N is refused with 409, on add and on rename, when any table of the house already answers the word N or the word `table N`.
  - A rename leaves the table being renamed out of "any table". "Any table" includes shown, hidden and retired tables.
  - "Answers" means by any of the four ranked rules of `pos_table_for_ref` (`20261222230000_tables_learned_from_the_pos.sql:202-241`), for any source: a `pos_refs` word; its label; `table <label>`; a `till_words` word or a former label, under either label rule.
  - The refusal names the table that answers. Guard and insert run in one transaction under `pg_advisory_xact_lock` on the house (as `20261201000000_a_vendor_has_one_primary_branch.sql:77` does), and the till's learner takes the same lock before it inserts. Two adds of one word, or an add racing the till, so run one after the other: the later gets the 409 naming the table just made. That is what closes residual 17 for adds.
- **The rename half is the founder's F3 pick**, *"Yes, same twin rule (Recommended)"* (AskUserQuestion asked 2026-10-31T16:55:36Z, Q2). Its option text read "Rename uses the same twin check as adding a table, ignoring the table being renamed. Closes the last way to make a twin by hand." Today's PATCH checks stay, with the guard in front of them, so residual 17 closes for renames as well.

### D4. Seats are optional, shown as a dash, never guessed (founder's pick; executor's mechanics)

- A table states its seats only when a person typed them. Unset is NULL everywhere, and every screen shows it as "—".
- A migration drops both column defaults (`ALTER COLUMN seats DROP DEFAULT`, and the same for `is_outdoor`). With D3, no writer then supplies a 2 or a false that nobody gave. This is an executor proposal: the defaults bite only an insert that omits the column, and none in `apps/` does today.
- PATCH gains `seats` (a whole number from 1 to 999, or null to clear it).
- Per-seat figures stay withheld for a table with no seat count (`table-analytics.service.ts:397`; `rp-registers-house.tsx:433`).
- A merged table's seats show "—" when any member's seats are unknown, never a partial sum. The checker sums (`floor-merge.ts:238`, `:387`).
- The meal-run alert leaves out the "N-top" for a table with no seat count. The checker already omits it unless seats are above 0 (`checker/lib/meal-alert.ts:127`, untracked).

### D5. The tray: the builder starts from what the till taught (executor's design of the pick)

- **What is in the tray.** Every shown, active table with `x_pos` or `y_pos` NULL. A table with `learned_at` set is tagged "from the till". Nothing gets the checker's default position of 50,50 (`0001_init.sql:61-62`); Mudavym's columns have no default (`baseline_from_production.sql:5179`): unplaced means NULL, and NULL means the tray. *"Start fresh (Recommended)"* means no checker table is imported, so the tray holds only what the till taught and what a person added.
- **How a table leaves the tray.** It leaves when it is placed or hidden. Naming happens through the same PATCH, so the keep trigger keeps every spelling. Sectioning goes through ADR 0345's `floor_sections` (ADR 0345 § Context › The founder's rulings › Round 2).
  - ADR 0345 has the builder start from the tables the till taught (ADR 0345 § Context › His fourteen picks › pick 9). Here `zone` is only read, as a hint, and the builder never writes it.
  - SimPOS houses learn tables labelled by UUID (`apps/api-gateway/src/simpos/simpos.service.ts:676`; `0303:94`). The tray is where those get a name.
- **Words waiting for a table.** Below the tray sits the house's list of till words no table answers, each with its check count.
  - "Make it a table" opens the shared form with the word filled in. `relink_on_add` then links that word's past checks. This is `0303:91`'s cost, paid in one tap.
- **Who sees it.** The builder and the tray are for owners and managers, as Add a table is.
- **Two more acts on the tray**, both ruled on 2026-10-31: folding a till-taught twin into another table (his F1 pick, D10), and marking a waiting word "Not a table" (his F2 pick, D11).

### D6. The checker's builder features, the Mudavym way (executor's mapping)

Every checker builder feature ships (his builder answer), on these rules.

- Tables are the `restaurant_tables` rows; sections are ADR 0345's `floor_sections`; merges are ADR 0345's merge rows and never write `restaurant_tables`.
- `x_pos`/`y_pos` hold plan units from 0 to 100, not metres.
- A new nullable `shape` column holds `round` or `rect`. NULL draws a plain marker. A shape is never guessed from seats.
- Delete becomes Hide, and bulk delete becomes bulk hide (`0303:37`; `baseline_from_production.sql:12926`). Hiding a table with an open seating or an active merge is refused with a sentence that says so.
- There is no default seat count for future tables; seats follow D4.
- Placing a kitchen, bar or pool mark does not by itself write `distance_to_*_m`, because plan units are not metres. A distance is derived only after the owner sets a scale (D12); until then the distances stay as they are, NULL or typed (`0303:63`).

### D7. A closed till check marks Paid

Moved to [ADR 0353](0353-a-closed-till-check-marks-paid-only-a-person-ends-a-seating.md) § Decision.

### D8. Hidden tables on the floor

- A hidden table is off the board and out of every per-table floor figure. This extends ADR 0303's fork F2 (`0303:60`), which already keeps hidden tables out of the room, the hot list and the insights (`table-analytics.service.ts:334`, `:717-721`; `insight-generator.service.ts:1468-1469`). It still catches its checks, and they stay in takings.
- Whether a hidden table's past seatings stay in each waiter's floor figures was F4. The till's rule today keeps hidden tables' checks *"in each server's figures"* (`PosSection.tsx:255-256`). They stay in, by the founder's pick *"Keep them in (Recommended)"* (AskUserQuestion asked 2026-10-31T06:00:41Z, Q4), asked as one question that also answers ADR 0346's F7. Its option text read "This matches the till, where a hidden table's checks stay in the servers' figures. Hiding a table never rewrites a waiter's history."
- A folded twin (D10) is hidden, so the same rule keeps its past seatings in each waiter's figures.

### D9. Copy and claims the build must change

The build PR changes, in the same commit as the code, every page sentence and every claims row that D1 to D12 make untrue, and adds `open` rows for the seat-2 fallback and the column defaults. It also states what ADR 0093's scenario runner, the one in-repo caller of `POST /analytics/tables`, does when a replay meets D3's 409, since the route no longer upserts.

### D10. Folding a till-taught twin into the kept table (founder's F1 pick; executor's mechanics)

- **His answer.** *"Merge words, hide twin (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q4). Its option text read "New checks that say 'T7' go to table 7 from now on, and the twin is hidden. Past checks stay where they were, so 'past checks never move' (ADR 0303) still holds." Everything else in D10 is the executor's.
- **The rule.** Folding points the twin at the kept table and hides the twin. From then on a new check whose word the twin answers goes to the kept table. Past checks never move, in either direction. Showing the twin undoes the fold.
- **The kept table may be hidden; the fold stands.** This is the executor's call under the founder's 2026-10-31T16:57:09Z delegation. Hidden 7 catches 'T7' as it does its own checks: out of its figures, in takings (D8). Every control that hides a kept table says the twin's checks keep coming to it.
- **Refused:** a fold into a table that is, at the moment of folding, in another house, retired, hidden or itself folded; a fold into itself; folding a table that others are folded into; retiring a kept table while a twin points at it; folding a twin that has an open seating or is in an active merge, as hiding is (D6).
- Owner or manager only, from the builder's tray and its hidden group.

### D11. "Not a table" for a waiting word (founder's F2 pick; executor's mechanics)

- **His answer.** *"Per-house 'not a table' list (Recommended)"* (AskUserQuestion asked 2026-10-31T16:55:36Z, Q1). Its option text read "The owner taps 'Not a table' once and that word never comes back for this house. Needs one small migration."
- **The rule.** A marked word leaves that house's waiting list, for any till source. The mark never refuses or unlinks a check, and never changes the learner.
- **Undo.** The tray's closed "Not a table" group offers *Put back*. This is the executor's call under the founder's 2026-10-31T16:57:09Z delegation. His option text names only the mark, so with no way back one wrong tap would hide a real table word for good.
- Adding a table named like a marked word is allowed. Owner or manager only.

### D12. Plan distances after a scale is set (founder's F5 pick; executor's mechanics, one call under the delegation)

- **His answer.** *"After a scale is set (Recommended)"* (AskUserQuestion asked 2026-10-31T16:55:36Z, Q3). Its option text read "Once the owner sets the plan's scale (e.g. by marking one known length), distances come from the drawing. Until then, only typed distances." This also meets the *"Builder starts from the till"* text's "Placing the kitchen and bar fills the room-distance analytics".
- **Typed always wins.** A typed distance is never overwritten by a derived one.
- **0303's rule still holds.** The room reads only what was recorded, and NULL is not 0 (`0303:63`). A derived value exists only after the owner sets a scale.
- **The straight line** is the executor's call under the founder's 2026-10-31T16:57:09Z delegation: a derived distance is the straight line between the table and the mark on the scaled plan, labelled "straight line on the plan".

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-01 | — | Part 1 of 3 |
