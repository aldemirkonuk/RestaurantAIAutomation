import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { useAuth } from '../../contexts/AuthContext'
import { GuidanceStrip } from './GuidanceStrip'

// Same hide-list as WineAgentFab — the nudge would be redundant on the flow
// that IS the setup, or on unauthenticated screens.
const HIDDEN_PATHS = ['/get-started', '/login', '/register', '/verify-email', '/onboarding']

/**
 * Finish-setup nudge: a dismissible, non-blocking banner reminding
 * owner/manager users to read their menu when they've wandered off to the
 * rest of the app. First value is a menu (proposal fork F1); the threshold is
 * not required, and no screen sets it, so `activated` (which still needs it on
 * the server until OB-1) would nudge forever. Until OB-1, it shows while no
 * menu has been read. Escalating-backoff cadence lives in
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
  const menuMissing = !!progress && !progress.menu_uploaded
  const hiddenRoute = HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))

  const shouldShow =
    !!guidance &&
    canActivate &&
    menuMissing &&
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
    <GuidanceStrip
      data-guidance="setup-nudge-banner"
      ariaLabel="Finish setup"
      title="Finish setting up Mudavym."
      body="Read your menu next. A photo or a file is enough."
      primaryLabel="Finish setup"
      // /get-started opens an owner's first house (and, with its entry rule
      // in fix/onboarding-finish-setup-resumes-at-the-menu, resumes at the
      // menu step); a manager never opens one, so a manager reads it on /menu.
      onPrimary={() => navigate(user?.role === 'manager' ? '/menu' : '/get-started')}
      onLater={() => guidance?.snoozeSetupNudge()}
      onDismissForever={() => guidance?.dismissSetupNudgeForever()}
      dismissForeverLabel="Don't remind me"
    />
  )
}
