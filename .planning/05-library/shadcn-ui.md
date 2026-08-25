---
type: reference
name: shadcn/ui
category: design-ui
url: https://ui.shadcn.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[21st-dev]]", "[[motion-primitives]]"]
---

# shadcn/ui

## What it is

Verified 2026-08-24 against `ui.shadcn.com/docs`.

Not a dependency — a **distribution model**. The CLI copies component source into your
repo; you own and edit the code. Built on **Radix UI primitives + Tailwind CSS**. Works
outside Next.js, including Vite + React. Its own framing: *"This is not a component
library. It is how you build your component library."*

## Why it might matter here specifically

`apps/web` is **already most of the way into this pattern without the CLI**:

- `apps/web/package.json:25-30` — `@radix-ui/react-dialog`, `-dropdown-menu`, `-select`,
  `-switch`, `-tabs`, `-tooltip`
- `apps/web/package.json:59`, `:92` — `tailwind-merge`, `tailwindcss ^3.4.1`
- `apps/web/src/lib/utils.ts` — the canonical `cn()` = `twMerge(clsx(...))`
- `apps/web/src/components/ui/` — lowercase `button.tsx`, `card.tsx`, `badge.tsx`,
  `form.tsx`, `empty-state.tsx`, `error-state.tsx` alongside PascalCase house components
  (`ThemedSelect.tsx`, `ContextMenu.tsx`, `RangeSlider.tsx`, …)

**But there is no `apps/web/components.json`**, so the shadcn CLI is not wired up. The
conventions were adopted by hand; the tooling was not. That is the actual decision on the
table — not "should we use shadcn", but "should the hand-rolled half become CLI-managed".

The mixed casing in `components/ui/` is the visible symptom: two component traditions in
one directory with no rule about which one a new component follows.

## What adopting it would cost

- A `components.json` and a one-time reconciliation pass: which existing files are
  shadcn-shaped and may be overwritten by the CLI, and which are house components that
  must never be.
- Tailwind v3 is current here; shadcn's newer registry material increasingly assumes v4.
  Check before running `add`.
- Ongoing discipline: the CLI overwrites on re-add. Local edits to generated components
  need a convention or they get lost.

## What decision it bears on

None open. If the casing/ownership split in `components/ui/` is ever settled it deserves an
ADR, because it governs every future component.

## Status

`candidate` — the *pattern* is de-facto in use; the *tool* is not installed. No ADR.
