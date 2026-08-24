# 0001 — Mudavym is one entity; modules are internal softwares

- **Status:** Locked
- **Date:** 2026-08-24
- **Decider:** Aldemir (founder)
- **Keywords:** company structure, agency, modules, floor-checker, umbrella, naming
- **Links:** [`PROJECT.md`](../PROJECT.md), [`FUTURES.md`](../FUTURES.md), vision capture §1/§9/§14.2

## Context

The 2026-08-24 vision session reframed the project from "one product" to "a company
with four functions (marketing, vision/brand, engineering, social media) whose
flagship is the restaurant platform." That raised the question: is the agency a
separate entity wrapping the product, or one thing?

## Options considered

1. **Two entities** — an agency brand plus Mudavym as its client/product. Cleaner
   external story for service revenue; but doubles every structural artifact
   (docs, brand, legal) before there is revenue to justify either.
2. **One entity, modular inside** — Mudavym is the umbrella; marketing, vision,
   engineering, social media are functions inside it, and Floor Checker, email
   watching, order watching, invoice understanding, the guest app, etc. are
   "little softwares" that live inside it, each legible on its own before being
   wired into the whole.

## Decision

Option 2. Mudavym is the single umbrella entity. Modules are individually defined
softwares with their own clear job, built and understood standalone first, then
unified — never a monolith, never separate companies.

Naming is also settled here: **Mudavym** (the "Mudavim" spelling in the 2026-08-24
transcript was a transcription slip — confirmed in vision capture §14.1).

## Consequences

- One brand, one legal surface, one doc graph — everything cross-links inside one vault.
- Module boundaries become a first-class documentation obligation: each module needs
  its own identity doc before deep build work (queued under OD-02 department mapping).
- Revisit if: a module (e.g., the guest consumer app) develops a genuinely separate
  market and monetization that a shared brand demonstrably hurts.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-24 | Aldemir | Confirmed one-entity structure and Mudavym spelling (vision capture §14.1–14.2) |
| 2026-08-24 | — | Recorded as ADR |
| 2026-08-24 | Aldemir + Claude | **Challenged and reaffirmed.** Founder asked whether this should be two companies — a research lab plus an app that "endpoints the results we find at research." Claude argued against: a research lab with no product has no data, and the vision's own named blocker (§7) is data. Separating them puts a contract boundary through the guest-signal flywheel (`guests choose → NF-B → personalization → guests choose`), doubles the 15-document Legal scope, and reads to YC as confusion rather than sophistication. The legitimate concern underneath — research being subordinated to shipping deadlines — is addressed structurally instead: Research & Math holds its own division, non-shipping metrics, a long-horizon schedule, and advisory independence (Bell Labs / DeepMind-inside-Google pattern). The production-vs-research separation is already made at the *data* layer ([[0006-neural-footprint-architecture]]), where it costs nothing. **Outcome: one entity stands.** |
