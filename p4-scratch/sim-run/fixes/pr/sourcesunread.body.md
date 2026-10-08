TITLE: fix: name a refused insight read in /recommendations sourcesUnread (ADR 0292 fork 3)

**Branch** `fix/recommendations-name-a-refused-read`, from origin/main `ca3582988`, with origin/main `a323cc80b` merged in. Head `aaba5bac2`, 8 files against main. Local only: not pushed, not audited.

## Why

ADR 0292 (#609) made analytics reads whole-or-refuse. Inside the insight bundle, a refused or failed read left its slice empty, so every family built on that slice went silent. But `generate()` still resolved, so /recommendations listed nothing in `sourcesUnread`. The quiet tier then said every source answered, so a failed read looked like "nothing to recommend".

The founder answered on 2026-10-07 at 12:02:43Z. Verbatim: *"Say it couldn't be read (Recommended)"*.

## What changes

**Gateway, `insight-generator.service.ts`**
- `loadBundle` names every one of the seven bundle data reads that rejected or answered with an error. This includes `readWholeWindow`'s over-ceiling `WholeReadError`.
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
- The generator's two other reads are not named: `dayExclusions.load` and `actions.readState`.
  - No rule computes a figure from either. They hold the house's own rulings, which are applied to the baselines and to what fired.
  - Each already has its own flag on `generate()`'s answer (`exclusionsReadable`, `suppressionsReadable`).
  - The sentence `sourcesUnread` feeds says "entries that depend on it could not fire", which would be false of them.
- **Two insights are now gated on a second read** (the verifier's finding). Each of these insights reads a slice besides the one its family is gated on. `readWasRefused` asks whether that read's word is in `bundle.unread`. It does not look at whether the slice is empty.
  - **Per-table insights** (`computeChecksFamily`): the table "#1" (with its attribute and driver readings) and the live surge take each table's label from the table list. When the table list was refused or failed, they no longer fire. Before, they printed "Top table" and "A table". The insights built on the checks alone (the till series, the server "#1", the basket) still fire.
  - **The wine mover** (`computeConsumptionFamily`): `wine.bottles.vs_prev_period_7d` takes the wine's name from the inventory list. When that list was refused or failed, the mover no longer fires. Before, it printed the wine's raw `master_wine_id` as its name.

**Gateway, `recommendations.service.ts`**
- The feed merges the generator's names into its own `sourcesUnread`, in the position where "insights" stood.
- "insights" is still named when `generate()` itself rejects.
- Each name appears once. "goals" is shared with the feed's own goal read.
- The page's quiet tier (`quietTierWords`) now prints the name. Nothing in it changed.
- The weekly digest prints the name only in a letter that carries entries. That is its "Partial reading" line, from `sourcesUnreadWords`.

**Web, `RecommendationsNext.tsx`**
- With nothing standing, the voice used to say "The book is clear." even when a source was unread.
- When a source is unread, it now says the engine could not read one (or N) of its sources, "so the book is not proven clear". The empty-state headline then says "what the engine could read".
- When `sourcesUnread` is null (the feed did not say), the voice makes no claim that the book is clear. The headline says "Nothing stands against what the engine read." It no longer says "tonight's numbers".
- When `sourcesUnread` is empty, the old words stand.

**Records**
- **ADR 0292.** "Built" brackets are added to the Status, the Decision (:34), the readers-table insight row, Consequences and fork 3, and a review-trail row is added for this branch.
- **The 12:02:43Z correction.** The four 12:04:50Z stamps are corrected in place to 12:02:43Z, with the old stamp kept. The session transcript stamps the answer at 12:02:43.261Z; 12:04:50Z was a later `date -u`.
- **README row 0292 is not edited here.** Following #644, `.planning/decisions/README.md` is byte-for-byte origin/main's, so gate ownership is `[]`. The row update is deferred to a docs PR. Its diff is kept at `p4-scratch/sim-run/fixes/pr/adr0292-index-row.sourcesunread.diff`.
- **The tech-debt.d note** is updated, including the open product fork below.
- **`claims.d/fix-recommendations-name-a-refused-read.jsonl`** holds three static rows: the naming, the web words, and the two name gates.

## Readings this build took

**The word.** The answer's option text named both "insights" and the read. The build uses the read's own word ("pour history"), not "insights". This is the build's reading, recorded in the ADR row; it is not a separate founder ruling.

**`INSIGHT_GENERATOR_VERSION` goes from 6 to 10.**
- Its comment says to bump "whenever a change alters what a sentence CLAIMS — new withholding rules…". The two name gates are new withholding rules.
- A version-6 row written after a failed inventory read may hold a wine named by its id. Every stored reader serves that row before a fresh compute. With the bump, every version-6 row is refused once and recomputed.
- The number is 10, not 7, because other open PRs take numbers above 6. Measured at their heads on 2026-10-07: #619 holds 7, and #625 and #626 **both hold 8**. None holds 9. **The coordinator renumbers at merge**, and the two 8s need resolving too. The claim row asks for a version of at least 7 together with the comment entry, so renumbering does not break it.
- The names in `sourcesUnread` alone would not have moved the version, because no stored row carries them.

**The digest when nothing stands is not changed. This is an open product fork for the coordinator.**
- In a week where nothing stands, `recommendation-digest.service.ts` (the `standing.length === 0` branch, about `:376-405`) still sends nothing.
- The unread name then appears only in the log row's reason (*"…This empty result is therefore not proof that nothing stands."*).
- The founder's option text named only the recommendations page, so this branch leaves that behaviour as it was.
- The open question is "a letter when a source is unread and nothing stands". It is filed in the tech-debt note.

## Tests (at `9b05e4614`; `aaba5bac2` changes one comment and the ADR row, and the insights suites, the claim rows and `lanecheck.sh` were re-run there)

**Gateway jest:** `npx jest src/analytics src/common/read-whole-window.spec.ts` gives 58 suites and 946 tests, all passing. This includes `insight-unread-sources.spec.ts` (32 tests).

The spec drives the real generator and feed through a client double that answers per table. It covers:
- each read failing, each read rejecting, and the pour and checks reads refused past the ceiling: each is named alone;
- several failures, which are listed in bundle order;
- all reads empty, which names nothing;
- `generate()` rejecting, which names "insights";
- the shared name "goals", which appears once;
- an older generator without the field, which adds nothing;
- the digest's exact sentence;
- **new: the two name gates.** Each refusal case sits beside a positive control that fires with every read answered:
  - With the table list read, the table "#1" and the surge fire as "Table T1", and the server "#1" fires as "Ana".
  - With the table list failing or rejecting, no per-table insight fires and no sentence says "Top table" or "A table". The server "#1" still fires.
  - With the inventory list read, the mover fires as "Wine M1".
  - With the inventory list failing or rejecting, no mover fires and no insight names the wine "M1".

**Web vitest:** `npx vitest run src/pages/recommendations` gives 17 files and 330 tests, all passing. The ADR 0292 test now also asserts the null headline.

**tsc** shows only environmental errors, in no touched file:
- gateway: 2 errors in `passkeys.service.ts`, because `@simplewebauthn/server` is missing from the shared node_modules;
- web: 1 error in `passkeys.ts`, because `@simplewebauthn/browser` is missing likewise.

**`lanecheck.sh wt-fix-sourcesunread` exits 0.** The six fast guards are all rc=0, `files=8`, and `ownership` is `[]`.

**Mutations.** Each was applied as: `cp -p` snapshot, mutate, run, restore, `cmp`. Every one went red, and every file was restored byte-identical.

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
| G1 | the table "#1" gate removed | 2 fail |
| G2 | the surge gate removed | 2 fail |
| G3 | the mover gate removed | 2 fail |
| G4 | the whole checks family gated on the table list (over-broad) | 2 fail |
| W1 | the null headline says "tonight's numbers" | 1 web test fails |

B1–B9 were run at `0a6907af8`. G1–G4 and W1 were run on this head's code.

**Claims rows**, run by hand from the worktree root:
- All three exit 0 at this branch.
- All three exit 1 against origin/main's copies of the three files.
- Each of their seventeen checks was mutated once on a scratch copy, and each failed alone.
- An anchor left only in a comment does not satisfy them.

## Not done, or not verified

- **The new spec cannot be shown red against origin/main by import:** `BUNDLE_READ_WORDS` does not exist there. The mutations above stand in for that.
- **The mover's id fallback after a read that succeeded is not gated.**
  - The fallback is `nameByWine.get(wineId) || wineId`, and `i.wine_name || i.master_wine_id`.
  - The inventory list is read with `is_active = true`, so a wine whose inventory row was deactivated still has its id printed as its name.
  - The gate covers only a refused or failed read. This is named in the tech-debt note.
- **Still owed** (tech-debt.d note):
  - The hourly `persist` (the scheduler's `generate({categories, persist: true})`) still deletes a category's stored rows after a refused read and writes only what fired, so readers of the stored rows still see silence.
  - `getAvailability` and the consultants' evidence pack do not carry the names.
- **The digest's quiet week** is the open fork above.
- **Still owed from #609:**
  - scrub the `WholeReadError` text;
  - 500 vs 503;
  - latency;
  - `readTillPages` / `readMonthTakings`.
- **`scripts/check_decision_claims.sh` was not run**; the coordinator runs it. Only this lane's three rows were run, by hand.
- **No production reads.** No browser-pane visual check of the page was done; the web change is covered by the unit test only.
- **Prettier.** The web files were not reformatted, because origin/main's copies are not Prettier-clean either. The new gateway spec was reformatted.
- **Likely conflict with #625** (`fix/hidden-tables-leave-insights`). Its diff touches `computeChecksFamily`'s table blocks and the version line, the same places this branch gates. Whichever PR merges second resolves the conflict.
- **Not audited.** A full ADR 0090 audit is owed before merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
