---
type: schedule
division: product
department: design
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-loops]]", "[[design-agenda-board]]", "[[ux-path-burn-down-schedule]]", "[[design-system-motion-substrate-schedule]]", "[[exploration-studio-schedule]]", "[[activation-in-product-guidance-schedule]]", "[[skills-charter]]", "[[decision-office-charter]]"]
---

# Design — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | Design lint — token reference + story presence on any new component under `apps/web/src/components/` or `packages/ui/src/` | Pass/fail; feeds `design.bespoke_components_added` |
| Per PR | Accessibility check — §X `NEW-667…676` (`UX_PATHS_CATALOG.md:1493`) as an axe/ESLint gate: skip links, focus rings, Escape behaviour, SR announcements, reduced-motion, RTL, grid roles | Violation list per PR |
| Weekly | **Ledger reconciliation** — grep every "Unblocked by" cell in `UX_PATHS_CATALOG.md:10-67` against the repo (L-DSN-1) | `design.ledger_drift_days`, stale-row list |
| Weekly | Path close report — rows closed, and how many were on routes used during service (L-DSN-5 input) | `design.paths_closed_per_month`, `design.paths_closed_on_service_routes` |
| Biweekly | **Manifest sweep** — new directories not in `MANIFEST.md`, rows with no directory, duplicate IDs, and every row null for 2+ close-times (L-DSN-2) | `design.resolved_question_rate`, `design.sketch_index_completeness` |
| Monthly | Substrate census — token sources, primitives with stories, % of newly-shipped surface composed from the system (L-DSN-3) | `design.token_source_count`, `design.primitive_documented_ratio`, `design.system_composition_pct` |
| Monthly | Activation cohort read, split owner / manager / staff — **never averaged** (L-DSN-4) | `design.time_to_first_real_action_*_min` |
| Monthly | **Optimizer dark-check** — row counts in `ux_proposals`, `ux_overrides`, `ux_learnings`, and the value of `UX_OPTIMIZER_ENABLED` | `design.ux_optimizer_rows`; **correct value 0** |
| Quarterly | Charter staleness sweep — anything untouched 60+ days is finished or fiction ([[README]] §3.3, §6) | Archive or revision |
| Quarterly | Team-shape review — is Activation a Design team or a Product & Vision one? Is the count 4 or 3? | Recommendation to [[decision-office-charter]] |

The optimizer dark-check is deliberately a **scheduled job, not a team**
([[design-charter]], non-goals). Keeping something off is a monthly grep. Advancing it
would have been a hire, and hiring is the wrong way to reverse
[[AGENT_NATIVE_UI_DECISION]]:78.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion — the anti-sprawl rule applies here exactly as it does to agendas.

**Honest state: `.claude/skills/` does not exist in this repository.** The only project
skill on disk is `.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). Design
therefore owns **zero skills today**, and the table below is a proposal, not an index.

Each candidate is tied to a recurring job above rather than invented for coverage, per the
skill-creation protocol ([[README]] §3.3): name the trigger, name the doneability
criteria, cite a real past instance.

| Proposed skill | Fires on | Real past instance it would have caught | Owning team |
|---|---|---|---|
| `ux-ledger-reconcile` | Weekly ledger job | **`UX_PATHS_CATALOG.md:49` vs `:1013`** — the Seating Density row, stale since 2026-07-27 | [[ux-path-burn-down-charter]] |
| `sketch-manifest-sweep` | Biweekly manifest job | The **10 unindexed directories** (005, 011–015, 017–019, 049) and manifest row `039` with no directory | [[exploration-studio-charter]] |
| `design-token-census` | Monthly substrate census | `apps/mobile/src/design/tokens.ts` becoming a **second token source** without a decision | [[design-system-motion-substrate-charter]] |
| `a11y-path-audit` | Per PR, plus quarterly full sweep | §X `NEW-667…676` written as prose in July and enforced nowhere since | [[design-system-motion-substrate-charter]] |
| `first-run-role-trace` | Monthly activation read | Sketch **051**: the one-tour-per-session cap suppressing per-page first-run guidance — identified, winner named, never executed | [[activation-in-product-guidance-charter]] |
| `optimizer-dark-check` | Monthly | `apps/api-gateway/src/ux-optimizer/` shipping enabled-by-config with four tables and **0 rows** | Department (no team) |

**Nothing in this table exists yet.** It is listed so that each skill is created *against a
scheduled job with a close-time*, rather than a skill being created and a job invented to
justify it. Ownership of the registry itself sits with [[skills-charter]] (Applied AI) —
Design authors skills; it does not govern the registry.

### Anti-sprawl note specific to this department

Design is the department most exposed to sprawl in both directions: a 910-row catalogue
invites work that is enumerable but unimportant, and a 53-directory sketch corpus invites
work that is enjoyable but unresolved. Both anti-sprawl rules are therefore enforced
*numerically* rather than culturally — the biweekly manifest sweep withdraws stale
questions, and the weekly path-close report publishes the service-route split next to the
headline count so volume cannot masquerade as progress.
