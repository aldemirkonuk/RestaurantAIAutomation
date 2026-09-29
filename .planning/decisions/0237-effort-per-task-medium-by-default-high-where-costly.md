# 0237 — Effort per task: medium by default, high where a mistake is costly or a verdict is final

- **Status:** Locked — founder, 2026-09-28 (four answers, verbatim below). Fills the open item in [ADR 0231](0231-opus-as-much-as-the-work-needs-sonnet-where-it-is-fast-and-direct.md) §5 ("How much effort or reasoning a model gets"). Supersedes nothing.
- **Date:** 2026-09-28
- **Decider:** Aldemir (founder). His request, verbatim: *"understand which is better for which tasks use web or your docs to understand where to use Opus5.5 or sonnet 5.5 and which effort."* His answers (AskUserQuestion, 2026-09-28):
  - Build effort: *"Medium, high for risky (Recommended)"*
  - Work a check can prove: *"Sonnet medium, test later (Recommended)"*
  - Audit gate planner: *"Keep high, test medium later (Recommended)"*
  - The smaller forks: *"Accept all (Recommended)"*. These are: every agent names its own model and effort; no Haiku for now; verify stays on Sonnet high; research drafts at medium and rulings at high; this ADR plus the ADR 0090 correction in one gate-owned PR.
- **Keywords:** effort, reasoning effort, opus 5.5, sonnet 5.5, haiku, subagent, workflow, dispatch, usage limits, weekly limit, cost per task
- **Links:** [[0231-opus-as-much-as-the-work-needs-sonnet-where-it-is-fast-and-direct]] (model by role, the parent of this ADR; PR #490), [[0090-pr-audit-gate-autonomous-merge]] (its audit agents keep `effort: high`; see the dated correction there), [[0036-cost-routing-two-plans-in-harmony]] (**different subject**: the product's own model calls, not touched here)

## Boundary

Like 0231, this governs only the agents a working session dispatches: subagents, Workflow `agent()` calls, and `.claude/agents/*.md`. It says nothing about the product's runtime model calls (ADR 0036) or `scripts/pr_audit_gate.py`'s pinned `MODEL`.

## Context

ADR 0231 routes the **model** by role (Opus where the output needs judgment, Sonnet where a check proves it). §5 of 0231 leaves the **effort** open. On 2026-09-28, subagents hit a plan usage limit and nine lanes failed with nothing pushed. The founder then asked which model and which effort fit which task.

Two facts made the question urgent:
- **A blank setting copies the session.** An agent call that sets no effort takes the parent session's effort, and an unset model takes the parent's model. When a session runs at high, every small lookup runs at high too.
- **Effort levels were recalibrated for the 5.5 models.** Opus 5.5 defaults to `medium` on the API, and in Anthropic's testing Opus 5.5 at medium matched or beat Opus 5 at high on coding. Sonnet 5.5's documented starting points are `medium` for agentic coding and multistep tool use, and `low` for chat, extraction and search. At `low`, Sonnet 5.5 is more likely to skip verification or stop early.

The research ran as workflow `wf_6e066105-189`, in three phases:
- **Evidence:** four finders covered Anthropic's API docs, the Claude Code docs, the web (launch pages and benchmarks), and this repo's inventory.
- **Draft:** Opus drafted the matrix.
- **Review:** three Sonnet skeptics attacked it on evidence, mechanics and efficiency. Opus then adjudicated each point.

The review record is at the end.

## Options considered

1. **Leave effort unset (inherit).** No work needed, but every agent runs at the session's level, which was high for this session. Most calls then cost more than they need to. Rejected.
2. **High for everything.** The most thorough, and the heaviest use of the limit. Claude Code's own advice for bug fixes is high. Rejected for ordinary lanes, because a failed lane is already redone at high by the verify → fix loop.
3. **Low for everything, redo failures at high.** This was cheapest in Anthropic's test, but it loses about 8 points on the first try, and Sonnet at low skips checks. Rejected.
4. **Medium by default, high where a mistake is costly or the verdict is final (chosen).** Named risky lanes run at high, as do merge rulings, fix rounds, and the refute and verify passes. Checkable work goes to Sonnet at medium, with two extra prompt lines.

## Decision

**Every dispatched agent names its model and its effort. The default is medium. High is used for risky builds (security, login, tenant isolation, migrations), fix rounds, verify and refute passes, and every final ruling. Low is used only for single-fact lookups.** xhigh needs a measured reason, and max is not used.

### Rules of thumb

1. **Use Opus when nothing can check the answer.** That covers plans, merge verdicts, ADRs and lists of design choices.
2. **Use Sonnet when a check can prove the answer.** Examples are tests, the type checker, CI, a search of the code, or the merge script.
3. **Set the model and effort on every agent yourself.** If you leave them blank, the agent copies the main session's settings. If the session is on high, every small job runs on high too.
4. **Start at medium.** Claude Code starts both models at medium. In Anthropic's own tests, Opus 5.5 on medium matched or beat Opus 5 on high for coding.
5. **Use high for risky fixes and for the final merge verdict.** Risky means security, login, keeping one restaurant's data away from another's, and database changes.
6. **Use xhigh rarely and max almost never.** On Opus 5.5, xhigh gained about 1.4 points for 2.5 times the cost. There is no new measurement for max, and Claude Code says to test it before using it widely. Sonnet on xhigh or max also starts its own extra review agents, which burns usage.
7. **Lower the effort before you switch the model.** Anthropic says this is usually the better lever.
8. **Sonnet on medium or low needs two extra lines in its instructions.** The first says: run a real check before saying "done". Sonnet skips checks mostly on low. The second says: keep working until finished. On long jobs, Sonnet on low or medium tends to stop and ask. An agent that stops to ask has not finished its job.
9. **Use no model when a script can do the job.** That includes the audit pre-checks, counting skills, bringing a branch up to date, and the delete-and-retest loop.
10. **Switching to Sonnet saves usage because each word costs half as much. It does not give you a separate bucket.** The five-hour and weekly limits are shared by all models. Only the separate "Opus limit" and "Sonnet limit" caps are per model.

### The two Sonnet prompt lines (required whenever Sonnet runs at medium or low)

1. *"When you change code that can be run, built, or type-checked, run a real check that exercises the change before reporting it done: the project's tests, type-checker, or build, or the changed command itself. A syntax-only check, or a check command that failed to start, does not count. Only if no real check can run here, say which one you did not run and why instead of reporting the change as done."* (This adapts the wording in Anthropic's Sonnet 5.5 migration guide, "Verification on coding tasks".)
2. *"Keep working until the task is finished; do not stop to ask unless you are blocked on a decision that is not yours."*

### The matrix

Confidence levels:
- *documented*: a source says it for this model and this kind of task.
- *inferred*: it rests on older-model numbers or on fitting a general rule to this repo.
- *unverified*: no source supports it.

"Today" is the setting before this ADR.

| Task type | Model | Effort | Today | Why | Sources | Confidence |
|---|---|---|---|---|---|---|
| Final say: audit plan, final ruling, delta and final check (pr-merge-planner) | opus-5.5 | high | opus / high | Merge verdict is judgment. High is ADR 0090's current setting, chosen to keep cost bounded. No source recommends an effort for merge judgment. FrontierCode shows Opus 5.5 at medium 54.6% vs max 54.4%, so medium may cost nothing (fork F3). | .planning/decisions/0090-pr-audit-gate-autonomous-merge.md:228-235; .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):79; .claude/agents/pr-merge-planner.md:5-6; https://www.anthropic.com/claude-opus-5-5 (FrontierCode medium vs max) | inferred |
| Audit reviewers (pr-merge-auditor, pr-merge-adversary) | sonnet-5.5 | high | sonnet / high | Unattended code tracing. Medium risks stopping early; xhigh or max starts its own reviewers. This is the current setting, and the docs only say high for harder or longer work. FrontierCode: Sonnet 5.5 at max 46.2% vs Opus 5.5 54.4%. | .claude/agents/pr-merge-auditor.md:5-6; .claude/agents/pr-merge-adversary.md:5-6; https://platform.claude.com/docs/en/build-with-claude/effort (raw md line 314); https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5 (raw md lines 31, 57, 63); https://www.anthropic.com/claude-sonnet-5-5 | inferred |
| Plan (medium or large lanes) | opus-5.5 | medium | unset / unset | Plan text is judgment. Opus 5.5 at medium wrote better long analysis than Opus 5 at high. | .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):76; claude-api/shared/model-migration.md:2040 | inferred |
| Build: features and ordinary fixes | opus-5.5 | medium, redo at high via the verify then fix-round path | unset (inherits parent) / unset (inherits session) | Medium is about 70% of high's cost for about 2.5 points. The redo-failures policy was measured on Opus 5.5. The pipeline already escalates on a BLOCK. This departs from Claude Code's high-for-bug-fixes row (fork F1). | .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):75; https://code.claude.com/docs/en/model-config#choose-an-effort-level; https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence (raw md lines 289, 305) | inferred |
| Build: security, login, tenant isolation, migrations | opus-5.5 | high | unset / unset | Claude Code puts verification-heavy fixes at high. Caveat: cybersecurity-flagged requests re-run on Opus 4.8. | https://code.claude.com/docs/en/model-config#choose-an-effort-level; https://code.claude.com/docs/en/model-config.md:506-509; .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):75 | documented |
| Mechanical code lane (15 files or fewer) | sonnet-5.5 | medium + verification line + keep-working line | sonnet / unset | Tests and CI prove it. Medium is Sonnet's starting point for well-specified agentic coding. The two prompt lines address skipped checks and early stops. | claude-api/shared/model-migration.md:2178; claude-api/shared/model-migration.md:2202; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5 (raw md line 31); wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:88-89 | documented |
| Records/docs lane copying a decision already made | sonnet-5.5 | medium + both prompt lines | sonnet (records-refresh) or unset (carry-script lanes) / unset | Multi-step tool use checked by CI guards. PR-state cells still need a GitHub re-read (#492 had false cells). | claude-api/shared/model-migration.md:2178; .github/workflows/ci.yml:295-296; .planning/handoff/PROGRESS.md:60,74-76 | documented |
| ADR authoring | opus-5.5 | medium | unset / unset | Rationale and rejected alternatives are judgment. Opus 5.5 at medium produced better long analysis than Opus 5 at high. | claude-api/shared/model-migration.md:2040; wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:57-63 | inferred |
| Verify lane (independent refute pass) | sonnet-5.5 | high | sonnet / unset | The checks are mechanical, but PASS/BLOCK is judgment. High is by analogy to the audit reviewers. No source recommends an effort for verification (fork F7). | .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):77; claude-api/shared/model-migration.md:2178; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5 (raw md line 31); wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:98 | inferred |
| Fix round after verify or audit BLOCK (max 2) | opus-5.5 | high | unset / unset | Fixing a diagnosed bug is verification-heavy work. Rounds are few, so the cost is small. | .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):80; https://code.claude.com/docs/en/model-config#choose-an-effort-level; wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:102 | documented |
| Merge-train update and post | script first; sonnet-5.5 only on a conflict or CI failure | medium + both prompt lines | unset / unset | Merging main, waiting for checks and posting are deterministic. ADR 0231 §3 says to split the mechanical half off. | .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):78,85-91; .planning/handoff/merge-audited-pr.sh:8-13; claude-api/shared/model-migration.md:2178 | inferred |
| Census + cutover: measuring half (trial-delete loop, manifest) | script for the loop; sonnet-5.5 writes the manifest | medium | unset / unset | tsc, vitest and the import graph prove the measurements. Per-group advice goes to the founder as forks. | wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:64-74; .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):85-91 | inferred |
| Census + cutover: deleting half (L17 trial-cutover commit, cutover shell removal) | opus-5.5 | medium | unset / unset | Real code deletion (24 groups, 236 files) is build work beyond the 15-file Sonnet limit. | wf-scripts/web-rebuild-finish-lanes-wf_75eb7e91-5af.js:71; wf-scripts/cutover-finish-lanes-wf_ca16d61f-070.js:28-32; .planning/decisions/0231 (origin/docs/model-dispatch-adr-0231):75,81; .planning/handoff/PROGRESS.md:62 | inferred |
| Research: single-fact lookup (one search, one file) | sonnet-5.5 | low | sonnet / unset | Search is a documented low task. Tell it to use the tools, not training knowledge. | claude-api/shared/model-migration.md:2178; claude-api/shared/model-migration.md:2200 | documented |
| Research: source-gathering finders (multi-step) | sonnet-5.5 | medium + both prompt lines | sonnet / unset (research script finders) | Multi-step tool use is medium. Lower effort makes fewer tool calls, and a missed caller forces a redo of the whole research round. | claude-api/shared/model-migration.md:2178; https://platform.claude.com/docs/en/build-with-claude/effort (Effort with tool use) | documented |
| Research: fact sheet / design fork list | opus-5.5 | medium | unset / unset | Design forks are judgment. Opus 5.5 at medium is Anthropic's default start for agent workloads. | claude-api/shared/model-migration.md:2040; https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence (raw md line 259); wf-scripts/cutover-finish-lanes-wf_ca16d61f-070.js:33-34 | inferred |
| Decision research: first draft | opus-5.5 | medium | opus / high (set by this session's script :90, not an earlier practice) | Three Sonnet refutes and a high-effort ruling follow. Research curves are nearly flat (:161); the no-free-cut case (:163) is Fable 5 only (fork F8). | claude-api/shared/cost-optimization.md:161; claude-api/shared/cost-optimization.md:163; claude-api/shared/model-migration.md:2040 | inferred |
| Decision research: ruling | opus-5.5 | high | opus / high (set by this session's script) | Reconciling the refutations is the reasoning-limited step. | claude-api/shared/cost-optimization.md:163; CLAUDE.md:91,97; wf-scripts/model-effort-dispatch-research-wf_6e066105-189.js:131 | inferred |
| Decision research: refute passes | sonnet-5.5 | high | sonnet / high (set by this session's script) | Counterexamples are checkable. High keeps the attack thorough and avoids early stops at medium. | wf-scripts/model-effort-dispatch-research-wf_6e066105-189.js:117; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5 (raw md line 31) | inferred |
| Preserve triage (done; only if re-run) | judge opus-5.5; skeptic and record sonnet-5.5 | medium; classify scripts before any model | judge and record unset; skeptic sonnet / unset | 15 of 20 trees were placed by script. 'Still wanted' is the only judgment. Skeptic checks are mostly git diff and tests. | wf-scripts/preserved-work-triage-wf_a04dce51-4e6.js:36-37; wf-scripts/preserved-work-triage-2-wf_004116be-9e8.js:9,11,13; .planning/handoff/evidence/PRESERVE-TRIAGE-2026-09-28.md:40-46 | inferred |
| Audit pre-checks, census skills, merge execution, snapshot scripts | none | n/a | no model | A script is the check; no model call needed. | .claude/skills/pr-audit-gate/SKILL.md:46-63; scripts/agents/run_card.py:3-7; .planning/handoff/PROGRESS.md:22-33 | documented |
| CI backstop audit (scripts/pr_audit_gate.py) | leave as is | leave as is | claude-opus-5 / high | Not working (no API credit since 2026-09-12) and not required. ADR 0231 leaves the model ids set in code undecided. | scripts/pr_audit_gate.py:65,80; .claude/skills/pr-audit-gate/SKILL.md:158-163 | documented |

### Making the usage limits last

What the docs say:
- The **five-hour and weekly windows are shared across all models**, so switching with `/model` does not restore access. Only after the model-specific "You've hit your Opus limit" or "Sonnet limit" message does switching family keep work going (code.claude.com/docs/en/costs.md:197). That page describes Teams and Enterprise plans (costs.md:141). The founder's plan type was not checked.
- **Subagent and workflow agents draw on the same usage** (costs.md:322, :361).
- A **limit reset restores either the five-hour or the weekly limit, not both**. It applies account-wide, including Claude Code, and it cannot be triggered from inside Claude Code (support.claude.com/en/articles/17007452).
- The "20 subagents at once" cap is separate. CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS sets it, and no source says a reset changes it (sub-agents#concurrent-subagent-limit).

Levers, cheapest first:
1. **Set effort on every agent call.** Calls left blank copy the session's setting (sub-agents.md:315).
2. **Use a script before a model.** This covers the merge train, the delete-and-retest loop and the classify scripts.
3. **Move checkable work to Sonnet.** Its output costs $10 per million tokens against Opus's $20, so it uses fewer units of the shared window. It helps directly only if the Opus-specific cap is the one that was hit (see F5).
4. **Keep Sonnet at high or below.** On xhigh or max it starts its own reviewers. One prompt line cut session cost by about a third at max (Sonnet guide line 63).
5. **Do not split work across agents when one agent can do it.** On single-model work, the same model at lower effort was cheaper every time. This was measured on older models, so it is inferred (optimizing-for-cost line 512).
6. **Run cheap and redo only the failures.** For Opus 5.5 on tasks with real tests, starting on low and redoing failures on high gave about 97% for $0.17. Starting on medium gave about 97% for $0.24. Running everything on high gave 95.3% for $0.29 (optimizing-for-cost line 305). For Sonnet this is inferred.
7. **Keep the same model and effort within a role.** Agents with the same model, effort, tools and schema share the prompt cache (workflows.md:350), so set them by role, not per lane.
8. **A time budget is mainly for speed.** On the Opus guide's research teams, a budget made teams finish sooner at comparable quality, but it does not reduce the work (Opus guide line 121). The cost page reports 28-54% lower cost per task with an elapsed-time clock, and scores up to 1.9 points lower (optimizing-for-cost lines 35, 366). That is inferred for this repo.

**Did the agent limit reset? Not verified.** No doc or repo file can read the account's quota. There are weak signs that dispatch works now: all four research agents in this run returned, and this ruling agent ran on Opus 5.5 with `CLAUDE_EFFORT=high` in its environment, which matches the script's setting. The pick-up card still says the weekly limit resets on 2026-10-02 at 15:00 UTC (PROGRESS.md:10-16). A reset restores only one of the two limits. The founder should check `/usage` or Settings > Usage.

## Consequences

- **Easier:** a lane's cost is predictable from its role, and small jobs stop paying for high effort. Agents sharing a role share a prompt cache.
- **Easier:** checkable work (records, mechanical lanes, finders) goes to Sonnet at medium, at half Opus's price per word.
- **Harder:** every Workflow script and Agent call has to set two fields. A missing effort field silently copies the session.
- **Given up:** measurement on this repo's own work. Every effort choice rests on Anthropic's published guidance, which is why so many rows read *inferred*.
- **Owed, and accepted by the founder as "test later":**
  - (a) Compare Sonnet medium with Opus low on 20–30 frozen past lanes, by cost per finished task.
  - (b) Replay about 20 past audits with the planner at medium, and compare the BLOCK/HOLDS calls.
  - Either result can change a row here. It does so through a dated amendment.
- **Revisit when:** a Sonnet-at-medium lane is later BLOCKed for a missing check or an unfinished job (raise that role to high). An Opus-at-medium build needs two fix rounds (move its category to the high list). Anthropic republishes effort guidance for these models.

## Open items not decided here

The forks are F1-F9 (see forks). One more item is not a fork: visual checks such as screenshots and charts. On charts, Opus 5.5 on low beat Opus 5 on max (model-migration.md:2042). Sonnet 5.5 with crop and zoom tools on high read charts better than Sonnet without tools on max (model-migration.md:2204). No source covers UI screenshots, so decide this when a visual lane exists.

**Shortcuts taken:**
- No eval was run on this repo's lanes. Every effort choice comes from Anthropic's guidance, not from measurement here.
- The parent session's model and effort were not read.
- I re-checked these myself: ADR 0231:75-80 and :99-101; PROGRESS.md:37, :239, :254-256; pr_audit_gate.py:498, :504, :505; ADR 0090:228-236; the carry script's lanes (:20-35); `CLAUDE_EFFORT=high` in this agent's environment; Claude Code 2.1.284.
- These are taken from reviewer fetches and were not re-fetched by me: costs.md:141, :197, :322, :361; workflows.md:350, :423; sub-agents.md:362-411; the cost page at lines 35 and 366; model-config.md:46-48, :64, :506-509; the FrontierCode figures.
- The "40 audited PRs" count behind the F3 replay was not re-checked.

## Research record (forks as put to the founder)

1. **F1. Build lanes: what effort for Opus?** Options: Medium by default for features and ordinary fixes, letting the existing verify then fix-round-at-high path redo failures; high only for a named list (security, login, tenant isolation, migrations) / Medium for features, high for every fix / Low by default, redo failures at high / High for every build lane. Recommended: Option 1. Nearly every current lane is a fix, so option 2 means high almost everywhere. The redo path already exists.
2. **F2. Lanes a check can prove: Sonnet on medium, or Opus on low?** Options: Sonnet medium + both prompt lines / Opus low / Run a small eval (20-30 frozen past lanes) and pick by cost per finished task. Recommended: Sonnet medium now, and run the eval later. Anthropic publishes benchmark comparisons mostly at max. Its cost-by-effort charts are images, so no cost-per-task figure for the two at the same effort could be read as text.
3. **F3. Audit planner: keep high or drop to medium?** Options: Keep high (ADR 0090 as locked) / Drop to medium / First replay about 20 past audited PRs at medium and compare the BLOCK/HOLDS calls. Recommended: Keep high, and run the replay when capacity allows. It is the merge gate and a locked, gate-owned decision. FrontierCode (Opus 5.5 medium 54.6% vs max 54.4%) suggests medium may lose nothing. Keep the two Sonnet reviewers at high whatever happens here.
4. **F4. How to make sure no agent runs on an inherited model or effort?** Options: Require model and effort on every agent() call in every script / Also set CLAUDE_CODE_SUBAGENT_MODEL=opus as a model-only fallback for unset calls / Leave inherit. Recommended: Require both on every call. It is the only way to set effort. The env var sits below the per-call model and the frontmatter, so it never touches the pr-merge agents. Never set CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1: it overrides every agent's model, including ADR 0090's Opus planner.
5. **F5. Which limit was reset, and which one stopped work?** Options: Five-hour window / Weekly window / Opus-only cap / Unknown - check /usage or Settings > Usage. Recommended: Check /usage before re-running the nine failed lanes. A reset restores only one window. The card says the weekly one was hit (resets 2026-10-02 15:00 UTC). Moving work to Sonnet helps against an Opus-only cap directly, and against the shared windows only through a lower price per token.
6. **F6. Use Haiku 4.5 for single-fact lookups?** Options: One-week trial of a custom Explore agent with model: haiku, single-fact lookups only / No, Sonnet low. Recommended: Not now: use Sonnet on low. Haiku scored 63% vs 92% for Opus 5.5 on GPQA, and it is weaker in multi-step loops. The retirement date (not before 2026-10-15) matters only if a script hard-codes the id. Whether Haiku draws on its own limit bucket is not documented.
7. **F7. Verify lane: Sonnet high or Sonnet medium?** Options: High (by analogy with the audit reviewers) / Medium + both prompt lines, moving to high only if verify passes lanes that the audit later BLOCKs. Recommended: Keep high for now. Verify is unattended, and Sonnet's tendency to stop early on medium is documented. Revisit after two rounds of data.
8. **F8. Decision research: first draft at medium or high?** Options: Draft Opus medium, ruling Opus high / Draft and ruling both Opus high (this session's script). Recommended: Draft at medium and rule at high. Three high-effort refutations follow the draft. The evidence for high rests on one Fable 5 curve, and the curve next to it is nearly flat. If the founder wants uncapped depth under CLAUDE.md §0.6, pick option 2 and say that is the reason.
9. **F9. Where does the effort decision live?** Options: New ADR 0237, bundled with the ADR 0090 amendment in one gate-owned PR / Add the effort column to ADR 0231 inside PR #490 before it merges. Recommended: New ADR 0237 in one bundled gate PR. 0231 is already marked Locked as approved, and §5 explicitly leaves effort out, so changing it inside #490 would blur what the founder approved.

### Reviewer rulings

Evidence reviewer:
- Separate limits: **accepted**. Rewrote §3 and rule 10. The windows are shared, and only the model-specific caps are per family.
- Time-budget lever: **accepted**. It is now a speed lever, says "comparable" quality, and cites the cost page (reviewer-reported).
- F4 "not documented": **accepted**. Model precedence is documented, FORCE=1 hazard added, and the env var sets only the model.
- Rule 3 and "proven to work": **accepted in part**. Inheritance is documented (sub-agents.md:315). "Proven" was dropped. This agent's `CLAUDE_EFFORT=high` is weak evidence that the setting takes effect.
- Verify cited 0231:80: **accepted**. It is now 0231:77, verified by git show.
- Audit rows "documented": **accepted**. Downgraded to inferred as current settings, and line 289 dropped.
- F3's 30%: **accepted**. It is now "up to about 30% if the coding curve carried over; not measured".
- Visual row wording: **accepted**. Wording fixed and the row moved to open questions.
- F2 "no head-to-head": **accepted**. Reworded, and the FrontierCode gap added to the reviewer row.
- Rule 8 blended two behaviours: **accepted**. Split into skipped checks and early stops, with the keep-working line on all Sonnet medium rows.
- Rule 6 on max: **accepted**. xhigh is measured; max is unmeasured, and Claude Code says test it first.
- Rule 4 "beats": **accepted**. Now "matched or beat, in Anthropic's tests".
- Decision research "Today" column: **accepted**. Now says "set by this session's script", and cites :161 and :163.
- Subagents "inferred": **accepted**. Documented, costs.md:322, :361.
- Security fallback and missing Plan row: **accepted**. Caveat and Plan row added.

Mechanics reviewer:
- ADR 0090 edit: **accepted**. Verified gate-owned at pr_audit_gate.py:504. Replaced with a dated amendment in the gate PR.
- "Next free past main": **accepted**. Now 0237 per PROGRESS.md:37, check all branches, and the README makes the PR gate-owned.
- F4 errors: **accepted**, merged with the evidence reviewer's point. settings.json is gate-owned (verified :498).
- Census and cutover as Sonnet/medium: **accepted**. Split into a measuring half (script plus Sonnet) and a deleting half (Opus).
- Carry script has no research lanes: **accepted**. Verified lanes 21-28, now listed per lane.
- Verify citation: **accepted**, a duplicate of the evidence reviewer's point.
- Alias caveat: **accepted**. One line added in the header.
- PROGRESS citation and single source of truth: **accepted**. Now :254-256, and the ADR wins on conflict.
- Cache sharing: **accepted**. Added as lever 7 (reviewer-reported).

Efficiency reviewer:
- F3 misses FrontierCode: **accepted**. Medium 54.6% vs max 54.4% added. Keep high until a replay of past PRs.
- Build lanes pay for high twice: **accepted as a fork**. F1 now recommends medium plus redo, with high for a named risk list. Fix rounds stay high because they are few.
- Net spend unknown (blocking): **accepted in part**. The parent model cannot be read from a subagent, so `/status` is now a pre-step and the spend direction is stated. Rule 3 is documented, so it stays.
- Lever 2 separate pool: **accepted**, same as the evidence reviewer's point. Linked to the F5 `/usage` check.
- Prompt lines only on the mechanical row: **accepted**. Both lines are now on every Sonnet medium row.
- Merge train and census belong in scripts: **accepted**. Rows are now script-first.
- Plan and delta rows missing: **accepted**. Added a Plan row, and delta and final check are folded into the final-say row per 0231:79.
- Sonnet low for gathering: **accepted**. Low is only for single-fact lookups; finders are medium.
- Decision draft at high: **accepted as fork F8**. Recommend a medium draft and a high ruling.
- Verify at high by parity: **accepted as fork F7**. Recommendation kept at high because the medium early-stop risk is documented for unattended Sonnet.
- Haiku reasoning: **accepted**. F6 rewritten on the real trade-off (63% vs 92%), and whether Haiku has its own limit bucket is unknown.
- Too much repo overhead: **accepted in part**. Only re-run scripts get settings, and the ADR and the 0090 amendment are bundled into one gate PR. Folding into #490 is rejected in F9 because 0231 is already locked as approved.
- Skeptic at high: **accepted**. Triage row now medium with the classify scripts first.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-28 | Workflow `wf_6e066105-189`: 4 finders, an Opus draft, 3 Sonnet refute passes, Opus adjudication | Matrix of 22 task types; 9 forks for the founder |
| 2026-09-28 | Aldemir (founder) | Chose the recommended option on all four questions (verbatim above). Locked |
