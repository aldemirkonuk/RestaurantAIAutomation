---
type: charter
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: new
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-premortem]]", "[[skill-lifecycle-anti-sprawl-directive]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[skill-lifecycle-anti-sprawl-schedule]]", "[[skill-lifecycle-anti-sprawl-agenda-full]]", "[[skill-lifecycle-anti-sprawl-agenda-board]]", "[[skill-registry-authoring-charter]]", "[[skill-harvesting-charter]]", "[[ai-orchestration-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[README]]", "[[technology]]"]
---

# Skill Lifecycle & Anti-Sprawl — Charter

Team `skill-lifecycle-anti-sprawl` · department [[skills-charter]] · division `applied-ai`.
Alias in [[technology]] §4.2: `[[roster-lifecycle-charter|skl-lifecycle]]`.

> **This team is the department's reason to exist.** The founder mandate is *create
> skills constantly*. [[README]] §3.3 names sprawl as **the** failure mode of that
> mandate. The counter-pressure has to be someone's job title, or it is a comment in
> a README. This is the job title.

## Mandate

Own **firing telemetry, the 30-day staleness review, deprecation, deletion, and the
weekly skill-health job** ([[README]] §3.3, §6). The team is accountable for the
registry getting *smaller* when it should — which means it is accountable for making
"has this skill fired?" an answerable question first, because nothing can be deleted
on the basis of an unknown.

## Boundaries

- **Firing telemetry.** A `skill_id` on the NF-A event ([[README]] §4.2, §4.4
  `context` jsonb) and a firing log. Without it, everything else here is theatre.
- **The 30-day rule.** [[README]] §3.3: a skill that has not fired in 30 days is
  reviewed for deletion.
- **Deprecation and deletion** — including over the author's objection. Deletion
  authority that requires the author's consent is not deletion authority.
- **The weekly skill-health job** — what fired, what went stale ([[README]] §6).
  ⚠️ **Ownership contested**: §6 assigns this to Research & Math. See §Non-goals.
- **The registry ceiling's enforcement** — the paired-deletion rule
  ([[skills-premortem]] M1). The *value* of N is a founder call; enforcing it is ours.
- **Escalating the telemetry gap** as a blocker rather than absorbing it as a
  limitation.

## Explicit non-goals

| Not ours | Whose |
|---|---|
| Creating skills, the `SKILL.md` contract, description quality | [[skill-registry-authoring-charter]] |
| Mining past work for candidates | [[skill-harvesting-charter]] (gated) |
| The NF-A schema itself — we request a field, we do not design the table | [[research-math-charter|research-and-math-charter]] / OD-11 |
| Emitting the event | `[[observability-telemetry-plumbing-charter|sre-observability]]` + [[ai-orchestration-charter]] |
| Whether an agent task *succeeded* | `[[agent-evaluation-gates-charter|aio-evaluation-gates]]` — they grade outcomes, we count invocations |
| Setting N | Founder ([[skills-directive]]) |
| **T4 meta-skill methodology** (`skill-create`, `skill-review`) | [[research-math-charter|research-and-math-charter]] per [[README]] §3.2 |

### The contested job — stated, not resolved

[[README]] §6 schedules *"Weekly — Skill health: what fired, what went stale"* under
**Research & Math**. [[technology]] §4.2 gives the same staleness review to this
team. Both cannot own it. This team's position: **Research & Math owns the
methodology of T4 meta-skills; this team runs the job and holds the deletion
authority.** Per CLAUDE.md §0.1 that is a proposal, not a decision — it needs an
`OPEN-DECISIONS.md` entry.

**Distinct from [[skill-registry-authoring-charter]] because** — and this is the
entire justification for two teams instead of one — **authoring optimizes for
creation and lifecycle optimizes for deletion. A team that owns both never deletes
anything** ([[technology]] §4.2). Merging these two teams is the single most
damaging structural change available to this department, and it will be proposed as
an efficiency, because it looks like one.

## Metrics it moves

- **Primary — `skills.deletions_per_quarter`.** Skills deleted or deprecated.
  **A quarter with zero deletions and non-zero additions is a failing quarter, not
  a healthy one** ([[technology]] §4.2). Scoring this team on registry *health*
  instead would let it rationalise keeping everything; scoring it on removals will not.
- `skills.firing_rate_30d` — share of registered skills invoked at least once in 30
  days. **Currently undefined, not zero.** Undefined defaults to "keep"; the whole
  team exists downstream of fixing that.
- `skills.registry_size` — watched, not owned. Rising size with flat deletions is
  the [[skill-lifecycle-anti-sprawl-premortem]] M1 signal.
- `nf_a.skill_id` — the requested field. Its absence is this team's critical path.

## Evidence today

**NEW.** [[technology]] §4.2 grades this team NEW and the grade is correct — this
session found nothing to upgrade it.

- **NEW — no firing telemetry anywhere.** No `skill_id`, no invocation log, no
  counter. [[README]] §1 states L4 *"emits nothing yet — no cost/token
  instrumentation in `apps/api-gateway`"*. The signal this team runs on does not
  exist at any layer.
- **NEW — no staleness review, no scheduled job, no deprecation path.** The 30-day
  rule is prose at [[README]] §3.3 and nothing else.
- **NEW — nothing to delete.** `.claude/skills/` does not exist; `registry_size` is
  0. The team has no inventory, which is the one genuinely good piece of news: the
  telemetry can be built *before* the first skill, and that ordering is the
  difference between this team working and not.
- **EXISTS — the working analogue, and it is a close one.**
  `.github/workflows/schema-parity.yml:26-27` — a daily cron (`0 6 * * *`) that
  fails loudly on drift. Same shape: a scheduled job that detects a quiet,
  accumulating divergence nobody would otherwise notice. Copy it.
- **EXISTS — proof the org can enforce rules by grep.** Five `scripts/check_*.sh`
  guards in `.github/workflows/ci.yml`. The paired-deletion rule is implementable
  the same way.
- **EXISTS — the sprawl reservoir.** 59 entries in `scripts/`, unowned, with no
  staleness process of any kind. That is what this department looks like in three
  years without this team.
