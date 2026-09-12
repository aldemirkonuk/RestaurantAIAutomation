---
type: premortem
division: applied-ai
department: skills
status: partial
metrics: [skills.registry_size, skills.deletions_per_quarter, skills.firing_rate_30d, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skills-loops]]", "[[skills-directive]]", "[[skill-registry-authoring-premortem]]", "[[skill-lifecycle-anti-sprawl-premortem]]", "[[skill-harvesting-premortem]]", "[[red-team-charter]]", "[[README]]", "[[technology]]"]
---

# Skills — Premortem

> Written at founding, before success is assumed. Five mechanisms, most likely first.

## It is 2027-08-24 and this department has failed. What happened?

---

### M1 — Sprawl won, exactly as predicted, because creation had a champion and deletion did not

The founder mandate is *create skills constantly*. Constant creation is easy,
visible, and feels like progress. Deletion is none of those. The registry reaches
40–60 skills inside two quarters. Descriptions start to overlap, so at selection
time the wrong skill fires — or three plausible ones do — and skill quality
degrades **as a function of registry size**, which is the one failure that gets
worse the harder the department works. Nobody deletes anything, because deleting a
skill someone wrote last month is socially expensive and the evidence for deleting
it does not exist (see M2).

**Earliest observable signal.** Two consecutive quarters where
`skills.deletions_per_quarter == 0` and additions > 0.
Cheaply visible: `git log --diff-filter=A -- .claude/skills/` versus
`git log --diff-filter=D -- .claude/skills/`. The signal exists from the day the
directory does — this is measurable *before* it is a problem, which is unusual and
should be exploited.

**What would have prevented it.** Three specific counter-pressures, not vigilance:

1. **The lifecycle team's primary metric is deletions, not registry health.**
   [[skill-lifecycle-anti-sprawl-charter]] is scored on skills removed per quarter.
   A team scored on how clean the registry is will rationalise keeping things; a
   team scored on removals will not.
2. **Authoring and lifecycle are separate teams on purpose** ([[technology]] §4.2:
   *"authoring optimizes for creation and lifecycle optimizes for deletion. A team
   that owns both never deletes anything."*). The split is the mechanism. Merging
   these two teams to save overhead is the single most damaging structural change
   available, and this paragraph exists to make that cost explicit before someone
   proposes it as an efficiency.
3. **A registry ceiling with a paired-deletion rule.** Above a founder-set N,
   a skill-adding PR must either delete one or carry a written exemption. Crude,
   effective, and cheap to implement as a `check_*.sh` guard in the shape of the
   five that already exist.

---

### M2 — Firing telemetry was never wired, so nothing was ever deletable

This is the mechanism [[technology]] §4.2 names, and it is the *enabling condition*
for M1 rather than a separate story. The 30-day anti-sprawl rule asks a question —
*has this skill fired in the last 30 days?* — that the system today cannot answer
at all. There is no invocation log, no `skill_id` anywhere, and L4 "emits nothing
yet" ([[README]] §1). *Corrected 2026-08-25: L4 emits since P1; `skill_id` and the
invocation log are still missing, which is enough to keep the failure live.* Absent an answer, every staleness review defaults to "keep",
because "we do not know" is not grounds for deletion. Twelve months later the rule
is a paragraph in a README, which is the documented fate of most anti-sprawl rules.

**Earliest observable signal.** The second skill is committed while
`skills.firing_rate_30d` is still undefined. That is the moment the department
started accumulating unmeasurable inventory — and it happens within weeks, not
months.

**What would have prevented it.** **Telemetry precedes skill #2.** A hard sequencing
rule: the registry does not accept a second skill until skill #1's invocation is
observable. Concretely, a `skill_id` field on the NF-A event
([[README]] §4.2 / §4.4 `context` jsonb) plus a firing table, wired before the
authoring team is allowed to scale. This makes the department's first deliverable
*measurement*, not content — deliberately unsatisfying, and the whole reason it
works.

---

### M3 — Everyone routed around us, because writing a script stayed faster than writing a skill

The department owns a contract; contracts are experienced as gates. The §3.3
protocol asks for four things (trigger, doneability, a real past instance, an
owning department) before a skill may be committed. Writing a file into `scripts/`
asks for none of them, and `scripts/` already has **59 entries and no owner** — the
bypass path is not hypothetical, it is the established habit. Engineering and Data
keep shipping procedures as scripts, the registry stays near-empty, and the
department reviews a trickle while the real procedure layer grows somewhere it
cannot see.

**Earliest observable signal.** `skills.script_to_skill_ratio` — new files landing
under `scripts/` versus `.claude/skills/` per month. If that ratio does not fall
below 1:1 within two quarters of the registry existing, the department is being
routed around. Baseline today is 59:0.

**What would have prevented it.** Make the authoring path **faster than writing a
script**, not merely mandatory. That means a T4 `skill-create` meta-skill that
generates the scaffold and pre-fills three of the four protocol fields from the
commit that motivated it, so compliance is a side effect of using the tool rather
than a form to fill in. If the protocol cannot be made cheaper than its bypass, the
protocol loses — every time, in every organisation.

---

### M4 — The contract/content boundary collapsed and we became a domain bottleneck

Nobody in Engineering has time to write `wine-enrichment`'s body. The skills team
does it — reasonably, once. Then again. Within two quarters the department is
authoring domain procedures for domains it does not work in, producing skills that
are plausible and never fire, and every domain department has quietly delegated
skill authorship to a team without the knowledge to do it. [[README]] §3.2 assigns
T1 content to Engineering and Data precisely to prevent this, and the assignment
erodes by kindness rather than by decision.

**Earliest observable signal.** The first `SKILL.md` whose declared owning
department is `skills` and whose tier is not T4. One file, checkable in CI on the
day it lands.

**What would have prevented it.** A machine-checked frontmatter rule:
`owning_department` is a required field and **may never be `skills`** except for
T4 meta-skills. Enforced by a guard in the shape of
`scripts/check_no_direct_stock_writes.sh` — a grep is enough, and the failure it
prevents is organisational, not technical. The department may *edit* any skill's
envelope; it may not *own* a domain skill's body.

---

### M5 — Three teams, one artifact: the org outgrew the work and nobody said so

Twenty-eight unit documents were generated for a department whose committed
registry was zero, and stayed zero. Twelve months on, the charters are more
substantial than the thing they charter. TECH-F4 (*Skills at 3 vs 2*) never resolved
because an open question with no forcing function stays open, and
[[skill-harvesting-charter]]'s entry trigger — ≥15 skills — was never approached, so
the team existed on paper for a year and was never honestly retired. The department
became an artefact of the org-design exercise rather than a function.

**Earliest observable signal.** At **2026-11-24** (three months): unit doc count in
`.planning/01-org/applied-ai/skills/` is 28 and `skills.registry_size` is below 5.
Documents outnumbering artifacts 6:1 is the signal, and it is already 28:0 today.

**What would have prevented it.** **This department carries its own entry trigger,
in the same shape it imposes on [[skill-harvesting-charter]].** If the registry
holds fewer than 5 committed, firing skills at 2026-11-24, the correct action is to
collapse Skills into a single function inside [[ai-orchestration-charter]] and
delete 21 of these 28 documents. Written here, at founding, so that retiring the
department is a pre-agreed outcome rather than an admission of failure — and so
that [[red-team-charter]] has a date and a number to hold us to rather than a
judgement call.

---

## Signal summary

| # | Mechanism | Earliest signal | Where it is visible |
|---|---|---|---|
| M1 | Sprawl wins | 2 quarters: additions > 0, deletions == 0 | `git log --diff-filter=A/D -- .claude/skills/` |
| M2 | No firing telemetry | Skill #2 lands while `firing_rate_30d` undefined | Registry index vs NF-A events |
| M3 | Routed around via `scripts/` | `script_to_skill_ratio` stays above 1:1 | Monthly file-add counts |
| M4 | We author domain content | First non-T4 skill owned by `skills` | `owning_department` frontmatter, CI-checkable |
| M5 | Org outgrew the work | 2026-11-24: 28 docs, <5 skills | Directory census |

Every one of these is countable. A premortem whose signals require judgement is a
worry; these are queries.
