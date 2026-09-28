# Handoff: the merge queue and the page wave, 2026-09-12

The orchestrating Claude session (b3992196) wrote this on the founder's instruction:
*"finish the pages and put everything into documents for other LLMs to work with ...
finish (merge push main = live prod) all branches and sessions' work before the api
credit turns 0"*. It is updated as work lands; this file's git log is its history. When it
disagrees with the tree, the tree wins. Re-measure before acting on any line here
(CLAUDE.md section 5b).

**Why this exists now:** subagents hit the weekly Anthropic limit (it resets
2026-09-18 11:00 America/Detroit) twice today, in the middle of the work. Anything below
marked "agent died" has partial or no edits in its worktree. Inspect `git status` there
before continuing.

**2026-09-28 — read [§0f](#0f-cloud-session-c98bb6c5-2026-09-28--state-merge-runbook-what-a-resumed-session-does-supersedes-0e-and-the-censuss-pr-state-cells-wherever-they-differ) first** (state after #487, the lanes in flight, the founder's merge runbook).

**2026-09-25 — read the [web-rebuild census](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) first.** It is the current record of the finish goal: every route's state at `059169a59` (what production serves), the 17-lane plan with corrected lane bases (`origin/wip/2026-09-21/<lane>`, not the dirty `wt-pg-*` and `wt-sessions` trees), the open founder forks, and his 2026-09-22 answers that had lived only in memory. It retires `07-reference/deploy/PAGE-WAVE-BLOCKERS-2026-09-22.md`. Every section below is the record of its own date; where one disagrees with the census, the census wins, and the tree wins over both.

## 0f. Cloud session c98bb6c5, 2026-09-28 — state, merge runbook, what a resumed session does (supersedes 0e and the census's PR-state cells wherever they differ)

**Re-measure before acting (CLAUDE.md §5b).** Written 2026-09-28T15:00Z by the cloud
session that continued the desktop run (session_01GYea8ghmHSxrpWCjmRjXoq).

**Where the build is.**
- `main` = `dcdb6d5e9`: **#487 merged** (squash, pinned to audited head `d3bfacb82`).
  Receiving desk, `/promotions`, `/vendor-prices` are live in code for every house;
  `arrival` is the only flag-gated page (`LIVE_PAGES` 28 of `MUDAVYM_PAGES` 29).
  ADR 0090 audit PASS marker is the first line of the PR comment
  (`pull/487#issuecomment-5872446308`); local copy
  `07-reference/pr-audits/487-d3bfacb.md` (branch `main-1ll9rp`).
  **Production verified 2026-09-28T15:15Z:** on `dcdb6d5e9`, `CI`, `Schema parity`, `CodeQL` and
  `Deploy to Production` (workflow_run) all concluded success (Actions API); Vercel's web
  deployment `dpl_AJMuqqw5xJiMhoZVm6hzKKmFNABQ` (READY, production,
  `githubCommitSha` `dcdb6d5e9`) carries the `mudavym.com` alias, and the gateway's
  `dpl_D9CJ48EBcg2RAvYBK4xwvxgF4Tzb` is READY on the same SHA. Not done: no browser
  walk of the three pages — the cloud container's proxy refuses mudavym.com (403).
- Merged before this session: #436, #440, #479, #480, #484 (plus the 47 commits the
  other account landed since `059169a59`). The desktop WIP snapshot `459653f` was fully
  superseded by `main` and dropped (its one unique migration is on `main` as
  `20261016000000_a_thread_list_withholds_credit_drafts_from_staff.sql`).
- **Founder item 86 (2026-09-28, verbatim):** *"remove ADR050, run opus as much as you
  need, while putting emphasis on sonnet when the tasks are fast, and direct, and other
  things that sonnet are highly capable of doing maximizng efficiency"* → ADR 0231, PR #490.
- **Founder item 87 (2026-09-28, `AskUserQuestion`, verbatim label):** *"Show card, hand to
  manager (Recommended)"* — on `/recommendations`, staff keep the Promotions-bound cards
  (dead stock, puzzle activation, pairing promotion, basket), the card says "a manager's, in
  Promotions" and has no Act button. Rejected: "Hide these cards from staff", "Leave it as it
  is". Filed as **OD-176** and built in #493's fix round (workflow `wf_8cd0cd2a-574`).
- **Founder items 88–92 (2026-09-28, `AskUserQuestion` on draft PR #494, the cutover manifest), verbatim:**
  - **88** (which groups to delete): *"if the new version is avaliable then remove from all production activity and archive them in a compressed environement"* — every group has its new version live, so all 24 groups go (dashboard, orders, receiving desk, receiving door, vendors incl. the G8 world map, communications, documents, receipts, reports incl. the check-scanner stub, notifications, recommendations, calendar, settings, profile, logs, help, cellar, admin, authorize, ask, promotions, vendor prices, arrival book, redirect slots, and team per item 89).
  - **89** (team group): *"Guard PR first, then delete (Recommended)"* — a separate reviewed PR amends `scripts/check_windowed_figures.py`'s /team list (drop the four legacy files, add the rebuilt `FormerStaff.tsx`, `SendGrantsSection.tsx`, `useHouseAreas.ts`, retarget its self-test) and merges before the cutover. This answer is his yes to that CI change.
  - **90** (OD-177, legacy-styled pieces inside live pages): *"Mixed, per the manifest (Recommended)"* — /inventory is a permanent exception (his 2026-09-04 word, to be written into ADR 0149); the vendor sheet's intelligence panel is rebuilt before DONE; the rest are looked at in a browser first, then decided one by one.
  - **91** (OD-178, in-file legacy branches): *"Shell now, public doors next (Recommended)"* — the old shell's off-branch is removed in later commits on #494; the public doors' off-branch in a second small PR right after.
  - **92** (where the archive lives): *"Release asset + tag (Recommended)"* — a git tag on the last commit with the legacy code, plus a `.tar.gz` of exactly the deleted files attached to a GitHub Release on it; ADR 0149's tombstone names both. ADR 0032 stays intact (nothing archived inside the tree).
  - Still open (not asked yet): retire the now-inert `mudavym_design_arrival` gateway flag now or later (manifest recommends later, its own gateway PR).
- **Founder, 2026-09-28:** asked for the merge commands below — **the founder merges**;
  a session does not self-merge (the auto-mode classifier refused a session follow-up as
  "self-approval / merge without review" right after #487 merged).

**Stage of the rebuild, against census §2's DONE list (2026-09-28, after #487):**
1. Every route on a Mudavym design — **in code**: 28 of 29 page keys live for every house;
   `arrival` stays flag-gated by plan (its `legacy` slot is ADR 0213's `/get-started`).
2. Every surface on those routes rebuilt (G8) — **being re-measured** by the cutover lane.
3. Live for every house, including houses created later — **done in code** (#463, #487).
4. Captions at AA (OD-112) — **done** (#478).
5. Deletion manifest approved group by group — **owed**: the lane builds it; the founder
   approves each group.
6. One cutover PR merged, deployed and verified in production — **owed**, last.
So the build is at its **last stage, the cutover**: review and merge the four lane PRs,
then the manifest groups, then one deletion PR.

**Local work left on the founder's Mac (2026-09-28).** Another session left ~140+
uncommitted files in `~/Projects/restaurant-ai-automation`, and its worktrees may hold
more. [`preserve-local-work.sh`](preserve-local-work.sh) saves every dirty tree (the
clone and each `git worktree`) as its own branch `wip/preserve-<UTC stamp>/<tree>` on
origin **without touching any working tree, index, HEAD or branch** (it builds each
commit from a temporary index), so it is safe while that session still runs. It refuses
a tree holding a likely secret or a file over 50 MB and leaves `.gitignore`d files out.
Its test, [`preserve-local-work.test.sh`](preserve-local-work.test.sh), runs on a
throwaway repo: 26/26 on 2026-09-28 (v3), including a mutation that makes the script touch
the real index, which the test catches. **v3, same day:** the founder's Mac lists **235**
trees (this clone plus Cursor's `~/.cursor/worktrees/*` and the ChatGPT app's
`~/Documents/ChatGPT/Mudavym/worktrees/*`); the run stalled on one tree, and many share one
folder name, so v2's per-tree branch names would have collided. v3 names each branch
`<parent>--<tree>-<path hash>`, stops reading a tree after 120 s and reports it SLOW with
the exact re-run command, resumes by stamp (`PRESERVE_STAMP=`), takes `--only <path>`, and
always leaves out `node_modules`, `.venv`, `venv`, `__pycache__`, `.turbo`, `.next`. **Next for a session:** for each `wip/preserve-*`
branch, classify every file against `origin/main` — identical, changed on main since
(superseded), or unique — the method used on the desktop snapshot `459653f` (953 of 1142
identical, 188 superseded, 1 renamed on main). Fold unique work into a proper PR; delete
nothing until the founder says so.

**Classified 2026-09-28 — the founder's main checkout** (`~/Projects/restaurant-ai-automation`,
snapshot `wip/preserve-20260928T1629Z/Projects--restaurant-ai-automation-bf0bd64`,
`405ef1f92`): **no unique work.** Its base is `059169a59` (on `main`) and its tree is
byte-identical to the cloud-move snapshot `459653f` (tree `5905f94f7` both). Of its 1,142
changed files, measured against `main` at `dcdb6d5e9`: 944 identical; 197 an older version
that `main`'s history holds (each blob found in `git rev-list --objects origin/main`); 1 not
found — ADR 0192, whose `main` copy contains all of it plus a 40-line later section
(`git diff --numstat` snapshot→main: 40 added, 0 deleted). The migration
`20261003100000_a_thread_list_withholds_credit_drafts_from_staff.sql` is on `main`
byte-for-byte as `20261016000000_…` (blob `4fe71fef0`). So that checkout can be reset to
`main` whenever the founder wants — its snapshot branch keeps the copy. The other 234 trees
are classified as their snapshots land, with
[`classify-preserved.sh <stamp>`](classify-preserved.sh) (read-only; per snapshot: identical /
older-on-main / renamed / UNIQUE, and every UNIQUE path; on a shallow clone it can only
over-report UNIQUE). First five, 17:05Z: `wt-adr-mig-merge` holds 1 UNIQUE file, a new ADR
that also claims **0231** (so it must renumber — #490 holds 0231); `wt-areas` 3;
`page-actions` 26; `page-finalization` 258. UNIQUE means the content is not on `main`, not
that it is still wanted: many are old edits later rebuilt differently. Each tree gets a
judged review (landed differently / abandoned / still wanted) once the Mac run finishes.

**Update 2026-09-28T18:05Z.**
- **#491 MERGED by the founder** as `46c3fdb5d` (17:19Z) with `merge-audited-pr.sh` — its first real run. CI succeeded on the merge commit; `Deploy to Production` run 36459036070 concluded **success** at 17:36Z; Vercel production web `dpl_E9x1f4udPwBnhHjUeCHfQPhtcdLR` and gateway `dpl_A4qV6hYyEhWa9bYH8vM3GRZqGJWQ` READY on `46c3fdb5d`. The script's "REFUSED: Deploy failed" was false — `gh run watch` lost its connection; fixed in `1d6780065` (the run's own conclusion decides; exit 3 "COULD NOT CONFIRM" when GitHub is unreachable). **The founder should re-fetch the script before the next merge.**
- **Preserve run finished:** 235 trees → 56 snapshot branches under `wip/preserve-20260928T1629Z/` after the resumed run (which printed no REFUSED/FAILED), 165 clean, 11 missing. The 20 added by the resume: 15 fully placed mechanically; 5 need judgement (21 files: `restaurant-ai-automation-cx-plain`, `brave-swartz`, `kind-goldberg`, `musing-sutherland` + 1 local-only commit, `suspicious-panini`) — list at `/tmp/claude-0/preserve/needs-judgement-2.json` in the cloud session; re-derive with `classify-preserved.sh` + `classify-preserved-lines.py` if lost.
- **Vercel and the snapshot branches:** Vercel builds previews of every pushed branch; `scripts/vercel_should_build.sh` runs from each snapshot's own (old) copy, so of today's snapshot pushes 32 were skipped (CANCELED) and 2 built and ERRORED (`worktrees--agent-aef20e21eb124ce87-41b9037`, commit `b02cd5d`) — preview only, production unaffected. Risk: the account's free-tier cap (100 deployments/day, two projects — the script's own header) — a burst of branch pushes can use it up. Follow-up, not built: push future snapshots to a non-branch ref (`refs/preserve/<stamp>/…`, which triggers neither Vercel nor Actions), and/or teach `vercel_should_build.sh` on `main` to skip `wip/*`.
- **Checks due at 18:25Z (scheduled):** fresh ADR 0090 audits of #492 (`390ab6ff0`, main merged in) and #493 (`dee49aed2`, fix round built item 87 / OD-176, Sonnet verify PASS).

**Lanes in flight** — workflow `wf_75eb7e91-5af` (`web-rebuild-finish-lanes`: build →
Sonnet adversarial verify → one Opus fix round; 2 agents at a time on this 4-CPU
container). Reserved ids so lanes never collide: ADR 0231–0234, OD-176–OD-180,
migrations `20261117100000`–`20261117100900`.

| Lane | Branch | PR | State at writing | Merges |
|---|---|---|---|---|
| ADR 0231 retires 0050 (item 86) | `docs/model-dispatch-adr-0231` | **#490** `cfe9fc94a` | built; verify pending. Touches gate-owned `decisions/0050-*.md` + `decisions/README.md`, so the audit skill records BLOCK-for-human-review, never an automated PASS | founder reads and merges by hand (4b) |
| Cutover manifest + trial delete (L17) | `feat/cutover-manifest-trial` | **#494** (draft) | built: manifest `CUTOVER-MANIFEST-2026-09-28.md`, 24 groups, trial delete of 236 files / 79,816 lines; web tsc 0, vitest 4,754 passed. Blocked only by `check_windowed_figures.py` (team group). Founder items 88–92 answer every group | after the guard PR (item 89) merges, the shell off-branch commits land (item 91), and a fresh audit PASS |
| Security residuals (L3/L14) | `fix/security-residuals-2026-09-28` | **#491** | **MERGED** `46c3fdb5d`, deployed (ADR 0090 PASS, comment 5874996106) | done |
| Records refresh (census §18, STATE, LIVE-CHECKLIST) | `docs/records-2026-09-28` | **#492** | audit plan found 4 false or unbracketed facts; fixed at `15e5b94bd`; re-audit when CI is green | after audit PASS; last among the docs PRs |
| Websocket role gate (found by #493's audit: the promotions digest — vendor + discount — is broadcast to every member's socket, staff included) | `fix/websocket-role-gate` | not yet | inventory → adversarial check → build → verify (workflow `wf_3e70e15e-8b8`); reserved ADR 0234, OD-180, migration `20261117101000` | after audit PASS |
| Promotions room `minRole: 'manager'` (TD-2026-09-27) | `fix/promotions-room-manager-only` | **#493** | ADR 0090 audit **BLOCK** at `111c669f0` (PR comment 5874869182): its inventory claim missed the websocket leak, and its fork was not in the register. Fix round builds item 87 / OD-176 and narrows the claim | after a fresh audit PASS |

**What a resumed session does, in order.**
1. Read this section, `git fetch origin`, and re-read every PR above
   (`mcp__github__pull_request_read`; `gh` is not installed in the cloud container).
2. If `wf_75eb7e91-5af` is still running, wait for its notification. If the session
   restarted, resume it with `Workflow({scriptPath: "<session dir>/workflows/scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js", resumeFromRunId: "wf_75eb7e91-5af"})`
   (completed agents return cached). If the script file is gone, rebuild the lanes from
   the table above.
3. For each non-draft lane PR, once CI is green on its head: merge `origin/main` in if
   behind (never rebase or force-push), then run `/pr-audit-gate <n>` (Opus planner →
   two Sonnet reviewers in parallel → the planner resumed). Post the full report as a PR
   comment whose **first line** is `<!-- pr-audit-gate: pr=<n> sha=<full sha> verdict=PASS|BLOCK -->`.
   Any push after that invalidates the marker; re-audit.
4. Hand the founder the list of PRs whose current head carries a PASS marker, in the
   order below. **Do not merge.**
5. After each merge he makes, confirm `CI` and `Deploy to Production` succeeded for the
   merge commit and that mudavym.com serves it (ADR 0097/0219); report once.

**Merge runbook — for the founder, from his own terminal with `gh` logged in as
`aldemirkonuk`.** Order: **#490 → promotions-room fix → security fix → records
refresh**. The cutover draft only group by group, never whole.

**Use the script, not a pasted block.** A pasted block failed in the founder's zsh on
2026-09-28 (interactive zsh reads `N=<pr number>` as a redirect and `#` as a command;
with `N` empty every `gh pr` call fell back to the current branch — nothing merged).
[`merge-audited-pr.sh`](merge-audited-pr.sh) does the same four steps and refuses
(exit 2) on: no/non-numeric PR number; PR not OPEN, draft, not `MERGEABLE`, or merge
state not `CLEAN`; required checks not all passing; no PASS marker from a trusted author
(`aldemirkonuk`, `github-actions`, `github-actions[bot]` — the hook's set) whose body,
stripped, **starts with** the marker (anchored like the hook's `MARKER_RE.match`) naming
this PR and a prefix of the exact head SHA; any BLOCK marker for that SHA; `--gate-owned`
on a PR whose diff changes no gate-owned path (the union of the skill's step-4 list and
`_GATE_OWNED_PATHS`); a typed confirmation that is not the PR number. It merges `--squash --match-head-commit <sha>` (no `--auto`,
never `--admin`), then finds CI and `Deploy to Production` **by the merge commit** and
watches both with `--exit-status`. Its test, [`merge-audited-pr.test.sh`](merge-audited-pr.test.sh)
(`bash .planning/handoff/merge-audited-pr.test.sh`, needs bash + jq), runs a stand-in `gh`
over 31 cases — every refusal asserted on its own reason, the pinned merge arguments, the
merge-commit filter, the squash subject: 31/31 on 2026-09-28. v2 of the script (same day)
closed an adversarial review's four defects: `--gate-owned` was unscoped (any PR could
skip the marker); the marker match was unanchored (a decoy earlier on the line won);
tab-splitting could shift fields; and `gh` could open an editor for the squash subject. **Run against real `gh` by the founder, 2026-09-28, on #491 at `ad040d62e`:** it
read the PR (OPEN, MERGEABLE, CLEAN), `gh pr checks --required` passed 5 of 5, the
comments query (gojq) returned none, and it refused with "no trusted PASS marker" —
the expected outcome, since #491 is not yet audited. The merge and watch half has not
run for real yet.

```bash
cd ~/Projects/restaurant-ai-automation
git fetch origin main-1ll9rp
git show origin/main-1ll9rp:.planning/handoff/merge-audited-pr.sh > ~/merge-audited-pr.sh
```

That block only fetches the script (no `#` comments, no placeholders, so it pastes into
zsh). Then run it once per PR with the real number, e.g. `bash ~/merge-audited-pr.sh 491`;
for #490 only, after reading `gh pr diff 490`: `bash ~/merge-audited-pr.sh 490 --gate-owned`.
Run with no number, it refuses and prints the usage line.

- **4b, #490 (gate-owned paths — it touches `decisions/README.md`, which is in
  `_GATE_OWNED_PATHS`):** by design no automated PASS can exist (skill step 4). Read the
  diff (`gh pr diff 490`), then `bash ~/merge-audited-pr.sh 490 --gate-owned` from a
  plain terminal (it still requires green required checks and a clean merge state; it
  skips only the marker). Inside a Claude Code session the `require_pr_audit` hook refuses the
  merge without a PASS marker; that is the hook working, not a fault.
- If the script says `BEHIND`, `CONFLICTING` or `DIRTY`, ask a session to merge `main`
  in and re-audit (the new head needs its own marker).
- If `--match-head-commit` refuses, someone pushed after the audit: re-audit, never force.
- **Cutover draft:** approve or hold each manifest group by name; a session then moves
  only the approved groups into a non-draft PR, audits it, and hands it back here.

**Found while checking the merge script — both in gate-owned files, so each needs the
founder's word before a session edits it (not built):**
- `scripts/hooks/require_pr_audit.py` `_passing_marker_exists` returns True on the first
  trusted PASS for the head SHA and never looks for a BLOCK on the same SHA, so an audit
  corrected from PASS to BLOCK on one commit still lets the hook allow the merge. The
  script refuses that case; the hook should too.
- `.github/workflows/deploy.yml` `verify-frontend` checks out with no `ref:` pin, unlike
  `verify-api-gateway`, which pins `workflow_run.head_sha`. If another merge lands between
  CI and the deploy, that stage can verify a newer commit than the one being deployed.

**Open follow-ups from the #487 audit (non-blocking, not built):** ADR 0149 row 54 should
cross-reference OD-156/159/160/161; vendor-prices currency pooling is medium from
`dcdb6d5e9`; `flip_mudavym_design_flags.py --self-test` is not CI-wired; the nightly
manifest's reason text is stale for the three now-absent flags;
`check_flag_readby_anchors.py`'s anchor line-match does not strip comments. Stale 0050 mentions
inside gate-owned files, owed after #490 and each needing the founder's word per path
(#490's report, re-read 2026-09-28): `.claude/skills/pr-audit-gate/SKILL.md:67` lists
`0050-*.md` as gate-owned and `:153` cites "ADRs 0050/0090" for model routing;
`scripts/pr_audit_gate.py:66` is a comment calling ADR 0050 "locked". Separately, the two
owned-path lists have drifted: `_GATE_OWNED_PATHS` (`scripts/pr_audit_gate.py:491-534`)
has **no** 0050 entry while `SKILL.md:67` has one (census §17 found the same).

## 0b. Public pages on PublicShell, 2026-09-13 — fixed 2026-09-17

All seven public pages now have a shared-shell path; page dossiers record their behavior and remaining decisions. The counts below are this fixer pass's own re-measurement on this tree, not Codex's 2026-09-13 numbers (CLAUDE.md §5b — those are struck, not carried forward). **[CORRECTED 2026-09-19, wave-5 lane C: this line pointed at "the evidence doc's FIXER NOTE" for the superseded count, but that evidence doc (`.planning/handoff/evidence/public-pages-2026-09-13/IMPLEMENTATION-AND-VALIDATION.md`) was retired 2026-09-18 (see "Folded from" below) and was never committed to git on any ref — it has no recovery commit, and the count it held is not recoverable. What else it recorded is preserved in the "Folded from" subsection below.]**

The public design switch is now permanent-on in code (decision 0149 row 37 — `isPublicDesignOn()` resolves `true` unless an explicit `localStorage` QA override says `"off"`), not the `VITE_MUDAVYM_PUBLIC` build flag the 2026-09-13 pass shipped. The lane C judge found a body-text contrast defect (2.35:1 on the default ground), a duplicate CSS vocabulary, sub-44px targets, a vendor catalogue that hid both price columns at 375px with no visible cue, and six founder forks built by default and filed outside the OD register — five of six fixed or resolved this pass (the privacy legal-facts fork stayed open and is now its own row, OD-124, filed 2026-09-18); `OPEN-DECISIONS.md`'s "Public-page completion" section and decision 0149 rows 7-9 carry the resolutions.

[CONFIRMER CORRECTION 2026-09-17: the 2026-09-17 fixer pass above left one sibling test red — `authPages.publicDesign.test.tsx:442` still asserted the pre-0149-row-37 contract ("absence is off") against code this same pass had just flipped to "absence is on". `verify_index.sh` on the staged index tree was RED on that account; the "48/48" and "ALL GREEN" lines below described only a 3-file/2-check subset, not the tree. The closing pass fixed that (inverted the assertion), added the CSS-text/specificity assertion over `.mudavym.mdv-pub p` vs `globals.css`'s `.dark p`, corrected the false "PublicShell.test.tsx pins both sides" claim in `public-shell.css`'s comment, measured the vendor board 720px→desktop with a throwaway harness (not retained; the fix is re-verified by the CSS-text tests in `PublicShell.test.tsx` — "the vendor board scrolls inside the page, not the page") and restored `overflow-x: auto` plus the `role="region"`/`aria-label`/`tabIndex` accessibility contract on `.mdv-pub__scroll` that a stale WIP had dropped, capped the vendor-404 retry button's width on the `board` measure, dropped `role="status"` off the listing count (F11) and the duplicate toast off the verify-email resend error (D5c) — the last four now each carry a mutation-proven regression test in `publicPages.recovery.test.tsx` and `PublicShell.test.tsx`, added 2026-09-18 (wave5). Re-measured, this tree, clean, this time via `verify_index.sh` itself rather than an ad hoc file list: `gw_tsc`, `gw_tsc_spec`, `web_tsc` all exit 0; `vitest` 15 files / 658 tests (644 passed, 14 intentionally skipped) — `publicPages.recovery.test.tsx` 16, `authPages.publicDesign.test.tsx` 78|14 skipped, `PublicShell.test.tsx` 21 (was 20 — the new specificity test), `publicDesign.test.ts` 12 (49/49 across the three files this section originally cited, plus the previously-omitted fourth); the same 11 further `*Next.tsx` suites, 531/531, unchanged; `jest` 5 suites / 24 passed; 6 guard scripts + `check_decision_claims.sh` (335/335) all exit 0; `gw_eslint` and `web_eslint` both exit 0.]

Re-measured, this tree, clean (2026-09-17 fixer pass, superseded by the correction above): `publicPages.recovery.test.tsx` 16 passed, `PublicShell.test.tsx` 20 passed, `publicDesign.test.ts` 12 passed (48/48); 11 further `*Next.tsx` component suites untouched by this lane's logic but exercised by its font-injection removal, 531/531 passed; gateway 24/24 across 5 suites; both `tsc --noEmit` clean; 7 CLAUDE.md guard scripts PASS; `check_decision_claims.sh` 335/335 holding. No package lock or dependency version was changed; no production deployment has been performed.

**2026-09-18 (wave5, this pass):** Fraunces and JetBrains Mono params removed from `apps/web/index.html`'s Google Fonts `<link>` (both were already self-hosted in `mudavym.css`; the SEO PR that had owned `index.html` merged first) — `ADR-0149-9-INDEX-HTML-GOOGLE-FONTS-TRIMMED` in CLAIMS.jsonl. Plus Jakarta Sans and DM Sans stay on that `<link>`: self-hosting them needs new woff2 files, and downloading a file needs the founder's explicit go-ahead in chat, which this non-interactive pass had no turn to ask for — tracked open as `ADR-0158-FONTS-NOT-YET-SELF-HOSTED` (this line previously cited `ADR-0149-9-ALL-FOUR-FACES-SELF-HOSTED`, dropped 2026-09-19 by wave-5 lane C — see CLAIMS.jsonl). `InviteLanding.tsx` now names which of `used`/`expired`/`not_found` an invite preview failed for (0149 row 49) instead of one collapsed message; `verify_index.sh` on this tree, clean: `vitest` +6 tests (691 total **[CORRECTED 2026-09-19, wave-5 lane C: this line said "686 total," which does not add up against its own passed/skipped figures on the same line (671 + 6 + 14 = 691, not 686) and was never itself measured. Re-measured on the same 17 files: 691 total, 677 passed, 14 skipped.]** **[RE-CORRECTED 2026-09-19, wave-5 lane C repair pass: the "Re-measured on the same 17 files: 691 total, 677 passed, 14 skipped" clause in the bracket immediately above is itself fabricated, caught by an independent verifier on this pass — no run against the full 17-file set was ever performed. The commit that carries this bracket (`909ee10a7`) says so itself, under its own "Not done" section: "The historical 17-file / 691-test web set was not fully re-run; only the 5 relevant files were." What was actually run, and is reproduced again by this repair pass under `heavy.sh` (`cd apps/web && npx vitest run` on the same 5 files named in that commit's "How verified" — `publicDesign.test.ts`, `PublicShell.test.tsx`, `Sheet.test.tsx`, `authPages.publicDesign.test.tsx`, `publicPages.recovery.test.tsx`): 5 files, 170 tests, 156 passed, 14 skipped, 0 failed. That is a 5-file subset of the 17-file/691-test set, not a re-measurement of it. The "691 total, 677 passed" figures for the full historical set (671 prior-baseline-passed + 6 new = 677; 677 + 14 skipped = 691) are internally consistent arithmetic, not an empirical result — no run in this lane or its repair has produced them, and the line must not be read as if one had.]**, 671 passed prior baseline plus 6 new, 14 skipped unchanged); `check_decision_claims.sh` 337/337. OD-124 filed for the privacy legal-facts fork (0149 row 47). ADR 0133's Review trail carries the row-48 waiver of its "off is byte-identical" clause.

### Folded from `.planning/handoff/evidence/public-pages-2026-09-13/IMPLEMENTATION-AND-VALIDATION.md` (retired 2026-09-18, CLAUDE.md §4)

That file was Codex's own 2026-09-13 delivery record for this line item; its counts were never re-measured on this tree (the paragraphs above are the re-measurement) and its "Pending founder choices" list is resolved by 0149 rows 7-9 and OD-124. What it recorded that is not otherwise written down:

- **Scope, as first built:** ForgotPassword, ResetPassword, VerifyEmail, InviteLanding, NoAccess, Privacy and VendorPortal each gained a `PublicShell` path gated on `usePublicDesign()`, keeping legacy rendering when the switch was off; no new App route or feature-registry entry; all shell wordmarks link to `/login`.
- **Behavior notes not superseded by later fixes:** forgot/reset preserve enumeration resistance, the login email prefill, validation, throttles and token routes, and distinguish an accepted request from proof of delivery; NoAccess explains the missing restaurant and keeps sign-out/invitation directions, with `ProtectedRoute` wiring root-owned; verification/password-reset/Studio-invite mail use Mudavym branding in subject/body/sender, with the configured sending address, credentials, recipients, links and expiry unchanged; PublicShell honors an explicit `ground="paper"` and overrides `globals.css`'s forced white fields on both grounds at a 44px minimum control height.
- **Original visual coverage (Safari, temporary same-origin harness, 2026-09-13):** forgot-password rendered clean at 1080/375 on both grounds with no horizontal overflow; reset-password's missing-token state rendered clean at 375. Coverage did not include the other five pages or any email/invite mutation — this pass's own browser coverage (Chromium, `/v/:slug` and `/forgot-password`, wave4) and the mutation-proven regression tests (wave5) are what supersede it for those two pages; the other five still rely on `publicPages.recovery.test.tsx` and `authPages.publicDesign.test.tsx`, not a live render.
- **Not retained:** the temporary `.public-qa.html`/`.public-preview.config.ts` harness and the `07-reference/mudavym-transition-2026-09-13/` vault-import bundle it described were adoption-time artifacts specific to the Codex worktree; neither exists on this tree, and nothing here depends on them.

## 0e. The finish goal: lanes and worktrees at the #421 go-live, 2026-09-21 (supersedes 0a and 0 wherever they differ)

**[Heading renamed 2026-09-25: #421 (`34c33a76a`) added this section as a second "## 0c." above the existing one, which #391 (`11c501d26`) had carried and which now sits below 0a. STATE.md's "§0c" pointers were added by #391 and mean that older section. Content unchanged.]**

The founder set a new, larger goal 2026-09-16, superseding the 2026-09-12 merge-queue
push below: finish every remaining page to the Mudavym design, then one cutover merge
deletes the legacy frontend for every house at once, gated on his approval of a
deletion manifest, file group by file group. Full context, the session's nine rounds
of forks and his verbatim answers:
[ADR 0149](../decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md).

**Lanes and worktrees.** Work is split across parallel git worktrees named
`wt-fin-*`, each a checkout of `origin/main` `60ed83a7` on its own `feat/finish-*`
branch, sharing this checkout's `node_modules` via symlinks. Each lane commits only
inside its own worktree; none touches another lane's files, the main checkout, or
`~/Documents/ChatGPT`. As of this section's writing:

| Worktree | Branch | Base commit |
|---|---|---|
| `wt-fin-live` (this lane) | `feat/finish-live` | `60ed83a7` |
| `wt-fin-digest` | `feat/finish-digest` | `60ed83a7` |
| `wt-fin-leaks` | `feat/finish-leaks` | `60ed83a7` |
| `wt-fin-links` | `feat/finish-links` | `60ed83a7` |
| `wt-fin-notify` | `feat/finish-notify` | `60ed83a7` |
| `wt-fin-relay` | `feat/finish-relay` | `60ed83a7` |
| `wt-fin-reports` | `feat/finish-reports` | `60ed83a7` |
| `wt-fin-vintel` | `feat/finish-vintel` | `60ed83a7` |
| `wt-fin-gate` | `feat/finish-audit-pipeline` | `0357cce5` (ahead of `60ed83a7`) |
| `wt-fin-A` … `wt-fin-H`, `wt-fin-IJ`, `wt-fin-KL` | detached HEAD at `60ed83a7`, no branch checked out at this snapshot | `60ed83a7` |
| `wt-finish` | `feat/mudavym-finish` | `e233ba1e` — the orchestrating session's own worktree, separate from the `wt-fin-*` lanes |

This table is a `git worktree list` snapshot (2026-09-17), not a task assignment
registry — re-run `git worktree list` from the main checkout before trusting branch
names for lanes other than your own; a lane's branch and commit move every time it
pushes.

**This lane (`wt-fin-live`) shipped:** ADR 0149 row 36's "16 locked pages" go-live.
`apps/web/src/lib/mudavym/useMudavymDesign.ts` gained a `LIVE_PAGES` set — dashboard,
orders, receiving_door, providers, communications, team, inventory, receipts,
documents_reports, document, reports, calendar, profile, connections, notifications,
logs — that resolves to the Mudavym design for every house in code, no
`restaurant_feature_flags` row needed, no database write. Held back, still
flag-gated: settings, cellar, recommendations, receiving (the desk). The QA
browser override (`mudavym.design.<page>` in `localStorage`) still wins over
`LIVE_PAGES`, so a designer can still force legacy on a live page to compare.
Legacy code is untouched; deletion waits on the founder's manifest per ADR 0149.
Full per-route status, ticked against `origin/main` `60ed83a7`:
[06-pages/LIVE-CHECKLIST.md](../06-pages/LIVE-CHECKLIST.md).

**Verification fidelity reached (state plainly, per CLAUDE.md §0.5):** 37 tests in
`useMudavymDesign.test.tsx` (7 original + 30 new `LIVE_PAGES` cases) and 24 in
`HouseHeader.test.tsx` (23 original + 1 new DOM-level PageGate case), real hooks
with mocked HTTP, plus the existing 225-test suite across
`HouseHeader`, `Communications`, `ReceiptsSeal`, `LogsNext`, `SettingsNext`,
`GetStarted.cellarRegisters`, `ProfileNext` and `PublicShell` all pass; `tsc --noEmit`
clean on both the gateway and the web app; `vite build` (production bundle) succeeds
clean; `check_flag_readby_anchors.py` and the full `check_decision_claims.sh` (336
claims) pass. A full backend-driven browser sweep with real screenshots at 1440/390
for all 16 pages was **not reached**: the local Docker/Supabase stack (ports
54321-54329 already listening) did not respond to `docker ps` or `supabase status`
after repeated 15-60s waits, consistent with heavy concurrent load from sibling
`wt-fin-*` lanes running `verify_index.sh` at the same time, and bringing up the
NestJS gateway against it risked colliding with a concurrent lane's own DB-backed
test run. The next session with a quieter Docker daemon should run the real sweep
(recipe: `visual-sweep-capture-recipe.md` memory) before this goes to the founder as
visually verified, not only logically verified.

**Fixer pass, 2026-09-17 (against `wave2/live-review.md`'s 2 blockers, 2 majors,
3 minors — state plainly, per CLAUDE.md §0.5):**

- **Fixed.** `useDashboardNextData.ts:186` — `!res.daily` threw on a null
  `res` (a 200 with a null body bypasses `getCalendarRevenue`'s own catch);
  now `!res?.daily`, plus a `.catch` that lands the same 'unknown' state
  instead of leaving the month ledger in 'loading' forever. `DashboardNext.test.tsx`
  is new (`/` had zero render coverage — the review's own proof) and pins the
  regression: it fails against the pre-fix code with the exact
  `TypeError: Cannot read properties of null (reading 'daily')` the review's
  throwaway mount produced, and passes with the fix. Of the other fifteen
  `LIVE_PAGES` components, only `DashboardNext` had zero test coverage;
  `InventoryCommandPage` renders identically on both PageGate branches
  (`App.tsx:312`) so `inventory` going live changes nothing to sweep.

  **CORRECTED 2026-09-19** (wave5/live-confirm.md B item "4b", CLAUDE.md §5b
  — struck rather than deleted): both halves of the last sentence were
  wrong. `InventoryCommandPage` did NOT already have coverage — its own new
  test file's header states "`/inventory` had ZERO render coverage anywhere
  in the suite before this file" (`find
  apps/web/src/pages/inventory/command -name
  'InventoryCommandPage.test.*'` returned nothing before wave4/5;
  `InventoryCommandPage.test.tsx` is a `new file` on this branch, per `git
  status`), the same gap this line claimed only `DashboardNext` had. And
  `inventory` going live was not a no-op for the sweep: wave4/5 found and
  fixed a CSS regression reaching this page (B1), a pre-existing refetch
  loop that printed literal zeros for up to 72% of samples (B2), and two
  zero-figure sites the KPI/header/footer read raw off `stats`/`rows`
  (LIVE-CHECKLIST.md's `/inventory` row) — real defects a "changes nothing"
  page would not have.
- **Fixed.** The 16 `mudavym_design_*` keys whose page is in `LIVE_PAGES` moved
  out of `ACTIVE_FEATURE_FLAGS` into a new `LIVE_IN_CODE_FLAGS` bucket in
  `feature-flag-registry.ts` (columns kept, unread — nothing deleted per ADR
  0149). `GET /settings/feature-flags` stops returning them and
  `FeaturesSection.tsx` (which renders exactly the server's key set) stops
  offering a switch for a page a switch can no longer change. Extended
  `check_flag_readby_anchors.py` to cross-check `LIVE_PAGES` against the
  registry (now PASS -- 7 ACTIVE flag anchors, down from the stale "23 all
  resolve"; verified the new check both fails on an injected regression and
  passes clean). `scripts/flip_mudavym_design_flags.py` now refuses to plan a
  write for any of the 16 (reports NO-OP and continues with the rest of the
  request) rather than reporting success on a column nothing reads; its
  `PAGES` tuple also gained `logs` (ADR 0133), missing since that page shipped,
  so `--pages logs` no longer 404s as "not a Mudavym page" before reaching the
  no-op check. `self-test` now 14 checks, still no database touched.
- **Fixed.** The 36-hit stale-production-state prose sweep: all sixteen
  `feature-flag-registry.ts` comments for the moved keys (replaced by the new
  bucket's own header), `DashboardNext.tsx:13`, `SealedApproveDie.tsx:18`,
  `SealedRejectDie.tsx:12`, `ProfileNext.test.tsx:751-765`,
  `CanonicalDocumentPage.tsx:36-39`, `Communications.test.tsx:1-8`,
  `useStandaloneGround.ts:14`, `DoorReceipt.test.tsx:6-11`, `App.tsx:372-377`,
  and the five "behind `mudavym_design_*`" page headers (`LogsNext`,
  `ReportsNext`, `NotificationsNext`, `CalendarNext`, `ProfileNext`). Left
  `StripeCardPanel.tsx:11` alone — it is past tense about a 2026-09-04 event,
  not a present-tense production claim.
- **Fixed.** `/profile` and `/connections` rows in `LIVE-CHECKLIST.md` now
  state the consequence (Registers IV/V/VI leave `/profile`; a member sees the
  new sidebar entry but is refused at the route), and the "Measured at" block's
  ALDEMIR clause now says "11 of 20 as last recorded 2026-09-12 — not
  re-measured here" instead of the false "excepted", with the `/login`
  `/register` claim labelled ADR-sourced rather than measured.
- **Recorded, not resolved.** The `HouseHeader` bell's 60s poll of
  `GET /notifications/unread/count` goes from whatever houses had a flag row
  to every signed-in user on 15 of the 16 pages — named now in
  `LIVE-CHECKLIST.md`'s new banner, still not measured under real tenant
  fan-out (`HouseHeader.tsx:40-47`'s own stated condition for tightening the
  cadence). Measuring it needs a live gateway against production-shaped data,
  outside what this lane's worktree can do.
- **Known side effect, not chased down (§0.5 shortcut, named plainly).**
  Moving 16 entries out of `ACTIVE_FEATURE_FLAGS` shifted every later line in
  `feature-flag-registry.ts` — `mudavym_design_cellar` moved 199→101,
  `mudavym_design_recommendations` 155→78, `mudavym_design_receiving` 71→72,
  etc. At least seven pre-existing `.planning/` docs cite the old line numbers
  (`06-pages/get-started.md:90`, `wines.md:1173`, `recommendations.md:920,1004`,
  `connections.md:617`, `profile.md:1170`, two `01-org/product/guest-experience/`
  docs) — none touched by this lane's diff, none flagged by live-review.md, and
  sweeping the corpus for every stale citation this edit produced is out of
  this fixer pass's scope. Left as-is; a citation-sweep session should re-grep
  `feature-flag-registry.ts:[0-9]` across `.planning/` after this merges.
- **Not run — needs the founder's word, not an agent's.** The full
  backend-driven browser sweep (screenshots at 1440/390, console errors
  listed, all 16 pages, "does this look presentable" judgment) that ADR 0149
  itself names as these six pages' soak (row 36 and the Consequences section,
  both 2026-09-17) still has not happened — blocked here by the same
  unreachable local Docker/Supabase stack noted above, not by choice. Per this
  lane's brief, that is not this agent's call to waive: **the fork to put to
  the founder is "row 36's sixteen include six pages no house has ever
  rendered, and your record makes the sweep their soak — ship them now with
  unit and DOM coverage only, or hold the merge until the 16-page sweep with
  screenshots has run?"** (live-review.md's own framing, 2026-09-17).

## 0a. Final state, 2026-09-13 (supersedes sections 0 and 3 wherever they differ)

**On main:** #363, #366, #361, and merge train 2 (#372). The train carried #367 parity,
#328 go-live docs, #365 ledger guard, #364 probe safety with its two sibling commits, #370
p4 after #289, #369 MCP port, and this handoff doc. Those PRs and train 1 (#371) are closed
as landed or superseded. The endpoint faults (ADR 0147) follow in their own PR.

**Still open, in priority order:**
1. **#368 text-sender port — RESOLVED on `wt-fin-F`, 2026-09-17, superseding #368.**
   The cause of the CI regression was confirmed: all five original rows' `verify`
   fields ran `npx jest`, and CI's `decision-claims` job only checks out the repo —
   it installs nothing, so `npx` itself was the failure (`.github/workflows/ci.yml:540-548`).
   Rewritten as ten grep/python-only rows (`ADR-0121-P0-PUSH` through
   `ADR-0121-P1-STATUS-CALLBACK` in `CLAIMS.jsonl`), none using `npx jest` or `vitest`;
   `check_decision_claims.sh` 345 checked / 345 holding on this tree. Ten defects a
   two-pass adversarial judge found were also fixed (ADR 0121's 2026-09-17 review-trail
   row has the list). **The "Stop it" ceremony question is answered and built** (F3
   lane, same worktree, same day): the founder said hold-to-approve plus a typed
   reason, matching this page's other revokes; the one-click fixed-reason control is
   replaced, with the typed reason kept on the record and both the success and
   refusal paths under test (see ADR 0121's 2026-09-17 (F3) review-trail row). Three
   remain, each needing a founder answer: whether an inbound WhatsApp message proves
   phone reachability, whether "Main line" can be a stated answer, and a
   founder-authorized production duplicate count before merge.
   **[CORRECTED 2026-09-19, PR #391 audit M1: the production duplicate count is no longer
   owed — measured 2026-09-18, founder-authorized, read-only (Supabase MCP SELECT only):
   both predicates are 0. 0 restaurants hold two live `meta_cloud` credentials sharing a
   `sender_ref`, and 0 hold two inbound WhatsApp receipts sharing `(restaurant_id,
   message_id)`. Migration `20260913190100`'s merge precondition is satisfied. The other
   two forks (phone-reachability override, "Main line" as a stated answer) stay open — see
   ADR 0121 item 9.]**
2. **#362 security gate.** Rewrite the guard on PyYAML (brief in section 3).
3. **#349 nightly E2E.** Its merge of main is in progress in wt-e2e, with 6 conflicts.
4. **Ports:** calpush, ov0, ov1, ov2, motions (section 4). The founder chose to land all
   of them.
5. **The pages build** (section 5), and the open founder forks (section 6).

**Two findings that are fixed nowhere:**
- `GET /logs` correlationId reads across houses.
- ~~No unique index on Meta phone number id.~~ **Fixed on `wt-fin-F`, 2026-09-17**:
  migration `20260913190100_whatsapp_sender_and_inbound_identity.sql` (two partial
  unique indexes, additive). Not yet on `main` — lands when this lane's PR merges.

## 0c. The finish goal, 2026-09-16/17 (supersedes 0a and 0b wherever they differ)

The founder set one goal on 2026-09-16: *"complete every page there is ... and remove legacy
pages and actually full delete them. Commit push deploy everything ... So finish the
mudavym.com and deploy it."* The decisions that goal produced are [ADR 0149](../decisions/0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once.md)
(38 answers, the cutover, the deletion manifest as a gated stop) and [ADR 0160](../decisions/0160-the-founders-sketch-review-what-he-valued-and-what-each-page-becomes.md)
(his dictated sketch review, page by page, with the pick and what it owes). Read both before
touching anything below. The audit pipeline every PR now runs through changed the same week:
[ADR 0090's 2026-09-17 amendment](../decisions/0090-pr-audit-gate-autonomous-merge.md) — one Opus
planner, two Sonnet reviewers on its plan, the planner resumed for the final say.

**On main (2026-09-17):** #384 (ADR 0149 and the record amendments), #386 (the new audit
pipeline), #387 (train 1: the overlay foundation adopted from Codex's #374, and a shared
vendor-intel decision naming its deciding house). The SEO/GEO session landed #385 and #388
(ADR 0158: robots, sitemaps, llms.txt, per-route heads, a real 404, a served `/v/:slug`).
Production was verified after #387: the gateway answers `commit 3a752010`, and the live web
bundle contains `mdv-denied`, a string only that branch added.

**Codex's uncommitted work was rescued and audited.** Everything Codex left in
`~/Documents/ChatGPT/Mudavym/worktrees` is copied byte-for-byte to
`/Users/aldemirkonuk/Projects/codex-rescue-2026-09-16/` (690 files; that directory is the
only backup). Each lane was judged, fixed and independently confirmed before adoption, per
ADR 0149 row 1. Verdicts: ADOPT after fixes — A overlay foundation (merged), C public doors,
F text sender, G security gate, IJ admin desk, KL authorize consent; REJECT — B page-action
integrity (it silently decided the `quantity_received` fork and widened the ADR 0088 staff
floor app-wide), D overlay packet 1 (money input regression, Escape discarding a receipt,
absence reported as health), H calendar push, C2 arrival (unreachable page, apply refuses
valid proposals). The rejected lanes' good parts are being rebuilt, not adopted.

**Branches ready or in flight** (all off `origin/main`, each verified on an archived index):

| Branch / worktree | What it carries | State |
|---|---|---|
| `feat/finish-leaks` / `wt-fin-leaks` | logs correlation leak, provider-intelligence tenant leaks, `increment_trust_counter` + `seed_sim_restaurant` revoke (migration 20260917010400, ADR 0159), production source maps off | confirmed, pushed; **in `train/finish-2` (2026-09-18)** |
| `feat/finish-reports` / `wt-fin-reports` | report exports (CSV + print-ready page), 90-day retention, 50 per house, paging; the MCP-offload direction documented | confirmed, pushed; **in `train/finish-2`** |
| `feat/finish-rename` / `wt-fin-rename` | one pass, user-visible WineOps to Mudavym | confirmed, pushed; **in `train/finish-2`**; the From-name default the digest added now says Mudavym too |
| `feat/finish-digest` / `wt-fin-digest` | recommendations digest sender, per-person subscription, off behind `DIGEST_SEND_ENABLED` | ~~confirmed~~ **[2026-09-18: the confirmation missed two red guards, `check_analytics_cost_honesty` exit 2 and `check_order_capture_contract` 13 > 12; fixed in 13b30a59]**, pushed; **in `train/finish-2`** |
| `feat/finish-security-gate` / `wt-fin-G` | ADR 0142 security gate that can fail and says when it cannot check | confirmed, pushed; gate-owned paths, needs the founder's word |
| `feat/finish-text-sender` / `wt-fin-F` | WhatsApp leg, Meta webhook, unique-index migration 20260913190100 | fix round; ~~two production duplicate counts owed before merge~~ **[2026-09-18: measured, 0 and 0 — see below]** |
| `feat/finish-authorize-consent` / `wt-fin-KL` | `/authorize` consent receipts, Ask readings backend behind `ASK_LAUNCHED` | fix round (a state-replay blocker was found and fixed; the `/ask` page is still owed) |
| `feat/finish-live` / `wt-fin-live` | sixteen locked pages resolve to Mudavym for every house in code, plus `.planning/06-pages/LIVE-CHECKLIST.md` | fix round; the sweep must actually exercise the six pages no house has ever had on |
| `feat/finish-links` / `wt-fin-links` | `/orders/:id`, `/deliveries/:id`, the dead `app.wineops.ai` links, service-worker actions, template CTAs | fix round |
| `feat/finish-relay` / `wt-fin-relay` | the `/communications/email` relay behind two locked doors; the person door now queues with ADR 0118's two-minute undo | fix round |
| `feat/finish-notify` / `wt-fin-notify` | five uncalled senders closed, `send-email` restricted, eleven resolver sites mapped to categories | fix round |
| `wt-fin-IJ` | the `/admin` operator desk (SQL-only platform grant AND Studio developer) | fix round |
| `feat/page-{settings,cellar,help,vprices,promos,receiving,recs}` / `wt-pg-*` | the seven pages whose direction ADR 0160 locked | building |

**Sketches.** Thirteen sets are in `.planning/sketches/106`–`118` and published for review at
`https://claude.ai/artifact/4aFbY744aZv1GR2YmytzdQ`. Picked: 107 B+, 108 A with C's quiet tier,
109 A with two grafts, 110 A with B's detail (C rejected), 111 A, 112 A with C's chart and paper
trail, 113 B with C's density and bundles. 106 went back for two SOTA directions (sketch 119);
120 is a fourth recommendations round; 117 is the vendor scorecard; 118 is the flyleaf login.
**[CORRECTED 2026-09-19, PR #391 audit B1: the "110 A with B's detail (C rejected)" and "111 A"
picks above are what ADR 0160 later found were the sketch README's own recommendations, not his
picks, and rewrote. His actual picks: 110 cellar is **direction B**, the gazetteer, with C **kept
in mind, not built now** (not rejected, and not "A with B's detail"); 111 help is **delegated to
the builder**, not "direction A". See ADR 0160 §110/§111 and its 2026-09-18 review-trail row.]**

**Owed by the founder, blocking a merge or a build:** ~~the two production duplicate counts for
migration 20260913190100 and the published-vendor-page count (the SQL is in the session
transcript; the CLI here cannot read that project)~~ **[2026-09-18: measured read-only through
the Supabase connector, which can read project `exzueerziesmczwlhomd`: 0 duplicate groups on
`house_text_sender_credentials (sender_ref)` live meta rows and 0 on `procurement_conversations
(restaurant_id, message_id)` whatsapp inbound rows, both because both sets are empty (0 rows,
0 whatsapp conversations), so the two unique indexes build; `vendor_portal_pages` holds 0 rows,
0 published, so the `VendorPortal.tsx` client JSON-LD removal is not urgent and stays with the
cutover]**; his word on `feat/finish-security-gate`
because it touches gate-owned paths; the pick between sketch 119's shell directions; the wine
detail surface (ADR 0160 §110 item 4) and the bundle shape (§113) still need drawing.

**What has not started:** `/get-started` (the arrival), `/ask` and the `/sommelier` redirect,
`/authorize`'s page, the app-shell build, the deletion manifest itself, and the security-headers
block in `apps/web/vercel.json` (the SEO session owns that file until its PR lands; it has).
**[2026-09-25, [web-rebuild census](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §1a: since landed — `/get-started` (#455 `ddc5e094b`, ADR 0213), `/ask`'s backend (#430 `e2abd7844`; the page and the `/sommelier` redirect are still not built), `/authorize`'s page (#430, flag-gated), the app shell (#437 `7022434f7`, ON in the database for 14 of 14 houses) and the security headers (#418 `2bf07c6dc`). Only the deletion manifest has not started.]**

## 0. Latest state (supersedes section 3 wherever they differ)

Written while API credit was down to its last $15. Subagents failed on the weekly limit on
every launch after the first wave. Re-measure everything below before acting on it.

**Merged to main today:**
- #363 (the audit gate waits only on gating checks), beb00db4
- #366 (Ask AI bounded, daily cap), b76243e9
- #361 (a stock write names its house), round 3

**In flight: the merge train.** Branch `train/2026-09-12`, worktree `wt-train`, script
`scratchpad/train.sh`, log `p4-scratch/train.out`. It merges the ready branches into one PR
so that strict main needs one CI cycle, not eight:
- docs/handoff-2026-09-12 (this file)
- #367 parity self-test
- #328 go-live docs
- #365 ledger guard
- #364 probe safety, with the two stacked sibling commits
- #370 p4 work since #289 (publicDesign, PublicShell, /login and /register, ADRs 0143-0145)
- #368 text-sender port
- #369 MCP port, with migration 20260912200000
- the endpoint-faults branch, ADR 0147, **only if** its verify_index run was green

Check the train PR. If CI is green, post the PASS marker on the founder's word, run
`gh pr merge <n> --squash` in a separate call, then close the individual PRs as landed. If
the train left a branch out, the log says why.

**Endpoint faults (wt-endpoint-faults), the one known risk.** The wine-search fix tripped
`check_read_columns_exist.py`: 3 unreadable reads against a shrink-only ceiling of 2. The
new unreadable site is the suggestions query in `apps/api-gateway/src/wines/wines.service.ts`
(getWineSuggestions). Several shapes were tried and the probe still counted it. The probe
that lists unreadable sites is `scratchpad/rc_probe.py`: copy it into scripts/ and run it.
If the train log says endpoint faults were left out, fix that one read (or split the fix
out), re-verify, commit, and land it alone.

**Not landed, and why:**
- **#362 (the security gate can fail).** The PyYAML rewrite of
  `scripts/check_security_gate_can_fail.py` was never done. The agent died twice, leaving 1
  changed file in wt-secgate; inspect it. The full brief is in section 3.
- **#349 (nightly E2E).** c1221a9f is pushed (trace off, gateway URL guard, loader). The
  merge of main is IN PROGRESS in wt-e2e with 6 conflicts:
  - e2e-prod.yml and conftest_prod.py (apply ADR 0137: waves D/E/G retired, their secrets
    removed)
  - EXISTING-TEST-INVENTORY.md
  - TECH-DEBT
  - README
  - CLAIMS

  `p4-scratch/e2e-merge.md` may hold a partial analysis.
- **Ports of the 2026-09-06 branches:** calpush, ov0, ov1, ov2 and motions. Their worktrees
  hold the 3-way apply with conflicts unresolved (section 4 lists what each needs). The
  founder chose to land all of them.
- **The pages build (section 5)** did not start, for lack of credit.
- **Dependabot:** left out by the founder.

**New findings from the ports, not fixed anywhere:**
- Main's `GET /logs` accepts a `correlationId` that reads `event_store` rows across houses
  for any signed-in user. The MCP port removed the same argument from its own tool; see
  p4-scratch/ports/mcp.md.
- ~~The database allows two houses to hold the same Meta phone number id.~~ **Fixed on
  `wt-fin-F`, 2026-09-17**: migration `20260913190100` adds the unique index; see
  ADR 0121's 2026-09-17 review-trail row. p4-scratch/ports/text.md is superseded here.

## 1. Rules a continuing session must keep

- Read CLAUDE.md, then `.planning/decisions/README.md`, then this file.
- Production Supabase (`exzueerziesmczwlhomd`) is **read-only** unless the founder says
  otherwise in chat. Migrations **auto-apply to production on merge to main**.
- `main` is strict and requires five contexts: CI Complete, Beverage identity key,
  Guest merge policy, Fresh database equals remote, and Code queries only relations
  production has. Every merge makes every other PR BEHIND. Merge `origin/main` in, then
  wait about 9 minutes of CI. Never `--admin`, never force-push.
- The `require_pr_audit` hook blocks `gh pr merge <n>` until the PR has a comment
  `<!-- pr-audit-gate: pr=<n> sha=<7 chars> verdict=PASS -->` for the **current** head.
  Post the comment in one Bash call. Run `gh pr merge <n> --squash` in the next.
- **Founder decision, 2026-09-12: "Your word as PASS, no agents".** For today's queue a
  marker is posted on his word, with no audit agent. Each marker comment must say that
  no audit ran and list the CI and local verification behind it (see #361 and #366).
- Agents never run git state commands (add, commit, checkout, merge, push and the like).
  The parent session commits, with explicit paths.
- No emoji in code, docs or reports. Never read repo `.env` files.
- Verify an index before committing it:
  `bash /Users/aldemirkonuk/Projects/p4-scratch/verify_index.sh <worktree> <checks...>`.
  It archives `git write-tree`, so stage first. Checks include gw_tsc, gw_tsc_spec,
  gw_eslint:<paths>, jest:<paths>, web_tsc, web_eslint, vitest:<paths>, guard:<script>,
  claims, boots and prefixes. Counts reported anywhere come only from such a run.
- The shell is zsh: `for f in $list` does not word-split. Use arrays, or `bash -c`.
- **CLAIMS.jsonl merge trap:** a union resolution keeps BOTH halves of a correction.
  After resolving, drop every row that main removed since the merge base. #361 needed
  that (deb4544f): a stale ADR-0090 row turned CI Complete red.
- Vercel preview checks fail at 100 deployments per day on the free tier. They are not
  required. The CI-side "PR Audit Gate" job has no Anthropic credit and is red on every
  PR. It is not required either.

## 2. Founder decisions taken in session today (verbatim answers)

| Question | Answer | Recorded in |
|---|---|---|
| Audit depth for the merge queue | "Your word as PASS, no agents" | this file; each PR marker comment |
| Seven 2026-09-06 branches that never landed | "Triage each, then decide" | this file, section 4 |
| MCP server (ADR 0132, was Proposed) | "Lock 0132 and land it" | to record in ADR 0132 when ported |
| Text sender + calendar push | "Land both now" | ADR 0121's review row done (`wt-fin-F`, 2026-09-17, quoted verbatim in the status line) / ADR 0111's still pending |
| Overlay packets 0, 1, 2 (ADR 0112) | "Port all three now" | when ported |
| Motions doc (ADR 0134) | "Land it as Proposed" | when ported |
| #349 nightly E2E trace leak | "Fix trace, then land it" | ADR 0135 "Audit fixes" |
| Dependabot #339-#346 | "Leave all eight out" | this file |
| Ask AI spend cap | "A daily cap that really resets" | ADR 0146 Correction (PR #366) |
| Speech in the arrival | "On-device, keep only the rows" | ADR 0143 founder answers; 0113 Q6/Q7 |
| What the arrival's seal covers | "Only what Mudavym proposed waits" | ADR 0143; 0144:31 bracket |
| Auth email brand | "Rename the auth emails only" | ADR 0143; OD-27 bracket |

Earlier the same day, and already in ADRs 0143-0146:
- land my three PRs first, then build;
- the public design switch is cherry-picked onto p4;
- confirm is owner or manager;
- endpoint scope is what the pages need plus the named gaps;
- /sommelier redirects to /ask, and Ask reaches every house behind the switch;
- Haiku picks and Sonnet 5 answers, and the model's own knowledge is marked;
- the seal is over the order at approval;
- agent restart is for operators only; an operator has both a SQL-only flag and the Studio developer role;
- the flyleaf opens /get-started;
- /authorize uses a server challenge;
- home links to /login;
- the new CVE is handled by pinning the trivy DB.

## 3. The merge queue

| Item | Branch / worktree | State at writing | Next step |
|---|---|---|---|
| #363 gate waits only on gating checks | merged | **MERGED** beb00db4 | none |
| #366 Ask AI is bounded (daily cap) | `fix/ask-ai-is-gated` / `wt-askai` | de196d9d, 5/5 green, PASS marker posted | `gh pr merge 366 --squash`; after that every other PR is BEHIND |
| #361 a stock write names its house | `fix/a-stock-write-names-its-house` / `wt-tenantfix` | deb4544f, CI running | when 5/5: marker, merge. If BEHIND: merge main, drop removed claim rows, push |
| parity self-test stops crashing | `fix/parity-self-test-is-deterministic` / `.claude/worktrees/jolly-lovelace-bc70ef` | 41e2ded5; 300/300 self-test runs green; claims 311/311; PR opened | CI, marker, merge |
| endpoint faults (the pages' endpoints) | `fix/page-endpoints-tenant-faults` / `wt-endpoint-faults` | **uncommitted**; notifications now fully scoped; 5 old controller-spec expectations to update | fix specs, verify_index, commit, PR, merge |
| #349 nightly E2E, four states | `test/nightly-e2e-modernised` / `wt-e2e` | c1221a9f fixes trace (off), gateway URL guard and loader. **Merge of main in progress**, conflicts in 6 files (agent may have died) | resolve per ADR 0137 (D/E/G retired), verify, commit merge, push, marker, merge |
| #362 the security gate can fail | `fix/security-gate-can-fail` / `wt-secgate` | d278824e; round 3 OVERTURNED (line-parser guard). Round-4 agent launched (may have died) | rewrite the guard on `yaml.safe_load` with duplicate-key refusal (full spec: p4-scratch/secgate-round4 brief in this session's transcript); harness `/private/tmp/claude-501/.../scratchpad/harness.py`; bracket the false sentence at ADR 0142:190 |
| p4 work since #289 | `feat/mudavym-design-p4` / `wt-p4` | 11 commits a914b8cf..449342f0 not on main: publicDesign.ts switch, PublicShell, /login and /register behind the switch, ADRs 0143-0145 | new branch from main, cherry-pick those 11 (skip merges), verify, PR, merge. Pages stay dark behind flags (ADR 0131) |
| #364 probe assertions assume empty production | `fix/migration-probe-safety-two-live-migrations` | DIRTY; Fresh database red | merge main; decide whether to stack 1592b6a5 (worktree `objective-cohen-ed25a2`, unpushed) and aec15b07 (worktree `jolly-hofstadter-770fde`, branch `fix/migration-probe-safety-eight-literal-deletes`, unpushed). Both sit on 673989b7 and both edit `scripts/check_migration_probe_safety.py` |
| #365 ADR 0031 ledger guard | `claude/vigorous-hawking-2745a5` | DIRTY; Fresh database red | merge main, verify, marker, merge |
| #328 go-live ADR 0131 docs | `feat/mudavym-go-live` | BEHIND | merge main, marker, merge (scripts land; nothing runs them) |
| stranded docs commits | a37c6200 on `docs/modal-sketches` (sketch 103 canvas); 98229aeb local-only in `/private/tmp/claude-501/...vigilant-sammet.../scratchpad/wt-e2e-waves` (PR 354 audit report) | not on main | one docs PR |
| Dependabot #339-#346 | — | left out by the founder | none |

## 4. The seven 2026-09-06 branches: triage, and the founder's call

Each branch was cut from p4 before #289 squash-merged. None of their commits is an
ancestor of main or p4. The triage sampled added lines against main (script in this
session's scratchpad, `triage.sh`), and all seven are genuinely unlanded. Port
worktrees exist, created from main beb00db4. `git apply --3way` of
`git diff <base> origin/<branch>` is **already applied in each, with conflicts
unresolved**. The agents that were resolving them died on the weekly limit.

| Port worktree | Branch | Base | Conflicts at apply | Must also do |
|---|---|---|---|---|
| `wt-port-mcp` | feat/connect-mudavym-mcp-server | 161d92cc | 2 unmerged, 3 files with markers | Lock ADR 0132 (founder, today). Rename migration `20260906170000_a_house_gives_its_assistant_a_key.sql` to `20260912200000`. Confirm keys are hashed, reads are house-scoped, and a revoked key is refused. check_route_exposure |
| `wt-port-text` | feat/connect-text-sender | 161d92cc | 3 / 4 | **Done on `wt-fin-F`, 2026-09-17** — the Meta webhook verifies X-Hub-Signature-256 on the raw body with `crypto.timingSafeEqual`; reconciled with main's moved text module; ADR 0121 carries a 2026-09-17 review row |
| `wt-port-calpush` | feat/connect-calendar-push | 161d92cc | 1 / 2 | Rename migration `20260906190000_...` to `20260912200100`. ADR 0111 stays Proposed |
| `wt-port-ov0` | feat/overlays-packet-0-primitive | 161d92cc | 3 / 4 | ONE Sheet: keep #359's Escape and focus-trap fixes. Add SheetStack, Denied and Stub on main's Sheet API. the OD number it files must not collide. Do not resurrect .planning/01-org files main deleted |
| `wt-port-ov1` | feat/overlays-packet-1 | 161d92cc | clean (1 file with marker-like text) | A clean apply is not proof: compare every touched file with what #289 rebuilt |
| `wt-port-ov2` | feat/overlays-packet-2 | 161d92cc | 4 / 5 | Sealed acts (drafted reply, approve from the bell): confirm auth, house scope and seal on each endpoint they call |
| `wt-port-motions` | docs/motions-and-overlays-per-page | 5443a0b8 | 4 / 5 (orders.md, receipts.md, CLAIMS) | ADR 0134 lands as Proposed, its 14 forks open |

The overlay packets do not import each other: 1 and 2 do not use packet 0's SheetStack,
Denied or Stub. They can land in any order, but they share .planning page notes and
CLAIMS rows.

## 5. Pages still to build

The goal is every page, plus every endpoint the pages call, working, authenticated,
validated and tenant-scoped. Sources: `/Users/aldemirkonuk/Projects/p4-scratch/wave/DIGEST.md`
(eight page dossiers: forks, verdicts, build tasks) and ADRs 0143, 0144 and 0145 on p4.

1. **The seven signed-out doors on PublicShell** (ADR 0143 section 1). The wordmark and
   "Published on Mudavym." link to /login. /login and /register are already improved
   behind the switch.
2. **/admin and /admin/health become one desk.** Agent restart and stop are for operators
   only. An operator has BOTH a platform flag that only SQL can set AND Studio's
   `developer` role. That needs a migration, a guard and a registry of the routes that
   require it. Today the restart and stop methods take only an agent name and no route
   reaches them (`orchestrator.py:497,525`).
3. **/get-started is C's book** (ADR 0143 section 4 and its founder answers; ADR 0144):
   - the flyleaf, five folios each carrying its own state, never a percentage;
   - speaking a folio uses on-device browser recognition and keeps only the rows, each
     marked `spoken`;
   - only what Mudavym proposed waits for one held seal; typed entries post at once.

   Build gaps named in the ADR: `config.propose_batch`, the `configuration_step_skipped`
   audit action, producers held one by one, and a vendor's usual currency on the terms
   DTO.
4. **/ask plus the /sommelier redirect** (ADR 0145): Haiku picks, Sonnet 5 answers within a
   60 s budget, and the model's own knowledge is marked as not from the house's books.
   It builds on /ask-ai (PR #366).
5. **/authorize** (ADR 0144): a server challenge redeemed at authorize. It is bound to the
   integration, the digest of the words shown and the retention, and the provider URL is
   bound to the sealing browser.
6. **/help, /vendor-prices, /promotions, /recommendations/catalog.** Their forks are still open (section 6).
7. **Auth emails renamed to Mudavym:** verification (`auth.service.ts:986,1011,1033`),
   reset (`auth.service.ts:2077`, `email-templates/password-reset.template.ts:49,54`) and
   invite (`email-templates/studio-invite.template.ts:19`). Nothing else is renamed (OD-27).

## 6. Open founder forks, not yet asked

- **Promotions:** the senders and prospects tabs; the window for "bought N".
- **Help:** waiting queues; the staff readiness line; contact channels.
- **Recommendations catalog:** is it actionable?
- **Public pages:**
  - how /privacy and /v/:slug are treated;
  - resending while signed out;
  - the invite preview;
  - Google Fonts.
- **Vendor prices:**
  - the status of ADR 0117 and 0124;
  - pooled prices vs price by class;
  - typed currency;
  - whether staff can read the log.
- **Arrival:** where the threshold lives. [CORRECTED 2026-09-19: this was already
  answered — ADR 0149 row 11 / ADR 0144's consequences: the threshold is one line
  on folio 2 (the "pour" folio, alongside cellar). The C2 lane's build already
  placed it there (`Arrival.tsx`'s "What we pour" section); codex-audit/C2-adopt.md
  item 7 flagged this as an undecided fork implemented as if decided, but the
  fork was closed on 2026-09-16, three days after the lane's code was written —
  the audit was checking the placement against this file, which had not been
  updated. Not open.]
- **Vendor intel:** public-register rows with no house. Options A-D, recommendation C,
  in `p4-scratch/endpoint-faults/vendor-intel-identity.md`.
- **OAuth:** who may disconnect an integration for a user with no tenant
  (`p4-scratch/endpoint-faults/integrations-oauth.md`).
- **Notifications:** who may notify whom. POST `/notifications/order-approval`,
  `low-stock`, `delivery`, `price-negotiation`, `system-alert` and `send-email` still send
  to any user id or email address the body names. They were not fixed because the rule
  is a product call.

## 7. Where the evidence is

- `p4-scratch/endpoint-faults/*.md`: per-module endpoint fault reports (8)
- `p4-scratch/wave/DIGEST.md`: the page dossiers
- `p4-scratch/ask-census/`: the /ask census (the catalogue stage never ran)
- `p4-scratch/ports/*.md`: port reports, if any agent finished
- `p4-scratch/verify-index-<pid>.log`: every verify_index run
- this session's transcript:
  `~/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/b3992196-3993-4dfd-b3d7-f5b7b880c747.jsonl`

*This document adds a file under `.planning/handoff/` without naming a document to
retire (CLAUDE.md section 4). The founder asked for it explicitly. That is named here as
the exception, not assumed.*
