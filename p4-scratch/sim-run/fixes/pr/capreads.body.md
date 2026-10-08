TITLE: fix: a capped list says it is capped (OPS-02, SETUP-05)

> **Coordinator note, 2026-10-08 (UTC).** New head `eadda4b159f48f463c252da64d1075ddc744fed5`: two commits on `4acfdba3f`, then origin/main `62f8967b4` merged in with no conflicts. **19 files against origin/main, over the 15-file rule.** The four added files are the verifier's sibling-reader shoulds (`ConsentPanel.tsx` + its test, `TeamRecord.tsx`, `useTeamNextData.ts`), all in one commit that can be split into its own PR.
>
> How each verifier should was answered:
> 1. **Base not current.** origin/main `62f8967b4` is merged (it includes #613), so origin/main is now an ancestor. The tech-debt note's service cite moved from `:446` to `settings-audit.service.ts:547`.
> 2. **ConsentPanel still said "Nobody has changed it".** It now says that only when the readout's `complete` is true (`ConsentPanel.tsx:114`). Otherwise it says no change is among the latest N recorded changes and that older ones are not read here. An absent `complete` counts as not proven whole. Only the sentence changed: the cap still applies across every register before the register filter.
> 3. **/team said the route "offers no count".** The `TeamRecord.tsx` footer and the `useTeamNextData.ts` doc now say the readout carries a count that this sheet does not read. No behaviour change.
> 4. **The cost of returning the whole leaf was undisclosed.** A new tech-debt bullet names the three consequences, none measured against a real house: Dismissed and Done render every row; the ContextualInsights rail pulls the whole book on mount; `undoableFor` nulls `undoableByYou` once its single 1,000-row history read misses a held key. The `listByStatus` comment was narrowed the same way as the body line below.
>
> The nits are answered too. The tech-debt note says the future guard would flag `readActionRows`' `select("*")`, and the body's "every entry its count says it holds" line is corrected in place below.
>
> Evidence at `eadda4b15`:
> - **Gateway jest:** `src/analytics src/common/read-whole-window src/settings-audit` gives 59 suites / 966 tests, all passing.
> - **Web vitest:** `src/pages/settings/next src/pages/team/next src/pages/recommendations` gives 41 files / 714 tests, all passing.
> - **ConsentPanel mutation:** removing the `complete` check turns 2 of 10 red; the file was restored and checked with `cmp`.
> - **tsc:** web and gateway show only the @simplewebauthn errors.
> - **Claims:** 949 / 949 holding.
> - **lanecheck:** all 6 guards rc=0, ownership `[]`, files=19.
>
> Still not done: no Browser pane check, web eslint not run, not pushed, not audited.

**Branch** `fix/a-capped-list-says-it-is-capped`, from origin/main `ca3582988`. Head is `4acfdba3f`, 3 commits, 15 files against main. `git merge-tree` against the current origin/main `a323cc80b` (#613) reports no conflicts. Local only: not pushed, not audited. [Stale as of 2026-10-08: origin/main `62f8967b4` is now merged in; head is `eadda4b15`, 19 files against main. See the coordinator note above.]

## Why

The scenario walk of 2026-10-07 found two P1 lists that stop at a row cap and say nothing.

- **OPS-02, /recommendations.** `recommendation_actions` keeps one row per key a house has ever acted on, and nothing prunes it. PostgREST's `max_rows` is 1000 (`supabase/config.toml:18`).
  - `readDispositions` selected the house's book with no range, count or order. Past 1,000 rows it got an arbitrary 1,000 of them and still answered `readable: true`. Dismissed and done entries stood again, and the Snoozed, Dismissed and Done counts ran low.
  - `listByStatus` stopped at the newest 1,000.
  - History cut at 200 and did not say so.
- **SETUP-05, /settings Ledger.** The page asks for the latest 100 changes, and the gateway caps a read at 200. The answer carried no count, and `oldestAt` was the last row returned. So "100 changes · oldest 3 Sep" read as the whole record, with the 100th row posing as the first change ever filed.

**No new ADR.** Every choice here applies a rule that is already locked:
- **ADR 0292:** read whole or refuse, through `readWholeWindow`.
- **ADR 0067:** a failed read is never reported as an empty one, which is why `stateCounts` is null when the book cannot be read.
- **The house rules:**
  - an unknown is not a zero, so with no count the page never says "of N" and never calls the list whole;
  - prose is never broader than the code;
  - staff see no house money; nothing here shows money, and a staff reader's total counts only the rows they may read.

## What changes

**Gateway, `recommendation-actions.service.ts`**
- `readDispositions` and `listByStatus` read through a new `readActionRows`. It calls `readWholeWindow`, which pages on `id` with an exact count.
  - When `readDispositions` cannot read the book whole, it answers `readable: false` (the feed's existing `suppressionsReadable: false`). It never answers with the first 1,000 rows.
  - When `listByStatus` cannot read the leaf whole, it throws `WholeReadError`. The page shows that as a failed read, not an empty leaf.
  - The leaf is sorted newest first after the read, using `updated_at` and then `id`.
- **How "page listByStatus" is read here.** The gateway reads the whole leaf in keyset pages and returns it whole. There is no client cursor, so the leaf always lists every entry its count says it holds. [Broader than the code, corrected 2026-10-08: the leaf lists every row the read counted, or the read throws `WholeReadError` past 100,000 rows or when the count will not hold still twice. That count is not the tab count: `stateCounts` is computed separately (`recommendations.service.ts:883-890`).]
- `listHistory` returns `{ items, total, capped, limit }`.
  - It still returns the newest `HISTORY_LIST_ROWS` (200).
  - `total` is the same query's exact count, or null when no count came back.
  - `capped` is `total > items.length`. When no count came back, `capped` is true if the window came back full.

**Gateway, `recommendations.service.ts`**
- `stateCounts` is null when the dispositions cannot be read whole. The web already draws a null `stateCounts` as unknown.

**Gateway, `analytics.controller.ts`**
- `GET recommendations/:restaurantId/history` passes all four fields through. Before, it returned `{ items }` alone.

**Gateway, `settings-audit.service.ts`**
- `list` counts the trail exactly in the query that reads the window. It then returns:
  - `total`: null when the log is unreadable or no count came back;
  - `complete`: true only when every counted row was read;
  - `limit`: the window after the cap.
- `oldestAt` is now documented as the oldest row *shown*.
- A `register` filter narrows `entries`, not `total`.

**Web, `/recommendations`**
- `useRecommendationsNextData` keeps a `historyWindow` (`shown`, `total`, `capped`) and resets it on every load.
- An older gateway that sends no `capped` flag, and whose window comes back full (200 rows), counts as capped with no total.
- When the window is capped, the History leaf says one of:
  - "Newest 200 of 1,234 acted entries. The other 1,034 are kept and are not listed here."
  - With no count: "Newest 200 acted entries. Older ones are kept and are not listed here; how many was not counted."

**Web, `/settings` Ledger**
- `LedgerRegister` gains `total`, `complete` and `limit`, all optional for an older gateway.
- `LedgerSection` says "N changes · oldest <date>" only when `complete` is true. Otherwise it says one of:
  - "latest 100 of 1,050 changes · oldest shown <date>"
  - With no count: "latest N changes — how many are older was not counted · oldest shown <date>"

**Records**
- `claims.d/fix-a-capped-list-says-it-is-capped.jsonl` holds 7 static rows (python only):
  - dispositions read whole
  - listByStatus read whole
  - History window
  - stateCounts null
  - History line
  - Ledger total
  - Ledger line
- `tech-debt.d/2026-10-07-fix-a-capped-list-says-it-is-capped.md` holds what stays owed (see below).

## Evidence (at `4acfdba3f`, working tree clean) [superseded for the current head by the 2026-10-08 note above]

**Gateway jest:** `cd apps/api-gateway && npx jest src/analytics src/common/read-whole-window src/settings-audit` gives 59 suites and 952 tests, all passing. The baseline before this work was 28 suites and 511 tests on the narrower set `recommendation insights read-whole-window digest settings-audit`.

New gateway cases:
- **`recommendation-suppression.spec.ts`, OPS-02 block (9 cases).** The PostgREST fake applies the 1000-row cap to every response whatever was asked. `count: "exact"` is the filtered size before the limit, and `gt("id")` is honoured. It can fail on page N, or answer with no count.
  - A 1,500-row book with a dismissal at row 1,400 reads in 2 keyset pages, and the dismissal holds in `listSuppressions`.
  - A failing page 2 gives `readable: false` and an empty map.
  - 1,200 dismissed rows are listed in full, newest first; a failing page rejects with `WholeReadError`.
  - History: 1,234 rows give 200, total 1,234 and capped; 50 rows are not capped; no count with 300 rows gives total null and capped.
  - The controller answers all four fields.
- **One new assertion** that `stateCounts` is null when the dispositions cannot be read.
- **`settings-audit.service.spec.ts` (6 cases).**
  - A 1,050-row trail at limit 100: total 1,050, not complete, and `oldestAt` is row 950.
  - A request for 5,000 is held to 200 and still counted.
  - 30 rows: complete.
  - No count: total null, not complete.
  - A staff reader's total is 120, with 40 `away_set_for_member` rows left out.
  - An unreadable log: total null, not complete.

**Red against the base, gateway.** I swapped the 4 gateway source files for their `ca3582988` copies and ran the two specs. 16 of 53 tests failed: all 16 new ones. The files were restored and checked with `cmp`.

**Web vitest:**
- `cd apps/web && npx vitest run src/pages/recommendations/next/useRecommendationsNextData.test.tsx src/pages/recommendations/next/RecommendationsNext.test.tsx src/pages/settings/next/` gives 14 files and 346 tests, all passing.
- `npx vitest run src/pages/recommendations` gives 17 files and 336 tests, all passing.

New web cases:
- **Hook (4):** `total` and `capped` are kept and reset off the leaf; a whole History is not capped; an older gateway's full window counts as capped; `stateCounts: null` gives `counts` null.
- **Component (3):** the "Newest 200 of 1,234" line; the no-count line; no line on a whole History.
- **SettingsNext (3):** the "latest 100 of 1,050 … oldest shown" line; "1 change · oldest" when complete; the no-count line.

**Red against the base, web.** I swapped the 4 web source files for their `ca3582988` copies. 7 of the 10 new web cases failed (7 of 218 tests in the three files). The 3 that pass on the base pin behaviour that was already correct and must stay:
- no History line on a whole History;
- a null `stateCounts` drawn as unknown;
- the complete-trail wording, which the old line already used.

**tsc.** The only errors are environmental, in no touched file:
- gateway (`npx tsc --noEmit -p apps/api-gateway`): 2 errors in `passkeys.service.ts`, because `@simplewebauthn/server` is missing from node_modules;
- web (`npx tsc --noEmit | grep -v '^../../packages'`): 1 error in `passkeys.ts`, because `@simplewebauthn/browser` is missing likewise.

**Mutations.** Each was applied as: `cp -p` snapshot, mutate, run, restore, `cmp`. Every one went red, and every file was restored byte-identical.

| | Mutation | Result |
|---|---|---|
| N1 | `readDispositions` does an unranged single select | 3 fail |
| N2 | `listByStatus` does an ordered single select (limit 1000) | 2 fail |
| N3 | `capped: false` | 3 fail |
| N4 | `total` is null | 3 fail |
| N5 | `stateCounts` is kept when unreadable | 1 fails |
| N9 | the controller wraps the page in `{ items }` | 1 fails |
| M6 | `complete: true` | 3 fail |
| M7 | no `count: "exact"` | 4 fail |
| M8 | `limit: 0` | 2 fail |
| W1 | the whole-record line is shown regardless of `complete` | 2 fail |
| W2 | "oldest shown" becomes "oldest" | 2 fail |
| W3 | "latest N of M" becomes "N changes" | 1 fails |
| W4 | the History line is removed | 2 fail |
| W5 | the hook drops `total` | 2 fail |
| W6 | an older gateway's full window is not capped | 1 fails |
| W7 | no `historyWindow` reset per load | 1 fails |

**Claims rows**, run by hand from the worktree root (`bash -c "$verify"`, as the runner does):
- All 7 exit 0 at HEAD.
- Each exits 1 when its file is reverted to `ca3582988`. That is 9 reverts, because two rows check two files each. Every file was restored and checked with `cmp`.
- `scripts/check_decision_claims.sh` was **not** run, as the coordinator runs it alone.

**`lanecheck.sh wt-fix-capreads` exits 0.** The six fast guards are all rc=0, `files=15`, and `ownership` is `[]`.

## What is NOT done

- **No guard names `recommendation_actions`.** ADR 0292's row-cap guard list is not on main: no `scripts/*.py` at `a323cc80b` mentions `readWholeWindow`. The guard is only on the unmerged `fix/analytics-window-reads-guard`, scoped to `pos_checks` and `wine_consumption_log`. The table goes on it when that guard lands. ADR 0292's readers table is not edited here.
- **The Ledger has no "show older" action.** SETUP-05's suggested fix included one. The page says how much it holds and stops there.
- **History does not page past its newest 200.** It says how many more there are.
- ~~**A per-setting trail can still say "Nobody has changed it" when someone has.**~~ [Fixed 2026-10-08 in `522c09169`; see the note above.] `ConsentPanel` asks `register=<r>&limit=10`, and the service caps the rows across every register *before* it filters by register. The panel does not yet read the new `complete` flag. This would have been the 16th file. The `readRegister` half of this defect was fixed on main by #613.
- **A refused leaf read reaches the page as a 500, not a 503.** `listRecommendationActions` wraps every error in a 500. The page still says the leaf could not be read.
- **Not checked:**
  - Both pages were not checked in the Browser pane.
  - eslint was not run.
  - Nothing was run against production or a real database. The row-cap behaviour is proved against a PostgREST fake, not against PostgREST itself.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
