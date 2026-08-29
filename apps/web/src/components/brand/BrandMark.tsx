import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /**
   * Font size of the mark in px. The wordmark's rendered width is roughly
   * 4× this value; the glyph is roughly 1.1× wide. Default 32.
   */
  size?: number
  /**
   * 'wordmark' — the full "Mudavym" name (default).
   * 'glyph' — "M." for tight square slots (collapsed rail, compact headers).
   */
  variant?: 'wordmark' | 'glyph'
  /** 'ink' (default) or 'seal' — İznik-coloured wordmark. */
  tone?: 'ink' | 'seal'
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/**
 * Mudavym mark — a text wordmark set in Fraunces (ADR 0042 / OD-106).
 * No icon, no glass, no circle: the name is the mark. Where a square slot is
 * unavoidable the glyph variant renders "M." with the full stop in İznik.
 */
export function BrandMark({
  size = 32,
  variant = 'wordmark',
  tone = 'ink',
  className,
  alt = 'Mudavym',
}: BrandMarkProps) {
  const toneClass =
    tone === 'seal'
      ? 'text-wine-600 dark:text-wine-400'
      : 'text-[#211C16] dark:text-[#EFE7D9]'

  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn(
        'inline-flex select-none items-baseline whitespace-nowrap font-brand font-semibold leading-none',
        toneClass,
        className,
      )}
      style={{ fontSize: size, letterSpacing: '-0.02em' }}
    >
      {variant === 'glyph' ? (
        <>
          M<span className="text-wine-600 dark:text-wine-400">.</span>
        </>
      ) : (
        'Mudavym'
      )}
    </span>
  )
}
