# /tmp wipe of 2026-10-08: damage to session 05c659bb

Written 2026-10-08T01:56Z by the analytics-fix coordinator (session 05c659bb), in answer to the founder's question: "Check how much the session got affected because of the wipe of slash TMP."

**Bottom line:**
- No committed or pushed work was lost, and no lane head moved.
- The reboot did kill nine workflows mid-run.
- It also left four lanes with half-finished, unreviewed edits; each is saved here as a patch.
- One finished audit (#623 PASS) was recovered from its journal and posted.
- The rest of the in-flight work has to be redone. That work is listed below.

## 1. What happened

- **The reboot:** `last reboot` shows `Wed Oct 7 21:47` local, which is **2026-10-08T01:47:48Z**. It was the fourth wipe of this session, after 10-03 01:37, 10-06 08:31 and 09-28.
- **What it cleared:** macOS cleared `/private/tmp` at boot. That took:
  - the session scratchpad, `/private/tmp/claude-501/…/05c659bb…/scratchpad/`;
  - every background task's `.output` file.
- **Evidence it was this boot:**
  - `p4-scratch/coord/wipe-2026-10-07/scan.json` is another session's scan, read as data only. Its row for 05c659bb at boot 2026-10-07 gives `last_before 01:45:21Z`, `resumed_after 01:48:51Z` and 348 actions in the 30 minutes before the boot.
  - In this session, the first `no such file` error on the scratchpad came at 01:50:12Z (`prunable.txt`).

## 2. What survived (measured after the reboot)

- **Worktrees:** 163 are registered, and **0 are prunable**. No worktree lived under /tmp; an agent's `/private/tmp/x618/w` detached tree had already been removed.
- **Lane heads:** every `wt-fix-*` head is unchanged. Compare `lanes-before.tsv` with `lanes-after.tsv`.
- **Unpushed commits:** several lanes hold commits that exist only in their worktree, under ~/Projects, not /tmp. They survived:
  - with no origin branch: assignadr, capreads, delivverify A/B, ordersccy, promogate, receivingccy, countryfirst;
  - ahead of origin: firstmenu +4, houseswitch +5, rawline +4, servesize +26, stockout +27, tablesins +58, units +28, caltakings +19.
- **Rescue refs:** `refs/rescue/*` is intact (81 + 4 + 30).
- **Workflows:** every workflow journal is intact under `~/.claude/projects/…/05c659bb…/subagents/workflows/wf_*/journal.jsonl`, and so is every record under `…/workflows/*.json`.
- **Durable docs:** everything in `p4-scratch/` (fixes/README.md, audit-queue.txt, audits/, tools/) and the session transcript are intact.

## 3. What was lost

### 3a. Nine workflows killed mid-run

Each one has a journal but no record, which means it was in flight.

| Workflow | Task | Reached before the kill | Redo |
|---|---|---|---|
| wf_ddb50b0d-61b | #623 fresh full audit at 5f99edfb3 | **Final: HOLDS, PASS with 5 notes.** Only the post step was killed. | **Done 01:55Z:** report assembled from the journal (`fixes/audits/623-5f99edfb3/report.md`) and posted, with the PR's issue comment 6050574191. Head and main were re-checked first (5f99edfb3, be9a16ccf). |
| wf_6347f52e-98f | #611 delta audit at 6e1ea69bb (vs PASS ada37ebb1) | Bundle and plan done; both reviewers were running | Relaunch `fixes/audit.js` for #611. The plan cannot be reused, because resume caches a call-order prefix. |
| wf_28aa02b7-e80 | #614 delta audit at 559d86bb7 (vs PASS f6b57edae) | Bundle and plan done; both reviewers were running | Relaunch for #614 |
| wf_c8c8478b-8ec | Version-conflict re-sync | tablesins merge done (69b059bb3, version 11); verify:tablesins and merge:stockout were killed | Verify tablesins; re-run the stockout merge (stockout is clean at 4234b3a8f, not yet merged with be9a16ccf) |
| wf_23152dcd-96f | rawline #655 + firstmenu #656 build | Both builds done (rawline 18c2de14e, firstmenu 7f4576516); both verifies were killed | Verify both; rawline still needs `merge_main.sh` for be9a16ccf |
| wf_2d077ab7-d6c | delivverify build | Build done, split into A (cac2a6266) and B (8a132f08c), neither pushed; verify was killed | Verify, then open A and B (B waits for #659) |
| wf_ca4f970c-b77 | assign2 (houseswitch #654 round 2) | The fix agent was mid-edit: **3 uncommitted files** in wt-fix-houseswitch | Review the patch (§3b); assignadr is clean at e85965716 |
| wf_62b33fab-349 | Cap splits and musts | 5 agents started (plan:servesize, build:ordersccy, plan:capreads, build:promogate, build:receivingccy); **none returned and none left edits** | Redo from scratch |
| wf_0a6948c2-be9 | units #626 / countryfirst / caltakings #610 round 3 | 3 fix agents were mid-edit; **uncommitted files** in all three | Review the patches (§3b) |

### 3b. Half-finished edits

These edits are uncommitted and unverified, so do not commit them as found. Each worktree is untouched, and a snapshot of its diff is saved here:

| Lane | Head | Files | Patch |
|---|---|---|---|
| caltakings | 4862cc72e | 7: day-record.service.ts, day-record.spec.ts, recorded-days.service.ts, CalendarNext.test.tsx, MonthLedger.tsx, SkyMark.tsx, useCalendarNextData.ts | `uncommitted-caltakings-4862cc72e.patch` |
| houseswitch | c50e54d4c | 3: claims.d/fix-a-house-switch-clears-the-last-house.jsonl, tech-debt.d/2026-10-07-…md, recommendation-actions.service.ts | `uncommitted-houseswitch-c50e54d4c.patch` |
| units | 5168c70f9 | 4: ADR 0297, claims.d/fix-a-glass-is-not-a-bottle.jsonl, consumption-units.spec.ts, consumption-units.ts | `uncommitted-units-5168c70f9.patch` |
| countryfirst | b49008c4e | 2: MarketIndexPanel.tsx, MarketIndexPanel.test.tsx | `uncommitted-countryfirst-b49008c4e.patch` |

Each lane's round brief is in its workflow script under `…/05c659bb…/workflows/scripts/`. A redo agent should:
1. read the brief;
2. diff the patch against it;
3. finish or discard the edits;
4. run the lane's tests and tsc (on both gateway configs);
5. commit only then.

### 3c. Two background shells

- **b44g43cve:** tsc on `tsconfig.spec.json` for tz, moneybell, booth and proxies, plus web tsc for tz and proxies. Its output (`tsc-0200.txt`) is lost.
- **Effect:** those lanes' tsc results on `tsconfig.spec.json` are **unverified**. bd3g1y4fc's "0 errors" may have covered `tsconfig.json` only. Re-run before any of them merges. **[2026-10-08T02:03Z: re-run. Every config shows only the known @simplewebauthn errors, and those errors' presence proves tsc ran: `tsc-rerun-0203Z.txt`.]**

### 3d. Scratchpad files written since the last boot (10-06 12:31Z)

**Most of the scratchpad has a durable copy.** Before the planned move to the CLI, the session copied its scratchpad (563 entries) and 160 task outputs to `p4-scratch/session-05c659bb-scratchpad-2026-10-07/`, at 2026-10-07 22:08–22:15Z. That copy's README lists what was left out: repo snapshots and the jest cache. It holds, for example, 619-fresh.log, forks-b.json, loop20.sh, 649-live.md, pgtpl-20261007.txt, orig.test.tsx and 609files.txt. **So only files written or changed between 22:15Z and 01:47Z are truly gone.** The table below covers the 35 files the transcript shows were written since the last boot. Either way, none of them was the only record of a decision or a verdict:

| Kind | Files | Where the content survives |
|---|---|---|
| Tracking tables (first written after 22:15Z, so they are not in the copy) | prs.tsv, lanes.tsv, merged.tsv, resync-0115.txt, prunable.txt | The transcript (last reads ~01:43Z). `lanes-before.tsv` here was rebuilt from it; `lane-table.tsv`, `open-prs.tsv` and `merged-prs.json` here were re-measured at ~02:00Z; `fixes/HANDOFF-2026-10-08.md` carries the tables. |
| PR bodies and comments already posted | 623-body-live.md, 628-live-body.md, 652-body-live.md, 657-comment-body.md, gh-comment-612.md, dayex-gh.md, docwrites-gh.md, body628*.{md,py} | On GitHub |
| Fork research | forks-b.json; the rawline/, trial/, delivverify/ dirs | forks-b.json was already copied to `fixes/audits/fork-research-2026-10-07b.{json,md}`. The three fork workflows (wf_4b1156ad-fce, wf_77969892-96f, wf_b869a1f4-07a) all **completed**; results are in their records and their ADRs are in the lane worktrees. |
| Snapshots and copies of committed files | 0290.pre-623fix.md, dc-lane.ts, dc-main.ts, pr_audit_gate.py, a045.patch, orig.test.tsx, 609files.txt | In git (0290 is committed at 8c964cbd2; the rest are `git show` copies) |
| Logs and probes | 619-fresh.log, 649-live.md, 628-pg.txt, pgtpl-20261007.txt, rawline-check.txt, loop20.sh | Each finding was already logged in fixes/README.md or posted. 619-fresh.log was a copy of CI job 112395615273's log, which can be fetched again from GitHub while the log is retained. 628-pg.txt has no other copy, but #628 is merged (62f8967b4). |
| tsc output | tsc-0200.txt | **Lost**; see §3c |

There were also 21 files written by sub-agents (mutation and claim scripts, `verify-626/mut.py`, `parts*.json` and others). These were throwaway test scaffolding. Each agent's result is in its workflow journal.

The `run/` and `venue/` references in `scratch-refs-main.txt` are from the sim kit's 10-01 to 10-03 era. They were lost in the **10-03** wipe, not this one, and were recovered then (`p4-scratch/sim-run/recovered/`, `rebuild/`, `reinject/RESUME.md`).

## 4. Errors this session made around the wipe

- **Misstamped times.** Lines in `fixes/README.md` and `fixes/audit-queue.txt` were written by 01:39:45Z (from the file mtime) but stamped 01:48–01:54Z. They are now bracket-corrected in place, and the four queue lines are marked KILLED.
- **A bad redirect.** `/tmp/../private/tmp/...` resolves to `/private/private/tmp` and fails. This report's files went to p4-scratch instead.

## 5. Not checked

- Other sessions' damage. scan.json covers them; this report covers 05c659bb only.
- The cloud task task_ad60d6a1 runs off this machine, so it is unaffected; I did not re-read it.

## 6. Files here

- `lanes-before.tsv`, `lanes-after.tsv`: lane, head and dirty count.
- `prunable.tsv`: empty.
- The four `uncommitted-*.patch` files.
- `scratch-refs-main.txt`, `scratch-refs-subagents.txt`: every scratchpad path the transcript references, with counts.
