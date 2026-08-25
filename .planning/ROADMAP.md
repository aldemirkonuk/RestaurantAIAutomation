# Roadmap — Mudavym

> Rewritten 2026-08-25 under [ADR 0018](decisions/0018-p2-plan-of-record.md); the
> 753-line phase history it replaces is archived verbatim at
> [archive/ROADMAP-pre-P2-20260825.md](archive/ROADMAP-pre-P2-20260825.md).
> Expansion vision stays in [FUTURES.md](FUTURES.md). Where the build is right
> now lives in [STATE.md](STATE.md) — this file is only the order of operations.

The backend-kitchen idea has been the same across v1/v2/v3: an autonomous
restaurant backend so reliable an average operator performs flawlessly. The
versions changed the framing, not the scope. P-milestones are the current
frame; v-numbers reset at publish (ADR 0005).

## Done

| Milestone | What it was | Record |
|---|---|---|
| v1.0 (2026-04-08) | Wine extraction pipeline — Claude Vision + Gemini + YOLO + Haiku, ontology, verification, studio | [archive/v1.0-phases/](archive/) |
| v2.0 (2026-07-28, `gaps_found`) | Agent hardening to Level 4, golden path E2E, deploy | [archive/v2.0-MILESTONE-AUDIT.md](archive/v2.0-MILESTONE-AUDIT.md) |
| Org + register (2026-08-24) | One-entity Mudavym, `.planning` org corpus, ADR log, OPEN-DECISIONS + CI claims | [decisions/](decisions/README.md) |
| P1 (2026-08-25) | Neural Footprint instrumentation: NF-A emitters in both runtimes, readout, doneability verdicts (`nf_verdict`) | ADRs 0006, 0008, 0017; `04-specs/P1-*` |

## Now — P2: Web complete + deploy

Goal: the web app feature-complete and deployed, with docs bulletproof first
and the founder approving the feature set before build. Web only; mobile after.

- [x] **P2.1 Spine reset** — PROJECT / STATE / ROADMAP say one consistent thing (this PR)
- [x] **P2.2 Page graph** — all 51 page notes carry a Surface section (buttons → `[[destination]]`); the Obsidian graph shows the real interconnection web (this PR)
- [ ] **P2.3 Gap proposal → founder approval** — missing pages, dead ends, endpoint gaps, live `v3.0-TECH-DEBT.md` carry-overs, compiled into one short proposal; **approval fixes P2's build scope** — nothing is built ahead of it
- [ ] **P2.4 Build burn-down** — the approved list, one operation per branch, guards green throughout
- [ ] **P2.5 Deploy** — web fully live on the production stack; rebrand strings (~71) swept when brand direction lands

Standing threads through P2 (not gates, but first-class): neural-footprint
coverage growth (more task types under `nf_verdict` bases), decision-register
hygiene (every resolution adds a claim), org loop activation.

## Later — P3 candidates (uncommitted, founder picks after P2)

- **Mobile parity** — bring `apps/mobile` up to the approved web feature set.
- **NF-B guests** — guest-side footprint + the FUTURES §7 guest profiles.
- **Backend-kitchen expansion** — FUTURES stages: full beverages → bakery →
  rest of kitchen; wine remains the extraction quality bar.
- **Ask AI** — allowlisted action creation with human confirm (FUTURES §8).
- **Job → model registry** — OD-04, once NF-A evidence can drive roster choices.

---
*Last updated: 2026-08-25 — P2 plan of record (ADR 0018).*
