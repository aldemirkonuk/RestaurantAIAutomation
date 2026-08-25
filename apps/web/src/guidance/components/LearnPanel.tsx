import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  X,
  CheckCircle2,
  Circle,
  Play,
  Shield,
  Bot,
  RotateCcw,
} from 'lucide-react'
import type { RefObject } from 'react'
import type { OnboardingProgress } from '../../services/api/menus'
import { cn } from '../../lib/utils'
import { useGuidanceOptional } from '../GuidanceProvider'
import { PAGE_TOUR_IDS, PAGE_TOUR_ROUTES, type PageTourId } from '../types'
import { TOUR_LABELS } from '../tours/registry'
import { trackGuidance } from '../analytics'

interface LearnPanelProps {
  progress: OnboardingProgress | null
  mode: 'get-started' | 'learn'
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onDismissChecklist?: () => void
}

export function LearnPanel({
  progress,
  mode,
  anchorRef,
  onClose,
  onDismissChecklist,
}: LearnPanelProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const guidance = useGuidanceOptional()

  // Modal-scoped tours (e.g. `orders-create`) have no independently
  // navigable route, so they can't be replayed from this generic list.
  const replayableTourIds = PAGE_TOUR_IDS.filter((id) => id in PAGE_TOUR_ROUTES)

  const startPageTour = (id: PageTourId) => {
    const route = PAGE_TOUR_ROUTES[id]
    const isAlreadyThere =
      !route ||
      route === location.pathname ||
      route === `${location.pathname}${location.search}`
    if (route && !isAlreadyThere) {
      navigate(route)
      // Let the target page mount before driver.js looks for its anchors.
      setTimeout(() => guidance?.startTour(id), 300)
    } else {
      guidance?.startTour(id)
    }
    onClose()
  }

  const tasks = [
    {
      id: 'account',
      label: 'Create your account',
      done: true,
      cta: null as null | { label: string; onClick: () => void },
    },
    {
      id: 'menu',
      label: 'Upload your wine menu',
      done: !!progress?.menu_uploaded,
      cta: {
        label: 'Upload Now',
        onClick: () => {
          navigate('/get-started')
          onClose()
        },
      },
    },
    {
      id: 'vendor',
      label: 'Add your first vendor',
      done: !!progress?.vendor_added,
      cta: {
        label: 'Browse Vendors',
        onClick: () => {
          navigate('/providers')
          onClose()
        },
      },
    },
    {
      id: 'team',
      label: 'Invite a team member',
      done: !!progress?.team_member_invited,
      cta: {
        label: 'Send Invite',
        onClick: () => {
          navigate('/settings?tab=team')
          onClose()
        },
      },
    },
  ]

  const completedCount = tasks.filter((t) => t.done).length
  const rect = anchorRef.current?.getBoundingClientRect()
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 768
  const top = rect ? Math.min(rect.top, window.innerHeight - 420) : 80
  const left = rect ? rect.right + 8 : 260

  return createPortal(
    <motion.div
      initial={isNarrow ? { opacity: 0, y: 24 } : { opacity: 0, x: -20 }}
      animate={isNarrow ? { opacity: 1, y: 0 } : { opacity: 1, x: 0 }}
      exit={isNarrow ? { opacity: 0, y: 24 } : { opacity: 0, x: -20 }}
      style={
        isNarrow
          ? undefined
          : { top, left }
      }
      className={cn(
        'fixed z-[60] bg-white shadow-xl border-l-4 border-[#9E4249] overflow-hidden flex flex-col',
        isNarrow
          ? 'inset-x-3 bottom-3 max-h-[min(75vh,560px)] w-auto rounded-2xl mb-safe'
          : 'w-72 max-h-[min(80vh,560px)] rounded-2xl',
      )}
      role="dialog"
      aria-label={mode === 'learn' ? 'Learn & Help' : 'Get started'}
    >
      <div className="flex items-center justify-between p-4 border-b border-gray-100 flex-shrink-0">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">
            {mode === 'learn' ? 'Learn & Help' : 'Get started'}
          </h3>
          <p className="text-xs text-gray-400">
            {mode === 'get-started'
              ? `${completedCount}/4 complete`
              : 'Replay tours & recover tips'}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto p-3 space-y-4">
        {mode === 'get-started' && (
          <div className="space-y-1">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {task.done ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      task.done ? 'text-gray-400 line-through' : 'text-gray-700',
                    )}
                  >
                    {task.label}
                  </p>
                  {!task.done && task.cta && (
                    <button
                      onClick={task.cta.onClick}
                      className="text-xs text-[#9E4249] hover:text-[#B85055] font-medium mt-0.5"
                    >
                      {task.cta.label} →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Page tours
          </p>
          <div className="space-y-0.5">
            {replayableTourIds.map((id: PageTourId) => {
              const status = guidance?.state.pages[id]?.tour
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => startPageTour(id)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left"
                >
                  <Play className="w-3.5 h-3.5 text-[#9E4249]" />
                  <span className="text-sm text-gray-700 flex-1">
                    {TOUR_LABELS[id]}
                  </span>
                  {status === 'completed' && (
                    <span className="text-[10px] text-green-600">Done</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-0.5">
          <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            More
          </p>
          <button
            type="button"
            onClick={() => {
              navigate('/get-started?tab=use')
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
          >
            App usage guide
          </button>
          <button
            type="button"
            onClick={() => {
              // /wineagent is still a placeholder (App.tsx) — Sommelier AI
              // is the real inventory & ordering help surface today.
              navigate('/sommelier')
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
          >
            <Bot className="w-3.5 h-3.5" />
            Wine Agent
          </button>
          <button
            type="button"
            onClick={() => {
              trackGuidance('services_visited', { source: 'learn' })
              navigate('/settings?tab=services')
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
          >
            <Shield className="w-3.5 h-3.5" />
            Services & permissions
          </button>
          {guidance && (
            <>
              <button
                type="button"
                onClick={() => guidance.resetTips()}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset page tips
              </button>
              <button
                type="button"
                onClick={() =>
                  guidance.setShowWineAgentFab(
                    !guidance.state.global.show_wine_agent_fab,
                  )
                }
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
              >
                {guidance.state.global.show_wine_agent_fab
                  ? 'Hide Wine Agent button'
                  : 'Show Wine Agent button'}
              </button>
            </>
          )}
        </div>
      </div>

      {mode === 'get-started' && onDismissChecklist && (
        <div className="p-3 pt-0 border-t border-gray-50 flex-shrink-0">
          <button
            onClick={onDismissChecklist}
            className="w-full text-xs text-gray-400 hover:text-gray-500 py-2 transition-colors"
          >
            Don&apos;t show again
          </button>
        </div>
      )}
    </motion.div>,
    document.body,
  )
}

/** @deprecated Prefer LearnPanel — kept for import compatibility */
export { LearnPanel as GettingStartedPanel }
