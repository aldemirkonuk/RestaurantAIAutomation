/**
 * RcTally — a figure that arrives on the overdamped tally spring and never
 * bounces past a number someone will act on (motion 059, token `tally`).
 * Same contract as OrdersNext's Tally (`pages/orders/next/Tally.tsx`), copied
 * per the page-owns-its-parts precedent:
 *
 * - it never animates on first paint — an at-risk total that was already
 *   $412 when you walked in is just $412;
 * - `null` renders as an em dash, never zero, and a dash→number transition is
 *   an arrival of knowledge, not a change of value, so it does not tick either.
 */

import { CSSProperties, useEffect, useRef, useState } from 'react';
import { springs, tally, useReducedMotion } from '@/lib/mudavym/motion';
import { EM } from './rc-format';

export interface RcTallyProps {
  value: number | null;
  /** Formats the in-flight interpolated value as well as the final one. */
  format?: (n: number) => string;
  className?: string;
  style?: CSSProperties;
}

export function RcTally({
  value,
  format = (n) => String(Math.round(n)),
  className,
  style,
}: RcTallyProps) {
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

export default RcTally;
