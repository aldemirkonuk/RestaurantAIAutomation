import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGuidanceOptional } from '../GuidanceProvider'
import { useOnboardingProgress } from '../../hooks/queries/useOnboardingProgress'
import { useAuth } from '../../contexts/AuthContext'
import { useSetupNudgeShowing } from '../useSetupNudge'
import { GuidanceStrip } from './GuidanceStrip'

/**
 * Finish-setup nudge: a dismissible, non-blocking banner reminding
 * owner/manager users that the house has no current menu yet, when they've
 * wandered off to the rest of the app. "Activated" is the gateway's: a
 * CURRENT menu with a live line (OB-1; ADR 0193, a kept draft gives no stock
 * and no prices). The threshold no longer gates it. The banner names the one
 * step that is missing: read a menu, or make the read menu current (on
 * /menu; nothing here makes a menu current by itself). Escalating-backoff
 * cadence lives in `isSetupNudgeDue`; the sidebar "Get started" badge is the
 * permanent fallback once this banner is dismissed forever. While it shows,
 * the page tip waits (`useSetupNudgeShowing`): one strip at a time, setup first.
 */
export function SetupNudgeBanner() {
  const guidance = useGuidanceOptional()
  const { progress } = useOnboardingProgress()
  const { user } = useAuth()
  const navigate = useNavigate()
  // When it shows is shared with PageTipStrip, which waits while it does.
  const shouldShow = useSetupNudgeShowing()

  useEffect(() => {
    if (shouldShow) guidance?.markSetupNudgeShown()
    // Only re-fire when visibility flips on — markSetupNudgeShown itself
    // updates guidance state, which must not retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow])

  if (!shouldShow) return null

  // A menu was read but kept as a draft (or the choice was skipped): the
  // missing step is choosing it as the current menu, not reading another.
  const readNotCurrent = !!progress?.menu_uploaded && !progress?.menu_current
  const words = readNotCurrent
    ? {
        title: 'Your menu is read, but it is not the current menu yet.',
        body: 'Stock and prices come only from the current menu. Choose it as current when it is the menu you pour from.',
        primary: 'Choose the current menu',
        to: '/menu',
      }
    : {
        title: 'Finish setting up Mudavym.',
        body: 'Read your menu and make it the current one: stock and prices come from it.',
        primary: 'Read your menu',
        // /get-started opens an owner's first house; a manager never opens
        // one, so a manager reads the menu on /menu (as #848 has it).
        to: user?.role === 'manager' ? '/menu' : '/get-started',
      }

  return (
    <GuidanceStrip
      data-guidance="setup-nudge-banner"
      ariaLabel="Finish setup"
      title={words.title}
      body={words.body}
      primaryLabel={words.primary}
      onPrimary={() => navigate(words.to)}
      onLater={() => guidance?.snoozeSetupNudge()}
      onDismissForever={() => guidance?.dismissSetupNudgeForever()}
      dismissForeverLabel="Don't remind me"
    />
  )
}
