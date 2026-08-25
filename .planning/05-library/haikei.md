---
type: reference
name: Haikei
category: design-ui
url: https://haikei.app
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]"]
---

# Haikei

## What it is

Verified 2026-08-24 against `haikei.app` and `app.haikei.app`.

A browser generator for background/decorative SVG assets — blobs, waves, gradients,
scatter, polygons, grid-based shapes — with parameters for style (solid/outline),
interpolation, direction, and colour. **Exports SVG and PNG.** The site states
"Free, no signups, no credit cards." Made by **z creative labs GmbH** (`@zcreativelabs`).

**UNVERIFIED: the licence for generated assets.** The homepage and app do not state usage
terms, and no terms page was located in this pass. Commercial use is therefore **not
confirmed** — treat it as an open question to resolve with the vendor (`hi@haikei.app`)
before any generated asset ships in a customer-facing surface.

## Why it might matter here specifically

The pull is marketing and empty-state surfaces, not product chrome. `apps/web` has
`empty-state.tsx` and `error-state.tsx` in `src/components/ui/` — the kind of screen a
generated background is genuinely for. SVG output means it costs bytes, not a dependency.

## What adopting it would cost

- Near-zero technical cost — exported SVG dropped into `public/` or inlined.
- **A licensing check that has not been done.** Shipping an asset whose terms are unknown
  onto a customer-facing page is a small legal exposure, and Compliance & Privacy /
  Legal would own resolving it.
- Generated backgrounds are a strong aesthetic commitment; they read as "generated" if
  used without a design intent behind them.

## What decision it bears on

None open. Blocked in practice on the licence question above.

## Status

`candidate` — tool verified and free to use; **asset licence UNVERIFIED**, which is the
gating item.
