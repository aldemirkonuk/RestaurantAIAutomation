---
type: premortem
division: applied-ai
department: skills
team: skill-harvesting
status: new
metrics: [skills.harvested_firing_rate_30d, skills.registry_size, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-directive]]", "[[skill-harvesting-loops]]", "[[skills-premortem]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-registry-authoring-charter]]", "[[technology]]"]
---

# Skill Harvesting — Premortem

> Written at founding, before success is assumed — and before the team exists at
> all. A gated team's premortem has one extra job: describing how the **gate**
> fails, not only how the work fails.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — It was staffed early and delivered sprawl in a single sprint

[[technology]] §4.3's own premortem, and the most likely failure by a wide margin
because it is the *tempting* one. Someone looks at `scripts/` — 59 entries, three
built CLIs, five CI guards — and sees a quarter of obvious wins. The team is staffed
ahead of its trigger, wraps 60 procedures in `SKILL.md` files in one sprint, and
hands [[skill-lifecycle-anti-sprawl-charter]] **60 stale skills on day one**. Not
one of them cites a past instance in the §3.3 sense, because the evidence cited is
*"this script exists"* rather than *"this procedure was needed and absent."*
Selection quality collapses under 60 overlapping descriptions. **Sprawl delivered
by the mechanism meant to prevent it** — and delivered faster than any other
mechanism in the department could have managed.

**Earliest observable signal.** More than **3 harvested candidates admitted in a
single week**. Not 60 — the moment the rate exceeds what one deletion engine can
review, the failure is already in motion. Also: any harvest sweep that produces
candidates without a per-candidate firing prediction.

**What would have prevented it.** Three things, in descending order of force:

1. **Respect the gate.** ≥15 skills or two green quarters
   ([[skill-harvesting-charter]]). The gate exists specifically to prevent this
   sprint from being possible.
2. **A hard admission rate limit that survives staffing** — no more than N harvested
   candidates admitted per month, where N is set by
   [[skill-lifecycle-anti-sprawl-charter]]'s review capacity, not by the size of the
   reservoir. **The backlog is not a deadline.** 59 scripts that have sat unowned
   for a year can sit for another quarter.
3. **Harvested candidates go through the same §3.3 gate as anything else**, with no
   bulk path. If a bulk path is ever built, M1 has already happened; it is just
   waiting to be executed.

---

### M2 — "This script exists" was accepted as the real past instance, and the anti-speculation gate quietly inverted

Subtler than M1 and it survives the rate limit. §3.3 rule 3 asks for a real past
instance where the skill *would have helped*. A harvesting team has an easy answer
for every candidate: the script itself. But a script's existence proves someone
wrote it once — not that the procedure recurs, not that anyone needed it and could
not find it, and not that an agent would ever select it. `scripts/` is full of
one-off tooling; that is what `scripts/` is *for*. The registry fills with
faithfully-harvested procedures that ran once, two years ago, and will never run
again. The strongest gate in the whole protocol has been satisfied by a tautology.

**Earliest observable signal.** The first candidate whose evidence is the harvested
file's own path and nothing else. Checkable mechanically: if `past_instance`
resolves to the same file the skill wraps, it is circular.

**What would have prevented it.** **Require evidence of recurrence, not of
existence.** A candidate must show the procedure happening **more than once** —
multiple invocations in CI history, repeated commits touching the same workflow, a
thread where someone asked how to do it again. `git log --follow` on the script and
its callers answers this in seconds. A script with one commit and no callers is not
a skill; it is a one-off, and harvesting it converts dead tooling into live clutter.

---

### M3 — The gate never fired, and the team existed on paper for a year

The inverse failure, and the one this directory itself makes more likely by
existing. The registry never reaches 15. The protocol-compliance metric is never
green for two quarters because it is never *measurable* — the denominator stays near
zero. The trigger is therefore never evaluated, the team is never staffed, and it is
never honestly retired either. Seven charter documents describe a team that has
never had a member, and TECH-F4 stays open for a year because an open question with no
forcing function stays open. This is [[skills-premortem]] M5 at team scale.

**Earliest observable signal.** **2026-11-24**: registry below 15 and no scheduled
re-evaluation of the trigger on the calendar. The absence of the calendar entry is
the signal, not the registry number.

**What would have prevented it.** **The trigger must be evaluated on a schedule, not
on someone's noticing.** The monthly registry census
([[skills-loops]] L4) reports registry size against **15** every month, and against
**5 at 2026-11-24** for the department's own retirement check. Both thresholds are
already written; the census is what turns them from thresholds into decisions.
And an explicit sunset: if the trigger has not fired by **2027-08-24**, this team is
deleted rather than carried — deleting seven documents is the correct outcome, and
pre-agreeing it now makes it an administrative act rather than an admission.

---

### M4 — Harvested skills fired no more often than authored ones, and nobody noticed because firing was never measured

The team's entire justification is one comparison:
`harvested_firing_rate_30d` **>** the on-demand authoring rate. If harvesting from
real work does not beat authoring on request, the team has no reason to exist
([[technology]] §4.3). That comparison needs firing telemetry — which does not exist,
which is blocked on `skill_id`, which is blocked on OD-11. So the team is staffed,
produces candidates, and its disband condition is permanently unevaluable. A team
whose failure cannot be measured does not fail; it persists.

**Earliest observable signal.** The team is staffed while
`skills.firing_rate_30d` is undefined. Same shape as
[[skill-lifecycle-anti-sprawl-premortem]] M1, one level up: the metric that would
retire the team is the metric nobody built.

**What would have prevented it.** **Add telemetry to the entry trigger.** The gate
should read: *≥15 skills **and** firing is measurable*. Without the second clause,
the team can be staffed into a state where it cannot be evaluated — and the first
clause alone is satisfiable by a team that simply creates 15 skills. This is a
proposed amendment to [[technology]] §4.3, not a decision; it belongs in TECH-F4.

---

## Signal summary

| # | Mechanism | Earliest signal | Detection |
|---|---|---|---|
| M1 | Staffed early, bulk-harvests | >3 candidates admitted in one week | Admission log |
| M2 | Circular past-instance | `past_instance` resolves to the wrapped file | grep at the gate |
| M3 | Gate never fires, team never retired | 2026-11-24: no scheduled trigger re-evaluation | Calendar / census |
| M4 | Disband condition unmeasurable | Staffed while `firing_rate_30d` undefined | Binary check at staffing |

**M1 and M3 are opposite failures with the same cause:** a trigger that is written
but not *evaluated on a schedule* can be jumped or ignored with equal ease.
