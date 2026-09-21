---
type: agenda-board
division: product
department: partnerships-integrations
team: partner-alliance-development
status: provisional
metrics: [pi.unblocking_agreements, pi.time_to_first_response]
updated: 2026-08-24
links:
  - "[[partner-alliance-development-charter]]"
  - "[[partner-alliance-development-agenda-full]]"
  - "[[partner-alliance-development-loops]]"
  - "[[partnerships-integrations-agenda-board]]"
---

# Partner & Alliance Development — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Kind, status AS Status, updated AS Updated
FROM "01-org/product/partnerships-integrations/teams/partner-alliance-development"
SORT type ASC
```

## Everything in this department, for handoff context

```dataview
TABLE WITHOUT ID
  file.link AS Unit, team AS Team, status AS Grade
FROM "01-org/product/partnerships-integrations"
WHERE type = "charter"
SORT team ASC
```

## Drift watch — this team's own staleness

```dataview
TABLE WITHOUT ID
  file.link AS Doc, updated AS "Last touched", (date(today) - date(updated)).days AS "Days cold"
FROM "01-org/product/partnerships-integrations/teams/partner-alliance-development"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

| | Today |
|---|---|
| Grade | **NEW** — blocker list EXISTS, function does not |
| Providers blocked on a signature | **9** of 27 |
| `pi.unblocking_agreements` | **0** — an acceptable v0 reading |
| Outreach attempts | **0** — *the number that makes the zero above readable* |
| `pi.time_to_first_response` | no data |
| OD-07 | **open** — `OPEN-DECISIONS.md:33` |

## Blocker ledger — all nine, all one state

| Provider | Registry | State |
|---|---|---|
| TouchBistro | `:119` | never contacted |
| NCR Voyix Aloha | `:171` | never contacted |
| PAR Brink | `:192` | never contacted |
| HungerRush | `:222` | never contacted |
| Qu Beyond | `:232` | never contacted |
| POSitouch | `:242` | never contacted |
| Focus POS | `:254` | never contacted |
| Givex / Vexilor | `:264` | never contacted |
| Vectron Omni | `:298` | never contacted |

*Nine "never contacted" is a legitimate state, not a gap. Nine "never contacted" after six
months is a finding.*

## Next

- [ ] **OD-07 option memo** — what collaboration buys, costs, and forecloses
- [ ] Blocker ledger stood up with states and dates
- [ ] Triage 5 Türkiye entries against `generic_webhook` / `csv_import`
- [ ] Define `pi.time_to_first_response` **before** first outreach
- [ ] Firewall rule agreed with [[consumer-app-points-economy-charter]]
- [ ] 60-day OD-07 drift alarm wired to [[decision-office-charter]]

## Rules in force

- [ ] **No partner-agreement outreach without a named venue running that POS**
- [ ] **Never report agreements without attempts** — the pair, or nothing
- [ ] **Beli deliverable is a memo, not a relationship**
- [ ] **No guest artifact may assume the partnership while OD-07 is open**

## Not ours

- [ ] OD-07 itself → **founder**
- [ ] First outbound targets → **founder, deferred**
- [ ] Pricing and terms → **founder, deferred**
- [ ] Adapters after a signature → [[pos-bridge-charter]]
- [ ] Restaurant sales relationship → [[design-partner-operations-charter]]
