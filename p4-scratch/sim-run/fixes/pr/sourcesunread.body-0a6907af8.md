TITLE: fix: name a refused insight read in /recommendations sourcesUnread (ADR 0292 fork 3)

**Branch** `fix/recommendations-name-a-refused-read`, from origin/main `ca3582988`. It has three commits and changes 9 files against main. Local only: not pushed, not audited.

## Why

ADR 0292 (#609) made analytics reads whole-or-refuse. Inside the insight bundle, a refused or failed read left its slice empty, so every family that needs that slice went silent. But `generate()` still resolved, so /recommendations listed nothing in `sourcesUnread`. The quiet tier then said every source answered, so a failed read looked like "nothing to recommend".

The founder answered on 2026-10-07 at 12:02:43Z. Verbatim: *"Say it couldn't be read (Recommended)"*.

## What changes

**Gateway, `insight-generator.service.ts`**
- `loadBundle` names every bundle read that rejected or answered with an error. This includes `readWholeWindow`'s over-ceiling `WholeReadError`.
- Each read is named with a house word from `BUNDLE_READ_WORDS`:

  | Table | Word |
  |---|---|
  | `wine_consumption_log` | pour history |
  | `procurement_orders` | order history |
  | `restaurant_inventory` | inventory list |
  | `pos_checks` | till checks |
  | `restaurant_tables` | table list |
  | `restaurant_venue_profiles` | venue profile |
  | `analytics_goals` | goals |

- `generate()` returns these names as `sourcesUnread`.
- A read that answered with no rows is **not** named, because an empty read is not a refused one.

**Gateway, `recommendations.service.ts`**
- The feed merges the generator's names into its own `sourcesUnread`, in the position where "insights" stood.
- "insights" is still named when `generate()` itself rejects.
- Each name appears once. "goals" is shared with the feed's own goal read.
- The web page's quiet tier (`quietTierWords`) and the weekly digest's sentence (`sourcesUnreadWords`, which reads `feed.sourcesUnread`) now print the name without any change to them.

**Web, `RecommendationsNext.tsx`**
- With nothing standing, the voice used to say "The book is clear." even when a source was unread.
- When a source is unread, it now says the engine could not read one (or N) of its sources, "so the book is not proven clear".
- The empty-state headline then speaks only of "what the engine could read".
- With `sourcesUnread` empty, the old words stand.
- With `sourcesUnread` null, the voice makes no claim that the book is clear.

**Records**
- ADR 0292: "Built" brackets on the Status, the Decision (:34), the readers-table insight row, Consequences and fork 3. A review-trail row is added for this branch.
- The four 12:04:50Z stamps are corrected in place to 12:02:43Z, with the old stamp kept. The session transcript stamps the answer 12:02:43.261Z; 12:04:50Z was a later `date -u`.
- README row 0292 gets the same bracket.
- The tech-debt.d note is updated.
- `claims.d/fix-recommendations-name-a-refused-read.jsonl` adds two static rows.

## Readings this build took

**The word.** The answer's option text named both "insights" and the read. The build uses the read's own word ("pour history"), not "insights". This is the build's reading, recorded in the ADR row; it is not a separate founder ruling.

**No `INSIGHT_GENERATOR_VERSION` bump: it stays 6.**
- Per its own comment, the version tracks what a stored sentence claims.
- No sentence changes, and no stored row carries the names.
- Only the live response gains a field, so nothing needs recomputing.
- There is nothing to renumber at merge. Open PRs hold 7 (#619), 8 (#625) and 9 (#626).

## Tests (at `0a6907af8`)

**Gateway jest:** `npx jest src/analytics src/common/read-whole-window.spec.ts` gives 58 suites and 940 tests, all passing. This includes the new `insight-unread-sources.spec.ts` (26 tests). No spec outside `src/analytics` imports the two services, except `read-whole-window.spec.ts`, which is in the run.

The new spec drives the real generator and feed through a client double that answers per table. It covers:
- each read failing, each read rejecting, and the pour and checks reads refused past the ceiling: each is named alone;
- several failures, which are listed in bundle order;
- all reads empty, which names nothing;
- `generate()` rejecting, which names "insights";
- the shared name "goals", which appears once;
- an older generator without the field, which adds nothing;
- the digest's exact sentence.

**Web vitest:** `npx vitest run src/pages/recommendations` gives 17 files and 330 tests, all passing. This includes the new three-case test in `RecommendationsNext.test.tsx`.

**tsc** shows only environmental errors, in no touched file: `@simplewebauthn/server` is missing from the shared node_modules (gateway, 2 errors in `passkeys.service.ts`), and `@simplewebauthn/browser` likewise (web, 1 error in `passkeys.ts`). Nothing else.

**Mutations.** Each was one behaviour, applied as: `cp -p` snapshot, mutate, run, restore, `cmp`. Every one went red, and every file was restored byte-identical.

| | Mutation | Result |
|---|---|---|
| B1 | no `unread.push` | the it.each cases fail |
| B2 | an empty read is named | 2 fail |
| B3 | `sourcesUnread: []` returned | many fail |
| B4 | the feed ignores the generator's names | 2 fail |
| B5 | a rejected read is not named | 1 fails |
| B6 | no dedupe | 1 fails |
| B7 | the voice says "clear" anyway | 1 web test fails |
| B8 | the headline is unchanged | 1 web test fails |
| B9 | null claims "clear" | 1 web test fails |

**Claims rows**, run by hand from the worktree root:
- Both exit 0 at this branch.
- Both exit 1 against origin/main's copies of the three files.
- Each of their nine checks was mutated once on a scratch copy and failed alone.
- An anchor left only in a comment does not satisfy them.

## Not done, or not verified

- **The new spec cannot be shown red against origin/main by import:** `BUNDLE_READ_WORDS` does not exist there. The mutations above stand in for that.
- **Still owed** (tech-debt.d note):
  - The hourly `persist` (the scheduler's `generate({categories, persist: true})`) still deletes a category's stored rows after a refused read and writes only what fired, so readers of the stored rows still see silence.
  - `getAvailability` and the consultants' evidence pack do not carry the names.
- **Still owed from #609:**
  - scrub the `WholeReadError` text;
  - 500 vs 503;
  - latency;
  - `readTillPages` / `readMonthTakings`.
- `scripts/check_decision_claims.sh` was **not run**; the coordinator runs it. Only the two new rows were run, by hand.
- **No production reads.** No browser-pane visual check of the page was done; the web change is covered by the unit test only.
- **Not audited.** A full ADR 0090 audit is owed before merge.
- **Gate ownership is not empty.** `lanecheck.sh` exits 1:
  - The six fast guards are all rc=0, and the file count is 9.
  - But `ownership` is `['.planning/decisions/README.md: removes or edits an existing line (only appended rows for ADRs this PR adds are free)']`.
  - The cause is the in-place bracket on README row 0292, which the task asked for.
  - #644 handled the same finding by restoring the row byte for byte and moving the row update to its own docs PR. If that route is taken here, the row diff is saved at `p4-scratch/sim-run/fixes/pr/adr0292-index-row.sourcesunread.diff`.
  - Dropping it leaves 8 files. The ADR 0292 brackets and the claims rows do not depend on it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
