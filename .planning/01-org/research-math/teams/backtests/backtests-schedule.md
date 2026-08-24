---
type: schedule
division: research-math
department: research-math
team: backtests
status: new
updated: 2026-08-24
links: ["[[backtests-charter]]"]
---

# Backtests — Schedule & Skills

## Recurring work
| Cadence | Job | Emits |
|---|---|---|
| Monthly | Outcome re-grade sweep | `bt.outcome_regrade_delta` |
| Fortnightly | Claim replay over anything newly published | `bt.claim_falsification_rate` |
| Monthly | Coverage report, **per scenario class** | `bt.scenario_coverage_pct` |
| Quarterly | Red Team review of a zero-falsification quarter (premortem M3) | — |

All are **dormant until the entry trigger fires**.

## Skills owned
None yet. Skills live in `.claude/skills/`; per [foundation §3.3](../../../../foundation/README.md)
a skill must cite a real past instance, and this team has no past yet. A `scenario-replay`
skill is the obvious first one, proposed only.
