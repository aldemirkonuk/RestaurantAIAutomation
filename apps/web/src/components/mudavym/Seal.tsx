/**
 * The Mudavym seal — the approval die from sketch 087 `sig-hero.html`:
 * a scalloped wax blob carrying the brand mark above a double rule.
 *
 * This is the seal-as-interaction-object of ADR 0042 (the hold-to-approve
 * gesture completes into it). The die face is the **trued A+M interlock**
 * (ADR 0047, the founder's own trace; supersedes 0045's Rivet M) — the nine
 * straight-cut polygons scaled onto sig-hero's proven wax/rule composition,
 * etched: ground colour only, monochrome per 0047. The four counter ticks
 * are deliberately absent: 0047 says they read from 32px, and the die face
 * never reaches that at any Seal size — a physical die is one object, so it
 * is a reduced cut everywhere rather than size-conditional artwork.
 * Verified on a rendered sheet at 18/34/48/96px, both grounds, against the
 * full-tick and no-rule variants before choosing this cut.
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

/**
 * The A+M interlock's nine structural polygons — verbatim from ADR 0047's
 * 483×574 grid, sans the four counter ticks (see the die-cut note above).
 */
const AM_DIE_PATHS = [
  'M0 38H72V540H0Z',
  'M15 38H96L460 574H379Z',
  'M0 346H305L353 416H0Z',
  'M0 470H137V540H0Z',
  'M99 0H151L278.7 187.8L284.8 273Z',
  'M389.5 40H460.9L284.8 273L251.4 224Z',
  'M412 40H483V574H412Z',
];

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
        {/* die face: the A+M interlock scaled onto the wax, above the rule */}
        <g transform="translate(50 47) scale(0.0592) translate(-241.5 -287)">
          <g fill={groundColor}>
            {AM_DIE_PATHS.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
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
