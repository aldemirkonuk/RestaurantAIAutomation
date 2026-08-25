---
type: reference
name: hermes-agent
category: agent-harness
url: https://github.com/NousResearch/hermes-agent
status: candidate
decision: OD-03
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[OPEN-DECISIONS]]", "[[deepseek-harness]]", "[[base-agent]]"]
---

# hermes-agent (NousResearch)

## What it is

Verified 2026-08-24 against the repository README and GitHub metadata. Python, MIT.

Claims made by its README, recorded as claims — none of them tested here:

- A **personal/self-improving agent**: creates skills from experience, self-improves them
  during use, memory with periodic nudges, FTS5 search over its own past sessions,
  Honcho-based user modelling. Compatible with the `agentskills.io` skill standard.
- **Provider-agnostic model routing** — Nous Portal, OpenRouter, OpenAI, custom endpoints;
  switched with `hermes model`.
- Gateways into Telegram, Discord, Slack, WhatsApp, Signal, CLI from one process.
- Built-in cron scheduler; subagent spawning; seven terminal backends (local, Docker, SSH,
  Singularity, Modal, Daytona, Vercel Sandbox).
- Installed by a `curl | bash` one-liner into `~/.hermes`.

## Why it might matter here specifically

OD-03 frames the real axis as *cheapest-capable-model routing plus harness overhead*.
Hermes is the candidate that most directly addresses the **routing** half — provider
switching is a first-class command rather than a code change.

Two things about its shape are relevant before it is compared with anything:

1. It is built as a **single long-lived personal agent** with memory of a user, not as a
   fleet of stateless workers reacting to a message bus. That is a different topology from
   [[base-agent]], which is what `services/agent-orchestrator` actually runs.
2. Its self-improving skill loop overlaps directly with the skill layer described in
   `.planning/foundation/README.md §3` — where the honest state is **zero committed
   skills**. Adopting Hermes would import a skill model rather than authoring one, which
   is a strategic choice, not a technical one.

## What adopting it would cost

- A second runtime alongside the NestJS gateway and the Python orchestrator, with its own
  install path (`~/.hermes`) that is not a package the repo pins.
- Its memory/session store is its own; reconciling it with the NF-A instrumentation spec
  (`.planning/04-specs/P1-NF-A-INSTRUMENTATION.md`) is work, not a given — NF-A wants
  per-agent reasoning cost in this project's columns.
- The messaging gateways overlap [[open-wa]]; adopting both would mean two WhatsApp paths.
- Large, fast-moving upstream. Pinning strategy needed.

## What decision it bears on

**OD-03** — orchestration base. Open. Also feeds **OD-04** (external model roster), since
its routing layer is what would make a mixed roster cheap to operate.

## Status

`candidate` — existence and README claims verified; **capabilities not tested on this
repo's workloads**, which is exactly what OD-03 says must happen before a pick.
