import { motion } from 'framer-motion'
import { cn } from '../../lib/utils'

export interface GuidanceStripProps {
  title: string
  body: string
  primaryLabel: string
  onPrimary: () => void
  onLater: () => void
  onDismissForever: () => void
  dismissForeverLabel: string
  ariaLabel: string
  'data-guidance': string
  bodyId?: string
  className?: string
}

const secondaryLink =
  'text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors'

const primaryLink =
  'text-xs font-semibold text-wine-700 hover:text-wine-800 transition-colors'

/**
 * Minimal guidance strip — Sketch G (accent rail).
 * Proactive CTAs get their own action row; login-style inline is for passive errors only.
 */
export function GuidanceStrip({
  title,
  body,
  primaryLabel,
  onPrimary,
  onLater,
  onDismissForever,
  dismissForeverLabel,
  ariaLabel,
  'data-guidance': dataGuidance,
  bodyId,
  className,
}: GuidanceStripProps) {
  return (
    <motion.div
      role="region"
      aria-label={ariaLabel}
      aria-live="polite"
      data-guidance={dataGuidance}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'mx-3 sm:mx-4 mt-2 rounded-lg border border-gray-100 bg-white',
        'border-l-[3px] border-l-wine-600 pl-3 pr-3 py-2',
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 leading-snug">{title}</p>
        <p id={bodyId} className="text-[13px] text-gray-500 leading-snug mt-0.5 line-clamp-2">
          {body}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0 sm:justify-end">
        <button
          type="button"
          aria-describedby={bodyId}
          onClick={onPrimary}
          className={primaryLink}
        >
          {primaryLabel}
        </button>
        <button type="button" aria-describedby={bodyId} onClick={onLater} className={secondaryLink}>
          Later
        </button>
        <button
          type="button"
          aria-describedby={bodyId}
          onClick={onDismissForever}
          className={secondaryLink}
        >
          {dismissForeverLabel}
        </button>
      </div>
    </motion.div>
  )
}
