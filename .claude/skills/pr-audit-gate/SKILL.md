---
name: pr-audit-gate
description: Pre-merge audit using one Opus planner, two parallel Sonnet reviewers, and the resumed Opus planner for final adjudication. CI must be green; uncertainty or reviewer BLOCK prevents merging (ADR 0090, 2026-09-17 amendment).
---

# pr-audit-gate

owner: platform/CI (no formal department card yet — this is the first
judgment-class agent in the repo; see ADR 0090 §"Options considered" note on
`scripts/agents/run_card.py` being mechanical-only). Not scheduled — event-triggered
(every PR push) rather than run on a timer.

## Trigger

- Manually: `/pr-audit-gate [pr-number]` (defaults to the PR for the current branch).
- Automatically: the `require_pr_audit` `PreToolUse` hook
  (`scripts/hooks/require_pr_audit.py`) blocks any Bash call shaped like
  `gh pr merge <n>` or a direct `git push` to `main` unless a PASS **comment
  marker** already exists for that exact PR number and head SHA — so attempting
  to merge without having run this skill fails with a message telling you to
  run it first. Every merge in a command is checked, so chaining a clean
  merge in front of another does not carry the second through. The PR must be
  a literal `<n>` (or its URL): a bare `gh pr merge`, a branch name, `$n` or
  `$(...)` blocks. One merge per command: a second `gh pr merge` in the same
  command blocks, as do `--admin`, `--auto`, `gh alias set`, and a `pr`
  subcommand written with quoting or expansion (`$'merge'`, `{merge,}`); write
  the merge plainly. MCP tools that merge or arm auto-merge are blocked outright.

## Doneability

A PR comment carrying the exact marker
`<!-- pr-audit-gate: pr=<n> sha=<sha7> verdict=PASS -->` (or `verdict=BLOCK`),
for the PR's *current* head SHA specifically — a marker for a stale SHA does not
satisfy the hook, by design (a force-push or new commit must be re-audited). On
PASS, `main`'s HEAD after this skill runs traces back through a merge commit
whose PR carries that comment. On BLOCK, the PR is untouched and the founder has
the report in the PR thread, not just in a chat transcript that scrolls away.

## Real past instance

See ADR 0090 §Context: the `gateway-boot` crash-loop (green `tsc` + 780 passing
Jest tests, still crash-looped production because nothing constructed the real
Nest injector — a dedicated CI job was added only *after*) and the OAuth
self-provision hole (PR #179, shipped with green CI). Neither is provably something
this gate would have caught; both are the shape of failure — checks that pass
individually while what they don't cover reaches production — this gate exists for.

## How to run

1. **Resolve the PR.** `gh pr view [<n>] --json number,headRefOid,baseRefName,url,title`.
   If it targets anything other than `main`, or doesn't exist (a direct push
   scenario), say so and stop — this gate is for PRs into `main`.
2. **Confirm existing CI is green first.** Read `main`'s *current* required
   status contexts (`gh api repos/.../branches/main/protection --jq
   '.required_status_checks.contexts'` — this list moves; it changed 5→3→5
   while this skill itself was being built (other sessions' unrelated CI
   work), so never hardcode it or cite a current count) against
   `gh pr checks <n>`. This audit is a semantic layer on top of green CI, never
   a replacement for it — if any required context is red or pending, stop and
   say so. Do not spend an Opus call auditing a PR that can't merge anyway.
3. **Gather the report bundle:**
   - `gh pr diff <n>` — the actual diff.
   - `gh pr checks <n> --json name,state,link` — per-check state and links.
   - Any coverage/SARIF artifacts reachable via `gh run view` / `gh api` for the
     head SHA's workflow runs, if you can fetch them cheaply. Don't block on a slow
     artifact fetch — note what you couldn't get and let the auditors know.
4. **Decide gate ownership with `origin/main`'s classifier, before any model call.**
   From the checkout, run:
   ```
   REPO="$(git rev-parse --show-toplevel)"; GATE="$(mktemp -d)"
   git -C "$REPO" fetch --no-tags -q origin +refs/heads/main:refs/remotes/origin/main &&
   git -C "$REPO" show refs/remotes/origin/main:scripts/pr_audit_gate.py > "$GATE/pr_audit_gate.py" &&
   PR_NUMBER=<n> PR_EXPECTED_HEAD=<audited full sha> PR_AUDIT_REPO_DIR="$REPO" python3 -I "$GATE/pr_audit_gate.py" --ownership
   ```
   - **Exit 0.** Continue to step 5.
   - **Exit 3.** The PR changes what the gate owns (ADR 0090, 2026-09-18 amendment).
     - Stop before any model call.
     - Post a comment that starts `<!-- pr-audit-gate: pr=<n> sha=<sha7> verdict=BLOCK -->`,
       is headed ESCALATED, and carries the printed reasons verbatim.
     - Tell the founder in chat.
     - Only the founder's word merges it, through the SHA-pinned
       `gh api …/pulls/<n>/merge` that ADR 0090's review trail records for #261,
       #297 and #299. `require_pr_audit.py` blocks `gh pr merge` on an owned PR
       even with a PASS marker.
   - **Exit 4, any other exit, or no output.** CANNOT CHECK. Stop the same way and say
     what failed. Never continue on a guess.

   The rule, in words (the code is `gate_ownership()` in `scripts/pr_audit_gate.py`;
   change both together). It reads `git diff --raw --no-renames` between the PR's
   merge-base with `main` and its exact head SHA, so a rename is seen from both sides.
   A PR is owned when any of these holds:
   - **Owned paths**, compared case-folded: `scripts/pr_audit_gate.py`,
     `scripts/hooks/`, the gate's tests `scripts/test_pr_audit_gate.py` and
     `scripts/test_require_pr_audit.py`, `scripts/check_test_scripts_are_real.py`,
     the deploy verification `scripts/check_deployed_sha.py`,
     `scripts/resolve_watched_commit.py` and `scripts/check_deploy_audit_ran.sh`,
     all of `.github/workflows/` and `.github/actions/`,
     `.planning/decisions/0050-*`, `.planning/decisions/0090-*`, anything inside a
     `.claude` directory and any `.mcp.json`, `CLAUDE.md`, `CLAUDE.local.md` or
     `AGENTS.md`, each at any depth (a nested `.claude/skills/` loads when Claude
     works in that directory), a path with a control character, and any path
     that collides with another under case folding.
   - **The index** (`.planning/decisions/README.md`), unless every change is an
     appended ADR row `| [NNNN](NNNN-slug.md) | … |` inside the Locked or Proposed
     table, linking the one ADR file this PR adds under that number, with a number
     never used on `main`. Editing, moving or deleting any line stays owned.
   - **Decision text.** Every file under `.planning/decisions/` is read whole, before
     and after, and is owned if it names the gate (ADR 0050 or 0090, the gate's
     script, hook, skill or agents, gate-owned paths, hardness scores, self-merging).
     For the index, `OPEN-DECISIONS.md`, `CLAIMS.jsonl`, `PROJECT.md` and
     `FUTURES.md`, only changed lines are judged. Tag or bidi characters, line
     separators other than `\n`, NUL, invalid UTF-8, letters or digits outside Latin
     and Greek, and a symlink, submodule or executable on this surface are owned
     outright.
   - **Anything the check cannot read** (the head moved, a fetch failed, a register diff past its line bound, an
     unexpected change type): CANNOT CHECK, never released.

   This step keeps no path list of its own; the classifier is the only list. The two
   copies drifted twice: first over `CLAUDE.md`, then over `0050` and
   `pr-merge-planner`. Never run the checkout's copy: on a PR branch, it is the code
   under review.

   If the only reasons are lines in a NEW decision file that cite the gate as a
   witness (for example "pr-audit-gate round 2 found X"), the author may re-cite them
   as `audit of PR #M, round N (report path)` and re-run. Never reword a line that
   states a rule about the gate, or says what the gate does, to get past this step.

   Gate rules live only in ADR 0090, ADR 0050 and the owned files, whatever their
   index rows say. Unlike the CI path, a session auditing its own checkout has no
   `pull_request_target`-style isolation. Running `origin/main`'s classifier covers
   the ownership decision only; the reviewers must still read decisions with
   `git show origin/main:<path>`.

   **Stop before model calls** also when the diff cannot be reviewed completely.
   Record BLOCK and request human review. Do not pay for an approval that cannot
   authorize a merge.
5. **Plan once with Opus.** Spawn `pr-merge-planner` with the original SHA-pinned
   bundle. A missing, incomplete or non-READY plan blocks. Keep the agent ID.
6. **Run two Sonnet reviews in parallel.** Spawn `pr-merge-auditor` for correctness,
   regression and decision compliance, and `pr-merge-adversary` for security and
   adversarial counterexamples. Both receive the original bundle and plan, not each
   other's report. The plan never caps research or suppresses contradictory evidence.
   Any BLOCK, incomplete output or unparseable verdict blocks; skip the final call.
7. **Resume the same Opus planner** with both complete approve-leaning reports.
   It must challenge approval against the original evidence. Only a complete final
   `VERDICT: HOLDS` permits PASS. Anything else blocks. This is three roles and up
   to four calls (two Opus, two Sonnet), not three calls or four Opus sessions.
8. **Write the report** locally to `.planning/07-reference/pr-audits/<pr>-<short-sha>.md`
   (useful as this session's own record) — this file is NOT what satisfies the
   hook; see step 9's marker. Include the verdict, each angle's findings, the
   adversarial pass's findings, and what (if anything) you could not check
   (report this as a limitation, never silently omit it — see
   [[absence-reported-as-health]]).
9. **Post the FULL report to the PR as a comment**, starting with the exact
   marker line `<!-- pr-audit-gate: pr=<n> sha=<full-or-7-char-sha> verdict=PASS -->`
   (or `verdict=BLOCK`) — `gh pr comment <n> --body "..."`. This marker, not a
   committed file, is what `require_pr_audit.py` checks. **Do not commit the
   local report file before merging** — a v1 version of this skill did, which
   changes the head SHA the very check you're about to satisfy is keyed to,
   producing a livelock (confirmed live, PR #261 run 33695630472, correctness
   angle BLOCK: "the same shape as the gateway-boot incident — nothing
   constructed the real hook"). The comment is the durable, SHA-stamped
   record; the local file is a convenience copy, not a prerequisite.
10. **Act on the verdict:**
    - **PASS:** `gh pr merge <n> --squash --match-head-commit <audited-full-sha>` — **no `--auto`.** `--auto` arms
      GitHub's auto-merge against the PR, not the audited commit; a push
      landing after you PASS but before GitHub actually merges would go
      through unaudited once the (unrelated) required checks are green
      (confirmed live, correctness angle, third audit — the CI-side script
      hit this exact race and now uses a SHA-pinned `gh api` merge instead;
      the Claude-Code path stays on `gh pr merge` for hook-pattern
      compatibility, but drops `--auto` so the merge is immediate; `--match-head-commit` binds it to
      the exact audited SHA, not whatever head appears before the command).
      Always the explicit `<n>`, with `--match-head-commit` given once as its
      own argument (the hook blocks anything else). Never `--admin` — if the merge doesn't go through
      because a required check isn't actually green, that is GitHub
      correctly refusing, not something to force past.

      **This path does NOT need the CI-side workflow-dispatch fix below.**
      GitHub only suppresses new workflow runs for a push made with the
      built-in Actions `GITHUB_TOKEN` — a merge you run here goes out under
      *your own* `gh auth` identity, so `main`'s normal `on: push` CI run
      (and the `workflow_run`-triggered deploy audit behind it) fires
      exactly as it would for any other push. Confirmed live (fourth audit,
      security angle): this repo's entire merge history to date is
      founder-identity (`web-flow`), which is this exact path.
    - **BLOCK:** do not merge. Tell the founder directly in chat what blocked it and
      point at the PR comment — do not just let this scroll past as "done."

## Known limitations (state these if asked, don't bury them)

- This skill's own fan-out only runs inside a Claude Code session. The
  `.github/workflows/pr-audit-gate.yml` CI job is the backstop for merges that
  happen outside one — see ADR 0090 for what that job still needs (a
  founder-approved branch-protection PATCH to make it a hard required check
  rather than advisory; the `ANTHROPIC_API_KEY` secret has been added).
- Current model routing is the founder-authorized 2026-09-17 amendment to ADRs
  0050/0090 (superseding the 2026-09-02 "Sonnet max" → Opus correction's
  all-Opus fan-out, not the safety rules): one Opus planner, two independent
  Sonnet reviewers, the same Opus planner resumed for final judgment. Agent
  definitions explicitly select `model` and `effort`; do not let a reviewer
  inherit an Opus parent.
- The CI-side `.github/workflows/pr-audit-gate.yml` / `scripts/pr_audit_gate.py`
  path is unchanged by this amendment and still describes the old
  three-Opus-angle-plus-adversary composition — it is not a required status
  context and the account behind its `ANTHROPIC_API_KEY` has had no credit
  since 2026-09-12, so treat it as non-functional backstop, not a live second
  gate, until both are addressed (see ADR 0090's 2026-09-17 amendment).
- The CI path now escalates an owned PR before any model call, even with no key
  or credit (ADR 0090, 2026-09-18 amendment).
- **v1 → v2, same day (2026-09-03):** this gate's own first real audit (PR
  #261, run 33695630472) found and this session fixed: the livelock in step 9
  above; the hook resolving the wrong PR's report when the current branch
  differs from the PR being merged (now parses `<n>` out of the gated command
  — see the hook's own docstring); a CI-side self-audit trust-boundary hole
  where a same-repo PR's own modified `pr_audit_gate.py` was the code
  auditing it, with write access and the live key (fixed via
  `pull_request_target` + a base-pinned checkout — see the workflow file's
  header); and this skill's step 4 escalation, which the CI fix does not
  cover for the Claude-Code path since a session auditing its own checkout has
  no equivalent isolation.
- **v2 → v3, same day:** a third real audit (compliance angle) caught this
  section itself making a false claim — it used to say the
  `.planning/07-reference/pr-audits/` retention question was "filed as an
  open fork," and it was not; `OPEN-DECISIONS.md` had no row for it. Not
  filed now either, deliberately: adding a row to that specific file has a
  measured cost (see [[register-row-shifts-citations]] — ~173 citations
  across ~89 files move when a new fork is inserted there) disproportionate
  to a retention-policy question for a generated-report directory. This is
  named as an open question the founder can answer directly, not defaulted
  and not falsely marked filed. Same audit also fixed: `CLAUDE.md`,
  `.planning/decisions/0090-*.md`, and `.planning/decisions/README.md` added
  to both owned-path lists (step 4 above and `_GATE_OWNED_PATHS` — they had
  drifted, CI had `CLAUDE.md` and this file didn't) [2026-09-18: both lists
  replaced by gate_ownership(); the index is owned only when its diff is not a
  pure append — ADR 0090 amendment]; the stale
  `ANTHROPIC_API_KEY`-not-yet-added claim in `decisions/README.md` (the
  secret has been live since 2026-09-02; that row said otherwise until
  2026-09-03); and `_verdict_of()` now has a `--self-test` (see the script)
  covering the exact adversarial input that broke it, so this class of bug
  fails a committed test next time rather than needing a fourth live audit
  to notice it again. Still unaddressed: no `CLAIMS.jsonl` entries for ADR
  0090's two time-sensitive claims (structurally blocked until the retention
  question above gets an OD number, since claims key to `OD-*` ids in this
  repo), and CLAUDE.md §7 not yet amended with a pointer to this ADR — the
  latter is now itself an owned-path change, so it will force-escalate to
  the founder rather than merge on its own, which is the intended shape.
