---
type: charter
division: applied-ai
department: skills
team: skill-registry-authoring
status: partial
metrics: [skills.protocol_compliance_rate, skills.registry_size, skills.description_disambiguation_rate]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skill-registry-authoring-premortem]]", "[[skill-registry-authoring-directive]]", "[[skill-registry-authoring-loops]]", "[[skill-registry-authoring-schedule]]", "[[skill-registry-authoring-agenda-full]]", "[[skill-registry-authoring-agenda-board]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-harvesting-charter]]", "[[README]]", "[[technology]]"]
---

# Skill Registry & Authoring — Charter

Team `skill-registry-authoring` · department [[skills-charter]] · division `applied-ai`.
Alias used in [[technology]] §4.1: `[[skl-registry-authoring]]`.

## Mandate

Own the **`SKILL.md` contract, the creation protocol, and the registry index** —
everything that determines whether a skill is well-formed and findable. The team's
axis is **creation and discoverability**. Discoverability here is a real engineering
problem, not a style preference: a skill is only invoked if its `description` tells
the selecting agent *when to use this*, so description quality is a measurable
artifact with a measurable failure mode.

## Boundaries

- The `SKILL.md` frontmatter contract: `name`, `description`, and the four §3.3
  fields — trigger, doneability criteria, real past instance, owning department.
- The **§3.3 creation protocol** and its enforcement at the gate
  ([[skill-registry-authoring-directive]]).
- **The registry index** — what exists, who owns it, which tier ([[README]] §3.2).
- Creating and maintaining `.claude/skills/` itself.
- **Description quality** — the anti-collision rule: two skills whose descriptions
  claim overlapping triggers are one skill, or one of them is wrong.
- **OD-14** — root `SKILLS.md`, retire or rewrite.
- Harvesting, **as a recurring task**, until [[skill-harvesting-charter]]'s trigger
  fires ([[technology]] §4.3).

## Explicit non-goals

| Not ours | Whose |
|---|---|
| Deleting anything | [[skill-lifecycle-anti-sprawl-charter]] — the split is the department's core mechanism ([[skills-premortem]] M1) |
| Firing telemetry, the 30-day review | [[skill-lifecycle-anti-sprawl-charter]] |
| Skill **content** for T1/T2 tiers | Engineering / Data / the owning department ([[README]] §3.2) |
| Systematic mining of past work at volume | [[skill-harvesting-charter]], once gated in |
| Whether the harness can load a skill | `[[aio-harness-runtime]]` |

**Distinct from [[skill-lifecycle-anti-sprawl-charter]] because** this team is
scored on skills *created and firing*; that team is scored on skills *deleted*.
Giving both to one owner produces a team that never deletes anything
([[technology]] §4.2). This is the single sibling boundary that must not be merged
for efficiency.

**Distinct from [[skill-harvesting-charter]] because** authoring starts from a
request and produces an artifact; harvesting starts from evidence and produces a
candidate. Opposite directions, same output type.

## Metrics it moves

- **Primary — `skills.protocol_compliance_rate`:** share of committed skills citing
  a **real past instance** where they would have helped ([[README]] §3.3 rule 3).
  This is the anti-speculation gate. **Today the denominator is 0**, and the one
  `SKILL.md` on disk was written by a vendor CLI, so it cites nothing.
- `skills.registry_size` — committed skills. **0.**
- `skills.description_disambiguation_rate` — share of registered skills whose
  declared trigger does not overlap any sibling's. Trivially 100% at n=1; the
  metric only becomes informative above ~10 and is defined now so the baseline is
  not invented retrospectively.

## Evidence today

**PARTIAL.**

- **PARTIAL — the de-facto template.** `.agents/skills/railway-config/SKILL.md:1-214`
  is the sole `SKILL.md` in the repo and therefore the contract's starting shape:
  `name:2`; `description:3` — 60 words, explicitly enumerating *when to use this*
  (create, change, import, review, troubleshoot Railway config), which is exactly
  the quality bar this team must codify; then `## Core rules:16` (12 numbered
  imperatives, several of them prohibitions), `## Commands:31`, `## Authoring:69`,
  `## Review checklist:204`.
  ⚠️ **It is not committed.** `.gitignore:100` ignores `.agents/`; `git ls-files`
  does not know the file. It is a borrowed template, not an owned artifact.
- **PARTIAL — root `SKILLS.md`.** 163 lines of prose reasoning protocol under the
  filename a contributor searches first. Stale brand at `SKILLS.md:3` and
  `SKILLS.md:53` (*"WineOps AI"*). **OD-14**, open, and this team's to close.
- **NEW — `.claude/skills/`.** Absent. `.claude/` holds `launch.json`,
  `settings.local.json`, `worktrees`.
- **NEW — the registry index and the protocol gate.** [[README]] §3.3 is written
  prose with no enforcement. The enforcement pattern exists and is proven elsewhere:
  five `scripts/check_*.sh` guards wired into `.github/workflows/ci.yml`.
- **EXISTS — demand.** 59 entries in `scripts/`, three built CLIs among them
  (`docgen/` 11 modules, `synth/` 11, `simulate/` 8). Procedures are being written
  constantly; they are just not being written as skills.

**Honest read:** this team has a template it does not own, a protocol nobody
enforces, and a registry that does not exist. Its first deliverable is a directory.
