---
type: adr
id: 0004
title: Obsidian as the backlink layer
status: locked
updated: 2026-08-24
links: []
---

# 0004 — Obsidian adopted as the documentation backlink layer

- **Status:** Locked (adoption); mechanics were resolved with OD-21 (2026-08-24): `.planning/` is the vault; see [OBSIDIAN_VAULT](../foundation/OBSIDIAN_VAULT.md).
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** obsidian, backlinks, knowledge graph, graphify, vault, second brain
- **Links:** [`OPEN-DECISIONS.md`](OPEN-DECISIONS.md) OD-01/OD-08, vision capture §3/§12G/§12M/§14.3

## Context

The roadmap must live somewhere with visible backlinks and a navigable graph
("it has to be on Obsidian or … some kind of a place that we are able to see
backlinks in details"). The vision capture (§14.3) confirmed Obsidian specifically,
with the intent that the vault become a deep architecture — departments, agents,
skills, workflows, and feedback loops all represented and linked (§12M), with
Graphify named for visualizing department decision graphs (§12G).

## Options considered

1. **Obsidian** — local Markdown, wiki-links `[[charter|…]]`, graph view, plugin
   ecosystem (Graphify); works directly on the repo's existing `.md` corpus with
   zero migration or lock-in.
2. **Notion / hosted wiki** — better multiplayer, but content leaves the repo,
   backlinks are proprietary, and agents can't grep it.
3. **Plain Markdown + manual link hygiene** — no new tool, but no graph view,
   which was the explicitly named requirement.

## Decision

Option 1 — Obsidian, as the backlink/graph layer over the repo's own Markdown.
The repo remains the source of truth; Obsidian is a lens, not a second store.
ADRs and planning docs use `[[slug]]`-style links liberally so the graph forms
as the corpus grows.

**Not decided here** (OD-08): vault root location, Graphify adoption, sync
strategy. These interact with the `.planning/` restructure (OD-01) and get
decided in the same session.

## Consequences

- All new docs are written link-rich; a `[[name]]` that doesn't resolve yet marks
  a doc worth writing, not an error.
- No content migration cost now or later — it's the same files.
- Revisit if: real multi-human collaboration arrives and local-vault ergonomics
  become the bottleneck.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Confirmed Obsidian adoption (vision capture §14.3) |
| 2026-08-24 | — | Recorded as ADR; mechanics deferred to OD-08 |
