import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { X, Rocket } from 'lucide-react'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { useAuth } from '../../contexts/AuthContext'

// Same hide-list as WineAgentFab — the nudge would be redundant on the flow
// that IS the setup, or on unauthenticated screens.
const HIDDEN_PATHS = ['/get-started', '/login', '/register', '/verify-email', '/onboarding']

/**
 * Finish-setup nudge: a dismissible, non-blocking banner reminding
 * owner/manager users to finish activation (menu + threshold) when they've
 * wandered off to the rest of the app. Escalating-backoff cadence lives in
 * `isSetupNudgeDue`; the sidebar "Get started" badge is the permanent
 * fallback once this banner is dismissed forever.
 */
export function SetupNudgeBanner() {
  const guidance = useGuidanceOptional()
  const { progress } = useOnboardingProgress()
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const canActivate = user?.role === 'owner' || user?.role === 'manager'
  const activationIncomplete = !!progress && !progress.activated
  const hiddenRoute = HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))

  const shouldShow =
    !!guidance &&
    canActivate &&
    activationIncomplete &&
    !hiddenRoute &&
    !guidance.setupNudgeDismissedThisSession &&
    guidance.isSetupNudgeDue

  useEffect(() => {
    if (shouldShow) guidance?.markSetupNudgeShown()
    // Only re-fire when visibility flips on — markSetupNudgeShown itself
    // updates guidance state, which must not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow])

  if (!shouldShow) return null

  return (
    <div
      role="region"
      aria-label="Finish setup"
      data-guidance="setup-nudge-banner"
      className="mx-3 sm:mx-4 mt-3 rounded-xl border border-[#9E4249]/20 bg-[#9E4249]/[0.04] px-3 sm:px-4 py-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-[#9E4249]/10 flex items-center justify-center flex-shrink-0">
          <Rocket className="w-4 h-4 text-[#9E4249]" />
        </div>
        <div className="min-w-0 pr-2">
          <p className="text-sm font-semibold text-gray-900">Finish setting up WineOps</p>
          <p className="text-sm text-gray-600 mt-0.5">
            Upload your wine list and set a low-stock threshold to unlock inventory and ordering.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={() => navigate('/get-started')}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg bg-[#9E4249] text-white hover:bg-[#B85055] transition-colors"
        >
          Finish setup
        </button>
        <button
          type="button"
          onClick={() => guidance?.snoozeSetupNudge()}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => guidance?.dismissSetupNudgeForever()}
          className="min-h-[44px] px-3 py-2 text-sm font-medium rounded-lg text-gray-500 hover:bg-gray-100 transition-colors hidden sm:inline-flex"
        >
          Don&apos;t remind me
        </button>
        <button
          type="button"
          aria-label="Dismiss for now"
          onClick={() => guidance?.snoozeSetupNudge()}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
