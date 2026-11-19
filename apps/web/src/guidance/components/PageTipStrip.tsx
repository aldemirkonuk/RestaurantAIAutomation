import { useContext } from 'react'
import { AuthContext } from '../../contexts/AuthContext'
import { useFirstTaskDone } from '../../lib/mudavym/groundAsk'
import { usePageGuidance } from '../usePageGuidance'
import { GuidanceStrip } from './GuidanceStrip'

export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()
  // `useContext`, not `useAuth`: the strip also renders where there is no
  // provider (stories), and there it simply has no role to hold on.
  const role = useContext(AuthContext)?.activeRole
  const firstTaskDone = useFirstTaskDone()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  // N-11 / c2 #14: a floor worker's home is three actions and what is running
  // low. The tour banner (94 px) used to sit above them on the first visit;
  // it now waits until the first task is done. Owners and managers see it as
  // before, and so does every other page.
  if (role === 'staff' && pageId === 'dashboard' && !firstTaskDone) return null

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
