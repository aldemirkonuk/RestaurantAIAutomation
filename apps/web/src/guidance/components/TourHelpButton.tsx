import { HelpCircle } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { resolveGuidancePageId } from '../types'
import { cn } from '../../lib/utils'

export function TourHelpButton({ className }: { className?: string }) {
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
      className={cn(
        'inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg',
        'text-gray-500 hover:text-[#B8323A] hover:bg-[#B8323A]/10 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8323A] focus-visible:ring-offset-2',
        className,
      )}
    >
      <HelpCircle className="w-4 h-4" aria-hidden="true" />
    </button>
  )
}
