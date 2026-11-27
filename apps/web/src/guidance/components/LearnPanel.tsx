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

/**
 * Mail setup, in the Mail tab: both Gmail permissions and the reading switch
 * are there, and Google's permission returns to it. A gateway or page that
 * has no Mail tab yet opens /communications as before.
 */
const MAIL_SETUP = '/communications?tab=mail&setup=1'

interface LearnPanelProps {
  progress: OnboardingProgress | null
  mode: 'get-started' | 'learn'
  anchorRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onDismissChecklist?: () => void
  /**
   * Learn & Help only: show the steps to the house's costs while one is not
   * done. The Sidebar passes it for an owner or a manager, never for staff
   * (they cannot check invoices or connect the house's mail).
   */
  showNextSteps?: boolean
}

export function LearnPanel({
  progress,
  mode,
  anchorRef,
  onClose,
  onDismissChecklist,
  showNextSteps = false,
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
    // Done = a CURRENT menu (OB-1: a read menu kept as a draft gives no
    // stock and no prices). A read-but-not-current menu names that step and
    // leads to /menu, where an owner or a manager chooses the current menu.
    progress?.menu_uploaded && !progress?.menu_current
      ? {
          id: 'menu',
          label: 'Make your menu the current one',
          done: false,
          cta: {
            label: 'Choose it',
            onClick: () => {
              navigate('/menu')
              onClose()
            },
          },
        }
      : {
          id: 'menu',
          label: 'Read your menu',
          done: !!progress?.menu_current,
          cta: {
            label: 'Read it now',
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
          navigate('/vendors')
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

  // After the menu (r28 onboarding gap 3): the steps that lead to the
  // house's costs. Read from the house (next_steps); none of them is part of
  // setup, so they are not in the count above. `null` = that read failed: the
  // step is said as not read, never ticked and never called not done.
  const next = progress?.next_steps
  const go = (path: string) => () => {
    navigate(path)
    onClose()
  }
  // The count step (r36 onboarding gap 1). Making the first menu current
  // puts every drink on the list at stock 0 with nobody having counted it,
  // so "on the list" is not "counted": the step ticks on goods_counted. An
  // older gateway sends no goods_counted; then the step names what it can
  // read (on the list), never "counted".
  const counted = next?.goods_counted
  const goodsStep =
    counted === undefined
      ? {
          label: 'Put your first goods on the list',
          why: 'Stock, and what runs low, are read from it.',
          fact: next?.goods_listed ?? null,
        }
      : next?.goods_listed === true && counted !== true
        ? {
            label: 'Count the goods on your list',
            why: 'Your menu put them on the list. Until one is counted, its stock is not known.',
            fact: counted,
          }
        : {
            label: 'Count your first goods',
            why: 'Stock, and what runs low, are read from the count.',
            fact: counted,
          }
  // The mailbox step (r36 mail gap 4, onboarding gap 2). Orders never leave
  // from the house's mailbox: they leave from Mudavym's, in the house's name.
  // What the house's own Gmail does is two things, each with its own grant:
  // a letter written in Mail leaves from it (sending), and what the house's
  // vendors send to it comes into Mail (reading, which also needs the
  // house's switch). The founder's condition for the send grant is the whole
  // conversation here, so the step is done when both hold, and an open step
  // names the half that is missing. It leads to Mail setup, where both
  // grants and the switch are, and where Google's permission returns to.
  // An older gateway sends no reading fact: the step then says only what
  // sending does and ticks on it, as before.
  const sends =
    next?.mailbox_sends === undefined ? (next?.mailbox_connected ?? null) : next.mailbox_sends
  const reads = next?.mailbox_reads
  const mailStep: { label: string; why: string; done: boolean; unread: boolean } =
    reads === undefined
      ? {
          label: "Connect the house's Gmail",
          why: "Letters you write to vendors in Mail leave from the house's own address.",
          done: sends === true,
          unread: sends === null,
        }
      : sends === true && reads === true
        ? { label: "Connect the house's Gmail", why: '', done: true, unread: false }
        : sends === null || reads === null
          ? { label: "Connect the house's Gmail", why: '', done: false, unread: true }
          : sends === true
            ? {
                label: "Let Mail read the house's Gmail",
                why: "Letters you write in Mail leave from the house's address, but what vendors send to it is not read yet, so their answers do not come into Mail.",
                done: false,
                unread: false,
              }
            : reads === true
              ? {
                  label: "Let letters leave from the house's Gmail",
                  why: "What your vendors send to the house's address comes into Mail, but a letter you write there cannot leave from it yet.",
                  done: false,
                  unread: false,
                }
              : {
                  label: "Connect the house's Gmail",
                  why: "Then letters you write to vendors in Mail leave from the house's address, and what they send to it comes into Mail.",
                  done: false,
                  unread: false,
                }
  const nextSteps: Array<{
    id: string
    label: string
    why: string
    done: boolean
    unread: boolean
    cta: { label: string; onClick: () => void }
  }> = next
    ? [
        {
          id: 'goods',
          label: goodsStep.label,
          why: goodsStep.why,
          done: goodsStep.fact === true,
          unread: goodsStep.fact === null,
          cta: { label: 'Count the first goods', onClick: go('/inventory') },
        },
        {
          id: 'mailbox',
          ...mailStep,
          cta: { label: 'Set it up', onClick: go(MAIL_SETUP) },
        },
        // r36 onboarding gap 6: with no money set, an invoice that names none
        // and comes with no order puts no cost on. Shown only when the house
        // answered that it states none (never on a failed read or an older
        // gateway), and before the invoice it holds up.
        ...(next.money_set === false
          ? [
              {
                id: 'money',
                label: "Set the house's money",
                why: 'An invoice that names no money waits for it before its costs go on.',
                done: false,
                unread: false,
                cta: { label: 'Set it', onClick: go('/settings?tab=currency') },
              },
            ]
          : []),
        {
          id: 'invoice',
          label: next.invoice === 'waiting' ? 'Check the invoice that came in' : 'Check your first invoice',
          why: 'Costs come from the invoices you check.',
          done: next.invoice === 'checked',
          unread: next.invoice === null,
          cta: {
            label: next.invoice === 'waiting' ? 'Check it' : 'Open Receipts',
            onClick: go('/receipts'),
          },
        },
      ]
    : []
  // After setup (r32): once the menu, a vendor and an invite are in, or the
  // checklist is put away, the panel is Learn & Help, and the steps to the
  // costs used to go with the checklist. An owner or a manager keeps them
  // there until each is done.
  const nextStepsShown =
    mode === 'get-started'
      ? nextSteps.length > 0
      : showNextSteps && nextSteps.some((step) => !step.done)
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
        'fixed z-[60] bg-white shadow-xl border-l-4 border-[#1A5E6B] overflow-hidden flex flex-col',
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
              ? `${completedCount}/${tasks.length} complete`
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
                      className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium mt-0.5"
                    >
                      {task.cta.label} →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {nextStepsShown && (
          <div className="space-y-1" data-testid="setup-next-steps">
            <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {mode === 'get-started' ? 'Then, to see your costs' : 'To see your costs'}
            </p>
            {nextSteps.map((step) => (
              <div
                key={step.id}
                data-step={step.id}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {step.done ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" aria-label="Done" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" aria-hidden />
                )}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      step.done ? 'text-gray-400 line-through' : 'text-gray-700',
                    )}
                  >
                    {step.label}
                  </p>
                  {!step.done && (
                    <>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {step.unread ? 'Not read just now, so not shown as done or not done.' : step.why}
                      </p>
                      <button
                        onClick={step.cta.onClick}
                        className="text-xs text-[#1A5E6B] hover:text-[#14515C] font-medium mt-0.5"
                      >
                        {step.cta.label} →
                      </button>
                    </>
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
                  <Play className="w-3.5 h-3.5 text-[#1A5E6B]" />
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
              // /get-started is the owner's first-house form, not a guide:
              // the guides are on /help ("How this works").
              navigate('/help')
              onClose()
            }}
            className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 text-left text-sm text-gray-700"
          >
            App usage guide
          </button>
          <button
            type="button"
            onClick={() => {
              // Sommelier AI is the inventory & ordering help surface. The old
              // `/wineagent` placeholder route is retired (ADR 0019 §B).
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
