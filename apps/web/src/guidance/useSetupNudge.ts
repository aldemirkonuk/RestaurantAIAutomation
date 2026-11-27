import { useLocation } from 'react-router-dom'
import { useGuidanceOptional } from './GuidanceProvider'
import { useOnboardingProgress } from '../hooks/queries/useOnboardingProgress'
import { useAuth } from '../contexts/AuthContext'

// Same hide-list as WineAgentFab — the nudge would be redundant on the flow
// that IS the setup, or on unauthenticated screens.
export const SETUP_NUDGE_HIDDEN_PATHS = ['/get-started', '/login', '/register', '/verify-email', '/onboarding']

/**
 * Whether the finish-setup nudge is on screen right now: an owner or a
 * manager, a house that is not activated, off the setup flow itself, not put
 * away this session, and due by its cadence (`isSetupNudgeDue`).
 *
 * One answer for two readers. `SetupNudgeBanner` shows when it is true, and
 * `PageTipStrip` holds its page tip while it is true (onboarding walk
 * 2026-11-12: a new owner's first desk stacked the terms sheet, the theme
 * question, this banner AND the dashboard's "Take tour" tip). Both read it in
 * the same render, so the tip never flashes up beside the banner first.
 */
export function useSetupNudgeShowing(): boolean {
  const guidance = useGuidanceOptional()
  const { progress } = useOnboardingProgress()
  const { user } = useAuth()
  const location = useLocation()

  const canActivate = user?.role === 'owner' || user?.role === 'manager'
  const activationIncomplete = !!progress && !progress.activated
  const hiddenRoute = SETUP_NUDGE_HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))

  return (
    !!guidance &&
    canActivate &&
    activationIncomplete &&
    !hiddenRoute &&
    !guidance.setupNudgeDismissedThisSession &&
    guidance.isSetupNudgeDue
  )
}
