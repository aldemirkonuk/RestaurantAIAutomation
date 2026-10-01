# 0231 — Opus as much as the work needs; Sonnet where the task is fast and direct

- **Status:** Locked — founder, 2026-09-28 (item 86). **Supersedes [ADR 0050](0050-agent-dispatch-hardness-threshold.md)** in full.
- **Date:** 2026-09-28
- **Decider:** Aldemir (founder). Two founder words carry this record:
  - **Item 86, 2026-09-28, verbatim:** *"remove ADR050, run opus as much as you need, while putting emphasis on sonnet when the tasks are fast, and direct, and other things that sonnet are highly capable of doing maximizng efficiency"*
  - **2026-09-27, the role split:** the founder chose *"Judge's mix (Recommended)"* for the Opus/Sonnet roles (recorded in [`WEB-REBUILD-CENSUS-2026-09-25.md`](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §17, "Model-split decision, dated note (2026-09-27)").
- **Keywords:** agent dispatch, subagent, model routing, sonnet, opus, judge's mix, efficiency, session discipline, supersedes 0050
- **Links:** [[0050-agent-dispatch-hardness-threshold]] (superseded by this), [[0090-pr-audit-gate-autonomous-merge]] (its audit pipeline stands — see Decision §4), [[0036-cost-routing-two-plans-in-harmony]] (**different subject** — the product's own model calls), [[0003-session-output-discipline]]

## Boundary — what this ADR is not

This governs **which model a working session gives its own subagents** — the same
subject ADR 0050 governed, and nothing else. ADR 0036 (the product's production model
routing, NF-A cost per task) is untouched; a change here implies nothing there. That
boundary is carried forward from 0050 unchanged.

## Context

ADR 0050 (2026-09-01) routed every dispatched agent by a 0–10 hardness score: five
axes, **≤3 → Sonnet, ≥4 → Opus**, plus override lists. Three things happened after it:

1. **2026-09-17** — ADR 0090's audit pipeline moved its two reviewers to Sonnet under a
   plan an Opus planner wrote, with the Opus planner resumed for the final say. That
   went into 0050 as a scoped bracket, not a change to the rule.
2. **2026-09-22** — a Sonnet-default rule ran in practice (project memory
   `sonnet-default-opus-for-judgment.md`), which the 2026-09-27 split partly superseded.
3. **2026-09-27** — the founder picked the **judge's mix**, measured over 614 agents and
   40 audited PRs (census §17). From then on the merge trains ran the judge's mix, not
   0050's threshold. The census recorded that a bracket in 0050 was owed and that
   0050 is gate-owned (`.claude/skills/pr-audit-gate/SKILL.md:67`), so only the
   founder could let it be changed.

Asked on 2026-09-28 whether to record the judge's mix as an amendment to 0050, the
founder went further (item 86): remove 0050, use Opus as much as the work needs, and
put the emphasis on Sonnet for fast, direct work it does very well, to get the most
out of the spend.

## Options considered

1. **Keep 0050's threshold and bracket the judge's mix into it** (the amendment the
   session proposed). Rejected by item 86 — the founder said *remove*. It also fails on
   its merits: the trains stopped scoring agents on 2026-09-27, so a rule that still
   says "score every dispatch" describes something no one does. That is the prose rot
   CLAUDE.md §5b warns about.
2. **The 2026-09-22 Sonnet-default rule** — Sonnet unless the task is clearly judgment.
   Rejected: it caps Opus where the founder said to use it *"as much as you need"*, and
   the 2026-09-27 measurement already superseded it in part. Its failure mode is the
   one 0050 named: a task that is small but carries a decision goes to the cheaper model
   and comes back as an answer nobody trusts.
3. **Opus for everything.** Rejected: item 86 explicitly asks for *"emphasis on sonnet
   … maximizng efficiency"*. Sending verification, branch updates and lookups to Opus
   pays frontier price for work Sonnet does as well, and it narrows how wide a session
   can fan out for the same spend.
4. **Opus as much as the work needs, Sonnet emphasised for fast and direct work, the
   judge's mix as the working default.** ✅ Chosen — it is the founder's word
   (item 86) applied to the role split he already picked (2026-09-27).

## Decision

**Use Opus wherever the work needs judgment. Put the emphasis on Sonnet for fast,
direct, well-specified work it is very good at, to get the most out of the spend.**
There is no score and no threshold.

**1. The test.** Before a dispatch, ask: *is this fast, direct and well-specified, and
can a check prove the output?* If yes, use Sonnet. If the output carries a judgment
that is expensive to get wrong (a design, a plan, a fork, a fix for a finding, the
final say), use Opus, and use as much of it as the work needs. This keeps 0050's one
lasting insight — hardness is **judgment and consequence, not effort** — without its
scoring ritual.

**2. The working default: the judge's mix** (founder, 2026-09-27, as census §17
records it):

- **Build:** Opus by default. Sonnet builds only mechanical lanes of ≤15 files.
- **Plan:** Opus, and only for medium or large lanes.
- **Verify:** Sonnet, and always done.
- **Other Sonnet roles:** update, merge and post, and the two audit reviewers.
- **Final say:** Opus (plan, adjudicate, delta and final check).
- **Fix:** Opus, at most 2 rounds. After that the fork goes to the founder by name.
- **PR size:** at most 15 files.
- **Process:** parallel prep and a serial merge (main is strict); a lane waits for
  all 5 required checks before it reports.

> **[2026-09-29 — one-PR waiver of the 15-file cap, founder's words]** The cap
> stands. The waiver below covers exactly one PR and sets no precedent; a later PR
> over 15 files needs its own founder answer.
>
> - **PR #502 (`fix/team-removed-shifts-open-pool-r2`, ADR 0215 items 26-27, 22
>   files).** Founder, in chat in session 5e8d08 on 2026-09-29, verbatim: *"Waive
>   for #502"*, recorded on the PR by the merging session. It covers the file count
>   only; the audit still judges every file.
> - **PR #517 (sketch 123)** needed no waiver in the end: it was split into #517
>   (15 files) and #523 (5 files). An earlier draft of this bracket recorded a pick
>   for #517 that could not be traced to a founder record, so it is not kept here.
>
> **[2026-09-29, a second one-PR waiver, founder's words as relayed]**
> - **What it covers.** The re-cite PR `docs/od-rows-into-open-2026-09-29`, 41 files. It moves OD-190–196 and OD-201–204 from after `## Resolved` into the `## Open` table. It removes the two appendix headings that held them, runs `scripts/check_citation_pairing.py --fix` (40 files), and adds this bracket.
> - **The founder's words.** In chat on 2026-09-29, verbatim: *"Waive, own PR (Recommended)"*. This was the option label of his AskUserQuestion answer in session a493af02, at 2026-09-29T15:58:20Z, relayed to the merging session by that coordinator. The question named OD-190–196, OD-201 and OD-202.
> - **What was not in his pick.** OD-203 and OD-204 were filed later the same day (#525), after his pick, and are moved here because they sit in the same misplaced section.
> - **Scope.** It covers the file count only. The audit still judges every file.
>
> **[2026-09-29, a third one-PR waiver, founder's words as relayed]**
> - **What it covers.** PR #497 (`fix/websocket-role-gate`, the live-channel and bell role gate, OD-180), 17 files when he answered; this bracket makes it 18. It covers the file count only; the ADR 0090 audit still judges every file.
> - **The founder's words.** In chat on 2026-09-29, verbatim: *"Waive for #497 (Recommended)"*, the option label of his answer, relayed to the merging session by the coordinator of session a493af02 after the ADR 0090 planner stopped #497 at PLAN: BLOCK on this cap (comment on PR #497). His earlier "merge all five" (#518, #519, #497, #504, #494) was a merge instruction and is not read as a waiver.

> **[2026-09-29, a fourth waiver, founder's words as relayed — the open-PR batch]**
> - **What it covers.** One PR, `batch/open-prs-2026-09-29`, that merges the 34 PRs open when the batch was scoped (#515, #507, #506, #505, #503, #501, #498, #496, #495, #492, #445, #443, #433, #432, #431, #409, #383–#375, #362, #346–#339), leaving out #530 and #531, which another session was landing, into one branch, one audit and one merge. #532 and #533 opened afterwards (2026-09-30T02:15Z) and are not part of it. 24 were merged and 10 dropped. Its file count is the sum of its constituents'. The PR body lists every constituent included, and every one dropped with its reason.
> - **The founder's words.** In chat on 2026-09-29, verbatim: *"combine couple branches into one big merge at the same time? don't care how much it takes but gets the job done in one go"*. To the scope question, the option label *"All still-open PRs (Recommended)"*; to the cap question, the option label *"Waive for the batch (Recommended)"*. Relayed to the merging session by the coordinator of session a493af02.
> - **Scope.** The file count only. The ADR 0090 audit still judges every file of every constituent, one constituent at a time; gate-owned files in the batch still need the founder's own sign-off before merge. The cap stands for every later PR.

> **[2026-09-30, a fifth waiver, founder's words as relayed — the two-round fix cap, PR #537]**
> - **What it covers.** PR #537 (`fix/tenant-guard-and-cross-house-runs`, ADR 0243), one third fix round after the ADR 0090 re-plan's second. The round is text only: wording is changed to what the reviewers measured, with no code change beyond comments, test titles and the one claim verify string that pins a title; then a full re-audit.
> - **The founder's words.** On 2026-09-30, verbatim: *"Waive once, text-only round (Recommended)"*, the option label of his answer, relayed to the fix lane by the lane coordinator.
> - **Scope.** It waives the "Fix: Opus, at most 2 rounds" line once, for this PR, and sets no precedent. The 15-file cap still applies: with this bracket #537 is 14 files.

**3. Where Sonnet gets the emphasis** (item 86's *"fast, and direct"* work Sonnet is
*"highly capable of"*): verification runs and check suites, mechanical edits to a spec,
branch updates and merges of `main`, posting PRs and comments, the plan-scoped audit
reviews, lookups, greps and enumerations whose every claim a command can check, and
records work that copies a decision already made. If a task has a cheap, mechanical
half, **split it and send each half to the right model**. That rule is carried forward
from 0050.

**4. ADR 0090's audit pipeline stands as written.** One Opus planner, two Sonnet
reviewers, the same Opus planner resumed for the final say
(0090, "Amendment — 2026-09-17"). It was always the judge's mix in miniature. This
ADR removes the need for 0050's scoped-exception bracket and changes nothing else in
0090.

**5. What this does not decide.** How much effort or reasoning a model gets (tier is
not effort, as 0050 said), and the model ids pinned in code (`scripts/pr_audit_gate.py`
`MODEL`, and the product's call sites under ADR 0036). Neither is changed here.

## Consequences

- Easier: dispatch matches what the trains already do, so the record and the practice
  agree again. No per-agent score is owed.
- Easier: Sonnet does the high-volume verify/update/post work, so a session fans out
  wider for the same spend. That is the efficiency item 86 asks for.
- Harder: without a score, the choice rests on the test in §1. A lazy reading ("it's
  short, send it to Sonnet") can repeat the error 0050 was written to stop. The guard
  is §1's second clause: *can a check prove the output?* If not, it is not Sonnet work.
- **Revisit when:** a Sonnet-routed task has to be redone on Opus (its category is
  mis-sorted in §3, so move it). Also when a Sonnet-built mechanical lane over ~10
  files needs an Opus fix round. The reverse signal (Opus doing work Sonnet could have
  done) is weaker evidence and goes into §3's list; it does not change the rule.
- **Owed, gate-owned, not edited by this PR:** (a) `.claude/skills/pr-audit-gate/SKILL.md:67`
  lists `.planning/decisions/0050-*.md` as gate-owned. Whether 0231 takes that place is
  the founder's call. (b) `SKILL.md:153` cites "ADRs 0050/0090" for the reviewer routing.
  (c) the comment at `scripts/pr_audit_gate.py:66` cites 0050 as "locked". All three sit
  under `_GATE_OWNED_PATHS` (`scripts/pr_audit_gate.py:491`) or the skill's own list, so
  they need a founder-approved gate PR.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-27 | Aldemir (founder) | Chose "Judge's mix (Recommended)" for the Opus/Sonnet split |
| 2026-09-28 | Aldemir (founder), item 86 | "remove ADR050, run opus as much as you need, while putting emphasis on sonnet …" — 0050 superseded; this ADR records the rule |
| 2026-09-28 | Session (records lane `docs/model-dispatch-adr-0231`) | Created; 0050 marked Superseded (not deleted — `decisions/README.md:10`, "Nothing here is ever silently deleted") |
