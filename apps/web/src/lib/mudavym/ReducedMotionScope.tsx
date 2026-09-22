/**
 * The reduced-motion guard for the legacy chrome that still animates through
 * framer-motion — ADR 0134 §5(a) (the sidebar rail, every route, ungated) and
 * §8 (/inventory, inside its own component), both locked by the founder
 * 2026-09-21.
 *
 * The house's own motion (`animate()` in ./motion.ts) already honours
 * `prefers-reduced-motion`. framer-motion does not, by default, and a CSS guard
 * cannot reach it: it drives inline styles from JavaScript. This scope is the
 * framer half of the guard, and it only ever removes:
 *
 *   - `reducedMotion: 'always'` — every transform (x, y, scale) lands with no
 *     frames, even where a child names its own transition;
 *   - `transition: NO_MOTION` — every value on a child that names no transition
 *     of its own (opacity, width, …) lands with no frames too.
 *
 * What it cannot reach, by framer's own precedence: a NON-transform value on a
 * child that names its own transition. Such a child keeps that one value's
 * frames; each surface that has one either switches it where it is named or
 * discloses it (Sidebar.tsx switches the rail's width; InventoryCommandPage.tsx
 * names AutoLocatePreviewModal's opacity).
 *
 * For a reader who has not asked for less it is handed nothing at all, so every
 * child resolves exactly as before, and `MotionConfig` renders no element.
 */
import type { ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';

/** framer-motion's own instant transition: the value lands with no frames. */
export const NO_MOTION = { type: false } as const;

export function ReducedMotionScope({
  reduced,
  children,
}: {
  /** `useReducedMotion()` from ./motion.ts, read once by the surface. */
  reduced: boolean;
  children: ReactNode;
}) {
  return (
    <MotionConfig
      {...(reduced ? { reducedMotion: 'always' as const, transition: NO_MOTION } : {})}
    >
      {children}
    </MotionConfig>
  );
}
