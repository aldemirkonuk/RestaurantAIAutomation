---
type: schedule
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: new
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d]
updated: 2026-08-24
links: ["[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[skill-lifecycle-anti-sprawl-directive]]", "[[skills-schedule]]", "[[research-math-charter|research-and-math-charter]]", "[[README]]"]
---

# Skill Lifecycle & Anti-Sprawl — Schedule & Skills

## Recurring work

Nothing runs yet. All rows `NEW`. This team's entire schedule is currently blocked
on one absent field.

| Cadence | Job | Emits | Status |
|---|---|---|---|
| Weekly | **Skill health** — what fired, what went stale ([[README]] §6, §3.3) | NF-A | **NEW · ownership contested.** [[README]] §6 assigns it to Research & Math; [[technology]] §4.2 assigns the staleness review here. Needs a founder call. |
| Monthly | **Staleness review** — 30-day no-fire → default-delete | — | NEW · blocked on telemetry |
| Per-merge | **Ceiling / paired-deletion guard** | CI pass/fail | NEW · dormant until N is set |
| Quarterly | **Deletion report** — deletions vs additions, sent to the founder **and** [[red-team-charter]] | — | NEW |

**Build target:** `.github/workflows/schema-parity.yml:26-27` — daily cron
(`0 6 * * *`), fails loudly on drift. Same problem shape as skill staleness: a quiet
divergence that accumulates and that nobody notices without a scheduled loud noise.
Copy the shape rather than designing one.

**The cadence question worth settling early.** [[README]] §6 says weekly;
[[README]] §3.3's rule is a 30-day window. A weekly job over a 30-day window is
correct — the window is the *criterion*, the cadence is how often we check it — but
it means the same skill appears in four consecutive reports before it becomes
actionable. Report it as a countdown ("fires in 8 days or is deleted"), not as a
repeated warning, or the report trains people to ignore it.

**Anti-sprawl applies to this table** ([[README]] §6): a scheduled job with no action
for 3 consecutive runs is downgraded or deleted. With `registry_size == 0`, the
weekly job will produce nothing for its first several runs **by construction** —
that is not the rule firing, and it should be documented as an explicit exemption
before someone applies the rule to the anti-sprawl job itself.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed
for deletion — by this team, under [[skill-lifecycle-anti-sprawl-directive]].

**Count today: 0.** The directory does not exist. Nothing has ever been deleted,
because nothing has ever been added.

| Skill | Tier | Owning dept | Last fired | Status |
|---|---|---|---|---|
| — | — | — | — | registry empty |

### Deletion log

Empty. It is the team's primary output and the honest place to look first.

| Date | Skill | Reason | Last fired |
|---|---|---|---|
| — | — | — | — |

### The one skill this team intends to own

| Skill | Tier | Why |
|---|---|---|
| `skill-health-report` | T4 | The weekly job as a skill rather than a bespoke script — so the anti-sprawl mechanism is itself subject to the anti-sprawl rule. If it stops firing, it gets reviewed like anything else. |

**Note on tier discipline:** T4 is the only tier the Skills department may own
([[skills-directive]]), and [[README]] §3.2 nominally assigns T4 *methodology* to
Research & Math. `skill-health-report` is operational, not methodological, which is
where this team believes the line falls — but the line is exactly what the contested
weekly-job ownership question is about, so it is flagged rather than assumed.
