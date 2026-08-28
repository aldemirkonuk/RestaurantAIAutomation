# Project skills

Skills live here — auto-discovered by Claude Code, committed, and reviewable in PRs
([decision 2026-08-24](../../.planning/decisions/OPEN-DECISIONS.md), Resolved table).

**Current state: 4 committed skills** (first admitted 2026-08-28 through the §3.3
gate — `fleet-census`, `harness-contract-audit`, `model-pin-census`,
`registry-index-refresh`; each wraps `scripts/agents/run_card.py`). The census is
`python3 scripts/agents/run_card.py --agent registry-clerk`, never this paragraph.
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
