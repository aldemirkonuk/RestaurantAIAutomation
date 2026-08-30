/**
 * The Mudavym wordmark — "Mudavym." with the full stop in seal colour.
 *
 * The final mark exists now: the Rivet M (OD-111 resolved, ADR 0045), served
 * app-shell-wide by `components/brand/BrandMark` (lockup/wordmark/mark
 * variants, ground-aware brass). This component stays deliberately separate:
 * it is the in-page *typographic* signature — Fraunces 600 (the founder's
 * direct pick) with the İznik full stop — used at 13–14px inside rebuilt
 * pages, below the mark's own clearspace floor where a lockup would smudge.
 * Where a page wants mark + name, compose `BrandMark` instead.
 * Colour per ADR 0042 — İznik `--seal` for the stop, `--ink-1` for the name;
 * fallback values are the light column, so the wordmark is correct even
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
    fontFamily: 'Fraunces, Georgia, serif',
    fontWeight: 600,
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
