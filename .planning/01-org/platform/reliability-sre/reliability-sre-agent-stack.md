---
type: agent-stack
division: platform
department: reliability-sre
status: designed
updated: 2026-08-27
metrics: [nf_a.emission_coverage, sre.time_to_revert, sre.dlq_depth_and_oldest_age, sre.mttd_silent_corruption, sre.days_since_verified_restore]
links: ["[[reliability-sre-charter]]", "[[reliability-sre-schedule]]", "[[reliability-sre-loops]]", "[[reliability-sre-agenda-board]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[harness-runtime-charter]]", "[[action-safety-the-human-gate-charter]]", "[[observability-telemetry-plumbing-agent-stack]]", "[[release-engineering-agent-stack]]", "[[runtime-resilience-agent-stack]]", "[[state-integrity-invariants-agent-stack]]"]
---

# Reliability / SRE — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department's agent does **department** work only: hold four incommensurable team
> numbers on one board without averaging them, and chase the queues and gates that have no
> owner. It never emits a metric ([[observability-telemetry-plumbing-charter]]), runs a
> drill ([[release-engineering-charter]]), triages a message
> ([[runtime-resilience-charter]]) or grades a finding
> ([[state-integrity-invariants-charter]]). The mechanisms are referenced, never restated.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `sre-board-orchestrator` | Keep the five department numbers on one board with "unmeasured" and "never happened" rendered as themselves, and escalate any loop past its `close_time` or any queue/gate with no named owner | NEW |

One row deliberately. Each of the four questions this department owns — does the signal
exist, can we put it back, does it survive partial failure, is it quietly wrong — already
has a team agent. The department's charter forbids rolling them into one number
([[reliability-sre-charter]] §Metrics); an agent that did so would be the failure it warns of.

## 2. Agent cards

```yaml
agent: sre-board-orchestrator
unit: reliability-sre
triggers:
  - schedule: "weekly (red-signal audit L-SRE-1, signal-liveness L-SRE-2, unowned-queue sweep L-SRE-4)"  # [[reliability-sre-schedule]]
  - schedule: "quarterly (recovery-path proving L-SRE-3, rejected-team trigger watch L-SRE-5)"
  - topic: loop.close_time_breached      # publisher: NONE (gap — the loops docs are a static census)
consumes:
  - the four team agenda-boards (Dataview output) — publishers: the four team units
  - "`ci.gates_red_count` / `ci.gates_tolerated_count` — publisher: [[release-engineering-charter]]"
  - "`sre.dlq_depth_and_oldest_age`, `integrity.open_findings_oldest_age` — publishers: [[runtime-resilience-charter]], [[state-integrity-invariants-charter]]"
emits:
  - "[[reliability-sre-agenda-board]] rollup — the metric SET, never an average"
  - "escalations into [[reliability-sre-agenda-full]] §Questions — consumer: the founder at board review"
  - "rejected-team trigger findings → `OPEN-DECISIONS.md` — consumer: [[decision-office-charter]]"
  - nf_a events (task_type: sre_board_rollup)
routing_class: extraction        # reading four boards and counting red gates is not a judgment call
quality_bar: "every board row carries a measured value, the word 'unmeasured', or 'never happened'; no roll-up number ever ([[reliability-sre-charter]] §Metrics)"
autonomy:
  read: autonomous
  propose: autonomous            # board edits and escalations land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: reliability-sre
escalates_to: "[[decision-office-charter]]"   # seam disputes (TECH-F6, TECH-F1) go to the Decision Office, never to a team
```

**The card's own hard rule:** `sre-board-orchestrator` never fixes what it finds. A red
gate, a stale DLQ message and an open finding each have an owning team; the department's
job is to force the fix-or-delete choice, not to make it.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `red-signal-audit` | T2 | Weekly, and any time a gate is proposed as "tolerated" | Every red gate is fixed within one close-time or deleted; the exception log holds nothing past its expiry | `.github/workflows/ci.yml:8` — *"Do NOT treat TFND-05 as green CI"* — a workflow documenting its own tolerance for red, with `:9` adding "capability-unverified" | NEW |
| `unowned-queue-sweep` | T2 | Weekly, and whenever a new queue, findings table or review surface is created | Every queue on the list has a named owner and a measured oldest-age, or is filed as a gap row with the owner blank on purpose | Two unowned queues found by hand in the 2026-08-24 generation pass: `queue.dead_letters` is declared and counted into (`message_bus.py:505-533`) with no consumer, and `drift_findings` has no reader ([[state-integrity-invariants-charter]] §Evidence) | NEW |

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); every
operational (T3) skill in this department belongs to a team, including the repo's only real
one, `.claude/skills/railway-config/` ([[release-engineering-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates go to [[skill-harvesting-charter]]'s queue
  through the §3.3 gate.
- **Episodic** — nf_a `task_type: sre_board_rollup`, plus read access to the four team
  families (`obs_liveness_sweep`, `release_drill`, `resilience_dlq_triage`,
  `integrity_finding_disposition`). Needs `context.team` and `context.metric_name` as jsonb
  keys so a per-team or per-metric slice is one filter, not a join this department invents.
- **Semantic** — `memory/` beside this file; facts like "`sre.days_since_verified_restore`
  has had no value for N quarters" with `source` = the board run, `confidence`,
  `last_verified`. Index: `reliability-sre-MEMORY.md`. Every write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. Team charters
  and `technology.md` §6 are retrieval targets by `path:line`, never preloaded (CLAUDE.md §2).

**Consolidation** — monthly, to be mirrored in [[reliability-sre-schedule]] (not a row
there yet; wave 2 does not edit the 8 existing artifacts): read the department's NF-A slice
and the four boards; write one fact per durable finding, **failures first** — a metric that
went from measured to unmeasured gets a fact naming the mechanism, not "coverage dipped";
expire facts unverified for 90 days; propose skill candidates. One PR; "no delta" is stated,
never silent.

## 5. Async contract

Cross-unit interaction is loops ([[reliability-sre-loops]]), NF-A events, vault PRs and
skill candidates only — never a synchronous call. Gap rows, stated rather than assumed away:

| Gap | Why it is a gap |
|---|---|
| `loop.close_time_breached` has no publisher | The loops docs are a static census; nothing measures loop age. The weekly sweeps bound the blind spot at 7 days, the quarterly ones at a quarter |
| `sre.days_since_verified_restore` has no value **at all** | Not a bad value — none has ever been produced ([[release-engineering-charter]] §The named gap). The board renders "never happened"; that rendering is the finding |
| Escalation to the Decision Office is a doc edit, not an event | Acceptable async path (vault PR), but nothing notifies. TECH-F6 and TECH-F1 sit open and nothing polls [[reliability-sre-agenda-full]] §Questions |

## 6. Evidence today

- **NEW — the orchestrator and both skills.** Both audits were performed by hand in the
  2026-08-24 generation session, which is the past instance that justifies them.
- **EXISTS — most of what it would read.** Five workflows, the daily `schema-parity.yml`
  cron (`:26-28`), the nightly `e2e-prod.yml`, `queue.dead_letters`, three detection agents
  and six shell gates — all cited in [[reliability-sre-charter]] §Boundaries.
- **PARTIAL — the numbers themselves.** Three of the five department metrics are
  unmeasured, one has never had a value, and `observability.py:53-84` degrades to
  `NoopMetric`, which makes *no metrics* and *metrics are zero* render identically. The
  board would today be mostly honest "unmeasured" rows — which is what it is for.
