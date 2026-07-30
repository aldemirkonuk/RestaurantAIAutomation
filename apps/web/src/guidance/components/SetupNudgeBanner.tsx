import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { useAuth } from '../../contexts/AuthContext'
import { GuidanceStrip } from './GuidanceStrip'

const HIDDEN_PATHS = ['/get-started', '/login', '/register', '/verify-email', '/onboarding']

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow])

  if (!shouldShow) return null

  return (
    <GuidanceStrip
      data-guidance="setup-nudge-banner"
      ariaLabel="Finish setup"
      title="Finish setting up WineOps"
      body="Upload your wine list and set a low-stock threshold to unlock inventory and ordering."
      primaryLabel="Finish setup"
      onPrimary={() => navigate('/get-started')}
      onLater={() => guidance?.snoozeSetupNudge()}
      onDismissForever={() => guidance?.dismissSetupNudgeForever()}
      dismissForeverLabel="Don't remind me"
    />
  )
}
