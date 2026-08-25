# SKILLS.md — retired 2026-08-24

> **Superseded by [`CLAUDE.md`](CLAUDE.md).** This file is a tombstone, kept because
> `.github/copilot-instructions.md` and two planning documents still point at the path.

## What was here

A 163-line "Meta-Cognitive Reasoning Engine" prose protocol — reasoning stages, confidence
anchors, a plan-mode gate. It was written for **"the WineOps AI project"**, a brand the
product left behind, and it pointed at `md_files/` (41 of whose files were byte-identical
duplicates, retired the same day) and a root `MEMORY.md`.

## Why it was retired, not updated

Three reasons, in order of weight:

1. **It was not a skill.** Despite the filename it defined no invocable procedure. Real
   skills live in [`.claude/skills/`](.claude/skills/) with a `SKILL.md` and frontmatter
   naming a trigger — see [foundation §3](.planning/foundation/README.md) for the
   creation protocol and the anti-sprawl rule.
2. **It competed with `CLAUDE.md`.** Two files giving an agent different working rules is
   the failure this corpus keeps finding elsewhere (one guardrail in two runtimes, two
   dead-letter queues, three PII guard definitions). One source of truth per decision.
3. **Retire-to-write** ([CLAUDE.md §3](CLAUDE.md)) — adding documents means naming one to
   retire. This one was named.

## Where its content went

| Was here | Now |
|---|---|
| Working rules for agents | [`CLAUDE.md`](CLAUDE.md) — the six non-negotiables |
| Confidence / verification posture | `CLAUDE.md` §9 (Verification) — evidence or it did not happen |
| Planning protocol | [`.planning/00-index/PLAN.md`](.planning/00-index/PLAN.md) and `AGENDA.md` |
| Project state | [`.planning/00-index/HOME.md`](.planning/00-index/HOME.md) |
| Actual skills | [`.claude/skills/`](.claude/skills/) — currently **zero committed** |

Resolves **OD-14**.
