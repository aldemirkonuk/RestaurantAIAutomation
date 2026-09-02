# Project skills

Skills live here — auto-discovered by Claude Code, committed, and reviewable in PRs
([decision 2026-08-24](../../.planning/decisions/OPEN-DECISIONS.md), Resolved table).

**Current state: 5 committed skills.** The first 4 (admitted 2026-08-28 through
the §3.3 gate — `fleet-census`, `harness-contract-audit`, `model-pin-census`,
`registry-index-refresh`) each wrap `scripts/agents/run_card.py`, a *mechanical*
(no model call) card runner per ADR 0034. `pr-audit-gate` (2026-09-02, ADR 0090) is
the first **judgment-class** skill — it calls Sonnet, and deliberately does not
run through `run_card.py`, which is mechanical-only by design (see that script's
own docstring) and stays that way so it never biases the open OD-03 harness
choice. The census is `python3 scripts/agents/run_card.py --agent registry-clerk`
for the mechanical four; `pr-audit-gate` is event-triggered, not census-tracked.
The census is never this paragraph.
(The prior state — zero committed, one gitignored vendor `SKILL.md` at
`.agents/skills/railway-config/` — held from 2026-08-24 to 2026-08-28.)

## Adding one

Per [foundation §3.3](../../.planning/foundation/README.md), before a skill is committed it must name:

1. Its **trigger** — the exact situation where it fires.
2. Its **doneability criteria** — how we know it succeeded (feeds NF-A).
3. A **real past instance** where it would have helped. No speculative skills.
4. Its **owning department** and whether it is scheduled.

**Anti-sprawl:** a skill that has not fired in 30 days is reviewed for deletion.

Layout: `<skill-name>/SKILL.md` with frontmatter `name` and `description`. The
description decides discovery, so it must say *when to use this*, not just what it is.
