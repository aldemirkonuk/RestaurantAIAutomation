---
type: charter
division: product
department: design
team: design-system-motion-substrate
status: partial
metrics: [design.system_composition_pct, design.token_source_count, design.primitive_documented_ratio, design.a11y_violations_per_pr, design.bespoke_components_added]
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-system-motion-substrate-premortem]]", "[[design-system-motion-substrate-agenda-full]]", "[[design-system-motion-substrate-agenda-board]]", "[[design-system-motion-substrate-directive]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-schedule]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[activation-in-product-guidance-charter]]", "[[media-brand-charter]]", "[[engineering-charter]]", "[[client-surfaces-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# Design System & Motion Substrate — Charter

Parent: **[[design-charter]]** (Product division). Siblings:
[[ux-path-burn-down-charter]], [[exploration-studio-charter]],
[[activation-in-product-guidance-charter]].

## Mandate

Own the shared substrate every surface is built from: **component primitives, tokens,
states, accessibility standards, and the motion language** — across web *and* native.

## Why distinct from its siblings

It is the only Design team whose **customer is other teams**. Its output is reused, so its
failure **compounds silently** across 51 routes and two apps, while a burn-down failure or
an exploration failure is visible on one screen. It is also the only Design team that spans
`apps/web`, `apps/mobile`, and `packages/ui` — the others each live on one surface.

That difference is not cosmetic; it changes the metric. The siblings are measured on
output shipped. This team must be measured on **what happens to work it never touched** —
the share of *newly-shipped* surface composed from its primitives. A team measured on its
own output builds a museum ([[design-system-motion-substrate-premortem]] M1).

## Boundaries

Owns outright:

- **`packages/ui/src/`** — the shared workspace package: `components/primitives/`
  (`button`, `card`, `input`, `badge`, `label`, `toast`), `components/layout/`
  (`glass-container`), `components/charts/` (`stat-card`), `components/notifications/`,
  plus `lib/` and `styles/globals.css`.
- **`apps/web/src/components/ui/`** — the app-level primitive set.
- **Tokens, both of them** — the `apps/web` layer and `apps/mobile/src/design/tokens.ts`,
  and the decision about which survives.
- **The motion language** — the specs in sketches 043–046, each carrying a full
  *trigger / motion / haptic / **anti-gimmick*** contract, and the stack decision from
  sketch 042.
- **Accessibility as an enforced standard** — §X `NEW-667…NEW-676`
  (`UX_PATHS_CATALOG.md:1493`): skip links, focus rings, Escape behaviour, SR
  announcements, reduced-motion, RTL, grid roles.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| The brand's outward expression — decks, campaigns, the `wineops.ai` → Mudavym migration | [[media-brand-charter]] *(Commercial)* | We own the token; they own the campaign it appears in. **The `MANIFEST.md` "Design Direction" block still says "WineOps AI"** — that string is theirs to change and ours to stop propagating into code |
| Deciding which paths ship | [[ux-path-burn-down-charter]] | We constrain *how* a row is built, never *whether* |
| Posing design questions | [[exploration-studio-charter]] | A winner arrives here as a direction; we turn it into a reusable primitive |
| Build tooling, bundling, the Storybook runner itself | [[engineering-charter]] / [[client-surfaces-charter]] | We own the content of the system; they own the machinery it runs on |
| Accessibility as a **team** | Nobody — it is a **standard** owned here | §X is 10 well-specified paths. A standalone a11y team at this scale is overruled by every deadline; a lint rule is not |
| Choosing the mobile stack | Already decided | Sketch **042** picked *H — RN Skia + Reanimated*. We implement that decision; we do not reopen it |

## Metrics it moves

**Primary: `design.system_composition_pct`** — % of *newly-shipped* surface composed from
system primitives and tokens, versus bespoke. Forward-looking on purpose. The obvious
alternative ("% of existing primitives documented") is the metric that produces a museum,
and it is explicitly **not** the primary.

**Secondary, and the one that actually predicts decay: `design.token_source_count`.**
Today **2**. Target **1**. Two token sources with no shared documentation is the substrate
problem stated in one line, and no amount of Storybook coverage fixes it.

| Metric | Reading today |
|---|---|
| `design.system_composition_pct` | **Undefined** — the denominator does not exist yet. First deliverable is the definition |
| `design.token_source_count` | **2** — `apps/web` layer + `apps/mobile/src/design/tokens.ts` |
| `design.primitive_documented_ratio` | **5 of 18** in `apps/web/src/components/ui/`; **0 of ~11** in `packages/ui`; **0** in `apps/mobile` |
| `design.a11y_violations_per_pr` | **Unmeasured** — §X is prose, enforced nowhere |
| `design.bespoke_components_added` | **Uncounted** — the number that shows the system failing one PR at a time |

**Neural-footprint tie.** Indirect and worth stating precisely: the motion language governs
the **human-gate** interactions — approve, commit, send — where an agent's proposal becomes
an accepted or rejected outcome. Sketches 044 and 046 specify exactly these moments
(*Cork Commit* on PO send, *Cork Seat* as an irreversible manager lock). The shape of that
gesture is what an `nf_a.outcome` human verdict physically *is*. Nothing emits today
([[README]] §1, L4).

## Evidence today

**PARTIAL — real substrate, thin coverage, and an unusually deep motion spec.**

### The substrate that exists

- **`packages/ui/src/`** is a genuine shared workspace package with `components/`, `lib/`,
  `styles/`, `index.tsx`. ⚠️ **Zero `.stories.tsx` files.** The *shared* package — the one
  whose consumers are other teams — is the one with no documented surface.
- **`apps/web/src/components/ui/`** holds 26 `.tsx` files: **5 `.stories.tsx`**
  (`form`, `toast`, `empty-state`, `error-state`, `loading-skeleton`), 3 `.test.tsx`, and
  **18 primitives with no story**. 28 story files exist across `apps/web`, but they cluster
  in `src/stories/` (`Button`, `Card`, `Input`, `Badge`) rather than beside the primitives
  that actually ship.
- **`apps/mobile/src/design/tokens.ts`** — a second, separate token source, and
  `apps/mobile` has **zero stories**.

> **The one-line diagnosis: two token sources, and the shared package is the least
> documented thing in the repo.**

### The visual language is written down — and carries a stale brand

`.planning/sketches/MANIFEST.md` "Design Direction" specifies wine-burgundy `#CD2D5B`,
Plus Jakarta Sans, glassmorphism, and names its references (Stripe Atlas, Linear, Toast
POS, Vercel). ⚠️ It still says *"WineOps AI"* — brand drift below the doc layer, the same
class as [[README]]:42-43. Ours to stop propagating; [[media-brand-charter]]'s to retire.

### Motion is specified in unusual depth — and none of it converged

Sketches **043** (`motion-signature-moments`), **044** (`wineops-signature-motions`),
**045** (`ops-signature-motions`), **046** (`cellar-commit-motions`) each carry a full
*trigger / motion / haptic / **anti-gimmick*** spec — Sediment Settle, Cellar Breath, Cork
Commit, Ledger Fold, Cellar Route Lock, Provenance Stitch, Cork Seat, Capsule Sweep, Bin
Breath. Sketch **042** already picked the stack: *H — RN Skia + Reanimated*.

⚠️ **All four motion sketches carry `Winner: null` in the manifest.** The specification
depth is real and the decision is missing. That is the substrate's version of the
department-wide convergence problem, and it means the most detailed design work in the repo
is currently unshippable.

### Accessibility is enumerated but unenforced

§X `NEW-667…NEW-676` (`UX_PATHS_CATALOG.md:1493`) specifies skip links, focus rings,
Escape behaviour, SR announcements, reduced-motion, RTL, and grid roles. Ten
well-specified paths, enforced by nothing. Converting them into a lint rule and an axe
check is the difference between a standard and a wish — and it is why a11y is a
**standard owned here** rather than a team of its own.

## A constraint this team must not forget

`apps/web` is a **Vite SPA with `react-router-dom`** (`apps/web/package.json:8,55,94`), not
Next.js. Primitives must not assume file-system routing, server components, or
`next/image`. CLAUDE.md §1 states otherwise; [[client-surfaces-charter]] owns the
correction, this team owns not building on the wrong assumption.
