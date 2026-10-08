# 0268 — Nothing you need tomorrow lives in /tmp

- **Status:** Locked
- **Date:** 2026-10-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** /tmp, /private/tmp, scratchpad, reboot, worktree, git worktree prune, rescue ref, refs/rescue, p4-scratch, durable documents, damage report, stash
- **Links:** `CLAUDE.md` §7; [[0240-register-entries-are-fragments]] (fragments, not new top-level docs); the damage report `~/Projects/p4-scratch/damage-2026-10-03/README.md` (outside the repo, by design: it indexes this machine's disk)

## Context

The Mac rebooted on 2026-10-03 at 01:37:57 local (`sysctl kern.boottime`). macOS empties
`/private/tmp` at every boot, and every Claude session's scratchpad is there
(`/private/tmp/claude-501/<project>/<session>/scratchpad`). The harness tells sessions to use it
for temporary files, and sessions also put real work there: lane, audit and fixer worktrees,
plans, audit bundles, handoffs and PR-body drafts.

The boot took 80 git worktrees from 4 sessions (`git worktree list --porcelain | grep -c
prunable` = 80), about 526 scratch documents and every workflow task output. The damage sweep,
which was read-only with adversarial verification, measured the following:
- No authored work was lost for good this time. 79 of the 80 HEADs were on GitHub.
- The one real uncommitted loss was PR #584's round-2 fix: 3 files, +90/−34. It had to be redone by hand.
- 509 of the 526 documents could be rebuilt, but only by replaying transcript `Write` calls.
- Output from redirects, `tee` and appends was not recorded anywhere and is gone.

The same sweep found losses from earlier boots (09-05, 09-12 and 09-28):
- The 09-28 boot wiped an uncommitted 153-file layer in `/private/tmp/pr-415-prep-wt` that was never pushed.
- Within hours of this boot, one session had again put 10 worktrees and 111 files under /tmp, including a detached
  HEAD carrying 2 commits that no ref pointed to (`8b8604559`, PR #582 round 3).

Nothing in the repo said not to do this, so every session kept doing it.

## Options considered

The founder was asked on 2026-10-03, with the damage report in hand, which prevention rules become a decision.
The options could be combined.

1. **A. Worktrees outside /tmp.** Lane, audit and fixer worktrees go under `~/Projects/`. This stops the git loss outright. Cost: disk use, and a cleanup rule, since nothing empties `~/Projects` for us. **Chosen.**
2. **B. Durable documents go to p4-scratch when they are written.** Plans, audit bundles, handoffs, verdicts and PR-body drafts go to `~/Projects/p4-scratch/<lane>/` from the start, and /tmp keeps throwaway logs only. Cost: p4-scratch grows. **Chosen.**
3. **D. A rescue sweep that runs before it is needed.** A script pins every /tmp worktree HEAD under `refs/rescue/<date>/` and copies uncommitted diffs to p4-scratch. It is a backstop for sessions that miss A or B. Cost: building it without the shared-stash race. **Chosen.**
4. **C. Push lane branches at the first commit.** Never leave a commit unpushed or on a detached HEAD. **Rejected.** It conflicts with §7's "commit only when asked" and with work the founder keeps local on purpose (the flavor lab, `bf111eab2`).
5. **E. Retire the shared `refs/stash`.** This was not part of this question. The unique files in stash@{0} and @{2}, including two essays that existed nowhere else, were copied to `~/Projects/p4-scratch/stash-rescue-2026-09-25/` on the founder's separate word the same day. The stash itself is untouched. Sessions are already told never to `git stash` (memory `shared-git-stash-race`), but no ADR or guard makes that binding.
6. *Do nothing.* Every boot repeats this. This boot cost one redone fix, one unpushed 153-file layer from an earlier boot, and about 1M agent tokens to establish that the rest was recoverable.

## Decision

Anything a session needs past its own run lives under `~/Projects/`, never in `/private/tmp`, and
a rescue sweep backs that up. The founder's answer was "Worktrees outside /tmp", "Durable docs to
p4-scratch" and "Rescue-sweep hook", 2026-10-03.

- **Worktrees** go under `~/Projects/`: `wt-*` for lanes, as today, and `~/Projects/.scratch/<session8>/`
  for audit, fixer and mutation copies.
- **Durable documents** go to `~/Projects/p4-scratch/<lane>/` when they are written: plans, audit bundles and
  reports, handoffs, verdicts, PR-body drafts and founder-answer notes. The scratchpad holds throwaway logs only.
- **A commit never sits on a detached HEAD in /tmp.** Branch it or move it.
- **The rescue sweep** is built in a later PR. It pins HEADs under `refs/rescue/<date>/<session8>-<name>`, the shape used by
  hand on 2026-10-03. It copies `git diff` and `git diff --cached` to p4-scratch. It never uses `git stash`, and it never prunes.

`CLAUDE.md` §7 carries the rule in one line, because sessions read CLAUDE.md and do not read ADRs.

### Open within this ADR (not decided)

- **The cleanup rule for `~/Projects/.scratch/`.** Who removes a scratch worktree, and when.
- **The rescue sweep's trigger.** A scheduled job (launchd or cron), a session Stop hook, or both. A sweep cannot run "before a reboot" on demand, because nothing announces one.
- **Whether `git worktree prune` may ever run on this repo again.** As of 2026-10-03, 80 prunable entries are kept on purpose and pinned by `refs/rescue/2026-10-03/*`.

## Consequences

- A reboot now costs only throwaway logs and screenshots. Tomorrow's session finds the worktree and the plan where yesterday's left them.
- `~/Projects` grows, and the clutter that /tmp used to clear on its own is now an explicit job. Until the cleanup rule is decided it accumulates.
- The harness default still says "use the scratchpad", so a session that does not read §7 will keep writing to /tmp. The rescue sweep exists for that case.
- **Revisit** if a boot again loses authored work, or if `~/Projects/.scratch` passes a size the founder names.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-10-03 | founder | Locked: A, B and D chosen; C rejected |
| 2026-10-03 | damage sweep, workflow `wf_ff6473f0-f39` (4 sweeps and 2 adversarial verifiers) | The measured basis in §Context |
