#!/usr/bin/env python3
"""Build the Obsidian vault scaffold + unit manifest for Mudavym."""
import json, pathlib, os

ROOT = pathlib.Path("/Users/aldemirkonuk/Projects/restaurant-ai-automation/.planning")
SCRATCH = pathlib.Path(os.environ["SCRATCH"])
teams = json.loads((SCRATCH / "teams.json").read_text())

# division -> {dept_slug: dept_title}
DIV = {
 "platform":     {"engineering":"Engineering","data":"Data","reliability-sre":"Reliability / SRE"},
 "applied-ai":   {"ai-orchestration":"AI Orchestration","skills":"Skills"},
 "intelligence": {"research-math":"Research & Math","security":"Security","analytics-bi":"Analytics & BI"},
 "product":      {"product-vision":"Product & Vision","guest-experience":"Guest Experience (sub-layer)",
                  "design":"Design","partnerships-integrations":"Partnerships & Integrations"},
 "commercial":   {"growth":"Growth","finance-pricing":"Finance & Pricing (sub-layer)",
                  "sales":"Sales","media-brand":"Media & Brand"},
 "corporate":    {"legal":"Legal","knowledge-documentation":"Knowledge & Documentation",
                  "compliance-privacy":"Compliance & Privacy","people-agent-ops":"People & Agent Ops",
                  "strategy-fundraising":"Strategy & Fundraising"},
}
DIV_TITLE = {"platform":"Platform","applied-ai":"Applied AI","intelligence":"Intelligence",
             "product":"Product","commercial":"Commercial","corporate":"Corporate"}
ADVISORY = {"architecture-review":"Architecture Review","red-team":"Red Team",
            "decision-office":"Decision Office"}

# dept_slug -> its teams (flatten across division files)
by_dept = {}
for div_file, ts in teams.items():
    for t in ts:
        by_dept.setdefault(t["dept"], []).append(t)

ARTIFACTS = ["charter","premortem","agenda-full","agenda-board","directive","loops","schedule"]

# ---------- templates ----------
TPL = ROOT / "_templates"; TPL.mkdir(parents=True, exist_ok=True)
def tpl(name, body): (TPL / f"{name}.md").write_text(body)

FM = """---
type: {type}
division: {{{{division}}}}
department: {{{{department}}}}
{extra}status: provisional
updated: {{{{date}}}}
links: []
---
"""
tpl("charter", FM.format(type="charter", extra="") + """
# {{unit}} — Charter

> PROVISIONAL — no work done yet. Remove this banner when the unit does real work.

## Mandate
One paragraph. What this unit is accountable for.

## Boundaries
What it owns outright.

## Explicit non-goals
What it deliberately does **not** own, and which unit does instead. Link them.

## Metrics it moves
Tie to the neural footprint where relevant (`nf_a.*` agents, `nf_b.*` guests).

## Evidence today
EXISTS / PARTIAL / NEW, with `path:line` citations.
""")

tpl("premortem", FM.format(type="premortem", extra="") + """
# {{unit}} — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this unit has failed. What happened?
Three to five concrete mechanisms, most likely first.

## Earliest observable signal per mechanism
What we would see first, and where.

## What would have prevented it
The specific counter-pressure, not "be careful".
""")

tpl("agenda-full", FM.format(type="agenda-full", extra="") + """
# {{unit}} — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What
## How
## Why now
## Next steps
## Questions for the founder
""")

tpl("agenda-board", FM.format(type="agenda-board", extra="") + """
# {{unit}} — Board

> **PROVISIONAL — no work done yet.**

```dataview
TABLE status, updated FROM "01-org" WHERE department = this.department SORT updated DESC
```

- [ ] item
""")

tpl("directive", FM.format(type="directive", extra="") + """
# {{unit}} — Directive

How *this* unit decides. Shape differs per unit by design.

```mermaid
graph TD
  A[Trigger] --> B{Decision point}
  B -->|yes| C[Act]
  B -->|no| D[Escalate to OPEN-DECISIONS]
```

## Decision rights
## Escalation trigger
""")

tpl("loops", FM.format(type="loops", extra="") + """
# {{unit}} — Loops

Every loop names its close-time. A loop that cannot state how fast it closes is a
diagram, not a loop.

```yaml
type: loop
id: <slug>
owner: {{department}}
measures: []
changes: []
inputs_from: []
outputs_to: []
close_time: weekly
status: proposed
```
""")

tpl("schedule", FM.format(type="schedule", extra="") + """
# {{unit}} — Schedule & Skills

## Recurring work
| Cadence | Job | Emits |
|---|---|---|

## Skills owned
Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed
for deletion.
""")

# ---------- tree + manifest ----------
manifest = {"divisions": [], "units": []}

def unit_files(base, slug):
    return {a: str((base / f"{slug}-{a}.md").relative_to(ROOT)) for a in ARTIFACTS}

for div, depts in DIV.items():
    dbase = ROOT / "01-org" / div
    dbase.mkdir(parents=True, exist_ok=True)
    manifest["divisions"].append({"slug": div, "title": DIV_TITLE[div],
                                  "departments": list(depts)})
    for dslug, dtitle in depts.items():
        base = dbase / dslug
        base.mkdir(parents=True, exist_ok=True)
        manifest["units"].append({"kind":"department","slug":dslug,"title":dtitle,
            "division":div,"dir":str(base.relative_to(ROOT)),"files":unit_files(base,dslug)})
        for t in by_dept.get(dslug, []):
            tb = base / "teams" / t["slug"]
            tb.mkdir(parents=True, exist_ok=True)
            manifest["units"].append({"kind":"team","slug":t["slug"],"title":t["name"],
                "id":t["id"],"division":div,"department":dslug,"gated":t["gated"],
                "dir":str(tb.relative_to(ROOT)),"files":unit_files(tb,t["slug"])})

for aslug, atitle in ADVISORY.items():
    base = ROOT / "02-advisory" / aslug
    base.mkdir(parents=True, exist_ok=True)
    manifest["units"].append({"kind":"advisory","slug":aslug,"title":atitle,
        "division":"advisory","dir":str(base.relative_to(ROOT)),"files":unit_files(base,aslug)})

(ROOT / "00-index").mkdir(exist_ok=True)
(SCRATCH / "manifest.json").write_text(json.dumps(manifest, indent=1))
(ROOT / "00-index" / "UNIT-MANIFEST.json").write_text(json.dumps(manifest, indent=1))

n_dep = sum(1 for u in manifest["units"] if u["kind"]=="department")
n_team= sum(1 for u in manifest["units"] if u["kind"]=="team")
n_adv = sum(1 for u in manifest["units"] if u["kind"]=="advisory")
print(f"divisions={len(DIV)}  departments={n_dep}  teams={n_team}  advisory={n_adv}")
print(f"units={len(manifest['units'])}  files={len(manifest['units'])*7}")
