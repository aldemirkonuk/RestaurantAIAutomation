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
 * The setup still owed by this house, from the server's read of the house
 * itself (OB-1): no menu read, or a menu read but not made current. A server
 * from before OB-1 sends no `menu_current`; then only a missing menu counts
 * (the rule #848 shipped), never the old `activated`, which waited on a
 * threshold no screen sets (verdict G8).
 */
export function menuSetupOwed(
  progress: { menu_uploaded?: boolean; menu_current?: boolean } | null,
): 'read' | 'choose' | null {
  if (!progress) return null
  if (!progress.menu_uploaded) return 'read'
  if (progress.menu_current === false) return 'choose'
  return null
}

/**
 * Finish-setup nudge: a dismissible, non-blocking banner reminding
 * owner/manager users of the one thing first value needs: a CURRENT menu
 * (proposal F1, F20). A read that was kept but not made current gives the
 * house no stock and no prices (ADR 0193), so it still nudges, and leads
 * straight to the choice. Escalating-backoff cadence lives in
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
  const owed = menuSetupOwed(progress)
  const hiddenRoute = HIDDEN_PATHS.some((p) => location.pathname.startsWith(p))

  const shouldShow =
    !!guidance &&
    canActivate &&
    owed !== null &&
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

  // An owner reads and chooses on the house's own pages (/get-started resumes
  // at the menu step; /house/menu holds the choice). A manager never opens a
  // house, so a manager does both on /menu.
  const isManager = user?.role === 'manager'
  const target =
    owed === 'choose'
      ? isManager
        ? '/menu'
        : '/house/menu'
      : isManager
        ? '/menu'
        : '/get-started'

  return (
    <GuidanceStrip
      data-guidance="setup-nudge-banner"
      ariaLabel="Finish setup"
      title="Finish setting up Mudavym."
      body={
        owed === 'choose'
          ? 'Your menu is read. Choose it as the current menu, and the house has its stock and prices.'
          : 'Read your menu next. A photo or a file is enough.'
      }
      primaryLabel={owed === 'choose' ? 'Choose the menu' : 'Finish setup'}
      onPrimary={() => navigate(target)}
      onLater={() => guidance?.snoozeSetupNudge()}
      onDismissForever={() => guidance?.dismissSetupNudgeForever()}
      dismissForeverLabel="Don't remind me"
    />
  )
}
