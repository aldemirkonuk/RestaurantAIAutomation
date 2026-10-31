# 0347 — The floor builder draws and adds tables, the till still teaches them, and a closed check marks a table Paid

- **Status:** Proposed (2026-10-31). Amends [ADR 0303](0303-tables-learned-from-the-pos.md), which is itself still `Proposed` (`0303:3`). The founder ruled four parts himself, in AskUserQuestion on 2026-10-30. First, the builder gets the checker's features (*"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*). Second, seats are optional (*"Optional seats (Recommended)"*). Third, Add a table lives in two places (*"Both, one shared form (Recommended)"*). Fourth, a closed till check marks Paid and never ends the seating (*"Auto-Paid, never auto-leave (Recommended)"*). Each is quoted in Context. On 2026-10-31 he answered this record's forks F1 to F5 in AskUserQuestion, and his 2026-10-30 Auto-Paid option text answers F6; each answer is quoted where it is decided (*Forks answered*, below). The executor designed the rest: the one create route, the twin-table guard's exact rule, the tray, how each checker feature maps onto `restaurant_tables`, the auto-Paid conditions and undo, and the mechanics of each answered fork (D10 to D12). A lock is his. If he locks 0303, he locks it as amended here, or he rejects this amendment.
- **Date:** 2026-10-31 (rulings of 2026-10-30, session ca58311b)
- **Decider:** founder: the four picks above, plus the multi-select picks *"Paid tap"* (`evidence/0345-floor-checker-research.md:471`) and *"Builder starts from the till"* (`:489`), quoted as the tool result quotes them, and his 2026-10-31 answers to F1 to F5 (F1 in D10, F2 in D11, F3 in D3, F4 in D8, F5 in D12). F6 is answered by his 2026-10-30 Auto-Paid option text (D7). Executor (session ca58311b): D3 to D9 wherever no fork answer is named, the mechanics inside D10 to D12, the reading of F6's text, and the owed edits. Three calls are the executor's under the founder's 2026-10-31T16:57:09Z delegation, each marked where it is made: D7's reading of *Voids* (F6), D11's *Put back*, and D12's straight line.
- **Keywords:** floor builder, Floor Checker, restaurant_tables, Add a table, shared form, twin table, twin guard, pos_table_for_ref, till_words, former_labels, tray, till-taught, learned_at, x_pos, y_pos, plan units, scale, shape, seats NULL, dash, no guessed 2, upsertTable, POST /analytics/tables, create-only, hide not delete, Paid, auto-Paid, undo, never auto-leave, closed_at, voided, csv_import, backfill, booth_event, residual 4, residual 5, residual 12, residual 17, addtable, seatsnote, fold, folded_into, twin rule on rename, Not a table, pos_not_table_words, plan scale, plan marks, derived distance
- **Links:**
  - [ADR 0303](0303-tables-learned-from-the-pos.md) (Proposed): amended. See *D1* for each sentence that changes and *D2* for each that stands.
  - [ADR 0345](0345-floor-checker-is-ported-into-mudavym.md) (Proposed, same branch, untracked): the port (`/floor`, `/floor/builder`, `/floor/me`, `floor_sections`, seatings, merges). It appeared in the tree while this record was being written, and was read only for the lines cited here (`0345:89-92`, `:94`, `:122`, `:148-150`, `:175`, `:192`). Research: [`evidence/0345-floor-checker-research.md`](evidence/0345-floor-checker-research.md), §2 items 2 and 5.
  - [ADR 0346](0346-waiter-scores-and-rankings-ship-to-managers.md): who sees per-waiter figures.
  - [ADR 0020](0020-no-fabricated-answers.md) and [ADR 0051](0051-rebuilt-pages-show-live-data-only.md) (both Locked): an unset seat count is shown as unknown, never filled in.
  - [ADR 0302](0302-booth-and-event-checks-keep-their-own-row.md): booth and event checks.
  - [ADR 0164](0164-sessions-follow-membership-and-several-houses-choose.md): RolesGuard is exact.
  - [ADR 0093](0093-a-scenario-is-replayed-and-verified-against-its-own-expectation.md): the scenario runner, the one in-repo caller of `POST /analytics/tables`.
  - Unmerged prior work:
    - `origin/backup/2026-10-08/addtable` (head `75678fa12`; commits `91c30008b`, `c24cc1565`).
    - `origin/backup/2026-10-08/seatsnote` (head `ef8c08605`).
    - Neither has a PR: `gh pr list --state all --head` returned `[]` for `feat/add-a-table-by-hand` and for `fix/seats-chart-says-why-it-is-empty`, 2026-10-31.
  - Source app: `/Users/aldemirkonuk/Projects/checker` at `5958689`. Every checker file cited here matches `HEAD`, with two exceptions. `EDGE_CASES.md` is modified in the working tree, but its line 18 is identical at `HEAD`. `lib/meal-alert.ts` is untracked (working tree only).

All repo citations are at `origin/main` `9914f5cbf`, read on 2026-10-31.

## Context

ADR 0303 made a table something the till teaches. A check's word with a digit in it learns a `restaurant_tables` row with `seats` and `is_outdoor` NULL (`supabase/migrations/20261222230000_tables_learned_from_the_pos.sql:303-310`). An owner or manager renames or hides it (`apps/api-gateway/src/analytics/analytics.controller.ts:645-647`). Its ruling's option text ended *"No drawing."* (`0303:3`), and it rejected option 2, "Draw the room", with those words (`0303:24`). On 2026-10-05 the founder made Add a table a follow-up lane in Settings → Point of sale (`0303:65`). He also rejected *"Add a seats field"* (`0303:67`). Floor Checker (ADR 0345) brings a builder that draws tables, adds them with a seat count, shapes them, groups them into sections and deletes them. That collides with each of those sentences.

**The founder's words, 2026-10-30 (verbatim; AskUserQuestion, session ca58311b):**

- The task: *"integrate floor checker folder and its deliverables in a safely and in a right manner to the mudavim.com in a way that all of its software features will pass there, and it will also integrate with all of the data analytics, and also it will take care of everything."*
- Asked about the builder against ADR 0303's "No drawing": *"I want to have all features but in mudavym's way oformat and design compatibility, and more features that actually provide with now the addition to the mudavym(IMPORTANT)"*.
- Sections: *"Separate floor sections (Recommended)"*. Old checker data: *"Start fresh (Recommended)"*. What a waiter's phone shows: *"Nothing for now"*.
- Seats on floor tables: *"Optional seats (Recommended)"*.
- Where Add a table lives: *"Both, one shared form (Recommended)"*.
- A closed till check: *"Auto-Paid, never auto-leave (Recommended)"*.
- His multi-select of new features included the items labelled *Paid tap* and *Builder starts from the till*.

**Source of these quotes.** They come from the session's rulings record: scratchpad `founder-rulings-2026-10-30.md`, which is outside the repo, under `/private/tmp`, and does not survive a reboot. That record does not keep the option texts he saw. It glosses three picks:

- "Optional seats": "dash when unset, never a guessed 2; amends ADR 0303".
- "Both, one shared form": "builder AND Settings → Point of sale, one form, one twin-table guard".
- "Auto-Paid": "one-tap undo for split bills; voids and backfills ignored".

Those glosses are the coordinator's summary, **not his words**, and this record treats them as the content of his picks. The research's description of *Builder starts from the till* reads: *"Tables the till taught Mudavym wait in a tray to be named, placed and sectioned."* (`evidence/0345-floor-checker-research.md` §2 item 5). That is the research's wording. Whether the option he saw showed it is not verified. [2026-10-31, fork-answer fold: the option texts he saw are now on record, in the session's verbatim AskUserQuestion log (copied into the evidence note's §3, `evidence/0345-floor-checker-research.md`, the durable copy, `:339`). *Builder starts from the till* read "Tables the till already taught wait in a tray to be named, placed and sectioned. 'Bar' or 'Window' can become a table once, with old checks linked. Placing the kitchen and bar fills the room-distance analytics. Amends ADR 0303." (`evidence/0345-floor-checker-research.md:484`). *"Optional seats (Recommended)"* read "The builder can set seats; a table without them shows a dash, never a guessed 2 (fixes the old POST that writes seats=2). Amends 0303." (`:509`). *"Both, one shared form (Recommended)"* read "The builder and Settings → Point of sale use the same add-table form and the same twin-table guard." (`:516`). *"Auto-Paid, never auto-leave (Recommended)"* read "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored." (`:523`). Each says what the gloss above says, and more; D12 records how the *Builder starts from the till* text's distance sentence is met.]

**What the code does today:**

- **The only create route guesses, and it overwrites.**
  - `POST /analytics/tables/:restaurantId` (`analytics.controller.ts:566-585`) has no `@Roles`. The class carries only `JwtAuthGuard` (`:117`), and `route-access.expected.json:17` records the route as `"open"`. (At `9914f5cbf`. PR #701, a draft at `ad8454425`, adds owner/manager roles to this route and to `route-access.expected.json:17`, and leaves the upsert as it is.)
  - Its description says *"Upserts on (restaurant, label)."* (`:570`). `upsertTable` writes:
    - `seats: Number(table.seats) || 2` (`apps/api-gateway/src/analytics/table-analytics.service.ts:59`);
    - `is_outdoor: Boolean(table.is_outdoor)` (`:61`);
    - then `.upsert(row, { onConflict: "restaurant_id,label" })` (`:72`).
  - So a POST naming an existing label overwrites that table's seats, zone, outdoor flag, distances and position. A learned table's NULL seats become 2 when the POST gives no seat count (or 0), and its NULL `is_outdoor` becomes false when the POST gives none.
  - The conflict key is `uq_restaurant_tables_label` on `(restaurant_id, label)`, which is case-sensitive (`baseline_from_production.sql:11922`). So a POST of "t12" beside "T12" makes a twin.
  - This is ADR 0303's residual 4 (`0303:96`) and residual 12 (`0303:104`). Note that 0303's own cites have drifted: `:16` cites `:50` for the `|| 2`, which is now `:59`, and `:104` cites `:563` for the route, which is now `:566`.
- **No screen calls it.** A grep of `apps/web/src` and `apps/mobile` finds only `GET` and `PATCH` callers (`apps/web/src/pages/settings/next/PosSection.tsx:177`, `:242`).
  - The one caller is the scenario runner. `upsert_tables` posts `{"label", "seats"}` per table and relies on the upsert (`scripts/simulate/scenario_apply.py:161-189`, `:184`).
- **The column defaults still guess.** The baseline gives `seats integer DEFAULT 2 NOT NULL` and `is_outdoor boolean DEFAULT false NOT NULL` (`baseline_from_production.sql:5173`, `:5175`). ADR 0303's migration dropped only NOT NULL (`20261222230000…:130-131`); no migration drops either default.
  - The learner writes NULL explicitly (`:307-310`), so the defaults bite only an insert that leaves the column out. No such insert exists in `apps/` today (grep).
- **A table cannot be deleted while it has checks.** `pos_checks_table_id_fkey` has no ON DELETE action (`baseline_from_production.sql:12926`).
- **Where a table lands on a plan is free today.** `x_pos` and `y_pos` are `numeric(8,2)` (`baseline:5179-5180`). `upsertTable` writes them (`table-analytics.service.ts:65-66`), and nothing in `apps/` reads them.
- **The distances are read.** The room's correlations read `distance_to_kitchen_m` (`table-analytics.service.ts:390`, `:535`), and so does the insight generator's driver step (`insight-generator.service.ts:2318`).
- **The checker guesses where Mudavym must not:**
  - `seats int not null default 2` (`checker/supabase/migrations/0001_init.sql:59`), and `createTable` falls back to 2 (`checker/app/floor-actions.ts:208`).
  - The capacity form falls back to 2 (`checker/components/FloorCapacitySettings.tsx:29`, `:35`).
  - Bulk setup picks the shape from the seat count, `defaultSeats > 4 ? "rect" : "round"` (`floor-actions.ts:323`).
  - It deletes tables (`:668`, `:682`).
  - Merges add the seats up (`checker/lib/floor-merge.ts:238`, `:387`).
  - Its seating has two states, `('seated', 'left')` (`0001_init.sql:12`). Its notes design "Mark paid": after it, *"service obligations stop"* and *"the waiter is never flagged for a camping guest"* (`checker/EDGE_CASES.md:18`).

## Options considered

1. **The builder edits `restaurant_tables` in place, the till keeps teaching, and one guarded create route serves both screens (chosen).** One table identity serves the till, the room analytics and the floor. What it costs: the create route is rebuilt (residual 4), and a guard must keep hand-added tables from twinning till-taught ones.
2. **A separate builder-owned floor-table row, mapped to `restaurant_tables`.** It appeals because the checker's model ports one to one, and 0303's rules stay untouched. Rejected by the executor: there would be two identities for one table, so every check-to-floor join and every per-table figure needs a mapping that can drift. The twin problem `0303:50` closed would reopen between the two tables.
3. **The builder only positions and sections till-taught tables, and adds none** (the research's path (a), evidence §1 "Forks the judge left"). This is the cheapest path and adds no twin risk. It is superseded by *"Both, one shared form (Recommended)"*.
4. **The full checker builder as written:** hard delete, seats 2 by default, shape guessed from seats. Rejected:
   - Deleting re-learns the table on its next check (`0303:37`), and the foreign key refuses it for any table that has checks (`baseline:12926`).
   - A default of 2 is the answer nobody gave (`0303:36`; ADR 0020), and he picked *"Optional seats (Recommended)"*.
5. **For Paid, a database trigger on `pos_checks`.** Rejected: a trigger cannot emit to the board's sockets. It would also put floor code inside the check write that ADR 0303's trigger already guards, and a fault there would fail the check.
6. **For Paid, derive it at read time by joining `pos_checks` to the open seating.** Rejected: there is no event for the board or the nudge scanner to react to, and an undo still needs stored state.
7. *Doing nothing.* Residual 12 stays open (no table without a digit can ever exist), the builder cannot be built under `0303:24`, and the only create route keeps overwriting and guessing seats (its role guard comes with PR #701 either way).

## Decision

**The floor builder places, shapes, sections, adds and hides the same `restaurant_tables` rows the till teaches. One owner/manager route creates a table for both the builder and Settings → Point of sale, behind one twin-table guard. A seat count is asked for and never guessed. A closed, unvoided, live till check marks its table's open seating Paid, which a person can undo, and only a person ends a seating.**

### D1. What in ADR 0303 is amended

- **`0303:3`, the last sentence of the 2026-10-04 option text, *"No drawing."*, and `0303:24`, option 2's rejection *"Rejected by the ruling: "No drawing.""*.**
  - Superseded, on the executor's reading, by his builder answer of 2026-10-30 (*"I want to have all features but in mudavym's way…"*). Tables are drawn in the builder (D6).
  - The rest of `0303:3` stands, as narrowed on 2026-10-05: a till word with a digit in it becomes a table (within `0303:47`'s limits), the owner renames or hides it, and past checks re-link.
- **`0303:62`, the bullet headed *"Nothing is drawn."*, and its sentence *"No copy claims a screen that adds a table (residual 12)."*.**
  - Amended once the shared form ships (D3). From then on, copy may say a table can be added under Settings → Point of sale or in the builder, and the register and export copy quoted there gains that clause (D9).
  - Until it ships, the sentence binds as written.
  - `:62`'s rules for hidden tables stand: a check that sat only at hidden tables drops the absent-attribution clause, and *"Every table in this house is hidden…"* still applies.
- **`0303:21`, *"No screen adds one yet (residual 12)"*, and `0303:104`, residual 12.** Closed by D3 when built.
- **`0303:65`, the Add-a-table pick.** It stands and is extended.
  - Its option text, *"A small separate PR adds 'Add a table' to Settings → Point of sale, for owners and managers. Waiting checks with that word link to it automatically."*, still holds.
  - Under *"Both, one shared form (Recommended)"*, the same form also opens from the builder.
- **`0303:67`, *"So a learned table keeps `seats` NULL and no screen asks for it"*, and his rejection there of *"Add a seats field"*.**
  - Amended by *"Optional seats (Recommended)"*: the shared form and the builder ask for seats, and leaving them empty is allowed.
  - A learned table still starts with `seats` NULL; that half stands.
  - The `seatsnote` sentence is still owed. A chart of per-seat figures can still be empty when no table states its seats (`apps/web/src/pages/reports/next/rp-registers-house.tsx:431`).
- **`0303:96`, residual 4, and `0303:104`'s "no role guard … upserts on the label … writes `seats` 2 and `is_outdoor` false".** The "no role guard" clause closes when PR #701 merges. The upsert, `seats` 2 and `is_outdoor` false close by D3 and D4 when built.

### D2. What in ADR 0303 stands, unchanged

- **`0303:36`, option 6 (no default of 2).** It stands, and it now binds hand-added tables too (D4).
- **`0303:37`, option 7 (no delete).** It stands. The builder's Delete becomes Hide (D6).
- **The learning, `0303:45-58`.** All of these hold unchanged:
  - `table_ref`;
  - the trigger and its order of rules;
  - the digit rule `~ '[0123456789]'` and the 60-character cap (`20261222230000…:303-304`);
  - every spelling kept in `till_words`/`former_labels` (`:142-143`, `:348-410`);
  - the belt: an update that leaves a check's word unchanged keeps its table (`:279-286`);
  - re-link fills NULL links only (`:418-470`);
  - the backfill.
  - The builder writes the same rows through the same routes, so a rename made from the tray fires `restaurant_tables_keep_till_names` (`:406-410`) and `relink_on_change` (`:458-462`). A hand add fires `relink_on_add` (`:451-455`).
- **`0303:59`, rename and hide through `PATCH`, owner or manager, with the 409 on a name clash.** It stands. D6 adds fields to the same route (an executor proposal).
- **`0303:60`, F2, *"Out of every figure (Recommended)"*.** It stands, and it is extended to the floor's per-table figures (D8). A hidden table still catches its checks, and they stay in takings.
- **`0303:61`, *"Keep them in the control (Recommended)"*.** It stands.
- **`0303:63`, the room reads only what was recorded.** It stands, and it binds any distance the builder derives (D6).
- **`0303:66`, the digit rule applies to Square tab names.** It stands.
- **`0303:91`, a table whose name has no digit is added once by hand.** It stands. That is now possible in both places, and the tray lists the words waiting for one (D5).
- **Residuals 5 (`:97`), 15 (`:107`) and 16 (`:108`) stand.** Residual 17 (`:109`) stands for renames and is closed for adds by D3's guard. [2026-10-31: closed for renames too, by the founder's F3 pick (D3, *The twin guard*). Residual 5 (`:97`), "Two till words cannot be merged into one table", closes for new checks by D10's fold; past checks stay where they were.]

### D3. One create route, one twin-table guard (executor's design)

- **One route.** `POST /analytics/tables/:restaurantId` becomes the only way to create a table by hand. Both screens call it through one form component.
- **Who may call it.** Owner or manager, which is 0303's F1 role set and `:65`'s "for owners and managers". PR #701 (DRAFT, `ad8454425`, unmerged) already adds `@UseGuards(RolesGuard) @Roles("owner", "manager")` to this route and records it as owner/manager in `route-access.expected.json:17`. If #701 has not merged when this is built, D3 adds the same guard. #701 changes only who may call the route: it still upserts on the label and still writes `seats || 2` and `Boolean(is_outdoor)` (`table-analytics.service.ts:59`, `:61`, `:72`). Create-only, the body rules and the twin guard below are D3's.
- **It only creates.** It never upserts and never overwrites.
- **What the body may say:**
  - name: required, trimmed, 1 to 60 characters, as PATCH requires (`table-analytics.service.ts:105`);
  - seats: optional, a whole number from 1 to 999;
  - outdoor: optional, true or false;
  - section, position and shape: optional (D6).
  - A value the body leaves out is stored as NULL.
- **No `learned_at`.** The insert carries none, so `relink_on_add` links the waiting checks in the same statement. No matching rule is copied into the gateway. The answer reports how many checks the new table took, or null when that count could not be read.
- **The twin guard.** A name N is refused with 409, on add and on rename, when any table of the house already answers the word N or the word `table N`; a rename leaves the table being renamed out of "any table". "Any table" includes shown, hidden and retired tables. "Answers" means by any rule of `pos_table_for_ref` (`20261222230000…:202-241`), for any source:
  - its label;
  - `table <label>`;
  - a `pos_refs` word;
  - a `till_words` word;
  - a former label, under either label rule.

  The refusal sentence names the table that answers. When that table is hidden, it says to show it again instead. When it is retired, it says the name cannot be used.
- **What the guard refuses, and why.** This refuses "5" while a "Table 5" table exists, and "Table 5" while a "5" exists. That is deliberate: those two spellings are the case `0303:50` was asked on. It also closes residual 17 for adds, because a new table can never outrank a word another table already answers. The guard is one SQL function, or one gateway reading of the same four rules; the build picks. [2026-10-31: the rename half is the founder's F3 pick, *"Yes, same twin rule (Recommended)"*, whose option text reads "Rename uses the same twin check as adding a table, ignoring the table being renamed. Closes the last way to make a twin by hand." (`evidence/0345-floor-checker-research.md:614`). Today PATCH compares labels only, case-blind, against every other row of the house (`table-analytics.service.ts:140-150`), and the unique index answers a race with 23505 (`:163-166`). Both stay; the guard is added in front of them, so residual 17 closes for renames as well. A table folded into another (D10) answers for the kept table, so a rename to its word names the kept table in the refusal.]
- **Build from the unmerged lane, not from scratch.** Lane `addtable` already built most of this for Settings: the route, owner/manager only, insert-only, NULL when not given, range checks, `checksLinked` and the form (`91c30008b`). Its fix round made the scenario runner add only missing tables (`c24cc1565`).
  - Its guard checks only the label and active `pos_refs` (`git show 75678fa12:apps/api-gateway/src/analytics/table-analytics.service.ts`, `:141-163`). It predates `till_words`/`former_labels`, which reached main with #621 on 2026-10-06. It must gain them. The same file validates `x_pos`/`y_pos` over -999999.99 to 999999.99 (`:115-116`); D6's plan units need 0 to 100, so the build narrows them.
  - The lane also carries an 83-line edit to 0303 (`git show --stat 91c30008b`). This record replaces that edit, so the build takes the lane's code and not its 0303 text.
  - Not verified: whether the lane rebases cleanly on `9914f5cbf`. It was never gated.
- **The scenario runner.** It must stop relying on the upsert (`scenario_apply.py:161-189`), as `c24cc1565` did. The CLI test's fake transport answers every tables call with 200 (`scripts/test_simulate_scenarios.py:952`) and needs the same change. Not verified: the role of the account the runner signs in with (`scenario_apply.py:112-133`; the credentials come from the environment variables `SIM_OWNER_EMAIL` and `SIM_OWNER_PASSWORD`, `scripts/simulate/cli.py:452-463`). PR #701 already makes this route refuse a login that is neither an owner nor a manager, so with such an account the runner's apply fails as soon as #701 merges, before D3 is built.

### D4. Seats are optional, shown as a dash, never guessed (founder's pick; executor's mechanics)

- A table states its seats only when a person typed them. Unset is NULL everywhere, and every screen shows it as "—".
- A migration drops both column defaults (`ALTER COLUMN seats DROP DEFAULT`, and the same for `is_outdoor`). With D3, no writer then supplies a 2 or a false that nobody gave. This is an executor proposal: the defaults bite only an insert that omits the column, and none in `apps/` does today.
- PATCH gains `seats` (a whole number from 1 to 999, or null to clear it).
- Per-seat figures stay withheld for a table with no seat count (`table-analytics.service.ts:397`; `rp-registers-house.tsx:431`).
- A merged table's seats show "—" when any member's seats are unknown, never a partial sum. The checker sums (`floor-merge.ts:238`, `:387`).
- The meal-run alert leaves out the "N-top" for a table with no seat count. The checker already omits it unless seats are above 0 (`checker/lib/meal-alert.ts:127`, untracked).

### D5. The tray: the builder starts from what the till taught (executor's design of the pick)

- **What is in the tray.** Every shown, active table with `x_pos` or `y_pos` NULL. A table with `learned_at` set is tagged "from the till".
  - Nothing gets the checker's default position of 50,50 (`0001_init.sql:61-62`). Unplaced means NULL, and NULL means the tray.
  - *"Start fresh (Recommended)"* means no checker table is imported, so the tray holds only what the till taught and what a person added.
- **How a table leaves the tray.** It leaves when it is placed or hidden.
  - Naming happens through the same PATCH, so the keep trigger keeps every spelling.
  - Sectioning goes through ADR 0345's `floor_sections` (`0345:94`). ADR 0345 has the builder start from `zone`, `x_pos` and `y_pos` (`0345:122`). Here `zone` is only read, as a hint, and the builder never writes it.
  - SimPOS houses learn tables labelled by UUID (`simpos.service.ts:676`; `0303:94`). The tray is where those get a name.
- **Words waiting for a table.** Below the tray sits the house's list of till words no table answers, each with its check count. Mostly these are words with no digit, but the list also holds a digit word that only a retired table answers (`0303:90`) and a word over 60 characters (`0303:47`, T29). For those two, "Make it a table" is refused, by the twin guard or by the 60-character rule (D3). It is read from `pos_checks` where `table_id IS NULL AND table_ref IS NOT NULL`, which the partial index `idx_pos_checks_unlinked_ref` serves (`20261222230000…:149-151`).
  - "Make it a table" opens the shared form with the word filled in. `relink_on_add` then links that word's past checks. This is `0303:91`'s cost, paid in one tap.
- **Who sees it.** The builder and the tray are for owners and managers, as Add a table is.
- **Two more acts on the tray, both ruled on 2026-10-31:** folding a till-taught twin into another table (the founder's F1 pick, D10), and marking a waiting word "Not a table" (his F2 pick, D11).

### D6. The checker's builder features, the Mudavym way (executor's mapping)

| Checker feature | Checker code (`5958689`) | In Mudavym |
|---|---|---|
| Sections: create, rename, delete | `app/floor-actions.ts:94`, `:129`, `:155`; deleting a section clears its tables' link (`0001_init.sql:57`) | `floor_sections` (ADR 0345). Deleting a section leaves its tables placed, with no section. |
| Add a table | `createTable`, `floor-actions.ts:197`, seats `\|\| 2` (`:208`) | The D3 form and route, seats optional (D4). |
| Edit a table | `updateTable`, `floor-actions.ts:614` | `PATCH /analytics/tables/:rid/:tid`, gaining `seats`, `is_outdoor`, `x_pos`, `y_pos`, `shape` and the section. Owner or manager, as today (`analytics.controller.ts:645-647`). |
| Place and move tables | `moveTable`, `floor-actions.ts:776`; `PositionsCanvas`, `components/FloorBuilder.tsx:352`; 0 to 100 plan coordinates (`0001_init.sql:61`) | `x_pos`/`y_pos` hold plan units from 0 to 100, not metres. |
| Shape | `table_shape ('round','rect')`, default round (`0001_init.sql:13`, `:60`); guessed from seats in bulk setup (`floor-actions.ts:323`) | A new nullable `shape` column with the same two values. NULL draws a plain marker. Never guessed from seats. |
| Delete, bulk delete | `deleteTable`/`deleteTables`, `floor-actions.ts:668`, `:682`; bulk delete skips tables with open seatings or merges (`FloorBuilder.tsx:100`) | Hide and bulk hide (`0303:37`; `baseline:12926`). Hiding a table with an open seating or an active merge is refused with a sentence that says so. The builder shows hidden tables in a closed "Hidden" group with Show. |
| Quick start | `setupSeatingLayout`, `floor-actions.ts:262`; labels `{prefix}1`, `{prefix}2`… (`:47-49`) | Offered only while the house has no table. Each label passes the D3 guard. Seats are set only if typed, and no shape is set. |
| Default seats for new tables | `syncRestaurantCapacity`, `floor-actions.ts:424` (*"Default seats apply to newly created tables only"*, `:422`); form `\|\| 2` (`FloorCapacitySettings.tsx:29`, `:35`) | No default for future tables. Instead, an explicit "Set seats" act on the selected tables, each write validated as D4. |
| Merges | `lib/floor-merge.ts` | ADR 0345's merge rows. A merge never writes `restaurant_tables`. Its seats follow D4. |

**Distances and the plan.** Placing a kitchen, bar or pool mark on the plan does not by itself write `distance_to_*_m`, because plan units are not metres.

- A distance is derived only after the owner sets a scale, one measured length on the plan.
- Until then the distances stay as they are, NULL or typed, and the room's recorded-only rule applies (`0303:63`).
- ADR 0345 does not fix where the marks and the scale are stored: it leaves the floor's own tables to their migrations (`0345:175`). The floor module's migration names that store.
- Whether derived distances may feed the driver fit at all was F5. The founder answered it on 2026-10-31 with *"After a scale is set (Recommended)"*; D12 builds it.

**Additions beyond the checker** (his "more features … the addition to the mudavym"):

- The tray (D5).
- The words waiting for a table, with their check counts (D5).
- The twin guard (D3).
- Seats that are honestly unknown (D4).
- A till-driven Paid (D7).

### D7. A closed till check marks Paid; only a person ends a seating (founder's pick; executor's conditions)

**Where it runs.** In the gateway, after a check's upsert succeeds in `PosHubService.ingest` (`apps/api-gateway/src/pos-hub/pos-hub.service.ts:1090-1096`).

- The upsert returns no row today. The hook reads the stored row, because ADR 0303's trigger can change `table_id` after the gateway's in-memory resolve (`pos-hub.service.ts:1068`; trigger function at `20261222230000…:249-325`).
- The hook's errors are logged and never fail, slow or refuse the ingest. When the hook fails, the seating is not marked, and the waiter's Paid tap still works.

**It marks only when all seven of these hold.** He picked *"Auto-Paid, never auto-leave (Recommended)"*. The rulings record glosses it as a one-tap undo, with voids and backfills ignored; that gloss is the coordinator's summary, not his words. Conditions 2 and 4 are the executor's reading of the gloss: voided means `pos_checks.voided`, and a backfill means source `csv_import`. Conditions 1, 3, 5, 6 and 7 are the executor's. [2026-10-31: the option text he saw is now on record: "A closed check marks the table Paid (with one-tap undo for split bills); the waiter still taps Leave. Voided checks and backfills are ignored." (`evidence/0345-floor-checker-research.md:523`). So the undo, the ignored voids and the ignored backfills are the words of the option text he picked. Conditions 2 and 4 stay the executor's reading of "voided checks" and "backfills".]

1. The stored `closed_at` is set (written at `pos-hub.service.ts:1076`).
2. `voided` is false (`20260824190000_pos_voided_and_consumption_idempotency.sql:23`; written at `pos-hub.service.ts:1086`).
3. `channel` is not `booth_event` (`20261223150000_a_check_carries_its_channel.sql:73`). A booth check is not table service (ADR 0302).
4. The source is not `csv_import`.
   - The import route passes that source (`pos-hub.controller.ts:140`), and its description names it *"the csv_import path for nightly exports and backfills"* (`:133`).
   - Live tills come through the signed webhook, which passes the provider instead (`:80`, `:115`).
5. `table_id` names a table with an open seating, or a table in an active merge. Hidden tables, unlinked words and tray tables have no seating, so they never mark.
6. `closed_at` is at or after that seating's `seated_at`. This window keeps an earlier party's check, or an import that slipped past condition 4, from marking a later party.
7. This (seating, check) pair has not marked before.
   - A re-send of the same check after an undo does nothing.
   - A second check at the same seating (the other half of a split bill) may mark it again.

**What Paid does.**

- The table stops nagging and stops counting as late: the checker's design, *"service obligations stop"* (`EDGE_CASES.md:18`).
- The seating stays open. Only a person's Leave ends it: *"never auto-leave"*.
- The word "Paid" goes to `restaurant:<id>`, which staff join.
- "Paid N min ago" is a figure, so it goes only to owners and managers through `emitToHouseRoles` (`apps/api-gateway/src/websocket/websocket.gateway.ts:39-43`, `:663`, `:684`).
- pos-hub has no socket emit today. Its only `emit()` is a logging callback (`pos-hub.service.ts:778-788`).

**The undo.**

- One tap, by the table's waiter, whoever is covering, or an owner or manager. The undo records who and when. Who may undo is the executor's call: the rulings record says only "one-tap undo for split bills".
- The late clock restarts from the moment of the undo, and the undo counts as no visit. This is the executor's design.

**Voids.** A void never marks Paid. A later void of the check that set Paid does not clear it either; a person undoes it. That is the executor's reading of "voids … ignored", and it is F6. [2026-10-31: F6 is answered by his own option text, "Voided checks and backfills are ignored." (`evidence/0345-floor-checker-research.md:523`). Read as written, a void changes nothing on the floor, so it neither marks Paid nor clears it; the reading is the executor's call under the founder's 2026-10-31T16:57:09Z delegation, *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."* Rejected: letting a later void clear Paid (F6's old (B)), because that makes a void act on the floor, which "ignored" rules out. The undo stays a person's tap.]

**Reach today.** SimPOS is loaded only outside production (`apps/api-gateway/src/app.module.ts:114-117`). The scenario runner posts signed webhooks (`scenario_apply.py:3-7`). Not verified: whether any production house's till posts closed checks with a table word during service.

### D8. Hidden tables on the floor

- A hidden table is off the board and out of every per-table floor figure. This extends F2, which already keeps hidden tables out of the room, the hot list and the insights (`table-analytics.service.ts:334`, `:717-721`; `insight-generator.service.ts:1468-1469`).
- It still catches its checks, and they stay in takings.
- Whether a hidden table's past seatings stay in each waiter's floor figures was F4. The till's rule today keeps hidden tables' checks *"in each server's figures"* (`PosSection.tsx:255-256`). [2026-10-31: they stay in, by the founder's pick *"Keep them in (Recommended)"*, asked as one question that also answers ADR 0346's F7. Its option text reads "This matches the till, where a hidden table's checks stay in the servers' figures. Hiding a table never rewrites a waiter's history." (`evidence/0345-floor-checker-research.md:564`). A folded twin (D10) is hidden, so the same rule keeps its past seatings in each waiter's figures.]

### D9. Copy and claims the build must change

- **`PosSection.tsx`.**
  - *"Nothing is drawn."* at `:29` and `:255`, and *"No seat count or position is asked for here."* at `:36-37`, stop being true once D3 and D6 ship.
  - *"Only the owner or a manager can rename or hide a table."* (`:323`) gains "add".
  - The register's empty state (`rp-registers-house.tsx:389`) and the export's equivalent gain the clause about adding a table.
- **`claims.d/feat-tables-learned-from-the-pos.jsonl:6`, `ADR-0303-NO-PAGE-ASKS-FOR-A-DRAWING`.**
  - It checks for the exact string *"Only the owner or a manager can rename or hide a table."* in `PosSection.tsx`. So the build PR must amend the row in the same commit as that copy.
  - Its retired phrase ("has to be drawn before it can be read") stays retired: the builder is a screen, and no page tells the owner to draw.
- **New rows the build PR adds.** Each starts `open` and turns `resolved` when built:
  - `table-analytics.service.ts` holds no `Number(table.seats) || 2`;
  - a migration drops the `seats` and `is_outdoor` defaults.
- The route's roles are already pinned by #701: its claim `A-TABLE-AND-SERVER-TAKINGS-NEED-A-MANAGER` (`claims.d/fix-analytics-money-routes-need-a-manager.jsonl`, on #701's branch, `resolved`) checks the route's own decorators, and its `route-access.expected.json:17` records owner and manager. A new `open` row saying the route is no longer `"open"` would fail the build as soon as #701 merges.

### D10. Folding a till-taught twin into the kept table (founder's F1 pick; executor's mechanics)

- **His answer.** *"Merge words, hide twin (Recommended)"* (`evidence/0345-floor-checker-research.md:601`). Its text: "New checks that say 'T7' go to table 7 from now on, and the twin is hidden. Past checks stay where they were, so 'past checks never move' (ADR 0303) still holds." (`:597`). Everything below that sentence is the executor's.
- **Why hiding alone does not do it.** A hidden table still catches its checks (`20261222230000_tables_learned_from_the_pos.sql:140-141`). The resolver reads only `is_active` (`:236`), and the gateway's `loadTables` and `resolveTable` match by label among active rows (`pos-hub.service.ts:1910-1947`). So a hidden 'T7' would keep every new 'T7' check, and none would reach table 7. (The rejected *"Hide the twin only"* option text, `evidence/0345-floor-checker-research.md:598`, said the twin would be recreated. By the migration's `:140-141` it would instead keep catching them.)
- **A pointer, not a word copy.** Three nullable columns go on `restaurant_tables`:
  - `folded_into` (the kept table's id);
  - `folded_by`, with an FK to `public.users(user_id)`;
  - `folded_at`.
  Folding writes those three and `hidden_at` in one UPDATE.
- **New checks go to the kept table.** When the winning row has a `folded_into`, `pos_table_for_ref` returns that id. It follows one hop only, because chains are refused (below). `resolveTable` must do the same:
  - a `table_id` the gateway sets stands (`20261222230000…:291`);
  - `resolveTable` is the only gateway writer of `pos_checks.table_id` (`pos-hub.service.ts:1068`).
  So `loadTables` selects `folded_into` too.
- **Past checks never move.** A fold writes no `pos_checks` row, and none of the three guarantees moves a link:
  - a re-sent check whose word is unchanged keeps its table (`20261222230000…:284-286`);
  - the relink trigger fills only NULL links (`:441`);
  - a fold changes none of the columns the relink-on-change trigger watches (`:459`).
- **Refused, by a trigger:**
  - a kept table that is in another house, retired, hidden or itself folded;
  - a fold into itself;
  - folding a table that others are folded into;
  - retiring a kept table while a twin points at it.
  Folding a twin that has an open seating or is in an active merge is refused, as hiding is (D6, `:186`).
- **The guard names the kept table.** When D3's guard refuses a name because a folded twin holds it, the message says where the word goes now ("'T7' already goes to table 7").
- **Show undoes it.** Showing a folded twin clears `folded_into`, `folded_by`, `folded_at` and `hidden_at` in one UPDATE. Checks that reached table 7 while the twin was folded stay on table 7: past checks never move, in either direction. A fold and its undo each write a `system_audit_log` row, as `stop-links-on-leaving.ts:116` writes one.
- **Figures.** The twin's past checks stay on the hidden twin. They are out of every per-table figure (`0303:60`) and in takings. Its seatings stay in the waiter figures (D8, his F4 pick). Folding goes through the hide path, so the stored table insights are cleared and recomputed as for a hide (`analytics.controller.ts:651`).
- **Who and where.** An owner or manager, from the builder's tray and its hidden group. It uses the same route and guard as rename and hide: `PATCH tables/:restaurantId/:tableId` (`analytics.controller.ts:645`) with a new `fold_into` body field.
- **A fold is not a floor merge.** A fold changes a table's identity for good, until someone shows the twin again. A floor merge seats two tables for one party, and is PR4's (ADR 0345).
- **Rejected:**
  - Copying the twin's words into table 7's `till_words` and retiring the twin. That column is "Written by restaurant_tables_keep_till_names only" (`20261222230000…:145`), the founder said *hidden*, not retired, and there would be no clean undo.
  - Putting 'T7' into table 7's `pos_refs`. That holds one word per source (`:217`), and a mapped till already owns it.
  - Moving past checks: his rejected *"Merge and move past checks"* (`evidence/0345-floor-checker-research.md:599`).
- **Build.**
  - Migration `a_folded_twin_sends_new_checks_to_the_kept_table`; its version is assigned at merge.
  - Claims, `open` until built: `pos_table_for_ref` reads `folded_into`; `loadTables` selects `folded_into`.
  - Tests:
    - a 'T7' check after the fold lands on table 7, through both the trigger and the gateway;
    - a re-sent pre-fold check keeps the twin;
    - each refusal above;
    - Show restores the twin;
    - an `auth.users` id as `folded_by` is refused.

### D11. "Not a table" for a waiting word (founder's F2 pick; executor's mechanics)

- **His answer.** *"Per-house 'not a table' list (Recommended)"* (`evidence/0345-floor-checker-research.md:610`). Its text: "The owner taps 'Not a table' once and that word never comes back for this house. Needs one small migration." (`:607`).
- **Store.** A table `pos_not_table_words`:
  - `restaurant_id`, with an FK to `restaurants`;
  - `word`, stored as `lower(btrim())`, as the resolver normalises (`20261222230000…:233`);
  - `marked_by`, with an FK to `public.users(user_id)`;
  - `marked_at`;
  - primary key `(restaurant_id, word)`.
  RLS is on, with a service-role policy and `REVOKE ALL … FROM anon, authenticated`, as `20260925160500_a_preference_is_kept_once_per_person_per_house.sql:125-131` does. Only the gateway reads or writes it.
- **What it changes: only the waiting list**, for any till source. It never refuses or unlinks a check, and never changes the learner. Every word that can wait is one the learner never learns: it has no digit, is over 60 characters, or is answered only by a retired table (`20261222230000…:301-305`). So "never comes back" holds with D2 intact, and a check carrying the word still lands with `table_id` NULL.
- **Undo.** The tray's closed "Not a table" group offers *Put back*: the executor's call under the founder's 2026-10-31T16:57:09Z delegation, *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."* His option text names only the mark, "that word never comes back for this house" (`evidence/0345-floor-checker-research.md:607`), so with no way back one wrong tap would hide a real table word for good. Rejected: no undo; an undo that also moves past checks, which this section's "never refuses or unlinks a check" rules out. Marking and putting back each write a `system_audit_log` row. Owner or manager only.
- **Adding a table named like a marked word is allowed.** `relink_on_add` links its waiting checks (`:451-455`), and the marked row is then inert.
- **Build.**
  - Migration `a_house_says_a_word_is_not_a_table`; its version is assigned at merge.
  - Tests:
    - RLS denies `anon` and `authenticated`;
    - an `auth.users` id as `marked_by` is refused;
    - a marked word leaves the list;
    - a new check carrying it still lands, unlinked.

### D12. Plan distances after a scale is set (founder's F5 pick; executor's mechanics, one call under the delegation)

- **His answer.** *"After a scale is set (Recommended)"* (`evidence/0345-floor-checker-research.md:624`). Its text: "Once the owner sets the plan's scale (e.g. by marking one known length), distances come from the drawing. Until then, only typed distances." (`:621`). This also meets the *Builder starts from the till* text's "Placing the kitchen and bar fills the room-distance analytics" (`:484`).
- **Store.** This names the floor-module rows that ADR 0345 leaves to the floor migrations (`0345:175`):
  - A per-house plan row holds:
    - the plan's aspect ratio, so one scale holds on both axes of the 0–100 plan;
    - metres per plan unit, with the two marked points and the typed length;
    - `set_by`, with an FK to `public.users(user_id)`;
    - `set_at`.
  - Plan marks hold a `kind` (kitchen, bar or pool) and `x`, `y`.
  - Both have RLS on and `REVOKE ALL … FROM anon, authenticated`.
- **Typed always wins.** A typed distance is never overwritten. Each table records which of its kitchen, bar and pool distances came from the plan (for example a `distances_from_plan text[]` column). A move, a mark or a scale change recomputes only those. Clearing the scale sets them back to NULL. A typed PATCH removes that kind from the set.
- **0303's rule still holds.** The room reads only what was recorded, and NULL is not 0 (`0303:63`). A derived value exists only after the owner sets a scale.
- **The executor's call under the founder's 2026-10-31T16:57:09Z delegation:**
  - The delegation: *"complete the full integration with ful SOTA and robust connections with the current mudavym structure and foundation. Do not ask me anything just complete it fully."*
  - The call: a derived distance is the straight line between the table and the mark on the scaled plan, and it is labelled "straight line on the plan".
  - Evidence: the question said "walking distance" (`evidence/0345-floor-checker-research.md:619`), but the plan holds no walls or aisles, so no walking path can be computed from it. The founder's option text says only "distances come from the drawing".
  - Rejected:
    - a computed walking path, which needs geometry the plan does not have;
    - calling the straight line "walking";
    - printing plan units as metres, which was rejected before he was asked (*Forks answered*, F5).
- **Build.**
  - Migration `a_plan_has_a_scale_and_its_marks`; its version is assigned at merge.
  - Tests:
    - with no scale, every derived distance is NULL;
    - a typed distance survives a scale change;
    - clearing the scale clears only derived values;
    - RLS denies `anon` and `authenticated`.

## Consequences

**Easier.**

- A table with no digit in its name ("Bar", "Window") can finally exist, in either screen, and its waiting checks link to it.
- The till's tables arrive in the builder ready to be named and placed, rather than redrawn.
- One route and one guard means there is one place where a twin can be refused.
- The overwriting, seat-guessing create route goes away (its role guard comes with PR #701).
- The floor and the room analytics read one table identity.
- A till-taught twin can be folded, and new checks then reach the kept table (D10). A word that is not a table can leave the waiting list (D11). Once the owner sets a scale, the plan fills the room distances (D12).

**Harder, or given up.**

- The twin guard refuses some names a person might want (the "5" and "Table 5" pair). The person must rename or show the existing table instead.
- Hiding a table with an open seating is refused.
- Per-seat figures stay empty until people type seat counts.
- Builder plan units are not metres, so the distance figures need a scale step before the plan can feed them (D12). A derived distance is a straight line on the plan, not a walking path.
- A folded twin's past checks stay on the twin, so they stay out of the kept table's per-table figures (D10). A kept table cannot be retired, folded or hidden while a twin points at it.
- The scenario runner and its CLI test must change with the route.

**Residuals (stated, not hidden).**

- Residual 16 (`0303:108`) stays: two concurrent case-different names can both land, because `uq_restaurant_tables_label` is case-sensitive (`baseline:11922`). A unique index on `(restaurant_id, lower(btrim(label)))` would close it. Not verified: whether production already holds such pairs, which would block that index.
- Residual 15 (`0303:107`) stays: no cap on how many tables one house can learn. `POST /pos-hub/import/:restaurantId` still carries only the class guard (`pos-hub.controller.ts:53`, `:129`).
- Residual 5 (`0303:97`) closes for new checks through D10's fold. Past checks stay where they were.
- The tray makes residual 15 visible, but does not fix it.

**Not verified.**

- Whether a production till posts closed checks with a table word during service.
- Whether a table can hold more than one open seating. ADR 0345 leaves seatings and merges to the floor module's migrations (`0345:175`). If a table can, D7 condition 5 must mark none.
- Whether the `addtable` lane rebases on `9914f5cbf`.
- The role of the scenario runner's account.
- Whether production already holds twin pairs (a learned "T7" beside a drawn "7"). No query was run. The tray will list them.

**Forks answered (the founder, AskUserQuestion, 2026-10-31; F6 by his 2026-10-30 option text).** None was filed as an OD row: each was answered before filing, so this record adds nothing to `OPEN-DECISIONS.md`. The source is the evidence note's §3 (`evidence/0345-floor-checker-research.md`), the durable copy of the session's AskUserQuestion log (`:339`); each `:N` below is a line of it.

- **F1, folding a till-taught twin (residual 5), → D10.**
  - His pick: *"Merge words, hide twin (Recommended)"* (`:601`).
  - Its text: `:597`.
  - Not picked: *"Hide the twin only"* (`:598`) and *"Merge and move past checks"* (`:599`), the second of which breaks *"past checks never move"* (`0303:54`).
- **F2, dismissing a digitless waiting word, → D11.**
  - His pick: *"Per-house 'not a table' list (Recommended)"* (`:610`).
  - Its text: `:607`.
  - Not picked: *"No dismiss"* (`:608`).
- **F3, the twin guard on rename, → D3.**
  - His pick: *"Yes, same twin rule (Recommended)"* (`:617`).
  - Its text: `:614`.
  - It closes residual 17 for renames.
- **F4, a hidden table's past seatings in waiter figures, → D8.**
  - His pick: *"Keep them in (Recommended)"* (`:567`).
  - Its text: `:564`.
  - It was asked once, as one question for this record and for ADR 0346 F7.
- **F5, plan-derived distances, → D12.**
  - His pick: *"After a scale is set (Recommended)"* (`:624`).
  - Its text: `:621`.
  - Not picked: *"Typed distances only"* (`:622`).
  - Deriving with no scale was rejected before he was asked, because plan units would be printed as metres.
- **F6, a void after Paid, → D7 *Voids*.**
  - Not asked again. His 2026-10-30 pick *"Auto-Paid, never auto-leave (Recommended)"* (`:527`) carries the text "Voided checks and backfills are ignored." (`:523`).
  - Reading that text as "a void neither marks nor clears Paid" is the executor's call under the founder's 2026-10-31T16:57:09Z delegation (D7 *Voids*, where the delegation is quoted).

**Edits made on this branch:**

- the dated brackets in 0303 at `:3`, `:21`, `:24`, `:62`, `:65`, `:67`, `:96` and `:104`;
- this record's row in `.planning/decisions/README.md` (a pure append);
- on 2026-10-31, this record's own fork-answer fold: D10 to D12, plus dated brackets at `:3`, `:5`, `:43`, `:125`, `:147`, `:175`, `:196`, `:213`, `:240` and `:248`.

**Still owed:**

- The D9 claims, which belong to the build PR.
- D10 to D12's three migrations, their claims and their tests, which belong to the build PRs (`floor-checker.md` PR6b and PR12b).

**Revisit when:**

- the first real till house posts webhooks during service (D7's reach);
- an owner meets a refused name that is not a twin;
- a mapped till's `pos_refs` word points at a folded twin (D10 follows one hop from the winner, whatever rank won);
- the plan gains walls or aisles (D12's straight line could then become a walking path);
- a Square house connects (the digit rule, `0303:66`).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-31 | Executor (session ca58311b, workflow wf_5f3024dd-b5c) | Created. Not audited. |
| 2026-10-31 | Fork-answer fold (workflow floor-checker-docs-reconcile, session ca58311b) | The founder's 2026-10-31 picks for F1 to F5 and his 2026-10-30 option text for F6 were folded in, quoted from `fork-answers-verbatim.md` with line cites:<br>• D10 (fold), D11 (Not a table) and D12 (plan scale) were added.<br>• Dated brackets went on D3, D5, D6, D7 and D8.<br>• *Forks owed* became *Forks answered*. No OD rows were filed.<br>• The stale "0345:10 links it by number only" item was dropped, because `0345:10` links the file.<br>• D12's straight-line distance is marked as the executor's call under the 2026-10-31T16:57:09Z delegation.<br>Not audited. No adversarial pass was run on the D10 pointer, the D11 list or the D12 store.<br>Repair round, same day: every `fork-answers-verbatim.md` cite in the body re-pointed to the durable evidence note (`evidence/0345-floor-checker-research.md` §3), whose lines were re-read; the Decider's labels quoted as the tool result quotes them (`:471`, `:489`); D7's *Voids* reading, D11's *Put back* and F6's reading marked as the executor's calls under the 16:57:09Z delegation, with it quoted. Every edit in place; no line moved. |
