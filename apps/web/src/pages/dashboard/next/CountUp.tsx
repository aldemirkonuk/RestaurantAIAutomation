/**
 * CountUp — figures arrive on the `tally` spring (num-01 lineage: overdamped,
 * 840ms, never bounces past). Driven by the exported spring samples so the
 * curve on screen IS the token, not an approximation.
 *
 * House rule encoded: `value: null` renders the em dash and NEVER counts —
 * an unknown does not ease from a number, and 0 is only shown when 0 is true.
 */

import { useEffect, useRef, useState } from 'react';
import { springs, tally, useReducedMotion } from '@/lib/mudavym';
import { DASH } from './format';

export interface CountUpProps {
  /** The real figure, or null for "unknown" (renders the em dash). */
  value: number | null;
  /** Formatter for the in-flight and final figure. Default: rounded string. */
  format?: (n: number) => string;
  className?: string;
}

/** Progress 0→1 along the tally spring's sampled curve. */
function tallyProgress(t: number): number {
  const s = springs.tally.samples;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const pos = t * (s.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * frac;
}

export function CountUp({ value, format = (n) => String(Math.round(n)), className }: CountUpProps) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number | null>(value);
  const fromRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const doneRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    if (doneRef.current) clearTimeout(doneRef.current);
    if (value == null) {
      // Unknown: show the dash immediately; nothing counts down to it.
      fromRef.current = null;
      setDisplay(null);
      return;
    }
    const from = fromRef.current ?? 0; // first arrival counts up from zero
    fromRef.current = value;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const p = tallyProgress((now - start) / tally.ms);
      setDisplay(from + (value - from) * p);
      if (p < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    // rAF is throttled to nothing in hidden/occluded tabs — the figure must
    // still LAND. The timeout is the truth-keeper, not part of the motion.
    doneRef.current = setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      setDisplay(value);
    }, tally.ms + 120);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (doneRef.current) clearTimeout(doneRef.current);
    };
  }, [value, reduced]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums lining-nums' }}>
      {display == null ? DASH : format(display)}
    </span>
  );
}

export default CountUp;
