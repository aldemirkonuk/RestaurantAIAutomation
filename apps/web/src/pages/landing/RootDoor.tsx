/**
 * The root, `/`, has three readers (ADR 0320):
 *
 * - a stranger, with no session stored, sees the landing page;
 * - a person whose stored session is still being read sees the house loader,
 *   not a flash of the landing page before their dashboard;
 * - a signed-in person sees the dashboard, behind the same `ProtectedRoute`
 *   and `DashboardLayout` as before, with the dashboard page as this route's
 *   index child rendered through the layout's `<Outlet />`.
 *
 * The landing page is not behind `ProtectedRoute` because that component
 * sends a stranger to `/login` (ADR 0143's old root), which is exactly what the
 * landing page replaces. `useAuth().loading` is already false when nothing is
 * stored (AuthContext's load effect returns at once without a token), so a
 * stranger never waits on the loader.
 */
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { ProtectedRoute } from '../../components/ProtectedRoute';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { HousePageLoader } from '../../components/mudavym/HousePageLoader';

function hasStoredSession(): boolean {
  try {
    return window.localStorage.getItem('accessToken') !== null;
  } catch {
    return false;
  }
}

export function RootDoor({ landing }: { landing: ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  if (loading && hasStoredSession()) return <HousePageLoader />;
  if (!isAuthenticated) return <>{landing}</>;
  return (
    <ProtectedRoute>
      <DashboardLayout />
    </ProtectedRoute>
  );
}

export default RootDoor;
