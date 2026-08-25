---
type: reference
name: Animista
category: design-ui
url: https://animista.net
status: candidate
decision: null
verified: 2026-08-24
updated: 2026-08-24
links: ["[[05-library/README|Library index]]", "[[motion-primitives]]"]
---

# Animista

## What it is

Verified 2026-08-24 against `animista.net`.

A browser tool for picking and tuning **pre-made CSS animations**, then copying out only
the keyframes and classes you use — or downloading a combined `animista.css`.

**Licence, verified on the site:** all generated CSS is free for personal and commercial
use under the **FreeBSD (BSD-2-Clause) licence**; no attribution required. Donations
optional.

## Why it might matter here specifically

It emits **plain CSS keyframes** — no runtime, no dependency, no bundle cost. That makes it
complementary to, not competing with, the JS motion already in `apps/web`
(`framer-motion ^10.18.0`, `apps/web/package.json:44`). Keyframe-only effects (loaders,
attention pulses, entrance flourishes on static marketing surfaces) do not need a motion
library at all, and using one for them is overhead.

## What adopting it would cost

Effectively nothing to "adopt" — output is copied CSS with a permissive licence. The costs
are qualitative:

- Generated keyframes ignore `prefers-reduced-motion` unless wrapped by hand.
- Copied-in animations bypass any design-token/duration scale; without a rule they become
  N unrelated timing functions in the stylesheet.
- Overlap with `framer-motion` means two motion systems unless someone writes down which
  is used when.

## What decision it bears on

None open. Would be governed by a motion/design-token decision if one is ever recorded.

## Status

`candidate` — verified, permissively licensed, zero-install. Not adopted.
