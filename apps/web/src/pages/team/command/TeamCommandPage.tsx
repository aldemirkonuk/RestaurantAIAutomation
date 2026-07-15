/**
 * /team entry — role-split surface (sketch 038 production port).
 * Owner/manager get the full Manager Shift Desk; staff get read-only My Shifts.
 */
import { useAuth } from '../../../contexts/AuthContext'
import { ManagerShiftDesk } from './ManagerShiftDesk'
import { MyShifts } from './MyShifts'

export function TeamCommandPage() {
  const { activeRole } = useAuth()
  // Wait for branch-scoped role — never fall back to JWT user.role (can be stale
  // from another restaurant and briefly flash the Manager Desk to staff).
  if (activeRole == null) {
    return (
      <div className="p-10 text-center text-sm text-gray-400">Loading team…</div>
    )
  }
  const isManager = activeRole === 'owner' || activeRole === 'manager'
  return isManager ? <ManagerShiftDesk /> : <MyShifts />
}

export default TeamCommandPage
