import { X } from 'lucide-react'
import { usePageGuidance } from '../usePageGuidance'
import { cn } from '../../lib/utils'

export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  return (
    <div
      role="region"
      aria-label="Page tip"
      data-guidance="tip-strip"
      className={cn(
        'mx-3 sm:mx-4 mt-3 mb-2 rounded-xl border border-[#722F37]/20 bg-[#722F37]/[0.04] px-3 sm:px-4 py-3',
        'flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="min-w-0 pr-2">
        <p className="text-sm font-semibold text-gray-900">{tipDef.title}</p>
        <p className="text-sm text-gray-600 mt-0.5">{tipDef.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => guidance.completeTipViaTour(pageId)}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg bg-[#722F37] text-white hover:bg-[#8B3A44] transition-colors"
        >
          Take tour
        </button>
        <button
          type="button"
          onClick={() => guidance.snoozeTip(pageId)}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => guidance.dismissTip(pageId)}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-500 hover:bg-gray-100 transition-colors hidden sm:inline-flex"
        >
          Don&apos;t show again
        </button>
        <button
          type="button"
          aria-label="Dismiss tip"
          onClick={() => guidance.dismissTip(pageId)}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
