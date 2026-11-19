/**
 * What `/` renders once the Mudavym dashboard is live: the owner's desk for an
 * owner or manager, the floor's three actions for staff (N-11). One decision,
 * one place, so the route table stays a single line.
 *
 * An unknown role gets the desk, as before: the gateway still refuses what a
 * role may not read, and the desk says so in words.
 */

import { useAuth } from '@/contexts/AuthContext';
import DashboardNext from './DashboardNext';
import StaffHome from './StaffHome';

export default function DashboardHome() {
  const { activeRole } = useAuth();
  return activeRole === 'staff' ? <StaffHome /> : <DashboardNext />;
}
