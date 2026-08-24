---
type: reference
name: DeepSeek Harness (dsh)
category: agent-harness
url: https://github.com/deepseek-ai/deepseek-harness
status: candidate
decision: OD-03
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[OPEN-DECISIONS]]", "[[hermes-agent]]", "[[base-agent]]"]
---

# DeepSeek Harness (`dsh`)

## What it is

Verified 2026-08-24 against the repository README and GitHub metadata. TypeScript, MIT.

- An open-source **agent harness** from DeepSeek AI. Architecture: *everything is a
  plugin*, built on [Cordis](https://github.com/cordiverse/cordis).
- Run with `npx @deepseek-ai/dsh web`, which serves a Web UI on `127.0.0.1:3080`.
- Plugin ecosystem discovered via the `dsh-plugin` GitHub topic.
- **The README states it is in *developer preview* and that there will be
  compatibility-breaking changes.** That sentence is the single most decision-relevant fact
  about it and should not be softened when this is compared with alternatives.

## Why it might matter here specifically

It is the only OD-03 candidate written in **TypeScript**, which is the language of
`apps/api-gateway` (NestJS) and `apps/web`. The other two candidates are Python. If the
harness is expected to live next to the gateway rather than next to
`services/agent-orchestrator`, that is a real advantage and it is the reason to keep it in
the bake-off rather than dropping it on maturity grounds.

The plugin-first architecture also maps onto how work is already split here — document
extraction, inbound email, notifications, and the UX optimiser are each self-contained
modules under `apps/api-gateway/src/`.

## What adopting it would cost

- **Breaking-change exposure by the maintainers' own admission.** Building the orchestration
  base of an autonomous platform on a declared developer preview is a live risk, not a
  hypothetical one; any ADR that picks it must name the pinning and migration plan.
- Cordis is an additional conceptual dependency — its programming model has to be learned,
  not just imported.
- Web UI on a local port is a developer surface, not a production one; server-side
  operation needs its own answer.

## What decision it bears on

**OD-03** — orchestration base. Open.

## Status

`candidate` — verified to exist and to be MIT-licensed. **Maturity is the open question**,
and the README answers it unfavourably for now.
