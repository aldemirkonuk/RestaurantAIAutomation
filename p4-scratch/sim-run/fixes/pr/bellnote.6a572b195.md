## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03)

#603 (ADR 0281, merged as `2b6782291`; A-007, A-009, A-029 and A-041 are in that ADR's keywords) made the POS import say what it did. Under the founder's ruling F4, it also refuses a check whose closing time is not a strict ISO-8601 instant, such as `03.10.2026`. For a refused check nothing is written: no `pos_checks` row, no stock and no consumption. The refusal was said only in the HTTP response, and nobody reads that when a till posts by webhook. An owner whose till exports dotted dates would lose those sales and that stock without a word anywhere they look.

No analytics-walk A-id belongs to this lane alone. It closes the gap F4 opened. It changes no Tuzlu figure, and no refusal count was measured on Tuzlu's data.

## Audit fix (2026-10-05, after the fe0f31f4d BLOCK)

Head `6a572b195`. Three commits on `fe0f31f4d`; nothing pushed.

- **`b5be681cc`, merge of `origin/main` `8e16fbcef` (#647, F2's re-date).** It conflicted in ADR 0281 only. Resolved hunk by hunk, keeping both sides and letting later truth win: #647's "Revisit when" line, then this branch's amendment, then both lanes' trail rows, then #647's "Amended 2026-10-05: F2" and "Fork 1 and fork 2, answered".
- **`c70f86b42`, the file import says only whether the bell was rung.** `importChecks` in `pos-hub.controller.ts` now returns `bellNote` through `bellNoteForTill`, as `webhook` does: `{ filed }` only, or null when nothing was refused. Neither route returns `recipients`, `heldAway`, `quietHours`, `pushSwitchedOff`, `notFiledBecause` or `caveats` any more. They stay in `ingest()`'s result and in the server's log lines, and no new channel carries them.
  - `pos-hub.controller.spec.ts`: the case "the signed-in import keeps the whole note" is replaced by three. The file import's `bellNote` has the one key `filed` and nothing of the note appears in the answer; a note not filed reads `{ filed: false }`; null when nothing was refused.
  - `refused-checks-note.ts`: comments only, saying both routes trim.
  - Claims row `TD-2026-10-05-POS-REFUSED-NOTE-PUSH-DATA-AND-WEBHOOK-ANSWER` now pins both routes, corrected in place. The controller calls `ingest` exactly twice; `importChecks` calls it once, as `const result = await this.posHub.ingest(restaurantId, "csv_import", payload)`, and has one return, `{ ...result, bellNote: bellNoteForTill(result.bellNote) }`.
- **`6a572b195`, the records.**
  - ADR 0281 gains "The import route's answer", with the question, pick, option text and both options not picked, verbatim. The sentences the review named, "none is open" (`:92`), "Not covered by an answer" (`:274`) and the whole-note import result (`:189`) at `fe0f31f4d`, are each bracketed in place, dated 2026-10-05. So are the webhook bullet, the not-filed and deadline sentences, and the tests list. The F2 sentences #647's production run made stale are bracketed too, with round 4 of `audits/prod-dryruns-2026-10-05.md`: 10,684 rows in one run at 22:30:11Z, each house and kind equal to the dry run's, none later, none undone. One trail row and two keywords are added.
  - `decisions/README.md`, the 0281 row only. It no longer says the F2 repair waits on the founder: the repair ran with an undo (#647, migration `old_pos_rows_carry_their_check_date`, 10,684 rows on production). It also names the bell amendment. It is still one line.
  - `tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md` (new) files two OPEN entries, not fixed here:
    - the funnel's fan-out (`notifications.service.ts:805-822`) still pushes people whose push switch is off;
    - the Away ladder's `readRole` (`area-routing.service.ts:235-238`) does not trim a role that the note's own `isOwnerOrManager` (`refused-checks-note.ts:572-576`) trims. It cannot happen while `user_restaurant_access_role_known` holds.

**The founder's answers this fix rests on (AskUserQuestion, relayed by the fix-lane coordinator), verbatim.**
- **The import route's answer** (2026-10-05, between 22:33Z and 23:06Z). Q: "When someone uploads a till CSV (the import route) and checks are refused, the answer now also says how many owners/managers were set aside as Away, are in quiet hours, or have push switched off. Any house member, staff included, can run an import. Who should see those counts?" A: **"Only 'the bell was rung' (Recommended)"**. Option text: "The import answer says only whether owners/managers were told, the same as the till webhook already does. Nobody learns anyone's quiet hours or push setting from it. About 2 lines + a test." Rejected: "Counts to owners/managers only" ("Owners and managers running an import see the counts; staff see only 'the bell was rung'. Needs the caller's role on that route: a few more lines + tests.") and "Everyone sees the counts, as built" ("Any member who imports learns how many owners/managers are Away, quiet or have push off right now. In a one-owner house that is that person's own setting.").
- **The README row** (answer 2 in `briefs/f2redate.md`, after the #647 merge, about 23:07Z). Q: "The decisions index line for ADR 0281 still says the repair of old POS rows 'waits on the founder'. It is now done. The index rule says changing an existing line needs your word. Update it?" A: **"Yes, update it (Recommended)"**. Option text: "One-line docs change saying the repair ran with an undo (merged #647), in a small docs PR."
  - **Not as the option text said:** the line is on this PR, not a small docs PR of its own. The fix-lane coordinator placed it here. It is still one line in that one row, and the PR's other changes do not depend on it.
  - The row is an existing README line, so the ownership scan names it: `ownership_between(…, 8e16fbcef, HEAD)` reports exactly one reason, ".planning/decisions/README.md: removes or edits an existing line". The founder's answer above is the word for that edit.

**Tests and checks, at `6a572b195` (worktree clean).**
- `pos-hub.controller.spec.ts` with `fe0f31f4d`'s `pos-hub.controller.ts`: 2 of the 3 new cases fail (the one key, and `{ filed: false }`). The null case passes there too, since that behaviour did not change.
- Here, all 22 controller cases pass. The two specs give 91/91 (22 + 69).
- `src/pos-hub` and `src/notifications`: 41 suites, 721/721.
- Gateway `tsc --noEmit`, both `tsconfig.json` and `tsconfig.spec.json`: the only errors are the 2 pre-existing `@simplewebauthn/server` "Cannot find module" lines in `passkeys.service.ts`, which this worktree lacks; none is in a file of this PR.
- eslint on the three touched TS files: exit 0.
- Claims row:
  - exits 0 here;
  - exits 1 at `fe0f31f4d`, at `e6227de5a`, and on `origin/main` `8fdb819b4` and `8e16fbcef`;
  - 9 mutations each exit 1, in scratch copies of the three files, never the worktree. They return the whole note or `{ ...result }`, spread the result over the trimmed note, put back `fe0f31f4d`'s return, return early on a flag, use the wrong source, add a third raw route, make `bellNoteForTill` pass every field, or have the webhook return the whole note;
  - 2 controls exit 0: a comment quoting the old return, and the call on one line.
- `check_decision_claims.sh` (887/887, including the tech-debt fragment check), `check_adr_numbers_unique.py` (and `--self-test`), `check_od_ids_exist.py` and `check_migration_order.py` (0 migrations added since `8e16fbcef`): all exit 0.

## What changed and why

The code is in `apps/api-gateway/src/pos-hub/refused-checks-note.ts`. `pos-hub.service.ts` gets small additions: the two services are injected, refused checks are collected in the loop, there is one call after the loop, and `bellNote` is added to both returns. `pos-hub.module.ts` imports `AreaRoutingModule`. `pos-hub.controller.ts` narrows the webhook's answer [and, since the audit fix, the file import's]. `notifications.service.ts` gains one option, `pushData`.

**One note per import that refused a check, to the owners and managers only.**
- **When it is filed.** `ingest()` calls `fileRefusedChecksNote` once, after its loop, and only when it refused at least one check. An import that refused nothing files nothing and reads nothing for a note.
- **Who gets it.** The audience is this house's active owners and managers, from `user_restaurant_access` with `is_active` true. The role match ignores case and surrounding spaces. The note is written with `onlyUserIds`, which the funnel intersects with the house's members, so staff and other houses are never told. No role is read from the legacy `users` row (ADR 0088).
- **Away (ADR 0218).** `AreaRoutingService.route` runs over those owners and managers. People Away today are set aside and counted in `heldAway`. If every owner and manager is Away, the owners get the row only, with no push and no live ping.
- **The words.** The title is the founder's own example, `3 checks not imported: date not readable`, and names no field. The body names:
  - the till;
  - the first value the till sent, cut at 40 characters;
  - at most 10 check ids, each cut at 40 characters, then `and N more`;
  - how to write the closing time (`2026-10-03 21:00`).
- **Where it points.** The link is `/connections`, the type is `pos_import_refused` and the group key is `pos_import_refused:<till>`.
- **Why the funnel and not a producer.** Producers run on a sweep and claim events in the producer ledger. A refused import is an event inside a request, so the note is written through `persistForRestaurant`, like the `delivery_item_to_name` note in `procurement.service.ts`. Away and quiet hours use the same functions the producers use: `AreaRoutingService.route` and `isWithinQuietHours`.

**F5: one note per till per hour.** A refusal is counted into this house's open note for the same till when that note was first written less than 60 minutes ago. Every row of the note is updated, whether it is `unread`, `read` or `archived`:
- the count rises by the checks the note had not counted (fork 5, below), and the title's number with it;
- at most 10 ids are named in total, the earliest kept;
- the row returns to unread, an archived row too ("Bring it back");
- nothing is inserted, so there is no second push and no live ping.

An import that adds no check the note had not counted changes nothing in it, so none of the above happens (below).

`created_at` is never moved, so the hour runs from the note's first write ("Sliding hour" was rejected). After the hour, a new note and its push are written. A file import is one call, so it gets one note.

**Each check counted once (fork 5, "Count each check once (Recommended)").** Built in the round at `cee659a0b` (`897705e98`), in `refused-checks-note.ts` only.
- **Distinct ids.** A note counts the distinct check ids refused in its hour. An id is compared exactly as the till sent it, by a key: the first 16 hex characters of its SHA-256 (`checkKey`). An id repeated in one import, or one the note already keeps, is not counted or named again. Re-running a CSV with 3 bad checks still reads `3 checks not imported: date not readable`.
- **The bound: 500 kept, 10 named.** A note keeps at most 500 keys (`MAX_NOTE_KEPT_CHECKS`) and names the first 10, as before. Why 500 and not 10:
  - with 10 kept, a till that sends one check per webhook (F5's case) would read "At least 11" for the rest of the hour however many more were refused;
  - 500 is a chosen figure, not a measured one: fifty times the 10 named, meant to leave room for such a till's hour and for an export sent twice. No till's hourly refusals were counted, Tuzlu's included. A house that refuses more distinct checks than that in an hour can read "At least N": a floor, never more than it can prove, but less exact. [Corrected in fix round 1; this was first written as a capacity, here, in the code comment, in ADR 0281 and in commit `897705e98`'s body.]
  - at 16 characters a key, that is about 9 KB of metadata on each recipient's row at the bound. Full 64-character digests would be about 33 KB, and two ids share a 16-character key with a chance below 1 in 10^13 among 500.
- **"At least".** While every id the note counted is one it keeps, the count is exact, past 500 too when every id is provably new (300, then 300 new, reads 600). Once it has counted more than it keeps, an id it does not keep may be one it counted. An import that brings such an id makes the count the floor it can prove: the larger of what it had counted, and the kept ids plus that import's unkept ids. The note then reads `At least N checks not imported: date not readable`, says `and at least N more`, and says why.
- **A check with no id** (empty, or only spaces) is never merged with another. It is counted every time it is refused, never named, and the message says so ("2 of them came with no check id, so each is counted every time it is sent.").
- **A re-send that adds nothing writes nothing.** No row turns unread or comes back from the archive, and `bellNote` says `filed: true, addedToOpenNote: true, recipients: 0`. Rows of the note left behind by another process are still brought up, to the note as it was: the import does not count itself in (`imports` and `lastAddedAt` stay). Whether a re-send should re-flag the note was deferred in fix round 1; the founder answered "No, stays as it is (Recommended)" (under "Forks answered 2026-10-05").
- **Races.** `noteRank` orders a note's counts: the count first, then "at least" above an exact count of the same number. Every write raises it and the title carries both, so the title compare-and-sets still read a changed title as another import's write.
- **Older rows.** A note written before keys were kept does not read. The next refusal writes a new note, and `caveats` says so. No such note exists in production, because this PR has not merged.

**One note, up to three writes, and races.** A note's pushed rows, its quiet rows and the rows of people whose push switch is off are up to three writes, so they share a `metadata.noteId`.
- If the open note cannot be read, carries no id or count, or cannot be updated, a new note is written and `bellNote.caveats` says which. The refusals are never dropped.
- Inside one process, filing is queued per house and till. Across processes, the update is a compare-and-set on the title, which carries the count. The loser reads again, and after a second loss it writes a new note.
- Rows left behind at an older count are brought up by a second compare-and-set, on title and status, so an older count never lands over a newer one.
- No lock or index was added; either would need a migration.

**F6: push outside quiet hours.** Each recipient's window is read with `NotificationsService.getPreferences` and judged with `isWithinQuietHours` on the house's clock (`houseFrame`, ADR 0207). Inside the window, the person gets the row with priority `low` (no push, no urgent mark) and `broadcast: false` (no live pop-up). Everyone else gets priority `high` and the push. When the house's zone cannot be read or is not known, quiet hours are not judged and everyone whose push switch is on is pushed; when one person's preferences cannot be read, that person is pushed (fork 1, "Push anyway (Recommended)"). Either is logged and said in `caveats`.

**A person's own push switch ("Respect their switch (Recommended)", built in `f26eca63f`).** The same `getPreferences` read now also gives each owner's and manager's `push`, which `mapPreferencesRow` takes from `notification_preferences.push_enabled` (`row.push_enabled ?? true`, `notifications.service.ts:1180`); a person with no row gets `push: true` (`:1224`).
- **Switch off:** the row with priority `low` and `broadcast: false`, exactly as quiet hours: in the bell, no phone push, no live ping. A third write with the same words, metadata and `noteId`, so still one note. Counted in `bellNote.pushSwitchedOff`.
- **Only a literal `false` is off**, as `channelAllowed` (`team/broadcast-preferences.ts:92`) reads it. No row, a null `push_enabled`, or no `push` field all push.
- **Order.** A failed or empty read is handled first (pushed, fork 1), then the switch, then quiet hours. A person off and quiet is counted once, under `pushSwitchedOff`.
- **A house zone that cannot be read** no longer ends the function early: quiet hours are not judged, but every switch is still read.
- **A preferences read that fails pushes that person**, as fork 1 answered. The team broadcast does the opposite: when its read fails it pushes no one (`team/team.controller.ts:588-596`). Fork 1's answer is for this note, so this note keeps it.
- **Not read when it changes nothing:** when every owner and manager is Away (the owners already get the row only), and on an update to an open note (it pushes nobody).
- **Other notes are not changed.** The funnel's own push (`persistForRestaurant`'s "Mobile fan-out", `notifications.service.ts:805`) still reads no preference, and `NotesService` is untouched. `v3.0-TECH-DEBT.md:5533`, the team broadcast entry, says the funnel's leg pushed "reading no preference" and lists `NotesService.create` as not fixed (claims row `TD-2026-09-26-NOTES-SERVICE-DOUBLE-PUSH-OPT-OUT-BYPASS`, open). The founder's option text called the funnel-wide fix "separate, known".
- **Wording.** The unread-settings caveat now reads "the notification settings of N recipient(s) could not be read, so that person was / they were pushed" (it said "quiet hours"); the zone caveats end "so every recipient whose push is on was pushed".
- The option text estimated "About 3 lines + a test". It took more: the third group, its count in the result, the zone read no longer returning early, and the reworded caveats.

**The import answers on time.** The import waits at most `NOTE_DEADLINE_MS` (3 s) for its note. If the note is late, the import answers with `filed: false` and "the bell did not answer within 3 s; the note may still arrive", logs `POS_REFUSED_CHECKS_NOTE_LATE`, and lets the filing finish. A filing holds the next one for the same house and till for at most 3 s, so a hung call cannot wedge that till's queue.

**What leaves the house.**
- The phone push's `data` carries only the type, the link, the note's id and its count (`pushData`). Before this, the funnel spread the whole metadata into the push data.
- The webhook route returns `bellNote: { filed }` only, or null when nothing was refused. A webhook secret need not bind the house: the legacy `POS_HUB_WEBHOOK_SECRET` signs the body alone.
- The file import route, behind `JwtAuthGuard` with `assertTenantMatch`, returns the whole note: `{ filed, addedToOpenNote, recipients, heldAway, quietHours, pushSwitchedOff, notFiledBecause, caveats }`. [Audit fix, `c70f86b42`: no longer. On the founder's "Only 'the bell was rung' (Recommended)" it returns `{ filed }` only, as the webhook does.]
- `notFiledBecause` and `caveats` are fixed phrases. A database's own message goes to the log only.

**Filing never fails or undoes the import.** `fileRefusedChecksNote` does not throw. A note that is not filed says why and logs `POS_REFUSED_CHECKS_NOTE_NOT_FILED`. A failed read is said as a failed read, never as "nobody to tell" (ADR 0067, in spirit). `errors[]` still names checks only.

**Last call (final say), head `fe0f31f4d`.** `origin/main` had moved to `1884dea38` (#607, recommendations, ADR 0291); it was merged in at `fe0f31f4d` with no conflict. #607 touches none of this branch's 9 files, so no line of this PR changed. The independent verify of `8e67745ac` passed with three minor issues (under "Tests"), and the specs, typecheck, lint, claims, every `ci.yml` guard, the gate scan and the trial merges were re-run at `fe0f31f4d`.

**The fix round after the founder's answers of about 21:05Z (head `8e67745ac`).** Two commits on `d728b6e2b`:
- `f26eca63f` (5 files: `refused-checks-note.ts`, its spec, `pos-hub.controller.spec.ts`, ADR 0281, the claims shard). It builds "Respect their switch" (above). "New note at once" and "No, stays as it is" stand as built, and their spec cases now cite them. ADR 0281 quotes all three answers verbatim.
- `8e67745ac` (ADR 0281 and the claims shard). The per-hour claims row now pins "New note at once": an open-note read that finds no row returns no note.
- `origin/main` is still `155960b59` (fetched), so there was nothing to merge.

**Fix round 1, after the verify of `cee659a0b` (head `d728b6e2b`).** No behaviour changed. Three commits: `3506871d5` (3 files: `refused-checks-note.ts` comments, its spec, ADR 0281), then `d8301d1ab` (ADR 0281 only: how the probes were run) and `d728b6e2b` (ADR 0281 only: one sentence narrowed to what the code does).
- **The deleted note (major).** Deleting a bell row is a hard delete (`notifications.service.ts` `deleteNotification`, `deleteBulk`, `deleteAllRead`). While another recipient holds a row of the note, the one who deleted it hears nothing more of it until the hour ends, which is fork 2's answer. When every row is deleted, the open-note read finds nothing, and the next refusal inside the hour writes a new note with only its own checks and pushes it to every owner and manager, those who deleted the old one too. A one-owner house is the common case. Fork 2's option text said "The next hour's note still reaches them", which does not describe this. It is now stated in ADR 0281 (bracketed where the deleted row is) and in the module header, listed under "Forks deferred" below, and pinned by a spec case as built. [Answered 2026-10-05, about 21:05Z: "New note at once (Recommended)", as built; under "Forks answered 2026-10-05".]
- **A re-send that adds no check (minor).** Moved from "Two things fork 5's build had to choose" to "Forks deferred", with options and a recommendation. [Answered 2026-10-05, about 21:05Z: "No, stays as it is (Recommended)", as built.]
- **The 500 bound (minor).** Said as a chosen figure, not a measured capacity: the code comment is rewritten, and ADR 0281's sentence is bracket-corrected. Commit `897705e98`'s body still says it as a capacity; history is not rewritten, and commit `3506871d5`'s body corrects it.
- **The surviving mutation (minor).** `const next = grew ? grown : lead.state` changed to `const next = grown` passed all 55 cases. A new case (an import that adds no check brings a row behind up to the note as it was) fails under it.

**The round before (after the six answers, head `cee659a0b`):**
- `origin/main` `155960b59` (#645) was merged in at `0dd42bf8f`, with no conflict.
- Fork 5 was built (above). Forks 1, 2, 3, 4 and 6 stand as built, and no code changed for them.
- ADR 0281 quotes all six answers verbatim. "Not covered by an answer" and the sentences the change made stale are bracketed in place, including the web bell's "Other", which is "Point of sale" since #645.

**At the last call (`c84faf084`):**
- `origin/main` `eaa479c93` (#608) was merged in, with no conflict.
- One spec case was added. It pins the founder's rejection of "Sliding hour": no update moves `created_at`, and a refusal 61 minutes after the first write starts a new note.
- ADR 0281's stale sentences were corrected in place:
  - a test count;
  - a `caveats` sentence broader than the code;
  - a `procurement.service.ts:4792` cite that #608 moved;
  - three F2 sentences overtaken by the founder's later answers.

## Tests, guards and harness (head `fe0f31f4d`; code last changed at `f26eca63f`)

[The audit fix's runs, at `6a572b195`, are under "Audit fix" at the top. What follows is as of `fe0f31f4d`.]

**Last call (final say), at `fe0f31f4d` (`origin/main` `1884dea38` merged in), worktree clean before and after every run:**
- **The two specs: 89/89 pass** (note spec 69, controller spec 20).
- **`jest src/pos-hub src/notifications --runInBand --forceExit`: 41 suites, 719/719** (708 at `d728b6e2b`, plus the 11 new cases).
- **Typecheck.** `tsc --noEmit -p tsconfig.spec.json`: no errors other than the known `@simplewebauthn/server` ones.
- **Lint.** `eslint` on the 7 touched gateway files: 0 errors, 12 warnings, the same 12 prettier warnings in `notifications.service.ts` outside this branch's hunks.
- **Claims.** `check_decision_claims.sh`: **885 checked, 885 holding** (881 before; the 4 new rows are #607's shard).
- **Guards.** Every script `ci.yml` names, apart from the boot check and the claims check, exits 0: **47 of 47** (44 Python, 3 shell). Their `--self-test` runs: 43 exit 0; `check_migrations_single_home.py` has no self-test and exits 2 on the flag, as before. `check_adr_numbers_unique.py` reports no ADR number introduced by this branch (next free 0305).
- **Gate scan.** `pr_audit_gate._scan_record` returns None for ADR 0281 and for the claims shard; `ownership_between(".", "origin/main", "HEAD")` returns `[]`.
- **One more mutation, run by the last call.** In `splitByPushSettings`, the switch was moved after the quiet-hours judgement (a quiet person whose switch is off counted as quiet). Applied in place, original saved and put back with `cp -p` (`cmp` matched): 1 of 69 fails, "switch off and inside quiet hours: counted once, as switched off".
- **Trial merges at `fe0f31f4d`** are under "Merge-order notes".
- **Not run:** `check_gateway_boots.sh` (worktrees lack `@simplewebauthn/server`; no module or injection changed since the boots below), a real database, a device push.

**The verifier's last round (independent, at `8e67745ac`): PASS, three minor issues.** Its own runs: 89/89 on the two specs; 55 suites, 1151/1151 across `src/pos-hub`, `src/notifications`, `src/areas` and `src/team`; 8 suites, 113/113 across the read-error, beverages, simpos, push, websocket and user-preferences specs; `d728b6e2b`'s note file put back: 34 of 69 fail, all 11 new cases among them; six behaviour mutations, five caught by jest and all six by claims rows; claims (881/881), the ADR, OD, citation, conflict-marker, read-error, table, column, DTO-key, route, orders, voice-gate, flag, seeded-default and migration-version guards, all exit 0; the ADR's line citations and case counts checked. Where each issue stands:
1. **`r.prefs.push === false` changed to `!== true` passes all 69 jest cases.** Only the claims row `TD-2026-10-05-POS-REFUSED-NOTE-PUSH-SWITCH-RESPECTED` catches it. Not a defect today: the real `getPreferences` always returns a boolean `push` (`row.push_enabled ?? true`, or `true` with no row), so the two read the same. The ADR's "only a literal false is off" rests on that CI-run claims row, not on jest (under "Not covered").
2. **A third write group widens the partial-write gap.** A new note is up to three writes; if the pushed group writes none while another group writes some, the result is `filed: true` with no caveat. Not new (the same gap with two groups), stated in the doc comment, ADR 0281's Consequences and "Not covered".
3. **`check_gateway_boots.sh` was not run.** The module and constructor have not changed since `1af0bb4d1`; the builder's first-build run and the earlier verifier's manual boot of `d728b6e2b` returned BOOT_OK; CI is the first real run.

**The fix round, at `f26eca63f` and `8e67745ac`, `origin/main` `155960b59` (fetched; nothing to merge), worktree clean after each commit:**
- **The two specs: 89/89 pass.** The note spec has 69 cases and the controller spec 20.
- **The 11 new cases**, under "the person's own push switch":
  - (a) one owner, switch off, outside quiet hours: one row, priority `low`, no broadcast, `pushSwitchedOff: 1`;
  - (b) switch on: pushed as before;
  - (c) preferences that cannot be read: pushed, with the caveat;
  - (d) owner off, manager on: the manager's group pushed, the owner's row only, one note (same title and metadata);
  - switch off in a house with no zone known; off and inside quiet hours (counted once, as off); everyone off (one write, nothing pushed, filed); through `ingest()`;
  - three through the real `NotificationsService` and its real preferences read, over a stub database: `push_enabled` false for the owner (both rows land; only the manager's phone is pushed and only the manager's page pinged); no row, and a null `push_enabled` (pushed); a read that fails (both pushed whatever the rows say, and said without the database's words).
- **Fail before, pass after ([ctl]).** I saved the head's `refused-checks-note.ts` in the scratchpad, wrote `git show d728b6e2b:apps/api-gateway/src/pos-hub/refused-checks-note.ts` over it, ran both specs, and put the head's copy back with `cp -p` (`cmp` matched). **34 of the note spec's 69 fail; the controller's 20 pass.**
  - Six new cases fail on what was pushed: (a), (d), the house with no zone, everyone off, through `ingest()`, and the real funnel (there the owner was pushed with `push_enabled` false: `pushes` was `[["u-owner","u-manager"]]`).
  - The off-and-quiet case fails on how its rows are grouped and counted. That person was not pushed at `d728b6e2b` either, being quiet.
  - (b), (c) (stub and real) and the no-row case pin behaviour that did not change. They fail only on the result's words.
  - So do 23 earlier cases, none on what was pushed: 20 because the result had no `pushSwitchedOff`, 2 on the reworded caveats, and 1 because a house with no zone read no one's preferences.
- **Behaviour mutations against the spec**, each applied in place to `refused-checks-note.ts` and put back with `cp -p` (`cmp` matched; none committed):
  - the switch check made `if (false)`: 7 fail;
  - the switched-off group given `push: true`: 7 fail;
  - an unreadable zone returning early with everyone pushed: 1 fails.
- **Wider suites** (`--runInBand --forceExit`):
  - `jest src/pos-hub src/notifications src/calendar src/team`: **68 suites, 1389/1389**;
  - `jest src/areas src/push src/common src/user-preferences src/websocket`: **49 suites, 806/806**.
- **Typecheck.** `tsc --noEmit -p tsconfig.spec.json` gives only the known `@simplewebauthn/server` errors.
- **Lint.** `eslint` and `prettier --check` on the three touched gateway files: clean.
- **Claims.** `check_decision_claims.sh`: **881 checked, 881 holding**. The shard now has eight rows.
  - Added: `TD-2026-10-05-POS-REFUSED-NOTE-PUSH-SWITCH-RESPECTED`. It checks the switch is read after a failed read and before quiet hours, only as a literal `false`; the switched-off group carries no push and is counted; an unreadable zone still reads every switch; and `getPreferences` gives its defaults.
  - Rewritten for `splitByPushSettings`: `…-QUIET-HOURS-ROW-ONLY`, its old text kept in a bracket.
  - Corrected in place: `…-RING-THE-BELL` (the inbox-only group's new `without`), `…-ONE-PER-TILL-PER-HOUR` and `…-FIXED-PHRASES` (`pushAll` is now `zoneUnread`). The per-hour row now also pins "New note at once" (no row found means no open note) and cites "No, stays as it is" where it already checked that an import adding no check writes nothing.
  - The changed and added rows exit 0 here and 1 on `origin/main` `155960b59`, read from `git archive` copies. All but the per-hour row exit 1 at `d728b6e2b`; the per-hour row exits 0 there, since its changes pin what that head built. Rows 4, 5 and 7 are unchanged.
  - **32 mutations**, each applied once to a scratch copy and each confirmed to change the file, make every row they target exit 1. **3 controls** (two comments and a whitespace change) leave the rows at 0. By row:
    - the switch row: the check removed, `=== false` made `!push` or `!== true`, the check moved after quiet hours are judged, a failed read sent to switched-off, an unreadable zone that returns early, the switched-off group pushed or dropped, `pushSwitchedOff` dropped from the type, the counts dropped or not returned, the ping or the push for every group, a failed read read as off, a null `push_enabled` or a missing row read as off;
    - the quiet-hours row: the zone null not guarded, the window always on, quiet ignored, the quiet group pushed, a read without quiet hours or a failed read sent to quiet, the rule imported from elsewhere, a clock of its own (plus several of the above);
    - the ring-the-bell row: the everyone-Away group pushed (plus the ping and push for every group);
    - the fixed-phrases row: a zone caveat carrying the database's words or its detail, the zone warn line dropped, the settings caveat carrying the error;
    - the per-hour row: an update that reads the switch, the empty-read check removed, an empty read answered as a note.
- **Guards.** `check_adr_numbers_unique.py` passes (next free 0305), as does its `--self-test`. `check_od_ids_exist.py` passes. `pr_audit_gate._scan_record` returns None for ADR 0281 and for the shard, and `ownership_between(worktree, "origin/main", "HEAD")` returns `[]` at `8e67745ac`.
- **Trial merges** at `8e67745ac` (`git merge-tree --write-tree`, nothing written to any branch) are under "Merge-order notes".
- **Not re-run in the fix round:**
  - the other Python guards named in `ci.yml`, and their self-tests;
  - the three shell guards;
  - `check_gateway_boots.sh` (no module or injection changed);
  - the earlier rounds' mutation probes on code the fix round did not touch.

**From the earlier rounds:**

**Re-run at the last call (final say), at `d728b6e2b`, `origin/main` `155960b59` (fetched; the branch already holds it, nothing to merge), worktree clean before and after:**
- the two specs: **78/78** pass (note spec 58, controller spec 20);
- `jest src/pos-hub src/notifications --runInBand --forceExit`: **41 suites, 708/708** pass;
- `tsc --noEmit -p tsconfig.spec.json`: only the 2 known `@simplewebauthn/server` errors;
- `eslint` on the 7 touched gateway files: **0 errors**, 12 prettier warnings, all in `notifications.service.ts` at lines this branch does not touch (its hunks are the `pushData` option and the one spread line);
- `check_decision_claims.sh`: **880 checked, 880 holding**;
- all **44** Python guards named in `ci.yml` exit 0; their `--self-test` runs give 43 passes, and `check_migrations_single_home.py` has no self-test and exits 2 on the flag (unchanged; this branch touches no script); `check_model_calls_logged.sh`, `check_no_direct_stock_writes.sh` and `check_no_direct_type_attributes_access.sh` exit 0;
- `pr_audit_gate._scan_record` returns None for ADR 0281 and for the claims shard, and `ownership_between(worktree, "origin/main", "HEAD")` returns `[]`;
- trial `git merge-tree` at `d728b6e2b` against the open PRs that share a file (under "Merge-order notes").

Not re-run at the last call: `check_gateway_boots.sh` (the independent verifier booted this same head, below) and the mutation probes (the verifier's and the builder's, below).

The rest of this section was measured in fix round 1 unless marked otherwise.
- **The two specs: 78/78 pass.** `pos-hub.refused-checks-note.spec.ts` has 58 cases and `pos-hub.controller.spec.ts` has 20.
- **Fix round 1's 3 new cases** (no behaviour changed, so none fails before; each pins what is built):
  - under "a row deleted from the bell": one recipient deleted the note while the other holds it (stays deleted; the other row takes the new count; nothing written or pushed);
  - every recipient deleted it (a new note at once, only its own check, pushed to both; as built, the first fork under "Forks deferred") [answered 2026-10-05: "New note at once (Recommended)"];
  - under "a check sent again is counted once": an import that adds no check brings a row behind up to the note as it was, field for field (`imports` stays 2, `lastAddedAt` is not stamped again), and the lead row is left untouched.
- **Fix round 1's mutation probes**, each applied once, in place, to the worktree's `refused-checks-note.ts` (each confirmed to change the file), with the original saved in the scratchpad; the note spec was run and the original put back with `cp -p` (`cmp` matched; no mutation was committed). Commit `3506871d5`'s body says "on scratch copies"; that is wrong, and this is what was done:
  - `const next = grown` (the verifier's survivor): 1 of 58 fails, the new row-behind case;
  - `rows.length < 2` read as no open note: 1 fails, the one-deleted case;
  - option (b) of the deleted-note fork, built for the probe only (an in-process marker per client that keeps silent for the rest of the hour): 2 fail, the all-deleted case and the hung-write case, which also leaves no row.
- **The rest of this section is from the round before, at `cee659a0b`, unless it says fix round 1.**
- **Fork 5's 8 new cases**, under "a check sent again is counted once":
  - (a) the same 3 checks re-sent within the hour, one twice, stay at `3 checks`, name each id once, and write nothing; the import's own `refusedUnreadableDate` says 4;
  - a check named twice in one import is one check;
  - (b) 2 new ids and 1 old move the count from 3 to 5, each named once;
  - (c) past the bound: 503 distinct read `503` exactly, the same 503 again read `At least 503` with `and at least 493 more`, 10 new ids read `At least 510`, and kept ids alone write nothing;
  - (d) the bound: 300 then 300 new read `600` exactly with exactly 500 keys kept, and no written or updated row holds more than 500 keys or 10 named ids;
  - checks with no id (counted every time, never named, said), one check with no id, and a note written before keys were kept (a new note, with the caveat).
- **Fail before, pass after, for fork 5 ([ctl]).** I copied `c84faf084`'s `refused-checks-note.ts` (`git show`) over the head's, ran the note spec, and restored the head's copy with `cp -p`; `cmp` matched. **9 of the 55 fail:** the 8 new cases, and the case of an open note with no note id, whose fixed caveat now also names the check list. The spec computes the seeded notes' keys itself, so it imports nothing the older file lacks.
- **Fail before, pass after, at the earlier round.** I swapped in `e6227de5a`'s `refused-checks-note.ts`, `notifications.service.ts` and `pos-hub.controller.ts`. **18 of the 67 fail** (17 in the note spec, 1 in the controller spec). They cover:
  - archived rows not brought back;
  - an older count landing over a newer one;
  - a hung write holding the import;
  - push data carrying the metadata;
  - the webhook getting the whole note;
  - database text in `caveats` and `notFiledBecause`.

  The files were restored, and `cmp` matched.
- **The sliding-hour case.** It fails when the update's patch also sets `created_at` (the verifier's mutation M16, which no case or claims row caught before). It passes here, and it also passes at `e6227de5a`, which did not slide either.
- **Wider suites** (`--runInBand --forceExit`):
  - `jest src/pos-hub src/notifications src/areas src/push src/calendar src/common`: **102 suites, 1785/1785** pass in fix round 1 (1782 at `cee659a0b`, plus the 3 new cases).
  - Builder, at `16f86742e`: `jest src/calendar src/commodity src/communications src/organizations src/price-index src/procurement src/push src/team src/areas` gave 220 suites, 4362 passed and 3 skipped.
- **Typecheck** (fix round 1). `tsc --noEmit -p tsconfig.spec.json` gives 2 errors, both the pre-existing `@simplewebauthn/server` ones in `passkeys.service.ts`.
- **Lint** (fix round 1). `eslint` on the two code files changed (`refused-checks-note.ts` and its spec) gives 0 errors and 0 warnings; `prettier --check` passes. At the last call, the 7 touched gateway files gave 0 errors and 12 warnings, all in `notifications.service.ts`, the same 12 as `origin/main`'s copy; that file is unchanged since.
- **Claims.** `check_decision_claims.sh` reports **880 checked, 880 holding** (re-run in fix round 1; no row changed in it). The shard has seven rows:
  - New: `TD-2026-10-05-POS-REFUSED-NOTE-COUNTS-EACH-CHECK-ONCE`. Rows 1 (`…-RING-THE-BELL`) and 2 (`…-ONE-PER-TILL-PER-HOUR`) were corrected in place where they read the count adding every refusal, their prose bracketed.
  - All seven exit 0 at the head. Rows 1, 2 and the new row exit 1 at `c84faf084`, and rows 3, 4 and 6 exit 0 there (their behaviour did not change). Every row exits 1 at `1236c41f3`, `e6227de5a`, `8fdb819b4` and `origin/main` `155960b59`, read from `git show` copies of the three files.
  - At `cee659a0b`: 31 mutations of `refused-checks-note.ts`, each applied once to a scratch copy and each confirmed to change the file (none was a no-op), make the rows they target exit 1 (35 of 35 runs). 3 controls exit 0: comments that say the old code (rows 2 and 7) and a string that says it (row 7). The list is in commit `897705e98`'s body.
  - Earlier rounds: the builder's 44 mutations and 2 controls per row; the verifier's 17 mutations, all caught except M16, which the spec catches.
- **Guards** (re-run in fix round 1, except the boot check).
  - All 44 Python guards named in `ci.yml` exit 0, `check_adr_numbers_unique.py` and `check_od_ids_exist.py` among them. 43 of their `--self-test` runs exit 0: 38 have a self-test in their source, and 5 (`check_ask_ai_is_gated`, `check_flag_readby_anchors`, `check_no_vendored_deps`, `check_task_types_are_graded`, `check_test_scripts_are_real`) ignore the flag and run their check. `check_migrations_single_home.py` has no self-test and rejects the flag (exit 2).
  - `check_model_calls_logged.sh`, `check_no_direct_stock_writes.sh` and `check_no_direct_type_attributes_access.sh` exit 0.
  - `check_gateway_boots.sh` **PASSES**, run by the builder at the first build with a `NODE_PATH` stub for `@simplewebauthn/server`, which worktrees lack. The independent verifier of `d728b6e2b` could not run the script itself (the same missing module) and booted the AppModule by hand with that stub: **BOOT_OK**, which exercises the two `@Optional` injections and the `AreaRoutingModule` import. CI is the real confirmation.
- **Gate scan.** `pr_audit_gate._scan_record` on ADR 0281 and on the shard returns None. `pr_audit_gate.ownership_between(worktree, "origin/main", "HEAD")` returns `[]` at `d728b6e2b` (fix round 1), as at `cee659a0b`.
- **Local Postgres harness.** Not run: no SQL or migration changed. Nothing was appended to `audits/bellnote-local-pg.txt`.
- **Verifier's last round (independent, at `d728b6e2b`): PASS, six minor issues.** Its own runs: 78/78 on the two specs, 102 suites and 1785 tests on the wider gateway run, 36 suites and 604 tests on the dependent specs, about 31 mutations of `refused-checks-note.ts` and `pos-hub.service.ts` almost all killed (the survivors equivalent or caught by claims rows), 4 claims-row mutations each failing their row, every founder answer in the brief checked against code and spec. Where each issue stands:
  1. A note every recipient deleted writes a new note inside its hour: disclosed, pinned, and under "Forks deferred" (it is also what the founder's "As built" option meant when he picked it; see there). [Answered 2026-10-05: "New note at once (Recommended)".]
  2. A re-send that adds no check does not re-flag: under "Forks deferred". [Answered 2026-10-05: "No, stays as it is (Recommended)".]
  3. A check with no id is counted every time, a method choice the PR body's "had to choose" list did not name: added there at the last call.
  4. Commit bodies of `897705e98` ("measured") and `3506871d5` ("scratch copies") are wrong: corrected by `d8301d1ab`, the ADR and this body; history is not rewritten. Do not carry either sentence into the squash message (under "Merge-order notes").
  5. Stubs only, no database: true, and under "Not covered"; no SQL changed, so the local Postgres harness does not apply.
  6. `check_gateway_boots.sh` cannot run in a worktree: the verifier's manual boot returned BOOT_OK (above); CI confirms.
- **An earlier verify (answered at the last call `c84faf084`): PASS, five minor issues**, all answered then: the unpinned sliding hour (case added), a stale test count (corrected), the re-sync with main (done), and the partial-write and unreadable-Away gaps (said in ADR 0281 under Consequences and in the `caveats` doc comment, not changed in code; see "Not covered").

## ADR and CLAIMS touched

- **ADR 0281** (Proposed), amended in place. It now has:
  - the Status line, Keywords and Links;
  - F2's first answer;
  - "Forks left to the founder";
  - the section "Amended 2026-10-05: refused checks reach the bell", with every answer verbatim, the new bullet "Each check counted once" (with why 500 and 16 characters, and what was rejected), "Not covered by an answer", now bracketed as answered, and "Forks deferred" (fix round 1: the note every recipient deleted, and a re-send that adds no check, each with options and a recommendation);
  - seven review-trail rows from this branch (fix round 1 added one, the round at `8e67745ac` one).

  The fix round (`f26eca63f`, `8e67745ac`):
  - "The founder's answers to the three forks deferred at `d728b6e2b`", at the end of the amendment: each question, pick and option text verbatim;
  - a bullet "A person's own push switch", after the quiet-hours bullets: what is built, why a failed read still pushes, what is not read, and that other notes still do not read the switch (citing `v3.0-TECH-DEBT.md` and the open `NotesService` claims row);
  - a "Tests" paragraph for the 11 new cases and the [ctl] run;
  - the Status line and "Forks left to the founder": one sentence each saying the three were answered;
  - Keywords: `push_enabled`, `pushSwitchedOff`;
  - "Forks deferred", the deleted-row items, the re-send item, the unreadable-zone bullet, the quiet row's priority, "An update reads neither" and the partial-write consequence: each bracketed and dated 2026-10-05, the old text kept;
  - two new consequences: the switch holds for this note and the team broadcast only, and a new note takes up to three writes.

  Corrected in place in fix round 1, each bracketed and dated 2026-10-05:
  - the deleted row, where the amendment says it is not brought back, and its "Not covered by an answer" item: as built only while another recipient holds a row;
  - the re-send that writes nothing: pointed to "Forks deferred";
  - "500 holds an hour of such a till, and a day's export sent twice": a chosen figure, not measured;
  - "Forks left to the founder": two forks open again, under "Forks deferred";
  - a "Tests" paragraph for the 3 new cases and the probes.

  Corrected in place the round before, each bracketed and dated 2026-10-05:
  - "Every refusal counts …" and "every import adds at least one";
  - the counted-into-the-note bullets, the compare-and-set's "lower", the words, and what an unreadable note is;
  - each "Not covered by an answer" item, with its answer;
  - the web bell's "Other", now "Point of sale" since #645.

  Corrected in place at the last call:
  - the test count;
  - the `caveats` sentence;
  - the delivery-note cite, now by type;
  - three F2 sentences, bracketed.
- **`claims.d/fix-pos-import-refusals-ring-the-bell.jsonl`** (new), eight rows:
  - `TD-2026-10-05-POS-REFUSED-CHECKS-RING-THE-BELL`
  - `…-NOTE-ONE-PER-TILL-PER-HOUR`
  - `…-NOTE-QUIET-HOURS-ROW-ONLY`
  - `…-NOTE-ANSWERS-ON-TIME`
  - `…-NOTE-PUSH-DATA-AND-WEBHOOK-ANSWER`
  - `…-NOTE-FIXED-PHRASES`
  - `…-NOTE-COUNTS-EACH-CHECK-ONCE` (the round before)
  - `…-NOTE-PUSH-SWITCH-RESPECTED` (`f26eca63f`; what it checks, and the edits to rows 1, 2, 3 and 6, are under "Tests")
- No `decisions/README.md` row is edited, no OPEN-DECISIONS row is added, and no ADR whose metadata names the audit gate is touched. [Audit fix: the 0281 README row is edited, on the founder's "Yes, update it (Recommended)", quoted under "Audit fix". Still no OPEN-DECISIONS row, and no such ADR.]
- **The audit fix** (`c70f86b42`, `6a572b195`): ADR 0281's "The import route's answer" and its brackets, its trail row and two keywords; the claims row `…-NOTE-PUSH-DATA-AND-WEBHOOK-ANSWER`, corrected in place; and `tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md` (new, two OPEN entries). The details are under "Audit fix".

## The founder's answers (2026-10-05, AskUserQuestion, relayed by the fix-lane coordinator), verbatim

- **How refused checks reach the owner:** **"Bell note, follow-up PR (Recommended)"**. "#603 merges as is. A small follow-up files one owner/manager bell note per import with refusals ('3 checks not imported: date not readable'), with the check ids. Cost: about 4–6 files, its own audit." **Built.**
- **F5:** **"One note per till per hour (Recommended)"**. "Later refusals in the same hour are counted into the open note. A file import still gets one note. Cost: one read of the open note before each write, about 1-2 more files." **Built.**
- **F6:** **"Push outside quiet hours (Recommended)"**. "Inside a person's quiet window they get the bell row only, no push. Cost: reading each recipient's preferences and the house's zone per note." **Built.**
- **F7:** **"Own group, small web PR (Recommended)"**. "Add a register for pos_import_refused in nt-format.ts, a one-file follow-up with its own audit." Not here: it is #645 (`fix/bell-files-refused-checks`).
- **ADR 0281 F2:** **"Dry run, then your yes (Recommended)"**. "I build a read-only count of the rows a re-date would change (by house and day shift), show it to you, and nothing is written until you say yes." It is recorded in the ADR. The dry run and the write he later answered belong to branch `fix/old-pos-rows-carry-their-check-date`.
- **Archived row:** **"Bring it back (Recommended)"**. "The archived note returns to their bell as unread with the new count, so someone who cleared '3 refused' still learns it is now 9. Cost: about 1 file plus a test." **Built.**
- **Rhythm:** **"One push per hour, re-flagged (Recommended)"**. "As built: one push per clock hour from the first note. A note that grows turns unread again, so the bell shows it is news." **Built, and now pinned by a test.**
- **Quiet hours:** **"Quiet means quiet (Recommended)"**. "As built: the row waits in the bell with a normal mark, no urgent badge and no live pop-up on an open web page." **Built.**

## Forks answered 2026-10-05

Asked with AskUserQuestion on 2026-10-05 in two rounds, each relayed by the fix-lane coordinator: six forks at about 19:10Z, after the last call at `c84faf084`, and three at about 21:05Z, after the last call at `d728b6e2b`. Each question, the pick and the option text he saw, verbatim. All nine are quoted in ADR 0281, at the end of the amendment.

**The first round (about 19:10Z).**

- **Fork 5, a re-sent check.** "Bell note for refused till checks: if the till re-sends a check that is refused again (e.g. someone re-runs the same CSV), how should the note count it?" **"Count each check once (Recommended)"**. "The note counts distinct checks in its hour: re-running a CSV with 3 bad checks still reads '3 checks not imported', not 6. Past a cap it says 'at least'. Cost: about 1 file plus tests; not built yet." Rejected: "Count every refusal (as built)". **Built at `897705e98`**: 1 code file, its spec, the ADR and the claims shard.
- **Fork 1, quiet hours that cannot be read.** "When the system cannot read someone's quiet hours (the house's time zone is missing, or that person's settings fail to load), should the refused-checks note still push to their phone?" **"Push anyway (Recommended)"**. "As built. This note is the only place refused till checks are reported, so a failed settings read should not turn into silence. Risk: someone in quiet hours may get one push." Rejected: "Bell row only". **As built.**
- **Fork 6, the push's text and the live ping.** "The phone push and the web's live pop-up for this note: should they carry the check ids and the till's value, or a shorter text?" **"Full text, as built (Recommended)"**. "The push says the note's own words, including check ids and the till's value, like every other bell note does. Your first answer asked for the note 'with the check ids'." Rejected: "Short push, details in bell". **As built.**
- **Fork 2, a deleted row.** "If someone deletes the refused-checks note from their bell, and more refusals arrive within the same hour, what happens?" **"Stays deleted (Recommended)"**. "As built. Deleting is deliberate (your 'Bring it back' answer was about archiving). The next hour's note still reaches them." Rejected: "Comes back". **As built, but only while another recipient still holds a row of the note.** When every row is deleted, the next refusal inside the hour writes a new note at once and pushes it; the option text did not describe that case, so it was deferred in fix round 1 and asked again (answered in the second round, below: "New note at once").
- **Fork 3, an owner or manager added during the hour.** "An owner or manager is added to the house during the hour a refused-checks note is open. Should they get that open note?" **"Next note reaches them (Recommended)"**. "As built. They get no row of the open note; the next note, at most an hour later, reaches them. No extra read per import." Rejected: "Add them to the open note". **As built.**
- **Fork 4, one removed or demoted during the hour.** "An owner or manager is removed or demoted during the hour a refused-checks note is open. Should their copy of the open note still update?" **"Updates until the hour ends (Recommended)"**. "As built. Their existing row keeps counting (and comes back if archived) until the hour ends; the next note does not reach them. It shows only what they already saw." Rejected: "Stop at once". **As built.**

**Two things fork 5's build had to choose, stated so they can be checked.**
- The bound and the key (500 kept, 16 characters). The answer says "Past a cap", and the lane's instructions leave the cap to the build, with its reason. The reasons are above and in the ADR; 500 is a chosen figure, not a measured one.
- A check with no id (empty, or only spaces) is counted every time it is refused, never merged with another, and the message says so. It cannot be told from another check, so counting it once would hide a second one; the ADR records this under "Each check counted once". [Added at the last call: the verifier of `d728b6e2b` found it missing from this list.] [Fix round 1: this list also held "A re-send that adds nothing does not re-flag the note", called "not a new fork". His fork-5 text does not say whether a re-run CSV re-flags the note, so it is now under "Forks deferred".] [2026-10-05: answered in the second round, below: "No, stays as it is".]

**The second round (about 21:05Z): the three forks deferred at `d728b6e2b`.** [Until `f26eca63f` these stood under a heading "Forks deferred", each with options (a) and (b) and a recommendation; the code did (a) of each. The founder picked the recommendation each time: (a), (a) and (b).]

- **A note every recipient deleted, then more refusals inside its hour.** "Till-refusal note: every owner/manager deleted this hour's note, then the till refuses more checks in the same hour. What happens?" **"New note at once (Recommended)"**. "As built: a fresh note with only the new refused checks, pushed to owners/managers (including whoever deleted the old one). Refused checks are never left unreported. Cost: none." **As built; no code change.** Pinned by the spec case "every recipient deleted it", which now cites the answer, and, since `8e67745ac`, by the per-hour claims row (an open-note read that finds no row returns no note). Fork 2's "Stays deleted" holds while another recipient still holds a row.
- **A re-send that adds no check.** "The till re-sends checks the note already counts (count unchanged). Should the note turn unread again?" **"No, stays as it is (Recommended)"**. "As built: a read note stays read, an archived one stays archived. Matches your earlier rule that a note turns unread when its count grows: an unchanged count is not news." **As built; no code change.** Pinned by the spec case "the same three checks sent again within the hour", which now cites the answer, and by the per-hour claims row, which already checked that such an import writes nothing.
- **A person who switched push off.** "An owner or manager switched push off in their settings. Should this till-refusal note still push to their phone?" **"Respect their switch (Recommended)"**. "Not built yet: they get the note in their bell only, no phone push, like quiet hours. About 3 lines + a test before merge. Other notes still ignore the switch today (separate, known fix)." Rejected: "As built" (the switch not read). **Built in `f26eca63f`**; what it does is under "What changed and why", "A person's own push switch". Found at the last call of `d728b6e2b`; it was in this body only until the answer, and is now in ADR 0281.

## Forks deferred

None open. Every fork this branch raised has been answered by the founder and is quoted above and in ADR 0281. The funnel-wide push switch (every other note written through `persistForRestaurant` still pushes a person whose switch is off) is not a fork of this lane: the founder's option text called it a "separate, known fix", and it is under "Not covered". [Audit fix: the import route's answer, which the review of `fe0f31f4d` found unasked, is answered too (quoted under "Audit fix"). The funnel-wide fix is now filed as an OPEN tech-debt entry. What a failed preferences read should do in that fix is a product question for that branch, not this one.]

## Merge-order notes

- **[Audit fix] Base and size now.** `main` was last merged at `8e16fbcef` (#647), in `b5be681cc`. The PR has **11 files**, within the 15-file cap: the 9 below, plus `.planning/decisions/README.md` (the 0281 row) and `.planning/tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md`. The rest of this bullet is as of `fe0f31f4d`.
- **Base and size.** The base is `main`, last merged at `1884dea38` (#607, in `fe0f31f4d` at the last call, with no conflict; before that `155960b59` in `0dd42bf8f`). The PR has **9 files**; the fix round changed 5 of them and added none:
  - ADR 0281 and the claims shard;
  - `pos-hub.module.ts`, `pos-hub.service.ts`, `refused-checks-note.ts` and its spec;
  - `pos-hub.controller.ts` and its spec;
  - `notifications.service.ts`.

  That is over the brief's "≤ 6" and the founder's "about 4–6 files" estimate. The 3 extra files come from fixing `e6227de5a`'s findings (the webhook answer and the push data), and the total is within the 15-file cap.
- **History.** The branch was cut from #603's head before #603 was squash-merged, so its log still lists #603's pre-squash commits. The diff against `origin/main` is the 9 files above. No history was rewritten.
- **Open PRs sharing a file**, listed at the last call from all 76 open PRs (`gh pr view N --json files`): #618, #582 and #647, plus #644 itself (this branch, still at `e6227de5a` on `origin`).
- **#618** (`feat/a-check-carries-its-channel`, `82890ebb7`) also edits `pos-hub.service.ts`. A trial `git merge-tree` with `fe0f31f4d` (as with `8e67745ac`, `d728b6e2b`, `3506871d5` and `cee659a0b`) auto-merges that file. Its conflicts are `scripts/sql_outside_migrations.txt` and, since #607 added a row on `main`, `.planning/decisions/README.md`; a trial merge of #618 onto `origin/main` `1884dea38` alone conflicts in the same two files, and neither is this branch's.
- **#582** (`fix/phone-feed-no-money-for-staff`, `1c8c93581`) also edits `notifications.service.ts`, in other hunks. A trial merge with `fe0f31f4d` (as with `8e67745ac` and `d728b6e2b`) is clean.
- **#645** (`fix/bell-files-refused-checks`, F7's web register) merged as `155960b59`, and this branch has merged it in. The web bell files the note under "Point of sale" (`nt-format.ts:121`).
- **[Audit fix] #647 is merged** (`8e16fbcef`), and this branch merged it in at `b5be681cc`, resolving ADR 0281 as described below. The rest of this bullet is kept as the plan it was.
- **#647, branch `fix/old-pos-rows-carry-their-check-date`** (F2's write, worktree `wt-fix-f2redate`, head `0371df1a0`) **conflicts in ADR 0281**, and in no other file: a trial `git merge-tree` with `fe0f31f4d` at the last call still reports that one file, in 5 hunks (counted from the conflict markers), as with `8e67745ac`, `d728b6e2b`, `3506871d5` and `cee659a0b`; #647 onto `origin/main` `1884dea38` alone is clean. The fix round's ADR edits (`f26eca63f`, `8e67745ac`) fall inside the same hunks: a sentence on the Status line (hunk 1), a bracket on the forks paragraph (hunk 2), and the rest inside the amendment and the trail (hunks 4 and 5). Hunk by hunk:
  1. the Status line: both append sentences (the round at `8e67745ac` added one more; keep it);
  2. "Forks left to the founder" and the F2 entry: both bracket the forks paragraph, and #647 rewrites the F2 entry (fix round 1 and the round at `8e67745ac` each append one more bracket to that paragraph, inside this same hunk; keep both);
  3. the "Easier" consequence: #647's edit only;
  4. "Revisit when": #647 rewrites that line, and this branch's whole amendment section follows it, so the hunk spans the section;
  5. the end of the file: both add review-trail rows, and #647 adds its sections after the trail.

  Whichever merges second resolves them by later truth, keeping both lanes' text. In hunks 4 and 5 that is both sides in full: #647's "Revisit when" line, then this amendment, then both lanes' trail rows in date order and #647's sections. That branch carries the founder's later F2 answers; this branch only points to it.
- **No stacking.** Nothing here needs another open branch's code.
- **The open PR, #644, still points at `e6227de5a`** (read from `origin` at the last call). Nothing here is pushed; the coordinator pushes `fe0f31f4d`. [Audit fix: the local `origin/fix/pos-import-refusals-ring-the-bell` reads `fe0f31f4d`, as last fetched. The new head, `6a572b195`, is not pushed.]
- **Merge order.** This PR stacks on nothing open. It can merge before or after #618 and #582 (no shared hunk). With #647, whichever merges second resolves ADR 0281 as described above.
- **[Audit fix] Trial merges not re-run.** The trial merges with #618 and #582 were not re-run at `6a572b195`. Since `fe0f31f4d`, this branch changed `pos-hub.controller.ts` and its spec, `refused-checks-note.ts` (comments), the claims shard, ADR 0281, the README's 0281 row and a new tech-debt fragment. #618 edits `pos-hub.service.ts` and the README, so a README conflict with #618 is now possible on two sides.
- **Squash message.** Two commit bodies on this branch are wrong and are not rewritten: `897705e98` calls the 500 bound "measured", and `3506871d5` says the probes ran "on scratch copies" (they ran in place, with the original put back). Build the squash message from this body, not from those two commit bodies.

## Not covered (said plainly, CLAUDE.md §0.5)

- **The push switch's "only a literal `false`" is pinned by a claims row, not by jest.** Changing `=== false` to `!== true` passes all 69 cases (the verifier of `8e67745ac`); the CI-run row `TD-2026-10-05-POS-REFUSED-NOTE-PUSH-SWITCH-RESPECTED` fails on it. No spec case feeds a `push` that is missing or null into this module; the real `getPreferences` never returns one, so behaviour is the same today.
- **The merge commit `fe0f31f4d` was not independently verified.** The independent verify passed at `8e67745ac`; the merge only brought in `main`'s #607, which shares no file with this branch, and the last call re-ran the specs, the wider pos-hub and notifications suites, the typecheck, lint, claims, guards and gate scan on it.
- **The switch holds for this note and the team broadcast only.** Every other note written through the funnel still pushes a person whose switch is off (`notifications.service.ts:805` reads no preference). The founder's option text calls that a "separate, known fix". It is known in part: `v3.0-TECH-DEBT.md:5533` names the funnel's leg as pushing "reading no preference" and keeps `NotesService.create` open (claims row `TD-2026-09-26-NOTES-SERVICE-DOUBLE-PUSH-OPT-OUT-BYPASS`), but no entry files the funnel-wide fix as its own item, and this lane added none (one operation per branch). [Audit fix: it is filed now, OPEN, in `tech-debt.d/2026-10-05-fix-pos-import-refusals-ring-the-bell.md`; still not fixed here.]
- **"About 3 lines" became more.** The option text estimated "About 3 lines + a test". The build added a third write group, a `pushSwitchedOff` count in the result, a switch read when the house's zone cannot be read (that path used to return early), and reworded caveats; 11 spec cases rather than one.
- **A new note is now up to three writes, not two.** The third write can fail or land late as the second can; the compare-and-set handles it the same way, and a third group that writes nothing is not said in `caveats` (the partial-write gap below).
- **Two of the four named tests fail before only on words.** (b) the switch on and (c) an unreadable read pin behaviour that did not change; at `d728b6e2b` they fail only because the result has no `pushSwitchedOff`. (a) and (d) fail on what was pushed.
- **Stubs only.** The bell write, the open note's read and both compare-and-sets ran against stub clients, never a real database or PostgREST. Push delivery and the web bell's rendering were not checked. CI has not run on this head, because nothing is pushed.
- **Cross-process races are reasoned, not run.** The spec simulates another process through a stub hook.
- **The 3 s deadline was not measured** against any till's webhook timeout. The webhook still says whether the note was filed (`filed`), a method choice recorded in the ADR.
- **The webhook's own `catch`** still returns `error.message`. This is pre-existing and not changed here.
- **Production's webhook secret.** Whether production signs with a scoped secret or the legacy one was not read.
- **Link handling was read, not run.** The web bell and the mobile app source were grepped for `dangerouslySetInnerHTML`, `linkify` and `autolink`, and none turns text into a link. Nothing was run on a device.
- **A partly failed write is not said.** If a note's pushed group writes no rows while its quiet group writes some, the result is `filed: true` with a smaller `recipients` and no caveat; the funnel logs the failure.
- **An unreadable Away register is not said either.** The note goes to every owner and manager and `AreaRoutingService` logs it, but `caveats` does not say it. Both gaps are now stated in the ADR and the doc comment, and neither is changed in code.
- **A thrown open-note read is not a fallback.** It ends as "not filed: the bell write failed" rather than falling back to a new note. supabase-js returns errors rather than throwing in normal use.
- **The second compare-and-set's error caveat has no test.**
- **No composite index.** The open-note read filters on `restaurant_id`, `type`, `group_key`, `status` and `created_at`. The only index on `restaurant_id` is `idx_notifications_restaurant`; the query plan was not read.
- **No push when a quiet window ends.** An import has no later sweep, so the row waits in the bell, unread.
- **The earlier rows' own mutations were not all re-run.** The round at `cee659a0b` mutated the parts of rows 1 and 2 it changed, and the new row. The rest of rows 1 to 6 rest on the builder's 44 mutations at `16f86742e` and the verifier's 17; that round left those code paths alone. The fix round at `8e67745ac` mutated the parts of rows 1, 2, 3 and 6 it changed, and the new row 8 (32 mutations, under "Tests").
- **Every round is verified, the minor issues stand as stated.** The verifier of `8e67745ac` passed it with three minor issues (under "Tests"). Before it, an independent verifier read `cee659a0b` (1 major, 3 minor, answered in fix round 1), then `d728b6e2b`: PASS with six minor issues, each answered or placed above. The last call re-ran the specs, the typecheck, lint, claims, guards, the gate scan and the trial merges, not the mutation probes.
- **No claims row pins the deleted-note case.** It is an open fork, so it is pinned by the jest case only; a claims row would state a decision that has not been made. [2026-10-05: answered "New note at once"; the per-hour row now pins it (`8e67745ac`).]
- **The deleted-note probe for option (b) was in-process only.** It shows the pin fails under a silent build; it says nothing about how (b) would be built across processes.
- **Fork 5 across processes is reasoned, not run.** Two processes counting the same re-sent ids into one note race on the title as before; the spec's stub hook covers one process losing, not two that add the same ids.
- **The 500 bound was not measured against a real till.** It is reasoned from F5's one-check-per-webhook case and an export re-run, not from a house's data.
- **The brief's producer pattern was not followed literally.** The reason is under "What changed and why".
- **`.planning/08-softwares/pos-bridge.md` is not edited.** Its line 247 says only that a refused check is "refused and said".
- **A person's push switch is not read** (third fork under "Forks deferred"). Someone who turned push off is pushed by this note outside quiet hours, as by every funnel note. Found at the last call; not in ADR 0281. [2026-10-05: answered "Respect their switch" and built in `f26eca63f`; now in ADR 0281.]
- **Not re-run at the last call:** the earlier rounds' mutation probes (the last call ran one new one, above), the wider suites outside `src/pos-hub` and `src/notifications` (the verifier ran them at `8e67745ac`), and the claims-row mutations.
- **The gateway boot script was not run in this worktree.** It needs `@simplewebauthn/server`, which worktrees lack; the builder's first-build run and the verifier's manual boot of `d728b6e2b` (both with a stub of that module) returned BOOT_OK. CI is the first real run.
- **[Audit fix] The README line rides on this PR, not on a small docs PR.** The founder's option text said "in a small docs PR". The fix-lane coordinator placed it here. Splitting it out would need its own branch and PR.
- **[Audit fix] The `readRole` trim mismatch is filed, not fixed.** It is unreachable while `user_restaurant_access_role_known` holds. That constraint was read in the migration (`team_access_role_is_a_known_role`), not in production.
- **[Audit fix] The funnel-wide push switch is filed, not fixed.** Of the 25 `persistForRestaurant(` call lines, only the two `skipMobilePush` callers and this note were read for a switch check. How many of the other 22 write at a priority other than `low` was not counted.
- **[Audit fix] Not independently verified.** `b5be681cc`, `c70f86b42` and `6a572b195` were checked by the builder's runs above only. The earlier rounds' mutation probes and the wider suites outside `src/pos-hub` and `src/notifications` were not re-run.
- **[Audit fix] One co-author trailer differs.** `6a572b195` ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, where CLAUDE.md asks for `Claude Opus 5`. It is not rewritten (no history rewrite); the squash message, built from this body, can carry the right one.
- **[Audit fix] Claims mutations ran in scratch copies.** The 9 mutations and 2 controls ran on copies of the three files in a scratch directory, never in the worktree. The jest "fails before" run put `fe0f31f4d`'s controller back in place for that run only.
- **Tuzlu's data was not measured.** No count of refused checks was taken on Tuzlu's data, and no production read or write was made by this lane.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
