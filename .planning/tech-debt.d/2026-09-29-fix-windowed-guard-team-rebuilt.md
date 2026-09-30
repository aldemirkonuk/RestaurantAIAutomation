## /team's windowed-figures guard lists four legacy files and misses three rebuilt ones that query — ~~OPEN~~ CLOSED 2026-09-28 (founder item 89, `fix/windowed-guard-team-rebuilt`) — 2026-09-28

**Where.** `scripts/check_windowed_figures.py`, the /team `PageSpec` (`:457-529` on this branch)
and its self-test (`:2472` on). Filed on draft PR #494 (the ADR 0149 trial cutover), whose `team`
group deletes `pages/team/command/` and so made the guard exit 2 (*"anchor file is missing:
apps/web/src/pages/team/command/ManagerShiftDesk.tsx"*, reproduced on #494's tree 2026-09-28).

**What was wrong.** Re-measured on `origin/main` at `46c3fdb5d`. Two faults, and a third that
hid them:
1. The tuple named the four legacy query files as ordinary renderers, so deleting the legacy half
   could only be a refusal.
2. Three rebuilt files that call `useQuery` were never listed: `FormerStaff.tsx` (1 call),
   `SendGrantsSection.tsx` (1) and `useHouseAreas.ts` (2). Meanwhile the comment beside the
   tuple said every /team query was in the files it named. W6 never read their keys.
3. Listing them would not have been enough. `SendGrantsSection.tsx` and `useHouseAreas.ts` key
   through undotted factories (`grantKeys(restaurantId)`, `areasKey(rid)`, `awayKey(rid)`), and
   `QUERY_KEY_CALL` required a dot, so it saw no key in either file. Their bodies parsed to zero
   keys, and the page-wide "no keys" refusal could not fire while other files had keys.

All seven keys carried the tenant, so this was a surface nobody checked, not a leak.

**Answer.** Founder item 89, 2026-09-28, on #494, verbatim label **"Guard PR first, then delete
(Recommended)"**: a separate reviewed PR amends the guard's /team list before the cutover. That
answer is his approval of this CI-guard change.

**Fix.**
- The three files are renderers now (`:474-486`).
- The legacy four moved to a new `retiring` tuple under `retiring_root` (`:492-498`;
  `retiring_present`, `:853`). While any source file is left under `pages/team/command/`, all
  four are anchors and are checked like renderers. A missing one still exits 2, and so does a lone
  leftover test. Once no source file is left, none is read, and every run prints that the half is
  RETIRED. The legacy half stays checked on `main` until the cutover lands, and #494 no longer
  exits 2.
- `query_tree` (`:501`, `unlisted_query_files` `:877`) walks `pages/team` recursively. It
  refuses (exit 2) any non-test file there that calls a react-query hook and is not named. The
  sentence that was false for weeks is a check now, and a legacy desk moved instead of deleted is
  caught too.
- `every_query_read` (`:502`, `:1083`) refuses a query call that does not parse to an options
  literal (`useQueries`, `useSuspenseQuery`, options built elsewhere). It also refuses a parsed
  body with no key the matcher can read (a bare local).
- `QUERY_KEY_CALL` (`:649`) reads undotted factory calls.
- W6/W7 match a tenant token as a whole identifier (`names_tenant`, `:671`). Before, `rid` inside
  `week-grid` passed. The measurement: 0 of the 51 keys the amended guard reads on `main` change
  verdict.
- The self-test's /team cases name their files through `_team_file` (`:1757`), not tuple
  positions. Four cases had been writing legacy bodies over WeekGrid, ShiftSheet and TeamOverlays.
  The rebuilt query files got fixtures in their own shape (none had one). `TEAM_SERVER_WINDOWS`'
  fixture gained `TRAIL_ROWS` and its settings-audit clamp.

**Verified 2026-09-28.**
- Guard exit 0 on `origin/main`'s tree, reading 16 /team files and 23 keys.
- Guard exit 0 on `feat/cutover-manifest-trial`'s tree (#494 at `1e94bfc08`), reading 12 files
  and 15 keys and printing the legacy half RETIRED. #494's own copy of the guard exits 2 there.
- `--self-test`: 116/116, up from 89. Each piece was undone in a copy of the script, and the
  cases written for it went red:
  - substring tokens: 1 case red;
  - `every_query_read` off: 3 red;
  - `query_tree` off: 3 red;
  - retiring skipped while present: 7 red;
  - a missing retiring file skipped: 2 red;
  - the RETIRED note dropped: 2 red;
  - undotted factories unseen with `every_query_read` also off: 6 red;
  - undotted factories unseen with `every_query_read` on: the whole run refuses.
- With the three files dropped from the tuple again, the real-tree run exits 2 and names all
  three.
- Manual mutations on the real trees each failed the run:
  - `grantKeys()`, `awayKey(null)`, an untenanted FormerStaff key, a `-grid` substring key and
    TeamRecord's deleted `LE` each exit 1;
  - a bare-local key, a `useQueries`, one deleted legacy file, a moved legacy desk and a new
    unlisted query file each exit 2.
- CLAIMS `TD-2026-09-28-TEAM-WINDOWED-GUARD-UNLISTED-QUERIES` (resolved). Its verify exits 1
  against `main`'s original script.

**Still open, stated.**
1. **#494 carries an OPEN twin.** It holds an OPEN CLAIMS row with the same id and an OPEN entry
   under this heading. When it merges `main` it must drop both. Otherwise the open row fails the
   claims guard, because its claim now holds.
2. **`retiring` is dead after the cutover.** Once #494 merges, the `retiring` tuple names files
   that no longer exist. That is harmless and printed on every run, and a one-line follow-up can
   remove it.
3. **The factory body is not judged.** W6 judges a factory's ARGUMENTS, so `grantKeys` could drop
   its argument inside the factory and still pass. That was already the boundary for dotted
   factories.
4. **W5 reads only the hooks file.** A capped read in a renderer would go unseen. Measured
   2026-09-28 by grep: no /team renderer's source contains the word `limit` in a query, except
   an `aria-label` in `SendGrantsSection.tsx`. No command holds that.
5. **The two completeness checks are /team-only.** Each is opt-in per page, and every clean run
   names the pages without them. Measured 2026-09-28, unlisted query files per page:
   - /receiving: `useArrivalAsks.ts`;
   - /communications: `Compose/HouseDrafts.tsx`, `Compose/useComposeData.ts`,
     `LetterRequestsPanel.tsx`, and `useSendersDeskData.ts` (read by W7 through two named
     hooks);
   - /documents-reports: `IncompleteOrders.tsx`;
   - /receipts: a bare-local key, `detailKey` in `ReceiptsNext.tsx:670-672`, that W6 cannot
     read.

   Turning the checks on there is its own change.
