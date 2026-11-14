import { useEffect } from 'react'
import { usePageGuidance } from '../usePageGuidance'
import { useSetupNudgeShowing } from '../useSetupNudge'
import { GuidanceStrip } from './GuidanceStrip'

/**
 * The page tip ("Take tour"). It waits while the finish-setup nudge is up:
 * one strip at a time, and setup first, because a house with no current menu
 * has little for a tour to show (onboarding walk 2026-11-12: a new owner's
 * first desk stacked the terms sheet, the theme question, the setup banner
 * and this tip). The tip is still due; it shows once the nudge is done or
 * put away, and only then is it counted and announced.
 */
export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()
  const nudgeShowing = useSetupNudgeShowing()
  const visible = showTip && !nudgeShowing && !!tipDef && !!pageId && !!guidance

  useEffect(() => {
    if (visible && pageId) guidance?.offerTip(pageId)
    // Once per page the tip is shown on; offerTip itself is session-idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, pageId])

  if (!visible || !tipDef || !pageId || !guidance) return null

  const bodyId = `page-tip-body-${pageId}`

  return (
    <GuidanceStrip
      data-guidance="tip-strip"
      ariaLabel="Page tip"
      bodyId={bodyId}
      className={className}
      title={tipDef.title}
      body={tipDef.body}
      primaryLabel="Take tour"
      onPrimary={() => guidance.completeTipViaTour(pageId)}
      onLater={() => guidance.snoozeTip(pageId)}
      onDismissForever={() => guidance.dismissTip(pageId)}
      dismissForeverLabel="Don't show again"
    />
  )
}
