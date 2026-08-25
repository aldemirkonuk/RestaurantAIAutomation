---
type: reference
name: Phosphor Icons
category: design-ui
url: https://phosphoricons.com
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]"]
---

# Phosphor Icons

## What it is

Verified 2026-08-24 via GitHub (`phosphor-icons/homepage`, `phosphor-icons/react`) — the
marketing site returned no extractable content, so the facts below come from the
repositories.

- An icon family, **MIT-licensed**, with a first-party React package
  **`@phosphor-icons/react`** (`npm i @phosphor-icons/react`).
- The legacy `phosphor-react` package is **superseded**; the repo's own README says to use
  `@phosphor-icons/react` for better performance and a significantly smaller bundle, and
  that the legacy package will get maintenance but no new icons.

**UNVERIFIED:** exact icon count and the set of weights (the family is documented as having
multiple weights — thin/light/regular/bold/fill/duotone — but this was not confirmed from a
primary source in this pass, so the number is deliberately not stated here).

## Why it might matter here specifically

`apps/web` already ships an icon library: **`lucide-react ^1.7.0`** (`apps/web/package.json:49`).
Phosphor is therefore a **replacement or a second set**, not an addition to an empty slot —
and shipping two icon families is the failure mode worth naming up front, because it is
invisible until the UI looks subtly inconsistent.

The one genuine argument for a swap is Phosphor's multiple weights, which give a density
axis Lucide does not have. Whether this product needs that axis is a design question that
has not been asked.

## What adopting it would cost

- A migration across every icon usage in `apps/web` (and `apps/mobile`, which was not
  audited in this pass), or an explicit rule about which library owns which surface.
- Bundle: two icon packages until migration completes.
- If the answer is "both", the cost is permanent inconsistency, which is worse than either
  choice alone.

## What decision it bears on

None open. A swap would deserve an ADR because it touches every screen.

## Status

`candidate` — MIT and React-ready, verified. Icon count and weight list UNVERIFIED. Not
adopted; `lucide-react` is the incumbent.
