# 0090 — An Opus audit gate reviews every PR before it merges to main, and an approval merges + deploys with no human click

- **Status:** **Merged** — PR [#261](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/261)
  squash-merged to `main` 2026-09-03 as `ce519d4208b5bd27751d8acc572c1b53ca99fc78`
  (SHA-pinned via `gh api .../pulls/261/merge`, all five required contexts green,
  `--self-test` 29/29 on `main`'s own copy). Merged under **direct founder
  authorization in chat**, not the automated skill/hook path: this PR touches the
  gate's own owned paths (`_GATE_OWNED_PATHS`), so `touches_own_gate` force-escalates
  it to BLOCK by the gate's own design — the system cannot self-clear a PR that
  modifies itself. That escalation firing here is the intended shape, not a bug.
  The seventh Correction's fix, PR [#297](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/297),
  hit the identical escalation and was merged the identical way, 2026-09-06, as
  `9a23abb6889dfcc6af443b8ccdd03ca1bbb694ec`. The eighth Correction's fix, PR
  [#299](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/299), hit it
  a third time and was merged the same way, 2026-09-06, as
  `78a8f46fe2617ab26dd75ce70e12a25793563ff1` — see Review trail's final three rows.
- **Date:** 2026-09-02
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** audit, merge-gate, autonomous-deploy, opus, branch-protection, ci,
  agent-stack, judgment-class, model-dispatch
- **Links:** [[main-is-branch-protected]], [[merge-races-need-sequencing]],
  [[agent-dispatch-hardness-threshold]] (0050 — governs the model correction below),
  [[absence-reported-as-health]], ADR 0072 (schema-parity-sees-what-it-claims), the
  fork-PR precedent it set for secret-gated required checks

## Context

### Amendment — 2026-09-18: ownership follows what a PR does to the gate's rules, not which file it touches

Founder, 2026-09-18: *"do the better approach for longevity, change the ADR if needed."*

**The problem.** `.planning/decisions/README.md` was owned outright, standing in
for "a PR that changes what future audits treat as the rules." That stand-in was
too broad and too narrow at once:
- **Too broad.** Every PR that added an ADR also appended its row, so every such
  PR escalated. Measured on the final code (see *Measured* below): 53 of the 125
  old-rule escalations among 317 first-parent `main` commits were owned by the
  index alone.
- **Too narrow, three ways:**
  - A new ADR file claiming to amend this one was not owned at all if it skipped
    its row. PR #391 adds ADR 0160 with no row.
  - A rename away from an owned path escaped, because `gh pr diff --name-only`
    lists only the destination.
  - Case-variant paths matched nothing, although a macOS checkout writes them
    over the owned files.

**The rule.** One function, `gate_ownership()` in `scripts/pr_audit_gate.py`, decides.
- CI runs it (`pr_ownership()`) before any model call and before the API-key check,
  so an owned PR escalates even with no key or no credit.
- Skill step 4 runs `origin/main`'s copy through `python3 -I … --ownership`.
- `scripts/hooks/require_pr_audit.py` runs `origin/main`'s copy again before it
  allows `gh pr merge`, blocks an owned PR even when it carries a PASS marker, and
  requires `--match-head-commit <full 40-hex sha>` equal to the PR's head, given
  once as its own argument. It finds every `pr merge` in a command and refuses a
  command that holds more than one (one check can take 380 s by its own timeouts;
  the hook is given 600 s); it needs a literal PR number or URL (no `$n`, `$(...)`
  or bare `gh pr merge`); it refuses `--admin` and `--auto`, which the skill
  forbids; and it blocks a `pr merge` it cannot read as a command of its own
  (`bash -c "…"`, `eval`, a comment). It also refuses a `pr` subcommand written
  with quoting or expansion (`$'merge'`, `mer$()ge` and `{merge,}`, which bash runs
  as `merge`, and `mer[g]e`, which it runs as `merge` beside a file of that name),
  a word after a literal `gh` written that way (`gh p$()r merge`), a `pr` after a
  word the shell expands (`$G pr merge`), and `gh alias set` or `gh alias import`.
  MCP tools that merge a PR or arm auto-merge are blocked outright;
  `.claude/settings.json` routes them to the hook.
- The skill keeps no path list that anything reads; the two lists had drifted
  twice. Step 4 states the rule in words, and `scripts/test_pr_audit_gate.py`
  fails when those words stop naming every owned prefix and name.

The check reads `git diff --raw -z --no-renames` between the PR's merge-base with
`main` and its exact head SHA, plus blobs; there is no text diff to parse. A PR is
owned (founder's word required; no model review can clear it) when any of these holds:

1. **Owned paths.** Paths are compared after NFC and case folding, and both sides
   of every change are checked:
   - `scripts/pr_audit_gate.py` and all of `scripts/hooks/`;
   - the gate's tests, `scripts/test_pr_audit_gate.py` and
     `scripts/test_require_pr_audit.py`, and `scripts/check_test_scripts_are_real.py`;
   - what `deploy.yml`'s verification delegates to: `scripts/check_deployed_sha.py`,
     `scripts/resolve_watched_commit.py` and `scripts/check_deploy_audit_ran.sh`;
   - all of `.github/workflows/` (so `pr-audit-gate.yml`, `ci.yml`, `deploy.yml`
     and any new workflow) and `.github/actions/`;
   - anything inside a `.claude` directory, and any `.mcp.json`, at any depth (a
     nested `.claude/skills/` loads when Claude works in that directory, so
     `apps/web/.claude/skills/pr-audit-gate/SKILL.md` could stand in for the audit);
   - `.planning/decisions/0050-*` and `0090-*`;
   - any `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md`, at any depth;
   - a path with a control character, and any path that collides with another
     under case folding.
2. **The index.** It is owned unless every change is an appended ADR row
   `| [NNNN](NNNN-slug.md) | … |` that meets all of these:
   - it sits inside the Locked or Proposed table;
   - it links the one ADR file this PR adds under that number;
   - its number has never been used on `main` (file or row);
   - it appears once, and its text passes the decision-text scan.

   Editing, moving or deleting a row, or changing any other line, stays owned.
3. **Decision text.** Every file under `.planning/decisions/` is read whole, before
   and after the change. It is owned if it names the gate: ADR 0050 or 0090, the
   gate's script, hook, skill or agents, gate-owned paths, hardness scores, or
   self-merging (15 identity tokens). For the index, `OPEN-DECISIONS.md`,
   `CLAIMS.jsonl`, `PROJECT.md` and `FUTURES.md`, only changed lines are judged;
   `CLAIMS.jsonl` lines must parse as JSON and are judged with escapes decoded.
   - Text is normalized before matching: entities, URL escapes, NFKC, invisible
     characters, inline tags and markdown inside words; Greek and Latin-extension
     lookalikes are mapped.
   - Owned outright: tag or bidi-control characters, line separators other than
     `\n`, NUL, invalid UTF-8, letters or digits outside Latin and Greek, and a
     symlink, submodule or executable on this surface.
4. **Anything the check cannot read** is owned (`CANNOT CHECK`, exit 4): the head
   moved, the base is not `main`, a fetch or git call failed, the change list is
   empty, a change type other than A, D, M or T appeared, a register's changed
   region (after its common head and tail) is over 1,000 lines, or the CI check
   ran past 600 seconds. When every reason is of this kind, CI posts COULD NOT RUN
   (`ownership-incomplete`), not a claim that the PR is gate-owned.

**Where the gate's rules live.** They are this ADR, ADR 0050 and the owned files,
whatever their index rows or tables say.
- Text anywhere else that claims to supersede, amend, narrow or reinterpret them
  has no effect until this ADR or 0050 is edited to point at it. That edit is
  itself owned.
- Reviewers read decisions with `git show origin/main:<path>`, and treat such a
  claim in a PR as a BLOCK finding. The three agent definitions and the CI
  compliance angle now say so.

**What this gives up, deliberately (founder answer 1).** Until now the index row
was the only mechanical route by which an ordinary ADR reached the founder at merge.
- From now on, a new ADR that does not name the gate merges on the ordinary audit
  when it arrives as a new file plus an appended row. That includes one born
  Locked, and one that supersedes a non-gate ADR.
- Marking an existing ADR superseded still means editing its row, and that still
  escalates.
- Locking stays the founder's act, taken in chat and recorded in the ADR's own
  review trail. The gate escalates because of its own conflict of interest, not
  as the lock.

**Witness-citation convention (founder answer 4, no carve-out).** A new decision
file that names the gate escalates, including one that only cites an audit as a
witness. Cite audits as `audit of PR #M, round N`, with the report path under
`.planning/07-reference/pr-audits/` (now in `TEMPLATE.md`). Never reword a line
that states a rule about the gate, or says what it does, to get past the check.

**Widened after the adversarial round (same day); accepted by the founder, 2026-09-18.**
The judged spec owned three named workflows and `deploy.yml`, and the audit of the
built change showed each was defeated one file sideways. Each of these was RELEASED,
measured through `ownership_between()`:
- a new `.github/workflows/zzz-automerge.yml` (`pull_request_target`,
  `contents: write`, `gh pr merge` on a label): a merge path the audit never sees;
- `scripts/check_deployed_sha.py` rewritten to `return 0`: the check `deploy.yml`
  was owned for, loosened in the script it calls;
- `scripts/test_pr_audit_gate.py` gutted to `assert True`: the gate's regression net.

So the owned set now names the callees and the whole workflow directory. Cost over
the replay below: 9 commits owned only by a workflow outside the three the spec
named; the added scripts added 0 (each commit touching one also touched an owned
path).

Founder, 2026-09-18, in chat, after the confirm round: he **accepted** the widened
owned set — the whole `.github/workflows/` folder, `.github/actions/`, the
deploy-check scripts, the gate's own tests, and `.claude/` at any depth. That is
his word on the widening, recorded here; it was not one of answers 1–7. Two
owned entries beyond answers 1–7 were not named in his acceptance as it was relayed:
`scripts/check_test_scripts_are_real.py` (the test-integrity guard) and `.mcp.json`
at any depth. They ride on this PR, which escalates to him regardless, and his
word on its merge covers them or strikes them.

**Founder answers, 2026-09-18** (all were the recommended option):

| # | Question | Answer (verbatim option label) |
|---|---|---|
| 1 | Scope: a new ADR that does not name the gate, arriving as a new file plus an appended index row, merges on the ordinary audit; the lock is his act in chat, recorded in the ADR's review trail | "Accept" |
| 2 | Make the index append-only (rows carry number, link, title, date; status lives in each ADR) | "Open it as its own decision" |
| 3 | Hook: `gh pr merge` must carry `--match-head-commit <full sha>`; an owned PR is blocked even with a PASS marker; the founder's route is his word in chat, then a SHA-pinned merge call | "Yes, hard block" |
| 4 | Gate names in new ADRs: the witness-citation convention with no carve-out, plus one PR re-citing the nine ADRs that name the gate | "Convention + one cleanup PR" |
| 5 | Own all of `.claude/` | "Own all of .claude/" |
| 6 | Narrow `ci.yml` ownership | "Yes, as a follow-up" |
| 7 | Install the hook in the founder's user-level `~/.claude/settings.json` | "Yes, install it" |

**Follow-ups, each its own change (not this one):**
- The index append-only decision (answer 2): its own ADR, numbered by
  `next_free()` in `scripts/check_adr_numbers_unique.py` when it is written, never
  copied from here (its answer moved from 0161 to 0164 during 2026-09-18 alone).
- One cleanup PR re-citing the nine ADRs that name the gate as a witness — 0097,
  0106, 0131, 0136, 0137, 0139, 0140, 0146 and 0158 (answer 4). Until it merges,
  any edit to one of them escalates under the whole-file rule.
- Narrowing `ci.yml` ownership to the `on:` triggers and the `workflow_dispatch`
  path the CI merge step depends on (answer 6). `ci.yml` stays fully owned here;
  it is the largest escalation source (58 of the 104 owned commits below). The
  directory is now owned whole, so that decision covers the other workflows too.
- Installing `require_pr_audit.py` in the founder's user-level
  `~/.claude/settings.json`, pointing at `origin/main`'s copy (answer 7), done by
  the orchestrating session after this merges. No repo file changes for it.

**Accepted costs.**
- A new ADR that cites the gate by name escalates (convention above).
- Edits to existing index rows escalate: 12 of the 87 first-parent `main` commits
  since 2026-09-03 (measured 2026-09-18). PR #391 at `6a270a0d` is owned for one
  reason only: it rewrites ADR 0121's existing row. Its appended 0159 row and its
  row-less ADR 0160 are released. [Re-measured 2026-09-18, same day, PR #391 having
  grown to `804a1bdb5`: the built gate (`scripts/pr_audit_gate.py --ownership`,
  run against `origin/main`) now classifies it OWNED for three reasons —
  `.github/workflows/ci.yml` and `.github/workflows/schema-parity.yml` (both
  owned outright under the widened `.github/workflows/` rule) and its
  `.planning/decisions/README.md` edit no longer qualifying as a pure append.
  PR #391 was still open, unmerged, at this measurement.]
- A legitimate case-only rename, or a case-colliding product path, escalates.
- The hook refuses some commands that merge nothing, by design of the confirm
  round's rules (each measured: exit 2): a `pr` after a word the shell expands
  (`$GH pr view 1`, and `A=1 pr x`, since `=` is zsh's `=cmd`), a quoted or
  expanded word after a bare `gh` argument (`grep gh "$f"`), and, in a string or a
  heredoc body, `gh pr` or `pr` after a `$` variable followed by an expansion-led
  word (`echo "$N pr ${X}"`, a heredoc that mentions `gh pr {a,b}`). `gh pr view 1`,
  `gh pr checks 1`, `gh pr view "$N"` and a `gh pr create --body "$(cat <<'EOF' …)"`
  still pass (tests H15c).

**Residual risks, stated plainly.**
- **Paraphrase is not caught.** A new ADR plus its appended row that steers the
  gate without any of the 15 identity tokens is released, for example
  "Documentation-only pull requests need no founder sign-off before merging", and
  so is a rule written inside a token-free row. The fixer round's audit added a
  second: "PRs that change only configuration files may be merged automatically by
  the bot with no reviewer approval required" (a new ADR file plus its row) is released. The only
  defence is the reader rule above; policy-verb tokens were not added because they
  would over-block. (Before this change, skipping the row already bypassed the old
  rule.)
- **Text outside the decision surface is not scanned:** `STATE.md`, `ROADMAP.md`,
  `07-reference/`, code comments, PR bodies, memory outside the repo. A `ROADMAP.md`
  line naming the gate is released. Only the reader rule and CLAUDE.md §0.1 cover it.
- The convention can breed token-free aliases for the gate; approve a PR that
  coins one only after adding it to `GATE_TEXT_ALTERNATIVES`.
- Unicode: a Greek letter outside the lookalike map, or a same-script lookalike
  NFKC misses, could still evade a token.
- Instruction files other agents load by name are not owned: `GEMINI.md`,
  `.cursorrules`, `.cursor/rules/`, `.github/copilot-instructions.md` (each
  measured RELEASED). `AGENTS.md`, `CLAUDE.md` and `CLAUDE.local.md` are.
- The hook recognises an MCP merge tool by the words of its name, split at a
  lower-to-upper change, so `mcp__x__MergePR`, which `.claude/settings.json`
  routes to the hook, is not refused (`merge_pr` and `mergePullRequest` are), and
  a name spelling `MERGE` in capitals is not routed to the hook at all.
- Trust still rests on the session's checkout: `.claude/settings.json` is read
  from it, so a branch that edits it can switch the hook off (answer 7 closes
  this outside the repo). `gh api …/pulls/N/merge` stays ungated on purpose; it is
  the founder's route. The CI job is still not a required context and has had no
  credit since 2026-09-12, so its escalation posts but cannot block a merge.
- **The hook is a lexical check, not a shell.** "Hard block" means a merge a
  session writes as a command in one of the *checked* or *refused* forms below.
  It does not mean every merge a session writes, nor every merge it could cause:
  the *not seen* forms are written as commands too.
  - **Checked** (the pin, the PASS marker and `origin/main`'s classifier all run):
    a `gh pr merge` written plainly as a command of its own, one per command. `gh`
    may be quoted, escaped or a path ending in `/gh`, behind a wrapper (`sudo`,
    `env`, `time`), and the command may sit inside `$(...)`, backticks, `<(...)`,
    a subshell, a `{ …; }` group, an `if`, a function body, or a heredoc fed to a
    shell.
  - **Refused** (exit 2, nothing runs): the same merge inside a double-quoted
    substitution, `bash -c "…"`, `eval '…'` or after a comment; a second merge in
    the command; `--admin`, `--auto`, an unknown flag, `-R`/`--repo` naming another
    repository (or any before `pr`), `GH_REPO`/`GH_HOST` in the command, or a PR
    that is not a literal number or URL; `gh alias set`
    and `gh alias import`. In the command's words, including inside substitutions:
    a `pr` subcommand word holding quoting or expansion (the six spellings the
    confirm round found, `$'merge'`, `$"merge"`, `mer$()ge`, `mer${ZZ}ge`,
    `{merge,}`, `mer[g]e`, among them); a word after a literal `gh` holding quoting
    or an expansion character (`gh p$()r merge`); a `pr` after a word holding `$`,
    a backtick, `*`, `?`, `[`, `{`, `~`, `=` or `!` (`$G pr merge`). In the text
    with quotes and backslashes removed, which reaches strings another shell runs
    and heredoc bodies: `gh pr`, or `pr` after a `$` variable or a closing
    substitution, followed by a word in which `$`, a brace, a bracket, `*`, `?` or
    `!` leads into more of the word (`bash -c "gh pr \$'merge'"`).
  - **Not seen** (each example measured: exit 0 through the real hook against an
    owned PR, 2026-09-18, and pinned at exit 0 by
    `scripts/test_require_pr_audit.py`): words the shell splits apart
    (`gh${IFS}pr${IFS}merge${IFS}2`, `{gh,pr,merge} 2`); arguments `xargs` appends
    (`echo merge 2 | xargs gh pr`); a shell alias for `gh`
    (`alias g=gh; g pr merge 2`); a `gh` and a `pr` both built by expansion
    (`G=gh; $G p$()r merge 2`); inside a string another shell runs, a `gh` or `pr`
    built by expansion (`bash -c 'gh p$()r merge 2'`), or a subcommand ending in a
    glob character or built by backticks (`bash -c 'gh pr merg? 2'`,
    ``bash -c 'gh pr `echo merge` 2'``).
    Nor is a merge built or named at run time: a `gh` alias or shell function
    defined in an earlier command, `eval` of a constructed string, a script file
    that runs `gh pr merge`, `GH_REPO` exported in an earlier command. Quoting this
    reader parses differently from the shell (a `case` pattern inside `$(...)`,
    quotes nested in `${...}` inside double quotes) may be misread either way.
    Merge routes outside Bash and the matched MCP tools (the GitHub web UI,
    another client) never reach the hook.

  Until the confirm round this bullet said "every merge a session writes as a
  command" and that `gh alias set` in the same command was caught; neither was
  true (the six spellings above and `gh alias set m 'pr merge' && gh m 2` each
  exited 0). The six spellings and the alias are now refused; the *not seen* list
  is what remains.
- Not verified: that `refs/pull/N/head` never lags `headRefOid` just after a push
  (if it does, the check says CANNOT CHECK and a rerun clears it); the hook
  `timeout` unit (seconds is assumed); that Claude Code applies the matcher
  `Bash|mcp__.*[Mm]erge.*` as a regex to MCP tool names (documented behaviour; the
  test checks the pattern with Python's `re`, not the harness).

**Measured on the final code, 2026-09-18** (`scripts/pr_audit_gate.py` on
`feat/gate-owned-by-diff`; replay window: the 317 first-parent `main` commits
from `09190ee5` back to 2026-08-24T00:00 local, each commit against its first
parent; the old rule is the pre-amendment `_GATE_OWNED_PATHS` prefix match):
- Owned commits: 125 under the old rule, 104 under this one. 31 released, 10 newly
  owned: `008fbf0f` (`.claude/launch.json`, and ADR 0136 names the gate),
  `0f1c4f0d` (an edit to ADR 0097, which names the gate on both sides),
  `b1532c50` (an empty commit: CANNOT CHECK), and 7 that change a workflow outside
  the three the spec named (`schema-parity.yml` 5, `e2e-prod.yml` 1,
  `agent-cards-weekly.yml` 1). 9 commits in all are owned only by such a workflow.
- Index-only escalations: 53 under the old rule; 22 of those 53 are still owned,
  13 of them by an index reason alone (row edits, or rows naming the gate).
- No commit in the window hit the 1,000-line register-diff bound (1 CANNOT CHECK,
  the empty commit). The largest register today is `CLAIMS.jsonl`, 351 lines.
- The judged spec's figures (294 commits, 120 → 90) came from a `--since` without
  a time of day and were not reproducible; the numbers above are the re-measurement.
- Owning `.claude` and `.mcp.json` at any depth (confirm round) changed no
  commit's outcome over the window: re-run on the final code, every figure above
  is the same, and no commit in the window touched a nested one.
- `scripts/test_pr_audit_gate.py`: 91 PR shapes built through real git (72 ported
  from the judged harness, 3 added by the implementation, 9 by the fixer round:
  a new workflow, a local action, the three deploy scripts, the two gate tests, the
  test-integrity guard, and a register change past the diff bound; 7 by the
  confirm round: a nested `.claude` skill, settings file and agent, a nested
  `.mcp.json`, a register whose first changed run is clean and a later one names
  the gate, and a row reusing a number `main` has only as a file, or only as a
  row) classify as expected, plus an append to and an edit of this checkout's real
  index. The 9 fixer cases were each RELEASED by the code before the fixer round,
  and the 4 nested-path cases by the code before the confirm round.
- 80 mutations (53 rule switches, each of the 12 owned prefixes, each of the 15
  tokens) each turn at least one case, self-test invariant or call-site probe red:
  0 survivors. The implementation's own mutation run found 3 switches the judged
  harness could not kill (control characters in paths, a case-variant register
  with no canonical file, an inline tag splitting a token); each now has a case.
  The fixer round added 6 switches that had no test: `pr_ownership`'s head-moved,
  base-is-`main` and refs/pull-lag guards, the diff bound, the CI deadline, and the
  COULD NOT RUN wording (each was deleted in a scratch copy with every suite green).
  The confirm round added 8: `.claude` at any depth, `.claude` only at the root,
  `.mcp.json` as a name at any depth, a register scan that stops at its first
  changed run, and each half of the number-reuse rule, removed from the check and
  from what is read of `main`. Five of those survived every case before the
  confirm round's cases existed (the scan and the four number-reuse switches).
- `--self-test`: 98 invariants. `scripts/test_require_pr_audit.py`: the hook run
  for real against a local bare origin and a `gh` shim, 105 tests: H1–H4, a
  mismatched pin and a checkout copy that releases everything; H5–H10 for the
  chained, non-literal, respelled, double-pinned, hidden and MCP merges (19 of
  those tests failed on the hook before the fixer round); H11–H12 for refs/pull lag
  and a head that moves between the hook's read and the gate's (exit 4, blocked as
  CANNOT CHECK); H13–H19 from the confirm round: no PASS marker at the head (none,
  stale, BLOCK, an untrusted author, not at the comment's start), a direct push to
  `main` through the entry point, the quoting and expansion spellings with
  ordinary `gh pr` commands as controls, a crash inside the word reader (injected;
  it exited 1, which Claude Code treats as a non-blocking error, and now blocks as
  CANNOT CHECK), `--admin` and `--auto`, two merges in one command,
  `gh alias set`/`import` and a line continuation inside a word, plus H6b (a `$n`
  or branch-name PR refused by its own reason, since the lookup after it fails
  either way); the eight *not seen* examples above, pinned at exit 0 so this ADR
  cannot keep naming a gap that has closed; and 23 hook mutations, each killed,
  against a control test that every mutation scenario gives its expected exit on
  the real hook. Run on the hook before the confirm round, every H15–H19 command
  exited 0 except two in H15b that were blocked for other reasons (`gh $'pr' merge`
  as CANNOT CHECK, `$(which gh) pr merge 2` for its missing pin). H13 and H14 pass
  on that hook and fail with the marker check or the push block deleted, which the
  older tests did not notice.
- PR #393 at `d9fd8f1c`: released (it touches ADR 0147's body and `CLAIMS.jsonl`,
  neither naming the gate, and no owned path). [Re-measured 2026-09-18: #393 grew
  further and merged as `cb756083e` (confirmed: this is `origin/main`'s current
  tip) from its final audited head `8e6f3de85`. At that head the built gate
  classifies it OWNED — the new `.planning/decisions/0162-managers-grant-manager-
  or-staff-on-both-doors.md` it added names the audit gate. #393 merged before
  this diff-ownership rule existed, so no escalation ever fired; under the rule
  this ADR now states, it would have needed the founder's word — the first real
  merged instance of the accepted cost above, "a new ADR that cites the gate by
  name escalates."]

**gate-r3 adversarial round — 2026-09-19.** A dedicated adversarial pass over
`ffc15a9ef` (this branch's tip after the confirm round and the minors-fixer
pass above), 20 independently reproduced bypasses across four angles (shell,
paths, marker, ownership). Every CRITICAL and HIGH is closed by a code change
with a regression test that fails before it and passes after
(`scripts/test_require_pr_audit.py`'s `test_r3_*`/`h20_bare_push` entries and
`scripts/test_pr_audit_gate.py`'s `G1`–`G7` cases and static CI checks); two
items are closed only in part, with the unclosed part named here rather than
claimed shut, per this ADR's own convention.

- **Closed, critical.** `path-http-api-clients` / `path-graphql-merge-mutations`
  / `path-merges-endpoint-no-pr`: a curl/wget/Python/Node PUT to
  `.../pulls/<n>/merge`, a `gh api graphql` mutation naming
  `mergePullRequest`/`enablePullRequestAutoMerge` (no bounded `pr` word for the
  old probe to find), or a POST to the base repo's own `/merges` endpoint (no
  PR at all) each merged through GitHub's API directly, in any client, with
  none of it shaped like `gh pr merge`. `_github_api_merge_reason()` blocks
  all three outright. [**CORRECTED 2026-09-19 (gate-r4, r4-gate.json):** this
  was itself wrong for the FIRST of the three. Blocking a literal-PR-number
  `gh api .../pulls/<n>/merge` outright silently reversed the founder's own
  locked, previously-working owned-PR route (:173, :242 below, this repo's
  `require_pr_audit.py` docstring point 7, SKILL.md step 4) with no test and
  no mention here — BLOCKER, CLAUDE.md §0.1. See the gate-r4 section for the
  restore; `gh api` with a literal PR number on this one endpoint is the only
  one of the three that stays ungated, unchanged from before this round.] `path-push-bare-and-broad`: `git push`, `git push
  origin` (no refspec) and `--mirror`/`--all` carried none of
  DIRECT_PUSH_PATTERN's required literal "main"; the real destination depends
  on local config (push.default, branch tracking, remote.pushDefault) this
  hook never reads. `sha-prefix-collision`: the marker's sha was accepted as a
  PREFIX match — SKILL.md's own documented 7-character format — so a marker
  minted for one commit validated any OTHER commit sharing that prefix,
  demonstrated with two genuine git commits mined 7 hex chars apart, one
  benign and one carrying a backdoor. Now requires the full 40-hex sha by
  `==`; SKILL.md and `pr_audit_gate.py`'s own marker-posting code (`sha_full`,
  not `sha7`) are updated together so a real PASS still matches.
- **Closed, high.** `shell-renamed-gh-alias-plant`, `path-merges-endpoint-no-pr`
  (bundled above), `path-push-token-between-git-and-push` (DIRECT_PUSH_PATTERN
  tolerated exactly one hardcoded `-C <path>` between "git" and "push";
  `--no-pager`, `-c x=y`, `git subtree push` were missed —
  `_direct_push_problem()` tokenizes and walks any number of recognized
  global flags instead), `path-git-level-alias` (a `git config alias.<name>`
  collapsing a push into one word — resolved via `git config --get`, bounded
  to names outside a short common-subcommand allowlist so ordinary git usage
  never pays for the extra call), `path-exec-surface-outside-matcher` (a
  generic exec-capable tool — a terminal runner, a sandbox, a batched
  computer-use call — is not named "merge" and carried a complete `gh pr
  merge` in its own input, six real tool names CONFIRMED exit 0; the matcher
  is widened and `main()`'s non-Bash branch now scans `tool_input`'s own text
  the same way a Bash command's is), `verdict-any-match-wins` (a trusted
  BLOCK and a trusted PASS for the identical pr+sha coexisted; the first
  matching PASS won regardless of order — a BLOCK now vetoes outright,
  order-independent), `own-r3-pytest-config-neuters-regression-net` (a root
  pytest.ini/conftest.py — or a nested conftest.py, pyproject.toml, setup.cfg,
  tox.ini, any depth — silently dropped the gate's own 192 tests to 0
  collected with `ci.yml`'s step still exiting 0; `OWNED_BASENAMES` now names
  all five and `ci.yml`'s pytest invocation runs `-c /dev/null
  --confcutdir=scripts`), `T-SEP-GAP-4CHAR` (`GATE_TEXT_ALTERNATIVES`' `_S`
  separator bound of 0–3 characters was an escape hatch for a 4+-character run
  — `merge----gate`, an empty markdown table cell — `skeleton()` now collapses
  any run of non-alnum, non-Greek characters to its own first character before
  matching, so separator length stops being adversarially controllable
  without disturbing the one place a specific character mattered — see the
  in-code note on why "first character of the run", not a fixed space,
  measured after a first attempt broke `0.0050`'s own exclusion), and
  `ci-deploy-stage3-checkout-not-pinned` (every other job in `deploy.yml`'s
  workflow_run chain pins `ref:`; Stage 3 alone did not, so it could build a
  different commit than `deploy-audit.json` then records its result against).
- **Closed, medium.** `path-mcp-lowercase-collapse` (`_mcp_merge_tool()`'s
  word-splitter needed a case transition; `mergepr`/`automergepr` were one
  token — now also checked as a lowercased substring).
- **Closed only in part — the unclosed part is named, not claimed shut.**
  `shell-renamed-gh-direct-merge` / `shell-renamed-git-direct-push`: an
  identity fallback (`_is_program()`, PATH lookup + `realpath`) closes a
  symlink or PATH-relative rename of `gh`/`git`. It does **not** close an
  independently built or copied binary with the same behaviour but a
  different inode (demonstrated with a `shutil.copy2` clone) — a lexical hook
  cannot execute a candidate to compare behaviour against the real one; pinned
  by `test_r3_an_independently_copied_gh_binary_is_still_not_recognized_residual`
  and its git equivalent, so this is never silently claimed closed by a later
  change. `self-forged-pass-marker`: `_current_gh_user()` is unconditionally
  trusted, so a session authenticated as the founder's own `gh` identity can
  post its own PASS comment and merge with the pr-audit-gate skill's actual
  multi-angle audit never invoked. This is a trust-model question, not a
  parsing bug — the two candidate fixes (stop trusting a local run at all and
  route every merge through CI's bot marker, or bind the marker to proof a
  real run produced it via a channel the acting session cannot itself write)
  both change the autonomous-merge model this ADR's whole review trail
  negotiated, so it is filed as **[OD-128](OPEN-DECISIONS.md)** (renumbered
  2026-09-19 — its original number collided with two other in-flight lanes'
  filings; see that row for the history) rather than
  picked unilaterally, and pinned as a residual by
  `test_r3_a_self_posted_marker_from_the_current_gh_user_still_merges_residual`.
- **Named, not attempted (medium).** `path-mcp-bare-merge-word`: "merge" alone,
  with no companion word, still is not enough to flag an MCP tool name
  (`merge_now`) — treating it as enough would also block
  `mcp__c96b062f__merge_branch`, a real, unrelated Supabase DB-branch-merge
  tool, and no allowlist of "known safe" merge-shaped names can stay complete
  as new tools appear. Pinned by
  `test_r3_a_bare_merge_word_mcp_tool_is_still_not_caught_residual`.
- **CI-side, static findings, not live-exploited (medium/high, per the
  original submission's own framing).** `ci-unpinned-pip-install-anthropic`:
  `pip install anthropic` in `pr-audit-gate.yml` carried no version, hash or
  lockfile, imported into the same process that then holds
  `ANTHROPIC_API_KEY` and a write-scoped `GH_TOKEN` — pinned to 0.87.0 (this
  checkout's own working version), with `test_pr_audit_gates_own_pip_install_pins_a_version`
  guarding the regression. `ci-unpinned-actions-supply-chain`: of ~73 `uses:`
  lines across the workflows, none are SHA-pinned; `aquasecurity/trivy-action@master`
  was the acute case — a mutable BRANCH with no release gate at all, fixed to
  its v0.36.0 release commit. `test_no_workflow_action_is_pinned_to_a_mutable_branch`
  guards against a regression to a bare branch name specifically; SHA-pinning
  the remaining, already-tagged ~72 actions is not attempted in this round
  (a materially lower risk than an unreleased branch, and correctly pinning
  73 SHAs by hand risks a wrong one breaking CI, a worse outcome than a named,
  bounded gap) — tracked as follow-up, not closed here.

Not verified this round (stated per §5b, not silently assumed): that GitHub
branch protection on `main` actually requires "a pull request before
merging" today, which several of the closed API-surface findings' original
write-ups note as a second, GitHub-side layer this hook's own fixes do not
depend on but would be strengthened by; no live `gh api`/network call against
this repo's real settings was made to confirm it (out of scope for a
worktree pass that must not touch the real repo's state). `path-mcp-bare-merge-word`
and the exec-surface matcher widening's own residual (a wholly novel,
unlisted tool name) both restate the ADR's pre-existing "Merge routes outside
Bash and the matched MCP tools... never reach the hook" line — sharper, not
new in kind.

**gate-r4 last-call round — 2026-09-19.** The gate-r3 round above was itself
put through a dedicated adversarial "last call" (r4-gate.json, an Opus pass
over gate-r3's own diff) before it ever merged. Two of its findings were
BLOCKERs — a locked decision silently reversed, and a reused OD number — the
rest were fresh bypasses in gate-r3's own fixes or a widening that shipped
without the founder's word. Every CRITICAL/HIGH finding is closed with a
regression test that fails before and passes after; two more were found and
closed self-adversarially, in this same round, before ever shipping.

- **BLOCKER, closed.** `_github_api_merge_reason()` (gate-r3, point 22 above)
  blocked a literal-PR `gh api .../pulls/<n>/merge` outright — the founder's
  own documented, previously-working owned-PR route (:173, :242 above, this
  hook's own docstring point 7, SKILL.md step 4, used for real at PRs #261,
  #297, #299) — with no test pinning the exemption and no mention in the
  section above, silently reversing a locked decision (CLAUDE.md §0.1). The
  correction is bracketed in place above. Restored, narrowly: `gh api` (not
  curl/wget/a script/graphql/the base Merges endpoint — those three stay
  blocked, unchanged) with a LITERAL decimal PR number stays ungated, exactly
  as before gate-r3. `test_r4_owned_pr_gh_api_with_a_literal_pr_number_stays_ungated`
  pins it (`scripts/test_require_pr_audit.py`); a mutation reintroducing the
  BLOCKER is killed. Measured before/after (direct call, no gh/git needed —
  this path is deliberately never matched): BEFORE blocked, AFTER allowed.
  [NAMED 2026-09-20, r5-gate.json must-fix 6: "those three stay blocked,
  unchanged" overclaims — `_github_api_merge_reason()` reads `gh_api =
  _gh_api_reading(text)` and the merge-endpoint match over the WHOLE command
  `text`, not the one segment that actually calls the endpoint, so a `gh api`
  invocation ANYWHERE in the same command exempts a merge call made by a
  DIFFERENT program elsewhere in it. CONFIRMED: `gh api user >/dev/null; curl
  -X PUT https://api.github.com/repos/.../pulls/2/merge` exits 0 — curl did
  not, in fact, stay blocked. Residual, not a BLOCKER: a literal-PR-number
  `gh api .../pulls/<n>/merge` is already this section's own sanctioned,
  ungated route with no sha/pin check either way (:173, :242), so this grants
  no capability curl (or the caller's own `gh api` call) did not already have
  by calling that route directly — confirmed both give exit 0 with equal, not
  additional, ungating. Not closed here: binding the exemption to the one
  segment that carries the endpoint is the fix, if this is ever worth the
  added parsing surface.]
- **Fresh HIGH bypass in the same fix, closed.** The literal-PR-number
  requirement that made the block (and now the exemption) possible had its
  own hole: `_PR_MERGE_ENDPOINT_RE` required `\d+`, so a shell-variable PR
  number (`N=2; gh api -X PUT .../pulls/$N/merge`, and the curl equivalent)
  matched NEITHER the block nor the exemption and ran completely unaudited —
  CONFIRMED exit 0 for both, before this fix. `gh pr merge` itself refuses a
  non-literal PR (bug 9 above); the API path now does too, for every client,
  decided before the gh-api exemption so a non-literal number is refused
  even when `gh api` is the caller.
  `test_r4_a_shell_variable_pr_number_on_the_api_path_is_refused` pins both
  clients. Measured before/after: BEFORE allowed (both), AFTER blocked (both).
- **BLOCKER, closed.** The self-forged-pass-marker fork's original number
  (this section's residual, above) was already claimed by two other
  in-flight lanes (`wt-fin-C`, `wt-pg-receiving`) before this round's fixes
  reached `main` — `origin/main` itself stops at OD-123, so the refs-only
  reuse guard passed, but a collision was still coming. Renamed to
  **[OD-128](OPEN-DECISIONS.md)** (CLAUDE.md §5b: moved the id with fewer
  citations — 2 in this tree, vs. two other lanes' unrelated filings — kept
  a gap over a collision; see that row for exactly which number it replaces);
  both citations in this tree (this section and `require_pr_audit.py`'s
  docstring) updated together.
- **HIGH, fresh bypass, closed.** T-SEP-GAP-4CHAR's own fix (collapse any
  separator run to its first character) manufactured false matches out of
  runs it shrank: `"...escalation. 0090 no longer applies"` had its `". "`
  collapsed to `"."` alone, removing the space the bare-token lookbehind
  needs to see to NOT look glued to a decimal — CONFIRMED released (real
  commit `e4b2312988` flipped OWNED to RELEASED across the replay window).
  `"Our guest -- merge gate is relaxed"` (an em dash) had its `" -- "` run
  collapsed to `" "` alone, reproducing the *exact* `"guest "` the
  `merge{_S}gate` exclusion carves out for the product's own guest-identity
  merges — released even though this text names the audit gate, not that
  feature. Fixed by collapsing a run of two-or-more characters to a fixed
  sentinel (`"~"`, already unconditionally stripped from real text two lines
  earlier in `skeleton()`, so it can never collide with anything an author
  wrote) instead of the run's own first character — which the guest case
  shows can itself be one of the three characters (`"-"`, `" "`, `"."`) this
  file's negative lookbehinds key on. A run of exactly one character is still
  left untouched (needed for `"0.0050"` and a real `"guest-merge-gate"` to
  stay excluded). T-SEP-GAP-4CHAR itself stays closed — any run still
  collapses to one character, always within `_S`'s bound.
- **HIGH, fresh bypass, closed (same class, not previously closed at all).**
  The 40-char bound on the inline-HTML strip (`<[^<>]{0,40}>`) let anything
  longer survive completely unstripped: an HTML comment
  (`"The audit <!-- reviewers: nothing to see here, this is formatting only
  --> gate opt-out applies..."`, 74 characters) is invisible when rendered
  regardless of length and was RELEASED end to end; a `<span>` whose own
  attribute ran past 40 characters was released by `_scan_text` directly; a
  markdown footnote (`"audit[^1] gate"`) was released for an unrelated
  reason — its digit is alnum, so no amount of separator collapsing lets
  `_S` (non-alnum only) bridge it. Fixed: an HTML comment is stripped with no
  length bound (unambiguous — it can only end at its own `"-->"`, never
  confusable with two unrelated angle brackets); a real tag's own grammar
  (name, then attributes, `"/>"`/`">"`) is matched next, also unbounded, but
  still cannot span two unrelated brackets the way `"<[^<>]*>"` would; a
  numeric footnote reference is dropped outright. The original 40-char probe
  is retired, not kept — re-measured against the full case suite once the
  two above run first, it now kills zero mutations and changes zero
  outcomes, and unlike them it was never tag-shape-constrained, so it was
  also the one place in `skeleton()` that could strip unrelated prose
  sharing a stray `"<"`/`">"` (`"a < b, c > d"`) instead of real markup.
  [CORRECTED 2026-09-20, r5-gate.json must-fix 1: "changes zero outcomes"
  held only against THIS suite as it stood that round, not against the
  shape the retired probe actually matched — a processing instruction
  (`<?x?>`) and a CDATA section (`<![CDATA[x]]>`) both matched the old
  `<[^<>]{0,40}>` but match neither the comment nor the tag-grammar strip
  above, so retiring it silently released both (CONFIRMED with `_scan_text`
  on HEAD vs. the fix, both spaced and unspaced). Closed the same way the
  comment was: `_HTML_PI_RE`/`_HTML_CDATA_RE`, no length bound, each on its
  own unambiguous closing delimiter. Cases I1–I3, counted by
  `test_the_gate_r5_last_call_added_3_cases`; a mutation per strip.]
  `scripts/test_pr_audit_gate.py` cases H1–H5, counted by
  `test_the_gate_r4_round_added_7_cases`. Measured before/after
  (`_scan_text`, direct call): all five RELEASED before, OWNED after; two
  controls (`"0.0050"`, a real `"guest-merge-gate"`) stayed released both
  times — the fix does not overreach into either exclusion.
- **SELF-ADVERSARIAL, found and fixed before shipping.** A first version of
  the footnote strip matched ANY `[^label]`, identifier included — which
  deletes the label's own TEXT, not just its `"[^"`/`"]"` punctuation.
  CONFIRMED that regresses a case gate-r3's code already caught correctly:
  `"pr[^audit]-gate"` was OWNED before any footnote fix (skeleton() never
  touched `"[^audit]"`, so `"audit"` stayed close enough to `"pr"`/`"gate"`
  for `\bpr{_S}audit{_S}gate` to match through the bracket/caret separators)
  and would have been RELEASED by a label-agnostic strip. Bounded to DIGITS
  ONLY instead — the shape the real finding demonstrates and the shape real
  footnotes actually are; case H7 pins the regression control, and a
  mutation widening the digit restriction back to any label is killed.
- **HIGH, fresh bypass, closed.** Three shapes let a push reach `main` with
  no literal `"main"` anywhere in the command text, all CONFIRMED exit 0 and
  confirmed live against a local bare origin: a bare `HEAD`/`@` refspec
  (`git push origin HEAD`, `git push origin @` — the real destination is the
  CURRENT LOCAL BRANCH, which this hook has never read); a wildcard
  (`git push origin 'refs/heads/*:refs/heads/*'`); and a same-command shell
  variable (`B=main; git push origin HEAD:$B` — this hook already reasons
  about one command at a time, point 21 above, and a plain assignment
  earlier in that SAME command is exactly the case that principle covers).
  `_push_reason()` now reads each refspec's own destination: bare `HEAD`/`@`
  blocks outright; a wildcard on either side blocks; a same-command
  `NAME=value` substitutes into a `$NAME`/`${NAME}` destination before the
  main-target and wildcard checks run; a `HEAD`/`@`-sourced destination
  still an expansion after that (no matching assignment) blocks as
  unresolvable. A non-`HEAD`/`@` source with an unresolved variable
  (`git push origin feature:$UNRELATED`) is left alone — not the
  demonstrated shape, and blocking it would refuse ordinary scripted pushes
  to named branches unrelated to main. `scripts/test_require_pr_audit.py`'s
  `test_r4_push_*` pin all four plus both negative controls (a same-command
  variable resolving to a non-main branch stays allowed; the unrelated-source
  case stays allowed). Measured before/after: all three bypasses allowed
  before, blocked after; both controls allowed both times.
  [CORRECTED 2026-09-20, r5-gate.json must-fix 6: naming the residual's
  example `$UNRELATED` undersells it — `_collect_assignments()` only
  recognizes a bare `NAME=value` token leading a statement, so
  `export B=main; git push origin feat:$B` collects NOTHING (`export` itself
  is not `NAME=value`-shaped, so it ends assignment-collection for that
  statement the same way any other command word would), leaving `$B`
  unresolved even though the shell's real value of `$B` is `main` by the
  exact same same-command-assignment mechanism the bare `B=main` case two
  paragraphs up was itself confirmed live against a bare origin for. CONFIRMED
  against this hook directly (no push executed): exit 0, not blocked, the
  same as the genuinely-unrelated `$UNRELATED` case right above it — NOT
  independently re-confirmed with a real push here, unlike the bare-`B=main`
  case, since deliberately running any `git push` is outside what this
  correction pass does. This residual is not merely "ordinary scripted
  pushes to named branches unrelated to main" — it also covers a
  same-command assignment prefixed by `export` (or any other shape
  `_collect_assignments()` does not parse), which resolves to main the same
  way the already-fixed bare `B=main` case does.]
- **SELF-ADVERSARIAL, found and fixed before shipping.** A first version of
  the same-command variable reader took `NAME=value` per already-tokenized
  segment and trusted the value outright. `_SHELL_PUNCTUATION` includes `(`
  and a backtick, so the tokenizer itself splits `B=$(echo main)` into
  `"B=$"`, `"("`, `"echo"`, `"main"`, `");"`, ... and `` B=`echo main`; ``
  into `"B="`, `` "`" ``, `"echo"`, `"main"`, `` "`;" ``, ... — CONFIRMED the
  first version read the truncated fragment (`"$"`, or `""`) as `B`'s whole
  value, concluded it plainly was not `main`, and let `HEAD:$B` through even
  though the shell's real value of `$B` is `main`. Fixed by reading the FULL
  flat token stream instead of pre-split segments: whenever the token right
  after a `NAME=value` assignment is itself punctuation and is not a
  statement separator (`;`/`&&`/`||`/newline), the name maps to an explicit
  UNRESOLVED marker, never to the fragment — so a downstream lookup treats it
  exactly like an unresolved expansion (the safe, blocking direction), never
  like a literal value that happens not to be main.
  `test_r4_a_command_substitution_disguised_as_a_simple_assignment_is_not_trusted`
  pins both forms; a mutation reverting to trusting the fragment is killed.
- **Closed.** `path-exec-surface-outside-matcher` (gate-r3, point 23 above)
  widened the matcher for six tool families; the built-in `Monitor` tool runs
  a shell command in the same shell environment as Bash and was not among
  them — CONFIRMED with `re.search`, the widened pattern did not match
  `"Monitor"`. `.claude/settings.json`'s matcher now includes it explicitly;
  `test_r4_monitor_is_routed_to_the_hook` pins it.
- **Corrected, not a security finding.** `ci.yml` pinned
  `aquasecurity/trivy-action@a9c7b0f06e461e9d4b4d1711f154ee024b8d7ab8` and
  called it "the v0.36.0 release commit" — that sha is the TAG OBJECT
  (`git ls-remote --tags` returns an annotated tag's own object, not what it
  points to). Verified independently: `git ls-remote
  https://github.com/aquasecurity/trivy-action refs/tags/v0.36.0
  refs/tags/v0.36.0^{}` returns `a9c7b0f0...ab8` for the tag ref and
  `ed142fd0...c25` (the `^{}`-peeled commit) for what it actually names.
  Re-pinned to the commit; `test_trivy_action_is_pinned_to_the_v0_36_0_commit_not_its_tag_object`
  pins both shas as constants (no network call in the suite itself, per its
  own no-network rule).
- **Widening narrowed to the founder's actual word.** `OWNED_BASENAMES`
  (gate-r3) owned `pytest.ini`/`conftest.py`/`pyproject.toml`/`setup.cfg`/
  `tox.ini` at any depth, shipped without asking — in this repo that meant
  `services/agent-orchestrator/pytest.ini`, `tests/conftest.py` and
  `tests/e2e/conftest.py` newly owned, wider than the finding it answers.
  **Founder's delegated answer** (lane batch 4, 2026-09-19: *"do what the
  best approach for long term, quality, sota, scalability"*): **own exactly
  what can influence the gate's own test run: `conftest.py` at or under
  `scripts/`, and the `ci.yml` flags `-c /dev/null --confcutdir=scripts`
  pinned by a test; not every depth.** Verified directly against this
  checkout's own pytest 7.4.4 before narrowing (scratch repro, both
  directions, not taken on faith): with `-c /dev/null --confcutdir=scripts`
  already in `ci.yml`, a root `pytest.ini`'s `addopts` is not read at all —
  `-c /dev/null` REPLACES normal ini discovery, it does not add to it — and
  neither is a root `conftest.py`'s collection hook; a `conftest.py` under
  `scripts/` still is. So `TEST_CONFIG_BASENAMES` is now `{"conftest.py"}`,
  owned only under `scripts/`; the other four basenames are no longer owned
  anywhere, and the flags are already pinned by
  `test_ci_pytest_step_is_config_isolated_from_pytest_ini_and_conftest`
  (gate-r3), re-verified still green. Cases G5 and G7 are corrected in place
  (dated, not silently rewritten) from owned to not-owned; G6
  (`scripts/conftest.py`) is unaffected; H6 pins the specific concern named
  in the finding (`services/agent-orchestrator/conftest.py`, not owned).
- **Re-measured, both figures held, for the right reason this time.** The
  replay window is unchanged (317 first-parent `main` commits, `09190ee5`
  back to 2026-08-24T00:00 local, each against its first parent). **104
  owned of 317, both before and after this round's fixes** — but before, that
  number held only because `e4b2312988` (T-SEP-GAP regression, above) and
  `58113e2616` (pytest-config over-widening, above) happened to cancel out,
  one lost and one gained; after, both are corrected to their proper
  classification (`e4b2312988` OWNED, `58113e2616` released) and the total
  is unchanged. No other commit in the window flips. `scripts/test_pr_audit_gate.py`:
  99 tests collected (91 PR shapes plus this round's 7 new cases, H1–H7,
  and their supporting checks), 85 mutations (0 survivors — includes 2 for
  fixes found and closed self-adversarially before shipping).
  `scripts/test_require_pr_audit.py`: 150 tests, 29 hook mutations (0
  survivors). `--self-test`: 98 invariants, unchanged (this round's fixes
  are additive to the identity-token/owned-prefix machinery it covers, not a
  change to it).
- **Assessed, not chased further.** The founder-quote bracket at the end of
  this ADR's 2026-09-18 review-trail entry (*"Accept the widening
  (Recommended)"*) already carries its own honesty caveat ("relayed by the
  orchestrating session") and a dated re-measurement bracket for PR #391's
  SHA at the time; PR #391 has since moved and merged again under this ADR's
  own accepted-cost bullet above. The existing bracket is dated, not wrong —
  re-verifying every historical PR-number cross-reference to its
  ever-current SHA is a different, open-ended maintenance task, out of this
  round's scope, and not requested by any of this round's findings.
- **Verified as previously reported, undisturbed by this round.** The
  surviving-mutant check, the SHIM `otherpr` kind, the `anthropic==0.87.0`
  pin, `deploy.yml` Stage 3's ref pin, and a clean `merge-tree` against
  current `origin/main` were all confirmed correct by the round that
  produced r4-gate.json; nothing in this round's diff touches any of them,
  and the full suite above re-confirms green.
- **Found in this round's own adversarial self-check; [CLOSED 2026-09-19,
  gate-r4 residual pass].** `_GH_API_RE` (`\bgh\s+api\b`) required the
  literal substring "gh api", so a quoted, IFS-split, brace-split, expanded
  or symlinked/renamed gh running `api` (`gh${IFS}api ...`, `"gh" api ...`,
  `{gh,api} ...`, `octocli api ...`) was never recognised as gh at all:
  `talks_to_github` stayed False and the non-literal-PR, GraphQL-merge-
  mutation and base-`/merges` checks were skipped, each CONFIRMED exit 0
  before the fix. (Corrections to this bullet's original framing: a
  *literal*-PR `gh api .../pulls/<n>/merge` was never blocked, plain or
  respelled — it is the ungated owned-PR route above — so a respelling
  escaped only those three surfaces; and `unplain_gh_word()` never defended
  `gh pr merge` against IFS-splitting either, which is still on the not-seen
  list.) Closed by `_gh_api_reading()` in `scripts/hooks/require_pr_audit.py`,
  three readings: the plain regex; the same words on the quote-stripped text
  with `${IFS}`, `$IFS`, any `${...}` or `{gh,api}` accepted as the
  separator; and a word-by-word read (`_lex`) using the `_is_program()` /
  `_cached_realpath()` identity fallback (a symlinked or renamed gh), a word
  the shell expands (`$G api`, `$(command -v gh) api`), and quoted strings
  another shell runs (`bash -c '...'`). A recognised gh api gets the plain
  spelling's answer (literal PR ungated, the other surfaces refused); an
  expanded word, or a command `_lex` cannot read, is only "maybe" gh — the
  surfaces are refused and the exemption is not extended. Only a command
  that names a merge surface is read at all. Measured 2026-09-19:
  `test_require_pr_audit.py` 150 → 228 tests (78 new: 72 behaviour tests
  and 6 mutation entries, plus the exemption mutation retargeted), the
  `test_require_pr_audit.py` + `test_pr_audit_gate.py` suites 249 → 327
  passed, `pr_audit_gate.py --self-test` 98 invariants held; 55 of the 72
  new behaviour tests fail against the pre-fix hook (the other 17 pin
  unchanged behaviour on purpose) and every new mutation is killed.
  Residuals, named and pinned by tests, not closed: a gh and an api both
  built by expansion (`G=gh; A=api; $G $A ...`); an independently copied gh
  binary (same as gate-r3's); `gh${IFS}pr${IFS}merge` (a different surface,
  still on the not-seen list). **Found while closing this, not closed, and
  outside this bullet's surface:** the endpoint text is read only as
  written, so a plain `gh api` with a quoted endpoint (`.../pu"lls"/$N/merge`,
  `.../mer"ge"`) still exits 0 — CONFIRMED by execution against the fixed
  hook.

Not done, stated plainly: no branch-protection or live-repo verification was
attempted (this round is a worktree pass that must not touch the real
repo's state, same restriction as gate-r3's own "not verified this round"
above); a NAMED (non-numeric) markdown footnote label between two identity
words is not stripped and is governed by `_S`'s ordinary bound like any
other separator, same residual shape as before this round, now stated
explicitly rather than only implied.

**gate-r5 last-call round — 2026-09-20.** The gate-r4 round above was itself
put through its own dedicated last-call audit (r5-gate.json, an Opus pass
over gate-r4's own diff) before it ever merged, the same discipline gate-r4
applied to gate-r3. Verdict: NOT READY. Most of gate-r4 held up on
re-measurement, but that round introduced one ownership regression, one
fresh bypass of that same round's own push fix, and one exponential regex —
none of the three named in this ADR. All six findings are closed or named
below.

- **HIGH, fresh regression, closed.** Retiring the 40-char inline-HTML probe
  (gate-r4, bullet above) also retired the only thing in `skeleton()` that
  stripped a processing instruction (`<?x?>`) or a CDATA section
  (`<![CDATA[x]]>`) — bracketed correction in place on that bullet, above,
  with the fix and the measurement.
- **HIGH, fresh defect, closed.** `_HTML_TAG_RE` (the same gate-r4 fix)
  backtracks exponentially on an unclosed tag: its attribute-name and
  unquoted-value character classes both admitted a quote character, so a
  quoted attribute with an embedded space and no closing `">"` had two ways
  to parse the same run — CONFIRMED doubling time, 0.10s/0.41s/1.66s at
  N=18/20/22 repeats of `' a="b c"'`, extrapolating to minutes by N=30 and
  days by N=40. It fails closed (the ownership deadlines report CANNOT
  CHECK), but a PR carrying this shape could not be classified at all.
  Fixed by excluding both quote characters from the name and unquoted-value
  classes (`[^\s=/>"']+` / `[^\s>"']+`), so a quoted value has exactly one
  parse — CONFIRMED fixed: N=20000 now runs in 0.005s.
  `test_html_tag_re_does_not_catastrophically_backtrack_on_an_unclosed_tag`
  (`scripts/test_pr_audit_gate.py`) asserts a wall-clock bound, not merely a
  changed pattern string.
- **HIGH, fresh bypass, closed.** `_push_reason()` (gate-r4's own push fix,
  above) compared a refspec's `src` to `("HEAD", "@")` before stripping a
  leading `"+"` — git's own force-push marker — so `"+HEAD"`/`"+@"` matched
  neither that check nor anything else in the function and fell through to
  allowed. CONFIRMED exit 0 before this fix (function call and the full
  hook, stdin JSON, both), exit 2 after; confirmed live against a local
  bare origin that `git push origin +HEAD` from a checkout of `main` really
  does move the remote's `main`. Fixed by stripping one leading `"+"` from
  each `spec` before the `":"` split, which fixes both places in the
  function that compare `src`. `+HEAD` and `+@` added to
  `test_r4_push_head_or_at_with_no_explicit_destination_is_blocked`
  (`scripts/test_require_pr_audit.py`); a mutation reintroducing the
  unstripped comparison is killed.
- **Records corrected, no behaviour change.** ci.yml's PR-shape count (was
  84, hardcoded and never updated as cases were added — re-measure via
  `len(CASES)`, don't copy forward, now 108), a "Belt-and-suspenders with
  OWNED_BASENAMES" line false since gate-r4 narrowed that rule to
  `conftest.py` under `scripts/` only, a trivy comment's "the sha above"
  that lost its referent when the line it pointed to was consolidated away,
  and this file's own citation of a test name that never existed
  (`test_ci_pytest_flags_pin_the_gates_own_isolation`, corrected to
  `test_ci_pytest_step_is_config_isolated_from_pytest_ini_and_conftest`) —
  each corrected in place with a dated bracket at its own location (ci.yml
  or `pr_audit_gate.py`, not repeated here).
- **Residual closed, per the founder's own delegated pytest-config-ownership
  principle** ("own exactly what can influence the gate's own test run").
  Neither `-c /dev/null` nor `--confcutdir=scripts` (gate-r3, above)
  isolates MODULE resolution: an unowned root-level `pytest.py`, `pytest/`,
  `_pytest/` or `sitecustomize.py` can still shadow the real `pytest`
  package, because `python3 -m pytest` prepends the current directory to
  `sys.path` before the import resolves. CONFIRMED in a scratch repo: a
  two-line root `pytest.py` (`print("527 passed"); sys.exit(0)`) made a run
  over one FAILING test print "527 passed" and exit 0 — a fake pass over a
  real failure, with nothing in `OWNED_BASENAMES` or `TEST_CONFIG_BASENAMES`
  to catch the file that did it. Fixed with `-P` (Python 3.11+, this job's
  own pinned `PYTHON_VERSION`), the interpreter's own answer to exactly this
  class of bug (`PYTHONSAFEPATH`) — CONFIRMED fixed in the same scratch
  repo. `test_ci_pytest_step_is_config_isolated_from_pytest_ini_and_conftest`
  is extended to pin it, mutation-tested by hand (removing `-P` from ci.yml
  turns that test red; restored from a snapshot, confirmed clean by diff).
- **Named, not code-changed — no marginal risk either way.** Two bullets
  above overclaim precision they don't have: the gh-api exemption bullet's
  "those three stay blocked, unchanged" (a `gh api` invocation ANYWHERE in
  a command exempts a merge call made by a DIFFERENT program elsewhere in
  the same command — grants nothing new, since the direct sanctioned route
  already gives the same ungating), and the push-residual bullet's
  `$UNRELATED` example (undersells a same-command `export NAME=main`
  assignment, which `_collect_assignments()` does not parse and which can
  resolve to main exactly as directly as the already-fixed bare `NAME=main`
  case). Both bracketed in place at their own bullets, above.
  [CLOSED 2026-09-21, gate-r6, founder review-trail round: both
  code-changed on the founder's own word -- "Bind it to the segment" and
  "Teach it export" (verbatim, see this ADR's Review trail). The literal-PR
  `gh api` exemption in `_github_api_merge_reason()` is now granted only
  when `_merge_call_outside_gh_api()` finds no command segment -- top-level,
  inside a `$(...)` or backtick substitution, or inside a quoted string
  another shell runs, three levels deep -- that names the REST merge
  endpoint without itself being the recognised `gh api` call; a `gh api`
  inside another program's quoted argument or a substitution no longer
  counts as that segment being gh api. `gh api user >/dev/null; curl -X PUT
  .../pulls/2/merge` exited 0 before (the hook's own verdict, measured in
  the test harness -- nothing there reaches GitHub) and exits 2 after, as
  does the same command inside `bash -c '...'`, `$(...)` or backticks.
  `_collect_assignments()` reads `export NAME=value`, `export -n` and
  `export --` as the assignment each is, so `export B=main; git push origin
  feat:$B` exits 2 -- proven with a real push against a local bare origin,
  which moved that origin's `main` on the pre-fix hook's allow.
  Last-call corrections to the first cut of both, each CONFIRMED by the
  hook's exit code on three builds (HEAD, the first cut, the fix): the
  first cut read EVERY merge surface per top-level segment rebuilt from
  `_lex`, which skips a heredoc body, so a base-repo Merges API POST, a
  GraphQL `enablePullRequestAutoMerge`, a non-literal-PR merge or a curl
  merge inside `bash <<'EOF'` exited 0 where HEAD refused all four -- the
  refusals now read the whole text again, over every merge-endpoint
  reference rather than only the first, and before the exemption, so a
  literal-PR `gh api` merge earlier in the command no longer returns past
  them; and its `export` reading fed a last-value-wins collector, so
  `export B=main; git push origin HEAD:$B; export B=develop` and `git push
  origin HEAD:$B; export B=develop` exited 0 where HEAD refused both --
  `_env_before()` now reads a name as main if ANY of its assignments is
  main, and as unresolved if it holds more than one value or is first
  assigned at or after the push. Named, not closed, each pinned at exit 0
  by `test_r6_the_named_residuals_are_still_not_seen`: a merge-endpoint
  reference in text the reader drops (a heredoc body, a comment) keeps
  HEAD's whole-command reading, so `gh api user; bash <<'EOF'` around a
  curl merge still exits 0 (it grants nothing the ungated literal-PR route
  does not); `gh` and `api` written as plain unquoted arguments of another
  program (`curl -X PUT <url> gh api`); a value set any way but a plain or
  exported `NAME=value` (`declare`, `typeset`, `readonly`, `local`, `read`,
  `eval`, `NAME+=`, or after a punctuation run the tokenizer fuses, `);
  B=main` [closed by gate-r8's word reading, which splits `)` from `;`]) --
  reading `export` as the bare form reads it brings export to
  the same gaps, so `export B=develop; eval B=main; git push origin HEAD:$B`,
  refused at HEAD only because an exported name was never read, now exits
  0 as its bare twin already did; and, older than this round and found by
  its last call, a push behind an env prefix or a wrapper (`X=1 git push
  origin HEAD`, `nohup git push origin HEAD`), which `_direct_push_problem()`
  skips because the segment's first word is not git. Tests and mutations:
  the `test_r6_*` functions and `r6_*` HOOK_MUTATIONS entries in
  `scripts/test_require_pr_audit.py`; `r4_gh_ordinary`, retired by the first
  cut, is restored and killed again.]

Re-measured on this round's own tree, not copied from gate-r4: the full
`ci.yml` scripts/ step (8 files, `-P` added) is 534 passed (527 at gate-r4's
own baseline, +7 new here); `test_pr_audit_gate.py` alone 103 (was 99 at
this round's own HEAD, measured in an isolated local clone);
`test_require_pr_audit.py` alone 231 (was 228, same method); `--self-test`
98 invariants held, unchanged; claims 359/359; citation pairing 178/120,
unchanged. Not done, stated plainly: no branch-protection or live-repo
verification was attempted, same restriction as the two rounds above; the
GitHub-markdown-renders-PI/CDATA-as-invisible claim is carried from
r5-gate.json's own finding, not independently re-run against the live API
in this round.

**gate-r7 — 2026-09-21.** The one residual gate-r6's own last call could only
NAME, not close (bracket above, "Named, not code-changed"'s sibling
paragraph): *"a push behind an env prefix or a wrapper (`X=1 git push origin
HEAD`, `nohup git push origin HEAD`), which `_direct_push_problem()` skips
because the segment's first word is not git."* Founder answer, as relayed by
the orchestrating session in the same review-trail round (see this ADR's
Review trail): close it, fail closed — a push behind leading assignments or
a wrapper (`nohup`, `env`, `command`, `time`, `exec`, `sudo`, `xargs`, a
shell `-c` with a literal string) run from a main checkout is read like a
bare push; an unrecognised wrapper shape is refused.

- **CONFIRMED by execution, live against a local bare origin**, both example
  commands: `_direct_push_problem()`'s segment loop required `seg[0]` itself
  to be `git` (`_is_program(seg[0], "git")`); a segment opening with an
  assignment token (`X=1`) or a wrapper's own program name (`nohup`) was
  skipped WHOLESALE, so the real `git push` sitting right after it never
  reached `_push_reason()` at all. `test_r7_env_prefix_push_is_confirmed_live_against_a_local_bare_origin`
  (`scripts/test_require_pr_audit.py`) runs both example commands for real,
  from a checkout of local `main`, against a throwaway bare origin, and
  confirms the origin's own `refs/heads/main` really moves before the fix,
  and that the fixed hook refuses both.
- **Fixed, one reading per part of the answer** (`scripts/hooks/require_pr_audit.py`,
  the gate-r7 comment block above `_direct_push_problem()`):
  - *Recognised, read like a bare push.* `_wrapper_stripped_push_reason()`
    peels any run of `NAME=value` assignments (the shape
    `_collect_assignments()` already reads) and any chain of the seven named
    wrapper programs, matched by basename so `/usr/bin/env` counts; a `git`
    reached that way goes to `_push_reason()` over the same `_env_before()`
    an un-wrapped push gets. So `sudo git push origin feature` stays allowed
    and `sudo git push origin HEAD` is refused, exactly as without `sudo`.
  - *A shell running a string.* `_shell_string_push_reason()`: a shell
    (`sh`, `bash`, `zsh`, `dash`, `ksh`, `fish`) whose options carry `c`
    anywhere (`-c`, `-lc`, `-ec`, `--norc -c`, `-o pipefail -c`) runs a
    command string, and every later non-option word is re-checked by
    `_direct_push_problem()` itself, recursively, bounded by
    `_MAX_PUSH_WRAP_DEPTH = 3` the way `_gh_api_reading()` (point 25) bounds
    its own nested-quote reading. A word built from `$`/backtick, or nesting
    past the bound, is REFUSED: this hook cannot resolve either without
    running a shell. A shell with no `c` option runs a script file or stdin
    (`bash deploy.sh`), point 23's residual, unchanged. [gate-r8 last call,
    finished: a heredoc body a shell runs -- a shell in the pipeline holding
    the heredoc, widened through the groups and substitutions holding it --
    is now read whole as that shell's script; a script file, a here-string
    and a pipe into a shell stay this residual.]
  - *Unrecognised, refused.* `_unrecognised_wrapper_push_reason()`: once the
    chain stops at anything else — a recognised wrapper's own flag (`sudo -u
    root`, `env -i`, `env -C dir`, `xargs -I{}`, `time -p`, `nohup --`), a
    program not on the list (`timeout`, `nice`, `find -exec`), a shell
    keyword (`then`, `do`, `{`, `!`), `eval` — a later `git` that runs
    `push` to ANY destination is refused, not read; so is a shell string
    holding the word `push` behind such a shape, and any later multi-word
    argument holding it when what runs it is a recognised wrapper's own flag
    (`env -S '...'`) or a program known to run a string it is handed
    (`_STRING_RUNNING_PROGRAMS`: `eval`, `watch`, `su`, `flock`, `script`,
    `ssh`, `parallel`, `python`, `node`, `perl`, `ruby`, `osascript`). A
    command with no git running push in it is untouched: `sudo docker push
    myimage:latest`, `sudo apt-get update`, `env FOO=bar npm run build`,
    `sudo -u root git status`, `timeout 10 git fetch origin` all stay exit 0.
- **Last call, same day: the first cut built only half the answer.** It read
  a BARE named wrapper and an exact `shell -c <arg>`, and let every other
  wrapper shape through as "not a push" — and pinned four of them open
  (`sudo -u root git push origin HEAD`, `env -i ...`, `xargs -I{} ...`,
  `bash --norc -c '...'`, each exit 0) as residuals "per the founder's own
  words", which the founder had not said: his answer refuses an
  unrecognised shape. Corrected to the three readings above.
  `test_r7_unrecognised_wrapper_shapes_are_refused_live_against_a_local_bare_origin`
  proves five of the shapes with a real push, gated by the hook the way a
  Bash call is, from a checkout of `main`: under the first cut each is
  allowed and the bare origin's `main` moves; under the fix each is refused
  and `main` does not move (`env -u X`, `nice -n 5`, `if true; then ...;
  fi`, `eval '...'`, `sh -ec '...'`).
- **Cost, stated plainly.** Refusing an unrecognised shape cannot tell a
  wrapper from prose: a heredoc body line that names `git push` after some
  other word (`We checked that git push origin HEAD is refused`) is now
  refused where the first cut let it through, and so is `echo git push
  origin HEAD`. Write such text to a file and pass it with `-F`.
- **Named residuals.** A value set any way `_collect_assignments()` does not
  already read (`declare`, `typeset`, `readonly`, `local`, `read`, `eval`,
  `NAME+=`) — the founder's answer is to **KEEP TRUSTING them**: that gap
  (point 21's residual, and gate-r6's own "Named residuals" bullet, above)
  stays as is, and an `eval` string built from an expansion (`eval
  "$(ssh-agent -s)"`) is not refused. Heredoc bodies and comment text
  **keep the current reading** — the founder's answer: this push check
  reads a heredoc body's lines as commands and drops comment text, both as
  before, and gate-r6's "the refusals now read the whole text again"
  reading is unchanged. A quoted string handed to a program on neither list
  is not read, since the hook cannot tell it from a quoted argument such as
  `gh pr create --body '...'`. Found by the last call and left for the
  founder, not changed here: a word the tokenizer cannot close — bash's
  `$'...'` quoting, e.g. `git push origin HEAD; echo $'\''` — makes
  `_tokens()` raise and the whole push check return "not a push" (exit 0),
  as it did before this round; refusing instead would also refuse every
  heredoc whose body holds an odd number of apostrophes. Also found by the
  last call and left for the founder: a git whose own NAME comes from an
  expansion (`G=git; $G push origin HEAD`, `$(echo git) push origin HEAD`)
  is not seen, as before this round — the push-side twin of the `G=gh; $G
  ...` merge shape in the "Not seen" list. [Both CLOSED by gate-r8, below,
  on the founder's round-6 answer; the quoted-string residual stays named.]

Re-measured on this round's own tree: `test_require_pr_audit.py` alone 366
passed (286 at gate-r6's HEAD, 321 at the first cut); 59
`test_hook_mutations_are_killed` cases, every mutant killed, 13 of them
gate-r7's (the first cut's 6, 2 of those re-pinned to a non-main push since
the unrecognised reading now refuses a main push on its own, plus 7 from the
last call); the full `ci.yml` scripts/ step 697 passed (617 at gate-r6, 652
at the first cut); `test_pr_audit_gate.py` 103, unchanged. Not done, stated
plainly: no branch-protection or live-repo verification, same restriction
as every prior round; the `-c` depth bound is exercised by mutation and by
a synthetic non-main push nested past it, not by a real push at that depth;
`sudo`-prefixed shapes are proven by the hook's verdict only, since the
harness cannot run `sudo`.

**gate-r8 — 2026-09-21, round 6.** The gate-r7 last call put four
recommendations to the founder, each with its roads. His answer, as relayed
by the orchestrating session (see this ADR's Review trail): *"Take all
four"*. Built in `scripts/hooks/require_pr_audit.py` (the gate-r8 comment
block above `_expansion_words()`, and `_direct_push_problem()`):

- **(1) A word shlex cannot close — road (b).** When `_tokens()` raised, the
  whole push check returned "not a push": `git push origin HEAD; echo
  $'\''` exited 0 and, run from a checkout of `main`, moved a local bare
  origin's `main`. Now the command is re-read with the heredoc-aware
  `_lex()` reader, which reads bash `$'...'` quoting and skips heredoc
  bodies, and is refused only if that reading also fails: it raises, leaves
  a quote, a substitution, a `${` or an in-word parenthesis open, or meets a
  construct it reads differently from the shell (quoting, a brace or a
  substitution inside `${...}`; quoting inside an in-word parenthesis; a
  `case` pattern inside a substitution). Measured: bash reads `echo
  ${X:-"}"}` as one word and `_lex()` ended it at the first `}`, hiding a
  push on the next line that moved `main`. Heredoc bodies keep the current
  reading: each line is read as a command, and a line no reader can close
  is read with its quotes and backslashes removed, never refused only for
  being unreadable. The founder's twins hold: a commit heredoc that does not
  push passes with an odd and with an even apostrophe count, and `git push
  origin feat/x` is unchanged, with or without `$'\''` beside it.
- **(2) Git named by an expansion — road (a).** A command word built from
  `$` or a backtick is resolved through the same-command assignments
  `_collect_assignments()` already collects (`_expansion_words()`), split on
  blanks as the shell splits an unquoted expansion, and read as what it
  resolves to: `G=git; $G push origin feat/x` passes like a bare push, and
  `G=git; $G push origin HEAD` is refused like one. One this hook cannot
  resolve is refused when push follows it, past git's own global flags or
  as `subtree push` (`$(echo git) push origin HEAD`, `"$G" push origin
  feat/x`), or when it is one whole substitution holding push (`$(printf
  'git push') origin HEAD`); otherwise it is read as an unrecognised
  wrapper shape, as gate-r7 already read `$SUDO git push ...`. The same
  reading applies to any later single word behind an unrecognised shape
  (`timeout 10 $G push origin feat/x`), and to git's own subcommand, the
  sibling position: `P=push; git $P origin HEAD` and `git $(echo push) origin
  HEAD` were read as unknown, non-alias subcommands and allowed, each
  measured moving `main`. A same-command `IFS` is honoured when a resolved
  word is split (`IFS=x; W=gitxpush; $W origin HEAD` is `git push`, measured
  moving `main`; a command setting `IFS=` now opens the reading even when it
  names neither git nor push), and an `IFS` this hook cannot resolve leaves
  the word unresolved.
- **(3) Text that names a push.** Accepted as the cost of refusing an
  unrecognised shape, as he answered: a heredoc body line that names `git
  push` after another word, and `echo git push origin HEAD`, are refused.
  Both push refusals in `main()` now end with `PUSH_TEXT_HINT`, which says
  exactly that and names `-F <file>` (`git commit -F`, `gh pr create -F`).
  Pinned by `test_r8_text_naming_a_push_is_refused_and_told_to_use_a_file`,
  and the hint itself by `test_r8_the_text_hint_is_load_bearing`, since the
  exit-code mutation harness cannot see a message.
- **(4)** Unchanged, as he answered: a quoted string handed to a program on
  neither list stays a named residual (gate-r7's bullet above), pinned at
  exit 0 by `test_r7_the_named_residuals_are_still_not_seen`.
- **Found while building, closed under rules already recorded here.** Each
  is a shape an existing rule refuses wherever the hook can read it, so none
  is a new decision:
  - A push inside a double-quoted substitution (`echo "$(git push origin
    HEAD)"`, `OUT="$(git push origin HEAD 2>&1)"`) was one quoted shlex
    word, never read, and moved `main`. The `_lex()` reading that roads (a)
    and (b) need runs beside shlex on every command naming git or push and
    reads the words inside every substitution: the push-side twin of the
    "Refused" list's merge inside a double-quoted substitution.
  - A same-command value that is itself an expansion (`X=main; B=$X; git
    push origin HEAD:$B`) or an array (`B=(main)`) was trusted as a literal
    and allowed; now unresolved, which gate-r4's rule refuses for a HEAD/@
    source. From a named source (`feat:$B`) it stays allowed, like gate-r4's
    `feature:$UNRELATED`.
  - Each reading covers the other's misreads, so a push stayed hidden only
    where both misread at once: `echo $'\''; x=(')')` with a push on the
    next line, and `echo "$(case a in a) git push origin HEAD;; esac)"`,
    each measured moving `main`. When shlex reads the command, the word
    reader reports a misread or an open construct, and the command holds
    something shlex reads differently from the shell (`$'`, a heredoc, a `#`
    inside a word, a substitution), it is refused.
  - gate-r6's named residual "an assignment after a punctuation run the
    tokenizer fuses" is closed as a side effect: the word reader splits `)`
    from `;`, so `f() ( git push origin feat:$B ); B=main; f` is refused.
- **Measured through the entry point.** Fourteen shapes gave exit 0 on
  gate-r7's hook and exit 2 on gate-r8's; the five twins above gave 0 on
  both. `test_r8_each_closed_shape_is_a_real_push_the_hook_now_stops` runs
  nine of them for real from a checkout of `main` against a local bare
  origin: with no hook, `main` moves; gated by the hook the way a Bash call
  is, each is refused and `main` does not move.
- **Cost, measured by replay.** Every distinct Bash command recorded in this
  project's local session transcripts, 79,404, was read by gate-r7's and
  gate-r8's final push checks (`DIRECT_PUSH_PATTERN` and
  `_direct_push_problem()`, in-process). 54 are refused now that were
  allowed; none is allowed now that was refused. 52 of the 54 meet a rule
  older than this round that passed them only because an apostrophe or
  `$'...'` made shlex fail: 32 a bare `git push` (no remote or refspec,
  refused since gate-r3; 31 in the command itself, 1 in heredoc prose); 9 a
  push to a `$`-built destination or to `HEAD` (gate-r4; 7 in the command, 2
  in a heredoc body that writes a script; each split measured by re-reading
  the command with its heredoc bodies blanked); 2 a push behind `then`
  (gate-r7); 9 a shell running a string built from an expansion in a command
  naming git (gate-r7; 2 of them this build's own probe commands). The other
  2 are commands bash itself cannot parse (an unclosed backtick inside
  double quotes; a nested heredoc whose inner delimiter line ends the outer
  one), refused by this round's both-readings rule. The commonest new
  refusal is `git commit -F - <<'EOF' ... EOF && git push` with an
  apostrophe in the message: name the branch. The
  replay found two faults in the first cut, both fixed before this record:
  14 `node -e '...'`/`python3 -c '...'` strings gate-r7 refused were let
  through (a string holding `$` was read as a command word; it now goes on
  to gate-r7's string reading), and 37 heredoc body lines of code were
  refused by the both-readings rule (a body line is text; the rule is the
  command's).
- **Last call, same day: five fail-opens in the two roads as first built.**
  Each was allowed (exit 0) by the hook this section first described and,
  run for real, moved a local bare origin's `main`; each is closed where it
  lived, as part of building the roads he chose, not as a new rule:
  - *(2) A same-command prefix read as giving the command's own words their
    value.* The shell expands a simple command's words before its own
    `NAME=value` prefix takes effect, so `declare G=git; G=true $G push
    origin HEAD` runs git while road (a) resolved `$G` to `true`; so did
    `declare P=push; P=status git $P origin HEAD`, and, older than this
    round, `declare B=main; B=feat git push origin HEAD:$B`. A prefix now
    counts as assigned after the command, as a later statement's assignment
    already did (`_wrapper_stripped_push_reason()`), so every word of a
    command reads only what was assigned before it and the index shift the
    first cut kept for a spliced word, with its two mutation cases, is gone:
    it could no longer change a verdict. The same reading now allows `G='git
    push' $G origin HEAD`, which runs no push.
  - *(2) `$_` resolved through `_=value`.* The shell resets `$_` after every
    command, so `_=x; echo git; $_ push origin HEAD` runs git; no `_=value`
    is trusted now (`_collect_assignments()`).
  - *(1) `$'...'` escapes read as the escaped letter.* The word reader
    dropped each backslash, so with shlex unable to close `$'\''` later in
    the command, `git push origin $'\x6dain'` read as a push to `x6dain`, and
    `$'\x67it' push origin HEAD` as a program `x67it`. `_ansi_c()` now
    decodes `\xHH`, octal, `\u`/`\U`, `\c` and the named escapes as bash does,
    ends the string at a NUL as bash does, and drops the backslash of an
    escape neither shell knows as zsh does (`$'\git'` is git under zsh, the
    Bash tool's shell here), since a word that keeps its backslash never
    spells one this hook looks for.
  - *(2) zsh's `=git`.* zsh expands a command word `=name` to the path
    `name` resolves to, so `=git push origin HEAD` is git (measured under
    zsh). Closed under gate-r3's rule that a word resolving to git's own file
    is git (`_is_program()`).
  - *(1) Heredoc bodies a shell runs or expands.* The fallback read each body
    one line at a time as text, which lost a script's earlier lines: `bash
    <<'EOF'` with `IFS=x` then `W=gitxpush; $W origin HEAD`, or `W="git
    push"` then `$W origin HEAD`, followed by `echo $'\''`. And inside a
    double-quoted substitution, which shlex reads as one word, no body was
    read at all: `x="$(bash <<'EOF'` + `git push origin HEAD` + `EOF` +
    `)"`, and `echo "$(cat <<EOF` + `$(git push origin HEAD)` + `EOF` +
    `)"`. Now, in both readings, a body a shell runs (`bash <<'EOF'`, `cat
    <<'EOF' | sh`, and the shapes the finishing pass below adds) is read
    whole as that shell's script, and a body under an unquoted delimiter has
    its substitutions read, as the shell runs them (`_heredoc_push_reason()`).
    A body that is only text under a quoted delimiter is not read there: `gh
    pr create --body "$(cat <<'EOF' ... EOF)"`, the common PR and commit
    shape, reads as before, and nothing in it runs. gate-r7's residual "a
    shell with no `c` option runs a script file or stdin" narrows to a script
    file, a here-string and a pipe into a shell.

  Pinned: `test_r8_last_call_shapes_are_real_pushes_the_hook_now_stops` runs
  18 bash shapes for real, each moving `main` ungated and refused gated with
  `main` unmoved; `test_r8_last_call_zsh_shapes_are_refused` asserts the
  verdict for the three zsh shapes and, where zsh is installed, their real
  push; `test_r8_last_call_allowed_twins` pins 11 twins at exit 0; 19
  mutation cases, re-measured by the finishing pass, each flipping its
  scenario's exit (0 to 2 or 2 to 0) rather than crashing -- three of them
  re-targeted at the reading that replaced `_pipeline_runs_script()`.
  Measured through the entry point: the hook this section first described
  allowed 20 of these 21 shapes, gate-r7's all 21.

  That fix was left unfinished, and was not staged: with it the suite gave
  531 passed and 2 failed, the two gate-r8 mutation cases `r8: heredoc
  bodies not read when shlex fails` and `r8: skipped heredoc bodies not
  collected`, whose scenario (an unquoted body's `$(git push origin HEAD)`)
  its new expanding reading also covered. A last call on it named the fork
  (finish here, or merge with the five kinds named as residuals and close
  them in a gate-r9); the founder's word, 2026-09-22, as relayed by the
  orchestrating session (Review trail): *"check claude cli,
  0dc07485-0b74-4712-aa1f-c43ab67f6dbc, make sure it din't do anything
  different. if not finish in this PR"*. The orchestrating session checked
  that session (the merge train) and found no gate edits, so it is
  finished here.
- **Finished, same PR.** Measured before finishing it, the unfinished fix
  still let 36 more real pushes through (35 at exit 0, one by crashing),
  each moving a local bare origin's `main` when run -- 25 under bash, 11
  under zsh; the hook this section first described let 35 of them through,
  gate-r7's all 36. Each is closed where it lived, inside the roads he
  chose or under a rule already recorded here:
  - *Which heredoc bodies a shell runs (road (b)'s heredoc reading).* The
    fix read a body as a script only when a shell stood in the heredoc's
    pipeline on its own line, and its `.` never matched: a trailing-version
    strip turned the name `.` into nothing. `_heredoc_runs_as_script()`
    now decides once every word of the level holding the heredoc is read
    (`_lex()`'s `settle()`), and again at each level holding that one. The
    pipeline runs past a pipe that ends its line, blank lines after the
    body included (`cat <<'EOF' |` + body + `bash`); it is widened through
    every group holding the heredoc -- `( ... )`, `{ ...; }`, and `if`,
    `while`, `until`, `for`, `select` and `case` as commands, not as
    arguments, with a `case` pattern's `)` closing nothing
    (`_without_case_patterns()`) -- and through every substitution holding
    it, where the word the substitution is part of decides (`bash <(cat
    <<'EOF' ...)`, `source <(...)`, `echo "$(cat <<'EOF' ...)" | bash`). A
    runner is a shell named anywhere in that pipeline, `.` or `source` as
    the command (not the `.` of `git -C . commit -F - <<'EOF'`), or a
    command word built from an expansion this reading does not resolve
    (`$_ <<'EOF'`, `nohup $_ <<'EOF'`). The pipeline still ends at `&&`, `;`
    and a newline, so `bash check.sh && cat > msg.txt <<'EOF'` keeps its
    body text.
  - *A heredoc inside an unquoted body's substitution.* Each substitution
    in an unquoted body is now read as the command it is, heredocs
    included, not word by word: `echo "$(cat <<EOF` + `$(bash <<'X'` +
    `git push origin HEAD` + `X` + `)` + `EOF` + `)"` was allowed.
  - *A push check that crashed.* 22 nested `$(` in an unquoted body made the
    word reader raise inside the fix's new body reading; the hook exited 1,
    which Claude Code treats as a non-blocking error, so the command ran --
    with a push written to a file and run after it, a shape the hook first
    described here refused. `main()` now refuses when the push check raises
    ("the push check could not read the command"), the product rule that a
    failed read is an error, and a heredoc script or an unquoted body's
    substitution nested past `_MAX_PUSH_WRAP_DEPTH` is refused, as a fourth
    nested `bash -c` is.
  - *zsh's `=name`, past git (the last call's fourth kind).* `=bash -c
    '<push>'`, `=sh -c '<push>'`, `=python3 -c '...<push>...'` and `=bash
    <<'EOF'` ran their strings and scripts unread; `_program_name()` drops
    zsh's `=` wherever the wrapper, shell, string-runner and heredoc-runner
    lists are read, as `_is_program()` already did for git.
  - *zsh's parameter splitting (road (a)).* zsh does not split an unquoted
    `$G`, but `$=G` and `${=G}` split it, and so do the flags `${(z)G}` and
    `${(s:x:)G}`: with `G="git push origin HEAD"` each ran a push. `$=G`,
    `${=G}`, `$~G` and `$^G` now resolve as G's value (`G="git push";
    ${=G} origin feat/x` passes like a bare push); a word under a flag this
    hook does not evaluate is refused, as a command word or a later word
    behind an unrecognised shape, when an assignment before the command
    gives G a value holding `push` (`_value_holds_push()`), as one whole
    substitution holding push already was. A prefix gives the word nothing:
    `G="git push origin HEAD" ${(z)G}` runs no push and is allowed. A flag
    (`${(`) opens the reading, as `IFS=` does.
  - *Quoting inside both words (road (b), older than this round).* The
    prefilter that opens the push reading looked for the words `git` or
    `push` as written, so `"g"it "p"ush origin HEAD`, `g\it p\ush origin
    HEAD`, `g''it p''ush origin HEAD` and `$'\x67it' $'\x70ush' origin HEAD`
    were never read at all; gate-r7's hook let each through the same way.
    The prefilter now also reads the command with `$'...'` decoded and
    quotes and backslashes dropped (`_unquoted()`); what the reading then
    finds decides (`"g"it status` passes).
  - *The two surviving mutation cases are re-pinned, not retired.* Their
    scenario `r8_fallback_body` is now `echo $'\''`, then a quoted body
    holding `git push origin HEAD` written to `p.sh`, then `bash p.sh`: a
    real push, pinned by `test_r8_only_the_line_reading_stops_a_push_through_a_file`,
    that only the unreadable-word fallback's line reading sees. The index
    shift the first cut kept for a spliced word, and its two mutation
    cases, stay retired as the last call left them: with a prefix read as
    assigned after its command, every word of a command reads the same
    assignments, so the shift could not change a verdict; both scenarios
    stay in the control set, still refused.

  Pinned: `test_r8_finishing_pass_shapes_are_real_pushes_the_hook_now_stops`
  (25 bash shapes) and `test_r8_finishing_pass_zsh_shapes_are_refused` (11,
  run for real under zsh where it is installed), each moving `main` ungated
  and refused gated with `main` unmoved; `test_r8_finishing_pass_allowed_twins`
  pins 9 twins at exit 0, and the founder's twins hold (a commit heredoc
  that does not push, with an odd and with an even apostrophe count, and
  `git push origin feat/x`); 32 new mutation cases, each checked in-process
  to flip its scenario's exit, except the crash guard's, whose mutant exits
  1 by design -- the fail-open it guards against. Not pinned by a mutation:
  the command-position checks inside `_without_case_patterns()`, and the
  hygiene `del` of carried bodies in `_lex()`'s `nested_lex()` (its mutant
  changes no verdict). The transcript replay was re-run on every distinct
  Bash command recorded by then, 80,100: the verdicts of the hook this
  section first described, of the unfinished fix and of this one are
  identical on every command (389 refused); against gate-r7's hook, 55 are
  refused now that were allowed and none is allowed that was refused -- the
  54 above, plus one command recorded after that replay that bash itself
  cannot parse (an unclosed quote, `bash -n` exit 2), refused by the
  unreadable-word rule.
- **Named residuals, gate-r8,** each pinned at exit 0 by
  `test_r8_the_named_residuals_are_still_not_seen`: a git and its subcommand
  both built by expansion (`$G $P origin HEAD`), the push-side twin of `G=gh;
  $G p$()r merge 2`; a command word built by brace or glob expansion
  (`{git,push,origin,HEAD}`, measured moving `main`), the twin of `{gh,pr,merge}
  2`; behind an unrecognised shape, a substitution word holding blanks, read
  as a string and not as a command word (`timeout 5 $(printf 'git push')
  origin HEAD`); an unresolvable destination from a named source, now also
  when the value is itself an expansion (`X=main; B=$X; git push origin
  feat:$B`), as gate-r4 decided for `feature:$UNRELATED`; a command both
  readings misread through a construct the word reader does not flag; and,
  older than this round and found while testing it, the push-side twins of
  the merge side's "Not seen" `echo merge 2 | xargs gh pr` and `alias g=gh;
  g pr merge 2`: `echo push origin HEAD | xargs git` (measured moving
  `main`) and a shell alias for git defined on an earlier line. Left
  for the founder, found while building: a git alias the command defines
  for itself (`git -c alias.p=push p origin HEAD`, `GIT_CONFIG_COUNT=1
  GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p origin HEAD`, each
  measured moving `main`) — gate-r3 reads only `git config --get
  alias.<name>`, and which config sources to distrust (`-c`,
  `--config-env`, `GIT_CONFIG_*`, `HOME`, `-c include.path`) is a fork. A
  cost, pinned refused by `test_r8_the_named_cost_is_still_refused`: behind
  an unrecognised program, an unresolved single word followed by the word
  push is refused whatever the program (`docker --config $DIR push
  myimage`), since it may be git.
- **Named residuals after the last call, finished,** each a real push
  (measured moving a bare origin's `main`) pinned at exit 0 by
  `test_r8_finishing_pass_named_residuals_are_still_not_seen`: a heredoc
  body carried through a variable to a shell (`x="$(cat <<'EOF' ...)";
  echo "$x" | bash`); a script written to a file and run later, whose
  earlier lines the unreadable-word fallback loses by reading a body one
  line at a time (point 23's script file); a here-string and a pipe into a
  shell (`bash <<< '...'`, `echo '...' | bash`, point 23's stdin); git and
  push both split by an expansion (`g$()it p$()ush origin HEAD`, under "a
  git and its subcommand both built by expansion"); and, left for the
  founder, a heredoc body a program that is not a shell runs, with the push
  inside that program's own quoted string (`python3 - <<'EOF'` with
  `os.system('git push origin HEAD')`, `perl <<'EOF'`) -- the heredoc twin
  of gate-r7's string-running reading, which reads `python3 -c '...push...'`
  but no heredoc. Costs, pinned refused: a command word under a zsh flag
  whose value holds push is refused whatever its destination (`G="git push
  origin feat/x"; ${(z)G}`); a command word built from an expansion in a
  heredoc's pipeline makes its body a script, so an unreadable line there
  is refused (`"$PY" - <<'EOF'` with a body naming git and an odd
  apostrophe). Neither occurs in the 80,100 recorded commands.

Re-measured on this round's own tree: `test_require_pr_audit.py` alone 484
passed (366 at gate-r7); 98 `test_hook_mutations_are_killed` cases, every
mutant killed, 39 of them gate-r8's, each checked to flip its scenario's
exit rather than crash, plus gate-r4's command-substitution fragment check
re-pinned to `B=<(echo main)`, the one fragment only it still reads as
unresolved; the full `ci.yml` scripts/ step 815 passed (697 at gate-r7);
`test_pr_audit_gate.py` 103, unchanged. Two tests re-anchored, not
weakened: `test_h15d` and `test_r4_a_reader_that_cannot_read...` inject a
crash at `_lex()`'s new signature, and their control is now `ls -la`,
because the push check reads a git command with the same reader and a crash
there refuses it (asserted). Not done, stated plainly: no branch-protection
or live-repo verification; the shells measured are bash 5.3 and, for one
shape, zsh (the Bash tool here runs zsh, where an unquoted `$G` is not
split, so the split reading can refuse a command zsh would not run as a
push); `timeout` is not installed on this machine, so the shapes behind it
are proven by the hook's verdict only.

Re-measured after the last call, finished, on this PR's own tree:
`test_require_pr_audit.py` 618 tests, all passing in the step run below
(484 at the first cut, 531 passed and 2 failed with the unfinished fix); 147
`test_hook_mutations_are_killed` cases, every mutant killed, 88 of them
gate-r8's (37 of the first cut's, the last call's 19, the finishing pass's
32); the full `ci.yml` scripts/ step 949 passed (815 at the first cut);
`test_pr_audit_gate.py` 103, unchanged. The CLAIMS row
`ADR-0090-GATE-R8-UNREADABLE-AND-EXPANDED-PUSH` holds on this hook and
exits 1 on `origin/main`'s, on the first cut's, on the unfinished fix's,
and on 31 of the last call's and finishing pass's 51 hook mutations. Not
done, as before: no branch-protection or live-repo verification; the shells
measured are bash 5.3 and zsh 5.9.

- **Last call on the finished pass: five more real pushes in the same two
  roads.** An Opus last call on the finishing pass (above) found the
  finished hook still let five more real pushes through at exit 0, each
  measured moving a local bare origin's `main` under bash, in the two roads
  the founder chose:
  - *(a) A whole `${...}` command word whose default/alternate-value text
    holds push.* `_expansion_words()` only ever read a bare `$NAME` or
    `$(...)`/backtick substitution; a parameter expansion using bash's
    default/alternate-value operators (`:-`, `-`, `:=`, `=`, `:+`, `+`) was
    never read at all, so `${G:-git push} origin HEAD` and `${G-git push}
    origin HEAD` (`G` unset either way) ran a push neither reading saw --
    and, the IFS-split variant, `IFS=x; ${W:-gitxpush} origin HEAD` moved
    main the same way the same-command IFS already reaches a resolved
    `$NAME`'s value.
  - *(b) `eval`'s joined arguments, unread as a command string.* `eval` sat
    on `_STRING_RUNNING_PROGRAMS` (read as an unrecognised wrapper, a flat
    word-boundary check on a later multi-word argument, never re-parsed as
    a command), so a same-command IFS split inside the string it evaluates
    hid a push from that flat check (`eval 'IFS=x; W=gitxpush; $W origin
    HEAD'`) exactly as it did before the IFS closures above existed, and a
    heredoc carried through an unquoted substitution inside the eval'd
    string was not read at all (`eval "$(cat <<'EOF'` + `IFS=x` +
    `W=gitxpush; $W origin HEAD` + `EOF` + `)"`).
  - Not the founder's round-6 named residual (4): a command word built by
    expansion holding ONLY `git`, with a literal `push` as its own
    following word (`${G:-git} push origin HEAD`) was already read as git
    with push right after it, by `_push_follows()`, before either road
    existed -- unrelated to both mechanisms above, and unchanged by them.
  - His answer, as relayed by the orchestrating session (round 6y, this
    ADR's Review trail): *"Close them here (Recommended)."*
- **Closed on the founder's 2026-09-22 word, same PR (gate8c).** Both roads,
  built in `scripts/hooks/require_pr_audit.py`'s gate8c comment block above
  `_WHOLE_SUBSTITUTION_RE`:
  - *(a)* `_PARAM_DEFAULT_RE` matches a whole `${NAME<op>text}` token (the
    six operators above) the way `_lex()` keeps it -- one word, blanks
    inside included, where shlex would split at the first blank in `text`.
    `_whole_word_holds_push()` reads `text` through `_expansion_words()`,
    the same same-command-IFS-aware splitting a resolved `$NAME` already
    gets, and refuses when `push` is one of the resulting words; when `text`
    itself holds an expansion this hook cannot resolve, it falls back to
    the plain word-boundary check `$(...)` already has, rather than passing
    silently. Neither form resolves whether `NAME` itself is actually set
    (bash's own `:-` vs `-` distinction) -- it fails closed on the text
    every one of the six operators may still expand to.
    `_wrapper_stripped_push_reason()`'s unresolved-word branch now checks
    `_whole_word_holds_push()` beside the existing `_push_follows()`; the
    whole-`$(...)` check that branch had moved into `_whole_word_holds_push()`
    unchanged.
  - *(b)* `_eval_string_push_reason()`: when the command's stripped name is
    `eval`, its own remaining arguments are joined with a single blank
    between each -- real `eval` semantics, unlike `bash -c`'s separate
    positional arguments -- and the joined string is re-read recursively
    through `_direct_push_problem()` itself, as
    `_shell_string_push_reason()` already re-reads a `bash -c` string, but
    after the command's own assignments (`_eval_outer_statements()`, below:
    corrected by the last call on this round). The generic
    `_unrecognised_wrapper_push_reason()` reading `eval` had before still
    applies beside it (also the last call's correction), and stays the only
    reading for every other string-running program on that list.
    Deliberately no early refusal on an unresolved `$`/backtick anywhere in
    the joined string: the recursive call resolves what it can from those
    assignments and from ones made *inside* the joined string, as both
    measured shapes need, and everything past that reads exactly as
    unresolved-expansion handling already does.
  - The founder's named allowed twin holds: `eval "$(ssh-agent -s)"` -- a
    substitution this hook does not resolve, with no `push` or `git`
    anywhere in the joined string -- stays allowed.
  - *Last call on this round, same day (Opus): the eval re-read as first
    built opened what the hook before it refused.* Each shape below was
    refused or unread as stated, allowed by the first build at exit 0, and
    measured moving a local bare origin's `main` under bash 5.3:
    - Re-read alone, the joined string lost the command's own assignments.
      A `bash -c` string runs in a child shell that sees none of them, but
      `eval` re-reads its string in the same shell, under every earlier
      assignment and under its own `NAME=value` prefix (a special builtin
      runs under its prefix). So `C='git push origin HEAD'; eval "$C"`,
      `... eval '$C'` and `... eval eval '$C'`, each refused before gate8c,
      were allowed; and the same-command IFS this round was meant to carry
      into `eval` never reached it from outside the string: `IFS=x;
      W=gitxpush; eval '$W origin HEAD'`, `W=gitxpush; IFS=x eval '$W
      origin HEAD'` and `C='git push origin HEAD'; eval 'eval "$C"'` were
      allowed before gate8c and after it. Fixed: `_eval_outer_statements()`
      writes the command's assignments as statements the joined string is
      re-read after -- every value of each name, in order, from the map as
      collected (eval's own prefix counts as before it), and a name first
      assigned at or after the `eval` opening with a value this hook does
      not trust, so the re-read weighs each name as `_env_before()` does.
    - The re-read replaced eval's older string-runner reading instead of
      adding to it, so `eval 'git -c alias.p=push p origin HEAD'` -- the
      founder's open git-alias fork at top level, but refused under `eval`
      by that reading before gate8c -- was allowed. Fixed: both readings
      apply, so gate8c refuses nothing the hook before it refused. The cost
      of that is the older reading's own, unchanged by this round: an `eval`
      string that names push as a word stays refused whatever it does
      (`eval 'git push origin feat/x'`, `eval 'echo "do not push"'`) -- the
      first build had allowed both, and pinned the first as an allowed twin;
      that twin is withdrawn, and whether to allow such strings again (and
      reopen the alias shape under `eval`) is left for the founder.
    - Found by the same last call and NOT closed, since neither is the
      default/alternate-value text the founder's word names, each measured
      moving `main` and allowed before and after this round: a pattern-
      substitution replacement holding push (`G=x; ${G/x/git push} origin
      HEAD`), an indirect expansion (`P='git push'; G=P; ${!G} origin
      HEAD`), a value assigned by `${G:=...}` in an earlier statement (`:
      ${G:=git push}; $G origin HEAD`, the gate-r6 "value set any way but a
      plain `NAME=value`" residual), and `builtin eval 'git push origin
      HEAD'` (a program on neither list, the round-6 residual (4)). Left for
      the founder.
  - Pinned: `test_gate8c_last_call_shapes_are_real_pushes_the_hook_now_stops`
    (5 bash shapes, real pushes against a local bare origin, refused gated
    with main unmoved) and
    `test_gate8c_eval_joins_its_arguments_before_re_reading_them` (the
    two-argument join, proven the same way);
    `test_gate8c_last_call_eval_shapes_are_real_pushes_the_hook_now_stops`
    (the last call's 8 `eval` shapes: each moves `main` ungated, is allowed
    and moves `main` under the first build, reconstructed by
    `_GATE8C_FIRST_BUILD`, and is refused with `main` unmoved by this hook);
    `test_gate8c_residual_four_boundary_still_refused` pins the round-6
    residual (4) boundary case separately, still refused, not an allowed
    twin; `test_gate8c_allowed_twins` pins 10 twins at exit 0, the founder's
    named `ssh-agent` twin among them, alone and beside an assignment; 10
    new `HOOK_MUTATIONS` cases (6 in the first build, 4 from the last call:
    the re-read without the command's assignments, eval's own prefix read
    as after it, a name first assigned after the `eval` trusted, and the
    older reading dropped), each checked to flip its scenario's exit.
    Reconstructing the gate-r7 "first
    cut" for `test_r7_unrecognised_wrapper_shapes_are_refused_live_against_a_local_bare_origin`
    now also strips gate8c's `eval` branch (`_R7_FIRST_CUT`), or the
    reconstruction of a hook that predates gate8c by months would carry
    gate8c's protection backwards and no longer reproduce the gap that
    round's fix closed; two older r8 `HOOK_MUTATIONS` entries
    (`r8_word_unresolved`, `r8_word_substitution_push`) are re-targeted at
    `_whole_word_holds_push()`, the line they mutate having moved into it
    by this round's refactor, with the same scenario commands, both
    re-verified to still flip; one gate-r7 `HOOK_MUTATIONS` entry
    (`r7_string_runner`) is re-targeted from `eval 'git push origin HEAD'`
    to `watch 'git push origin HEAD'`, since eval's re-read refuses that
    shape whatever the generic `reads_strings` code that entry mutates says
    -- `watch` is read only by that code.
  - Re-measured on this round's own tree, after the last call's
    corrections: `test_require_pr_audit.py` 653 passed (618 before this
    round, 639 at the first build), 157 `test_hook_mutations_are_killed`
    cases all killed (147 before, 10 new); the full `ci.yml` scripts/ step
    984 passed (949 before, 970 at the first build); `test_pr_audit_gate.py` 103,
    unchanged. The CLAIMS row `ADR-0090-GATE-R8-UNREADABLE-AND-EXPANDED-PUSH`
    re-measured with 14 more shapes (11 refused, 3 allowed): holds on this
    hook, and exits 1 on the hook before this round and on the first build.
    The transcript replay was re-run on the 80,100 recorded Bash commands
    of gate-r8's replay: the hook before this round, the first build and
    this one give identical verdicts on every command (389 refused), so
    neither road changes a verdict on any command recorded here. Not done,
    as before: no branch-protection or live-repo verification; this round's
    shapes are measured under bash 5.3 only; `timeout` is not installed on
    this machine.

### Amendment — 2026-09-17, founder pipeline redesign

**Founder decision, verbatim, in the main session:** *"change ADR 90 to be a
better pipeline, 1 opus starts -> stops -> 2 sonnet handles opus's plan-> opus
takes final say."*

This replaces the pipeline below (3 Opus auditor angles fanned out in
parallel, plus a mandatory Opus adversarial pass on any approve-leaning
verdict) with:

1. **One Opus planner** (`pr-merge-planner`) reads the SHA-pinned PR bundle
   (diff, CI state, gate-owned-path check) and writes an audit plan — risk
   surface plus two reviewer angles, correctness/regression/decision-compliance
   and security/adversarial counterexamples, each with files, commands and
   BLOCK criteria — then stops. It does not approve anything on this call
   (`PLAN: READY` / `PLAN: BLOCK`).
2. **Two Sonnet reviewers run that plan in parallel, independently** —
   `pr-merge-auditor` (correctness/regression/decision-compliance) and
   `pr-merge-adversary` (security/adversarial counterexamples). Neither sees
   the other's report; neither waits for the other. The plan is guidance, not
   a cap on either reviewer's research or a license to suppress contradictory
   evidence.
3. **The SAME Opus planner is resumed** with both complete reports and gives
   final say. Only a complete final `VERDICT: HOLDS` permits PASS. Any
   reviewer BLOCK, an incomplete report from either reviewer, or an
   unparseable verdict anywhere in the chain blocks — the resumed planner
   cannot override a reviewer BLOCK.

**Why.** [[agent-dispatch-hardness-threshold]] (ADR 0050) scores model choice
on judgment-and-consequence, not mechanical effort, with an override to Opus
for production/ADR/outward-send work. Planning the audit and rendering final
judgment on a merge that ships to production unattended is exactly that class
of consequential, hard-to-reverse judgment — it stays Opus, on both ends of
the chain. Independently executing an already-scoped research plan against a
diff and CI evidence — trace this call path, check this file, run this
command, report BLOCK or APPROVE against stated criteria — is bounded
investigation with a checkable output, ADR 0050's Sonnet tier. Net: three
roles, up to four model calls (two Opus, two Sonnet) in place of the prior
four Opus calls (three angles + adversary) for the same PR — a stated cost
tradeoff, not a claim of equivalent defect detection. See "What's tracked"
below for what validates or overturns that tradeoff.

**What stays, unchanged from the Decision below.** CI must already be green
before any model call runs (`SKILL.md` step 2 — this audit is a semantic
layer on top of green CI, never a replacement for it). A diff touching the
gate's own owned paths (`_GATE_OWNED_PATHS`, mirrored in
`.claude/skills/pr-audit-gate/SKILL.md` step 4, now also naming
`.planning/decisions/0050-*.md`) [2026-09-18: replaced by `gate_ownership()` —
see the amendment above] still force-escalates to BLOCK and the
founder regardless of what any reviewer or the planner concludes — the gate
still cannot self-clear a PR that modifies itself. The marker contract is
unchanged: a PR comment carrying the exact
`<!-- pr-audit-gate: pr=<n> sha=<sha> verdict=PASS|BLOCK -->` line for the
PR's *current* head SHA is what `require_pr_audit.py` checks, never a
committed file. Merge is still
`gh pr merge <n> --squash --match-head-commit <audited-full-sha>` — never
`--auto` (races an unaudited later push past this exact-SHA audit) and never
`--admin`.

**What this amendment does NOT touch.** Scope is the three
`.claude/agents/pr-merge-*.md` definitions and
`.claude/skills/pr-audit-gate/SKILL.md` only, per the founder's session-scoped
authorization — not `CLAUDE.md`, not `.github/workflows/`, not
`scripts/pr_audit_gate.py`. The CI-side half of this gate
(`.github/workflows/pr-audit-gate.yml` / `scripts/pr_audit_gate.py`) is left
exactly as it was and still describes and runs the OLD three-Opus-angle-plus-
adversary composition (see that script's own module docstring) — this is a
real, documented divergence between the two paths, not a claim they match.
In practice this is not live drift today: `PR Audit Gate` has never been one
of `main`'s required status contexts (unchanged — see "What this does NOT
yet do" below), and the account behind its `ANTHROPIC_API_KEY` has had no
credit since 2026-09-12, so a CI run of that path currently fails closed or
reports COULD NOT RUN rather than actually auditing anything either
composition. Bringing the CI script onto this pipeline, restoring its
credit, or making it a required check are all separate, un-started pieces of
work — named here so this amendment is not read as having quietly done any
of the three.

**What's tracked to validate the tradeoff.** Same discipline the Decision's
own Review trail already runs on: a Sonnet reviewer's BLOCK that the resumed
Opus planner overturns without new evidence, or a production incident that
passed this pipeline, are both grounds to revisit the tier split
specifically — not evidence to reopen the whole gate. See ADR 0050's own
2026-09-17 amendment bracket for the corresponding model-routing change.

Historical context, and the pipeline this amendment supersedes, follow.

The founder asked for a standing gate: before any PR merges to `main`, an
Opus-based audit (originally asked as "Sonnet max"; corrected same day — see
Decision) reviews the CI reports and diff, and on approval the PR merges and ships to
production with **no human confirming in the moment**. This repo currently has ~90
concurrent branches/worktrees in flight (`git worktree list` at time of writing, ~628
refs seen by the ADR-number guard) — the volume that makes a manual per-PR review step
a real bottleneck, and the reason this is worth building rather than deferring.

Two things made this a decision rather than a build:

1. `main`'s branch protection ([[main-is-branch-protected]]) requires 5 status
   contexts and has `enforce_admins: false`, `required_pull_request_reviews` unset —
   i.e. **no human-review approval is currently required by GitHub itself**, only
   green checks. So "no human click" does not require overriding a review
   requirement — it only has to not use `--admin` and not skip the existing checks.
2. [[merge-races-need-sequencing]] says escalate to the founder, never `--admin`. An
   autonomous-merge gate has to be built to the same rule it would otherwise be
   tempted to break the moment its own audit is slow.

Real past instances this class of gate targets — not speculative (foundation §3.3):

- **Gateway crash-loop** (`.github/workflows/ci.yml:108-149`, `gateway-boot` job
  added 2026-08-24): `PosHubModule`/`AnalyticsModule` guarded controllers with
  `JwtAuthGuard` without importing `AuthModule`. `tsc --noEmit` was clean and 780
  Jest tests passed; nothing caught it until production did. Narrow, per-defect CI
  checks are added *after* the fact — a holistic reviewer reading the diff against
  Nest's actual module graph is the shape of check that could have caught it
  *before* a dedicated script existed for this exact defect.
- **OAuth self-provision hole** ([[oauth-self-provision-hole]], fixed PR #179):
  Google sign-in minted managers of a real tenant. Shipped with green CI; a
  security-focused reading of the auth diff is exactly the angle that class of bug
  needs and no existing CI job independently covers.

Neither instance proves an LLM audit would have caught it — that's not knowable in
reverse. What they show is the same failure shape recurring: checks that pass
individually while the thing they don't individually cover reaches production.

## Options considered

1. **Claude Code skill + hook only.** Cheap, fast, uses the Agent tool's real
   subagent fan-out. Only fires when I (Claude) am the one merging — does nothing
   for a push or a GitHub-UI merge that happens without a Claude Code session
   driving it.
2. **GitHub Actions required check only.** Enforces for every path (any pusher, the
   GitHub UI, another tool) via a real CI job calling the Anthropic API directly.
   Needs `ANTHROPIC_API_KEY` as an Actions secret (does not exist yet — the founder
   has to add it; entering secrets is not something I do) and cannot use the Agent
   tool's subagent framework — it has to re-implement the fan-out as sequential API
   calls.
3. **Both (chosen).** The Claude-side hook is the fast path for sessions like this
   one; the Actions workflow is the backstop that holds regardless of who or what is
   merging. Costs: two implementations of the same audit logic that can drift, and
   the Actions path needs a secret only the founder can provision.
4. *(Doing nothing — keep merges manually reviewed.)* Costs the founder a
   per-PR bottleneck at the current concurrency (dozens of live branches); this is
   exactly the volume the founder asked to remove themselves from.

A related, narrower fork inside option 3: should the Actions check be added to
`main`'s **required** status contexts? That PATCH is a persistent-configuration
change to branch protection, which this session does not make without the founder's
explicit go — see "What this does NOT yet do" below. Until that PATCH runs, the
Actions job is advisory (it still posts findings and still auto-merges on PASS via
its own logic) but not a hard GitHub-level block for a path that bypasses it
entirely (e.g. someone merges manually before the job finishes).

## Decision

Ship both layers, gated on the founder's two live answers ("both" locations, "fully
autonomous" merge), with the autonomy scoped as narrowly as those answers allow:

- **Claude Code side:** `.claude/skills/pr-audit-gate/SKILL.md` orchestrates 3
  auditor subagents (`.claude/agents/pr-merge-auditor.md`, fanned out across
  correctness/regression, CLAUDE.md-and-ADR compliance, and
  security/blast-radius angles) plus a mandatory adversarial pass
  (`.claude/agents/pr-merge-adversary.md`) on any approve-leaning verdict — the
  fan-out-then-adversary shape CLAUDE.md §3 already requires for any decision this
  weighty. A `PreToolUse` hook (`scripts/hooks/require_pr_audit.py`) blocks any
  Bash call shaped like `gh pr merge` or a direct push to `main` unless a passing
  audit report exists for that exact PR head SHA — this is the "you call it, make it
  a constraint" half of the request. Precision on what kind of constraint (fifth
  audit, security angle, note 6): the trusted-author set includes whoever is running
  `gh` locally, so nothing code-level stops a session from posting a marker without
  having actually done the work and then merging — the hook proves *some* marker
  exists for this exact PR+SHA, not that a genuine audit produced it. This is
  procedural, not cryptographic: it holds as long as the session follows this
  skill's actual steps, the same trust basis every other instruction in this repo
  runs on.
- **CI side:** `.github/workflows/pr-audit-gate.yml` runs the same fan-out as
  four Anthropic Messages API calls (`scripts/pr_audit_gate.py`), gated on
  `main`'s required status contexts — read fresh from branch protection on
  every run, never hardcoded, since that list moved from 5 to 3 while this ADR
  was still open — having already gone green (this is a semantic layer on top
  of green CI, never a replacement for it). On approval it runs
  `gh pr merge --auto --squash` — GitHub's native auto-merge, which waits on the
  pre-existing required contexts and never uses `--admin`. On any error (API
  failure, can't reach the reports, ambiguous verdict) it fails closed: no merge,
  and the PR comment says so in words, never a silent green
  ([[absence-reported-as-health]] — a check that can't verify must not read as
  health).
- **Corrected, sixth audit round:** only the Claude-Code path still writes
  `.planning/07-reference/pr-audits/` (a convenience copy, not what's
  checked). The CI path never did once the report-shape design changed
  (see the third Correction) — its full report lives only in the PR
  comment, which is the actual durable record for that path.

**Model corrected from "Sonnet max" to Opus, same day, before merge.** The
original ask specified Sonnet at maximum reasoning effort. [[agent-dispatch-hardness-threshold]]
(ADR 0050, locked) already answers this: it scores model dispatch on judgment +
consequence, ≤3 Sonnet / ≥4 Opus, with an explicit override to Opus for
**auth, production, ADRs, or outward sends** — and "never score effort" as a
substitute for the tier the consequence calls for. This role hits three of
those four overrides at once (it is itself an ADR's implementation, it decides
what reaches production, and its output is an outward send — a merge + deploy).
Sonnet-at-max-effort was not a defensible reading of the repo's own locked
dispatch rule; Opus is. Within Opus, effort is set to **high** rather than
"max": ADR 0050 governs model *tier*, not effort, and a per-PR CI gate calling
this on every push needs a bounded, predictable latency/cost — "high" is the
practical ceiling, not "max" run unboundedly on every merge forever. Both
agent definitions carry `reasoning_effort: high` in frontmatter as a
best-effort signal (harmless if the harness ignores unknown frontmatter keys);
the mapping from "high" to a concrete effort knob is not documented where I
could verify it. The CI-side script requests extended thinking with a bounded
token budget as the closest verifiable equivalent. This is stated as a
limitation, not a verified guarantee.

## Consequences

- What becomes easier: PRs merge without the founder in the loop, at the
  concurrency this repo is actually running.
- What becomes harder / given up: a bad audit call now ships to production
  unattended. The adversarial pass and fail-closed error handling are the
  mitigations; they are not a proof of safety.
- **What this does NOT yet do, as of the 2026-09-03 merge:** it does not add
  `PR Audit Gate` to `main`'s required status contexts. That PATCH is a
  persistent branch-protection change needing explicit founder permission per
  this session's operating rules — still not run, still open, tracked
  alongside this ADR in `SKILL.md`'s "Known limitations". Until it lands, the
  CI half posts findings and attempts its own SHA-pinned merge on PASS, but
  nothing stops a merge that bypasses this workflow entirely — only the
  Claude-side hook is a hard constraint, and only inside a Claude Code session.
  (The `ANTHROPIC_API_KEY` Actions secret half of this gap is closed — added
  2026-09-02, confirmed live by this gate's own first real run against PR #261.)
- **Correction, second live audit (2026-09-03):** the line above originally
  claimed fork PRs can't see this secret, true of `pull_request` (ADR 0072's
  precedent) and carried over unchanged when this workflow moved to
  `pull_request_target` for the self-audit fix — which is exactly backwards
  for that trigger. This repo is confirmed **public, 0 forks**
  (`gh repo view`), so `pull_request_target` runs with the full base-repo
  token and secrets for a PR from **any** GitHub account, not only forks.
  Exposure stays bounded (checkout is pinned to base, no external code
  executes, branch protection still blocks an outside merge), but an
  unrelated account could trigger API spend at will — closed with an
  `author_association` gate (OWNER/MEMBER/COLLABORATOR only) in the
  workflow, evaluated from the trusted event payload, not the PR's content.
- Four ADR-number collisions (0012, 0013, 0028, 0049) exist across the ~628 refs
  the numbering guard swept — pre-existing, not caused by this decision, flagged
  separately rather than fixed here (out of this operation's scope).
- Signal that would trigger revisiting this: a BLOCK verdict that a human review
  would have overturned (over-blocking), or one confirmed production incident that
  passed this gate (under-blocking) — either is grounds to reopen the "fully
  autonomous" half of this decision specifically, not the whole gate.

## Correction — 2026-09-03, found by the gate's own first real audit

Run 33695630472 (PR #261's own `PR Audit Gate` check, first run with a working
`ANTHROPIC_API_KEY`) BLOCKed on both correctness and security, having audited
the PR that introduces this exact ADR and its implementation. Real findings,
not hypothetical, fixed same day (see the commit that added this section):

1. **Security BLOCK — the gate audited its own, possibly-modified code.** The
   workflow was `on: pull_request` with default checkout (the PR's own tree)
   and `contents: write` + the live key in env. A same-repo PR editing
   `scripts/pr_audit_gate.py` could make the verdict parser always return
   PASS, self-merge, and exfiltrate the key on the way out — a same-repo
   mirror of the OAuth self-provisioning hole this ADR already cites, one
   layer up in CI. Fixed with `pull_request_target` + a checkout pinned to
   the base commit (the standard GitHub-documented fix for this exact "pwn
   request" class), plus a belt-and-suspenders check inside the now-trusted
   script: any diff touching the gate's own files force-BLOCKs with an
   explicit escalation note regardless of angle verdicts. This ADR's original
   "no migration, no auth FK, no tenant boundary — nothing to burn" framing
   for this class of change was wrong; a CI execution surface with write
   access and a secret is exactly that class of burn, just not a database one.
2. **Correctness BLOCK, livelock.** The skill instructed committing the
   report file, on the PR's own branch, immediately before the gated merge
   call — which changes the head SHA the hook's existence-check is keyed to,
   so the just-written report can never satisfy a check for the SHA it
   produces. Fixed by dropping the committed-file requirement: both
   enforcement paths now post a machine-readable
   `<!-- pr-audit-gate: pr=<n> sha=<sha> verdict=PASS|BLOCK -->` marker as a
   PR comment instead, which has no SHA-changing side effect.
3. **Correctness BLOCK, wrong-PR resolution.** The hook resolved "the PR to
   check" via the *current checkout's branch*, never the PR number in the
   command actually being gated — in this repo's ~90-worktree concurrency, a
   session on branch A could validate branch B's merge against A's own
   report. Fixed: the hook now parses the PR number out of the gated command.
4. **Correctness BLOCK, verdict bypass.** `"PASS" in line and "BLOCK" not in
   line` over the report's first 20 lines is a substring scan a BLOCK
   report's own prose could satisfy ("Upstream required contexts: all
   PASS"), green-lighting a merge the audit explicitly rejected — this
   repo's own `absence-reported-as-health` shape, found inside the guard
   written to prevent it. Fixed: the marker line from (2) is now the only
   thing either path is allowed to parse for a verdict.

None of the four are edge cases speculated into existence — all four are
concrete, traced failure scenarios the audit gave file:line citations for.
This is stated here rather than only in the fix commit because it changes a
claim the Decision section above makes: "fully autonomous merge" was shipped
with a path that could have been silently self-authorized by any same-repo PR
touching the gate's own files, for however long it took someone to notice.
It was noticed by the gate itself, on its own first real run, before this ADR
was locked — which is the argument for keeping the mandatory adversarial-pass
and multi-angle shape even where it is inconvenient, not evidence the shape
worked as designed (a BLOCK on the PR that introduces it is not the intended
happy path).

## Correction — 2026-09-03, found by the gate's own SECOND real audit

Re-running the (now fixed) gate against the fix from the correction above
found two more real defects in the fix itself, not new ground:

1. **The verdict-bypass class from correction #4 above was fixed in the
   wrong function.** `require_pr_audit.py`'s hook-side check got the strict
   marker line; `pr_audit_gate.py`'s own `_verdict_of()` — the function that
   actually decides `overall` and therefore whether `gh pr merge --auto`
   runs — still used the identical unanchored `re.search` (first match,
   case-insensitive substring) it was supposed to have replaced everywhere.
   Concretely: the adversary's prompt includes the three angle reports, each
   ending `VERDICT: APPROVE`; a model arguing against that verdict very
   naturally quotes it before delivering its own ("The three reviewers said
   VERDICT: APPROVE. I disagree... VERDICT: OVERTURNED") — and the old parser
   returned the quoted APPROVE, silently reversing a real OVERTURNED into a
   merge. A second bug rode along: alternation order (`APPROVE` tried before
   `APPROVE WITH NOTES`) matched the shorter alternative as a strict prefix,
   so every APPROVE WITH NOTES verdict was recorded as plain APPROVE. Fixed:
   `_verdict_of()` now requires the verdict on its own line (`(?m)^...$`)
   and takes the LAST match, matching what every prompt actually instructs
   ("end your response with a line exactly...") and the longer alternative
   listed first.
2. **The corrected "fork PRs can't see this secret" claim was never
   corrected for the trigger that made it wrong.** `pull_request_target`
   (the fix in the first correction) runs with the base repo's full token
   and secrets for every triggering event — not only forks, and this repo
   is confirmed public with 0 forks, so in practice **any GitHub account**
   could trigger a job holding `contents: write` + the live key. No code
   execution path exists for that account to exploit (checkout stays pinned
   to base), so this was not re-opening the self-audit hole — but it is a
   real, live cost/attention-griefing surface the ADR's own words denied.
   Closed with an `author_association` gate (OWNER/MEMBER/COLLABORATOR),
   evaluated from the trusted event payload rather than PR content.

Both were found by three fresh Opus subagents run through the actual
Claude-Code-side skill (not the CI path — `pull_request_target` cannot audit
the PR that introduces it, by design, see the workflow file) against PR #261
directly, per ADR 0090's own procedure. The security angle traced (1) with a
concrete constructed input and confirmed it against the live parser before
reporting it; this session verified the same construction independently
before fixing it, rather than fixing on the subagent's word alone.

## Correction — 2026-09-03, found by the gate's own THIRD real audit

A fourth full audit round (all three angles fresh, run against the fixes
above) returned BLOCK on all three. Six defects, four of them the identical
class recurring a third time — a decision made by a deny-list or a scan
looser than the thing it decided:

1. **`overall`'s two decisions were both deny-lists.** `"BLOCK" if
   adv_verdict in ("OVERTURNED", "UNPARSEABLE") else "PASS"` treats the
   adversary literally answering the word `BLOCK` — a real, parseable value,
   and the exact wording `pr-merge-adversary.md` itself models
   ("OVERTURNED — BLOCK") — as anything-other-than-those-two-strings, which
   is PASS. **Confirmed by executing the real function**: `adv_verdict =
   "BLOCK"` produced `overall = "PASS"`. The angle-level check had the mirror
   gap (an angle answering OVERTURNED/HOLDS by mistake wasn't blocked
   either). Both are now allow-lists: only `HOLDS` passes the adversary;
   only `APPROVE`/`APPROVE WITH NOTES` pass an angle.
2. **`_verdict_of()`'s round-2 fix (anchor + last-match) was still a scan.**
   Any trailing quoted/appendix verdict line won on last-match, and a
   decorated line (`**VERDICT: X**`, `` `VERDICT: X` `` — the system prompt
   itself modeled the backtick form) never matched the anchor at all,
   silently falling back to an earlier undecorated match. **Confirmed by
   execution** against constructed inputs matching both shapes. Rewritten to
   inspect ONLY the response's actual last non-blank line (never a text-wide
   scan), with common decoration stripped before matching.
3. **The marker check (require_pr_audit.py) was unauthenticated.**
   **Confirmed by executing the real hook** with a shimmed comment authored
   by an unrelated account: exit 0, merge allowed. This repo is public with
   one collaborator (the founder); anyone could read a PR's head SHA off the
   page and post a forged marker. Now checks comment author against the CI
   bot plus whoever is running `gh` locally, and matches the marker only at
   a comment's own start (`.match()`, not `.search()`/`.finditer()`) — a
   trusted comment's own embedded report can legitimately discuss marker
   syntax with real-looking values without that counting.
4. **`gh pr merge --auto` races an unaudited later commit.** `--auto` arms
   GitHub's auto-merge against the PR, not the SHA that passed audit; a push
   landing after PASS but before the actual merge could go through once the
   *other* required checks are green, with this gate's own re-run for that
   new commit reduced to an advisory red check nobody has to look at. Fixed
   by merging immediately with an exact-`sha`-pinned `gh api .../merge` call
   instead — GitHub refuses (409) if the head has moved, so the failure mode
   is "don't merge, say why," not "silently merge the wrong commit."
5. **`wait_upstream`'s pass/fail split was a deny-list too** — `TIMED_OUT`,
   `ACTION_REQUIRED`, `STARTUP_FAILURE`, `NEUTRAL`, `STALE` are real
   check-run conclusions that were neither "pending" nor "failed" in the old
   lists, falling through to green by default. Now an allow-list: only
   `SUCCESS` is green.
6. **Two smaller, real gaps from the same session, not the fourth audit:**
   `MERGE_PATTERN` only captured a PR number immediately after "merge" —
   `gh pr merge --squash 42` fell back to the current-branch resolver, the
   exact bug correction #1 already fixed once; and `DIRECT_PUSH_PATTERN`'s
   `\s*$` anchor (added to kill a false-positive) meant `git push origin
   main --force` — the single most consequential form — evaded it entirely.
   Both fixed; `gh pr diff --name-only`'s unchecked returncode (silently
   `touches_own_gate = False` on failure) also closed, failing toward
   escalation rather than away from it.

A `--self-test` mode now pins the exact adversarial inputs across all three
audits (`python3 scripts/pr_audit_gate.py --self-test`, wired as a required
step in the workflow before anything else runs) — named directly in the
prior Correction's own text as the gap that let this class survive three
rounds: *"zero tests and zero guard for the single function that has now
decided a merge wrongly twice."* It had decided a merge wrongly a third
time by the point this was written.

## Correction — 2026-09-03, found by the gate's own FOURTH real audit

Correctness and security run fresh a fourth time (compliance skipped this
round — its findings are documentation-severity and the third round's were
already fully addressed). Both returned BLOCK, on two findings neither
prior round reached — one of them the most consequential in this ADR.

1. **The CI-side merge silently removes the post-merge deploy audit.**
   Confirmed against GitHub's own documented behavior, not reasoned about:
   a push made with the built-in Actions `GITHUB_TOKEN` does not trigger a
   *new* workflow run (recursion suppression; the two documented exceptions
   are `workflow_dispatch`/`repository_dispatch`). The CI-side merge step
   uses exactly that token. So `ci.yml`'s `on: push` for a gate-driven merge
   never fires, and `deploy.yml`'s `workflow_run: workflows: ["CI"]`
   trigger — the post-merge health/deploy audit [[production-deploy-verification]]
   and ADR 0085 exist because CI alone can't see a DI failure — never fires
   either. Not skipped, not red: **no run at all**, for a merge this repo
   already built a whole finding ([[absence-reported-as-health]]) around not
   letting happen quietly. Confirmed against this repo's actual history:
   every merge to `main` to date is founder-identity (`web-flow`), so this
   path had never once been exercised before this ADR's own gate. Fixed by
   adding a `workflow_dispatch:` trigger to `ci.yml` (purely additive — does
   not change push/pull_request behavior) and having the CI-side merge step
   explicitly `gh workflow run ci.yml --ref main` right after a successful
   merge, re-entering the chain through the one path GITHUB_TOKEN doesn't
   suppress. Fails LOUD on failure (stderr + PR comment), not closed — there
   is no clean rollback for "the merge already happened but we couldn't
   confirm CI re-ran." **The Claude-Code-side merge path was never affected**
   — it pushes under the session's own `gh auth` identity, not GITHUB_TOKEN,
   which is exactly why the repo's whole merge history to date looks the way
   it does; noted explicitly in SKILL.md so this isn't fixed twice.
2. **The repo-wide hook both over-blocked and under-blocked, confirmed by
   execution.** `DIRECT_PUSH_PATTERN`'s exclusion set didn't exclude
   newlines, so it spanned across separate statements in a multi-line
   command — `git push origin feat/x` followed on a new line by
   `gh pr create --base main --fill` was wrongly BLOCKED because "main"
   appeared on the *second* line. The mirror gap: `\bgit\s+push\b` requires
   "push" immediately after "git", so `git -C <worktree> push origin main`
   — the natural form in this repo's own stated ~90-worktree concurrency —
   was **not** matched at all, letting a real direct push to `main` through
   undetected. Both fixed (newline excluded from the scan; an optional
   `-C <path>` allowed between "git" and "push"). Separately: the CI bot's
   trusted-author entry (round 3) held the REST API spelling
   ("github-actions[bot]"), but this hook calls `gh pr view --json comments`
   (GraphQL-backed), which returns the login *without* the suffix —
   confirmed by execution, the hook trusted **no** comment the CI bot ever
   posted. Fail-closed (safe), but broke the CI half of the gate outright.
   Both spellings now trusted, with the mismatch's own risk named rather
   than assumed permanent.
3. **The diff-truncation gap the third round's correctness angle didn't
   reach.** `bundle` capped the diff at 60,000 chars and asked the model, in
   prose, to note the limitation — `overall` never consulted whether
   truncation happened. Confirmed by harness-executing the real
   `_run_audit_inner` with a synthetic 68,770-char diff carrying a planted
   regression past the cut: the auditor never saw it, dutifully noted the
   truncation, approved what it could see, and the function issued a real
   `gh api .../merge` call. Measured against this repo's actual PRs: 10 of
   the last 20 merged exceed 60,000 chars, including this PR's own two gate
   scripts sitting past the old cut. Fixed two ways: the budget raised to
   300,000 chars (shrinks how often this fires at all), and — for whenever
   it still does — `truncation_occurred` now force-BLOCKs exactly like
   `touches_own_gate`, deterministically, never left as a sentence in a
   prompt. `escalation_note` (round 3's own omission, also closed this
   round) is now written into the archived report as well as the comment,
   so a BLOCK's *reason* survives if the comment thread is ever pruned.
4. **Two smaller closes, same round:** `gh pr comment`'s returncode was
   unchecked before merging — a failed post meant a PASS could ship with no
   durable record at all; now refuses to merge if the comment didn't land.
   `wait_upstream`'s timeout path returned exit 0, so a run that gave up
   waiting (never confirmed upstream either way) looked identical to a run
   that legitimately had nothing to say — now exits 1, distinct from the
   "a required check is genuinely, confirmedly red" case, which correctly
   stays a benign 0.

Every BLOCK above was reproduced against the real functions before being
accepted, not taken from the subagents' prose. `--self-test` grew from 17 to
24 invariants covering all of it.

## Correction — 2026-09-03, found by the gate's own FIFTH real audit

A verification round (correctness + security, fresh Opus subagents) re-tested
round 4's three fixes by trying to defeat them rather than confirming they
exist. Two hold. **The headline fix — the GITHUB_TOKEN deploy-chain
workaround — does not work at all**, found independently by both angles:

1. **The `workflow_dispatch` re-trigger 403s on every single run.**
   `.github/workflows/pr-audit-gate.yml`'s `permissions:` block granted
   `contents: write`, `pull-requests: write`, `checks: read` — no `actions:`
   scope, which `gh workflow run` (and even looking the workflow up) requires.
   GitHub's own rule: specifying a `permissions:` block sets every unlisted
   scope to `none`. This repo already knew the shape — `deploy.yml` declares
   `actions: write` for the identical `gh workflow run` call it makes.
   **Confirmed by execution** (both angles, independently): the dispatch call
   403s every time; the merge (already irreversible) still succeeds; the
   dispatch failure was caught and reported — but the function returned 0,
   so the JOB showed green having merged code with its own safety mechanism
   silently non-functional. Self-caught between rounds 4 and 5, before either
   agent's report arrived: `actions: write` added to the permissions block,
   and the dispatch-failure path now returns 1 (a merge with a confirmed-
   failed post-merge check must not report as a successful job, even though
   the merge itself can't be undone).
2. **Round 4's own `\n`-exclusion fix regressed a real case.** Excluding
   newlines from `DIRECT_PUSH_PATTERN`'s scan fixed the multi-*statement*
   false-positive but broke the multi-*line-same-statement* case — a plain
   backslash line continuation (`git push \` + newline + `  origin main`)
   stopped matching at all. Fixed by normalizing backslash-newline
   continuations to a single space before matching, rather than encoding
   "this newline doesn't end the statement" into the regex itself; bare
   newlines (no preceding backslash) still correctly act as a boundary.
   Also widened the trailing match to accept `;` and a quoted ref
   (`git push origin main;` / `git push origin 'main'` previously fell
   through since neither whitespace nor end-of-string followed "main").
3. **Smaller, real, folded in the same round:** `MAX_TOKENS` raised
   12000 → 16000 — with a large diff and "high" adaptive-thinking effort,
   the model's own reasoning could consume the output budget before
   reaching its final `VERDICT:` line, correctly failing to `UNPARSEABLE` →
   BLOCK (safe direction) but false-blocking a large, genuinely fine PR on
   token exhaustion rather than its content; confirmed the diff budget
   itself (300,000 chars) is safe against `claude-opus-5`'s real 1M-token
   context, well past the 200K this session had assumed. `.github/workflows/ci.yml`
   added to both owned-path lists — it now carries a dependency (the
   `workflow_dispatch:` trigger) the merge step relies on, and neither list
   named it. `_redact` extended to `github_pat_`. The ADR's own "I cannot
   skip it from inside a session" (this section, above) overstated the
   guarantee — corrected in place to say what the hook actually proves
   (a marker exists for this PR+SHA) versus what it can't (that a genuine
   audit produced it) — procedural, not cryptographic, same as this repo's
   [[decision-register-rots]] finding.

`--self-test` grown 24 → 29. Two residual, explicitly non-blocking items
both angles agreed on and left named rather than silently accepted: the
Claude-Code-side merge (`gh pr merge --squash`) stays unpinned to an exact
SHA, unlike the CI side's `gh api` call — same class as round 3's fix, a
far smaller window (seconds inside one live session, not a CI queue); and
`_extract_pr_number` can still mis-resolve a PR number when a `gh pr merge`
flag takes a purely-numeric value ahead of the real positional argument — a
contrived shape, not a realistic `gh pr merge` invocation today, named
rather than engineered around given the "loose regex, known limitation"
design already stated for this whole hook.

## Correction — 2026-09-03, found by the gate's own SIXTH real audit (final round of the introducing PR's own self-audit — see the seventh and eighth Corrections below for later, differently-sourced fixes)

A closing round, deliberately scoped as one combined correctness+security
pass rather than three separate angles, explicitly asked to try to defeat
the parsers/hook one more time and to say plainly if nothing real turned
up. Its own words: *"Had the workflow-level finding not existed, my honest
answer would have been APPROVE… this surface has genuinely converged."*
17 new adversarial shapes against `_verdict_of`, 20 against
`DIRECT_PUSH_PATTERN`, more against `MARKER_RE` and `_extract_pr_number` —
all held; the 4 `DIRECT_PUSH_PATTERN` misses found are the exact global-git-
flag gap already named in that file's own comment.

One real finding, in a layer no prior round had audited: **the YAML that
*consumes* `wait_upstream`'s return value, not the Python that produces
it.** `wait_upstream` returning 0 on a *confirmed* red required check (kept
that way by round 4, which fixed only the *timeout* branch to exit 1,
reasoning the confirmed-red case was "legitimate, known-good, nothing to
say") meant the "Wait for the existing required checks" step succeeds, the
"Run the PR audit gate" step correctly SKIPS, and every step having
succeeded-or-skipped, **the JOB's own conclusion is `success`** — for a run
that audited nothing at all. Confirmed against this PR's own run
33693914368. Harmless today only because this check is not yet required;
the instant it is (the branch-protection PATCH this ADR has deferred to the
founder throughout), a required context reading SUCCESS while never having
audited anything is exactly the fault class this file's own NEVER VACUOUS
header exists to prevent — round 4's reasoning for the distinction didn't
survive contact with how GitHub actually evaluates a required check (it
asks "is there a successful run of this name for the current SHA," not
"did that run's job actually do the thing its name claims"). Fixed:
`wait_upstream` now exits 1 for a confirmed-red required check too, the
same as the timeout case — every non-SUCCESS path agrees now: don't merge,
and don't let the JOB look like it had something to say when it didn't.

Also closed the same round: this document's own drift after five prior
Corrections — the "both write the same report shape" line (no longer true;
only the Claude-Code path still writes `.planning/07-reference/pr-audits/`,
corrected in place above) and the Review-trail table, which had fallen two
rows behind its own Correction count (fixed by this edit).

## Correction — 2026-09-04, found by live incident forensics, not an audit round

The sixth round's "genuinely converged" held for the parsers and the hook —
it did not hold for `wait_upstream`'s red branch, and this was not found by
an Opus auditor at all. It was found the way this repo's `absence-reported-
as-health` finding says most of these are found: production kept doing it.
Confirmed on **four** separate PRs before this correction was written: two
peer sessions independently reported the same shape on **#288** and **#294**
(`Upstream red: ['CodeQL']` fired 93s into their runs, 2s and ~90s
respectively after CodeQL's own check-run had already completed SUCCESS);
this session's own **#291** hit it live during this exact investigation
(28s after CodeQL finished clean); and re-checking open PRs while writing
this correction turned up a fourth, independent instance already sitting on
**#290** (`docs: close out ADR 0090` — the very PR that would have closed
this document out, blocked by the bug it describes). All four cleared on
`gh run rerun --failed` with no code change, which is what a transient
misread predicts and a genuine failure would not.

**Root cause, confirmed by direct capture, not inferred:** the working
hypothesis going in was a *pending*-vocabulary gap — some interim
`status`/`conclusion` combination (`IN_PROGRESS`-adjacent) that the old
pending allow-list (`PENDING`, `IN_PROGRESS`, `QUEUED`) didn't name, so it
fell through to `failed`. That hypothesis was wrong, and this PR (#297)
proved it wrong against itself: polling
`repos/.../commits/<sha>/check-runs` directly (not just `gh pr checks`,
in case the gap was gh's own GraphQL mapping) every ~9s through this PR's
own CI run, the `CodeQL` check-run (app `github-advanced-security`,
distinct from the `Analyze Code (python/javascript)` matrix jobs that feed
it) was captured going through, on the **same** check-run and the **same**
`started_at`:

```
18:13:02Z  status=completed  conclusion=neutral
18:13:12Z  status=completed  conclusion=success   (10s later, same check-run)
```

`NEUTRAL` is not an interim status — it is a real, already-`completed`
**terminal** conclusion, and it is not a stale read of an old state:
GitHub's own Checks REST API, not just `gh pr checks`'s GraphQL rollup,
returned it. The code-scanning bridge that turns a matrix job's SARIF
upload into this aggregate check-run posts a `neutral` conclusion first —
plausibly a default it writes before the alert-processing step that
decides the real verdict — and corrects it to the true conclusion within
about ten seconds, without changing `completed_at`. `_classify_poll`
correctly treats `NEUTRAL` as `failed`, and correctly so **in general**:
round 3's own fix exists because a check that concludes NEUTRAL for a real
reason (nothing to report) must not fall through to silently green. That
is exactly why **option 2 (allow-listing `NEUTRAL` as pending) was
considered and rejected**, not just skipped — it would have reopened the
precise bug round 3 fixed, for the next PR where a check-run's NEUTRAL
conclusion is genuine. The bug here was never in the vocabulary; it was in
trusting a single read of a value GitHub itself had not finished settling.

**Fix:** the green branch below has required the identical check SET on
two consecutive polls since `wait_upstream` was first written, for exactly
this class of reason (a check not yet scheduled is invisible, not
missing). The red branch had no equivalent protection. It now does:
`_confirmed_red()` requires the SAME non-empty failed set on two
consecutive polls before returning red; a set that clears or changes shape
between polls is logged but not trusted; a set that never stabilizes still
times out red via the existing deadline path, so the fail-closed property
this must not regress stayed intact — verified by keeping the "confirms on
2 identical polls" case in `--self-test` alongside the new "1 poll never
confirms" case. `_classify_poll` (the missing/pending/failed split) and
`_confirmed_red` (the new debounce) are both extracted as pure functions
`wait_upstream` calls and `--self-test` now calls directly too, closing a
smaller, adjacent gap: the self-test's own state-classifier check had been
a hand-retyped mirror of the real logic, not the real logic, since round 3
added it — agreement by construction, not by sharing code. `--self-test`
grown 29 → 35 invariants. A new `CLAIMS.jsonl` entry
(`ADR-0090`) pins that the printed invariant count and the actual number
of `check()` calls in the file stay equal, so this count cannot silently
drift the way this document's own Review-trail table already had to be
corrected once, in the sixth round above, for falling behind by two rows.

Fix PR: [#297](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/297)
— branch `fix/pr-audit-gate-red-debounce`. Like PR #261 before it, this PR
touches `scripts/pr_audit_gate.py`, one of this ADR's own
`_GATE_OWNED_PATHS`, so `touches_own_gate` force-escalates it to BLOCK
regardless of what the audit angles conclude — it needs the founder to
merge it directly, the same escalation path PR #261 needed and the sixth
Correction's Review-trail row above records.

**Merged 2026-09-06, same mechanism as PR #261.** `require_pr_audit.py`
correctly blocked a plain `gh pr merge 297` (no PASS marker exists for this
PR, by design — it never can, since `touches_own_gate` forces BLOCK
regardless of verdict). Founder authorized completing the merge directly in
this chat session; done via `gh api repos/.../pulls/297/merge`, SHA-pinned
to `c53cee6f7f8e0aea3c7dc7e7873e0f68dec4f646` (the head after resolving
main's concurrent merges of #290 and #291 into this branch), squash-merged
to `main` as `9a23abb6889dfcc6af443b8ccdd03ca1bbb694ec` — all five of
`main`'s actual required contexts green first (`CI Complete`, the beverage
identity/guest-merge/schema-parity checks); `PR Audit Gate` itself stayed
red throughout, as expected, since it is not one of those five required
contexts and audits from `main`'s pre-fix copy by design. `--self-test`
35/35 re-confirmed on the merged tree before merging, matching the count
`CLAIMS.jsonl`'s new entry pins.

**Addendum, same day:** a **fifth** live instance, on PR #297 itself, before
the fix above had even merged — `wait_upstream`'s own "Checkout the TRUSTED
base commit" step (by design, see the top of this file: a PR cannot rewrite
the code auditing it) ran the bug being fixed, from `main`, against the fix
PR that fixes it. `CodeQL` completed SUCCESS at 18:18:16Z; the unfixed code
declared "Upstream red: ['CodeQL']" at 18:18:46Z. Left as-is deliberately —
not re-run — as a fifth data point the same shape as the first four, and
because re-running it would only prove the OLD code again; the fix cannot
validate itself until it is on `main`.

## Correction — 2026-09-04, found by PR #291's security audit

Landed concurrently with the seventh Correction above (a different fix, by
a different session, discovered independently) — both PRs were open at once
and both cited themselves as "ADR 0090's seventh Correction" in their own
commit messages before either merged; this section is renumbered eighth to
resolve that collision, the same rule this repo already applies to a
colliding OD or ADR number: move the one with fewer citations elsewhere,
never leave two sections claiming the same ordinal.

Unlike the first six, this correction did not come from a round of the gate
auditing its own introducing PR — it came from the gate auditing an unrelated
PR ([PR #291](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/291),
`fix/deploy-check-path-scoped`, ADR 0097's path-scoped deploy check) whose
security angle noticed, in passing, that the gap it was about to hit itself
generalizes: **`_GATE_OWNED_PATHS` covered `.github/workflows/ci.yml` but not
`.github/workflows/deploy.yml`**, the post-merge production-deploy-verification
workflow ADR 0097 built. A PR that loosened `check_deployed_sha.py`'s
`--expect`, dropped a verification stage, or redefined what counts as
`provenance_verified` would have been evaluated as an ordinary PR and could
self-merge on three APPROVEs, even though it edits the only thing that proves
production actually got what merged — the same class of hole `ci.yml` was
added to close in the fifth Correction, just on the other workflow file. PR
#291's own report named this explicitly rather than silently working around
it or bundling the fix into an unrelated PR (which would itself have needed
this same escalation, for an unrelated reason) — flagged as its own follow-up.

Fixed: `.github/workflows/deploy.yml` added to `_GATE_OWNED_PATHS` in
`scripts/pr_audit_gate.py`, and to the matching list in
`.claude/skills/pr-audit-gate/SKILL.md` step 4 (kept in sync per the third
Correction's own note — they had drifted once before, over `CLAUDE.md`).
`--self-test` was checked for a case enumerating `_GATE_OWNED_PATHS`'s
contents; it has none (the escalation tests exercise the generic
`touches_own_gate` decision against a synthetic reason string, not the tuple
itself), so no test needed growing on this count alone — it grew to 35
anyway, via the seventh Correction's merge into this same branch. This PR,
editing `_GATE_OWNED_PATHS` itself, force-escalates under its own new rule —
per ADR 0090's design, it is not self-merged; the founder reviews and merges
it directly, the same path PR #261 and PR #297 both needed.

## Correction — 2026-09-12, found by the gate going red on every PR in the repository

**The symptom.** Every PR opened on 2026-09-12 carried a red `PR Audit Gate`,
for a reason that had nothing to do with any diff: `Upstream red: ['CodeQL']`,
confirmed on two consecutive polls. A gate that is red on everything is a gate
nobody reads, which is the same failure as one that is green on everything.

**The cause is two correct decisions meeting.** First, the seventh Correction
above fixed a real bug by making only an explicit `SUCCESS` green — the third
audit had found `TIMED_OUT`, `ACTION_REQUIRED`, `STARTUP_FAILURE`, `NEUTRAL` and
`STALE` all falling through to green by default. Second, `wait_upstream` cannot
read branch protection (`GITHUB_TOKEN` is deliberately never grantable
`administration` scope) and falls back to waiting for **every reported check**.
Put together: the `CodeQL` aggregate check-run concluded `NEUTRAL` — which is
what code scanning returns when the analysis ran and had nothing to say — and a
check that has never been a required context, and cannot block a merge, made this
job red. The seventh Correction's two-poll debounce did not help, because the
conclusion was not transient this time; it was simply what CodeQL had to say.

**Not fixed by softening the state allow-list.** A `TIMED_OUT` on a check that
really does gate a merge must still be red; that is the whole of the third
audit's finding and it stands. Fixed instead by not WAITING, **in fallback mode
only**, on checks that cannot block a merge in the first place: `CodeQL` and
`Dependabot` join `Vercel` and `Supabase` in `_FALLBACK_IGNORE_PREFIXES`. When
the required-contexts list is readable it is used verbatim and that tuple is not
consulted at all, so nothing here can hide a check that genuinely gates a merge.

The required list was **re-measured** the same day rather than carried forward,
and recorded in the code as a dated reading rather than as the state — it is a
dashboard setting, one person and one click, no commit and no diff:

```
["CI Complete", "Beverage identity key — SQL matches Python",
 "Guest merge policy — zero false merges", "Fresh database equals remote",
 "Code queries only relations production has"]
```

Neither `CodeQL` nor `Dependabot` appears. If either is ever made required it
must be removed from that tuple in the same change, and the comment beside it
says so.

**The selection is now a function, so the self-test runs the real thing.**
`_fallback_names()` was extracted from the inline comprehension for the same
reason `_classify_poll` was extracted in the seventh round: a hand-retyped mirror
in the test agrees with the code by construction rather than by sharing it.
`--self-test` grows 35 → 39, and the four new invariants pin both halves —
that fallback waits only on gating checks, that it never waits on itself, that a
`NEUTRAL` `CodeQL` no longer makes the gate red, **and that a `NEUTRAL` on a
check that IS waited for is still failed**. The last one is what stops this fix
from quietly becoming "NEUTRAL is fine everywhere". Proven by mutation: reverting
the tuple alone makes the suite exit 1 with "fallback waits only on checks that
can gate a merge: got ['CI Complete', 'CodeQL', 'Dependabot', ...]".

**A COULD NOT RUN now names its cause -- and the first version of this paragraph was wrong.**
Added the same day, raised by a peer session while this branch waited on `main`.
The account behind the repository's `ANTHROPIC_API_KEY` ran out of credit that
afternoon, so `_run_audit_inner` raised, the catch-all reached `_fail_closed`,
and the PR got a `COULD NOT RUN` comment whose prose carried "credit balance is
too low" but whose headline said nothing about it. An out-of-credit key never
clears and a rerun is an hour wasted; a rate limit clears on its own and a rerun
is the fix. A reader holding the headline alone cannot tell which they have.

`classify_cannot_check()` maps the reason to one of `no-credit`, `no-key`,
`rate-limited`, `empty-diff`, or **`unclassified`**, and the tag goes in the
local report, the PR comment headline and the stderr line. The comment body also
states outright that a COULD NOT RUN is a CANNOT CHECK -- not a BLOCK, not a
pass, nothing audited -- because the failure mode is a reader treating a red
gate as a finding about their own diff. `unclassified` is the load-bearing tag:
an unrecognised cause says it is unrecognised and that a rerun may or may not
help, rather than being sorted into the nearest known bucket.

**What the adversarial pass overturned, and it was right on all three.** The
first version of this change was committed as `0284c387` and an adversary
audited that commit alone. OVERTURNED:

1. **An `upstream-wait` tag that could never fire.** This paragraph first said
   the NEUTRAL-CodeQL red above and the credit red were two COULD NOT RUNs that
   the tag now told apart. False. `wait_upstream` never calls `_fail_closed`: on a confirmed-red or timed-out upstream it prints, writes
   `upstream_red`, returns 1, and the workflow skips the audit step -- **so no
   comment is posted at all.** [CORRECTED 2026-09-12 by the second adversarial pass: this first said it also never raises. It can -- `_gh_json` raises on a failed gh call -- but `main()` has no catch, so the step fails with a traceback, the audit step is skipped, and still no comment is posted.] The two were already distinguishable, by whether
   a comment exists. The tag was removed rather than kept as decoration, and the
   self-test's claim that "the wait string is what the upstream poller raises"
   went with it; nothing in the code produces that string.
2. **A bare `"429"` substring.** `_gh_json` builds its error from
   `' '.join(cmd)`, which carries the PR number, and a `TimeoutExpired` carries
   the command too. So a gh failure on PR #429, #1429, or #4290-4299 would have
   been named `rate-limited` with "rerunning after a pause is the fix" -- the
   exact confident misnaming the change existed to prevent. Every pattern is now
   anchored to text the failing library emits: `error code: 429` and
   `rate_limit_error` from the Anthropic SDK, `credit balance is too low` as
   measured, and two strings this script emits itself. A speculative one-word
   `billing` rule, which ranked above the rest and matched eighteen tracked
   files' paths, was removed because no measured message had ever produced it.
3. **An invariant that could not fail.** "Every classified cause is still a
   non-zero exit" compared the list of tag NAMES and never called `_fail_closed`;
   changing its `return 1` to `return 0` still printed 46/46 and the CLAIMS row
   stayed green. It now drives the real function once per cause and once for an
   unknown, with the PR comment and the report file stubbed so nothing touches
   the network or the tree.

`--self-test` 39 -> 47. **Every new invariant proven by mutation** against the
corrected code: `_fail_closed` returning 0, un-anchoring `429`, and breaking the
credit, no-key, rate-limit and unknown-cause rules each make the suite report
the specific invariant it broke. The corrected CLAIMS row exits 1 with `429`
un-anchored and 0 when restored.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-02 | Aldemir (via `AskUserQuestion`) | Both enforcement layers; fully autonomous merge — answered live, this ADR records it |
| 2026-09-02 | — | Created; status left `Proposed` pending the founder's explicit lock per this log's own convention |
| 2026-09-02 | Aldemir (chat) | Asked "sonnet ultrathink or opus high" — corrected model from "Sonnet max" to **Opus / high** per ADR 0050's own override rule, before merge. Files/branding renamed off "sonnet" to match (`pr-merge-{auditor,adversary}.md`, `pr-audit-gate.yml`, `pr_audit_gate.py`, `require_pr_audit.py`) |
| 2026-09-03 | `PR Audit Gate` (Opus, run 33695630472) | BLOCK — security + correctness, both confirmed real; 4 fixes landed same day, see first Correction above |
| 2026-09-03 | pr-audit-gate skill, security angle (Opus subagent) | BLOCK — the verdict-parser fix from the first correction was incomplete (wrong function) and the fork-secret claim was wrong for the new trigger; both confirmed independently and fixed, see second Correction above |
| 2026-09-03 | pr-audit-gate skill, all 3 angles (fresh Opus subagents) | BLOCK, BLOCK, BLOCK — a deny-list verdict decision in two places (one confirmed by execution to invert a literal adversary "VERDICT: BLOCK" into a merge), an unauthenticated marker check (confirmed by execution against a shimmed outsider comment), an `--auto` merge race, and a deny-list state classifier; 6 fixes landed same day plus a `--self-test`, see third Correction above |
| 2026-09-03 | pr-audit-gate skill, correctness + security (fresh Opus subagents) | BLOCK, BLOCK — a GITHUB_TOKEN merge silently removes the post-merge deploy audit (confirmed against GitHub's documented behavior + this repo's own merge history); a repo-wide hook that both over- and under-blocked real git commands (confirmed by execution); a diff-truncation gap the third round's correctness angle didn't reach (confirmed by harness-executing a planted regression past the old cut); 6 fixes landed same day, `--self-test` grown 17 → 24, see fourth Correction above |
| 2026-09-03 | pr-audit-gate skill, correctness + security (fresh Opus subagents) | BLOCK, BLOCK — round 4's own `workflow_dispatch` fix 403'd on every run (missing `actions: write`, self-caught independently before either report landed) and round 4's own `\n`-exclusion regex fix regressed a real backslash-continuation case; both fixed same day, `--self-test` grown 24 → 29, see fifth Correction above |
| 2026-09-03 | pr-audit-gate skill, combined correctness+security (fresh Opus subagent, final round) | BLOCK — one finding, in the YAML consuming `wait_upstream`'s return value rather than the Python producing it: a confirmed-red required check reported job SUCCESS having audited nothing; fixed same day. Explicitly stated the parsers/hook have converged after five prior rounds' adversarial testing found nothing new, see sixth Correction above |
| 2026-09-03 | Aldemir (chat, direct authorization) | PR #261 modifies `_GATE_OWNED_PATHS` itself, so `touches_own_gate` force-escalates it to BLOCK by design — the gate cannot self-clear a PR that changes itself; that is the intended shape, not a bug. Founder authorized completing the merge directly in chat, the escalation path this exact case exists for. Merged via `gh api .../pulls/261/merge`, SHA-pinned to `ce519d4208b5bd27751d8acc572c1b53ca99fc78`, all five required contexts green, `--self-test` 29/29 re-confirmed on `main`'s own copy post-merge. **Status → Merged.** The branch-protection PATCH gap (still needs founder go) is carried forward, not closed by this merge |
| 2026-09-03 | pr-audit-gate skill, security angle, auditing PR #291 (unrelated PR) | Noted in passing, not a BLOCK on PR #291 itself: `_GATE_OWNED_PATHS` doesn't cover `deploy.yml`, flagged as its own follow-up PR rather than bundled in; fixed 2026-09-04, see eighth Correction above |
| 2026-09-04 | Live production incidents, not an audit round (PRs #288, #290, #291, #294) | `wait_upstream`'s red branch had no debounce, unlike its green branch — a single poll catching the `CodeQL` check-run's real but transient `neutral` conclusion (self-corrects to `success` ~10s later, confirmed by direct Checks-API capture) was enough to declare upstream red on four separate PRs. Fixed same day: red branch now requires the same failed set on two consecutive polls; `--self-test` grown 29 → 35, see seventh Correction above. Fix PR [#297](https://github.com/aldemirkonuk/RestaurantAIAutomation/pull/297) — touches this ADR's own `_GATE_OWNED_PATHS`, needs the founder to merge directly |
| 2026-09-06 | Aldemir (chat, direct authorization) | PR #297 modifies `_GATE_OWNED_PATHS` itself, same as #261, so `touches_own_gate` force-escalates it to BLOCK by design and `require_pr_audit.py` correctly refused a plain `gh pr merge 297`. Founder authorized completing the merge directly in chat. Merged via `gh api .../pulls/297/merge`, SHA-pinned to `c53cee6f7f8e0aea3c7dc7e7873e0f68dec4f646`, all five of `main`'s actual required contexts green (`PR Audit Gate` itself is not one of them); squash commit `9a23abb6889dfcc6af443b8ccdd03ca1bbb694ec`. `--self-test` 35/35 re-confirmed on the merged tree pre-merge |
| 2026-09-06 | Aldemir (chat, direct authorization) | PR #299 (the eighth Correction's `deploy.yml` fix) modifies `_GATE_OWNED_PATHS` itself, same shape as #261 and #297; `require_pr_audit.py` correctly refused `gh pr merge 299`. The branch needed four separate `git merge origin/main` rebases in ~15 minutes (main was unusually active — a sibling session running the identical #297 escalation concurrently, plus PR #291 itself landing mid-flight) before all five required contexts held green together; each rebase re-resolved real content conflicts in this same ADR file and `decisions/README.md` (PR #297's own "seventh Correction" collided in name with this PR's, resolved by renumbering this one eighth — the same collision rule this repo applies to a duplicated OD or ADR id). Founder authorized completing the merge directly in chat. Merged via `gh api .../pulls/299/merge`, SHA-pinned to `5b2ce4bf7b04a58f8e7c1701cddb09f61324b527`, all five of `main`'s actual required contexts green; squash commit `78a8f46fe2617ab26dd75ce70e12a25793563ff1`. `--self-test` 35/35 re-confirmed on the merged tree pre-merge |
| 2026-09-12 | pr-merge-adversary (Opus subagent), auditing commit `0284c387` only | **OVERTURNED** -- an `upstream-wait` tag that could never fire because `wait_upstream` never reaches `_fail_closed` (so the ADR paragraph describing it was false); a bare `\"429\"` match that would name any gh failure on PR #429 a rate limit; and an exit-code invariant that compared tag names and passed on `return 0`. All three reproduced by the adversary with commands, all three fixed the same day, every new invariant re-proven by mutation, `--self-test` 39 -> 47. Nothing it found changed a merge decision: 313 inputs to `_fail_closed` all returned 1 |
| 2026-09-12 | Live symptom across every open PR, not an audit round | `PR Audit Gate` red on every PR from a `NEUTRAL` `CodeQL` — a check that has never been required and cannot block a merge, reached only because branch protection is unreadable and the fallback waits for everything. Fixed by narrowing the FALLBACK wait list, never the state allow-list; `_fallback_names()` extracted so the self-test exercises the real selection; `--self-test` grown 35 → 39 and proven to fail on the pre-fix tuple. Touches `scripts/pr_audit_gate.py` and this ADR, so it escalates to the founder — same shape as PRs #297 and #299. |
| 2026-09-12 | pr-merge-adversary (Opus subagent), second pass on `e59bf901` | **HOLDS** -- nothing changes a merge decision. Notes acted on the same day: "and never raises" was false (struck, bracketed); a timed-out `gh pr comment` classified by the report text in its argv (the reason now names the command, never its arguments); "Nothing was audited" was false when a merge or dispatch call timed out after a PASS (reworded); stderr noise from the stubbed invariant (silenced); `empty-diff` and the no-bare-word rule unpinned (pinned). `--self-test` 47 -> 50 |
| 2026-09-17 | Aldemir (chat, main session, direct authorization) | Pipeline redesign, verbatim: *"change ADR 90 to be a better pipeline, 1 opus starts -> stops -> 2 sonnet handles opus's plan-> opus takes final say."* Replaces the 3-Opus-angle-plus-adversary fan-out with one Opus planner (stops after planning) -> two independent parallel Sonnet reviewers (correctness/regression/decision-compliance; security/adversarial) -> the same Opus planner resumed for final HOLDS/OVERTURNED judgment. `.claude/agents/pr-merge-auditor.md` and `pr-merge-adversary.md` re-scoped to `model: sonnet`; new `.claude/agents/pr-merge-planner.md` added (`model: opus`); `.claude/skills/pr-audit-gate/SKILL.md` steps 4-7 and 10 updated to match, `.planning/decisions/0050-*.md` added to the owned-paths list. Scope held to those files only — `CLAUDE.md`, `.github/workflows/`, and `scripts/pr_audit_gate.py` were explicitly left unchanged; the CI-side path still runs the old composition and has had no `ANTHROPIC_API_KEY` credit since 2026-09-12, unchanged by this amendment. See the "Amendment — 2026-09-17" subsection under Context above and ADR 0050's matching dated bracket |
| 2026-09-18 | Aldemir (chat) | "do the better approach for longevity, change the ADR if needed." Seven questions answered, all with the recommended option (table in the 2026-09-18 amendment). Ownership decided by `gate_ownership()` on git-native input at a pinned head: index owned unless a pure append for ADRs the PR adds; decision text naming the gate owned; owned paths case-folded and widened to `scripts/hooks/`, `.claude` and `.mcp.json` at any depth, nested `CLAUDE.md`/`AGENTS.md`; renames seen from both sides; escalation before any model call; the hook re-checks with origin/main's copy and requires `--match-head-commit`. Fixer round after the adversarial audit: `.github/workflows/` and `.github/actions/` owned whole, plus the deploy scripts `deploy.yml` calls and the gate's own tests; the hook checks every merge in a command, needs a literal PR number and one pin, and blocks MCP merge tools; a 1,000-line register-diff bound and a 600s CI deadline. Confirm round after a NOT READY: `.claude` and `.mcp.json` owned at any depth; the hook refuses a `pr` subcommand or `gh` word written with quoting or expansion, `gh alias set`/`import`, `--admin`, `--auto` and a second merge in one command, blocks rather than fails open if its word reader raises, and its marker and direct-push checks are pinned by tests; the "hard block" residual narrowed to what is checked, refused and not seen, each not-seen example pinned. Replay 125 → 104 owned of 317 (re-measured after the confirm round, unchanged commit by commit); 80 mutations, 0 survivors (`scripts/test_pr_audit_gate.py`), 23 hook mutations killed. This change edits owned paths, so it escalates by design and merges only on the founder's word through the SHA-pinned route. |
| 2026-09-18 | Aldemir (via `AskUserQuestion`, relayed by the orchestrating session) | Chose the option labelled exactly *"Accept the widening (Recommended)"* on the question about widening the owned set: the whole `.github/workflows/` folder, `.github/actions/`, the deploy-check scripts, the gate's own tests, and `.claude/` at any depth. Recorded in the amendment's widening paragraph, which no longer asks for his word on it. `scripts/check_test_scripts_are_real.py` and `.mcp.json` at any depth were not named in the acceptance as relayed; they ride on this PR's own escalation. |
| 2026-09-21 | Aldemir (chat, gate lane review-trail round, gate-r6) | Closed the two residuals gate-r5 had only named (bullet above, "Named, not code-changed"), verbatim: **(1)** *"Bind it to the segment"* -- the literal-PR `gh api` exemption in `_github_api_merge_reason()` was granted on a gh-api reading of the WHOLE command, so `gh api user >/dev/null; curl -X PUT .../pulls/2/merge` was exempted by an unrelated `gh api` call; it is now granted only when `_merge_call_outside_gh_api()` finds no segment (top-level, in a substitution, or in a quoted string another shell runs) that names the endpoint without itself being the recognised `gh api` call. **(2)** *"Teach it export"* -- `_collect_assignments()` read a leading `export` as the command starting and skipped the `NAME=value` after it, so `export B=main; git push origin feat:$B` reached main; `export`, `export -n` and `export --` now assign as the bare form does. The last call found the first cut of each opened what HEAD refused -- surfaces in a heredoc body (a base Merges POST, a GraphQL auto-merge mutation, a non-literal-PR merge, a curl merge) and two `export` shapes resolved to a value the push never sees -- and corrected both (bracket on the gate-r5 bullet, above, with the residuals still named). Re-measured on this branch, not copied forward: `test_require_pr_audit.py` 286 passed; the full `ci.yml` scripts/ step (9 files, `scripts/jev/prompt_gate_test.py` folded in by this branch's merge with `origin/main`) 617 passed; `test_pr_audit_gate.py` 103, unchanged; `--self-test` 98 invariants held, unchanged; every `r6_*` HOOK_MUTATIONS mutant exits 0 on its scenario where the fix exits 2. Not done, stated plainly: no branch-protection or live-repo verification, same restriction as every prior round; the `gh api` finding is the hook's own verdict in the test harness, and only the export fix was also shown with a real push, against a local bare origin. |
| 2026-09-21 | Aldemir (chat, relayed by the orchestrating session, gate lane review-trail round, gate-r7) | Closed the residual gate-r6 could only name (this ADR's own text, not his words: *"a push behind an env prefix or a wrapper (`X=1 git push origin HEAD`, `nohup git push origin HEAD`), which `_direct_push_problem()` skips because the segment's first word is not git."*). His answer, as relayed: *"CLOSE the env-prefix / wrapper push hole, fail closed - a push behind leading assignments or a wrapper (nohup, env, command, time, exec, sudo, xargs, a shell -c with a literal string) run from a main checkout is read like a bare push; an unrecognised wrapper shape is refused."* Disposition of the two shapes named with it, as relayed: other assignment forms (`declare`, `typeset`, `readonly`, `local`, `read`, `eval`, `NAME+=`) -- **keep trusting them** (named residual, not widened); heredoc/comment text -- **keep the current reading**. Built as three readings (recognised: read like a bare push; a shell running a string: re-read, expansion refused; unrecognised: refused whatever the destination) in the gate-r7 bracket above. The last call found the first cut had read only a bare named wrapper and an exact `shell -c`, and had recorded four open shapes (`sudo -u root`, `env -i`, `xargs -I{}`, `bash --norc -c`) as residuals he had not named; corrected, and five shapes proven with a real push against a local bare origin, first cut allowed and moved main, fix refused and main stayed. `test_require_pr_audit.py` 366 passed (286 at gate-r6); the full `ci.yml` scripts/ step 697 passed (617 at gate-r6); `test_pr_audit_gate.py` 103, unchanged. |
| 2026-09-21 | Aldemir (chat, relayed by the orchestrating session, round 6, gate-r8) | His answer to the gate-r7 last call's four recommendations, verbatim: *"Take all four"*. As relayed, that is: (1) a word shlex cannot close -- road (b), re-read with the heredoc-aware `_lex` reader and refuse only if that also fails; (2) git named by an expansion -- road (a), resolve a command word through the same-command assignments `_collect_assignments()` collects and refuse an unresolved `$`-built command word followed by push; (3) accept that a heredoc body line naming `git push` after another word, or `echo git push origin HEAD`, is refused, the text going through a file with `-F`, and make the refusal say so; (4) keep "a quoted string handed to a program on neither list" as a named residual, unchanged. Built in the gate-r8 section above, with three shapes found while building and closed under rules already recorded (a push inside a double-quoted substitution, a value that is itself an expansion or an array, a command both readings misread). Fourteen shapes exit 0 on gate-r7's hook and exit 2 on gate-r8's; a replay of 79,404 recorded Bash commands refuses 54 more and allows none it refused. Left for him: a git alias the command defines for itself, and the `docker --config $DIR push` cost. `test_require_pr_audit.py` 484 passed (366 at gate-r7), 98 mutation cases all killed; the full `ci.yml` scripts/ step 815 passed (697 at gate-r7); `test_pr_audit_gate.py` 103, unchanged. [Finished in the 2026-09-22 row below: its last call found more pushes in the same two roads.] |
| 2026-09-22 | Aldemir (chat, relayed by the orchestrating session, gate-r8 last call) | On the fork the gate-r8 last call put to him (finish its unstaged fix in this PR, or merge with its five kinds named as residuals), verbatim: *"check claude cli, 0dc07485-0b74-4712-aa1f-c43ab67f6dbc, make sure it din't do anything different. if not finish in this PR"*. The orchestrating session checked that session (the merge train): no gate edits. Finished here (gate-r8 section, "Finished, same PR"): the last call's 21 shapes and 36 more the unfinished fix still let through, each a real push, are refused; the two surviving mutation cases re-pinned to a real push only the line reading sees; the replay of 80,100 recorded commands gives verdicts identical to the first cut's. Left for him: a heredoc body a program that is not a shell runs (`python3 - <<'EOF'`). `test_require_pr_audit.py` 618 passed, 147 mutation cases all killed; the full `ci.yml` scripts/ step 949 passed. [Finished in the round-6y row below: an Opus last call on this finished pass found five more real pushes in the same two roads.] |
| 2026-09-22 | Aldemir (chat, relayed by the orchestrating session, round 6y, gate8c) | On the fork an Opus last call on the finished gate-r8 pass put to him (finish the two remaining roads' five real pushes in this PR, or merge with them named as residuals), his pick, verbatim, as relayed: *"Close them here (Recommended)"* -- close the five real pushes the last call found: (1) a whole `${...}` command word whose default/alternate-value text holds push, refused like a whole `$(...)` holding push already is, including the IFS-split variant; (2) `eval`'s joined arguments re-read as a command string, the way a `bash -c` string already is, so the same IFS and quoting closures reach `eval` too. Built in the gate-r8 section above ("Closed on the founder's 2026-09-22 word, same PR (gate8c)"): both mechanisms, pinned with real-push tests against a local bare origin, allowed twins (his named `eval "$(ssh-agent -s)"` twin holds), and 10 new mutation cases; an Opus last call the same day found the `eval` re-read as first built let through what the hook before it refused (`C='git push origin HEAD'; eval "$C"`, `eval 'git -c alias.p=push p origin HEAD'`) and never read an IFS set before the `eval`, each measured moving a bare origin's main, and corrected it: the string is re-read after the command's own assignments, and eval's older string-runner reading still applies beside it; the round-6 named residual (4) boundary (`${G:-git} push origin HEAD`) is unaffected and stays refused, pinned separately so it is not mistaken for an allowed twin. ADR 0090's gate-r8 section and the CLAIMS row `ADR-0090-GATE-R8-UNREADABLE-AND-EXPANDED-PUSH` (14 more shapes: 11 refused, 3 allowed) both updated to match what is built. `test_require_pr_audit.py` 653 passed (618 at the last call), 157 mutation cases all killed (147 before, 10 new); the full `ci.yml` scripts/ step 984 passed (949 before, 970 at the first build); `test_pr_audit_gate.py` 103, unchanged; the 80,100-command transcript replay gives identical verdicts before and after. Left for him: whether `eval` strings naming push as a word (`eval 'git push origin feat/x'`) should be allowed again, and four more real pushes the last call found outside his word (a pattern-substitution replacement, an indirect expansion, a `${G:=...}` assignment, `builtin eval`). Not done, as before: no branch-protection or live-repo verification. |
