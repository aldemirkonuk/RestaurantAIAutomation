import { HelpCircle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { resolveGuidancePageId } from '../types'
import { cn } from '../../lib/utils'

type TourHelpButtonVariant = 'header' | 'toolbar' | 'dark'

const variantClass: Record<TourHelpButtonVariant, string> = {
  header:
    'p-2.5 rounded-xl text-gray-600 hover:bg-gray-100 hover:text-wine-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600 focus-visible:ring-offset-2',
  toolbar:
    'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-gray-500 hover:text-[#B8323A] hover:bg-[#B8323A]/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8323A] focus-visible:ring-offset-2',
  dark:
    'p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#212121]',
}

const iconClass: Record<TourHelpButtonVariant, string> = {
  header: 'w-5 h-5',
  toolbar: 'w-4 h-4',
  dark: 'w-5 h-5',
}

export function TourHelpButton({
  className,
  variant = 'header',
}: {
  className?: string
  variant?: TourHelpButtonVariant
}) {
  const location = useLocation()
  const guidance = useGuidanceOptional()
  const pageId = resolveGuidancePageId(location.pathname, location.search)

  if (!guidance || !pageId) return null

  return (
    <button
      type="button"
      onClick={() => guidance.startTour(pageId)}
      aria-label="Replay page tour"
      title="Replay page tour"
      data-guidance="tour-help"
      className={cn(variantClass[variant], className)}
    >
      <HelpCircle className={iconClass[variant]} aria-hidden="true" />
    </button>
  )
}
