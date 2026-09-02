---
name: pr-audit-gate
description: Use before merging ANY PR to main — invoke it directly, or it runs because the require_sonnet_audit PreToolUse hook blocks `gh pr merge`/a direct push to main until it has. Fans out 3 Sonnet auditor angles + a mandatory adversarial pass over the PR's diff and CI reports (ADR 0090); on approval it auto-merges via `gh pr merge --auto`, on block it posts findings and stops. Never call gh pr merge directly — call this skill, it calls gh pr merge for you once it approves.
---

# pr-audit-gate

owner: platform/CI (no formal department card yet — this is the first
judgment-class agent in the repo; see ADR 0090 §"Options considered" note on
`scripts/agents/run_card.py` being mechanical-only). Not scheduled — event-triggered
(every PR push) rather than run on a timer.

## Trigger

- Manually: `/pr-audit-gate [pr-number]` (defaults to the PR for the current branch).
- Automatically: the `require_sonnet_audit` `PreToolUse` hook
  (`scripts/hooks/require_sonnet_audit.py`) blocks any Bash call shaped like
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
2. **Confirm existing CI is green first.** `gh pr checks <n>`. This audit is a
   semantic layer on top of green CI, never a replacement for it — if any of the 5
   existing required contexts (`CI Complete`, the 3 schema-parity checks, the
   beverage/guest-merge checks) are red or pending, stop and say so. Do not spend a
   Sonnet call auditing a PR that can't merge anyway.
3. **Gather the report bundle:**
   - `gh pr diff <n>` — the actual diff.
   - `gh pr checks <n> --json name,state,link` — per-check state and links.
   - Any coverage/SARIF artifacts reachable via `gh run view` / `gh api` for the
     head SHA's workflow runs, if you can fetch them cheaply. Don't block on a slow
     artifact fetch — note what you couldn't get and let the auditors know.
4. **Fan out the 3 auditor angles in parallel** — three `Agent` calls,
   `subagent_type: pr-sonnet-auditor`, each prompt carrying: the FOCUS ANGLE
   (correctness & regression risk / CLAUDE.md-and-ADR compliance /
   security & production blast-radius), the PR number + head SHA, the diff, and the
   report bundle from step 3. Run them in the same response (independent, no
   ordering dependency) — this is the "real parallel fan-out" CLAUDE.md §3 requires,
   not one thread narrating three angles serially.
5. **If any angle returns BLOCK:** skip the adversarial pass — verdict is BLOCK.
   Go to step 7.
6. **If all three lean APPROVE / APPROVE WITH NOTES:** spawn one
   `pr-sonnet-adversary` agent with all three reports + the diff. Its OVERTURNED
   verdict wins over the three APPROVEs; its HOLDS verdict makes the overall verdict
   PASS.
7. **Write the report** to
   `.planning/07-reference/pr-audits/<pr>-<short-sha>.md`: the verdict, each
   angle's findings, the adversarial pass's findings, and what (if anything) you
   could not check (report this as a limitation, never silently omit it — see
   [[absence-reported-as-health]]).
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
  `.github/workflows/sonnet-audit-gate.yml` CI job is the backstop for merges that
  happen outside one — see ADR 0090 for what that job still needs (an
  `ANTHROPIC_API_KEY` secret, and a founder-approved branch-protection PATCH to make
  it a hard required check rather than advisory).
- "Sonnet max": `reasoning_effort: max` in the two agent definitions is a
  best-effort frontmatter signal, not a verified reasoning-budget guarantee — see
  ADR 0090's decision section.
