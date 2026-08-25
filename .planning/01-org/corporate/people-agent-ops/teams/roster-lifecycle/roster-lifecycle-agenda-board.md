---
type: agenda-board
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-agenda-full]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-schedule]]", "[[people-agent-ops-agenda-board]]", "[[performance-doneability-agenda-board]]"]
---

# Roster & Lifecycle — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/corporate/people-agent-ops/teams/roster-lifecycle"
SORT type ASC
```

## Both teams side by side — the anti-M1 view

The department's most likely failure is that this team's cheap visible work becomes the
department while [[performance-doneability-charter]] stays blocked and quiet. Both units
appear on one query so that only-one-moving is legible.

```dataview
TABLE WITHOUT ID
  file.link AS Unit,
  team AS Team,
  status AS Evidence,
  metrics AS "Primary metric(s)",
  updated AS Updated
FROM "01-org/corporate/people-agent-ops"
WHERE type = "charter" AND team
SORT team ASC
```

## Stale — nothing touched in 60 days is either finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/corporate/people-agent-ops/teams/roster-lifecycle"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/corporate/people-agent-ops/teams/roster-lifecycle"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## The census — hand-entered until L-RL-1 runs

**26 modules · 4 predicates.** Publish the table, never the percentage alone
(premortem M1).

- [ ] **Not registered — 3.** `book_scraper_agent` (`:17`, `BaseAgent`, zero call sites) ·
      `dataset_creator_agent` (`:26`, `BaseAgent`, zero call sites) ·
      `recurring_order_agent` (`:14`, plain class, declared standalone)
- [ ] **Registered, no declared spec — 4.** `provider_conversation_agent` ·
      `email_intel_agent` · `email_parsing_agent` · `provider_communication_agent`
      — silent `{}` at `core/agent_registry.py:337`
- [ ] **Does not extend `BaseAgent` — 1.** `recurring_order_agent.py:14`
- [ ] **Declared stubs — 5. PASS.** `auto_pilot` · `compliance` · `ghost_inventory` ·
      `negotiation_playbook` · `shrinkage_detective` — refused at boot,
      `core/orchestrator.py:245`
- [ ] `roster.truth_pct` — **≤ 73%** (≥7 defects / 26)
- [ ] `roster.headcount_claim_variance` — **4**: 19 specs · 23 registered · 24
      (`PROJECT.md:33`) · 26 on disk
- [ ] `roster.maturity_level_evidenced_pct` — **0%** — ladder is prose only
- [ ] `roster.retirement_count` — **0**. Watch this: a year at zero while registrations
      rise is premortem M5 (`.planning/…/roster-lifecycle-premortem.md`)

## Gates — none exist yet

- [ ] CI: new module in `agents/` without a registry entry → fail (L-RL-2)
- [ ] CI: registered agent without a `DEFAULT_AGENT_SPECS` entry → fail
- [ ] Runtime: `register_from_defaults` warns or refuses on a missing spec
      (`core/agent_registry.py:337`)
- [x] Runtime: stub refused at boot — **already exists**, `core/orchestrator.py:245`

## Open decisions

- [ ] `recurring_order_agent` — declared exclusion, or port to `BaseAgent`?
- [ ] `book_scraper_agent`, `dataset_creator_agent` — onboard, or retire?
- [ ] Ladder depth — 5 inherited levels, or the 3 the evidence may support?
- [ ] Does the onboarding gate require a **named** doneability criterion (proposed yes) or
      a **computable** one (would stall on a blocked team)?
