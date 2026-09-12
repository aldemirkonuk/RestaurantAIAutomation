---
type: tombstone
title: LLM Instruction Prompts (retired)
status: retired — successor planned
updated: 2026-08-27
links: ["[[0032-vault-cleanup-cut-line]]"]
---

# LLM Instruction Prompts — retired 2026-08-27

**Founder call ([ADR 0032](../decisions/0032-vault-cleanup-cut-line.md)):** the
WineOps-era prompt library is retired; a better instruction-prompt doc will be
written fresh rather than evolved from this one. Until it exists, `CLAUDE.md`
is the only instruction source.

## What the retired doc held

A copy-paste prompt library (16 KB, last touched 2026-07-21), one block per job,
each with hard rules against hallucinated metrics, invented UX, and scope drift:

- **A — UX Path Implementation Agent** — implement paths from `UX_PATHS_CATALOG.md`
- **B — Analytics Consultant** — finance/economics/stats over evidence packs
  (a version of this lives in code as `ConsultantsService`)
- **C — UX Path Author** — extend the catalog
- **D — Insight Explainer** — manager-facing, no new math
- **E — Self-Learning UX Agent** — in-product runtime
- A quality checklist and Cursor usage notes

## Recovering it, and the line-anchored citations

Several docs cite specific lines of the retired version (e.g.
`LLM_INSTRUCTION_PROMPTS.md:19,51,56,166` in the OD-33 insight-count dispute —
this doc was one of the sources claiming **375**). Those anchors refer to the
retired text, not this stub:

```
git log --oneline -- .planning/07-reference/LLM_INSTRUCTION_PROMPTS.md   # find the last pre-retirement commit
git show <commit>:.planning/07-reference/LLM_INSTRUCTION_PROMPTS.md
```
