---
type: agenda-full
division: applied-ai
department: skills
team: skill-harvesting
status: provisional
metrics: [skills.harvested_firing_rate_30d, skills.registry_size, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skill-harvesting-charter]]", "[[skill-harvesting-premortem]]", "[[skill-harvesting-directive]]", "[[skill-harvesting-loops]]", "[[skill-harvesting-schedule]]", "[[skill-harvesting-agenda-board]]", "[[skills-agenda-full]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[technology]]"]
---

# Skill Harvesting — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.
>
> **And more than provisional: this team is GATED and unstaffed.** It does not begin
> until the registry holds ≥15 skills ([[technology]] §4.3). Registry size today:
> **0**. Everything below is a plan for a team that may never be staffed, and that
> should be deleted rather than carried if its trigger has not fired by 2027-08-24.

## What

*If and when the gate opens:* convert the existing reservoir of unowned procedures
into skills that actually fire, at a rate the deletion engine can absorb.

**Until then — and this is the operative half of this document — the harvest is a
quarterly sweep inside [[skill-registry-authoring-schedule]], not a team.** The two
things this file is really for:

1. Keeping the trigger visible so it is *evaluated*, not merely written.
2. Recording the reservoir now, so a future sweep starts from evidence rather than
   from a fresh re-derivation.

## How

- **Evidence of recurrence, not existence.** A candidate must show the procedure
  happening more than once — repeated commits, multiple CI invocations, a thread
  asking how to do it again. A script with one commit and no callers is a one-off;
  harvesting it converts dead tooling into live clutter
  ([[skill-harvesting-premortem]] M2). `git log --follow` answers this in seconds.
- **Rate-limited admission.** Candidates enter through
  [[skill-registry-authoring-directive]]'s gate at a rate set by
  [[skill-lifecycle-anti-sprawl-charter]]'s review capacity — never by the size of
  the backlog. **The backlog is not a deadline.** 59 scripts that sat unowned for a
  year can sit another quarter.
- **No bulk path, ever.** If a bulk-admission path exists, M1 has already happened
  and is merely waiting to be run.
- **Predict firing before admitting.** Each candidate carries a prediction: will
  this fire within 30 days? The team's whole claim is that harvested skills beat
  authored ones on that metric, and a claim without a prediction cannot be tested.

## Why now — the honest answer is *not now*

Three reasons this is deliberately not started:

1. **There is nothing to harvest into.** `.claude/skills/` does not exist.
2. **The distinction only pays off at volume** ([[technology]] §4.3). At n=0,
   harvesting and authoring are the same job done by one team, and splitting them
   creates two teams' worth of coordination for one team's work.
3. **The team's disband condition is currently unmeasurable.**
   `harvested_firing_rate_30d` needs firing telemetry, which does not exist. Staffing
   a team whose failure cannot be detected means staffing a team that never fails
   (M4).

**What *is* worth doing now, from inside [[skill-registry-authoring-charter]]:**
record the reservoir (done, in [[skill-harvesting-charter]] §Evidence) and pick the
**one** most obviously recurrent procedure as harvest candidate #1 — not sixty.

## Next steps

Nothing here is assigned to this team; every row is held elsewhere until the gate opens.

| # | Step | Held by | Status |
|---|---|---|---|
| 1 | Monthly registry census against the ≥15 trigger | [[skills-schedule]] | not scheduled |
| 2 | Quarterly harvest sweep, rate-limited | [[skill-registry-authoring-schedule]] | inherited, dormant |
| 3 | Pick harvest candidate #1 on evidence of recurrence | [[skill-registry-authoring-charter]] | not started |
| 4 | Propose the telemetry clause be added to the entry trigger (OD-22) | [[skills-directive]] | not raised |
| 5 | Set the sunset: delete this team if untriggered by 2027-08-24 | founder | not decided |

## Questions for the founder

1. **OD-22 — chartered now with a trigger, or not chartered until it fires?** This
   directory is one answer; [[technology]] §7 records the question as open. Seven
   documents for an unstaffed team is a real cost, and [[technology]] §4.3 says
   plainly: *"If the team count must be cut, cut this one first."*
2. **Should the entry trigger gain a telemetry clause?** Proposed: *≥15 skills
   **and** firing is measurable.* Without it, the team can be staffed into a state
   where its own disband condition cannot be evaluated (M4). This is an amendment to
   a written trigger and therefore a decision, not a team-level judgement.
3. **What is the admission rate limit?** Candidates per month, set by review
   capacity rather than backlog size. Needs a number before the gate opens, not after.
4. **Do you accept the 2027-08-24 sunset?** If the trigger has not fired by then,
   this team is deleted and these seven documents go with it. Pre-agreeing makes it
   administrative rather than an admission.
