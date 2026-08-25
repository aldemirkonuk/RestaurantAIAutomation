---
type: schedule
division: applied-ai
department: skills
team: skill-registry-authoring
status: new
metrics: [skills.protocol_compliance_rate, skills.registry_size, skills.description_disambiguation_rate]
updated: 2026-08-24
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-loops]]", "[[skill-registry-authoring-directive]]", "[[skills-schedule]]", "[[skill-harvesting-charter]]", "[[README]]"]
---

# Skill Registry & Authoring — Schedule & Skills

## Recurring work

Nothing here runs yet. All rows `NEW`.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Per-merge | **Protocol guard** — §3.3's four fields; `past_instance` must resolve to a SHA or `path:line` | CI pass/fail | NEW — target `scripts/check_skill_protocol.sh`, wired into `.github/workflows/ci.yml` |
| Weekly | **Description-collision scan** — diff every registered trigger against every other | — | NEW |
| Monthly | **Registry index refresh** — skill · tier · owning dept · trigger · past instance | — | NEW |
| Monthly | **Bypass-pressure count** — new files in `scripts/` vs `.claude/skills/` | — | NEW |
| Quarterly | **Harvest sweep** of `scripts/` — a recurring *task* held here until [[skill-harvesting-charter]]'s ≥15 trigger fires ([[technology]] §4.3) | candidate queue | NEW · inherited |

**Build target for the guard:** the five guards already wired into CI —
`scripts/check_no_direct_stock_writes.sh`, `check_no_direct_type_attributes_access.sh`,
`check_no_guest_name_matching.sh`, `check_no_raw_guest_channels.sh`,
`check_schema_parity.sh`. Grep-grade enforcement is the proven pattern in this repo;
match it rather than designing something better.

⚠️ **Known limitation, inherited with the pattern.**
`scripts/check_no_direct_stock_writes.sh:10` documents that it is *"a grep, by its
own admission"* — a caller that constructs the pattern dynamically slips through.
The same will be true of `check_skill_protocol.sh`. Accept it: a grep that catches
90% of protocol violations at merge beats a reviewer who catches 100% of the ones
they happen to read.

**Anti-sprawl applies here too** ([[README]] §6): a scheduled job producing no action
for 3 consecutive runs is downgraded or deleted. Five jobs for a team with an empty
registry is already ambitious; rows 1 and 3 are the ones that earn their slot on day one.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed
for deletion by [[skill-lifecycle-anti-sprawl-charter]] — **not** by this team, on
purpose.

**Count today: 0.** The directory does not exist.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### Intended, in order

| Skill | Tier | Why it is first |
|---|---|---|
| `_contract/SKILL.template.md` | — (contract, not a skill) | Ends the dependency on the gitignored vendor file ([[skill-registry-authoring-premortem]] M4) |
| `skill-create` | T4 | The only tier this department may own. Pre-fills three of four protocol fields from the motivating commit, making compliance faster than the `scripts/` bypass (M3). |
| *(skill #1, domain)* | T1 | Authored by Engineering or Data, reviewed here. Must carry a genuine citable past instance — including if that means it is not `railway-config`. |

### Provenance note, kept deliberately visible

`.agents/skills/railway-config/SKILL.md:1-214` is the shape everything above is
derived from: `name:2`, `description:3` (states *when to use this* across five
trigger verbs), `## Core rules:16`, `## Commands:31`, `## Authoring:69`,
`## Review checklist:204`. It is **not ours** — `.gitignore:100` ignores `.agents/`,
and git has never seen the file. Treating it as canon is
[[skill-registry-authoring-premortem]] M4; citing it as provenance is correct.
