/**
 * DoorCount — the boxes-delivered stepper, the count the founder kept (KEEP+).
 *
 * Buttons rather than a numeric keypad, exactly as the legacy screen argued: a
 * keypad in a stairwell means a typo of ten times the real number, and there
 * is no second person to catch it. 56px minimum targets — the smallest a
 * cold, gloved hand hits reliably (legacy's measured floor; well past 44px).
 *
 * The figure itself ticks on the overdamped `tally` spring (motion 059) in
 * tabular figures — it arrives, it never bounces past a number someone will
 * act on. Two honesty rules carried from the Tally on /orders:
 * - it never animates on first paint;
 * - reduced motion collapses the tick to the plain new value.
 */

import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { springs, tally, useReducedMotion } from '@/lib/mudavym';
import { MONO } from './DoorModel';

/** The ticking figure. Local to the door — big, mono, tabular. */
function DoorTicker({ value, warn }: { value: number; warn?: boolean }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = value;
    cancelAnimationFrame(rafRef.current);
    if (prev === value || reduced) {
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
    <span
      aria-live="polite"
      className={`w-28 text-center text-6xl font-bold ${
        warn && value > 0 ? 'text-amber-300' : 'text-inkm-1'
      }`}
      style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
    >
      {Math.round(display)}
    </span>
  );
}

export interface DoorCountProps {
  value: number;
  /**
   * A setState, not a plain callback, so handlers update functionally —
   * two taps landing in one render must both count (legacy's lost-tap note).
   */
  onChange: React.Dispatch<React.SetStateAction<number>>;
  label: string;
  tone?: 'default' | 'warn';
  uxKey?: string;
  /** Compact variant for the secondary (visibly-broken) count. */
  compact?: boolean;
}

export function DoorCount({ value, onChange, label, tone = 'default', uxKey, compact }: DoorCountProps) {
  const btn =
    'min-h-[56px] min-w-[56px] flex-1 rounded-2xl bg-white/10 active:bg-white/20 ' +
    'flex items-center justify-center text-inkm-1 ' +
    (compact ? 'h-14' : 'h-20');
  return (
    <div data-ux-key={uxKey}>
      <p className="mb-3 text-sm font-semibold text-inkm-2">{label}</p>
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange((v) => Math.max(0, v - 1))}
          className={btn}
        >
          <Minus className={compact ? 'h-6 w-6' : 'h-8 w-8'} />
        </button>
        {compact ? (
          <span
            aria-live="polite"
            className={`w-20 text-center text-4xl font-bold ${
              tone === 'warn' && value > 0 ? 'text-amber-300' : 'text-inkm-1'
            }`}
            style={{ fontFamily: MONO, fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </span>
        ) : (
          <DoorTicker value={value} warn={tone === 'warn'} />
        )}
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange((v) => v + 1)}
          className={btn}
        >
          <Plus className={compact ? 'h-6 w-6' : 'h-8 w-8'} />
        </button>
      </div>
    </div>
  );
}

export default DoorCount;
