---
type: premortem
division: applied-ai
department: skills
team: skill-registry-authoring
status: partial
metrics: [skills.protocol_compliance_rate, skills.description_disambiguation_rate, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skill-registry-authoring-charter]]", "[[skill-registry-authoring-directive]]", "[[skill-registry-authoring-loops]]", "[[skills-premortem]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]", "[[technology]]"]
---

# Skill Registry & Authoring — Premortem

> Written at founding, before success is assumed.

## It is 2027-08-24 and this team has failed. What happened?

---

### M1 — The protocol became paperwork and the "real past instance" became fiction

[[technology]] §4.1 names this one, and it is first because it is the cheapest
failure to fall into. §3.3 rule 3 asks every skill to cite a real past instance
where it would have helped. That is an unusual, genuinely load-bearing requirement —
and it is also a text field. Within two quarters, the field is being filled in
*after* the skill is written, with a sentence like *"this would have helped during
the inventory rebuild"* that no one checks and that references nothing. The registry
fills with plausible-sounding skills that have never fired and never will, and the
gate that was supposed to prevent speculation is now the paperwork that legitimises it.

**Earliest observable signal.** The first skill whose past-instance field contains
no citable artifact — no commit SHA, no file path, no thread. Detectable by grep on
the day it lands: the field either matches `[0-9a-f]{7,}` / a path / a URL, or it
does not.

**What would have prevented it.** Make the field **machine-checkable, not
free-text**: `past_instance` must resolve to a commit SHA, a `path:line`, or a
linked decision. A `check_skill_protocol.sh` guard in the shape of the five existing
`scripts/check_*.sh` guards rejects anything else at merge. "A reviewer will notice"
is not a counter-pressure; a grep is.

---

### M2 — Descriptions collided, and the wrong skill kept firing

The team optimises for creation, and creation is measured by count. Twenty skills
land. Six of them have descriptions that overlap — `invoice-parse` vs
`document-extract` vs `vendor-doc-read` — because each was written in isolation
against its own trigger and nobody diffed the trigger space. Selection becomes a
coin flip, agents invoke the wrong procedure, and the failure surfaces as *"skills
don't work"* rather than *"two descriptions claim the same trigger"*. The registry's
value degrades faster than its size grows, which is the specific pathology of a
discoverability layer.

**Earliest observable signal.** `skills.description_disambiguation_rate` drops below
100% — i.e. the first pair of skills whose declared triggers intersect. It is
observable at the second skill, not the twentieth, which is why the metric is
defined at n=0 in [[skill-registry-authoring-charter]] rather than when it starts
to hurt.

**What would have prevented it.** A **collision scan as an authoring step, not a
review step**: before a skill is accepted, its trigger is diffed against every
registered trigger, and an intersection forces a merge-or-narrow decision at that
moment ([[skill-registry-authoring-directive]] gate, node E). The scan is weekly in
[[skill-registry-authoring-schedule]] as a backstop, but a backstop that runs after
the merge is already late.

---

### M3 — The compliant path stayed slower than writing a script, so nobody used it

Four required fields, a review, a CI guard. Versus: `touch scripts/do_the_thing.py`.
`scripts/` already holds 59 entries and has no owner, no protocol, and no gate — it
is not a hypothetical bypass, it is the established habit of this repo. Engineering
and Data keep shipping procedures there. The registry grows to five skills in a
year, all authored by this team, none by the departments that own the domains, and
the team concludes the problem is insufficient enforcement — which makes the bypass
more attractive, not less.

**Earliest observable signal.** `skills.script_to_skill_ratio` — new files under
`scripts/` versus `.claude/skills/` per month. Baseline **59:0**. If it has not
fallen below 1:1 two quarters after the registry exists, the compliant path has lost.

**What would have prevented it.** A **`skill-create` T4 meta-skill that pre-fills
three of the four protocol fields from the commit that motivated the skill**, so
compliance is a byproduct of using the tool rather than a form. The requirement is
blunt: authoring a compliant skill must take less wall-clock time than writing the
equivalent script. If it does not, no amount of enforcement fixes it — the founder
mandate *create skills constantly* will simply be satisfied somewhere else.

---

### M4 — We inherited a template we do not own, and never noticed

The only `SKILL.md` in the repo is `.agents/skills/railway-config/SKILL.md` — good
enough that it becomes the contract by imitation. It is also **vendor-installed and
gitignored** (`.gitignore:100`). A Railway CLI update rewrites or removes it; the
team's reference shape changes underneath it, or vanishes, and nobody notices
because the file was never in a diff. Worse: conventions get copied from it that
suit a vendor's tool (its 12 numbered `## Core rules`, its `railway config *`
command block) and not this repo's needs, and the contract quietly encodes someone
else's product decisions.

**Earliest observable signal.** Any change to that file that does not appear in
`git log` — which is *every* change to that file. The condition is already true
today; it just has not cost anything yet.

**What would have prevented it.** **Copy it into ownership on day one.** Extract the
shape into a committed `.claude/skills/_contract/SKILL.template.md` under this
team's control, cite the original as provenance, and stop reading the gitignored
file as the source of truth. Five minutes of work, and it is the difference between
a contract and a coincidence.

---

## Signal summary

| # | Mechanism | Earliest signal | Detection |
|---|---|---|---|
| M1 | Past-instance becomes fiction | First non-citable `past_instance` field | grep at merge |
| M2 | Description collision | `description_disambiguation_rate` < 100% | trigger diff at authoring |
| M3 | Routed around by `scripts/` | ratio stays > 1:1 for 2 quarters | monthly file counts |
| M4 | Borrowed template drifts | any silent change to `.agents/skills/…` | condition already true |
