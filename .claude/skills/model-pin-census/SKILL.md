---
name: model-pin-census
description: Use when a PR touches a model call site, when checking whether the P1 wrapper consolidation still holds, or before quoting model-spend coverage — counts every hard-coded model id and every api.anthropic.com constant, comment-aware, with path:line.
---

# model-pin-census

owner: model-routing-inference-economics (applied-ai) — card `spend-sentinel`, [[model-routing-inference-economics-agent-stack]]

## Trigger

Weekly per the card; on any PR adding or moving a model id string or a
provider URL in `apps/api-gateway/src` or `services/agent-orchestrator`.

## How to run

```bash
python3 scripts/agents/run_card.py --agent spend-sentinel
```

## Doneability

URL constants and distinct model pins listed with files; anything outside
`common/model-client` named explicitly. Comment lines are excluded — a URL in
a comment is not a call site, which the first automated run had to learn.
Spend *values* need the DB and are declared out of scope, never reported as 0.

## Real past instance

The 2026-08-24 session found 7 call sites each declaring its own
`api.anthropic.com` constant with 3 different pinned model values
([[model-routing-inference-economics-charter]] §Evidence); P1 consolidated
them behind `common/model-client`. The 2026-08-28 automated run verified the
consolidation holds (0 code URL constants outside the wrapper) — after first
flagging a comment as a regression, which is why this census is comment-aware.
