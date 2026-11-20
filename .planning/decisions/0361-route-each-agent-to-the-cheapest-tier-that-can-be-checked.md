# 0361 — Route each agent to the cheapest model whose output can still be checked

- **Status:** Proposed
- **Date:** 2026-11-07
- **Decider:** Aldemir (founder). He set the policy shape in his own words, quoted under Context. The tier lines, the examples and the prompt shapes are the session's calls under the 2026-11-07 /goal.
- **Keywords:** model routing, haiku, sonnet, opus, subagent, workflow, dispatch, effort, escalation
- **Links:** amends [[0231-opus-as-much-as-the-work-needs-sonnet-where-it-is-fast-and-direct]] by adding a third tier (Haiku) and a routing test; 0231's measured judge's mix stands inside the Opus and Sonnet tiers (Opus still builds money, migration, auth and tenancy lanes). [[0050-agent-dispatch-hardness-threshold]] stays superseded by 0231; its overrides are restated below. The gate reviewers stay as set by [[0090-pr-audit-gate-autonomous-merge]]; product model calls stay with [[0036-cost-routing-two-plans-in-harmony]].

## Context

The founder's words, 2026-11-07: *"Create the right architecture of using which model for which task, and making sure that you divide tasks properly, and leave Opus 5.5 for the hardest ones, Sonnet for easier ones, and Haiku for more easier ones … make a great example of what each can be, how each should be prompted, and how each should be instructed in order to think that, and go ahead, do that."*

Until today, routing had two tiers:
- ADR 0050 summed a score over five axes: 3 or below went to Sonnet, 4 or above to Opus.
- A measured split followed on 2026-09-27: 614 agents and 40 audited PRs. It made Opus the default builder and fixer, Sonnet the verifier and the gate reviewers, and Opus the final say. ADR 0231 (2026-09-28) locked that mix and retired 0050's score.

Haiku was never used. Yet in a single wave, much of the session's own agent traffic is closed-form work: collecting PR states and sizes, parsing workflow journals, running guards and copying their pass or fail lines, re-measuring a diff. On 2026-11-07 alone the main loop did about 20 such steps inline, each a few tool calls with no judgment in them.

What the 2026-09-27 measurement found, kept as evidence:
- Opus-built lanes passed their first audit 7 of 15 times. Sonnet-built lanes passed 0 of 3.
- Sonnet fixers failed 0 of 3 repeat fixes.
- Sonnet verifiers caught 3 of 3 false self-reports.
- Opus final calls overturned 19 of 45 Sonnet reviewer approvals.
- Cache reads are 63–89% of a lane's cost and cost the same on both models. So the swap barely moves dollars; it moves Opus *quota*.

## Options considered

1. **Keep two tiers (0231 as it stands).** Proven, but every mechanical step costs either Opus quota or main-loop context. It ignores the founder's instruction.
2. **Route by effort: big tasks to Opus, small to Haiku.** Rejected, for the reason 0050 already proved. The auth census was "one grep" but needed judgment about what counts; routing by effort bought a fifth number nobody trusted.
3. **Route by checkability (chosen).** The question is not how hard the task is to *do*. It is how much judgment the output encodes, and whether a command can tell if it is right.
4. **Haiku everywhere, with an Opus checker.** Rejected: checking judgment costs as much as producing it. The 19 of 45 overturned approvals show cheap reviewers miss real defects.

## Decision

**Each agent goes to the cheapest model whose output can still be checked against what being wrong would cost.** That gives three tiers, with escalation upward and never downward.

### Haiku 5.5: *closed form; a command can check every line it returns*

Use Haiku when the brief can be written entirely as exact commands plus an output shape, and nothing in the result is a recommendation.

Examples from this repo:
- `gh pr view N --json headRefOid,isDraft,additions,deletions,baseRefName` across a stack, returned as a table.
- Parse `journal.jsonl` for a workflow: which labels started and which have results.
- Run `scripts/check_decision_claims.sh`, `check_read_errors_not_swallowed.py` and `check_flag_readby_anchors.py` in a worktree and copy the summary lines.
- Run a named jest or vitest file through heavy.sh, before and after reverting a given file, and report both pass/fail lines. This is the revert proof, with the revert target named by the parent.
- Re-measure every open PR's diff size against the 30K wall.
- List worktrees whose branch is fully pushed and whose status is clean.
- Append a QUEUE row from facts the parent supplies.
- Check that every user-facing string in a given file has a Turkish and an English entry.

Never use Haiku to write shipped code, decide anything, judge an audit finding, or summarise a report someone will act on.

**Agent:** `haiku-runner`, effort `low`. **Escalate when:** it returns `UNEXPECTED:`. The parent reads it, and the next step goes to Sonnet or Opus.

### Sonnet 5.5: *bounded; the parent has already written the whole brief*

Use Sonnet when the outcome, the files (file:line), the rules that apply and the specs that prove it are all in the brief, and the change fits one DRAFT PR of at most 15 files and 30K.

Examples:
- A UI screen from a settled design, such as the wave-4 Mail tab list, built from a read model that already exists.
- A QA residual where QA supplied the reproduction and the direction of the fix, for example "the gateway note still says 'confident count'; rewrite it without confidence language".
- Moving a read past the 1000-row cap with a `.range` loop.
- Writing the behavioural SQL test that replaces a grep-only spec.
- Verifiers and audits: rerun specs, try to break the change, list findings. This includes the two ADR 0090 gate reviewers.
- Research *finders*: one angle each, returning evidence. They never synthesise.

**Agents:** `sonnet-builder` (effort `medium`) and `sonnet-auditor`. **Escalate when:** the builder returns `FORK:` (the brief assumed something the code contradicts, or a design choice was not made) or `ESCALATE:` (a migration, auth or money rule the brief didn't spell out), or the same fix has failed once. The 09-27 data shows that Sonnet repeat fixes do not converge.

### Opus 5.5: *judgment; being wrong is expensive, or the brief can't be written in advance*

Use Opus when the output *is* a decision, or when the task can't be fully specified until someone has thought about it.

Examples:
- Planning lanes from a proposal: the wave planners.
- Money, stock and quantity math: per-bottle lot cost, a sale carrying its cost, void and refund reversal, unit conversion.
- Migrations and schema; auth and tenancy; anything that writes to the ledger.
- A fix that already failed one round, and residuals QA rated PARTIAL twice.
- Resolving a fork a Sonnet builder escalated.
- The research head, which plans the angles and synthesises the finders' evidence.
- The adversarial kill pass on a leading option.
- The final say on a lane, and the 0090 planner and adjudicator.
- ADRs and decision records.

**Agent:** `opus-head`, effort `high`, or `opus-low` for a hard but fully scoped review-and-fix where Opus judgment is needed with a small thinking budget.

### Overrides (first set in 0050, kept through 0231)

These go to Opus whatever the tier test says:
- the task writes a migration or touches production;
- it touches auth, tenancy, secrets or a guardrail;
- it writes an ADR or resolves a fork;
- it sends anything outward;
- it deletes more than it creates.

**Split rule:** a task with a separable cheap half is two tasks. A census that feeds a decision is a Haiku census followed by an Opus decision.

### How each tier is prompted

The full prompts live in the agent definitions under `~/.claude/agents/` (`haiku-runner.md`, `sonnet-builder.md`, `opus-head.md`). The shapes:

- **Haiku: imperative and closed.** Numbered exact commands, the expected result, and the output schema. "If anything differs, write `UNEXPECTED:` verbatim and stop. Do not work around it." No goals, no background. Example:
  > 1. `cd <wt> && bash scripts/check_decision_claims.sh | tail -1` 2. `python3 scripts/check_read_errors_not_swallowed.py | tail -1` 3. `gh pr view 842 --json headRefOid -q .headRefOid`. Return `{claims, read_errors, head}` with each line copied verbatim.
- **Sonnet: a complete brief.** It contains the user-visible outcome; the files at file:line; the rules (ADR numbers) that bind; the edge cases; the specs that prove it; the worktree, branch and base; and the return shape. It is told to read before writing, to write the spec first, to make the smallest change, to revert once to prove the spec, and to return `FORK:`/`ESCALATE:` rather than guess. Example: the QA 10b brief for #833, which names the problem, the ADR, the languages and the "shown twice" edge.
- **Opus: the problem, not the steps.** It gets the founder's words, the evidence paths (QA reports, probes, proposal sections), the invariants that must hold, the forks known so far, and the instruction to *branch the question, try to kill the leading answer, then decide and record the call with rejected alternatives*. It is also told to write a Sonnet-ready brief for any mechanical half instead of doing it itself. Example: "Per-bottle lot cost is still wrong for proposals. Here is QA 12b; the invariant is cost per bottle = printed line total ÷ bottles received, unknown stays unknown. Decide where proposals enter, prove it, and brief the rest."

### Workflow defaults (per stage)

| Stage | Model | Effort |
|---|---|---|
| plan / decide / judge / last call / research head | opus | high |
| build: money, migration, auth or tenancy lanes | opus | high |
| build: bounded UI or read lanes with a complete brief | sonnet | medium |
| audit / verify / research finder | sonnet | high |
| fix round 1 (QA gave reproduction and direction) | sonnet | medium |
| fix round 2+, or audit DEFECT on math/auth | opus | high |
| collect / measure / guards / journal parse / revert-proof runner | haiku | low |

## Consequences

- **Easier:** Opus quota goes to the steps where the 09-27 data says it pays (planning, math, fixes that didn't converge, final say). Mechanical status work leaves the main loop's context. Every agent's prompt shape is fixed, so a brief can be reviewed against its tier.
- **Harder:** the parent must write Sonnet briefs completely, since an incomplete brief now produces a `FORK:` instead of a guess. Escalation adds a round trip. Haiku output is trusted only as far as it is verbatim.
- **Revisit when:** a Haiku runner's verbatim output turns out to be wrong more than once (move that kind of task to Sonnet); a Sonnet-built lane fails its first audit on something the brief stated (the brief was fine, so the line sits too low: move that lane type to Opus); or Opus quota stops being the constraint (then the 09-27 "Opus builds by default" mix is cheaper per accepted PR again).

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-11-07 | — | Created (session d2a0df00, founder instruction of the same day) |
