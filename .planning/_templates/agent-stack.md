---
type: agent-stack
division: {{division}}
department: {{department}}
team: {{team}}           # team files only — omit for department and advisory units
status: designed         # designed = docs only. Nothing on this page is built unless its Evidence row says EXISTS.
updated: {{date}}
metrics: []              # the metrics this stack is graded by — copy from the unit's charter
links: ["[[{{slug}}-charter]]", "[[{{slug}}-schedule]]", "[[{{slug}}-loops]]", "[[0034-agent-stack-artifact]]", "[[skills-charter]]", "[[ai-orchestration-charter]]"]
---

# {{unit}} — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is the unit's AI operating contract: the agents it runs, the skills they carry,
> what they may touch, and what they remember. The *mechanisms* are owned elsewhere and
> only referenced: harness → [[harness-runtime-charter]] (**OD-03 open — no card may
> presuppose an outcome**), model choice → [[model-routing-inference-economics-charter]],
> the mutation gate → [[action-safety-the-human-gate-charter]], the skill envelope →
> [[skills-charter]], memory + NF-A shape → ADR 0006/0008/0017.

## 1. Roster

One row per agent this unit runs — most units need exactly one. An agent here is a
**role with a card**, not a promise of code.

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `{{slug}}-agent` | … | EXISTS `path:line` / PARTIAL `path:line` / NEW |

## 2. Agent cards — declarative, harness-agnostic

One card per roster row. **Requirements only:** the card says what the agent needs,
never how the harness provides it. A card that names a model, a queue technology, or
an OD-03 candidate is wrong.

```yaml
agent: {{slug}}-agent
unit: {{slug}}
triggers:                    # what wakes it — topics and/or schedules, never a polling loop
  - topic: …                 # every topic must name its publisher, or be marked "publisher: NONE (gap)"
  - schedule: "…"            # cron or plain words; must also appear in [[{{slug}}-schedule]]
consumes: []                 # events / tables / vault docs it reads
emits: []                    # events / tables / vault docs it writes
routing_class: mechanical | extraction | judgment   # task shape only — the model pick is aio-model-routing's
quality_bar: …               # which gate or verdict basis grades it (ADR 0017); "NONE (gap)" if unmeasured
autonomy:                    # per action family — FUTURES §8.1
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm    # hard rule, never weakened per-unit
memory: {{slug}}             # the §4 contract
escalates_to: "[[…]]"        # who is told when this agent's loop breaches its close_time
```

## 3. Skills

The envelope contract is [[skills-charter]]'s; the content is this unit's (T2).
Every row must satisfy README §3.3 — trigger · doneability · **a real past instance** ·
owner. **No speculative skills:** a row that cannot cite a past instance is deleted
from this table, not kept as an aspiration. An empty table honestly labelled is a
valid answer.

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `…` | T2 | … | … | `path:line` / PR / dated session | NEW |

Consumed, owned elsewhere: [[…]]

## 4. Memory

Four layers (ADR 0034). The unit owns only its **semantic** layer; the rest are
consumed contracts.

- **Procedural** — the §3 skills. Growth path: consolidation emits candidates into
  [[skill-harvesting-charter]]'s queue; the §3.3 gate still applies to every one.
- **Episodic** — the NF-A events this unit's agents emit (ADR 0006/0008; verdicts are
  sidecar claims, ADR 0017). Name the task types and any `context` jsonb keys needed.
- **Semantic** — `memory/` beside this file: **one fact per file**, frontmatter carrying
  `source` (NF-A event id / PR / dated session), `confidence`, `last_verified`;
  `{{slug}}-MEMORY.md` is the index. Every write lands as a PR — the audit trail is
  the medium, which is what makes the layer inspectable by a developer.
- **Working** — what an agent loads at task start, index-first and bounded: its card,
  the MEMORY index, the charter §Mandate. Everything else is targeted retrieval, cited.

**Consolidation** — the unit's reflection job (cadence here, mirrored in
[[{{slug}}-schedule]]): read the unit's NF-A slice since the last run; distill durable
facts, **failures first** — every red verdict becomes a fact naming the mechanism, not
the symptom; expire facts unverified for 90 days; propose skill candidates. Output is
one PR. A run that changes nothing reports "no delta", never silence.

## 5. Async contract

This unit's agents never call another unit synchronously. Every cross-unit interaction
is one of: a loop in [[{{slug}}-loops]] (with a `close_time`), an NF-A event, a vault
artifact or PR, or a skill candidate. An `emits` entry with no named consumer, or a
`consumes` entry with no publisher, is recorded here as a **gap row** — the fleet has
already been burned by exactly this (`core/orchestrator.py:198-206`: a subscribed topic
with zero publishers, dead for months, invisible).

## 6. Evidence today

What of this stack already exists, graded EXISTS / PARTIAL / NEW with `path:line`.
For most units the honest grade is NEW across the board except what the charter already
cites — say so plainly rather than dressing it up.
