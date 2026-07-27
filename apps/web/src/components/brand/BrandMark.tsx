import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /** Pixel size of the circular mark. Default 32. */
  size?: number
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/**
 * Canonical WineOps mark — brand red (#9E4249) + white line-art glass.
 * Inline SVG so chrome never depends on a failed /logo.png load.
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
        strokeWidth="2.25"
        strokeLinejoin="round"
      />
      {/* Wine fill suggestion */}
      <path
        d="M24.5 26.5c1.2 5.2 4.2 9.2 7.5 10.8 3.3-1.6 6.3-5.6 7.5-10.8"
        fill="none"
        stroke="#fff"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      {/* Stem */}
      <path d="M32 34.5V46" fill="none" stroke="#fff" strokeWidth="2.25" strokeLinecap="round" />
      {/* Base */}
      <path
        d="M23 50.5c3.2 2.2 6.5 3.2 9 3.2s5.8-1 9-3.2"
        fill="none"
        stroke="#fff"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
    </svg>
  )
}
