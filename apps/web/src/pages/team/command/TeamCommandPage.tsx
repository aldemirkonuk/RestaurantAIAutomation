/**
 * /team entry — role-split surface (sketch 038 production port).
 * Owner/manager get the full Manager Shift Desk; staff get read-only My Shifts.
 */
import { useAuth } from '../../../contexts/AuthContext'
import { ManagerShiftDesk } from './ManagerShiftDesk'
import { MyShifts } from './MyShifts'

export function TeamCommandPage() {
  const { activeRole, user, activeRestaurantId } = useAuth()

  // Prefer branch-scoped role; fall back to JWT/profile role so we never spin
  // forever when URA lookup lags or org-less restaurants omit branch rows.
  const role = activeRole ?? user?.role ?? null

  if (!user) {
    return (
      <div className="p-10 text-center text-sm text-gray-400">Loading team…</div>
    )
  }

  if (!activeRestaurantId) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        No restaurant selected. Switch branch from the header, then open Team again.
      </div>
    )
  }

  if (role == null) {
    return (
      <div className="p-10 text-center text-sm text-gray-400">Loading team…</div>
    )
  }

  const isManager = role === 'owner' || role === 'manager'
  return isManager ? <ManagerShiftDesk /> : <MyShifts />
}

export default TeamCommandPage
