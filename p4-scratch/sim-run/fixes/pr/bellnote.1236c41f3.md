## What was wrong for the owner (Tuzlu Rüzgar, analytics walk 2026-10-03)

Tuzlu's July and August back-fill went through the generic POS import. The walk found that import reading as clean while it dropped work: A-029 found about 811 POS lines (847 pours) and 8 bottle lines that moved no stock, and nothing said so. #603 (ADR 0281, merged as `2b6782291`) made the import say what it did. Under the founder's ruling F4 it also refuses a check whose closing time is not a strict ISO-8601 instant (for example `03.10.2026`): no `pos_checks` row, no stock and no consumption are written for it.

#603's own PR body named the gap it left: *a check refused under F4 is said only to whoever sent the import.* The refusal appeared only in the HTTP response's `errors[]` and `refusedUnreadableDate`. A till posting by webhook has no person reading that response. No page or status route shows a refused check, because nothing is stored for it. An owner whose till exports dotted or slashed dates would lose those sales and their stock with no word anywhere they look.

This lane changes no Tuzlu figure. It makes sure a refusal reaches the owner. No refusal count was measured on Tuzlu's data here.

## What changed and why

- **`apps/api-gateway/src/pos-hub/refused-checks-note.ts` (new), `fileRefusedChecksNote`.** It files one bell note per import call that refused at least one check.
  - **Audience:** this house's active owners and managers only. They are read from `user_restaurant_access` filtered by `restaurant_id` and `is_active`, with role `owner` or `manager` (trimmed, any case).
    - The note is written with `onlyUserIds`, which `persistForRestaurant` intersects with the house's own members.
    - Staff, inactive people and other houses are never told.
    - No role is read from the legacy `users` row (ADR 0088).
  - **Away (ADR 0218):**
    - `AreaRoutingService.route` runs over those owners and managers with no area label. Anyone Away today is set aside and counted in `heldAway`.
    - If every one of them is Away, the owners get the row only: priority `low` (no push) and `broadcast: false` (no live ping).
    - If the Away register cannot be read, all of them are told, as the funnel does.
  - **Words:**
    - The title is the founder's own example: `3 checks not imported: date not readable` (or `1 check …`). No field name appears in it.
    - The message names the till by its registry name and quotes the first value the till sent, cut at 40 characters.
    - It names at most 10 check ids, each cut at 40 characters, then says `and N more`.
    - It says the sales and stock are not recorded and asks for the closing time to be written as `2026-10-03 21:00`.
  - **Bell row:** type `pos_import_refused`, priority `high`, link `/connections`.
  - **Never throws.** A note that is not filed never fails or undoes the import. The import result says why in words, and a `POS_REFUSED_CHECKS_NOTE_NOT_FILED` warning is logged. The possible reasons:
    - the bell is not wired;
    - the owners and managers could not be read (a failed read is never treated as "nobody to tell");
    - the house has no active owner or manager;
    - nobody could be addressed;
    - the write produced no rows;
    - the write threw.
- **`pos-hub.service.ts`: three small hunks.**
  - The constructor gains `@Optional()` `NotificationsService` (through `forwardRef`) and `AreaRoutingService`.
  - The refusal branch collects each refused check (`refusedChecks.push(check)` right after `refusedUnreadableDate++`).
  - After the loop, `fileRefusedChecksNote` is called once, and only when something was refused.
  - The result gains `bellNote: RefusedChecksNote | null`: `null` when nothing was refused, otherwise `{ filed, recipients, heldAway, notFiledBecause }`. `errors[]` still names checks only.
- **`pos-hub.module.ts`** imports `AreaRoutingModule`. It depends on the database only, so it adds no module cycle.
- **`pos-hub.refused-checks-note.spec.ts` (new): 15 cases.**
  - One note with the count, the ids and exactly the two right recipients. Staff, an inactive manager and another house's owner are left out.
  - No note and no audience read when nothing was refused, or the payload is empty.
  - 53 refusals file one note that names 10 ids and counts 43.
  - Singular wording.
  - A write that throws, a write of no rows, an unreadable audience, a house with no owner or manager, and no bell wired: each leaves the import's result intact and says why the note was not filed.
  - One manager Away; everyone Away.
  - Three wording cases.

## Tests, guards and harness (run at head `1236c41f3`, tree `ee3b4b3c5`)

- **Jest:** `jest src/pos-hub src/notifications/notification-text-is-plain.spec.ts --runInBand --forceExit` gives 14 suites, **229/229** pass.
- **Fail before, pass after:** `origin/main`'s (`2b6782291`) `pos-hub.service.ts` and `pos-hub.module.ts` were swapped in and the new spec re-run (backed up and restored, worktree clean afterwards).
  - Result: **12 failed, 3 passed** of 15. Every case that runs `ingest()` fails; the 3 copy-only cases test the new file alone.
  - At this head all 15 pass.
  - The builder and the verifier each got the same result independently, against `af7e68990`, whose tree equals `origin/main`'s.
- **Typecheck:** `tsc --noEmit -p tsconfig.spec.json` reports 0 errors once the known `@simplewebauthn/server` worktree errors are excluded.
- **Lint:** `eslint` on the 4 gateway files exits 0.
- **Claims:** `env LC_ALL=C bash scripts/check_decision_claims.sh` reports 870 checked, **870 holding**.
- **New claims row:**
  - Exits **0** at this head and **1** on `origin/main` `2b6782291`, run in `git archive` copies.
  - Mutations I re-ran myself, each exiting 1:
    - staff added to the role check;
    - `onlyUserIds` dropped;
    - `refusedChecks.push` dropped;
    - the `restaurant_id` filter dropped.
  - A control comment naming `fileRefusedChecksNote(` exits 0.
  - The builder ran 30 mutations (each exit 1) and 3 controls (each exit 0):
    - guard `>= 0`; guard dropped;
    - a second call in the loop; the call moved into the loop;
    - push removed; push moved out of the refusal branch;
    - `bellNote` dropped from the final return, the early return or the return type;
    - `notifications`, `areaRouting` or the refused list not passed;
    - either service made required;
    - `onlyUserIds` dropped; broadcast always true; priority always high;
    - Away ignored; Away routed over the whole house;
    - the `restaurant_id` or `is_active` filter dropped; staff added; every role let in; the role filter skipped;
    - `try` removed; a `throw` added; a second persist call;
    - the id bound raised or not applied;
    - `AreaRoutingModule` dropped.
  - The verifier independently ran 11 of them (each exit 1) and a control (exit 0).
- **Guards, all exit 0 at this head:** `check_adr_numbers_unique`, `check_citation_pairing`, `check_od_ids_exist`, `check_no_conflict_markers`, `check_read_columns_exist`, `check_queried_tables_exist`, `check_read_errors_not_swallowed`.
  - The builder and the verifier also ran these, all exit 0: `check_route_exposure`, `check_web_reads_gateway_dto_keys`, `check_a_count_is_recorded`, `check_sentry_pii_scope`, `check_money_states_its_currency`, `check_windowed_figures`, `check_no_seeded_defaults`, `check_test_scripts_are_real`, `check_proposal_preservation`, `check_ask_ai_is_gated`, `check_no_direct_stock_writes`.
  - Self-tests PASS for `read_columns_exist`, `queried_tables_exist`, `read_errors_not_swallowed`, `adr_numbers_unique` and `citation_pairing`.
- **`pr_audit_gate._scan_record`** returns None for the amended ADR 0281 and the new claims shard (verifier).
- **Boot:** `scripts/check_gateway_boots.sh` PASS, with a `NODE_PATH` stub for `@simplewebauthn/server`, which worktrees lack (builder and verifier). An injection probe confirmed Nest injects `NotificationsService`, `AreaRoutingService` and `LowStockAlertsService` into `PosHubService`.
- **Local Postgres harness:** not applicable. No SQL, no migration and no SQL function changed, so `pgtest.sh` was not run and `audits/bellnote-local-pg.txt` has no run to record.

## ADR and CLAIMS touched

- **ADR 0281** (amended, not new): a dated section, "Amended 2026-10-05: refused checks reach the bell".
  - It quotes the founder verbatim and says what is built, the tests, the consequences and assumptions, and forks F5–F7.
  - It also adds a status sentence, keywords and links (ADR 0218 and ADR 0262), and one new review-trail row.
  - No existing `decisions/README.md` row is edited, and no gate-owned ADR is touched.
- **`claims.d/fix-pos-import-refusals-ring-the-bell.jsonl`** (new shard): row `TD-2026-10-05-POS-REFUSED-CHECKS-RING-THE-BELL`, status `resolved`.
  - It checks: the one call after the loop; the push inside the refusal branch; `bellNote` in both returns and the return type; both services `@Optional()`; the tenant and `is_active` audience read; owner/manager only; Away applied; `onlyUserIds`, broadcast and priority wiring; try/catch with no throw; the 10-id bound; the module import.
  - It does not check the note's words, Away's own ladder, or a database write.

## Founder answer built (2026-10-05, AskUserQuestion; quoted verbatim in ADR 0281)

How refused checks reach the owner. The founder picked **"Bell note, follow-up PR (Recommended)"**. The option text he saw: *"#603 merges as is. A small follow-up files one owner/manager bell note per import with refusals ('3 checks not imported: date not readable'), with the check ids. Cost: about 4–6 files, its own audit."*

How the build matches it:
- one note per import call with refusals, never one per check, and none without refusals;
- owners and managers only;
- the title is his example;
- the check ids are carried, bounded at 10 plus "and N more";
- 6 files.

## Forks deferred (recorded in ADR 0281's amendment; not decided here)

- **F5. A till that sends one check per webhook.** As built, every call that refuses a check files a note and a push, so such a till files one per refused check. A re-sent export files again; there is no dedupe window.
  - (a) Keep it.
  - (b) One note per till per window (an hour, say), counting later refusals into it.
  - (c) For webhook imports, a bell row only, no push.
  - **Recommendation: (b).** It keeps one note per file import and stops a flood from a webhook till. It costs one read of the open note before each write.
- **F6. Push and quiet hours.** As built, the note is priority `high` and pushes at any hour. Quiet hours are not read.
  - (a) Keep it.
  - (b) A bell row only, never a push.
  - (c) Push outside the person's quiet hours, and write the row only inside them.
  - **Recommendation: (c).** It honours quiet hours people already set. It costs a read of each recipient's preferences and the house's time zone per note.
- **F7. Where the web bell files it.** Today the web bell shows `pos_import_refused` under "Other" (`nt-format.ts:123`).
  - (a) Keep it.
  - (b) A one-file web follow-up gives it a register.
  - **Recommendation: (b).**

## Merge order and stacking

- **#603 has merged.** This branch was built stacked on #603's head `af7e68990`. #603 squash-merged as `2b6782291`, whose tree is identical to `af7e68990`'s.
  - Instead of rebasing, `origin/main` was **merged** into this branch at `1236c41f3`, so no history was rewritten.
  - The conflicts were an add/add on ADR 0281 and the `ingest()` hunks. Main's side of each file equalled `af7e68990`'s blob, so each was resolved to this branch's side.
  - The merged tree `ee3b4b3c5` equals `1af0bb4d1`'s tree and equals `git merge-tree --merge-base=af7e68990 origin/main 1af0bb4d1`.
  - Against `origin/main` the PR is the lane's **6 files**.
  - The `1af0bb4d1` commit body still describes the planned rebase; the merge commit says what was done instead.
- **#605** shares no file with this lane. "After #603 and #605" in the brief is a queue position, not a code dependency.
- **#618** (`feat/a-check-carries-its-channel`, booth PR-1, ADR 0302) also edits `pos-hub.service.ts`. This lane's hunks there are small:
  - two constructor parameters;
  - one line in the refusal branch;
  - the `bellNote` call before the final return, plus `bellNote` in both returns and the return type.

  `git merge-tree` of this head with #618's head `82890ebb7` auto-merges `pos-hub.service.ts` cleanly. That trial's only conflict is `scripts/sql_outside_migrations.txt`, which is between #618 and #603's content; this lane does not touch it. Whichever of the two merges second must carry the other's hunks.
- No other open PR touches these 6 files (checked with `gh pr view N --json files` over every open PR).

## Not covered (said plainly)

**Not run or not proven here**
- **The bell write was not run against a database.** Every spec runs `ingest()` and the note against stub clients. Real push delivery and the web bell's rendering were not checked, in a browser or otherwise.
- **The boot check passed only with a `NODE_PATH` stub** for `@simplewebauthn/server`. I did not re-run it at the merge head; the tree is identical to the one it passed on.
- **Tests were targeted.** I ran the pos-hub specs and `notification-text-is-plain` (229). The full gateway jest suite was not run, and CI has not run, because the branch is not pushed.
- **I re-ran 4 claims mutations and 1 control myself.** I did not re-run the builder's other 26 mutations or the verifier's 11; they are reported as they reported them.

**Behaviour as built**
- **Quiet hours are not read, and there is no dedupe.** A 3 a.m. webhook refusal pushes at 3 a.m., and every refusing call files again (F5 and F6, deferred).
- **A legacy-only owner is not told.** An owner known only through the legacy `users.role`, with no active `user_restaurant_access` row, gets no note. This is deliberate per ADR 0088 and stated in the ADR, and it fails in the safe direction. The sibling helper `VendorSendAuthorityService.ownersAndManagers` does fall back to the legacy role.
- **`bellNote.notFiledBecause` can carry a raw database or exception message** back to the caller of the webhook or import. `errors[]` already returns per-check database messages the same way, so this adds one more place, not a new kind of exposure.

**Checks and docs**
- **The claims row checks code structure only.** It does not check the note's words, Away's own ladder, or a real database write. The jest spec covers the first two with stubs.
- **`.planning/08-softwares/pos-bridge.md:247` is not updated.** It still says only that a refused check is "refused and said", which is true but no longer complete. ADR 0281 records the bell. It was left to stay within the brief's 6-file budget.

**Process**
- **No SQL changed**, so the local Postgres harness had nothing to prove and was not run.
- **The builder ran `git stash list` once, read-only**, before a compaction. Nothing was changed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
