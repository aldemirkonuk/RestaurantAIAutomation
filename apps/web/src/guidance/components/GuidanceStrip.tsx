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

const secondaryAction =
  'text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600/30 focus-visible:ring-offset-2 rounded-md'

const primaryAction =
  'text-xs font-semibold text-wine-700 hover:text-wine-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600/30 focus-visible:ring-offset-2 rounded-md'

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
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'mx-3 sm:mx-4 mt-2 rounded-2xl border border-[#96404E]/12 bg-white/92 px-3.5 py-2.5 shadow-[0_1px_0_rgba(148,64,78,0.04)] backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-wine-500/80"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 text-gray-700">
            <span className="font-semibold text-gray-900">{title}</span>
            <span className="text-gray-500"> {body}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              aria-describedby={bodyId}
              onClick={onPrimary}
              className={primaryAction}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              aria-describedby={bodyId}
              onClick={onLater}
              className={secondaryAction}
            >
              Later
            </button>
            <button
              type="button"
              aria-describedby={bodyId}
              onClick={onDismissForever}
              className={secondaryAction}
            >
              {dismissForeverLabel}
            </button>
          </div>
          {bodyId ? <span id={bodyId} className="sr-only">{body}</span> : null}
        </div>
      </div>
    </motion.div>
  )
}
