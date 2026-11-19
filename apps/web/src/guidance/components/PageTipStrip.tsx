import { useContext } from 'react'
import { AuthContext } from '../../contexts/AuthContext'
import { useFirstTaskDone } from '../../lib/mudavym/groundAsk'
import { usePageGuidance } from '../usePageGuidance'
import { TourLine } from './TourLine'

export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()
  // `useContext`, not `useAuth`: the strip also renders where there is no
  // provider (stories), and there it simply has no role to hold on.
  const auth = useContext(AuthContext)
  const role = auth?.activeRole
  // Signed in but the role is not read yet (the first second of a load): the
  // desk draws before the staff home does, so holding only on a known 'staff'
  // flashed the banner for a floor worker and then took it away. Wait for the
  // role; an owner or a manager sees it the moment it is known.
  const roleUnread = auth != null && !role
  const firstTaskDone = useFirstTaskDone()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  // N-11 / c2 #14: a floor worker's home is three actions and what is running
  // low. The tour banner (94 px) used to sit above them on the first visit;
  // it now waits until the first task is done. Owners and managers see it as
  // before, and so does every other page.
  if ((role === 'staff' || roleUnread) && pageId === 'dashboard' && !firstTaskDone) return null

  const bodyId = `page-tip-body-${pageId}`

  return (
    <TourLine
      key={pageId}
      pageId={pageId}
      bodyId={bodyId}
      className={className}
      body={`${tipDef.title} ${tipDef.body}`}
      onTour={() => guidance.completeTipViaTour(pageId)}
      onLater={() => guidance.snoozeTip(pageId)}
    />
  )
}
