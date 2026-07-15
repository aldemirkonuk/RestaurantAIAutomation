/**
 * /team entry — role-split surface (sketch 038 production port).
 * Owner/manager get the full Manager Shift Desk; staff get read-only My Shifts.
 */
import { useAuth } from '../../../contexts/AuthContext'
import { ManagerShiftDesk } from './ManagerShiftDesk'
import { MyShifts } from './MyShifts'

export function TeamCommandPage() {
  const { activeRole, user } = useAuth()
  const role = activeRole ?? user?.role ?? null
  const isManager = role === 'owner' || role === 'manager'
  return isManager ? <ManagerShiftDesk /> : <MyShifts />
}

export default TeamCommandPage
