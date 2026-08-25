---
type: charter
division: product
department: design
team: exploration-studio
status: exists
metrics: [design.resolved_question_rate, design.winner_shipped_conversion, design.sketch_index_completeness, design.open_null_winner_count]
updated: 2026-08-24
links: ["[[exploration-studio-premortem]]", "[[exploration-studio-agenda-full]]", "[[exploration-studio-agenda-board]]", "[[exploration-studio-directive]]", "[[exploration-studio-loops]]", "[[exploration-studio-schedule]]", "[[design-charter]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[activation-in-product-guidance-charter]]", "[[surface-portfolio-charter]]", "[[decision-office-charter]]"]
---

# Exploration Studio — Charter

Parent: **[[design-charter]]** (Product division). Siblings:
[[ux-path-burn-down-charter]], [[design-system-motion-substrate-charter]],
[[activation-in-product-guidance-charter]].

## Mandate

Own **divergent** design: pose the design question, build throwaway options, name a winner
with reasoning, and hand a **decided direction** to [[ux-path-burn-down-charter]].

## Why distinct from its siblings

Its success criterion is **a resolved question**, and **most of its output is correctly
discarded**. That is not a tolerated inefficiency; it is the product. A sketch that is
thrown away after settling an argument did its job.

This makes it the structural opposite of [[ux-path-burn-down-charter]], whose output must
ship. The two cannot be one team, and the reason is a measurement fact rather than a
preference: **measure this team on shipped pixels and it stops exploring; measure the
burn-down on options generated and it stops shipping.** [[design-directive]] forbids
combining their numbers into any "design velocity" figure for exactly this reason.

The workflow is not theoretical. `.planning/sketches/MANIFEST.md` already proves it works
— and already proves it decays without an owner.

## Boundaries

Owns outright:

- **`.planning/sketches/`** — **53 sketch directories**, 51 HTML sketches, 97 files, plus
  `themes/default.css`.
- **`.planning/sketches/MANIFEST.md`** — the decision record: every row carries a **Design
  Question**, a **Winner**, and tags. This is the artifact, not the HTML.
- **The question, and the right to withdraw it.** Declaring *"no winner — question
  withdrawn"* is a legitimate resolution and is recorded as convergence.
- **The handoff.** A winner is not resolved until it is stated in a form
  [[ux-path-burn-down-charter]] or [[design-system-motion-substrate-charter]] can build
  against.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Shipping the winner | [[ux-path-burn-down-charter]] | We hand over a decided direction. If we ship it ourselves we are no longer exploring, and the ledger loses its owner |
| Turning a winner into a reusable primitive | [[design-system-motion-substrate-charter]] | A winning layout is a direction; a `Button` is substrate |
| Whether the page should exist | [[surface-portfolio-charter]] *(Product & Vision)* | We explore how a page could work. Whether it should exist at all is a portfolio call |
| Production code | [[engineering-charter]] | Sketches are throwaway HTML by design. Sketch 038 reaching `apps/web/src/pages/inventory/command/` is a handoff succeeding, not the studio shipping |
| Brand exploration — campaigns, decks, visual identity for market | [[media-brand-charter]] *(Commercial)* | We explore the product a user touches, not the story told about it |
| Maintaining shipped sketches as documentation | Nobody — they are **throwaway** | A sketch's value ends when its question resolves. Keeping them alive is how a corpus becomes a gallery |

## Metrics it moves

**Primary: `design.resolved_question_rate`** — sketches with a named winner ÷ sketches
created. **Today: 15 of 43 indexed.** And only 43 of 53 directories are indexed at all.

| Metric | Reading today |
|---|---|
| `design.resolved_question_rate` | **15 of 43** indexed rows carry a winner |
| `design.open_null_winner_count` | **28** — the number that must fall |
| `design.sketch_index_completeness` | **43 of 53** directories indexed; **1** manifest row points at no directory |
| `design.winner_shipped_conversion` | **2 of 53** — sketch 038 and sketch 052 |

The secondary — winner → shipped-descendant conversion — is the honest check on whether
resolution means anything. A question can be resolved and still never reach a user, and
2 of 53 is the current reading. It is a **secondary** on purpose: making it primary
recreates the failure the team split was designed to prevent.

**Neural-footprint tie.** None direct. The indirect one is real: a resolved question is the
`internal_state` half of the [[README]] §4.1 definition applied to design — *enough signal
to model why it chose what it chose, not merely what it chose*. `MANIFEST.md` already
records reasoning, not just outcome: sketch 048 → *"C — Left rail (purity 9 × effectiveness
9 = 81)"*. That is a design decision with its scoring shown, which is precisely the
mechanism-level trace the neural-footprint definition asks for.

## Evidence today

**EXISTS — large, structured, and visibly stalling.**

### The workflow is real and recorded

`MANIFEST.md` is a genuine decision record. Every row carries a **Design Question**, a
**Winner**, and tags:

- **048** `profile-page` → *"C — Left rail (purity 9 × effectiveness 9 = 81)"*
- **042** `mobile-stack-capabilities` → *"H RN Skia + Reanimated"* — a stack decision made
  by sketching
- **050** `activation-flow` → *"C — Hybrid (one-line why + triage table)"*
- **051** `staff-firstrun-tutorial` → *"B — first-visit overrides session cap"*
- **033** `notification-preferences` → *"C × B synthesis"*
- **008/009/010** — providers layout, card, modal, each resolved separately

### Two rows converged all the way to code — the pipeline works

- **038** `inventory-command` → *IMPLEMENTED — `apps/web/src/pages/inventory/command/`*
  (route `/inventory`, legacy at `/inventory-legacy`)
- **052** `wineops-document` → *IMPLEMENTED (document) —
  `scripts/docgen/templates/wineops_document.html`*; role views not built

### ⚠️ The stall is measurable

- **28 of 43 manifest rows carry `Winner: null`** — 006, 007, 016, 020–026, 028–032,
  034–041, 043–047, counted this session. **Two-thirds of the exploration never converged.**
  That is the exact cost of having no owner.
- **10 sketch directories are not in the manifest at all** — 005, 011, 012, 013, 014, 015,
  017, 018, 019, 049. Work exists that the record does not know about.
- **Found this session, and not previously recorded: manifest row `039`
  (`staff-performance-sidebar`, `MANIFEST.md:46`) has no directory on disk.** The index
  drifts in **both** directions — 10 sketches with no row, 1 row with no sketch.
- **Duplicate IDs used twice on disk:** `038` (`038-inventory-command`,
  `038-manager-shift-desk`) and `048` (`048-interactive-guidance`, `048-profile-page`).
  `048` appears once in the manifest, so one of the two is silently unrecorded.

Small things, individually. Together they are what an unowned index looks like — and they
are why this charter's first deliverable is a manifest sweep rather than a sketch.

### The stalled work is not junk

The null rows include the department's most valuable unshipped thinking: the four motion
sketches **043–046** (nine motions, each with trigger / motion / haptic / **anti-gimmick**
specs), the cellar/inventory exploration **028–032, 040, 041, 047**, and the storage
layout set **020–024**. High specification depth, zero decisions. That combination —
excellent work that cannot be acted on — is the precise failure this team exists to
prevent.
