---
type: agenda-full
division: applied-ai
department: skills
status: provisional
metrics: [skills.registry_size, skills.protocol_compliance_rate, skills.firing_rate_30d, skills.script_to_skill_ratio]
updated: 2026-08-24
links: ["[[skills-charter]]", "[[skills-premortem]]", "[[skills-directive]]", "[[skills-loops]]", "[[skills-schedule]]", "[[skills-agenda-board]]", "[[skill-registry-authoring-agenda-full]]", "[[skill-lifecycle-anti-sprawl-agenda-full]]", "[[skill-harvesting-agenda-full]]", "[[README]]", "[[technology]]", "[[decision-office-charter]]"]
---

# Skills — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Nothing below has
> been built, scheduled, or decided; the department's committed registry size is 0.

## What

Stand up a skill layer that can survive the instruction *"create skills
constantly"*. Three deliverables, in strict order, and the order is the whole plan:

1. **A place** — `.claude/skills/` exists, committed, with one real skill in it and
   a written contract for the next one.
2. **A signal** — a skill invocation is observable. Until this exists, everything
   after it is inventory we cannot audit.
3. **A brake** — a scheduled staleness review that actually deletes things.

Content is explicitly *not* on this list. Content belongs to the owning departments
([[skills-charter]] §Explicit non-goals).

## How

**Sequencing claim:** place → signal → brake → volume. Reversing any two of these
produces the failure in [[skills-premortem]] M2. The department deliberately does
the least satisfying thing first.

- **Place.** Create `.claude/skills/`. Port `.agents/skills/railway-config/SKILL.md`
  into it as the seed — with the honest caveat that the original is vendor-installed
  and gitignored (`.gitignore:100`), so this is a *copy into ownership*, not a move.
  Write the `SKILL.md` contract from the shape that file already demonstrates
  (`name:2`, an actionable `description:3`, rules · commands · authoring · review
  checklist).
- **Signal.** Add `skill_id` to the NF-A event context ([[README]] §4.2, §4.4) and
  a firing log. This is a request into [[ai-orchestration-charter]] and
  `[[sre-observability]]`, not work this department can do alone — which makes it
  the first real dependency to negotiate rather than assume.
- **Brake.** Build the weekly skill-health job in the shape of
  `.github/workflows/schema-parity.yml:26-27` (daily cron, fails loudly). Copy the
  pattern; do not invent one.
- **Volume.** Only then does authoring scale, and only then does
  [[skill-harvesting-charter]]'s ≥15 trigger become reachable.

**Method for the contract itself.** Enforce [[README]] §3.3 in CI rather than in
review: four required frontmatter fields (trigger, doneability, real past instance,
owning department) checked by a grep-grade guard, in the shape of the five
`scripts/check_*.sh` guards already wired into `.github/workflows/ci.yml`.

## Why now

Three reasons, in decreasing strength:

1. **The mandate is already live.** Skills are being asked for constantly. The
   counter-pressure has to exist *before* volume, not after — after is a cleanup
   project, and cleanup projects do not get staffed.
2. **The registry is at zero, which is the cheapest possible moment to set the
   contract.** Every skill written before the contract exists will need retrofitting.
   Right now the retrofit cost is 0 files.
3. **The raw material is sitting unowned.** 59 entries in `scripts/` — 5 CI guards,
   three built CLIs (`docgen/` 11 modules, `synth/` 11, `simulate/` 8) — are
   procedures with triggers and success criteria, i.e. skills missing their
   `SKILL.md`. That inventory is not going anywhere, but it grows.

**Why *not* now, stated honestly:** L0 data is the named blocker ([[README]] §1),
not skills. A department with zero committed artifacts competing for founder
attention against the actual blocker should expect to lose, and should be structured
so that losing is survivable — which is why [[skills-premortem]] M5 carries a
self-retirement trigger.

## Next steps

| # | Step | Owner | Blocks |
|---|---|---|---|
| 1 | Create `.claude/skills/` and commit the seed skill | [[skill-registry-authoring-charter]] | everything |
| 2 | Write the `SKILL.md` contract + the CI guard that enforces §3.3 | [[skill-registry-authoring-charter]] | skill #2 |
| 3 | Close **OD-14** — retire or rewrite root `SKILLS.md` (stale "WineOps AI" at `SKILLS.md:3,53`) | [[skill-registry-authoring-charter]] | contributor confusion |
| 4 | Negotiate `skill_id` onto the NF-A event | [[skill-lifecycle-anti-sprawl-charter]] + [[ai-orchestration-charter]] | the 30-day rule |
| 5 | Build the weekly skill-health job | [[skill-lifecycle-anti-sprawl-charter]] | deletions |
| 6 | Registry census against the ≥15 harvesting trigger | [[skills-schedule]] | staffing [[skill-harvesting-charter]] |
| 7 | Raise the two seams below into `OPEN-DECISIONS.md` | [[decision-office-charter]] | ownership clarity |

Steps 1–3 are days of work. Step 4 is a negotiation with another department and is
the realistic critical path.

## Questions for the founder

1. **Who runs the weekly skill-health job?** [[README]] §6 assigns it to **Research
   & Math**; [[technology]] §4.2 assigns the same staleness review to
   [[skill-lifecycle-anti-sprawl-charter]]. Both cannot own it. Proposed split —
   Research & Math owns T4 meta-skill *methodology*, Skills *runs the job* — but
   per CLAUDE.md §0.1 this is not decided until it is written down. **Needs an
   `OPEN-DECISIONS.md` entry; this session did not have write access outside the
   department directory to add it.**
2. **OD-22 — three teams or two?** [[technology]] §4.3 says of
   [[skill-harvesting-charter]]: *"If the team count must be cut, cut this one
   first."* Chartered-now-with-a-trigger (what this directory does) or
   not-chartered-until-it-fires?
3. **OD-14 — root `SKILLS.md`: retire or rewrite?** Low stakes, trivially
   actionable, and it is the file a new contributor searches for first.
4. **What is the registry ceiling N?** [[skills-premortem]] M1's paired-deletion
   rule needs a number. A guess is worse than a founder call here, because the
   number is the entire brake.
5. **Does the department accept its own retirement trigger?** [[skills-premortem]]
   M5 proposes: fewer than 5 committed, firing skills at 2026-11-24 → collapse into
   [[ai-orchestration-charter]]. Written at founding so it is a plan, not a
   post-mortem.
