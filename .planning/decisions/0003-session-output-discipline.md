---
type: adr
id: 0003
title: v3 internal build, v0 production reset
status: locked
updated: 2026-08-24
links: []
---

# 0003 — Low per-session output footprint; branch-per-operation

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** sessions, context, output, branches, PRs, parallelism, cost
- **Links:** [`CLAUDE.md`](../../CLAUDE.md) §2/§6, vision capture §2/§12H

## Context

The operating model is many parallel sessions ("work like a staffed company").
That only works if each session is cheap and legible: the founder mandated that
every workflow in this repo "needs to have little to less output … no matter the
session." Today the biggest context sinks are the mega-docs
(`UX_PATHS_CATALOG.md` 154KB, `claude_full_architectural.md` 181KB, `ROADMAP.md`
70KB, plans at 57–69KB each) and sprawling multi-concern sessions.

## Options considered

1. **Rely on judgment** — no written rule; footprint discipline decays the moment
   a session gets interesting.
2. **Written discipline in CLAUDE.md, enforced every session** — named
   grep-and-excerpt targets, findings-to-files, one operation per branch/session,
   memory instead of re-derivation.
3. **Tooling enforcement (hooks that block large reads)** — strongest, but
   premature before the doc corpus is restructured (OD-01); would fight legitimate
   work now.

## Decision

Option 2 now; revisit option 3 after OD-01 lands. Rules (binding, in CLAUDE.md §2):

1. Large planning docs are never read whole — grep, then read a line range.
2. Long analyses are written to files; chat carries deltas and pointers only.
3. One operation per branch, per session; branch naming `docs/… feat/… fix/… data/…`.
4. Durable facts go to project memory, not re-derived per session.

## Consequences

- Sessions stay reviewable as PRs and cheap in context — parallelism scales.
- Slight friction when a task genuinely spans concerns: split it into two
  sessions rather than letting one sprawl.
- Revisit if: OD-01 restructure makes the mega-docs small enough that the
  grep-only rule is moot, or if hook enforcement (option 3) becomes worth it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Mandated low-output sessions and per-operation branches/PRs |
| 2026-08-24 | — | Recorded as ADR; encoded in CLAUDE.md §2 |
