---
type: agenda-full
division: product
department: design
status: provisional
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.token_source_count, design.resolved_question_rate, design.time_to_first_real_action_staff_min, design.ledger_drift_days]
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-premortem]]", "[[design-agenda-board]]", "[[design-directive]]", "[[design-loops]]", "[[design-schedule]]", "[[ux-path-burn-down-charter]]", "[[design-system-motion-substrate-charter]]", "[[exploration-studio-charter]]", "[[activation-in-product-guidance-charter]]", "[[product]]", "[[ORG_STRUCTURE]]", "[[UX_PATHS_CATALOG]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Design — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Take ownership of two large, real, currently ownerless corpora — **910 UX paths** and
**53 sketch directories** — and get each of the department's five primary metrics from
*never measured* to *measured*, before attempting to move any of them.

Not one of the five has a first reading:

| Metric | State today |
|---|---|
| `design.paths_closed_per_month` | ~90–100 of 910 closed cumulatively; **no rate ever measured** |
| `design.deferred_unblocker_ratio` | High and unquantified. The `:10-67` log has the data; nobody has divided |
| `design.token_source_count` | **Measured: 2** — `apps/web` + `apps/mobile/src/design/tokens.ts` |
| `design.resolved_question_rate` | **Measured: 15 of 43** indexed; 43 of 53 directories indexed |
| `design.time_to_first_real_action_staff_min` | **Unmeasured**, and there is no event to compute it from |
| `design.ledger_drift_days` *(secondary, predicts decay)* | **Non-zero, unknown.** At least one row (`:49`) is stale |

Two of the six are readable today. Four are not. A department that starts by redesigning
before it can read its own numbers cannot demonstrate that anything it did worked.

## How

**Sequence: repair → measure → constrain → ship.** In that order, and the first step is
deliberately small.

### 1. Repair the known drift first (one session, not a quarter)

The Deferred Decisions Log at `UX_PATHS_CATALOG.md:49` contradicts `:1013` and
`apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`. Fix that row, then
sweep every other "Unblocked by" cell in the `:10-67` table against the repo and record
how many were also stale. **That number is the department's founding baseline** — it is
the honest measurement of how far an unowned ledger drifts in the absence of an owner, and
it will never be cheaper to take than now.

Do the same for `.planning/sketches/MANIFEST.md`: index the 10 unlisted directories (005,
011–015, 017–019, 049), resolve the duplicate `038` and `048` IDs, and either restore or
delete row `039`, which points at a directory that does not exist.

### 2. Measure before designing

Each of the four teams' first artifact is a **number**, or a written statement of why the
number cannot be read and what it would take. Specifically:

- `design.time_to_first_real_action_staff_min` requires an event that does not exist. The
  honest first deliverable is the **event definition**, negotiated with
  [[analytics-bi-charter]] — not an onboarding redesign.
- `design.system_composition_pct` requires knowing what "composed from the system" means
  in a codebase with two token sources. The first deliverable is the **definition and the
  denominator**.

### 3. Constrain before cataloguing

[[design-premortem]] M4 is the trap: documenting 18 existing primitives feels like
building a design system and changes nothing about the next component. So the substrate
team's first *constraint* — one lint rule, one CI check — ships before its first Storybook
page. §X accessibility (`NEW-667…676`, `UX_PATHS_CATALOG.md:1493`) is the obvious
candidate: it is already enumerated, and converting it from prose to enforcement is the
difference between a standard and a wish.

### 4. Ship on frequency-of-use, not on catalogue order

The 100 adjacent seating-density rows are the most tempting and the least valuable
(~70 are blocked on absent tables anyway, `:64`). Ordering is by **use during service**,
per [[AGENT_NATIVE_UI_DECISION]]:87-95. A section is never completed as a unit.

## Why now

- **Nobody owns it, and it is the largest thing nobody owns.** Neither the catalogue nor
  the sketch corpus is assigned to any department in [[README]] §2.2. That is the gap this
  department fills, and it is a gap measured in ~157KB of specification plus 97 sketch
  files.
- **The drift is observable today, not hypothetical.** `:49` versus `:1013` is a
  contradiction inside a single file that took one grep to find. Every week without an
  owner adds rows to that class silently.
- **The exploration corpus is stalling in a way that is already measurable.** 28 of 43
  rows unresolved is not a risk; it is a reading. Two-thirds of the design thinking done
  in this repo never produced a decision anyone could act on.
- **The activation constraint is a business constraint, and it is written down.** High
  staff turnover means first-run recurs forever ([[AGENT_NATIVE_UI_DECISION]]:87). No
  department currently owns the sentence the founder's own review wrote as a fix:
  *"cut the surface with role-based defaults"* (`:102`).
- **Two of four teams are cheap to start.** [[ux-path-burn-down-charter]] and
  [[exploration-studio-charter]] both inherit an enumerated corpus. `product.md:845`
  places the burn-down in the division's **second** activation wave for exactly this
  reason: largest ownerless backlog, already enumerated, cheap to start.

## Next steps

- [ ] Repair `UX_PATHS_CATALOG.md:49` and sweep all `:10-67` unblocker cells against the
      repo — publish the stale-row count as the founding baseline —
      [[ux-path-burn-down-charter]]
- [ ] Index the 10 unlisted sketch directories; resolve duplicate IDs `038`/`048`; restore
      or delete manifest row `039` — [[exploration-studio-charter]]
- [ ] Publish first readings for all five primary metrics, or a written statement of what
      each would require — [[design-loops]]
- [ ] Define the "real action" event with [[analytics-bi-charter]] before any onboarding
      change ships — [[activation-in-product-guidance-charter]]
- [ ] Ship **one** enforcement (lint or CI) from §X before the first Storybook page —
      [[design-system-motion-substrate-charter]]
- [ ] Build role-based defaults for owner / manager / staff — the deliverable
      [[AGENT_NATIVE_UI_DECISION]]:102 named and nobody owns — and unblock `NEW-513`
      (`/settings` role matrix, deferred at `:63`)
- [ ] Execute sketch 051's winner (*first-visit overrides session cap*) rather than
      re-exploring it. The question is resolved; the code is not
- [ ] Correct the "760-path" figure wherever it appears ([[engineering-premortem]] M5,
      founder notes) to **910** — [[ux-path-burn-down-charter]] owns the count
- [ ] Push both Design forks (**PROD-F1**, **PROD-F5**) into `OPEN-DECISIONS.md` — the
      numbers originally proposed in `product.md:858-862` collided with OD-20…OD-23 and
      were renamespaced ([[FORK-REGISTRY]]) — [[decision-office-charter]]

## Questions for the founder

1. **Can the burn-down team commission endpoints, or only report blocked?** Most deferred
   rows are blocked on backend work, not on design. This is the fork that decides whether
   the department's largest team can function or spends a year writing the word "blocked"
   ([[design-charter]], open forks). **Highest-stakes question here.**
2. **Is the 910-row catalogue a commitment or an inventory?** If every row is intended to
   ship, that is years of work and the ordering rule is the entire strategy. If it is an
   inventory from which a subset ships, the department needs permission to **close rows as
   "will not build"** — and today there is no such state in the ledger.
3. **Does the design system get a migration budget, or only a documentation budget?**
   `design.token_source_count` goes from 2 to 1 only by changing `apps/mobile`. Without
   that budget the metric is decorative and should be removed rather than reported.
4. **Four teams, or three?** Activation is the one that could plausibly sit under Product &
   Vision, since its outcome is a business number rather than a design judgement. The
   case for keeping it here is that its named deliverable — *cut the surface* — is an
   interaction-design act. State the preference; do not let it be settled by whoever picks
   up the work first.
5. **Confirm the optimizer stays dark.** [[design-charter]] commits Design to *keeping*
   `apps/api-gateway/src/ux-optimizer/` off and to treating a non-zero row count as an
   incident. If the intent is instead to revisit [[AGENT_NATIVE_UI_DECISION]]:78, that is
   a supersede-ADR and this department should not be the place it happens quietly.
