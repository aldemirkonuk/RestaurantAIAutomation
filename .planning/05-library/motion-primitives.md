---
type: reference
name: Motion Primitives
category: design-ui
url: https://motion-primitives.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[shadcn-ui]]", "[[animista]]"]
---

# Motion Primitives

## What it is

Verified 2026-08-24 via GitHub (`ibelick/motion-primitives`) — the marketing site returned
HTTP 403 to a direct fetch, so the facts below come from the repository.

- A **UI kit of animated React components**, MIT-licensed, built with
  [`motion`](https://motion.dev) (the successor package to Framer Motion) and **Tailwind
  CSS**.
- The repository README states the project is **in beta**, with "significant updates to
  the code" expected.
- Distributed in the shadcn copy-in style rather than as a single runtime dependency.

**UNVERIFIED:** whether a paid "Pro" tier exists and what it contains. The site was not
reachable in this pass; do not repeat a pricing claim about it without checking.

## Why it might matter here specifically

It targets exactly this stack: React + Tailwind (`apps/web/package.json:92`) with a
shadcn-shaped distribution ([[shadcn-ui]]).

The blocker is a version mismatch that should be stated before anyone tries it:
`apps/web` uses **`framer-motion ^10.18.0`** (`apps/web/package.json:44`). Motion
Primitives targets the renamed **`motion`** package, which is the v11+ lineage. Using it
means either migrating `framer-motion` → `motion` across `apps/web`, or running both — and
running both is a duplicate animation runtime in the bundle.

Compare with [[animista]], which produces plain CSS and has none of this coupling.

## What adopting it would cost

- A `framer-motion` → `motion` migration in `apps/web`, or accepting two motion runtimes.
- Beta-stage upstream: copied components will drift from the source.
- Same reduced-motion and timing-scale caveats as any imported animation.

## What decision it bears on

None open. It would fold into any motion/animation-substrate decision, which Design owns.

## Status

`candidate` — MIT and stack-appropriate, but beta and coupled to a package version
`apps/web` does not currently use. Pro-tier pricing UNVERIFIED.
