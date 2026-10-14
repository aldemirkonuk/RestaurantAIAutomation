import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { useAuth } from '../../contexts/AuthContext'
import { GuidanceStrip } from './GuidanceStrip'
import { houseIsSetUp } from '../../lib/houseSetUp'

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
  // The rail's Get started list reads the same steps (F-1239).
  const activationIncomplete = !!progress && !houseIsSetUp(progress)
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
    <GuidanceStrip
      data-guidance="setup-nudge-banner"
      ariaLabel="Finish setup"
      title="Finish setting up Mudavym."
      // Nothing waits on these two answers; they are what lets low stock be
      // flagged (F-1061). Said for every kind of drink, not wine alone.
      // F-1713: a live menu with no drinks on it (Food alone) asks for the
      // drinks menu, not for a menu that is already current.
      body={
        progress?.menu_live_no_drinks
          ? 'Add your drinks menu and set a low-stock number, so we can flag what is running low. Everything else works without them.'
          : 'Make your menu current and set a low-stock number, so we can flag what is running low. Everything else works without them.'
      }
      primaryLabel="Finish setup"
      // The threshold is asked on its own step; the menu on /get-started's
      // menu step. The nudge goes to whichever half is still missing (F-985).
      // A menu already read but not yet current is made current on
      // /house/menu, not read again (F-1061).
      onPrimary={() =>
        navigate(
          !progress?.threshold_configured
            ? '/get-started?step=threshold'
            : progress?.menu_live_no_drinks
              ? '/get-started'
              : progress?.menu_uploaded
              ? '/house/menu'
              : '/get-started',
        )
      }
      onLater={() => guidance?.snoozeSetupNudge()}
      onDismissForever={() => guidance?.dismissSetupNudgeForever()}
      dismissForeverLabel="Don't remind me"
    />
  )
}
