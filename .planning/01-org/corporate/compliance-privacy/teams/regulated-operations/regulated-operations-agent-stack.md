---
type: agent-stack
division: corporate
department: compliance-privacy
team: regulated-operations
status: designed
updated: 2026-08-27
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
links: ["[[regulated-operations-charter]]", "[[regulated-operations-schedule]]", "[[regulated-operations-loops]]", "[[regulated-operations-premortem]]", "[[regulated-operations-directive]]", "[[0034-agent-stack-artifact]]", "[[compliance-privacy-agent-stack]]", "[[regulatory-posture-agent-stack]]", "[[agent-fleet-charter]]", "[[inventory-ledger-charter]]", "[[decision-office-charter]]"]
---

# Regulated Operations — Agent Stack

> ## ⏸ DORMANT — a role reserved, not an agent staffed
>
> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team is trigger-gated and unstaffed; its one live sensor runs on another unit's
> schedule. The agent it would run **already exists as a declared stub the orchestrator
> refuses to boot** — *"Failing loudly at boot is the only version of this that cannot
> be mistaken for working"* (`core/orchestrator.py:245-250`). An agent-stack page that
> reads as staffed is that same failure in document form.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `compliance-agent` ⏸ | **Nothing today.** On activation: reconcile ledger-reported movement against excise-reported movement and assemble deadline evidence — never file, never send | PARTIAL `services/agent-orchestrator/agents/compliance_agent.py:16` (`IS_STUB = True`), refused at boot `core/orchestrator.py:245-250` |

The row exists because the stub does. Omitting it would be less honest than the
codebase already is: the event vocabulary is reserved and the module is on disk.

## 2. Agent cards

```yaml
agent: compliance-agent
unit: regulated-operations
state: DORMANT              # declared, refused at boot; no trigger below is armed until the entry trigger fires
entry_trigger: "first customer in a jurisdiction where we hold or touch a licence, OR excise reporting in a signed MSA ([[regulated-operations-charter]] §Entry trigger) — both are events with a date and a document, never a judgement call"
triggers:
  - schedule: "quarterly trigger check — runs on [[compliance-privacy-schedule]], not here; a team with no staff cannot own a job"
  - topic: compliance.deadline.created   # publisher: NONE (gap) — subscribed at compliance_agent.py:24-27 with zero publishers
  - topic: compliance.report.requested   # publisher: NONE (gap) — same subscription, same zero
consumes:
  - "today: nothing. The stub logs a routing key and payload keys and stops (compliance_agent.py:40-41)"
  - "on activation: the ledger's published movement aggregate ([[inventory-ledger-charter]]) — never its own movement numbers, because two answers means the tax authority picks one"
emits:
  - "today: nothing."
  - "on activation: regops.excise_reconciliation_variance and deadline evidence packs → [[compliance-privacy-agent-stack|cp-orchestrator]] board"
routing_class: mechanical    # on activation only: reconciliation is arithmetic against someone else's ledger
quality_bar: "NONE (gap) — no filing has ever been prepared, so no verdict basis exists. Naming the gap beats inventing a bar"
autonomy:
  read: autonomous
  propose: autonomous        # reconciliation variances and evidence packs are PRs
  mutate_stock_money_outbound: confirm   # constant
memory: regulated-operations
escalates_to: "[[compliance-privacy-charter]]; CORP-F4 and the 2027-08-24 sunset to [[decision-office-charter]]"
```

**The card's hard rules.** (1) **It stays refused until the entry trigger fires** — the
doc-level mirror of `orchestrator.py:245-250`. (2) **Nothing regulatory is filed,
computed as the number of record, or sent by an agent, ever**: it produces a
reconciliation and an evidence pack; a person files. (3) **It never computes movement
itself** ([[inventory-ledger-charter]] boundary).

**Two forks stay open, neither answered here** ([[regulated-operations-charter]] §Open
forks): CORP-F4 — is this team Corporate's at all, or Product's once licensing becomes
a feature — and what happens to `compliance_agent.py` if the trigger never fires, since
a correctly-declared permanent stub is still inventory and the 30-day/3-run anti-sprawl
rule has no equivalent for one.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|

**Empty — no procedure this unit has actually repeated yet, by construction rather than
by accident.** A team that has never operated has no past instances, so every candidate
fails §3.3 rule 3 by definition: `excise-filing-prep`, `licence-obligation-map`,
`three-tier-review` (the control runs, but nobody has reviewed its patterns — a
procedure to invent, not to codify) and `deadline-evidence-pack`. Naming four and
writing none is the point ([[regulated-operations-schedule]]).

Consumed, owned elsewhere: the stub's runtime and boot refusal
([[agent-fleet-charter]]); the per-instrument sensor
([[regulatory-posture-agent-stack|obligation-register-steward]]); the quarterly check
([[compliance-privacy-agent-stack|cp-orchestrator]]).

## 4. Memory

- **Procedural** — empty (§3) until an activation produces a real run. What an
  activation-under-deadline inherits is a *design* — [[regulated-operations-loops]] and
  [[regulated-operations-directive]] State 2, writable from reasoning where a skill
  would need a real filing (premortem M2).
- **Episodic** — nf_a `task_type: excise_reconciliation`, **empty and correctly so**:
  the stub is refused at boot, so it emits nothing. Zero rows is the gate working, not
  instrumentation missing — a distinction the board row must preserve.
- **Semantic** — `memory/` beside this file, index `regulated-operations-MEMORY.md`.
  Three facts are worth writing *now*, because re-deriving them under deadline is the
  premortem: the boot-refusal pattern and why the stub is declared rather than hidden;
  **the C-19 control at `constraint_engine.py:38-41` runs on every outbound draft today
  with no charter behind it**; and the 2027-08-24 sunset. Provenance per ADR 0034.
- **Working** — this card, the MEMORY index, charter §Entry trigger. Nothing else — a
  dormant unit that preloads context is a staffed unit with extra steps.

**Consolidation** — quarterly, riding the trigger check: re-verify the three semantic
facts, re-check the two trigger conditions, and from 2027-08-24 the sunset. For this
unit alone, **"no delta" is the deliverable, not a null result** — a quarterly no-delta
is the gate reporting itself alive. Expire at 90 days; no skill candidates until
activation. One PR.

## 5. Async contract

One inbound sensor and one outbound board row; nothing synchronous, and nothing at all
until the trigger fires. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `compliance.deadline.created` and `compliance.report.requested` have zero publishers | Two subscribed topics with nothing on the other side — precisely the shape the template names (`core/orchestrator.py:198-206`) as dead-for-months and invisible. Here it is at least *declared* dead, which is the whole argument of `compliance_agent.py:11-15` |
| The quarterly trigger check has an owning schedule but no named owner, and has run **never** | `regops.trigger_check_freshness` is therefore unbounded. A dormant team whose trigger-check freshness is unbounded is not gated; it is forgotten, and the two are indistinguishable from outside ([[regulated-operations-charter]] §Metrics) |
| C-19 is a live regulatory-operations control with no owner | `constraint_engine.py:38-41` blocks phrases like *"direct-from-winery"* on every outbound draft, in the same engine as the C-21 PII guard, and no charter stands behind it. Its hit-rate check is parked on [[regulatory-posture-schedule]] until activation — zero hits against non-zero volume would mean a dead control (premortem M4) and nobody would notice |
| The anti-sprawl rule is deliberately suspended for one job | The quarterly check produces no action for many consecutive runs *by design*. That exception is paid for by the dated sunset: at 2027-08-24 with the trigger unfired, the same check retires the team, its documents, and the stub |

## 6. Evidence today

- **PARTIAL — the agent exists as a declared stub.** `compliance_agent.py:16`
  (`IS_STUB = True`), subscriptions `:24-27`, two TODOs `:40-41`, boot refusal
  `core/orchestrator.py:245-250`. Inventory, not capability.
- **EXISTS — one control, unowned.** `constraint_engine.py:38-41`, C-19
  `THREE_TIER_COMPLIANCE`, executing on every outbound draft today.
- **NEW / absent — everything else.** No `compliance_deadlines`, `compliance_reports`
  or `excise_tax_records` table; no licence inventory, jurisdiction list or filing
  calendar. The event names exist; nothing produces or consumes them.
