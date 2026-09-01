/**
 * Tally — a figure that arrives on the overdamped tally spring and never
 * bounces past a number someone will act on (motion 059, token `tally`).
 *
 * Two honesty rules from the motion canvas:
 * - it never animates on first paint — a count that was already at nine when
 *   you walked in is just nine;
 * - `null` renders as an em dash, never zero, and a dash→number transition is
 *   an arrival of knowledge, not a change of value, so it does not tick either.
 */

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { springs, tally, useReducedMotion } from '@/lib/mudavym/motion';
import { EM } from './format';

export interface TallyProps {
  value: number | null;
  /** Formats the in-flight interpolated value as well as the final one. */
  format?: (n: number) => string;
  className?: string;
  style?: CSSProperties;
}

export function Tally({ value, format = (n) => String(Math.round(n)), className, style }: TallyProps) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState<number | null>(value);
  const prevRef = useRef<number | null>(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    cancelAnimationFrame(rafRef.current);
    if (value === null || prev === null || prev === value || reduced) {
      setDisplay(value);
      return;
    }
    const { samples } = springs.tally;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / tally.ms);
      const idx = Math.min(samples.length - 1, Math.floor(t * (samples.length - 1)));
      setDisplay(prev + (value - prev) * samples[idx]);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else setDisplay(value);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, reduced]);

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums', ...style }}>
      {display === null ? EM : format(display)}
    </span>
  );
}

export default Tally;
