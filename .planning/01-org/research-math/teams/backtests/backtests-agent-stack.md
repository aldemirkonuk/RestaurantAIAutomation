---
type: agent-stack
division: research-math
department: research-math
team: backtests
status: designed
updated: 2026-08-27
metrics: [bt.scenario_coverage_pct, bt.claim_falsification_rate, bt.outcome_regrade_delta]
links: ["[[backtests-charter]]", "[[backtests-schedule]]", "[[backtests-loops]]", "[[backtests-directive]]", "[[backtests-premortem]]", "[[0034-agent-stack-artifact]]", "[[research-math-agent-stack]]", "[[SCENARIO-CONTRACT]]", "[[0008-nf-column-contract]]", "[[skills-charter]]"]
---

# Backtests — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is the thinnest stack in the department, and that is the honest state: the team
> was founded 2026-08-24 by founder direction and its charter says plainly *"Nothing
> exists. No harness, no backtest, no replay."* The card below is a contract for the day
> the entry trigger is confirmed — it is not a description of anything running.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `claim-replayer` | Replay a published claim or a graded outcome against data it did not see when it was made, and file a finding at the owning unit when it does not survive | NEW |

## 2. Agent cards

```yaml
agent: claim-replayer
unit: backtests
triggers:
  - schedule: "fortnightly — claim replay over anything newly published"   # [[backtests-schedule]]
  - schedule: "monthly — outcome re-grade sweep; coverage report per scenario class"
  - topic: claim.published        # publisher: NONE (gap — no unit emits when it publishes a number)
consumes:
  - neural_footprint_event rows carrying outcome_basis — publisher: model-client.service.ts:413, spend_logger.py:406
  - the 17 scenarios' §9 simulation gates — publisher: "[[SCENARIO-CONTRACT]]" (specified; nothing executes them)
  - injected / synthetic corpora — publisher: "[[synthetic-generation-simulation-charter]]" (gap — unbuilt)
emits:
  - bt.* onto "[[backtests-agenda-board]]", reported per scenario class and never as one number
  - a finding at the owning unit with the advisory 42-day age-out — consumer: that unit's questions.md
  - an unfalsifiable-claim record — consumer: same; per [[backtests-directive]] an unfalsifiable claim is itself a finding
  - nf_a events (task_type: backtest_replay) — consumer: "[[neural-footprint-instrumentation-charter]]"'s contract
routing_class: judgment          # replaying is mechanical; deciding whether the scenario's §9 gate was met is not
quality_bar: "the re-grade scores against the scenario's own §9 gate, never against the agent's self-report; NONE (gap) — ADR 0017 grades tasks, and no verdict basis grades a backtest"
autonomy:
  read: autonomous
  propose: autonomous            # findings and re-grades land as PRs
  mutate_stock_money_outbound: confirm    # constant; this agent replays, it never re-runs a live action
memory: backtests
escalates_to: "[[research-math-charter]]"
```

**The card's own hard rules.** The replayer never edits the claim it falsifies, and it may
not replay against data the system already saw — that is a confirmation, and a team that
confirms is [[backtests-premortem]] M3. A falsified claim republished unchanged goes to
`OPEN-DECISIONS.md`, not to a second finding ([[backtests-directive]] §Escalation trigger).

## 3. Skills

*(empty)*

**No rows, and that is the correct answer.** §3.3 requires a real past instance, and this
team has no past — no replay has ever been run here. [[backtests-schedule]] says the same
in the same words and names `scenario-replay` as the obvious first skill, **proposed only**.
It becomes a row in this table on the day it has run once, not before.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); doneability
definitions ([[evaluation-doneability-charter]] — we supply the empirical delta, they define).

## 4. Memory

- **Procedural** — nothing yet, by the §3 rule. Consolidation may only propose a skill
  after a replay has actually run; candidates go to [[skill-harvesting-charter]]'s queue
  and still face the §3.3 gate.
- **Episodic** — nf_a `task_type: backtest_replay`, plus read access to the rows being
  re-graded. Needs `context.scenario_id` **and** `context.scenario_class` as jsonb keys,
  or coverage collapses into a single number — which is precisely the shape
  [[backtests-premortem]] M1 says hides a team drifting to the tractable corner.
- **Semantic** — `memory/` beside this file, indexed by `backtests-MEMORY.md`. One fact per
  replay that changed a belief: the claim, the data it had not seen, the mechanism by which
  it failed. Frontmatter carries `source`, `confidence`, `last_verified`; every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the one scenario under
  replay. The scenario corpus is a retrieval target, never preloaded.

**Consolidation** — monthly, mirrored in [[backtests-schedule]]: read the replay slice since
the last run; **failures first** — every survived-but-barely and every falsification becomes
a fact naming the mechanism, not the score; expire facts unverified for 90 days. A quarter
of zero falsifications is written up as a *finding about the suite*, not as a clean bill
(premortem M3). One PR; "no delta" stated when true — and while the team is dormant, "no
delta, still dormant" is the whole report.

## 5. Async contract

Cross-unit interaction is loops ([[backtests-loops]] — all three currently `blocked` or
`proposed`), NF-A events, vault PRs and findings. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `claim.published` has no publisher | Nothing announces that a number was published, anywhere in the org. The fortnightly schedule is the only trigger, so a claim can stand unreplayed for two weeks by construction |
| Synthetic generation is unbuilt | [[synthetic-generation-simulation-charter]] is the named producer and does not exist, so injected data would today be authored by people who know the system — [[backtests-premortem]] M4. The author ≠ auditor split is **declared and unenforced** until that team ships |
| Findings arrive as a doc edit, unnotified | The 42-day age-out runs whether or not the owning unit reads it; premortem M2 is a delta published twice with no row filed |
| No provider of adversarial cases | The premortem assigns them to Red Team; no channel from [[red-team-charter]] to this team exists yet |

## 6. Evidence today

- **NEW — everything.** The replayer, the harness, the memory layers. [[backtests-charter]]
  §Evidence is unambiguous: no harness, no backtest, no replay.
- **The entry trigger now reads as met, and confirming it is the card's first act.**
  The charter gates this team on the first rows carrying `outcome_basis: call_level_v0`.
  `neural_footprint_event` has emitted since P1 (`model-client.service.ts:413`), and
  `.planning/STATE.md:98-105` records 26 of 38 task types above `call_level_v0` with **12**
  on a shrink-only exemption list — i.e. rows to re-grade almost certainly exist. This doc
  may not declare the trigger met; the team must check and record it.
- **PARTIAL — what could be replayed against.** The 17 scenarios' §9 simulation gates
  specify the runs; nothing executes them. `scripts/watch_loops.py` already watches the
  2026-10-23 staleness cliff that [[backtests-premortem]] M5 names — if it fires with this
  team still dormant, the honest action is an explicit park, not quiet maintenance.
