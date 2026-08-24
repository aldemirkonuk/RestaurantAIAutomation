---
type: premortem
division: applied-ai
department: skills
team: skill-lifecycle-anti-sprawl
status: new
metrics: [skills.deletions_per_quarter, skills.firing_rate_30d, skills.registry_size]
updated: 2026-08-24
links: ["[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-lifecycle-anti-sprawl-directive]]", "[[skill-lifecycle-anti-sprawl-loops]]", "[[skills-premortem]]", "[[skill-registry-authoring-charter]]", "[[red-team-charter]]", "[[README]]", "[[technology]]"]
---

# Skill Lifecycle & Anti-Sprawl — Premortem

> Written at founding, before success is assumed. This team has **no artifacts**, so
> every mechanism below is a forecast about a team that does not yet do anything —
> which is precisely when the forecast is worth writing.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — Telemetry was never wired, so "has this fired in 30 days" stayed unanswerable, so nothing was ever deleted

[[technology]] §4.2's own premortem, and first here because it is the **enabling
condition for every other failure**. The 30-day rule asks one question. Today the
system cannot answer it: no `skill_id`, no invocation log, and L4 emits nothing
([[README]] §1). Getting the field added means negotiating with
[[ai-orchestration-charter]] and `[[observability-telemetry-plumbing-charter|sre-observability]]` for a schema change on a
table that does not exist yet, against OD-11 which is still open. That negotiation
is slow, unglamorous, and belongs to a team with zero artifacts and no leverage. So
it slips. Meanwhile skills accumulate. Every staleness review defaults to *keep*,
because "we don't know whether it fired" is not grounds for deletion. The
anti-sprawl rule becomes a comment in a README — the documented fate of most
anti-sprawl rules.

**Earliest observable signal.** Skill #2 is committed while `firing_rate_30d` is
still undefined. That is weeks away, not quarters, and it is a **binary, dated,
checkable** condition — not a trend anyone has to interpret.

**What would have prevented it.** **Telemetry precedes skill #2**, as a hard
sequencing rule enforced at [[skill-registry-authoring-charter]]'s gate rather than
requested politely by this team. The registry does not accept a second skill until
the first one's invocation is observable. Two properties make this work: it is
enforceable by the *other* team (who have the gate), and it costs almost nothing
today, when the registry is empty. Waiting until skill #12 to notice makes it a
migration instead of a design choice.

**Fallback if the NF-A negotiation stalls:** a filesystem-grade proxy —
`git log --format=%H -- .claude/skills/<name>` plus an append-only invocation log
written by the harness. Cruder than an NF-A field and good enough to make deletion
defensible. **A crude signal that exists beats a clean one that is blocked**, and
this team should adopt the crude one at the first sign of the negotiation slipping.

---

### M2 — The reviews happened, thoroughly, and deleted nothing

Subtler than M1 and more likely once M1 is fixed. The weekly job runs. It produces a
list. Every item on the list has a reason to survive: *"that one is seasonal"*,
*"that one is for the annual audit"*, *"the author is still iterating"*, *"it hasn't
fired but it will once we onboard the next restaurant"*. Each reason is individually
plausible — that is what makes them dangerous — and the aggregate is a registry that
only grows. The team reports high review coverage and mistakes it for the outcome.
Twelve months on: 40 skills, 40 reviews per month, zero deletions, and a genuine
belief the process is working.

**Earliest observable signal.** The **first** quarter closing with
`deletions_per_quarter == 0` and additions > 0. Not the second — the first. One
quarter is noise only if you have quarters to spare, and a team whose primary metric
is deletions does not.

**What would have prevented it.** Three things:

1. **The primary metric is deletions, not reviews.** Already written into
   [[skill-lifecycle-anti-sprawl-charter]]. A team scored on review coverage will
   achieve review coverage.
2. **Default-delete, not default-keep.** A skill that has not fired in 30 days is
   deleted *unless* someone writes down why, with a date by which it must fire. The
   burden of proof sits on retention. Reversing that default is the whole game, and
   it costs nothing because a deleted skill is one `git revert` away — genuinely
   cheap, unlike a false merge in the catalogue.
3. **Report the zero-deletion quarter to [[red-team-charter]], not only to
   ourselves.** A team reporting on its own core failure mode to no one else is the
   arrangement [[ORG_STRUCTURE]] §3 rejects for a reason.

---

### M3 — Deletion authority was nominal, because the author always got a veto

The charter grants deletion authority "including over the author's objection". In
practice, deleting something a colleague wrote last month is socially expensive, and
in a company where the founder writes most things, deleting a founder-authored skill
is *very* expensive. The team softens: deprecate instead of delete, mark as
"experimental", move to an `archive/` folder that is still loaded. Nothing is
removed from the selection space, which is the only thing that mattered — a
deprecated skill still in the directory still competes for selection.

**Earliest observable signal.** The first skill marked deprecated rather than
deleted **without** a removal date. Also: the appearance of any `archive/`,
`deprecated/`, or `experimental/` subdirectory inside `.claude/skills/`.

**What would have prevented it.** **Deprecation must carry a removal date, and the
date is not negotiable at renewal.** Deprecated means *scheduled for deletion*, not
*kept quietly*. And deprecated skills move **out** of `.claude/skills/` immediately —
if the harness can still select it, it has not been deprecated in any sense that
matters. One structural rule beats any amount of resolve.

---

### M4 — We measured invocation and called it value

The telemetry lands. `firing_rate_30d` becomes measurable. Skills that fire are
kept. But firing is not usefulness: a skill with a broad description fires
constantly *because* it collides with everything
([[skill-registry-authoring-premortem]] M2), and its high firing rate is evidence of
a **problem** being read as evidence of value. Meanwhile a precise, correct skill
fires twice a quarter and gets deleted. The registry evolves toward vague,
high-firing, low-value skills — actively selected for by this team's own metric.

**Earliest observable signal.** The firing distribution goes bimodal: a handful of
skills taking the large majority of invocations while the median skill sits near
zero. Visible as soon as there are ~10 skills and any firing data at all.

**What would have prevented it.** Pair the firing count with a **doneability
verdict** from `[[agent-evaluation-gates-charter|aio-evaluation-gates]]` — [[README]] §4.2 already puts a
doneability verdict on the NF-A event, so the join is available if the `skill_id`
request includes it. **Ask for both fields in the same negotiation**, since asking
twice costs twice. Retention rule: a skill that fires often and completes rarely is
a *collision*, not an asset, and is referred back to
[[skill-registry-authoring-charter]] for narrowing rather than kept for its volume.

---

## Signal summary

| # | Mechanism | Earliest signal | Detection |
|---|---|---|---|
| M1 | Telemetry never wired | Skill #2 lands, `firing_rate_30d` undefined | Binary, dated |
| M2 | Reviews without deletions | First quarter: additions > 0, deletions == 0 | `git log --diff-filter=D -- .claude/skills/` |
| M3 | Deletion authority nominal | First deprecation with no removal date; any `archive/` dir | Directory listing |
| M4 | Firing mistaken for value | Bimodal firing distribution at n≈10 | Firing log |

**M1 blocks M2, M3 and M4 from even being observable.** That is the argument for
this team's sequencing: telemetry is not the first task because it is the most
interesting, it is first because the other three failures are invisible without it.
