import { usePageGuidance } from '../usePageGuidance'
import { GuidanceStrip } from './GuidanceStrip'

export function PageTipStrip() {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  const bodyId = `page-tip-body-${pageId}`

  return (
    <GuidanceStrip
      data-guidance="tip-strip"
      ariaLabel="Page tip"
      bodyId={bodyId}
      className="mb-2"
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
