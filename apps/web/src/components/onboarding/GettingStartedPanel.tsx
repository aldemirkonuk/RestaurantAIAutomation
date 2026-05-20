import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { OnboardingProgress } from '../../services/api/menus'
import type { RefObject } from 'react'

interface GettingStartedPanelProps {
  progress: OnboardingProgress
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onDismiss: () => void
}

export function GettingStartedPanel({ progress, anchorRef, onClose, onDismiss }: GettingStartedPanelProps) {
  const navigate = useNavigate()

  const tasks = [
    {
      id: 'account',
      label: 'Create your account',
      done: true,
      cta: null,
    },
    {
      id: 'menu',
      label: 'Upload your wine menu',
      done: progress.menu_uploaded,
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
      done: progress.vendor_added,
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
      done: progress.team_member_invited,
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
  const top = rect ? rect.top : 0
  const left = rect ? rect.right + 8 : 0

  return createPortal(
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      style={{ top, left }}
      className="fixed w-64 bg-white rounded-2xl shadow-xl border-l-4 border-[#722F37] z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-100">
        <div>
          <h3 className="font-semibold text-gray-900 text-sm">Get started</h3>
          <p className="text-xs text-gray-400">{completedCount}/4 complete</p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close panel"
          className="text-gray-400 hover:text-gray-600 p-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tasks */}
      <div className="p-3 space-y-1">
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
                  className="text-xs text-[#722F37] hover:text-[#8B3A44] font-medium mt-0.5 transition-colors"
                >
                  {task.cta.label} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Dismiss */}
      <div className="p-3 pt-0">
        <button
          onClick={onDismiss}
          className="w-full text-xs text-gray-400 hover:text-gray-500 py-2 transition-colors"
        >
          Don't show again
        </button>
      </div>
    </motion.div>,
    document.body,
  )
}
