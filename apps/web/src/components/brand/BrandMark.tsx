import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /**
   * Height of the mark in px. In 'lockup' the wordmark's rendered width is
   * roughly 4× this value plus the mark; 'mark' renders square. Default 32.
   */
  size?: number
  /**
   * 'lockup'   — Rivet M beside the "Mudavym" wordmark (default; sidebar, auth).
   * 'wordmark' — the name alone, no mark.
   * 'mark'     — the Rivet M alone, for tight square slots (collapsed rail,
   *              compact headers). Replaces the interim "M." glyph.
   */
  variant?: 'lockup' | 'wordmark' | 'mark'
  /** 'ink' (default) or 'seal' — İznik-coloured wordmark text. */
  tone?: 'ink' | 'seal'
  /**
   * Mark colouring. 'color' is brass + paprika — the mark keeps its own
   * colours as a founder-granted exception to the İznik palette (OD-111
   * verdict; ADR 0045 pending). 'mono' inherits currentColor for etched /
   * constrained contexts, per the Mark canvas rules.
   */
  mark?: 'color' | 'mono'
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/** Rivet M geometry — verbatim from the "Mudavym Mark" canvas, draft 01. */
const RIVET_PATH = 'M22,76 L22,24 L50,54 L78,24 L78,76'
const BRASS = '#C79A3D'
const PAPRIKA = '#B23B2A'
const INK = '#17130F'

function RivetM({ size, mono }: { size: number; mono: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="flex-shrink-0 select-none"
    >
      <path
        d={RIVET_PATH}
        fill="none"
        stroke={mono ? 'currentColor' : BRASS}
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {mono ? (
        // washer rivet: ring only, reads at 16px where a filled dot muddies
        <path
          fillRule="evenodd"
          fill="currentColor"
          d="M59,54 A9,9 0 1,0 41,54 A9,9 0 1,0 59,54 M55,54 A5,5 0 1,0 45,54 A5,5 0 1,0 55,54"
        />
      ) : (
        <circle cx="50" cy="54" r="9" fill={PAPRIKA} stroke={INK} strokeWidth="2.5" />
      )}
    </svg>
  )
}

/**
 * Mudavym mark — the Rivet M (two strokes meeting at one rivet) beside the
 * Fraunces wordmark. The mark carries its own brass/paprika as a deliberate
 * exception beside the İznik UI palette; the wordmark stays on brand ink/seal.
 * Clearspace equals the rivet's diameter; below 16px use variant 'mark' with
 * mark='mono'.
 */
export function BrandMark({
  size = 32,
  variant = 'lockup',
  tone = 'ink',
  mark = 'color',
  className,
  alt = 'Mudavym',
}: BrandMarkProps) {
  const toneClass =
    tone === 'seal'
      ? 'text-wine-600 dark:text-wine-400'
      : 'text-[#211C16] dark:text-[#EFE7D9]'

  if (variant === 'mark') {
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn('inline-flex select-none', toneClass, className)}
      >
        <RivetM size={size} mono={mark === 'mono'} />
      </span>
    )
  }

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn(
        'inline-flex select-none items-center whitespace-nowrap font-brand font-semibold leading-none',
        toneClass,
        className,
      )}
      style={{ fontSize: size, letterSpacing: '-0.02em', gap: Math.round(size * 0.28) }}
    >
      {variant === 'lockup' && <RivetM size={Math.round(size * 1.05)} mono={mark === 'mono'} />}
      Mudavym
    </span>
  )
}
