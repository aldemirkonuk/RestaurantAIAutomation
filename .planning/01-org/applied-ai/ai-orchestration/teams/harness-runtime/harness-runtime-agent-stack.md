---
type: agent-stack
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: designed
updated: 2026-08-27
metrics: [nf_a.retries, nf_a.dlq_depth, harness.agents_without_harness_guarantees]
links: ["[[harness-runtime-charter]]", "[[harness-runtime-schedule]]", "[[harness-runtime-loops]]", "[[harness-runtime-directive]]", "[[0034-agent-stack-artifact]]", "[[ai-orchestration-agent-stack]]", "[[agent-fleet-charter]]"]
---

# Harness & Runtime — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The team that owns the harness gets the most constrained card in the vault: while
> OD-03 is open this team is on a stated diet (bug fixes, instrumentation, interface
> *narrowing* — [[harness-runtime-directive]]), so its agent measures and reports and
> is forbidden from extending the thing it watches.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `harness-sentinel` | Keep the three harness health numbers true — retries/DLQ depth, modules doing agent work outside `BaseAgent`, and the OD-03 sunk-cost meter — and report them without touching the harness | NEW |

## 2. Agent cards

```yaml
agent: harness-sentinel
unit: harness-runtime
triggers:
  - schedule: "weekly (before the aio board rollup)"       # mirrored in [[harness-runtime-schedule]]
  - topic: agents.module_added                              # publisher: NONE (gap — today only PR review notices a new agents/*.py)
consumes:
  - services/agent-orchestrator/core/ and agents/ (disk census)
  - the registration map at core/orchestrator.py:174-211
  - nf_a events (retries, dlq_depth fields — ADR 0008)
emits:
  - the census facts → memory PRs (see §4)
  - "harness.agents_without_harness_guarantees to [[ai-orchestration-agent-stack|aio-orchestrator]]'s board rollup"
  - nf_a events (task_type: harness_audit)
routing_class: mechanical      # grep, count, diff — no judgment call anywhere in the loop
quality_bar: "census reproducible: a rerun on the same commit yields the same four counts; NONE (gap) — no formal verdict basis exists for audits yet (ADR 0017 has no such grader)"
autonomy:
  read: autonomous
  propose: autonomous          # findings land as memory PRs and board rows
  mutate_stock_money_outbound: confirm   # constant; and this agent must not write code at all — the OD-03 diet
memory: harness-runtime
escalates_to: "[[ai-orchestration-charter]]"
```

**The card's own hard rule:** `harness-sentinel` never edits `core/`. A sentinel
that patches what it measures is how a team picks OD-03 by accident
([[harness-runtime-charter]] §The fork).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `harness-contract-audit` | T2 | Weekly, and whenever a new `agents/*.py` lands | The four-counts table (on disk / subclassing / registered / can receive) matches disk, and every module outside the contract is named with `path:line` | The 2026-08-24 session that found `recurring_order_agent.py:14` is a plain class — no retry, idempotency, DLQ, health, or NF-A — while owning scheduled purchasing ([[harness-runtime-charter]] §Evidence) | NEW |
| `od03-diet-check` | T2 | Any PR touching `services/agent-orchestrator/core/` | A verdict: bug fix / instrumentation / narrowing → pass; extension → flagged with the diff lines; plus the updated `core_lines_added_since_od03_opened` number | The metric exists on the charter precisely because nobody was counting; 6,375 core lines predate the meter | NEW |

Consumed, owned elsewhere: none yet — this team's skills are self-contained audits.

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: harness_audit`; the retries/dlq_depth fields exist
  in the NF-A schema and are **not emitted** (charter §Metrics) — the sentinel
  consumes them the day they are, and until then its episodic layer is audit runs only.
- **Semantic** — `memory/` beside this file, `harness-runtime-MEMORY.md` as index.
  The founding facts are already known and would be its first two files: the
  `recurring_order_agent` contract gap (source: charter §Evidence, 2026-08-24), and
  the OD-03 diet line-count baseline. Provenance frontmatter per ADR 0034; every
  write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate. `core/` modules are
  retrieval targets by `path:line`, never preloaded (2,046-line `database.py` is a
  grep target, per CLAUDE.md §2).

**Consolidation** — monthly: diff the census against last month's facts; a module
that entered or left the contract becomes a fact naming the mechanism; expire facts
unverified 90 days; propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction: the weekly board row to the department (vault PR), NF-A
events, and loops in [[harness-runtime-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `agents.module_added` has no publisher | Nothing emits on a new module; the weekly schedule bounds the blind spot at 7 days |
| `nf_a.retries` / `nf_a.dlq_depth` not emitted | Schema fields exist, emission does not — the sentinel's primary numbers arrive only when the fleet's instrumentation lands; until then the census is the whole job |
| DLQ consumption is unowned | We declare and fill the DLQ; who reads it is a live gap named in the charter (§Non-goals) — the sentinel *reports* depth, it must not become the consumer by default |

## 6. Evidence today

- **NEW — the sentinel and both skills.** Nothing runs these audits today; they were
  done by hand in the 2026-08-24 generation session, which is the past instance that
  justifies them.
- **EXISTS — everything the sentinel would measure.** The harness itself
  (`core/base_agent.py:348-436,543,704,791,823-905`), the registry
  (`agent_registry.py:27,162,299,401`), the bus (`message_bus.py:188,524`), 80
  pytest files — all cited in [[harness-runtime-charter]] §Evidence.
- **PARTIAL — the metric substrate.** NF-A schema carries the fields; nothing emits
  them.
