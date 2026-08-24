---
type: schedule
division: applied-ai
department: skills
status: new
metrics: [skills.registry_size, skills.firing_rate_30d, skills.deletions_per_quarter]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skills-loops]]", "[[skills-directive]]", "[[skill-registry-authoring-schedule]]", "[[skill-lifecycle-anti-sprawl-schedule]]", "[[skill-harvesting-schedule]]", "[[research-and-math-charter]]", "[[README]]"]
---

# Skills — Schedule & Skills

## Recurring work

**Nothing below is scheduled yet.** Every row is `NEW`. The department owns zero
running jobs today.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Weekly | **Skill health** — what fired, what went stale ([[README]] §6, §3.3) | NF-A | **NEW · ownership contested** — [[README]] §6 assigns this to Research & Math; [[technology]] §4.2 assigns it here. See [[skills-agenda-full]] §Questions. |
| Weekly | Description-collision scan — do two skills claim overlapping triggers? | — | NEW |
| Monthly | Registry census — `registry_size` vs the ≥15 harvesting trigger and the <5 retirement trigger | — | NEW |
| Monthly | Staleness review — 30-day no-fire → deprecate or delete | — | NEW · blocked on telemetry |
| Per-merge | Protocol-compliance guard — §3.3's four fields, in CI | — | NEW |
| Quarterly | Harvest sweep of `scripts/` | — | **DORMANT** until ≥15 skills |

**Build target for the weekly job:** `.github/workflows/schema-parity.yml:26-27` —
a daily cron (`0 6 * * *`) that fails loudly on drift. That workflow is the closest
working analogue in the repo and the skill-health job should copy its shape rather
than invent one.

**Anti-sprawl applies to this table too.** [[README]] §6: *a scheduled job that
produces no action for 3 consecutive runs gets downgraded or deleted.* Six proposed
jobs for a department with zero artifacts is already at the edge of that rule; the
first three rows are the ones that earn their slot.

## Skills owned

Skills live in **`.claude/skills/`** — auto-discovered, committed, PR-reviewable
(`OPEN-DECISIONS.md`, Resolved). A skill that has not fired in 30 days is reviewed
for deletion.

**Count today: 0.** The directory does not exist. `.claude/` currently holds
`launch.json`, `settings.local.json`, and `worktrees`.

| Skill | Tier | Owning dept | Status |
|---|---|---|---|
| — | — | — | registry empty |

### What exists instead, and why it does not count

- `.agents/skills/railway-config/SKILL.md` — well-formed and useful, but
  **vendor-installed and gitignored** (`.gitignore:100`, comment: *"Railway IaC —
  CLI-installed agent skill"*). Not tracked by git. It is the department's best
  available **template**, not its first entry.
- Root `SKILLS.md` (163 lines) — a prose reasoning protocol, **not a skill**, still
  branded "WineOps AI" (`SKILLS.md:3,53`). **OD-14**, open.
- `scripts/` — 59 entries of unowned procedure: 5 `check_*.sh` CI guards, and three
  built CLIs (`scripts/docgen/` 11 modules, `scripts/synth/` 11,
  `scripts/simulate/` 8). Harvest material for [[skill-harvesting-charter]], gated.

### First three skills the department intends to own (T4 meta only)

Named here so the department's own tier discipline is visible: it may own T4 and
nothing else ([[skills-directive]] §Decision rights).

| Skill | Why | Real past instance required by §3.3 |
|---|---|---|
| `skill-create` | Makes the compliant path faster than writing a `scripts/` file — the counter to [[skills-premortem]] M3 | This session: 28 org docs written by hand against a template that a scaffold could have filled |
| `skill-review` | Runs the [[skills-directive]] gate as a procedure rather than a person | — must cite one before it is written |
| `skill-health-report` | The weekly job, as a skill rather than a bespoke script | `.github/workflows/schema-parity.yml` proves the pattern works |

`skill-review` is listed **without** a cited instance on purpose: under §3.3 rule 3
it is therefore not yet eligible to be written. Leaving that visible is cheaper than
inventing a justification, and it is exactly the discipline the department is
supposed to enforce on everyone else.
