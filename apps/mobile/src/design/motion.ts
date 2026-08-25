/**
 * Motion vocabulary — calm instrument base.
 *
 * Routine motion is fast, physical, and near-invisible: things settle, they
 * never bounce. Expressive motion is reserved for the named signatures
 * (Ledger Fold, Capsule Sweep, Bin Breath, Sediment Settle, Feed Zero,
 * Provenance Stitch), each implemented next to the surface it serves.
 */
import { Easing, withSpring, withTiming } from "react-native-reanimated";
import type { WithSpringConfig, WithTimingConfig } from "react-native-reanimated";

export const spring = {
  /** Default settle for layout/position. No overshoot. */
  settle: { damping: 28, stiffness: 320, mass: 1 } satisfies WithSpringConfig,
  /** Softer settle for larger surfaces (sheets, cards entering). */
  gentle: { damping: 26, stiffness: 220, mass: 1 } satisfies WithSpringConfig,
  /** Sediment Settle — feed cards drifting down after a removal. */
  sediment: { damping: 30, stiffness: 180, mass: 1.1 } satisfies WithSpringConfig,
} as const;

export const duration = {
  fast: 140,
  base: 200,
  slow: 320,
  /** Signature moments only. */
  signature: 600,
} as const;

/** Standard decelerate — everything exits/settles with this. */
export const ease = Easing.bezier(0.2, 0, 0, 1);

export const timing = {
  fast: { duration: duration.fast, easing: ease } satisfies WithTimingConfig,
  base: { duration: duration.base, easing: ease } satisfies WithTimingConfig,
  slow: { duration: duration.slow, easing: ease } satisfies WithTimingConfig,
} as const;

/** Press affordance: barely-there scale that makes taps feel physical. */
export const pressScale = 0.97;

export const settleTo = (value: number) => withSpring(value, spring.settle);
export const fadeTo = (value: number) => withTiming(value, timing.base);

/** The grace window before vendor-visible sends fire (Ledger Fold countdown). */
export const GRACE_MS = 8000;
