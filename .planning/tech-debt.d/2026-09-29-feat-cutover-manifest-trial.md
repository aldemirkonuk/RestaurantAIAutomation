## /team's windowed-figures guard lists four legacy files and misses three rebuilt ones that query — ~~OPEN~~ CLOSED on #494 — 2026-09-28

**Closed 2026-09-29.** The founder approved the `team` group ("merge all five", #494 included), and the guard change described below landed on #494 itself: the four legacy renderers dropped, the three rebuilt files listed, bare factory-call keys read, the self-test retargeted by file name (93 cases ok). CLAIMS `TD-2026-09-28-TEAM-WINDOWED-GUARD-UNLISTED-QUERIES` is resolved (`claims.d/feat-cutover-manifest-trial.jsonl:3`).

Found while fixing PR #494 (the ADR 0149 trial cutover), whose `team` group deletion made
`scripts/check_windowed_figures.py` exit 2 (CANNOT CHECK).

**What.** The /team `PageSpec` (`scripts/check_windowed_figures.py:395-447`) lists twelve
renderers. Four are the legacy desk (`pages/team/command/ManagerShiftDesk.tsx`, `MyShifts.tsx`,
`OpsRulesPanel.tsx`, `PerformancePanel.tsx`, `:417-420`), which the manifest's `team` group
deletes. Its comment (`:439-445`) says every /team query "is a `useQuery` in one of the TWELVE
files above". That is not true on `main` either. Three rebuilt-half files call `useQuery` and are
not listed: `pages/team/next/FormerStaff.tsx` (1 call), `SendGrantsSection.tsx` (1) and
`useHouseAreas.ts` (2). W6 never reads their keys. All four keys carry the tenant today
(`['team-next-former-staff', rid]`, `grantKeys(restaurantId)`, `areasKey(rid)`, `awayKey(rid)`).
So this is a surface nobody checks, not a leak.

**Why it is not fixed on #494.** The guard's header says the fix is not to drop anchors
until it goes green (its "REGISTERING A PAGE MEANS GIVING IT FIXTURES" section). The fix
is one reviewed change that does three things together:
- drops the four legacy renderers once the founder approves the `team` group;
- adds the three missing files;
- retargets the self-test cases that still write into the legacy fixtures by tuple index (`_TEAM.renderers[1]`, `[3]`, `[4]`), along with their names.

That change was not made on #494. The `team` group's fork in
`07-reference/deploy/CUTOVER-MANIFEST-2026-09-28.md` §7 carries it.

**Tracked by** CLAIMS `TD-2026-09-28-TEAM-WINDOWED-GUARD-UNLISTED-QUERIES`, which is open. It
holds, and so fails the build until the row is struck, once every `team/next` file that calls
`useQuery` is named in the guard. Mutation-tested 2026-09-28 against a stub that names all
seven files: it holds.

**Severity:** low. The three unlisted files' keys are correct today. The risk is a future
regression in them that W6 would not catch.
