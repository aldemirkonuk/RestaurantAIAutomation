import { cn } from '../../lib/utils'

interface BrandMarkProps {
  /** Pixel size of the circular mark. Default 32. */
  size?: number
  className?: string
  /** Accessible label; empty string marks decorative. */
  alt?: string
}

/**
 * Canonical WineOps app mark — burgundy circle + white line-art wine glass
 * (see /public/logo.png, /icon-192.png). Prefer this over Lucide `Wine` for
 * product chrome so the UI matches the PWA / home-screen icon.
 */
export function BrandMark({ size = 32, className, alt = 'WineOps' }: BrandMarkProps) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt={alt}
      draggable={false}
      className={cn('rounded-full object-contain flex-shrink-0 select-none', className)}
    />
  )
}
