---
type: agenda-board
division: applied-ai
department: skills
status: active
metrics: [skills.registry_size, skills.protocol_compliance_rate, skills.deletions_per_quarter, skills.firing_rate_30d, skills.script_to_skill_ratio]
updated: 2026-08-28
links: ["[[skills-charter]]", "[[skills-agenda-full]]", "[[skills-loops]]", "[[skills-schedule]]", "[[skills-agent-stack]]", "[[skill-registry-authoring-agenda-board]]", "[[skill-lifecycle-anti-sprawl-agenda-board]]", "[[skill-harvesting-agenda-board]]"]
---

# Skills — Board

Tasks live in [[skills-agenda-full]]. This file is the readout: what is true
today, what closes next, and what is blocking. Counters are re-derivable — the
census is `python3 scripts/agents/run_card.py --agent registry-clerk`, never
this page.

## Unit status — live query

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  team AS Team,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/applied-ai/skills"
SORT team ASC, type ASC
```

## Stale check — anything untouched for 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org/applied-ai/skills"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

> **2026-10-23 is the cliff, not a surprise.** 32 of 36 dated docs here still
> read `updated: 2026-08-24` and trip this query in one burst — the date
> `loop-watcher.yml:4-9` already names. SK-10 owns beating it.

## Counters — measured 2026-08-28

| Metric | Value | Direction |
|---|---|---|
| `skills.registry_size` | **4** (`fleet-census`, `harness-contract-audit`, `model-pin-census`, `registry-index-refresh`) | 0 → 4 on 2026-08-28 (ADR 0038) |
| `skills.protocol_compliance_rate` | **4/4** | denominator finally exists |
| `skills.firing_rate_30d` | **unmeasurable** — `nf_a.skill_id` is not a column | never render this as 0 (ADR 0016/0020) |
| `skills.deletions_per_quarter` | **0** against 4 additions | the M1 ratio; benign at one quarter, the failure at two |
| `skills.script_to_skill_ratio` | **84 : 4** (baseline 59 : 0) | denominator grew by 25 in the same window |
| Proposed-skill supply line | **233 rows** / 228 distinct, across 100 agent-stack §3 tables | 187 cite a checkable artifact; 46 do not; 5 names collide |
| T4 share of the supply line | **1 of 233** | 232 are somebody else's to author (M4's boundary, quantified) |
| Unit docs : committed skills | **40 : 4** | M5's signal, still the wrong way up |

## Next close-dates

| Date | What must be true | Task |
|---|---|---|
| 2026-09-04 | Reservoir census published as dated memory facts; OD-25 packet filed | SK-1, SK-11 |
| 2026-09-11 | §3.3 guard blocking in CI; `registry_changed` published; A4 consumption spec with RM-3 | SK-4, SK-5, SK-6 |
| 2026-09-18 | 233 rows sorted into four buckets that sum to 233 | SK-2 |
| 2026-09-30 | Registry at 8, compliance 8/8, never more than 2 admitted in a week | SK-3 |
| 2026-10-09 | Paired-deletion guard merged in dry-run; `skill-create` beating the hand-written baseline | SK-8, SK-13 |
| 2026-10-23 | No file in this directory stale-by-default | SK-10 |
| 2026-11-24 | Self-judgment run against OD-24's adopted trigger; TECH-F4 answered by census | SK-9, SK-12 |

## Blocking

- [ ] **`nf_a.skill_id` does not exist** — Track A4 (RM-3 owns the column, SRE the cron). Blocks [[skills-loops]] L1 and L2, and every deletion the department exists to make.
- [ ] **Registry ceiling `N` unset** — SK-8's guard ships disarmed until the founder names it.
- [ ] **OD-25 open** — the weekly skill-health job has two named owners, so it has none. Carried by `skills-orchestrator` in the meantime.
- [ ] **TECH-F4 open** — three teams or two. SK-12 proposes to settle it by census on 2026-11-24.
- [ ] **No publisher for `skills.registry_changed`** — a declared gap on the `skills-orchestrator` card; SK-5 closes it with SK-4's CI job.

## Standing trip-wires

| Fires when | Goes to |
|---|---|
| A quarter closes with additions > 0 and deletions == 0 | [[red-team-charter]] **and** the founder — never this department alone |
| A `SKILL.md` lands with `owning_department: skills` outside tier T4 | SK-4's guard, at PR time |
| A week admits more than 2 skills | logged here as a directive violation |
| 2026-11-24: fewer than 5 committed *firing* skills | collapse recommendation into [[ai-orchestration-charter]] (OD-24, Agreed) |

## Teams

- [[skill-registry-authoring-charter]] — `partial` — owns SK-1 … SK-5 (the gate, the sweep, the intake queue)
- [[skill-lifecycle-anti-sprawl-charter]] — `new` — owns SK-6 … SK-8 (telemetry consumption, deletions, the brake)
- [[skill-harvesting-charter]] — `new`, **GATED** at ≥15 skills — staffs nobody; its sweep runs inside registry-authoring until the trigger fires
