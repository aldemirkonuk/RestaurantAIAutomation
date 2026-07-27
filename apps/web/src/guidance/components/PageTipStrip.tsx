import { X } from 'lucide-react'
import { usePageGuidance } from '../usePageGuidance'
import { cn } from '../../lib/utils'

const tipButtonFocus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#96404E] focus-visible:ring-offset-2'

export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  const bodyId = `page-tip-body-${pageId}`

  return (
    <div
      role="region"
      aria-label="Page tip"
      aria-live="polite"
      data-guidance="tip-strip"
      className={cn(
        'mx-3 sm:mx-4 mt-3 mb-2 rounded-xl border border-[#96404E]/20 bg-[#96404E]/[0.04] px-3 sm:px-4 py-3',
        'flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 pr-2">
        <p className="text-sm font-semibold text-gray-900">{tipDef.title}</p>
        <p id={bodyId} className="text-sm text-gray-600 mt-0.5">
          {tipDef.body}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <button
          type="button"
          aria-describedby={bodyId}
          onClick={() => guidance.completeTipViaTour(pageId)}
          className={cn(
            'min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg bg-[#96404E] text-white hover:bg-[#B04A58] transition-colors',
            tipButtonFocus,
          )}
        >
          Take tour
        </button>
        <button
          type="button"
          aria-describedby={bodyId}
          onClick={() => guidance.snoozeTip(pageId)}
          className={cn(
            'min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors',
            tipButtonFocus,
          )}
        >
          Later
        </button>
        <button
          type="button"
          aria-describedby={bodyId}
          onClick={() => guidance.dismissTip(pageId)}
          className={cn(
            'min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-500 hover:bg-gray-100 transition-colors hidden sm:inline-flex',
            tipButtonFocus,
          )}
        >
          Don&apos;t show again
        </button>
        <button
          type="button"
          aria-label="Dismiss tip"
          onClick={() => guidance.dismissTip(pageId)}
          className={cn(
            'min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-600 hover:text-gray-800 rounded-lg',
            tipButtonFocus,
          )}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
