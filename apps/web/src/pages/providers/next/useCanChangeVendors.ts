import { useAuth } from '../../../contexts/AuthContext';

/**
 * May this person change the vendor book? (VEN-W30, founder 2026-10-08:
 * "Staff read only".) Owners and managers yes; staff, and anyone whose role is
 * not known, no. The gateway refuses every vendor write from anyone else with
 * a 403 (`providers/vendor-write-gate.ts`); this only keeps staff from being
 * offered a button that will be refused.
 */
export function useCanChangeVendors(): boolean {
  const { activeRole, user } = useAuth();
  const role = activeRole ?? user?.role ?? null;
  return role === 'owner' || role === 'manager';
}
