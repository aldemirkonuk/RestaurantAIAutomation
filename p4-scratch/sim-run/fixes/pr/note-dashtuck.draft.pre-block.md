# note-dashtuck (PR #623, ADR 0290)

## 2026-10-07 20:15Z (date -u: Wed Oct 7 20:15:57 UTC 2026) — fixer, merge of main + first check of claims. NOT PUSHED.

Live head `9666b4f89` (base still `fix/dashboard-tells-the-day-true`; the coordinator retargets to `main`). Local head `21ac9254b`, worktree `/Users/aldemirkonuk/Projects/wt-fix-dashtuck`.

### Commits since the live head

- `db6555650` Merge origin/main `ca3582988`. `merge_main.sh` reported a manual conflict; merged by hand. #622 landed as the squash `5c07cfb23`, which re-adds #622's files against the old merge base `1c9eeff00`, so four files conflicted:
  - ADR 0290 and `.planning/tech-debt.d/2026-10-03-fix-dashboard-tells-the-day-true.md` (add/add): kept this branch's side, after checking that origin/main's copy + `9666b4f89`'s own diff reproduces it byte for byte (patch + cmp in the scratchpad).
  - `apps/web/src/pages/dashboard/next/SalesCalendar.tsx`: took main's side (#622's later `5a737a8e7`, "not recorded" in `--ink-4`). This lane never touched it.
  - `.planning/decisions/README.md`: took main's side; the HEAD side of the hunk was empty and HEAD had no line main lacks.
- `60d28f1a0` the `WIDE_PAGES` comment named "a shorter cell form" among the options "Counter starts tucked" beat. That was the narrow-cell question's option (answered "Keep the words, wrap"); the room question's others were stacking the side rail and no change (ADR 0290 Consequences, #622 body). Comment only; line count kept, so `WIDE_PAGES` stays at :42.
- `a5382a99f` ADR 0290 + the tech-debt fragment re-cite `counterPrefs.ts:36` (main's line) to `:42` in dated brackets, old anchor kept. `.planning/06-pages/DESIGN-FOUNDATION.md:343-352` width rule now names `/` (dated bracket); the same sentence's "each person's choice per page wins", stale since 2026-10-01, is corrected in place. ADR 0290 review-trail row 2026-10-07.
- `21ac9254b` ADR 0290 Consequences: `/` is where sign-in lands when no page was asked (`apps/web/src/pages/Login.tsx:122`), so before a person chooses, their first sight of the counter at ≥1280 px is now usually the strip. Recorded as a consequence of the founder's pick (its wording names the dashboard as a page that starts as a strip), not as a fork.

### Results at `21ac9254b`

- Files vs origin/main: 6 (`git diff --name-only origin/main...HEAD | wc -l`): the 5 before + `DESIGN-FOUNDATION.md`.
- vitest `counterPrefs.test.ts`, `HouseShell.test.tsx`, `src/pages/dashboard`: 9 files, 152 passed.
- jest `apps/api-gateway/src/common/read-whole-window.spec.ts`: 44 passed.
- Mutations (cp -p snapshot, mutate, run the two specs, restore, cmp OK each time):
  - M-a (the body's mutation 2): `/` taken back out of `WIDE_PAGES` → 2 failed / 36 passed (the new spec case and the new shell test). Re-run at the final head: same.
  - M-b: `pageKeyOf` returns `/` for every path → 10 failed / 28 passed (no other page can tuck unseen).
  - M-c: wide-page default read before the remembered choice → 3 failed (the new "keeps it open on the dashboard" case + two older cases).
- `lanecheck.sh wt-fix-dashtuck`: all six guards rc=0, files=6, ownership `[]`.
- `check_decision_claims.sh` (alone): 921 checked, 921 holding.
- `tsc -p apps/web/tsconfig.json`: 1 error, `@simplewebauthn/browser` not found (`passkeys.ts:14`), not a lane file. Not re-checked on a clean origin/main worktree this round.

### Live body: stale lines and replacements

1. `## Stacked on #622` → `## On main`
2. `Base: \`fix/dashboard-tells-the-day-true\` (#622). This branch adds 5 files on top of it:` → `#622 merged as \`5c07cfb23\`. origin/main \`ca3582988\` is merged in at \`db6555650\` (not rebased; conflicts listed in this note), and the diff against main is 6 files:`
3. `- \`counterPrefs.ts\`: the list, and its comment.` → `- \`counterPrefs.ts\`: the list, and its comment (corrected at \`60d28f1a0\`: the options this pick beat were stacking the side rail and no change; "a shorter cell form" was the narrow-cell question's).`
4. `- \`counterPrefs.test.ts\`: \`/\` is tucked at 1280, 1440 and 1920, and with a query;` → `- \`counterPrefs.test.ts\`: \`/\` is tucked at 1280 and 1920, and at 1440 with a query (\`/?month=2026-10\`);` (bare `/` at 1440 is asserted only by the shell test).
5. `- \`HouseShell.test.tsx\`: mounting \`/\` draws "The counter, tucked" and no open counter.` → `- \`HouseShell.test.tsx\`: mounting \`/\` at 1440 draws "The counter, tucked" and no open counter.`
6. `- ADR 0290: Consequences now says this shipped here, plus a review-trail row.` → `- ADR 0290: Consequences now say this shipped here and that \`/\` is the sign-in landing page; \`counterPrefs.ts:36\` re-cited to \`:42\`; review-trail rows of 2026-10-05 and 2026-10-07.`
7. `- The tech-debt fragment: its "owed" note now says the line was built here.` → `- The tech-debt fragment: its "owed" note now says the line was built here, and \`:36\` is re-cited to \`:42\`.`
8. (new bullet) `- \`.planning/06-pages/DESIGN-FOUNDATION.md\`: the width rule names the dashboard at \`/\`, and says one choice wins on every page (it said per page, stale since 2026-10-01).`
9. `It merges after #622, and is re-based onto main once #622 lands.` → delete (replaced by line 2).
10. `\`pageKeyOf\` maps only the bare path, or \`/\` with a query, to \`/\`, so no other page changes.` → `\`pageKeyOf\` maps a path to \`/\` only when it has no first segment (\`/\`, or \`/\` with a query or hash); no other route has none, so no other page changes (mutation M-b: mapping every path to \`/\` fails 10 of 38).`
11. Tests: `9 files, 152 tests passed.` → keep, add `at \`21ac9254b\`; jest read-whole-window.spec.ts 44 passed.`
12. Tests: `Mutation: ... (2 failed, 36 passed). The file was restored from a copy.` → keep, add M-b and M-c lines as above.
13. Tests: `... It is pre-existing, and #622's head shows the same error.` → `... It is not in this lane's files; re-measured at \`21ac9254b\`: the same one error.`
14. Not covered: add `- **The dashboard is the sign-in landing page** (\`Login.tsx:122\`), so a person who has not chosen now first sees the counter as the strip at 1280 px and up. The founder's pick names the dashboard as a page that starts as a strip; recorded in ADR 0290, not re-asked.`
15. Add the head line: `**[2026-10-07, fixer] Re-headed at \`21ac9254b\`.** Merges origin/main \`ca3582988\` (#622 squash \`5c07cfb23\`, #609, #649). Lines below that name \`9666b4f89\` describe the PR before the merge.`

### Not done / unverified

- Nothing pushed; body, base and retarget untouched (coordinator's).
- Not measured in the real shell or on the deployed app (unchanged from the body).
- tsc's passkeys error not re-checked on a clean origin/main checkout.
- web eslint not run (one comment-only source change).
- Never audited; this round is a fixer's check, not the gate.

Forks: none open.
