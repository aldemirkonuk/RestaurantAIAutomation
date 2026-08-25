# 0018 — P2 plan of record: spine reset, page graph, docs before features

- **Status:** Locked
- **Date:** 2026-08-25
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** P2, milestone, spine, STATE, ROADMAP, PROJECT, page map, Surface, obsidian graph, deploy
- **Links:** [[0002-documentation-first-operating-mode]], [[0005-v3-to-v0-version-reset]], [[0017-doneability-verdicts-are-sidecar-claims]], `.planning/06-pages/PAGE-CONTRACT.md`

## Context

P1 (Neural Footprint instrumentation) closed. The spine that should say what
comes next did not: `PROJECT.md` named **v2.0 Backend Kitchen** as current
(last updated 2026-07-27), `STATE.md` named **v3.0 Phase 44** in one place and
**Phase 38 SimPOS** in another (2026-07-28), and `ROADMAP.md` matched neither —
none mentioned the neural footprint, the org restructure, or the decision
register, which is what the last two days actually were. Same rot pattern the
register audit found ([[decision-register-rots]] in memory): prose nobody
re-reads drifts until it misleads.

The founder's direction (2026-08-25, verbatim intent): recreate the spine
first, keep it simple; the backend-kitchen idea and v3 implications remain
"mostly true" — ideas evolved, scope didn't; version numbers stay as-is until
publish (consistent with ADR 0005); then build the web to the fullest and
deploy ASAP, with docs bulletproof before features and the founder approving
the feature set.

## Options considered

Three forks, each put to the founder explicitly rather than defaulted:

1. **Milestone name** — (a) `P2 — Web complete + deploy`, continuing the P1
   tag scheme; (b) keep `v3.0 Phase 44` continuity; (c) a fresh codename.
   *(b)* carries a stale phase structure forward; *(c)* costs re-mapping every
   P1/v3 reference.
2. **Page-note format** — (a) add a compact **Surface** section (buttons →
   `[[destination]]`) on top of the existing 9-section notes; (b) replace the
   51 notes with super-simple ones, discarding verified detail written a day
   earlier; (c) put adjacency only in `PAGES-MAP`, which the Obsidian graph
   cannot render as page-to-page edges.
3. **Map scope** — (a) ground the map in what EXISTS, then propose gaps for
   approval; (b) design the target page set directly on unapproved guesses.

## Decision

**(1a) The current milestone is `P2 — Web complete + deploy`.** Stages:
spine reset → page graph → founder approves the target feature set → build
burn-down → deploy. v-numbers untouched until publish.

**(2a) Every page note gets a Surface section at the top** — the page's
buttons/links, one line each, wikilinked to the destination note — so the
Obsidian graph shows the real interconnection web (24 of 51 notes had zero
page-to-page links; `orders.md` linked to nothing). The deep 9 sections stay
beneath as reference; nothing verified is thrown away.

**(3a) Existing first, then proposal.** Pass 1 makes the graph true against
`apps/web` source. Pass 2 is a short proposal — missing pages, dead ends,
endpoint gaps — that the founder approves before anything is built. Web only;
mobile follows later.

## Consequences

- Easier: one place says what is current; the graph shows what connects to
  what; gaps become visible instead of argued.
- Harder / given up: the old STATE/ROADMAP histories move to
  `.planning/archive/*-pre-P2-20260825.md`; v3.0 phase numbering stops being
  the organizing frame (the tech-debt register `v3.0-TECH-DEBT.md` remains a
  live defect list feeding P2's proposal).
- Revisit when: the approved feature list lands (that approval, not this ADR,
  fixes P2's build scope), or if web deploy slips past the point where mobile
  parity matters more.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-08-25 | Aldemir | Chose P2 naming, Surface-on-top format, existing-first scope (AskUserQuestion, three forks) |
