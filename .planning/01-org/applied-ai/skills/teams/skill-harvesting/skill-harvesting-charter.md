---
type: charter
division: applied-ai
department: skills
team: skill-harvesting
status: new
metrics: [skills.harvested_firing_rate_30d, skills.registry_size, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skill-harvesting-premortem]]", "[[skill-harvesting-directive]]", "[[skill-harvesting-loops]]", "[[skill-harvesting-schedule]]", "[[skill-harvesting-agenda-full]]", "[[skill-harvesting-agenda-board]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[technology]]", "[[README]]"]
---

# Skill Harvesting — Charter

Team `skill-harvesting` · department [[skills-charter]] · division `applied-ai`.
Alias in [[technology]] §4.3: `[[skill-harvesting-charter|skl-harvesting]]`.

> ## ⚠️ GATED — this team does not staff yet
>
> **Entry trigger, quoted from [[technology]] §4.3 and not softened here:**
>
> > *The registry holds ≥ 15 skills, or §4.1's protocol-compliance metric has been
> > green for two consecutive quarters. Until then, harvesting is a recurring task
> > inside `[[skill-registry-authoring-charter|skl-registry-authoring]]`. **If the team count must be cut, cut this
> > one first.***
>
> **Registry size today: 0.** The trigger is not close. This charter exists so the
> team's shape is written down before anyone is under pressure to invent it — not
> because the team is about to begin. Nobody works here. The recurring harvest sweep
> lives in [[skill-registry-authoring-schedule]] until the trigger fires.
>
> This is **OD-22** in [[technology]] §7: *chartered now with the trigger, or not
> chartered until it fires?* This directory is one answer; it is not the decision.

## Mandate

Mine work that **already happened** for procedures that should be skills — the
opposite direction of travel from authoring-on-demand. Harvesting starts from
evidence (a script that exists, a procedure that was repeated, a fix that was made
three times) and produces a *candidate*. Authoring starts from a request and
produces an *artifact*.

## Boundaries

*When and if staffed:*

- Systematic sweeps of `scripts/`, `.github/workflows/`, and repeated commit patterns
  for codified procedures missing a `SKILL.md`.
- The **candidate queue** — evidence, proposed trigger, proposed owning department.
- The rejected-proposal stream from [[skill-registry-authoring-directive]] (node D):
  proposals rejected for lacking a real past instance are logged as candidates here,
  because a rejected speculative skill is often a real one waiting for its evidence.
- Proving that harvested skills **fire more often** than on-demand ones — the only
  claim that justifies the team.

## Explicit non-goals

| Not ours | Whose |
|---|---|
| Admitting a candidate to the registry | [[skill-registry-authoring-charter]] — we produce candidates; they run the gate. Harvest volume must never bypass the §3.3 protocol. |
| Deletion, staleness, telemetry | [[skill-lifecycle-anti-sprawl-charter]] |
| Rewriting or owning the scripts we harvest from | Engineering / Data / Reliability — the script stays theirs; we extract the procedure |
| Skill **content** | The owning department ([[README]] §3.2) |
| Deciding our own staffing date | Founder / [[skills-directive]] — a gated team that self-activates has no gate |

**Distinct from [[skill-registry-authoring-charter]] because** the direction is
reversed: evidence → candidate versus request → artifact. **The distinction is real
but only pays off at volume** ([[technology]] §4.3) — which is exactly why it is
gated rather than staffed. At n=0 the two jobs are the same job, done by one team.

**Distinct from [[skill-lifecycle-anti-sprawl-charter]] because** that team removes;
this one adds. Note the structural hazard: harvesting is the department's *second*
creation engine, and it can out-produce the one deletion engine on its own. See
[[skill-harvesting-premortem]] M1.

## Metrics it moves

- **Primary — `skills.harvested_firing_rate_30d`:** harvested skills that fire
  within 30 days of registration. **Harvesting from real past work should beat
  on-demand authoring on this metric; if it does not, the team has no reason to
  exist** ([[technology]] §4.3). That is the disband condition, stated as a number.
- `skills.script_to_skill_ratio` — the reservoir this team drains. Baseline 59:0.
- `skills.registry_size` — watched, because this team is the fastest available way
  to make it grow, and growth is not the goal.

⚠️ **This metric is unmeasurable today**, for the same reason
[[skill-lifecycle-anti-sprawl-charter]]'s is: no firing telemetry exists. A team
whose disband condition cannot be evaluated is a team that never disbands — which
is an additional, independent argument for not staffing it before the telemetry
lands.

## Evidence today

**NEW as a team. EXISTS, abundantly, as raw material.** That gap is the whole story:
the harvest is real, the team is not needed to begin it.

**The reservoir — EXISTS.** `scripts/` holds **59 entries**, unowned, each a
codified procedure with a trigger and a success criterion — i.e. a skill missing its
`SKILL.md`:

- **5 CI guards:** `scripts/check_no_direct_stock_writes.sh`,
  `check_no_direct_type_attributes_access.sh`, `check_no_guest_name_matching.sh`,
  `check_no_raw_guest_channels.sh`, `check_schema_parity.sh`.
  ([[technology]] §4.3 says "four"; there are five on disk.)
- **Three fully-built CLIs:** `scripts/docgen/` (11 modules — compose · degrade ·
  truth · backtest · render · houses · templates · fixtures), `scripts/synth/` (11 —
  recipes · oracle · auth_personas · seed · snapshots · write_set · teardown · ids),
  `scripts/simulate/` (8 — bridge · payloads · detection · mappings · service).
- **5 CI/CD workflows** in `.github/workflows/`: `ci.yml`, `codeql.yml`, `deploy.yml`,
  `e2e-prod.yml`, `schema-parity.yml` — each an operational procedure with a trigger.

**NEW — everything else.** No candidate queue, no sweep, no harvested skill, no way
to measure whether a harvested skill fires. And no registry to harvest *into*:
`.claude/skills/` does not exist.

**Honest read.** The material is the strongest evidence in the department and the
team is the weakest justified. Both are true simultaneously, and the resolution is
the gate: harvest the reservoir slowly, from inside
[[skill-registry-authoring-charter]], until volume makes a dedicated team pay.
