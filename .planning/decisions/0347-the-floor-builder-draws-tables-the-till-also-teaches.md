# 0347 — The floor builder draws and adds tables, and the till still teaches them

- **Status:** Proposed (2026-10-31)
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
- **`0303:96`, residual 4, and `0303:104`'s clauses "no role guard beyond the class JwtAuthGuard", "it upserts on the label" and "it writes `seats` 2 and `is_outdoor` false when none is given".** The role clause is closed on main: PR #701 (ADR 0348) put owner/manager roles on the route (`analytics.controller.ts:596-597`). The upsert, `seats` 2 and `is_outdoor` false close by D3 and D4 when built.

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
- **Who may call it.** Owner or manager, which is 0303's F1 role set and `0303:65`'s "for owners and managers". PR #701 (ADR 0348) put `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")` on this route (`analytics.controller.ts:596-597`), so D3 adds no role guard of its own. #701 changed only who may call the route; create-only, the body rules and the twin guard below are D3's.
- **It only creates.** It never upserts and never overwrites.
- **What the body may say:** name, required, trimmed, 1 to 60 characters, as PATCH requires (`table-analytics.service.ts:105`); seats, optional, a whole number from 1 to 999; outdoor, optional, true or false; section, position and shape, optional (D6). A value the body leaves out is stored as NULL.
- **No `learned_at`.** The insert carries none, so `relink_on_add` links the waiting checks in the same statement. No matching rule is copied into the gateway. The answer reports how many checks the new table took, or null when that count could not be read.
- **The twin guard.** A name N is refused with 409, on add and on rename, when any table of the house already answers the word N or the word `table N`.
  - A rename leaves the table being renamed out of "any table". "Any table" includes shown, hidden and retired tables.
  - "Answers" means by any of the four ranked rules of `pos_table_for_ref` (`20261222230000_tables_learned_from_the_pos.sql:202-241`), for any source: a `pos_refs` word; its label; `table <label>`; a `till_words` word or a former label, under either label rule.
  - The refusal names the table that answers. It closes residual 17 for adds, because a new table can never outrank a word another table already answers.
- **The rename half is the founder's F3 pick**, *"Yes, same twin rule (Recommended)"* (AskUserQuestion asked 2026-10-31T16:55:36Z, Q2). Its option text read "Rename uses the same twin check as adding a table, ignoring the table being renamed. Closes the last way to make a twin by hand." Today's PATCH checks stay, with the guard in front of them, so residual 17 closes for renames as well.

### D4. Seats are optional, shown as a dash, never guessed (founder's pick; executor's mechanics)

- A table states its seats only when a person typed them. Unset is NULL everywhere, and every screen shows it as "—".
- A migration drops both column defaults (`ALTER COLUMN seats DROP DEFAULT`, and the same for `is_outdoor`). With D3, no writer then supplies a 2 or a false that nobody gave. This is an executor proposal: the defaults bite only an insert that omits the column, and none in `apps/` does today.
- PATCH gains `seats` (a whole number from 1 to 999, or null to clear it).
- Per-seat figures stay withheld for a table with no seat count (`table-analytics.service.ts:397`; `rp-registers-house.tsx:433`).
- A merged table's seats show "—" when any member's seats are unknown, never a partial sum. The checker sums (`floor-merge.ts:238`, `:387`).
- The meal-run alert leaves out the "N-top" for a table with no seat count. The checker already omits it unless seats are above 0 (`checker/lib/meal-alert.ts:127`, untracked).

### D5. The tray: the builder starts from what the till taught (executor's design of the pick)

- **What is in the tray.** Every shown, active table with `x_pos` or `y_pos` NULL. A table with `learned_at` set is tagged "from the till". Nothing gets the checker's default position of 50,50 (`0001_init.sql:61-62`): unplaced means NULL, and NULL means the tray. *"Start fresh (Recommended)"* means no checker table is imported, so the tray holds only what the till taught and what a person added.
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

The build PR changes, in the same commit as the code, every page sentence and every claims row that D1 to D6 make untrue, and adds `open` rows for the seat-2 fallback and the column defaults.

### D10. Folding a till-taught twin into the kept table (founder's F1 pick; executor's mechanics)

- **His answer.** *"Merge words, hide twin (Recommended)"* (AskUserQuestion asked 2026-10-31T16:54:31Z, Q4). Its option text read "New checks that say 'T7' go to table 7 from now on, and the twin is hidden. Past checks stay where they were, so 'past checks never move' (ADR 0303) still holds." Everything else in D10 is the executor's.
- **The rule.** Folding points the twin at the kept table and hides the twin. From then on a new check whose word the twin answers goes to the kept table. Past checks never move, in either direction. Showing the twin undoes the fold.
- **The kept table may be hidden; the fold stands.** This is the executor's call under the founder's 2026-10-31T16:57:09Z delegation. Hidden 7 catches 'T7' as it does its own checks: out of its figures, in takings (D8). Every control that hides a kept table says the twin's checks keep coming to it.
- **Refused:** a fold into a table that is in another house, retired, hidden or itself folded; a fold into itself; folding a table that others are folded into; retiring a kept table while a twin points at it; folding a twin that has an open seating or is in an active merge, as hiding is (D6).
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

## What the code does today

- **The only create route guesses, and it overwrites.**
  - `POST /analytics/tables/:restaurantId` (`analytics.controller.ts:590-615`) is owner or manager only since PR #701 (ADR 0348) merged: `@UseGuards(RolesGuard)` and `@Roles("owner", "manager")` (`:596-597`), under the class's `JwtAuthGuard` (`:132`), and `apps/api-gateway/src/auth/guards/route-access.expected.json:17-20` records it so. PR #701 left the upsert as it was.
  - Its description says *"Upserts on (restaurant, label)."* (`:601`). `upsertTable` writes `seats: Number(table.seats) || 2` (`apps/api-gateway/src/analytics/table-analytics.service.ts:59`), `is_outdoor: Boolean(table.is_outdoor)` (`:61`), then `.upsert(row, { onConflict: "restaurant_id,label" })` (`:72`).
  - So a POST naming an existing label overwrites that table's seats, zone, outdoor flag, distances and position. A learned table's NULL seats become 2 when the POST gives no seat count (or 0), and its NULL `is_outdoor` becomes false when the POST gives none.
  - The conflict key `uq_restaurant_tables_label` on `(restaurant_id, label)` is case-sensitive (`supabase/migrations/20260805000000_baseline_from_production.sql:11922`), so a POST of "t12" beside "T12" makes a twin. This is ADR 0303's residual 4 (`0303:96`) and residual 12 (`0303:104`).
- **A table cannot be deleted while it has checks.** `pos_checks_table_id_fkey` has no ON DELETE action (`baseline_from_production.sql:12926`).
- **Where a table lands on a plan is free today.** `x_pos` and `y_pos` are `numeric(8,2)` (`baseline_from_production.sql:5179-5180`). `upsertTable` writes them (`table-analytics.service.ts:65-66`), and nothing in `apps/` reads them.
- **The distances are read.** The room's correlations read `distance_to_kitchen_m` (`table-analytics.service.ts:390`, `:535`), and so does the insight generator's driver step (`apps/api-gateway/src/analytics/insights/insight-generator.service.ts:2318`).

## How it is built

The mechanics behind § Decision, moved here so that part holds every binding rule. Each subsection serves the decision named in its heading.

### The code behind D3 and D4

- **No screen calls the create route.** A grep of `apps/web/src` and `apps/mobile` finds only `GET` and `PATCH` callers (`apps/web/src/pages/settings/next/PosSection.tsx:177`, `:242`), and the route's own comment says no web or mobile code calls it (`analytics.controller.ts:593`). The one caller is the scenario runner: `upsert_tables` posts `{"label", "seats"}` per table and relies on the upsert (`scripts/simulate/scenario_apply.py:161-189`, `:184`).
- **The column defaults still guess.** The baseline gives `seats integer DEFAULT 2 NOT NULL` and `is_outdoor boolean DEFAULT false NOT NULL` (`baseline_from_production.sql:5173`, `:5175`). ADR 0303's migration dropped only NOT NULL (`20261222230000_tables_learned_from_the_pos.sql:130-131`); no migration drops either default. The learner writes NULL explicitly (`:307-310`), so the defaults bite only an insert that leaves the column out. No such insert exists in `apps/` today (grep).

### The create route and twin guard, in detail (D3)

- The guard is one SQL function, or one gateway reading of the same four rules; the build picks.
- **The refusal sentence.** It names the table that answers. When that table is hidden, it says to show it again instead. When it is retired, it says the name cannot be used.
- **What the guard refuses, and why.** It refuses "5" while a "Table 5" table exists, and "Table 5" while a "5" exists. That is deliberate: those two spellings are the case `0303:50` was asked on.
- **On rename.** Today PATCH compares labels only, case-blind, against every other row of the house (`table-analytics.service.ts:140-150`), and the unique index answers a race with 23505 (`:163-166`). Both stay, and the guard is added in front of them. A table folded into another (D10) answers for the kept table, so a rename to its word names the kept table in the refusal.
- **Prior work.** Unmerged: `origin/backup/2026-10-08/addtable` (head `75678fa12`) and `origin/backup/2026-10-08/seatsnote` (head `ef8c08605`). Neither has a PR: `gh pr list --state all --head` returned `[]` for `feat/add-a-table-by-hand` and for `fix/seats-chart-says-why-it-is-empty`, 2026-10-31. The lane `addtable` already built most of this for Settings (`91c30008b`): the route, insert-only, NULL when not given, range checks, `checksLinked` and the form.
  - Its guard checks only the label and active `pos_refs` (`git show 75678fa12:apps/api-gateway/src/analytics/table-analytics.service.ts`, `:141-163`). It predates `till_words`/`former_labels`, which reached main with #621 on 2026-10-06, and must gain them.
  - It validates `x_pos`/`y_pos` over -999999.99 to 999999.99 (`:115-116`). D6's plan units need 0 to 100, so the build narrows them.
  - Its 83-line edit to 0303 (`git show --stat 91c30008b`) is replaced by this record. The build takes the lane's code, not its 0303 text.
- **The scenario runner.** It must stop relying on the upsert (`scripts/simulate/scenario_apply.py:161-189`), as the lane's fix round `c24cc1565` did. The CLI test's fake transport answers every tables call with 200 (`scripts/test_simulate_scenarios.py:952`) and changes with it.
  - Since PR #701 merged, this route refuses a login that is neither an owner nor a manager. So with such an account the runner's apply already fails, before D3 is built.
  - Not verified: the role of the account the runner signs in with (`scenario_apply.py:112-133`; `SIM_OWNER_EMAIL` and `SIM_OWNER_PASSWORD`, `scripts/simulate/cli.py:452-463`).

### The checker's builder features, mapped (D6)

Source app: `/Users/aldemirkonuk/Projects/checker` at `5958689`. Every checker file cited here matches `HEAD`, with two exceptions. `EDGE_CASES.md` is modified in the working tree, but its line 18 is identical at `HEAD`. `lib/meal-alert.ts` is untracked (working tree only).

**The checker guesses where Mudavym must not:** `seats int not null default 2` (`checker/supabase/migrations/0001_init.sql:59`), and `createTable` falls back to 2 (`checker/app/floor-actions.ts:208`); the capacity form falls back to 2 (`checker/components/FloorCapacitySettings.tsx:29`, `:35`); bulk setup picks the shape from the seat count, `defaultSeats > 4 ? "rect" : "round"` (`floor-actions.ts:323`); it deletes tables (`:668`, `:682`); merges add the seats up (`checker/lib/floor-merge.ts:238`, `:387`). Its seating has two states, `('seated', 'left')` (`0001_init.sql:12`). Its notes design "Mark paid": after it, "service obligations stop" and "the waiter is never flagged for a camping guest" (`checker/EDGE_CASES.md:18`).

| Checker feature | Checker code (`5958689`) | In Mudavym |
|---|---|---|
| Sections: create, rename, delete | `app/floor-actions.ts:94`, `:129`, `:155`; deleting a section clears its tables' link (`0001_init.sql:57`) | `floor_sections` (ADR 0345). Deleting a section leaves its tables placed, with no section. |
| Add a table | `createTable`, `floor-actions.ts:197`, seats `\|\| 2` (`:208`) | The D3 form and route, seats optional (D4). |
| Edit a table | `updateTable`, `floor-actions.ts:614` | `PATCH /analytics/tables/:rid/:tid`, gaining `seats`, `is_outdoor`, `x_pos`, `y_pos`, `shape` and the section. Owner or manager, as today (`analytics.controller.ts:676-678`). |
| Place and move tables | `moveTable`, `floor-actions.ts:776`; `PositionsCanvas`, `components/FloorBuilder.tsx:352`; 0 to 100 plan coordinates (`0001_init.sql:61`) | `x_pos`/`y_pos` hold plan units from 0 to 100, not metres. |
| Shape | `table_shape ('round','rect')`, default round (`0001_init.sql:13`, `:60`); guessed from seats in bulk setup (`floor-actions.ts:323`) | A new nullable `shape` column with the same two values. NULL draws a plain marker. Never guessed from seats. |
| Delete, bulk delete | `deleteTable`/`deleteTables`, `floor-actions.ts:668`, `:682`; bulk delete skips tables with open seatings or merges (`FloorBuilder.tsx:100`) | Hide and bulk hide (`0303:37`; `baseline_from_production.sql:12926`). Hiding a table with an open seating or an active merge is refused with a sentence that says so. The builder shows hidden tables in a closed "Hidden" group with Show. |
| Quick start | `setupSeatingLayout`, `floor-actions.ts:262`; labels `{prefix}1`, `{prefix}2` and on (`:47-49`) | Offered only while the house has no table. Each label passes the D3 guard. Seats are set only if typed, and no shape is set. |
| Default seats for new tables | `syncRestaurantCapacity`, `floor-actions.ts:424` (*"Default seats apply to newly created tables only"*, `:422`); form `\|\| 2` (`FloorCapacitySettings.tsx:29`, `:35`) | No default for future tables. Instead, an explicit "Set seats" act on the selected tables, each write validated as D4. |
| Merges | `lib/floor-merge.ts` | ADR 0345's merge rows. A merge never writes `restaurant_tables`. Its seats follow D4. |

ADR 0345 makes the floor's own tables new floor migrations (ADR 0345 § Decision) and does not fix where the plan's marks and scale are stored; the D12 mechanics below name that store.

**Additions beyond the checker**, which his builder answer asks for (*Context*): the tray and the words waiting for a table, with their check counts (D5); the twin guard (D3); seats that are honestly unknown (D4); a till-driven Paid (ADR 0353).

### The tray's waiting words, in detail (D5)

- Mostly these are words with no digit. The list also holds a digit word that only a retired table answers (`0303:90`), and a word over 60 characters (`0303:47`, T29). For those two, "Make it a table" is refused, by the twin guard or by the 60-character rule (D3).
- The list is read from `pos_checks` where `table_id IS NULL AND table_ref IS NOT NULL`, which the partial index `idx_pos_checks_unlinked_ref` serves (`20261222230000_tables_learned_from_the_pos.sql:149-151`).

### Copy and claims, in detail (D9)

- **`PosSection.tsx`.** *"Nothing is drawn."* (`:29`, `:255`) and *"No seat count or position is asked for here."* (`:36-37`) stop being true once D3 and D6 ship. *"Only the owner or a manager can rename or hide a table."* (`:323`) gains "add". The register's empty state (`rp-registers-house.tsx:391`) and the export's equivalent gain the clause about adding a table.
- **`claims.d/feat-tables-learned-from-the-pos.jsonl:6`, `ADR-0303-NO-PAGE-ASKS-FOR-A-DRAWING`.** It checks for that exact `PosSection.tsx:323` sentence, so the build PR changes the row in the same commit as the copy. Its retired phrase ("has to be drawn before it can be read") stays retired: the builder is a screen, and no page tells the owner to draw.
- **New rows the build PR adds**, each `open` until built: `table-analytics.service.ts` holds no `Number(table.seats) || 2`; a migration drops the `seats` and `is_outdoor` defaults.
- **No new row for the roles.** They are pinned on main by `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER` (`claims.d/fix-analytics-money-routes-need-a-manager.jsonl:1`, `resolved`) and by `route-access.expected.json:17-20`. An `open` row saying the route is no longer `"open"` would fail at once.

### The fold, in detail (D10)

- **Why hiding alone does not do it.** A hidden table still catches its checks (`20261222230000_tables_learned_from_the_pos.sql:140-141`). The resolver reads only `is_active` (`:236`), and the gateway's `loadTables` and `resolveTable` match by label among active rows (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:1910-1947`). So a hidden 'T7' would keep every new 'T7' check, and none would reach table 7. The rejected *"Hide the twin only"* option said the twin would be recreated; by `:140-141` it would instead keep catching them.
- **A pointer, not a word copy.** Three nullable columns go on `restaurant_tables`: `folded_into` (the kept table's id); `folded_by`, with an FK to `public.users(user_id)`; `folded_at`. Folding writes those three and `hidden_at` in one UPDATE.
- **New checks go to the kept table.** When the winning row has a `folded_into`, `pos_table_for_ref` returns that id. It follows one hop only, because chains are refused (D10).
  - `resolveTable` must do the same: a `table_id` the gateway sets stands (`20261222230000_tables_learned_from_the_pos.sql:291`), and `resolveTable` is the only gateway writer of `pos_checks.table_id` (`pos-hub.service.ts:1068`). So `loadTables` selects `folded_into` too.
- **Past checks never move.** A fold writes no `pos_checks` row, and none of the three guarantees moves a link. In `20261222230000_tables_learned_from_the_pos.sql`: a re-sent check whose word is unchanged keeps its table (`:284-286`); the relink trigger fills only NULL links (`:441`); a fold changes none of the columns the relink-on-change trigger watches (`:459`).
- **The refusals** of D10 are enforced by a trigger; the kept table's house, retired, hidden and folded states are checked at the fold.
- **The kept table hidden.** Rejected: refusing that hide (it forces an unfold), unfolding on it, or a resolver that skips it. Each sends the 'T7' checks made while 7 is hidden to the twin, for good.
- **The guard names the kept table.** When D3's guard refuses a name because a folded twin holds it, the message says where the word goes now ("'T7' already goes to table 7").
- **Show undoes it.** Showing a folded twin clears those four columns in one UPDATE. Checks that reached table 7 while the twin was folded stay on table 7. A fold and its undo each write a `system_audit_log` row, as `stop-links-on-leaving.ts:116` writes one.
- **Figures.** The twin's past checks stay on the hidden twin: out of every per-table figure (`0303:60`) and in takings. Its seatings stay in the waiter figures (D8, his F4 pick). Folding goes through the hide path, so the stored table insights are cleared and recomputed as for a hide (`analytics.controller.ts:692`, `:711`).
- **A fold is not a floor merge.** A fold changes a table's identity until someone shows the twin again. A floor merge seats two tables for one party (ADR 0345).
- **Route.** The rename and hide route and guard, `PATCH tables/:restaurantId/:tableId` (`analytics.controller.ts:676`), with a new `fold_into` field.
- **Rejected:**
  - Copying the twin's words into table 7's `till_words` and retiring the twin. That column is "Written by restaurant_tables_keep_till_names only" (`20261222230000_tables_learned_from_the_pos.sql:145`), the founder said *hidden*, not retired, and there would be no clean undo.
  - Putting 'T7' into table 7's `pos_refs`. That holds one word per source (`:217`), and a mapped till already owns it.
  - Moving past checks: his rejected *"Merge and move past checks"*.
- **Build.** Migration `a_folded_twin_sends_new_checks_to_the_kept_table`, its version assigned at merge, with its claims and tests. Owed by the build PRs.

### The not-a-table list, in detail (D11)

- **Store.** A table `pos_not_table_words`: `restaurant_id`, with an FK to `restaurants`; `word`, stored as `lower(btrim())`, as the resolver normalises (`20261222230000_tables_learned_from_the_pos.sql:233`); `marked_by`, with an FK to `public.users(user_id)`; `marked_at`; primary key `(restaurant_id, word)`.
  - RLS is on, with a service-role policy and `REVOKE ALL` from `anon` and `authenticated`, as `20260925160500_a_preference_is_kept_once_per_person_per_house.sql:125-131` does. Only the gateway reads or writes it.
- **Why "never comes back" holds with D2 intact.** Every word that can wait is one the learner never learns: it has no digit, is over 60 characters, or is answered only by a retired table (`20261222230000_tables_learned_from_the_pos.sql:301-305`). So a check carrying the word still lands with `table_id` NULL.
- **Put back.** The goal message the delegation rests on reads *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."* Rejected: no undo; and an undo that also moves past checks, which "never refuses or unlinks a check" rules out. Marking and putting back each write a `system_audit_log` row.
- **A table named like a marked word.** `relink_on_add` links its waiting checks (`20261222230000_tables_learned_from_the_pos.sql:451-455`), and the marked row is then inert.
- **Build.** Migration `a_house_says_a_word_is_not_a_table`, its version assigned at merge, with its tests. Owed by the build PRs.

### The plan's scale and marks, in detail (D12)

- **Store.** Floor-module rows (ADR 0345 § Decision, new migrations):
  - A per-house plan row holds the plan's aspect ratio, so one scale holds on both axes of the 0 to 100 plan; metres per plan unit, with the two marked points and the typed length; `set_by`, with an FK to `public.users(user_id)`; and `set_at`.
  - Plan marks hold a `kind` (kitchen, bar or pool) and `x`, `y`.
  - Both have RLS on and `REVOKE ALL` from `anon` and `authenticated`.
- **Typed always wins, mechanically.** Each table records which of its kitchen, bar and pool distances came from the plan (for example a `distances_from_plan text[]` column). A move, a mark or a scale change recomputes only those. Clearing the scale sets them back to NULL. A typed PATCH removes that kind from the set.
- **Why a straight line.** The question said "walking distance" (AskUserQuestion asked 2026-10-31T16:55:36Z, Q3), but the plan holds no walls or aisles, so no walking path can be computed from it. His option text says only "distances come from the drawing". Rejected: a computed walking path, which needs geometry the plan does not have; calling the straight line "walking"; printing plan units as metres, which was rejected before he was asked.
- **Build.** Migration `a_plan_has_a_scale_and_its_marks`, its version assigned at merge, with its tests. Owed by the build PRs.

## Options considered

1. **The builder edits `restaurant_tables` in place, the till keeps teaching, and one guarded create route serves both screens (chosen).** One table identity serves the till, the room analytics and the floor. What it costs: the create route is rebuilt (residual 4), and a guard must keep hand-added tables from twinning till-taught ones.
2. **A separate builder-owned floor-table row, mapped to `restaurant_tables`.** It appeals because the checker's model ports one to one, and 0303's rules stay untouched. Rejected by the executor: there would be two identities for one table, so every check-to-floor join and every per-table figure needs a mapping that can drift. The twin problem `0303:50` closed would reopen between the two tables.
3. **The builder only positions and sections till-taught tables, and adds none.** The architecture run wf_c6c2a59b-b8b (ADR 0345 § Options considered) named this the cheapest path, with no twin risk; it was offered to him as "Position only" (AskUserQuestion asked 2026-10-31T03:03:50Z, Q2). It is superseded by his builder answer and *"Both, one shared form (Recommended)"*.
4. **The full checker builder as written:** hard delete, seats 2 by default, shape guessed from seats. Rejected:
   - Deleting re-learns the table on its next check (`0303:37`), and the foreign key refuses it for any table that has checks (`baseline_from_production.sql:12926`).
   - A default of 2 is the answer nobody gave (`0303:36`; ADR 0020), and he picked *"Optional seats (Recommended)"*.
   - D6 rejects the shape guess.
5. **For Paid, a database trigger on `pos_checks`.** Rejected: a trigger cannot emit to the board's sockets. It would also put floor code inside the check write that ADR 0303's trigger already guards, and a fault there would fail the check. The Paid rule is ADR 0353's now.
6. **For Paid, derive it at read time by joining `pos_checks` to the open seating.** Rejected: there is no event for the board or the nudge scanner to react to, and an undo still needs stored state.
7. *Doing nothing.* Residual 12 stays open (no table without a digit can ever exist), the builder cannot be built under `0303:24`, and the only create route keeps overwriting and guessing seats. Its role guard is on main either way, since PR #701.

## Consequences

**Retire-to-write (CLAUDE.md §4).** This file is the one decision record §5 requires. It retires no document, as ADRs 0249, 0265, 0273, 0287 and 0314 did. Whether retire-to-write binds a new ADR is OD-243 (OPEN-DECISIONS.md:330 on main), open.

### Easier

- A table with no digit in its name ("Bar", "Window") can finally exist, in either screen, and its waiting checks link to it.
- The till's tables arrive in the builder ready to be named and placed, rather than redrawn.
- One route and one guard means there is one place where a twin can be refused.
- The overwriting, seat-guessing create route goes away (its role guard is on main since PR #701).
- The floor and the room analytics read one table identity.
- A till-taught twin can be folded, and new checks then reach the kept table (D10). A word that is not a table can leave the waiting list (D11). Once the owner sets a scale, the plan fills the room distances (D12).

### Harder, or given up

- The twin guard refuses some names a person might want (the "5" and "Table 5" pair). The person must rename or show the existing table instead.
- Hiding a table with an open seating is refused.
- Per-seat figures stay empty until people type seat counts.
- Builder plan units are not metres, so the distance figures need a scale step before the plan can feed them (D12). A derived distance is a straight line on the plan, not a walking path.
- A folded twin's past checks stay on the twin, out of the kept table's per-table figures, and a kept table cannot be retired or folded while a twin points at it (D10).

### Residuals

- Residual 16 (`0303:108`) stays: two concurrent case-different names can both land, because `uq_restaurant_tables_label` is case-sensitive (`baseline_from_production.sql:11922`). A unique index on `(restaurant_id, lower(btrim(label)))` would close it.
- Residual 15 (`0303:107`) stays: no cap on how many tables one house can learn. `POST /pos-hub/import/:restaurantId` still carries only the class guard (`pos-hub.controller.ts:53`, `:129`). The tray makes it visible, but does not fix it.
- Residual 5 (`0303:97`) closes for new checks through D10's fold. Past checks stay where they were.

### Not verified

- Whether production already holds case-different label pairs, which would block that unique index.
- Whether a production till posts closed checks with a table word during service.
- Whether a table can hold more than one open seating (seatings are new floor migrations, ADR 0345 § Decision). If it can, the Paid rule must mark none (ADR 0353 § Decision).
- Whether the `addtable` lane rebases on current main (`5e966c8b6`).
- The role of the scenario runner's account.
- Whether production already holds twin pairs (a learned "T7" beside a drawn "7"). No query was run. The tray will list them.

### Forks answered

The founder answered F1 to F5 in AskUserQuestion on 2026-10-31, before his delegation, and F6 by his 2026-10-30 option text. Each was answered before filing, so none became an OD row.

- **F1, folding a till-taught twin (residual 5), → D10.** His pick: *"Merge words, hide twin (Recommended)"* (asked 2026-10-31T16:54:31Z, Q4). Not picked: *"Hide the twin only"* and *"Merge and move past checks"*, the second of which breaks *"past checks never move"* (`0303:54`).
- **F2, dismissing a digitless waiting word, → D11.** His pick: *"Per-house 'not a table' list (Recommended)"* (asked 16:55:36Z, Q1). Not picked: *"No dismiss"*.
- **F3, the twin guard on rename, → D3.** His pick: *"Yes, same twin rule (Recommended)"* (asked 16:55:36Z, Q2). It closes residual 17 for renames.
- **F4, a hidden table's past seatings in waiter figures, → D8.** His pick: *"Keep them in (Recommended)"* (asked 06:00:41Z, Q4), asked once, as one question for this record and for ADR 0346's F7.
- **F5, plan-derived distances, → D12.** His pick: *"After a scale is set (Recommended)"* (asked 16:55:36Z, Q3). Not picked: *"Typed distances only"*. Deriving with no scale was rejected before he was asked, because plan units would be printed as metres.
- **F6, a void after Paid,** moved with the Paid rule to ADR 0353 § Decision › Voids. It was not asked again: his 2026-10-30 pick *"Auto-Paid, never auto-leave (Recommended)"* carries the text "Voided checks and backfills are ignored." (asked 2026-10-31T03:46:17Z, Q4). Reading that text as "a void neither marks nor clears Paid" is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, recorded there.

### Where his picks were first kept

The session's rulings record, a scratchpad file under `/private/tmp` that does not survive a reboot, kept his picks but not the option texts, and glossed three: "dash when unset, never a guessed 2; amends ADR 0303"; "builder AND Settings → Point of sale, one form, one twin-table guard"; "one-tap undo for split bills; voids and backfills ignored". Those glosses are the coordinator's summary, **not his words**. Each option text quoted in § Context says what its gloss says, and more.

### Still owed

Owed by the code PRs, not by a repo doc:

- The create-only route, the twin guard on add and rename, and the migration that drops the `seats` and `is_outdoor` defaults, with the D9 claims and copy changes.
- The fold and Not a table routes, D10 and D11's two migrations, their claims and their tests.
- The builder's screens at `/floor/builder`: the tray, the words waiting for a table, and the one shared add-a-table form, mounted in the builder and in Settings → Point of sale.
- The plan's scale and marks, D12's migration and its tests, and the derived distances.

### Revisit when

- the first real till house posts webhooks during service (the Paid rule's reach, ADR 0353);
- an owner meets a refused name that is not a twin;
- a mapped till's `pos_refs` word points at a folded twin (D10 follows one hop from the winner, whatever rank won);
- the plan gains walls or aisles (D12's straight line could then become a walking path);
- a Square house connects (the digit rule, `0303:66`).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-31 | Executor, session ca58311b | Created. Not audited. |
| 2026-10-31 | Fork-answer fold, same session | His F1 to F5 picks and his F6 option text folded in; D10, D11 and D12 added. Not audited. No adversarial pass was run on the D10 pointer, the D11 list or the D12 store. |
| 2026-10-31 | Repair round, same session | Fork cites re-pointed to his verbatim answers; delegated calls marked. |
| 2026-10-31 | Restructure, same session | Split into parts; old D7 (Paid) moved to ADR 0353; cites re-measured at `037452ebe`. Not audited. |
| 2026-11-01 | Fork judge, same session | D10: a kept table may be hidden; its fold stands. Not audited. |
| 2026-11-01 | executor | R3 rewrite: no held-note cites; single decision record |
