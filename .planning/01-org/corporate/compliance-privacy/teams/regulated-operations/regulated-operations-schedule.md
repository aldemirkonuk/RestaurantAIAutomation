---
type: schedule
division: corporate
department: compliance-privacy
team: regulated-operations
status: new
metrics: [regops.trigger_check_freshness, regops.jurisdiction_count, regops.deadline_miss_count, regops.excise_reconciliation_variance]
updated: 2026-08-24
links: ["[[regulated-operations-charter]]", "[[regulated-operations-loops]]", "[[regulated-operations-directive]]", "[[regulated-operations-premortem]]", "[[compliance-privacy-schedule]]", "[[regulatory-posture-schedule]]", "[[inventory-ledger-charter]]", "[[agent-fleet-charter]]", "[[decision-office-charter]]", "[[README]]"]
---

# Regulated Operations — Schedule & Skills

## Recurring work

**One job, and it is the reason this file exists.**

A dormant team would normally have no schedule at all. This one gets a schedule
because [[regulated-operations-premortem]] M1 — *the trigger fires and nobody
notices, because a dormant team has no cadence* — is the team's most likely failure,
and a single recurring question is its entire counter-pressure.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| **Quarterly** | **Trigger check.** Two questions: *(a)* has a customer signed in a jurisdiction where we hold or touch a licence? *(b)* does any signed MSA mention excise reporting? Plus, from 2027-08-24: *(c)* has the sunset date passed? | `regops.trigger_check_freshness` | **NEW · owner unnamed · last run: never** — runs on [[compliance-privacy-schedule]], not here, because a team with no staff cannot own a job |
| Per-instrument | **Sign-off checklist line** — *"does this clause mention excise, licensing, or alcohol movement?"* | trigger signal | **NEW** — one line inside [[regulatory-posture-schedule]]'s sign-off. The *primary* sensor: it sees the event before execution, months before a quarterly review |
| Quarterly | **C-19 hit-rate check** — trigger count over outbound draft volume | `regops.c19_trigger_count` | **NEW** — held by [[regulatory-posture-schedule]] until activation. Zero hits with non-zero volume = dead control (M4) |
| — | *— activation line —* | | |
| Per statutory deadline | Filing cycle — prepare, reconcile, file, evidence | `regops.deadline_miss_count` | ⏸ dormant |
| Per reporting period | Excise reconciliation against the ledger's published aggregate, **before** filing | `regops.excise_reconciliation_variance` | ⏸ dormant |
| Quarterly | Licence and jurisdiction sweep | `regops.jurisdiction_count` | ⏸ dormant |
| Quarterly | Three-tier pattern review + live-fire fixture | `regops.c19_fixture_pass_rate` | ⏸ dormant |

**The first three rows are owned by other teams on purpose.** A team with no staff
cannot run a job, and pretending otherwise is exactly the failure mode
`compliance_agent.py:11-15` describes — a thing that *"reads identically to a working
one from every dashboard and health check."* Placing the check on the department's
schedule and the sensor inside the sign-off means the gate has a real owner while the
team has none.

**Anti-sprawl applies, and cuts unusually cleanly here.** [[README]] §6: a scheduled
job producing no action for 3 consecutive runs is downgraded or deleted. The
quarterly trigger check will produce **no action for many consecutive runs by
design** — which would normally condemn it, and here does not. That is a genuine
exception to the rule and it needs stating rather than assuming, because the next
person applying the anti-sprawl pass will otherwise delete the one job holding the
gate open.

**The exception has a boundary:** it applies to a check whose *purpose* is to detect a
rare event, and it is paid for by the sunset trigger. The job runs no-action
indefinitely, but the *track* does not — at 2027-08-24 with the trigger unfired, the
same check retires the team, the seven documents, and the stub. A no-action job with
no expiry would be sprawl; a no-action job with a dated exit is a gate.

## Skills owned

**Count today: 0, and correctly 0.**

Skills live in `.claude/skills/` and [[README]] §3.3 requires four things before one
may be committed: a trigger, doneability criteria, **a real past instance**, and an
owning department. A team that has never operated has no past instances at all, so
**every candidate this team could name is ineligible by construction**, not by
accident.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty, and appropriately so |

### Candidates deliberately not written

| Candidate | Why it is not eligible |
|---|---|
| `excise-filing-prep` | No filing has ever been prepared. No jurisdiction is in scope. |
| `licence-obligation-map` | No licence exists to map. |
| `three-tier-review` | The control runs, but nobody has ever reviewed its patterns — so there is no procedure to codify, only one to invent. |
| `deadline-evidence-pack` | No deadline has ever been met or missed. |

**Naming four ineligible candidates and writing none is the point.** The strongest
temptation for a gated team is to prepare — to write the runbook-as-skill now,
because it will obviously be needed later. That instinct is what fills a registry
with plausible artifacts that never fire, and it is the same instinct
[[regulated-operations-directive]] §Tie-break refuses: *be eager about noticing,
reluctant about building.*

The one thing worth preparing was prepared, and it is not a skill: it is the design
in [[regulated-operations-loops]] and the pre-made data-source decision in
[[regulated-operations-directive]] State 2. Those exist so an activation under
deadline inherits a design instead of inventing one — [[regulated-operations-premortem]]
M2. A skill would have to be written from a real filing; a design can be written from
reasoning, and that is the whole distinction.

## What this team consumes while dormant

| Their job | Owner | What we take |
|---|---|---|
| Quarterly trigger check | [[compliance-privacy-schedule]] | The gate's backstop sensor |
| Per-instrument sign-off | [[regulatory-posture-schedule]] | The gate's primary sensor |
| Deal pipeline review | [[design-partner-operations-charter]] | Advance sight of a licensed jurisdiction |
| Stub-agent boot refusal | [[agent-fleet-charter]] | `compliance_agent.py` stays declared and refused (`orchestrator.py:245-250`) |
| Open-decision queue | [[decision-office-charter]] | CORP-F4 and the sunset trigger kept open rather than drifting |
