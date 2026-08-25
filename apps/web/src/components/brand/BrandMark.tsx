import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /** Pixel size of the circular mark. Default 32. */
  size?: number
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/**
 * WineOps mark — a single-weight wine glass line icon.
 * Bowl + stem + base only, so it reads unmistakably as "wine" while
 * staying legible at 24–32px sidebar sizes. The red circle showing
 * through the open bowl reads as wine in the glass.
 */
export function BrandMark({ size = 32, className, alt = 'WineOps' }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={alt ? 'img' : 'presentation'}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn('flex-shrink-0 select-none', className)}
    >
      <circle cx="32" cy="32" r="32" fill="#9E4249" />

      {/* Bowl */}
      <path
        d="M22 18h20c0 7.5-4.2 14-10 16.5C26.2 32 22 25.5 22 18Z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Stem */}
      <path d="M32 34.5V46" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      {/* Base */}
      <path
        d="M23 50.5c3.2 2.2 6.5 3.2 9 3.2s5.8-1 9-3.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
