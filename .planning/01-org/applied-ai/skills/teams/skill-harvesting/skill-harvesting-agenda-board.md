---
type: agenda-board
division: applied-ai
department: skills
team: skill-harvesting
status: provisional
metrics: [skills.harvested_firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-agenda-full]]", "[[skill-harvesting-loops]]", "[[skills-agenda-board]]", "[[skill-registry-authoring-schedule]]"]
---

# Skill Harvesting — Board

> **PROVISIONAL — no work done yet.**
>
> **GATED · UNSTAFFED.** Entry trigger: registry ≥ 15 skills. Today: **0**.

## Gate status

- Registry size: **0 / 15**
- Protocol-compliance green quarters: **0 / 2**
- Firing telemetry (proposed additional clause): **absent**
- Verdict: **do not staff**

## Team docs — live query

```dataview
TABLE WITHOUT ID file.link AS Doc, type AS Type, status AS Status, updated AS Updated
FROM "01-org/applied-ai/skills/teams/skill-harvesting"
SORT type ASC
```

## Where the work actually lives while gated

```dataview
TABLE WITHOUT ID file.link AS Doc, team AS Team, type AS Type
FROM "01-org/applied-ai/skills"
WHERE type = "schedule"
SORT team ASC
```

The quarterly harvest sweep is a row in [[skill-registry-authoring-schedule]], not
here ([[technology]] §4.3).

## Counters

- `skills.harvested_firing_rate_30d` — **unmeasurable** (no telemetry, no harvest)
- `skills.registry_size` — **0**
- `skills.script_to_skill_ratio` — **59:0**
- Candidates in queue — **0**
- Documents for this team — **7**, versus 0 harvested skills

## Reservoir — recorded, not queued

- `scripts/` — 59 entries, unowned
- 5 CI guards: `check_no_direct_stock_writes.sh`, `check_no_direct_type_attributes_access.sh`, `check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`, `check_schema_parity.sh`
- 3 built CLIs: `scripts/docgen/` (11), `scripts/synth/` (11), `scripts/simulate/` (8)
- 5 workflows: `ci.yml`, `codeql.yml`, `deploy.yml`, `e2e-prod.yml`, `schema-parity.yml`

## Blocking

- [ ] Gate not met — registry 0/15
- [ ] Nothing to harvest *into* — `.claude/skills/` absent
- [ ] Disband metric unmeasurable — no firing telemetry
- [ ] TECH-F4 open — 3 teams or 2
- [ ] Admission rate limit unset
- [ ] 2027-08-24 sunset not agreed

## Watch

- >3 candidates admitted in one week → premortem M1 (bulk sprawl)
- `past_instance` resolving to the wrapped file itself → M2 (circular evidence)
- 2026-11-24 with no scheduled trigger re-evaluation → M3 (paper team)
- Staffed while `firing_rate_30d` undefined → M4 (unevaluable)
