---
type: agenda-full
division: product
department: design
team: design-system-motion-substrate
status: provisional
metrics: [design.system_composition_pct, design.token_source_count, design.primitive_documented_ratio, design.a11y_violations_per_pr]
updated: 2026-08-24
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-premortem]]", "[[design-system-motion-substrate-agenda-board]]", "[[design-system-motion-substrate-directive]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-schedule]]", "[[design-agenda-full]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[media-brand-charter]]", "[[client-surfaces-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# Design System & Motion Substrate — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn a real-but-undocumented substrate into one that **constrains the next surface** rather
than describing the last one. Three states to change, in a deliberate order:

| State today | Target | Why it is in this order |
|---|---|---|
| §X accessibility is prose, enforced nowhere | One CI enforcement live | Changes the next PR. Ships **before** the first Storybook page |
| Two token sources (`apps/web`, `apps/mobile/src/design/tokens.ts`) | One, or a funded migration plan and a drift check | Predicts decay faster than any coverage number |
| 5 of 18 primitives documented in `apps/web/src/components/ui/`; **0** in `packages/ui` | The shared package documented first | The shared package's consumers are other teams — its gaps compound |
| Motion: 9 named motions across sketches 043–046, all `Winner: null` | Winners named, or questions withdrawn | The deepest design work in the repo is currently unshippable |

And one metric that does not exist yet: **`design.system_composition_pct` has no
denominator.** Defining "composed from the system" in a codebase with two token sources is
the first real deliverable, not a preliminary.

## How

### 1. Enforcement before documentation — the order is the strategy

[[design-system-motion-substrate-premortem]] M1 is the likeliest failure and its mechanism
is entirely about sequence: documenting 18 existing primitives feels like building a design
system and changes nothing about the nineteenth. So **one enforcement ships first**.

§X (`UX_PATHS_CATALOG.md:1493`) is the obvious candidate because it is already enumerated —
skip links, focus rings, Escape behaviour, SR announcements, reduced-motion, RTL, grid
roles. Start with **reduced-motion**: it is the single §X item that intersects the motion
work, and shipping motion without it turns every later gesture into a defect.

### 2. Document the shared package before the app package

Counterintuitive, and correct. `apps/web/src/components/ui/` has 5 of 18 documented;
`packages/ui/src/` has **0**. The instinct is to finish the one that is started. But
`packages/ui` is the package whose consumers are *other teams*, which is this team's entire
reason to exist — its gaps compound across both apps, and the app-level gaps do not.

### 3. Tokens: decide, or measure the cost of not deciding

Two paths, and the team may not take neither:

- **Migrate** — one token source. Requires a budget that touches a shipped app for no
  visible user benefit. That is a founder call, not a design one.
- **Defer with a drift check** — a monthly diff publishing every value that exists in one
  source and not the other, by name. The cost of postponing becomes a growing list instead
  of a stable "2" on a board.

At one quarter with neither, the metric comes off the board
([[design-system-motion-substrate-directive]]). A decorative metric launders inaction as
tracking.

### 4. Motion: force convergence, accept either answer

Sketches 043–046 specify nine motions with trigger / motion / haptic / **anti-gimmick**
clauses, and 042 already chose *H — RN Skia + Reanimated*. All four motion sketches carry
`Winner: null`.

Apply [[exploration-studio-charter]]'s two-close-time rule: name winners, or withdraw the
questions and record that this product has no signature motion language. **Both are
acceptable outcomes. The null is not** — it is the state in which the most detailed design
work in the repo remains permanently unshippable.

### 5. Stop propagating the stale brand

`.planning/sketches/MANIFEST.md` "Design Direction" still says *"WineOps AI"* alongside
`#CD2D5B` and Plus Jakarta Sans. Retiring the string is [[media-brand-charter]]'s;
**not carrying it into a token name, a Storybook title, or a component comment is ours.**

## Why now

- **The shared package is the least documented thing in the repo**, and it is the one whose
  failure compounds across 51 routes and two apps.
- **Two token sources is a decay indicator, not a preference.** Web and native diverge one
  hex value at a time; there is a window in which unification is a migration, and after it
  a redesign.
- **The a11y argument has a deadline.** The department declined a separate a11y team on the
  grounds that a CI standard beats a team overruled by every deadline. If enforcement never
  ships, the department has neither, and has argued itself out of both.
- **The motion specs are perishable.** Sketch 042's stack choice ages. Nine fully-specified
  motions with anti-gimmick clauses is unusual, valuable, and currently worth nothing
  because no winner was named.
- **The burn-down is about to start.** Every sprint it runs without a constraint in place
  adds bespoke components (premortem M4). The constraint is cheapest to install *before*
  the volume arrives.

## Next steps

- [ ] Ship **one** §X enforcement — reduced-motion first — before any Storybook page
- [ ] Define `design.system_composition_pct`: what counts as "composed", and what the
      denominator is
- [ ] Publish the token drift diff between `apps/web` and `apps/mobile/src/design/tokens.ts`
- [ ] Document `packages/ui` primitives **before** finishing `apps/web/src/components/ui/`
- [ ] Land the per-PR design lint: new component ⇒ token reference + story, or a comment
      explaining why not
- [ ] Force winners on sketches 043–046, or withdraw them — either way, remove the nulls
- [ ] Publish a primitive-request SLA to [[ux-path-burn-down-charter]]. Slower than a
      sprint means bespoke wins on merit and the compose-don't-invent rule deserves to break
- [ ] Audit primitives for Next.js assumptions — `apps/web` is a **Vite SPA with
      `react-router-dom`** (`apps/web/package.json:8,55,94`)

## Questions for the founder

1. **Is there a migration budget for one token source?** Without it,
   `design.token_source_count` is decorative and should be deleted rather than reported.
   With it, this is the highest-leverage substrate work available.
2. **Does the motion language ship, or is it archived?** Nine specified motions, a chosen
   stack, zero winners. Archiving is a legitimate answer and cheaper than pretending. What
   is not legitimate is leaving it null for another year.
3. **Can this team block a merge?** A per-PR lint that only warns will be ignored by week
   six. A lint that blocks costs the burn-down time. [[design-directive]] makes advisory
   findings-only, but **this is a line function, not an advisory one** — the answer is not
   inherited and needs stating.
4. **Storybook for `packages/ui` — is the runner in place?** The content is ours; the
   machinery is [[client-surfaces-charter]]'s. If the runner does not cover the workspace
   package, "0 stories" is partly a tooling fact and partly a design one, and the split
   should be established before it is used as an excuse.
5. **How much motion does an operator product want?** Sketches 043–046 include their own
   anti-gimmick clauses, which suggests the authors already worried about this.
   [[AGENT_NATIVE_UI_DECISION]]:92-95 says muscle memory during service is a performance
   budget. Motion that delays a tap by 200ms at 4pm on a Friday is a cost, not a delight.
