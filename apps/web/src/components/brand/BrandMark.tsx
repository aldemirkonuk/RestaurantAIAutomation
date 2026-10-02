import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /**
   * Height of the mark in px. In 'lockup' the wordmark's rendered width is
   * roughly 4× this value plus the mark; 'mark' renders at the interlock's
   * own 483:574 ratio. Default 32.
   */
  size?: number
  /**
   * 'lockup'   — A+M interlock beside the "Mudavym." wordmark (default).
   * 'wordmark' — the name alone, no mark.
   * 'mark'     — the interlock alone, for tight slots (collapsed rail,
   *              compact headers).
   */
  variant?: 'lockup' | 'wordmark' | 'mark'
  /**
   * 'ink' (default) or 'seal' — İznik-coloured wordmark text.
   * 'paper' — for a surface that stays light BY DECISION (`data-ground="paper"`,
   * the canonical sheet): colours come from that ground's tokens, never the
   * app theme's `dark:` classes, which would turn the wordmark near-white on a
   * light sheet whenever the person chose charcoal (walk-through RECEIPTS-W45).
   */
  tone?: 'ink' | 'seal' | 'paper'
  /**
   * Mark colouring. 'color' wears the İznik seal (ADR 0042 values, ground-
   * aware via the wine scale) — the mark is monochrome by design (ADR 0047;
   * supersedes 0045's brass/paprika exception). 'mono' inherits currentColor
   * for documents / etched / constrained contexts.
   */
  mark?: 'color' | 'mono'
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/**
 * The trued A+M interlock — the letterpress mark measured off the print and
 * redrawn as nine straight-cut polygons plus four counter ticks (ADR 0047,
 * founder's canvas 2026-08-30). Grid 483×574; one 34° rake; minimum 24px,
 * ticks read from 32px. Geometry verbatim from the sheet.
 */
const AM_PATHS = [
  'M0 38H72V540H0Z',
  'M15 38H96L460 574H379Z',
  'M0 346H305L353 416H0Z',
  'M0 470H137V540H0Z',
  'M99 0H151L278.7 187.8L284.8 273Z',
  'M389.5 40H460.9L284.8 273L251.4 224Z',
  'M412 40H483V574H412Z',
  // counter ticks — tally marks, visits counted
  'M80 150V192H108Z',
  'M142 346H206L174 292Z',
  'M404 138L376 157L404 176Z',
  'M383 430H404V470Z',
]

function AMInterlock({ size, mono, color }: { size: number; mono: boolean; color?: string }) {
  return (
    <svg
      width={Math.round((size * 483) / 574)}
      height={size}
      viewBox="0 0 483 574"
      aria-hidden="true"
      style={color ? { color } : undefined}
      className={cn(
        'flex-shrink-0 select-none',
        mono ? undefined : 'text-wine-600 dark:text-wine-400',
      )}
    >
      <g fill="currentColor">
        {AM_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  )
}

/**
 * Mudavym mark — the trued A+M interlock (Aldemir's house and the müdavim's
 * M sharing the same strokes) beside the Fraunces wordmark, whose full stop
 * wears the seal. Monochrome İznik per ADR 0047; clearspace one stem (72u)
 * on all sides; below 24px prefer variant 'wordmark' or the tile treatment.
 */
export function BrandMark({
  size = 32,
  variant = 'lockup',
  tone = 'ink',
  mark = 'color',
  className,
  alt = 'Mudavym',
}: BrandMarkProps) {
  const onPaper = tone === 'paper'
  const toneClass = onPaper
    ? undefined
    : tone === 'seal'
      ? 'text-wine-600 dark:text-wine-400'
      : 'text-[#211C16] dark:text-[#EFE7D9]'
  // The paper ground's own pair (styles/mudavym.css `[data-ground="paper"]`),
  // with the light values as fallbacks off that ground.
  const paperInk = 'var(--ink-1, #211C16)'
  const paperSeal = 'var(--seal, #1A5E6B)'
  const sealOnPaper = onPaper && mark === 'color' ? paperSeal : undefined

  if (variant === 'mark') {
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn('inline-flex select-none', toneClass, className)}
        style={onPaper ? { color: paperInk } : undefined}
      >
        <AMInterlock size={size} mono={mark === 'mono' || onPaper} color={sealOnPaper} />
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
      style={{
        fontSize: size,
        letterSpacing: '-0.02em',
        gap: Math.round(size * 0.32),
        ...(onPaper ? { color: paperInk } : null),
      }}
    >
      {variant === 'lockup' && (
        <AMInterlock size={Math.round(size * 1.15)} mono={mark === 'mono' || onPaper} color={sealOnPaper} />
      )}
      <span>
        Mudavym
        <span
          className={onPaper ? undefined : 'text-wine-600 dark:text-wine-400'}
          style={onPaper ? { color: paperSeal } : undefined}
        >
          .
        </span>
      </span>
    </span>
  )
}
