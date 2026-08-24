---
type: charter
division: applied-ai
department: skills
status: partial
metrics: [skills.registry_size, skills.protocol_compliance_rate, skills.deletions_per_quarter, skills.firing_rate_30d]
updated: 2026-08-24
links: ["[[skills-premortem]]", "[[skills-directive]]", "[[skills-loops]]", "[[skills-schedule]]", "[[skills-agenda-full]]", "[[skills-agenda-board]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-harvesting-charter]]", "[[ai-orchestration-charter]]", "[[research-and-math-charter]]", "[[ORG_STRUCTURE]]", "[[technology]]", "[[README]]"]
---

# Skills — Charter

> **Under-teamed on purpose, and near-greenfield.** This is not a modest framing;
> it is the finding. See §Evidence today before reading anything else here as a
> going concern.

## Mandate

Skills owns the **contract and the lifecycle of the skill layer** — what a
`SKILL.md` must contain before it is committed, where skills live, how their firing
is observed, and when they are deleted. It does **not** own what any individual
skill knows how to do. The founder mandate is *create skills constantly*
([[README]] §3.3); the department exists so that mandate produces a registry rather
than a landfill. Every artifact here is downstream of one sentence in
[[README]] §3.3: *"Sprawl is the failure mode of 'constantly create skills,' and
the counter-pressure has to be built in from day one."*

## Boundaries

Owned outright:

- **The `SKILL.md` contract.** Frontmatter shape (`name`, `description`, owning
  department, trigger, doneability), body conventions, and the rule that the
  `description` says *when to use this* — because a description is the only thing
  that makes a skill discoverable at selection time ([[README]] §3.1).
- **The location decision, now settled.** Skills live in **`.claude/skills/`** —
  auto-discovered, committed, PR-reviewable (`.planning/decisions/OPEN-DECISIONS.md`,
  Resolved table). The directory **does not exist yet**; creating it is this
  department's first physical act.
- **The §3.3 creation protocol** — trigger · doneability criteria · a real past
  instance · owning department. Enforcement is a review gate, not a suggestion.
- **The registry index** — what exists, who owns it, when it last fired.
- **The lifecycle** — 30-day staleness review, deprecation, deletion, and the
  telemetry that makes "has this fired?" an answerable question rather than a guess.
- **Harvesting** codified procedures out of existing work into candidate skills —
  gated, see [[skill-harvesting-charter]].
- **OD-14** — root `SKILLS.md`: retire or rewrite. It is misfiled under this
  department's name and is this department's to close.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **Skill content** — what `wine-enrichment` or `menu-extraction` actually does | Engineering / Data ([[README]] §3.2, T1) | We own the envelope; the owning department owns the knowledge inside it. A skills team writing domain procedures becomes a bottleneck on knowledge it does not have. |
| **T2 department skills** (`legal-doc-draft`, `security-audit-pass`) | Each department | Same rule one tier up. |
| **The agent harness that invokes a skill** | [[ai-orchestration-charter]] → `[[aio-harness-runtime]]` | Whether a skill *can* be loaded and run is harness mechanics. Whether it *should exist* is ours. |
| **Grading agent task outcomes** | `[[aio-evaluation-gates]]` | They score whether the task was done. We score whether the skill fired at all and whether it earned its slot. |
| **NF-A metric methodology** | [[research-and-math-charter]] | They define what a doneability verdict means; we consume it as the firing signal. |
| **T4 meta-skill research** (`skill-create`, `skill-review`) | Research & Math per [[README]] §3.2 — **contested, see below** | Naming the seam rather than quietly claiming it. |
| **Model routing / cost of a skill invocation** | `[[aio-model-routing]]` | A skill is a procedure, not a spend decision. |

### Two seams that are not yet resolved

1. **The weekly skill-health job.** [[README]] §6 assigns *"Weekly — Skill health:
   what fired, what went stale"* to **Research & Math**. The team layer
   ([[technology]] §4.2) assigns the same staleness review to
   [[skill-lifecycle-anti-sprawl-charter]]. Both cannot own it. This department's
   position: **Research & Math owns the T4 meta-skill methodology; Skills runs the
   job.** That is a proposal, not a decision — it belongs in `OPEN-DECISIONS.md`
   and is raised in [[skills-agenda-full]] §Questions.
2. **OD-22 — three teams or two.** [[technology]] §4.3 charters
   [[skill-harvesting-charter]] with an explicit entry trigger and states plainly:
   *"If the team count must be cut, cut this one first."* That instruction is
   carried forward here rather than softened.

## Metrics it moves

| Metric | Definition | Today |
|---|---|---|
| `skills.registry_size` | Committed `SKILL.md` files under `.claude/skills/` | **0** |
| `skills.protocol_compliance_rate` | Share of committed skills citing a real past instance ([[README]] §3.3 rule 3) | undefined — denominator 0 |
| `skills.firing_rate_30d` | Share of registered skills invoked at least once in 30 days | **unmeasurable** — no telemetry exists |
| `skills.deletions_per_quarter` | Skills deleted or deprecated | 0, and a quarter with additions and zero deletions is a failing quarter |
| `skills.script_to_skill_ratio` | New procedures landing in `scripts/` vs `.claude/skills/` | ~59:0 — the bypass path is currently the only path |
| `nf_a.*` dependency | A `skill_id` on the NF-A event is the cheapest firing signal we will get | not emitted ([[README]] §1, L4 "emits nothing yet") |

## Evidence today

Graded per [[technology]] §0: **EXISTS** = running with an artifact · **PARTIAL** =
stub or fraction of mandate · **NEW** = proposal only.

**Roll-up: PARTIAL, and only barely.** One skill file, one misnamed prose doc, a
written protocol nobody enforces, and ~59 unowned procedures that behave like
skills. No registry, no telemetry, no lifecycle job.

- **PARTIAL — the sole `SKILL.md`.** `.agents/skills/railway-config/SKILL.md:1-214`.
  Well-formed: `name:2`, a genuinely discoverable `description:3` that states *when
  to use this*, `## Core rules:16`, `## Commands:31`, `## Authoring:69`,
  `## Review checklist:204`. It is the de-facto template.
  ⚠️ **Correction to the brief, verified this session:** this file is **not
  committed**. `.gitignore:100` ignores `.agents/` — the comment above it reads
  *"Railway IaC — CLI-installed agent skill"*. `git ls-files` does not know it.
  So the repo's *authored, committed* skill count is **zero**; the one artifact we
  have was installed by a vendor CLI. That makes the department more greenfield
  than [[technology]] §4.0 states, not less.
- **PARTIAL — root `SKILLS.md`.** 163 lines. A prose meta-cognitive reasoning
  protocol, not a skill, filed under the name a contributor would search for first.
  Stale brand at `SKILLS.md:3` and `SKILLS.md:53` — *"the WineOps AI project"*.
  This is **OD-14**, open.
- **NEW — `.claude/skills/`.** Does not exist. `.claude/` holds `launch.json`,
  `settings.local.json`, `worktrees` — no `skills/`.
- **NEW — the registry, the telemetry, the lifecycle job.** No index, no firing
  log, no scheduled staleness review, nothing consuming a `skill_id`.
- **EXISTS — the raw material, unowned.** `scripts/` holds 59 entries including
  **5** CI guards (`scripts/check_no_direct_stock_writes.sh`,
  `check_no_direct_type_attributes_access.sh`, `check_no_guest_name_matching.sh`,
  `check_no_raw_guest_channels.sh`, `check_schema_parity.sh`) and three built CLIs
  — `scripts/docgen/` (11 modules), `scripts/synth/` (11), `scripts/simulate/` (8).
  Each is a codified procedure with a trigger and a success criterion: a skill
  missing its `SKILL.md`. ([[technology]] §4.3 says "four `check_*.sh`"; the count
  on disk is five.)
- **EXISTS — the working analogue for the lifecycle job.**
  `.github/workflows/schema-parity.yml:26-27` — a daily cron (`0 6 * * *`) that
  fails loudly on drift. The skill-health job should be built in its shape, not
  invented.
- **EXISTS — the protocol text.** [[README]] §3.1 (what a skill is), §3.2 (the
  T1–T4 taxonomy), §3.3 (creation protocol + the 30-day anti-sprawl rule),
  §6 (weekly cadence). Written, locked in prose, unimplemented in code.

**Tiers are not teams.** [[README]] §3.2's four tiers describe *content ownership*
and are deliberately **not** mirrored into four teams — that would be the tidy grid
[[technology]] §0 test 4 exists to reject. Three teams, one of them gated.
