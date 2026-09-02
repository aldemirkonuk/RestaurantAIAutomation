---
name: pr-audit-gate
description: Use before merging ANY PR to main — invoke it directly, or it runs because the require_pr_audit PreToolUse hook blocks `gh pr merge`/a direct push to main until it has. Fans out 3 Opus auditor angles + a mandatory adversarial pass over the PR's diff and CI reports (ADR 0090 — model corrected from the original "Sonnet max" ask to Opus per ADR 0050's production/ADR/outward-send override); on approval it auto-merges via `gh pr merge --auto`, on block it posts findings and stops. Never call gh pr merge directly — call this skill, it calls gh pr merge for you once it approves.
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
  `gh pr merge` or a direct `git push` to `main` unless a PASS report already exists
  for the PR's exact head SHA — so attempting to merge without having run this
  skill fails with a message telling you to run it first.

## Doneability

A written report at `.planning/07-reference/pr-audits/<pr>-<sha7>.md` with an
explicit verdict (PASS or BLOCK), posted as a PR comment, for the PR's *current*
head SHA specifically — a report keyed to a stale SHA does not satisfy the hook,
by design (a force-push or new commit must be re-audited). On PASS, `main`'s HEAD
after this skill runs traces back through a merge commit whose PR carries that
comment. On BLOCK, the PR is untouched and the founder has the report in the PR
thread, not just in a chat transcript that scrolls away.

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
   '.required_status_checks.contexts'` — this list moves; it changed from 5 to
   3 while this skill itself was being built, so never hardcode it) against
   `gh pr checks <n>`. This audit is a semantic layer on top of green CI, never
   a replacement for it — if any required context is red or pending, stop and
   say so. Do not spend an Opus call auditing a PR that can't merge anyway.
3. **Gather the report bundle:**
   - `gh pr diff <n>` — the actual diff.
   - `gh pr checks <n> --json name,state,link` — per-check state and links.
   - Any coverage/SARIF artifacts reachable via `gh run view` / `gh api` for the
     head SHA's workflow runs, if you can fetch them cheaply. Don't block on a slow
     artifact fetch — note what you couldn't get and let the auditors know.
4. **Fan out the 3 auditor angles in parallel** — three `Agent` calls,
   `subagent_type: pr-merge-auditor`, each prompt carrying: the FOCUS ANGLE
   (correctness & regression risk / CLAUDE.md-and-ADR compliance /
   security & production blast-radius), the PR number + head SHA, the diff, and the
   report bundle from step 3. Run them in the same response (independent, no
   ordering dependency) — this is the "real parallel fan-out" CLAUDE.md §3 requires,
   not one thread narrating three angles serially.
5. **If any angle returns BLOCK:** skip the adversarial pass — verdict is BLOCK.
   Go to step 7.
6. **If all three lean APPROVE / APPROVE WITH NOTES:** spawn one
   `pr-merge-adversary` agent with all three reports + the diff. Its OVERTURNED
   verdict wins over the three APPROVEs; its HOLDS verdict makes the overall verdict
   PASS.
7. **Write the report** to
   `.planning/07-reference/pr-audits/<pr>-<short-sha>.md`: the verdict, each
   angle's findings, the adversarial pass's findings, and what (if anything) you
   could not check (report this as a limitation, never silently omit it — see
   [[absence-reported-as-health]]).
   **Commit and push this file, on the PR's own branch, before step 9.** An
   uncommitted report only satisfies `require_pr_audit.py`'s existence check
   for the rest of *this* session's working tree — it does not survive a fresh
   checkout, a different session, or a squash/rebase, and the whole point of
   writing it to `.planning/07-reference/pr-audits/` instead of a scratch path
   is that it's a durable artifact. (The CI-side script cannot do this — its
   runner's filesystem is discarded when the job ends — so it puts the full
   report in the PR comment instead; this is the one path that can commit it
   for real, and should.)
8. **Post the report to the PR:** `gh pr comment <n> --body-file <report>` (or a
   summary + a note that the full report lives at that path, if the report is long).
9. **Act on the verdict:**
   - **PASS:** `gh pr merge <n> --auto --squash`. Never `--admin` — if the merge
     doesn't go through because a required check isn't actually green, that is
     GitHub correctly refusing, not something to force past.
   - **BLOCK:** do not merge. Tell the founder directly in chat what blocked it and
     point at the PR comment — do not just let this scroll past as "done."

## Known limitations (state these if asked, don't bury them)

- This skill's own fan-out only runs inside a Claude Code session. The
  `.github/workflows/pr-audit-gate.yml` CI job is the backstop for merges that
  happen outside one — see ADR 0090 for what that job still needs (an
  `ANTHROPIC_API_KEY` secret, and a founder-approved branch-protection PATCH to make
  it a hard required check rather than advisory).
- Model choice corrected 2026-09-02: the original ask was "Sonnet max"; ADR 0090
  now runs `model: opus` / `reasoning_effort: high` per ADR 0050's own override
  rule (production/ADR/outward-send → Opus, and "never score effort" as a
  substitute for the tier the consequence calls for). `reasoning_effort: high` in
  the two agent definitions is a best-effort frontmatter signal, not a verified
  reasoning-budget guarantee — see ADR 0090's decision section.
