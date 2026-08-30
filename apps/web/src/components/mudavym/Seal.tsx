/**
 * The Mudavym seal — the approval die from sketch 087 `sig-hero.html`:
 * a scalloped wax blob carrying the brand mark above a double rule.
 *
 * This is the seal-as-interaction-object of ADR 0042 (the hold-to-approve
 * gesture completes into it). The die face is the **Rivet M** (OD-111
 * resolved, ADR 0045) — geometry verbatim from the Mark canvas, scaled onto
 * sig-hero's proven wax/rule composition. Inside wax the mark takes the
 * canvas's etched/mono treatment: ground colour only, never brass — the
 * brass/paprika exception applies to the mark on a page ground, not to an
 * impression. The rivet is a filled ground-colour dot (the die's dimple);
 * below ~24px it fades out gracefully while the M still reads.
 *
 * Colour: the wax is `currentColor`, İznik by default (`--seal`, with the
 * light-column fallback so it renders correctly outside a `.mudavym` scope).
 * Pass `color="currentColor"` to inherit from the parent instead.
 *
 * `pressed`: the die pressed INTO the wax — the mark becomes ground-coloured
 * shadow (`--paper-0` at 62% opacity, sig-hero's value) rather than more wax.
 * Un-pressed, the mark is a crisp full-opacity ground-colour print.
 */

import { SVGProps } from 'react';

export interface SealProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  /** Rendered size in px. Designed range 16–96. Default 48. */
  size?: number;
  /** Mark as ground-coloured shadow (pressed into the wax). Default false. */
  pressed?: boolean;
  /** Wax colour. Default İznik seal token. */
  color?: string;
  /** Accessible name. Omit (default) to render decorative (aria-hidden). */
  title?: string;
}

/** Scalloped wax outline — verbatim from sig-hero. */
const WAX_PATH =
  'M50 6c9 0 14 6 22 8s16-2 21 5-1 15 1 23 8 13 5 21-13 8-18 14-6 15-14 17-14-4-22-4-14 6-22 4-9-11-14-17-15-6-18-14 3-13 5-21-3-16 1-23 13-3 21-5S41 6 50 6z';

/** Rivet M — verbatim from the Mark canvas draft 01 (ADR 0045). */
const RIVET_PATH = 'M22,76 L22,24 L50,54 L78,24 L78,76';

export function Seal({
  size = 48,
  pressed = false,
  color = 'var(--seal, #1A5E6B)',
  title,
  style,
  ...rest
}: SealProps) {
  const groundColor = 'var(--paper-0, #FAF7F1)';
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ color, display: 'block', ...style }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path fill="currentColor" d={WAX_PATH} />
      <g opacity={pressed ? 0.62 : 1}>
        {/* die face: Rivet M scaled onto the wax, above the double rule */}
        <g transform="translate(50 48) scale(0.44) translate(-50 -50)">
          <path
            d={RIVET_PATH}
            fill="none"
            stroke={groundColor}
            strokeWidth={13}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* the rivet: wax showing through the etched M — a ground-coloured
              dot would vanish into the ground-coloured strokes */}
          <circle cx="50" cy="54" r="9" fill="currentColor" />
        </g>
        <g fill="none" stroke={groundColor} strokeWidth={4.4} strokeLinecap="square">
          <path d="M30 71h40" />
          <path d="M30 77h40" strokeWidth={2.6} />
        </g>
      </g>
    </svg>
  );
}

export default Seal;
