---
type: agenda-board
division: corporate
department: compliance-privacy
team: regulated-operations
status: provisional
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
updated: 2026-08-24
links: ["[[regulated-operations-charter]]", "[[regulated-operations-agenda-full]]", "[[regulated-operations-premortem]]", "[[regulated-operations-loops]]", "[[regulated-operations-schedule]]", "[[compliance-privacy-agenda-board]]", "[[compliance-privacy-schedule]]", "[[regulatory-posture-charter]]"]
---

# Regulated Operations — Board

> **PROVISIONAL — no work done yet.**
> ⏸ **AND NOT STAFFED.** This team has an entry trigger, no people, and one live
> metric. Do not read any row below as capability.

## Team status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/compliance-privacy/teams/regulated-operations"
SORT type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/corporate/compliance-privacy/teams/regulated-operations"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The gate

**Entry trigger — either fires:**

- [ ] First customer in a jurisdiction where we hold or touch a licence
- [ ] First time excise reporting appears in a **signed** MSA

**Sunset trigger — proposed, needs founder confirmation:**

- [ ] Neither entry condition fired by **2027-08-24** → retire the track: delete these 7 documents, delete `compliance_agent.py`, scope returns to [[regulatory-posture-charter]] as a note

**Sensors:**

- Quarterly check — [[compliance-privacy-schedule]] · **owner: unnamed** · **last run: never**
- Per-instrument sign-off checklist — [[regulatory-posture-charter]] L4 · **line not yet added**

## Counters

- `regops.trigger_check_freshness` — 🔴 **unbounded · never checked** (the only live metric, and it is already failing)
- `regops.jurisdiction_count` — **0**
- `regops.deadline_miss_count` — 0 over an empty set
- `regops.excise_reconciliation_variance` — undefined
- Docs in this directory : staffed people — **7 : 0**

## Evidence — stub only

- `services/agent-orchestrator/agents/compliance_agent.py:16` — `IS_STUB = True`
- `:24-27` — subscribes to `compliance.deadline.created`, `compliance.report.requested`
- `:40-41` — TODO insert `compliance_deadlines`; TODO generate `compliance_reports`, `excise_tax_records`
- `core/orchestrator.py:245-250` — refuses to start an enabled stub; *"Failing loudly at boot is the only version of this that cannot be mistaken for working"*
- No `compliance_deadlines`, `compliance_reports`, or `excise_tax_records` table exists

## ⚠️ Live now, for a team that does not exist

- [ ] **C-19 `THREE_TIER_COMPLIANCE`** — `constraint_engine.py:38-41` blocks phrases like *"direct-from-winery"* in outbound drafts. **Running on production traffic. No owner. No hit-rate measurement.** A pattern control with zero hits looks identical to a perfect one
- [ ] `regops.trigger_check_freshness` is unbounded on day one — a dormant team's first failure state is its default state

## Blocking (pre-activation, all owned by others)

- [ ] Quarterly trigger check has no named owner and has never run
- [ ] Excise/licensing question not yet in the instrument sign-off checklist
- [ ] C-19 not recorded in the obligation register as an unowned operating control
- [ ] Sunset trigger not confirmed by the founder
- [ ] **CORP-F4 open** — is this scope Corporate's, or Product's once licensing is a feature?
- [ ] No anti-sprawl rule exists for a permanently-dormant stub agent

## On activation — pre-decided, so an emergency cannot decide differently

- 30-day design gate before the first filing: runbook + data-source decision
- Excise **consumes** [[inventory-ledger-charter]]'s published aggregate; never recomputes movement
- `regops.excise_reconciliation_variance` target is **exactly zero**, not "small"
- C-19 moves here with a live-fire fixture asserted in CI
