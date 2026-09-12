/**
 * Mudavym motion vocabulary — sketch 059 `motion.json`, as code.
 *
 * The spring curves are produced by a damped-spring integrator sampled into a
 * CSS `linear()` easing string, adapted from the proven sampler in sketch 063
 * `parts/sig-hero.html` — so the numbers on the token ARE the curve that runs.
 *
 * NO new npm dependency, deliberately: this is CSS easings + the Web
 * Animations API only. Adopting the `motion` package is a later, separate
 * decision (it would be an ADR of its own); nothing here precludes it, and the
 * token shape `{ easing, ms }` ports to it directly.
 *
 * Duration semantics (matters if you re-derive): 059's `durationMs` for spring
 * tokens is the time for the spring to settle within 1% of target — tally's
 * card says so explicitly ("time to within 1% of target … fully at rest at
 * 1408ms"). The sampler below integrates to that same 1% envelope, so its
 * measured settle time reproduces 059's numbers (the unit test asserts it);
 * the exported tokens carry 059's documented figures verbatim.
 */

import { useEffect, useState } from 'react';

export interface MotionToken {
  /** CSS easing — `cubic-bezier(…)`, `linear`, or a sampled `linear(…)`. */
  easing: string;
  /** Duration in milliseconds. */
  ms: number;
}

export interface SpringSample extends MotionToken {
  /** The raw progress samples (0 → 1, may exceed 1 on overshoot). */
  samples: number[];
}

/**
 * Integrate a damped spring (semi-implicit Euler — sig-hero's scheme, at a
 * finer dt = 1/1000s so the discrete overshoot matches the physical one) and
 * sample the progress curve into a CSS `linear()` string.
 *
 * Integration stops when the energy amplitude √(x² + (v/ω)²) — the decay
 * envelope, not the instantaneous position, which passes through zero twice a
 * cycle — drops below restDelta. Gating on the envelope reproduces 059's
 * measured durations; gating on |x| and |v| separately fires early whenever
 * the two momentarily align out of phase.
 *
 * The true peak of the raw trajectory is injected into the 60 samples, so
 * downsampling can never clip the overshoot — the stamp's 11% ceremony is in
 * the curve, not just in the maths. The final sample is clamped to 1 so the
 * animation always lands exactly on its keyframe target (the residual is
 * < restDelta by construction).
 */
export function springLinear(
  stiffness: number,
  damping: number,
  mass = 1,
  restDelta = 0.01,
): SpringSample {
  const dt = 1 / 1000;
  const omega = Math.sqrt(stiffness / mass);
  let x = 1; // displacement from target; progress = 1 - x
  let v = 0;
  let t = 0;
  const pts: number[] = [];
  while (t < 5) {
    v += ((-stiffness * x - damping * v) / mass) * dt;
    x += v * dt;
    t += dt;
    pts.push(1 - x);
    if (Math.hypot(x, v / omega) < restDelta) break;
  }
  const N = 60;
  const last = pts.length - 1;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    const idx = Math.min(last, Math.round((i * last) / (N - 1)));
    samples.push(Number(pts[idx].toFixed(4)));
  }
  // Preserve the true peak (the overshoot is the point of the stamp).
  let peakIdx = 0;
  for (let i = 1; i <= last; i++) if (pts[i] > pts[peakIdx]) peakIdx = i;
  if (pts[peakIdx] > 1) {
    const at = Math.min(N - 2, Math.max(1, Math.round((peakIdx * (N - 1)) / last)));
    samples[at] = Number(pts[peakIdx].toFixed(4));
  }
  samples[0] = 0;
  samples[N - 1] = 1;
  return {
    easing: `linear(${samples.join(',')})`,
    ms: Math.max(140, Math.round(t * 1000)),
    samples,
  };
}

/* ── The seven tokens — names and numbers are 059's, verbatim ────────────── */

const HOUSE = 'cubic-bezier(0.16, 1, 0.3, 1)';

const tuckSpring = springLinear(380, 32); // near-critically damped, ~1% overshoot
const stampSpring = springLinear(500, 26); // the ceremonial one, ~11.1% overshoot
const tallySpring = springLinear(120, 26); // overdamped, 0% overshoot

/** The house curve. Row expands, chevron turns, fades, panel swaps. */
export const settle: MotionToken = { easing: HOUSE, ms: 320 };

/** Micro-states: hovers, borders, chip fills. Nothing moves more than 2px. */
export const ink: MotionToken = { easing: HOUSE, ms: 160 };

/** Objects that move under a finger — toggle thumbs, drawers, swipe returns. */
export const tuck: MotionToken = { easing: tuckSpring.easing, ms: 300 };

/** "Show the working" — the page-turn reveal. Slower than settle on purpose. */
export const turn: MotionToken = { easing: 'cubic-bezier(0.32, 0.72, 0, 1)', ms: 420 };

/**
 * Hold-to-approve fill. Deliberately `linear`: the operator is timing it
 * against their own thumb. (059 files this token under the name "press";
 * the design foundation exports it as `pour` — same numbers, one curve.
 * Cancel/release retreats on `tuck`.)
 */
export const pour: MotionToken = { easing: 'linear', ms: 620 };

/** 059's canonical name for {@link pour}. */
export const press: MotionToken = pour;

/** The seal landing. The only motion in the system allowed to overshoot. */
export const stamp: MotionToken = { easing: stampSpring.easing, ms: 360 };

/** Number tickers. Overdamped — figures arrive, they never bounce past. */
export const tally: MotionToken = { easing: tallySpring.easing, ms: 840 };

/** All tokens by 059 name, for data-driven use. */
export const motionTokens = { settle, ink, tuck, turn, pour, stamp, tally } as const;
export type MotionTokenName = keyof typeof motionTokens;

/** Raw spring samples, exported for tests and for canvas/JS-driven motion. */
export const springs = { tuck: tuckSpring, stamp: stampSpring, tally: tallySpring } as const;

/* ── Reduced motion ──────────────────────────────────────────────────────── */

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Non-hook check, for event handlers and plain functions. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

/** Reactive `prefers-reduced-motion`, live across OS setting changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ── WAAPI wrapper ───────────────────────────────────────────────────────── */

/**
 * Animate `el` with a Mudavym token. Thin wrapper over `Element.animate()`:
 *
 * - reduced motion collapses the animation to its end state instantly
 *   (duration 0, fill forwards) — the change still happens, it just doesn't
 *   travel;
 * - a browser that cannot parse `linear(…)` easings falls back to the house
 *   curve rather than throwing.
 *
 * Returns the `Animation`, or `null` when WAAPI is unavailable (jsdom).
 */
export function animate(
  el: Element,
  keyframes: Keyframe[] | PropertyIndexedKeyframes,
  token: MotionToken,
  options: Omit<KeyframeAnimationOptions, 'duration' | 'easing'> = {},
): Animation | null {
  if (typeof el.animate !== 'function') return null;
  const reduced = prefersReducedMotion();
  const base: KeyframeAnimationOptions = {
    fill: 'both',
    ...options,
    duration: reduced ? 0 : token.ms,
    easing: reduced ? 'linear' : token.easing,
  };
  try {
    return el.animate(keyframes, base);
  } catch {
    // Older engines reject linear(…) easings — degrade to the house curve.
    return el.animate(keyframes, { ...base, easing: reduced ? 'linear' : HOUSE });
  }
}
