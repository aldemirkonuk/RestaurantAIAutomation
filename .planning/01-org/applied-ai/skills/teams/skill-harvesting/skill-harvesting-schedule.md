---
type: schedule
division: applied-ai
department: skills
team: skill-harvesting
status: new
metrics: [skills.harvested_firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-loops]]", "[[skill-harvesting-directive]]", "[[skills-schedule]]", "[[skill-registry-authoring-schedule]]", "[[technology]]", "[[README]]"]
---

# Skill Harvesting — Schedule & Skills

## Recurring work

**This team runs nothing, because it is not staffed.** The one recurring item that
concerns it is owned by the department, and that separation is deliberate: a gated
team must not be the thing that evaluates its own gate
([[skill-harvesting-directive]]).

| Cadence | Job | Owner | Status |
|---|---|---|---|
| Monthly | **Staffing-gate evaluation** — `registry_size` vs 15; compliance-green quarters vs 2 | [[skills-schedule]] census, **not this team** | NEW · not scheduled |
| Quarterly | **Harvest sweep** of `scripts/` and workflows | [[skill-registry-authoring-schedule]] — inherited task, [[technology]] §4.3 | NEW · dormant |
| Quarterly | Candidate admission, rate-limited | this team, **once staffed** | DORMANT |
| One-off | **2027-08-24 sunset check** — delete this team if untriggered | founder | not agreed |

**Gate today: 0 / 15. Do not staff.**

⚠️ **The rule that must not be applied to the sweep.** [[README]] §6: *a scheduled
job that produces no action for 3 consecutive runs gets downgraded or deleted.* The
quarterly harvest sweep will legitimately produce zero candidates for several runs
— because there is nowhere to harvest *into* and because a sweep that finds nothing
admissible is a correct outcome, not a failed job. Flagging it here so the
anti-sprawl rule is not used to delete the anti-sprawl mechanism.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed
for deletion.

**Count today: 0. Harvested to date: 0. Candidates queued: 0.**

| Skill | Harvested from | Recurrence evidence | Fired within 30d? |
|---|---|---|---|
| — | — | — | — |

## The reservoir — recorded, deliberately not queued

Written down now so a future sweep starts from evidence rather than re-deriving it.
**This is an inventory, not a backlog, and not a to-do list.**

| Cluster | Contents | Harvest note |
|---|---|---|
| CI guards | `scripts/check_no_direct_stock_writes.sh`, `check_no_direct_type_attributes_access.sh`, `check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`, `check_schema_parity.sh` | **5, not 4** as [[technology]] §4.3 states. Each has a trigger and a pass/fail criterion — the closest thing in the repo to a skill already. Strongest candidates. |
| `scripts/docgen/` | 11 modules — compose · degrade · truth · backtest · render · houses · templates · fixtures | A pipeline, not one procedure. Harvest as *one* skill or none; wrapping 11 modules as 11 skills is [[skill-harvesting-premortem]] M1 in miniature. |
| `scripts/synth/` | 11 — recipes · oracle · auth_personas · seed · snapshots · write_set · teardown · ids | Same caution. `teardown` alone may be independently recurrent. |
| `scripts/simulate/` | 8 — bridge · payloads · detection · mappings · service | Same caution. |
| `.github/workflows/` | `ci.yml`, `codeql.yml`, `deploy.yml`, `e2e-prod.yml`, `schema-parity.yml` | Operational procedures with real triggers and real invocation history — the only cluster where *recurrence* is trivially provable from CI logs. |
| Remainder of `scripts/` | ~59 entries total | Mostly one-offs. Presumption is **reject** until `git log --follow` shows recurrence (M2). |

**Recurrence test before any of the above becomes a candidate:** the procedure must
be shown happening more than once — repeated commits, multiple CI invocations, or a
thread asking how to do it again. *"The script exists"* is circular evidence and is
the specific way this team's anti-speculation gate inverts.

### Skills this team would own

None. Harvesting produces candidates for other departments to own; the harvester
owning the harvest would collapse the contract/content boundary
([[skills-charter]] §Explicit non-goals) at the exact point where volume makes it
most tempting.
