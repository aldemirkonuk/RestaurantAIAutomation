---
type: reference
name: taste-skill
category: agent-tooling
url: ~/.claude/skills/taste-skill/SKILL.md
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[shadcn-ui]]"]
---

# taste-skill

## What it is

Verified 2026-08-24 by reading the file on disk.

- Located at **`/Users/aldemirkonuk/.claude/skills/taste-skill/SKILL.md`** — a *user-level*
  skill, a single `SKILL.md` with no supporting files.
- Frontmatter `name:` is **`design-taste-frontend`**; the directory is `taste-skill`. The
  two names differ, which matters because the frontmatter name is what an agent matches on.
- Self-description: *"Anti-slop frontend skill for landing pages, portfolios, and
  redesigns."* Its own scope line is explicit: **"Not dashboards, not data tables, not
  multi-step product UI."**
- Structure: brief inference first (page kind, vibe words, reference signals), then
  contextual rules — the skill states none of its rules fire automatically.

## Why it might matter here specifically

Its stated scope is **the opposite of this product's surface**. Mudavym's web app is
dashboards, data tables, and multi-step product UI — `/inventory`, `/notifications`,
analytics panels, the recommendations rail. The skill excludes all of that by name.

Where it *would* apply is the marketing site and any public landing surface, which is
Commercial's territory rather than Product's.

The second reason it belongs in this library: it is the **only** design-related skill the
founder has, and `.planning/foundation/README.md §3` records that the repo has **zero
committed skills** — the sole `SKILL.md` in the tree is gitignored vendor tooling. So this
is the working reference for what a skill looks like here, not just a tool.

## What adopting it would cost

- Nothing to install — already present at user level. "Adopting" would mean **committing a
  project-level copy** under `.claude/skills/`, which changes it from personal tooling into
  a shared artefact with an owning department (foundation §3.3 requires a named owner, a
  trigger, doneability criteria, and a real past instance).
- The name mismatch (`taste-skill` vs `design-taste-frontend`) should be resolved before any
  copy is committed, or the project will have two names for one thing.
- Anti-sprawl rule (foundation §3.3): a skill that has not fired in 30 days is reviewed for
  deletion. Committing this one starts that clock.

## What decision it bears on

None open. Relates to the skill-taxonomy fork in `.planning/foundation/README.md §3.2` —
it would be a **T2 (department)** skill owned by Media & Brand, not a T1 domain skill.

## Status

`candidate` — verified on disk at user level; not committed to this repo, no owning
department, scope mismatched to the product's main surface.
