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
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-lg',
        'text-gray-500 hover:text-[#722F37] hover:bg-[#722F37]/10 transition-colors',
        className,
      )}
    >
      <HelpCircle className="w-4 h-4" />
    </button>
  )
}
