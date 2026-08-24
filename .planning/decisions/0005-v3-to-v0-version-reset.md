# 0005 — v3 internal build → deliberate v0 production reset

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** versioning, v3, v0, reset, production line, milestones
- **Links:** [`PROJECT.md`](../PROJECT.md), `v3.0-TECH-DEBT.md`, vision capture §2/§14.4

## Context

Milestones to date: v1.0 (extraction pipeline, completed 2026-04-08), v2.0
(agent hardening, in progress), with v3-era work tracked in `v3.0-TECH-DEBT.md`.
The restructuring raises the question of what version the *public* product life
starts at.

## Options considered

1. **Continue counting up** (v3 → v4 → …) — honest internal history, but ships a
   "version 4" to first customers of a product that has never had a customer.
2. **Deliberate reset**: v3 is the internal scaffolding build; when development
   reaches a stable, real point, the version resets to **v0** — the true starting
   line of the product's public/production life.

## Decision

Option 2. The reset is a deliberate act with criteria, not a renumbering accident.
Internal milestone numbering (v2.0 milestone docs, `v3.0-TECH-DEBT.md`) keeps its
meaning until the reset moment; the reset gets its own ADR when it happens,
including what "stable, real point" was met.

## Consequences

- Public versioning will not encode internal history — that history stays in this
  log and the milestone audits.
- A future session must define the reset criteria checklist before the reset can
  be declared (belongs to the structure phase; not yet queued as its own OD item
  because it has no near-term dependency).
- Revisit if: never — supersede only by a new ADR at reset time.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Confirmed v3→v0 reset understanding (vision capture §14.4) |
| 2026-08-24 | — | Recorded as ADR |
