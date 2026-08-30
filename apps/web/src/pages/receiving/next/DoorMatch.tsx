/**
 * DoorMatch — the PO match, live as the count is entered (spec point 1).
 *
 * "14 of 16 — two short", said in WORDS while the driver is still standing
 * there, because the door is the only moment a short ship is cheap to
 * resolve; today it becomes an email three days later.
 *
 * Two rules:
 * - the delta is stated, never colour alone (colour only underlines it);
 * - when the order cannot be reached, or its unit is bottles while the door
 *   counts boxes, the line says THAT — it degrades to a stated fact, it
 *   never fakes a delta.
 *
 * The line crossfades on `ink` (160ms, nothing travels more than 2px) when
 * its words change; reduced motion collapses the fade.
 */

import { useEffect, useRef } from 'react';
import { animate, ink } from '@/lib/mudavym';
import { SERIF, type MatchLine } from './DoorModel';

export interface DoorMatchProps {
  match: MatchLine | null;
  /** True when the order fetch failed — the honest degradation line. */
  orderUnreachable: boolean;
}

const TONE_CLASS: Record<NonNullable<MatchLine['tone']>, string> = {
  even: 'text-seal',
  short: 'text-amber-300',
  over: 'text-amber-300',
  incomparable: 'text-inkm-3',
};

export function DoorMatch({ match, orderUnreachable }: DoorMatchProps) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const lastText = useRef<string | null>(null);

  const text = orderUnreachable
    ? 'The order could not be reached — the count stands on its own.'
    : match?.text ?? null;

  useEffect(() => {
    if (!ref.current || text === null) return;
    if (lastText.current !== null && lastText.current !== text) {
      animate(ref.current, [{ opacity: 0.35 }, { opacity: 1 }], ink);
    }
    lastText.current = text;
  }, [text]);

  if (text === null) return null;

  const toneClass = orderUnreachable ? 'text-inkm-3' : TONE_CLASS[match?.tone ?? 'incomparable'];

  return (
    <p
      ref={ref}
      aria-live="polite"
      className={`mt-4 text-[17px] leading-snug ${toneClass}`}
      style={{ fontFamily: SERIF, fontStyle: 'italic' }}
      data-ux-key="door:match"
    >
      {text}
    </p>
  );
}

export default DoorMatch;
