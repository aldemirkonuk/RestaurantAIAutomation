---
name: pr-audit-gate
description: Use before merging ANY PR to main — invoke it directly, or it runs because the require_pr_audit PreToolUse hook blocks `gh pr merge`/a direct push to main until it has. Fans out 3 Opus auditor angles + a mandatory adversarial pass over the PR's diff and CI reports (ADR 0090 — model corrected from the original "Sonnet max" ask to Opus per ADR 0050's production/ADR/outward-send override); on approval it merges immediately via `gh pr merge --squash` (no `--auto` — that races an unaudited later push), on block it posts findings and stops. Never call gh pr merge directly — call this skill, it calls gh pr merge for you once it approves.
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
  run it first. (`gh pr merge` with no number resolves via the current branch;
  always pass `<n>` explicitly so the hook checks the PR you mean, not
  whichever one your branch happens to be on.)

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
4. **Check whether this diff touches the gate's own files** — anything under
   `scripts/pr_audit_gate.py`, `scripts/hooks/require_pr_audit.py`,
   `.github/workflows/pr-audit-gate.yml`, `.claude/agents/pr-merge-*.md`,
   `.claude/skills/pr-audit-gate/`, `.claude/settings.json`, `CLAUDE.md`,
   `.planning/decisions/0090-*.md`/`.planning/decisions/README.md`,
   `.github/workflows/ci.yml` (carries the `workflow_dispatch:` trigger the
   CI-side merge step depends on — added fifth audit, correctness angle), or
   `.github/workflows/deploy.yml` (the post-merge production-deploy-
   verification workflow ADR 0097 built — a PR that weakens what it checks
   would otherwise be evaluated as ordinary and could self-merge; found by
   PR #291's security audit, 2026-09-03, see ADR 0090's seventh Correction).
   Keep this list in sync with `_GATE_OWNED_PATHS` in `scripts/pr_audit_gate.py` — a
   third real audit (2026-09-03, compliance angle) found the CI side had
   `CLAUDE.md` in its owned-paths list and this step didn't, so a
   `CLAUDE.md`-only PR could steer the compliance angle's own reading of
   what's compliant without ever triggering escalation. If so, this PR
   changes what future audits do — carry that forward to step 9 regardless of
   what the angles conclude (see step 9). Unlike the CI path, a Claude Code
   session auditing its OWN checkout has no `pull_request_target`-style
   isolation from a modified script — say so plainly rather than treating a
   self-audited PASS on these files as equivalent to an ordinary one.
5. **Fan out the 3 auditor angles in parallel** — three `Agent` calls,
   `subagent_type: pr-merge-auditor`, each prompt carrying: the FOCUS ANGLE
   (correctness & regression risk / CLAUDE.md-and-ADR compliance /
   security & production blast-radius), the PR number + head SHA, the diff, and the
   report bundle from step 3. Run them in the same response (independent, no
   ordering dependency) — this is the "real parallel fan-out" CLAUDE.md §3 requires,
   not one thread narrating three angles serially.
6. **If any angle returns BLOCK:** skip the adversarial pass — verdict is BLOCK.
   Go to step 8.
7. **If all three lean APPROVE / APPROVE WITH NOTES:** spawn one
   `pr-merge-adversary` agent with all three reports + the diff. Its OVERTURNED
   verdict wins over the three APPROVEs; its HOLDS verdict makes the overall verdict
   PASS — **unless step 4 found this diff touches the gate's own files, in which
   case the overall verdict is BLOCK regardless**, with an explicit escalation
   note (not an ordinary block reason) saying the angles approved but a
   self-modifying change to the gate needs the founder, not this gate, per
   [[merge-races-need-sequencing]]'s escalate-never-force precedent.
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
    - **PASS:** `gh pr merge <n> --squash` — **no `--auto`.** `--auto` arms
      GitHub's auto-merge against the PR, not the audited commit; a push
      landing after you PASS but before GitHub actually merges would go
      through unaudited once the (unrelated) required checks are green
      (confirmed live, correctness angle, third audit — the CI-side script
      hit this exact race and now uses a SHA-pinned `gh api` merge instead;
      the Claude-Code path stays on `gh pr merge` for hook-pattern
      compatibility, but drops `--auto` so the merge is immediate and bound
      to what you just audited, not queued against whatever's head later).
      Always the explicit `<n>`, never a bare `gh pr merge` (the hook
      resolves that against your current branch, not necessarily the PR you
      just audited). Never `--admin` — if the merge doesn't go through
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
- Model choice corrected 2026-09-02: the original ask was "Sonnet max"; ADR 0090
  now runs `model: opus` / `reasoning_effort: high` per ADR 0050's own override
  rule (production/ADR/outward-send → Opus, and "never score effort" as a
  substitute for the tier the consequence calls for). `reasoning_effort: high` in
  the two agent definitions is a best-effort frontmatter signal, not a verified
  reasoning-budget guarantee — see ADR 0090's decision section.
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
  drifted, CI had `CLAUDE.md` and this file didn't); the stale
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
