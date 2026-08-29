/**
 * The Mudavym wordmark — "Mudavym." with the full stop in seal colour.
 *
 * ADR 0043 (Withdrawal, 2026-08-30): the monogram is withdrawn and has no
 * vector source, so the brand ships wordmark-only. What survives from that
 * ADR and applies here: Plus Jakarta Sans, weight 800, tracking −0.02em
 * (already loaded app-wide via index.html / tailwind `font-display`), and the
 * ADR-0042 colour rules — İznik `--seal` for the stop, `--ink-1` for the name.
 * Fallback values are the light column, so the wordmark is correct even
 * outside a `.mudavym` token scope.
 */

import { CSSProperties } from 'react';

export interface WordmarkProps {
  /** Font size — number = px (default 20), or any CSS length string. */
  size?: number | string;
  className?: string;
  /**
   * Colour of the name itself (the stop is always seal-coloured).
   * Defaults to the Mudavym ink token; pass `"currentColor"` to inherit.
   */
  color?: string;
}

export function Wordmark({ size = 20, className, color }: WordmarkProps) {
  const style: CSSProperties = {
    fontFamily: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif',
    fontWeight: 800,
    letterSpacing: '-0.02em',
    fontSize: typeof size === 'number' ? `${size}px` : size,
    lineHeight: 1,
    color: color ?? 'var(--ink-1, #211C16)',
  };
  return (
    <span className={className} style={style} translate="no">
      Mudavym<span style={{ color: 'var(--seal, #1A5E6B)' }}>.</span>
    </span>
  );
}

export default Wordmark;
