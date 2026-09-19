# 0050 — Session agents are dispatched on a hardness score: below the line Sonnet, at or above it Opus

- **Status:** Locked — founder directed the policy in-session 2026-09-01; the calibration below is the session's, and is the revisitable part.
- **Date:** 2026-09-01
- **Decider:** Aldemir (founder), 2026-09-01 — phrasing: *"create a hardness threshold and if below deploy sonnet, otherwise opus"*
- **Keywords:** agent dispatch, subagent, model routing, hardness, sonnet, opus, session discipline, cost
- **Links:** [[0036-cost-routing-two-plans-in-harmony]] (**different subject — see Boundary below**), [[0003-session-output-discipline]], [[0049-ecosystem-division-layer]], [ECOSYSTEM-PLAN.md](../04-specs/ECOSYSTEM-PLAN.md)

## Boundary — what this ADR is *not*

**Current routing amendment: 2026-09-16.** Aldemir requested cheaper discovery,
shared-topic session coordination, and one Opus planner with two Sonnet PR reviewers.
The amendment below supersedes conflicting tier defaults in the original record;
the original reasoning and examples remain historical evidence. AGENTS.md is unchanged.

### Current tiers

| Work | First choice | Escalation |
|---|---|---|
| Indexes, hashes, counts, exact checks | Script, no model | Fail loudly on ambiguous input |
| Read-only classification or file/symbol discovery with checkable citations | Haiku | Sonnet if categories or evidence are ambiguous |
| Bounded investigation, implementation with tests, independent review | Sonnet | Opus for consequential unresolved judgment or failed reasoning |
| Architecture/product forks, irreversible decisions, high-risk final judgment | Opus | Founder where intent or authority is unresolved |

Haiku is not a universal substitute for Sonnet. It is useful when a wrong answer
is cheap to detect, the rubric is explicit, and no approval or safety decision is
delegated. Prefer deterministic parsing to either model. Keep the original five-axis
score for judgment tasks; high-consequence overrides still apply to decision authority.
The explicit PR-audit exception delegates evidence investigation to two Sonnet
reviewers while Opus retains planning and final judgment (ADR 0090 amendment).

A discovery handoff contains: question, source revision, file/symbol citations,
finding, verification command/result, uncertainty, and changed dependencies. Opus
checks decisive claims in the original source; it need not reread every discovered
file. A missing link, stale hash, contradiction, or consequential uncertainty triggers
targeted rereading or escalation. Summaries alone never authorize a risky change.

### Bound the work, not the research

At the start record the intended outcome, owned files/interfaces, relevant risks,
acceptance checks and stop/escalation conditions. A routine copy/layout change does
not automatically require tracing unrelated database, worker and deployment layers.
An auth, money, cross-runtime or migration change does require the relevant end-to-end
trace. Research depth stays uncapped, including parallel Workflow research. Expand
scope when evidence shows a dependency; record why, rather than silently expanding
the whole assignment. Finish when the agreed checks pass and material gaps are named.

### Multiple sessions on the same topic

Use one existing canonical task note as a versioned brief, not one new plan per chat.
Planning and execution are separate roles and document sections, not separate repos
by default. The integrator owns the shared brief and merges; workers own separate
worktrees and explicit file ranges or interfaces. Readers may overlap deliberately
for independent review. Two sessions must not independently edit the same owned files.

Minimum brief (aim for one page, not a hard research limit):

```text
Task ID / brief revision / base commit:
Outcome and acceptance checks:
Relevant ADRs and evidence pointers:
Owner -> subquestion -> edit ownership -> worktree -> status:
Dependencies and changes since previous revision:
Risks, unresolved questions and escalation conditions:
Results / tests / integration status:
```

Each worker returns only changed findings, evidence links, exact commit/file hashes,
test results and blockers. Send updates on a milestone, changed assumption, conflict
or blocker; avoid repeatedly asking every session for status. Before integration,
compare the worker's dependency hashes with the integration tree. Revalidate changed
dependencies, not all earlier research. One integrator allocates ADR numbers and
updates shared indexes; this avoids the collision recorded in DECISION-INDEX.md.

### Small output and current measurements

Keep an unchanged evidence block out of repeated messages. Write one durable finding,
link it elsewhere, append meaningful deltas, and report passing tests by command and
summary. Preserve the relevant error excerpt when a test fails. Do not ask workers
for long reports only to have Opus rewrite them. Target 250 words for a review plan
and 700 per review; important findings and research are never cut to meet a target.
Short visible prose does not guarantee low thinking-token usage; measure both.

The website need not freeze to measure efficiency. Record task ID, category, risk,
source/brief revision, model/effort, request count, input/cache-write/cache-read/output
tokens, elapsed time, retries, completion and rework. Compare distributions within
task/risk groups and track overhead per completed outcome, not raw daily spend or
lines changed. Include failed and abandoned work. An exact evidence fingerprint can
identify a duplicate review; changed evidence must be revalidated, never treated as
an old approval. Do not make extra paid calls solely to benchmark this policy.

CI telemetry is implemented in scripts/pr_audit_review.py. Cost uses a dated standard
API rate card, not the subscription's undisclosed allowance formula. Unknown usage
or model pricing remains unknown. Measure claimed savings after real completed work;
no percentage is promised in advance.

### Repository separation and archival

Start with the existing generated decision index and targeted excerpts. Keep active
briefs separate from research evidence and completed reports within the vault. Move
files physically only when lifecycle or access boundaries justify it. Archival first
needs an inbound-link check, no unresolved dependency, and a manifest preserving
original path, date, revision and replacement link. Do not archive active ADRs or
delete rationale merely to save tokens: unread files cost no model tokens. No bulk
archive or project-wide source decomposition is authorized by this amendment.

Tradeoffs: small briefs reduce repeated orientation but can go stale; hashes and
revision checks address that. Tiered models reduce unit cost but can create rework;
escalate on evidence, not repeated cheap retries. Separate repos reduce accidental
search scope but add synchronization and permissions overhead, so they are not the
default. Large modules merit symbol-focused reads now and gradual decomposition
when maintenance or tests justify it, not a token-driven rewrite.

Sources checked 2026-09-16: [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[Claude Code subagents](https://code.claude.com/docs/en/subagents). Implementation
base: 60ed83a7e6d5eb8b8e0e631783a598cd0f562bff. This is session/CI policy only,
not a change to product model routing or a claim that the branch is deployed.

ADR 0036 governs **the product's** model calls: the production routing policy behind
`common/model-client`, and the RM-1/`aio-model-routing` methodology-vs-operation line.
Its metric is NF-A cost per task — *the platform's* spend on *its users'* work.

This ADR governs something else entirely: **which model a working session gives its own
subagents.** Different spender, different budget, different failure mode. The two must
not be merged, and a change to one implies nothing about the other. They meet at exactly
one point: both exist because unpriced model choice defaults to the most expensive
option, every time, and nobody notices.

## Context

Sessions here fan out — the ecosystem build dispatched seven agents in one pass. Until
now every one of them silently inherited the parent's model. That is wrong in both
directions: a census that greps for route decorators does not need the frontier model,
and a design that will spend a restaurant's money at a real vendor must not be run on
a cheap one to save a few cents. The founder asked for an explicit line.

The trap to avoid: scoring **mechanical effort**. Effort is the wrong axis. Counting
every unauthenticated endpoint in the gateway is mechanically trivial — one grep — and
yet four previous passes produced four different numbers, because the hard part was
never the counting. It was *deciding what counts as a defect*. A task is hard when its
output **encodes judgment that is expensive to get wrong**, not when it touches many
files.

## Options considered

1. **Score judgment-and-consequence on five axes, threshold at 4/10.** ✅ Chosen.
2. **Route by task category** (research → Opus, census → Sonnet). Rejected: the
   categories leak. The auth census is a "census" that carries a security decision;
   the division census is a "research" task that is pure enumeration.
3. **Route by expected token volume.** Rejected: measures effort, which is the axis
   this ADR exists to reject. Long and easy is common; short and irreversible is worse.
4. **Always Opus, accept the cost.** Rejected by the founder's instruction, and on
   merit: it removes the forcing function that makes a session ask what a task is
   actually worth.

## Decision

Score every dispatched agent 0–2 on five axes, sum to 0–10:

| Axis | 0 | 1 | 2 |
|---|---|---|---|
| **Blast radius** — what a wrong answer touches | docs, scratch, read-only findings | repo code behind tests | production, money, auth, tenancy, secrets, an outward send |
| **Reversibility** | one revert | revert plus cleanup | irreversible, or already seen by someone outside |
| **Ambiguity** | determined by the codebase | judgment among known options | an open fork, or the unit of measure itself is contested |
| **Span** | one file or module | several modules, one runtime | crosses runtimes, divisions, or the schema |
| **Verification cost** | a grep or an existing test proves it | needs a test written, or a run | cannot be proven locally — needs production, Docker, or reasoning about an absence |

**Total ≤ 3 → Sonnet. Total ≥ 4 → Opus.**

**Overrides to Opus, whatever the score.** The task writes a migration or touches
production; touches auth, tenancy, secrets, or the commitment/UCC guardrail; produces or
amends an ADR, or resolves a founder fork; sends anything outward to a vendor or guest;
or deletes more than it creates.

**Override to Sonnet, whatever the score.** The output is a pure enumeration in which
every claim is mechanically checkable and no recommendation is attached. If a task has a
separable cheap half, **split it and route each half** rather than paying frontier price
for the enumeration — a census that feeds a decision is two tasks, not one.

## Worked example — the seven agents dispatched 2026-09-01

The scores below produced the split before this ADR was written; it records a rule the
session already ran, not one it intends to.

| Agent | Blast | Rev | Amb | Span | Verify | Total | Model |
|---|---|---|---|---|---|---|---|
| Division census | 0 | 0 | 1 | 1 | 0 | **2** | Sonnet |
| STATE/PROJECT true-up | 0 | 0 | 1 | 1 | 0 | **2** | Sonnet |
| Insight-count reconciliation | 0 | 0 | 1 | 1 | 0 | **2** | Sonnet |
| Auth-by-omission census | 2 | 0 | 1 | 2 | 1 | **6** | Opus (+auth override) |
| POS pipeline unification | 1 | 1 | 1 | 2 | 1 | **6** | Opus |
| Cross-runtime send durability | 2 | 1 | 1 | 2 | 2 | **8** | Opus |
| Hop-4 sense→act bridge | 2 | 1 | 2 | 2 | 2 | **9** | Opus (+open-fork override) |

The auth census is the case that proves the rubric is scoring the right thing: it is
read-only and one grep wide, and it still scores 6 — because the four prior numbers
disagreed about the unit, and the output carries a global-guard decision. Effort-based
routing would have sent it to Sonnet and bought a fifth number nobody trusts.

## Consequences

- Easier: model choice becomes a stated, auditable judgment instead of a default. Cheap
  work gets cheap agents, so a session can fan out wider for the same spend.
- Harder: every dispatch now owes a score. The cost is small and the scoring is the
  point — it forces the question "what does being wrong here cost?" before the spawn.
- The threshold at 4 is a calibration, not a principle. **Revisit it when a Sonnet-routed
  agent returns an answer that had to be redone on Opus** — that is the signal the line
  sits one notch too high. The reverse signal (Opus agents returning work Sonnet could
  have done) is weaker evidence and should not move the line on its own.
- Not decided here: whether a pointer to this rule belongs in CLAUDE.md, which is the
  founder's call and would spend some of its ~200-line budget.
