## Last call (final say) at `6a572b195`: HOLD

`origin/main` is `8e16fbcef`, fetched at the last call, and the branch already contains it. The worktree is clean. The code is ready. One record on this branch is not, and it changes how this PR can be merged.

**The blocking item: the README row makes this PR gate-owned.**
- `6a572b195` edits the existing 0281 row of `.planning/decisions/README.md` (line 203 on `main`).
- `origin/main`'s classifier gives `ownership_between(worktree, "origin/main", "HEAD")` = `[".planning/decisions/README.md: removes or edits an existing line (only appended rows for ADRs this PR adds are free)"]`. That is the only reason. At `c70f86b42`, one commit earlier, it returns `[]`.
- An owned PR is escalated before any model call, both by the CI "PR Audit Gate" and by the audit skill's step 4. No PASS can authorize it.
- So the three-role audit can never run at this head. That includes `c70f86b42`, the fix for the `fe0f31f4d` BLOCK. The founder's merge rule needs that audit: "A fix PR merges only after the ADR 0090 three-role audit passes and CI is green."
- The lane rules also forbid editing an existing README row on this branch.
- The founder's own option text put the line somewhere else: "One-line docs change saying the repair ran with an undo (merged #647), in a small docs PR."

**Owed before this PR is pushed (a fixer round, new commits only, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`):**
1. Put the 0281 row back exactly as `origin/main` has it, in a new commit. `git diff origin/main HEAD -- .planning/decisions/README.md` must then be empty, and `ownership_between` must return `[]`. The PR drops to 10 files. ADR 0281, the claims shard and the tech-debt fragment do not mention the row, so nothing else changes.
2. The coordinator files the row update as its own one-line docs PR, as the founder's option text says. That PR escalates by itself, which is expected, and the founder's "Yes, update it (Recommended)" is the word for it.
3. Owed by the `fe0f31f4d` adjudication ("owed on the same branch or tracked") and still neither: the cross-process row interleave. The module's "TWO IMPORTS AT ONCE" comment and ADR 0281's "what can happen is bounded" list give three outcomes and read as the whole set. The review found a possible fourth: two processes each win a different subset of a note's rows with the same-rank title and different `checkKeys`, the `older` filter skips equal titles, and one import's checks drop out of the count. The adjudication judged it uncertain: under READ COMMITTED, one `UPDATE … WHERE id IN (…) AND title = …` re-checks the title, or the statement deadlocks and the update error writes a new note. It is count-only either way. Add it to the list as an uncertain case, reasoned and not run (bracketed and dated, in the ADR and the comment), or file it in the tech-debt fragment. Do not leave the list reading as complete.
4. Re-run before pushing: the two specs, `check_decision_claims.sh`, `check_adr_numbers_unique.py`, `check_no_conflict_markers.py`, and `ownership_between` (must be `[]`). Then re-run the trial merges with #618 and #582 and bring this body up to date: drop the README row from "ADR and CLAIMS touched" and give the file count as 10.

If the founder would rather keep the row on this PR, that is his call. He would then be merging `c70f86b42` on his own word, with no model audit at the new head. Ask him before pushing; do not default to it.

## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03)

#603 (ADR 0281, merged as `2b6782291`; A-007, A-009, A-029 and A-041 are in that ADR's keywords) made the POS import say what it did. Under the founder's ruling F4, it also refuses a check whose closing time is not a strict ISO-8601 instant, such as `03.10.2026`. For a refused check nothing is written: no `pos_checks` row, no stock and no consumption.

The refusal was said only in the HTTP response, and nobody reads that when a till posts by webhook. An owner whose till exports dotted dates would lose those sales and that stock with no word anywhere they look.

No analytics-walk A-id belongs to this lane alone; it closes the gap F4 opened. It changes no Tuzlu figure, and no refusal count was measured on Tuzlu's data.

## What changed and why

The note's code is in `apps/api-gateway/src/pos-hub/refused-checks-note.ts`.

`pos-hub.service.ts` gets small additions:
- the two services are injected `@Optional()`;
- refused checks are collected in the loop;
- there is one call after the loop;
- `bellNote` is added to both returns.

The rest of the wiring:
- `pos-hub.module.ts` imports `AreaRoutingModule`, which imports only the database, so it joins no cycle.
- `pos-hub.controller.ts` trims `bellNote` on both import routes.
- `notifications.service.ts` gains one option, `pushData`.

**One note per import that refused a check, to the owners and managers only.**
- **When.** `ingest()` calls `fileRefusedChecksNote` once, after its loop, and only when it refused at least one check. An import that refuses nothing files nothing and reads nothing for a note.
- **Who.** The house's active owners and managers, read from `user_restaurant_access` (this house, `is_active`). The role match ignores case and surrounding spaces. The note is written with `onlyUserIds`, which the funnel intersects with the house's members, so staff and other houses are never told. No role is read from the legacy `users` row (ADR 0088).
- **Away (ADR 0218).** `AreaRoutingService.route` runs over those people. Anyone Away today is set aside and counted in `heldAway`. If every owner and manager is Away, the owners get the row only, with no push and no live ping.
- **The words.** The title is the founder's own example, `3 checks not imported: date not readable`, and names no field. The body names:
  - the till;
  - the first value the till sent, cut at 40 characters;
  - at most 10 check ids, each cut at 40 characters, then `and N more`;
  - how to write the closing time (`2026-10-03 21:00`).
- **Where it points.** Type `pos_import_refused`, link `/connections`, group key `pos_import_refused:<till>`. The web bell files it under "Point of sale" (`nt-format.ts:121`, #645).
- **Why the funnel and not a producer.** Producers run on a sweep and claim events in the producer ledger. A refused import is an event inside a request, so the note is written through `persistForRestaurant`, as the `delivery_item_to_name` note in `procurement.service.ts` is. Away and quiet hours use the same functions the producers use: `AreaRoutingService.route` and `isWithinQuietHours`.

**One note per till per hour (F5), each check counted once.**
- **Counting into the open note.** A refusal is counted into this house's open note for the same till when that note was first written less than 60 minutes ago. Every row of it, `unread`, `read` or `archived`, takes the new count and words and returns to unread, an archived row too ("Bring it back"). Nothing is inserted, so there is no second push and no live ping.
- **The hour.** `created_at` never moves, so the hour runs from the first write ("Sliding hour" was rejected). After the hour, a new note and its push are written.
- **Distinct ids.** The count is of distinct check ids, compared by a key: the first 16 hex characters of the SHA-256 of the id as sent (`checkKey`). Re-running a CSV with 3 bad checks still reads `3 checks not imported: date not readable`.
- **The bounds.** A note keeps at most 500 keys (`MAX_NOTE_KEPT_CHECKS`) and names the first 10. 500 is a chosen figure, not a measured one. Once a note has counted more ids than it keeps, an id it does not keep may already be counted. An import that brings one makes the count the floor it can prove, said as `At least N … and at least N more`.
- **A check with no id** (empty, or only spaces) is never merged with another. It is counted every time, never named, and the message says so.
- **A re-send that adds no check writes nothing.** No row turns unread or leaves the archive ("No, stays as it is").
- **Deleted rows.** A deleted row stays deleted while another recipient holds a row of the note ("Stays deleted"). When every row is deleted, the next refusal in the hour writes a new note with only its own checks and pushes it ("New note at once").
- **People added or removed in the hour.** An owner or manager added during the hour gets no row of the open note; the next note reaches them. One removed or demoted keeps their row updating until the hour ends.

**Races.**
- A new note is up to three writes: the pushed rows, the quiet rows, and the rows of people whose switch is off. They share a `metadata.noteId`.
- Inside one process, filing is queued per house and till. Across processes, the update is a compare-and-set on the title, which carries the count and its rank (`noteRank`). The loser reads again; after a second loss it writes a new note.
- Rows left at an older count are brought up by a second compare-and-set on title and status, so an older count never lands over a newer one.
- If the open note cannot be read or updated, a new note is written and `caveats` says so. The refusals are never dropped.
- No lock or index was added; either would need a migration. (The possible fourth race outcome is under the HOLD, item 3.)

**Quiet hours, the push switch and unreadable settings.**
- **Quiet hours (F6).** Each recipient's preferences are read with `getPreferences` and judged with `isWithinQuietHours` on the house's clock (`houseFrame`, ADR 0207). Inside the window, the person gets the row at priority `low` with `broadcast: false`: in the bell, with no push and no live ping ("Quiet means quiet").
- **The push switch.** A person whose `push` reads literally `false` gets the same treatment as quiet hours and is counted in `pushSwitchedOff` ("Respect their switch"). `push` comes from `notification_preferences.push_enabled ?? true` (`notifications.service.ts:1180`, and `true` with no row at `:1224`).
- **What is checked first.** A failed read first, then the switch, then quiet hours.
- **Unreadable settings push ("Push anyway").** When the house's zone cannot be read, quiet hours are not judged and everyone whose switch is on is pushed. When one person's preferences cannot be read, that person is pushed. Either case is logged and named in `caveats`.

**The import answers on time.** The import waits at most `NOTE_DEADLINE_MS` (3 s) for its note. When the note is late, the import answers `filed: false`, logs `POS_REFUSED_CHECKS_NOTE_LATE`, and lets the filing finish. A filing holds the next one for the same house and till for at most 3 s.

**What leaves the house.**
- The phone push's `data` carries only the type, the link, the note's id and its count (`pushData`). Before this, the funnel spread the whole metadata into it. The push's title and body are the note's own words, check ids and the till's value included ("Full text, as built").
- **Both import routes return `bellNote: { filed }` only**, or null when nothing was refused (`bellNoteForTill`).
  - The webhook did so before. A legacy `POS_HUB_WEBHOOK_SECRET` signs the body alone and binds no house.
  - Since `c70f86b42`, the file import route (`POST /pos-hub/import/:restaurantId`) does the same. It checks the house but no role, so any member could otherwise learn how many owners and managers were Away, quiet or had push off ("Only 'the bell was rung'").
  - The whole note stays in `ingest()`'s result and the server's log lines. No new channel carries it.
- `notFiledBecause` and `caveats` are fixed phrases. A database's own message goes to the log only.

**Filing never fails or undoes the import.** `fileRefusedChecksNote` does not throw. A note that is not filed reads `filed: false` and logs `POS_REFUSED_CHECKS_NOTE_NOT_FILED`. A failed read is said as a failed read, never as "nobody to tell" (ADR 0067, in spirit). `errors[]` still names checks only.

**Files (11 at `6a572b195`; 10 once the README row is put back):**
- `refused-checks-note.ts` (new) and `pos-hub.refused-checks-note.spec.ts` (new);
- `pos-hub.service.ts`, `pos-hub.module.ts`;
- `pos-hub.controller.ts` and its spec;
- `notifications.service.ts`;
- ADR 0281;
- `claims.d/fix-pos-import-refusals-ring-the-bell.jsonl` (new);
- `tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md` (new);
- `.planning/decisions/README.md` (the 0281 row; to be put back, see the HOLD).

## Tests, guards and harness

**The last call's own runs, at `6a572b195`.** The worktree was clean before and after.
- `jest pos-hub.controller.spec.ts pos-hub.refused-checks-note.spec.ts --runInBand --forceExit`: 2 suites, **91/91** (22 controller, 69 note).
- `check_decision_claims.sh`: **887 checked, 887 holding**.
- `check_adr_numbers_unique.py`: this ref introduces no ADR number; next free 0305.
- `origin/main`'s `pr_audit_gate.ownership_between`: one reason at `HEAD` (the README row); `[]` at `c70f86b42`.
- Open PRs sharing a file, from `gh pr list` (75 open) and `gh pr view N --json files`: under "Merge-order notes".

**The independent verify of `6a572b195`: PASS, five minor issues.** Its runs:
- **Jest.**
  - controller, note and sale-time specs: 3 suites, 158/158;
  - `src/pos-hub`, `src/notifications` and `src/areas`: 43 suites, 785/785. This includes `notification-text-is-plain`, `notification-senders-are-closed` and `notifications-are-tenant-scoped`;
  - the other users of `PosHubService` (simpos, beverages, read-errors-are-not-silence): 6 suites, 107/107.
- **Fails before.** With `fe0f31f4d`'s `pos-hub.controller.ts`, the controller spec has 2 failed and 20 passed. The two failures are the new import-route cases; the null case pins behaviour that did not change. The file was restored and `cmp` matched.
- **Mutations.** Setting `ingest()`'s `refusedChecks.length > 0` gate to `true` gives 1 failed, 283 passed. Eight mutations of `refused-checks-note.ts` each fail the note spec (failures out of 69):
  - the owner/manager filter dropped: 29;
  - the audience's `restaurant_id` filter dropped: 25;
  - inactive rows included: 33;
  - the named ids unbounded: 4;
  - the 60-minute window ignored: 3;
  - archived rows not brought back: 4;
  - the quiet group written at `high`: 9;
  - `broadcast` always true: 11.
- **Claims.** The 8 rows of the shard exit 0. With `fe0f31f4d`'s controller, `…-PUSH-DATA-AND-WEBHOOK-ANSWER` exits 1.
- **Typecheck and lint.** `tsc --noEmit -p tsconfig.spec.json`: only the 2 known `@simplewebauthn/server` TS2307 errors in `passkeys.service.ts`. `eslint` on the 7 touched gateway files: 0 errors and 12 prettier warnings, all in `notifications.service.ts` on lines this PR does not touch.
- **Guards, all exit 0:**
  - with `--self-test` too: `check_read_errors_not_swallowed`, `check_web_reads_gateway_dto_keys`, `check_adr_numbers_unique`, `check_od_ids_exist`, `check_citation_pairing`;
  - without: `check_read_columns_exist`, `check_queried_tables_exist`, `check_route_exposure`, `check_no_conflict_markers`, `check_flag_readby_anchors`, `check_migration_order`, `check_test_scripts_are_real`;
  - `check_decision_claims.sh` (887/887) and `test_check_decision_claims.sh` (31 ok).
- **Boot.** `check_gateway_boots.sh` cannot run in a worktree, which lacks `@simplewebauthn/server`. As a substitute, the verifier compiled the real `AppModule` in a temporary jest spec with that one module mocked as virtual. `PosHubService`'s `notifications` and `areaRouting` both resolved, so the `@Optional()` injections are not silently undefined. The spec was deleted afterwards.

The five issues: the trailer, the README row, the interleave, the boot script and the overlap. The first three are under the HOLD and "Merge-order notes". The last two are above and below; neither comes from this branch.

**The builder's runs at `6a572b195`:**
- `src/pos-hub` + `src/notifications`: 41 suites, 721/721.
- `tsc --noEmit`, with both `tsconfig.json` and `tsconfig.spec.json`: only the `@simplewebauthn/server` lines.
- `eslint` on the three touched TS files: exit 0.
- The claims row `…-PUSH-DATA-AND-WEBHOOK-ANSWER` exits 0 here. It exits 1 at `fe0f31f4d`, at `e6227de5a`, and on `origin/main` `8fdb819b4` and `8e16fbcef`.
- 9 mutations each exit 1 and 2 controls exit 0, in scratch copies, never in the worktree:
  - the mutations return the whole note or `{ ...result }`, spread the result over the trimmed note, restore `fe0f31f4d`'s return, return early on a flag, use the wrong source, add a third raw route, make `bellNoteForTill` pass every field, or have the webhook return the whole note;
  - the controls are a comment quoting the old return, and the call on one line.

**Earlier rounds** (code paths unchanged since, apart from the import route):
- **Fork 5** (count each check once) at `cee659a0b`. With `c84faf084`'s note file, 9 of 55 fail. 31 claims mutations each exit 1, and 3 controls exit 0.
- **The push switch** at `8e67745ac`. With `d728b6e2b`'s note file, 34 of 69 fail. Six of those fail on what was pushed; the rest fail on the result's new `pushSwitchedOff` field or on reworded caveats. 32 claims mutations each exit 1, and 3 controls exit 0. That round's verifier ran 55 suites, 1151/1151, across `src/pos-hub`, `src/notifications`, `src/areas` and `src/team`.
- **With `e6227de5a`'s three code files**, 18 of 67 fail. They cover:
  - archived rows not brought back;
  - an older count landing over a newer one;
  - a hung write holding the import;
  - push data carrying the metadata;
  - the webhook getting the whole note;
  - database text in `caveats`.
- **The sliding-hour case** fails when the update also sets `created_at`.
- **Wider suites** at fix round 1: 102 suites, 1785/1785. The builder's first build: 220 suites, 4362 passed and 3 skipped.
- **Boot.** `check_gateway_boots.sh` returned BOOT_OK at the first build, with a `NODE_PATH` stub for `@simplewebauthn/server`. The verifier of `d728b6e2b` booted the `AppModule` by hand: BOOT_OK.

**Local Postgres harness:** not applicable. The branch changes no SQL and no migration, so nothing was appended to `audits/bellnote-local-pg.txt`.

## ADR and CLAIMS touched

- **ADR 0281** (Proposed), amended in place. The "Amended 2026-10-05: refused checks reach the bell" section holds:
  - every founder answer below, verbatim;
  - "Each check counted once", with why 500 and 16 characters, and what was rejected;
  - the quiet-hours and push-switch bullets;
  - "The import route's answer".

  Every sentence a later answer made stale is bracketed in place and dated. That includes "none is open", the whole-note import result, and the F2 sentences #647's production run overtook (round 4 of `audits/prod-dryruns-2026-10-05.md`: 10,684 rows in one run at 22:30:11Z; that file is outside the repo). The review trail has this branch's rows.
- **`claims.d/fix-pos-import-refusals-ring-the-bell.jsonl`** (new), 8 rows, all `resolved`:
  - `TD-2026-10-05-POS-REFUSED-CHECKS-RING-THE-BELL`;
  - `…-NOTE-ONE-PER-TILL-PER-HOUR` (also pins "New note at once" and "No, stays as it is");
  - `…-NOTE-QUIET-HOURS-ROW-ONLY`;
  - `…-NOTE-ANSWERS-ON-TIME`;
  - `…-NOTE-PUSH-DATA-AND-WEBHOOK-ANSWER` (both routes trim, since `c70f86b42`);
  - `…-NOTE-FIXED-PHRASES`;
  - `…-NOTE-COUNTS-EACH-CHECK-ONCE`;
  - `…-NOTE-PUSH-SWITCH-RESPECTED`.
- **`tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md`** (new), two OPEN entries, filed and not fixed here:
  - every funnel note except the till-refusal note, the team broadcast and the Away release still pushes people whose switch is off (`notifications.service.ts:805-822`);
  - the Away ladder's `readRole` does not trim the role the note's filter trims (`area-routing.service.ts:235-238`). It cannot happen while `user_restaurant_access_role_known` holds.
- **`.planning/decisions/README.md`**: the 0281 row is edited at `6a572b195`. It is to be put back and moved to its own docs PR (the HOLD).
- No OPEN-DECISIONS row is added, and no ADR whose metadata names the audit gate is touched.

## The founder's answers (2026-10-05, AskUserQuestion, relayed by the fix-lane coordinator), verbatim

- **How refused checks reach the owner:** **"Bell note, follow-up PR (Recommended)"**. "#603 merges as is. A small follow-up files one owner/manager bell note per import with refusals ('3 checks not imported: date not readable'), with the check ids. Cost: about 4–6 files, its own audit." **Built.**
- **F5:** **"One note per till per hour (Recommended)"**. "Later refusals in the same hour are counted into the open note. A file import still gets one note. Cost: one read of the open note before each write, about 1-2 more files." **Built.**
- **F6:** **"Push outside quiet hours (Recommended)"**. "Inside a person's quiet window they get the bell row only, no push. Cost: reading each recipient's preferences and the house's zone per note." **Built.**
- **F7:** **"Own group, small web PR (Recommended)"**. "Add a register for pos_import_refused in nt-format.ts, a one-file follow-up with its own audit." Built elsewhere: #645, merged as `155960b59`.
- **ADR 0281 F2:** **"Dry run, then your yes (Recommended)"**. "I build a read-only count of the rows a re-date would change (by house and day shift), show it to you, and nothing is written until you say yes." Built elsewhere: the write is #647, merged as `8e16fbcef`.
- **Archived row:** **"Bring it back (Recommended)"**. "The archived note returns to their bell as unread with the new count, so someone who cleared '3 refused' still learns it is now 9. Cost: about 1 file plus a test." **Built.**
- **Rhythm:** **"One push per hour, re-flagged (Recommended)"**. "As built: one push per clock hour from the first note. A note that grows turns unread again, so the bell shows it is news." **Built and pinned.**
- **Quiet hours:** **"Quiet means quiet (Recommended)"**. "As built: the row waits in the bell with a normal mark, no urgent badge and no live pop-up on an open web page." **Built.**
- **Re-sent check:** "Bell note for refused till checks: if the till re-sends a check that is refused again (e.g. someone re-runs the same CSV), how should the note count it?" **"Count each check once (Recommended)"**. "The note counts distinct checks in its hour: re-running a CSV with 3 bad checks still reads '3 checks not imported', not 6. Past a cap it says 'at least'. Cost: about 1 file plus tests; not built yet." **Built.**
- **Unreadable quiet hours:** "When the system cannot read someone's quiet hours (the house's time zone is missing, or that person's settings fail to load), should the refused-checks note still push to their phone?" **"Push anyway (Recommended)"**. "As built. This note is the only place refused till checks are reported, so a failed settings read should not turn into silence. Risk: someone in quiet hours may get one push." **Built.**
- **Push text:** "The phone push and the web's live pop-up for this note: should they carry the check ids and the till's value, or a shorter text?" **"Full text, as built (Recommended)"**. "The push says the note's own words, including check ids and the till's value, like every other bell note does. Your first answer asked for the note 'with the check ids'." **Built.**
- **Deleted row:** "If someone deletes the refused-checks note from their bell, and more refusals arrive within the same hour, what happens?" **"Stays deleted (Recommended)"**. "As built. Deleting is deliberate (your 'Bring it back' answer was about archiving). The next hour's note still reaches them." **Built**, while another recipient holds a row (see "New note at once").
- **Added in the hour:** "An owner or manager is added to the house during the hour a refused-checks note is open. Should they get that open note?" **"Next note reaches them (Recommended)"**. "As built. They get no row of the open note; the next note, at most an hour later, reaches them. No extra read per import." **Built.**
- **Removed in the hour:** "An owner or manager is removed or demoted during the hour a refused-checks note is open. Should their copy of the open note still update?" **"Updates until the hour ends (Recommended)"**. "As built. Their existing row keeps counting (and comes back if archived) until the hour ends; the next note does not reach them. It shows only what they already saw." **Built.**
- **Every row deleted:** "Till-refusal note: every owner/manager deleted this hour's note, then the till refuses more checks in the same hour. What happens?" **"New note at once (Recommended)"**. "As built: a fresh note with only the new refused checks, pushed to owners/managers (including whoever deleted the old one). Refused checks are never left unreported. Cost: none." **Built and pinned.**
- **Unchanged re-send:** "The till re-sends checks the note already counts (count unchanged). Should the note turn unread again?" **"No, stays as it is (Recommended)"**. "As built: a read note stays read, an archived one stays archived. Matches your earlier rule that a note turns unread when its count grows: an unchanged count is not news." **Built and pinned.**
- **Push switch:** "An owner or manager switched push off in their settings. Should this till-refusal note still push to their phone?" **"Respect their switch (Recommended)"**. "Not built yet: they get the note in their bell only, no phone push, like quiet hours. About 3 lines + a test before merge. Other notes still ignore the switch today (separate, known fix)." **Built** in `f26eca63f`; the funnel-wide fix is filed in tech-debt.
- **Import route's answer:** "When someone uploads a till CSV (the import route) and checks are refused, the answer now also says how many owners/managers were set aside as Away, are in quiet hours, or have push switched off. Any house member, staff included, can run an import. Who should see those counts?" **"Only 'the bell was rung' (Recommended)"**. "The import answer says only whether owners/managers were told, the same as the till webhook already does. Nobody learns anyone's quiet hours or push setting from it. About 2 lines + a test." **Built** in `c70f86b42`. Rejected:
  - "Counts to owners/managers only";
  - "Everyone sees the counts, as built".
- **README row** (answer 2 in `briefs/f2redate.md`): "The decisions index line for ADR 0281 still says the repair of old POS rows 'waits on the founder'. It is now done. The index rule says changing an existing line needs your word. Update it?" **"Yes, update it (Recommended)"**. "One-line docs change saying the repair ran with an undo (merged #647), in a small docs PR." **Built on the wrong vehicle**: it sits on this PR, not a small docs PR. It is to be moved (the HOLD).

## Forks deferred

None open in this lane. Every fork the branch raised has been answered and quoted above and in ADR 0281.

Two items belong to other branches:
- The funnel-wide push-switch fix. It includes what a failed preferences read should do there, a product question for that branch, since "Push anyway" was answered for this note only.
- Whether the README row may stay on this PR. That is a merge question the coordinator puts to the founder (the HOLD, last paragraph), not a product fork.

## Merge-order notes

- **Base.** `main` was last merged at `8e16fbcef` (#647) in `b5be681cc`, with ADR 0281 resolved hunk by hunk, keeping both lanes' text. The PR has 11 files, 10 once the README row is put back, within the 15-file cap. That is over the brief's "≤ 6" and the founder's "about 4–6 files". The extra files come from the `e6227de5a` review's findings (the webhook answer, the push data) and from the records the `fe0f31f4d` review asked for.
- **History.** The branch was cut from #603's head before #603 was squash-merged, so its log still lists #603's pre-squash commits. The diff against `origin/main` is the 11 files above. No history was rewritten.
- **Pushed state.** #644 on `origin` still points at `fe0f31f4d`. `b5be681cc`, `c70f86b42` and `6a572b195` are not pushed.
- **Open PRs sharing a file** (75 open, read at the last call):
  - **#618** (`feat/a-check-carries-its-channel`, `82890ebb7`) edits `pos-hub.service.ts` and the README. The verifier's trial merge at `6a572b195` auto-merges `pos-hub.service.ts`. Its conflicts, README (its 0302 row against `main`'s 0291 row) and `scripts/sql_outside_migrations.txt`, are the same as against `origin/main` alone.
  - **#582** (`fix/phone-feed-no-money-for-staff`, `1c8c93581`) edits `notifications.service.ts` in other hunks. The trial merge is clean.
  - **22 more open PRs touch the README**, adding their own rows: #533, #566, #577, #589, #596, #598, #609 to #617, #619 to #622, #626, #627 and #646. With the 0281 row put back, this branch leaves the README untouched.
- **No stacking.** Nothing here needs another open branch's code. The PR can merge before or after #618 and #582.
- **Squash message.** Build it from this body, with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Three commits carry something the squash must not repeat:
  - `897705e98`'s body calls the 500 bound "measured";
  - `3506871d5`'s body says its probes ran "on scratch copies", but they ran in place with the original put back;
  - `6a572b195`'s trailer reads "Claude Opus 5.5".

  None is rewritten.

## Not covered (said plainly, CLAUDE.md §0.5)

- **The HOLD items above are not done:** the README row, the interleave record and the re-runs. The last call writes no code or records on the audited branch.
- **No model audit has seen `b5be681cc`, `c70f86b42` or `6a572b195`.** The last BLOCK was at `fe0f31f4d`. These commits rest on the builder's runs, the independent verify and this last call. CI has not run on them, because nothing is pushed.
- **Stubs only.** The bell write, the open note's read and both compare-and-sets ran against stub clients, never a real database or PostgREST. Push delivery and the web bell's rendering were not checked on a device.
- **Cross-process races are reasoned, not run.** The spec simulates another process with a stub hook. Two processes adding the same re-sent ids, and the cross-row interleave (HOLD item 3), were not run.
- **"Only a literal `false` is off" is pinned by a claims row, not by jest.** Changing `=== false` to `!== true` passes all 69 cases. The real `getPreferences` always returns a boolean, so behaviour is the same today.
- **Gaps that are logged but not said in `caveats`:**
  - a partly failed write: if the pushed group writes no rows while another group writes some, the result is `filed: true` with a smaller `recipients`;
  - an unreadable Away register: the note goes to every owner and manager, and `AreaRoutingService` logs it.

  Both are stated in the ADR and the doc comment.
- **A thrown open-note read is not a fallback.** It ends as "not filed: the bell write failed". supabase-js returns errors rather than throwing in normal use.
- **The second compare-and-set's error caveat has no test.**
- **Not measured:**
  - the 500 bound, against any till, Tuzlu's included;
  - the 3 s deadline, against any till's webhook timeout;
  - the open-note read's query plan. It filters on `restaurant_id`, `type`, `group_key`, `status` and `created_at`, and no composite index was added.
- **No push when a quiet window ends.** An import has no later sweep, so the row waits in the bell, unread.
- **The webhook's own `catch`** still returns `error.message`. This is pre-existing and not changed here.
- **Not read:**
  - whether production signs with a scoped or the legacy webhook secret;
  - production's replica count;
  - production's `user_restaurant_access_role_known` constraint, which was read in the migration only.
- **The funnel-wide push switch is filed, not fixed.** Of the 25 `persistForRestaurant(` call lines, only the two `skipMobilePush` callers and this note were read for a switch check.
- **"About 3 lines" for the push switch became more:** a third write group, a `pushSwitchedOff` count, a switch read when the zone cannot be read, reworded caveats, and 11 spec cases.
- **The brief's producer pattern was not followed literally.** The reason is under "What changed and why".
- **`.planning/08-softwares/pos-bridge.md` is not edited.** Its line 247 says only that a refused check is "refused and said".
- **`check_gateway_boots.sh` has never run in a worktree.** Its substitutes are a stubbed boot (BOOT_OK, twice) and the verifier's compiled `AppModule`. CI is the first real run.
- **Nothing was measured on Tuzlu's data, and no production read or write was made by this lane.** The F2 figures are cited from the coordinator's read-only round 4.
- **Kept for the record.** The previous body, with every round's runs in full, is saved as `pr/bellnote.6a572b195.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
