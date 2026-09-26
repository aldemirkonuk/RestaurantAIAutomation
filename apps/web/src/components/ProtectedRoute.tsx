import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { ShieldAlert, ArrowLeft } from 'lucide-react'

type HouseRole = 'owner' | 'manager' | 'staff'

interface ProtectedRouteProps {
  children: React.ReactNode
  /**
   * The roles, IN THE SESSION'S HOUSE, that may open this page. Exact, like the
   * gateway's RolesGuard (ADR 0164, "Keep managers in"): 'owner' means owner,
   * and a page for owners and managers says ['owner', 'manager'].
   */
  requiredRole?: HouseRole | HouseRole[]
  requiredStudioRole?: ('developer' | 'certified_contributor' | 'review_admin')[]
  redirectTo?: string
}

export function ProtectedRoute({
  children,
  requiredRole,
  requiredStudioRole,
  redirectTo = '/login',
}: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth()
  const location = useLocation()

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 relative">
            <div className="w-12 h-12 border-3 border-slate-200 rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-3 border-brand-500 rounded-full border-t-transparent animate-spin" />
          </div>
          <p className="text-slate-500 font-medium">Loading...</p>
        </div>
      </div>
    )
  }

  // Not Authenticated — must redirect before any role checks to avoid infinite spinner
  if (!isAuthenticated) {
    return <Navigate to={redirectTo} state={{ from: location }} replace />
  }

  // Email verification gate — Path B users must verify before accessing dashboard (D-05, T-26-05-02)
  if (user?.emailVerified === false) {
    return <Navigate to="/verify-email" replace />
  }

  // A session in no house (ADR 0164): someone with several houses who has not
  // chosen one yet, or whose access to their house just ended. They choose;
  // the chooser sends someone with no houses at all to /no-access if a
  // membership of theirs ended, or to /get-started if they never had one
  // (bracket 2026-09-25; the founder, round 4, item 16).
  if (!user?.restaurantId) {
    return <Navigate to="/choose-house" state={{ from: location }} replace />
  }

  // Studio role loading guard (Pitfall 6: undefined = still loading, not denied)
  if (requiredStudioRole && user?.studioRoles === undefined) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 relative">
            <div className="w-12 h-12 border-3 border-slate-200 rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-3 border-brand-500 rounded-full border-t-transparent animate-spin" />
          </div>
          <p className="text-slate-500 font-medium">Loading permissions...</p>
        </div>
      </div>
    )
  }

  // Role check: exact, on the role in the session's house. This used to let a
  // manager through any page that named owner, and the reverse, mirroring the
  // gateway's old RolesGuard; both now mean exactly what they list.
  const allowedRoles = requiredRole
    ? Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole]
    : null
  if (allowedRoles) {
    const isAuthorized = !!user?.role && allowedRoles.includes(user.role)

    if (!isAuthorized) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 max-w-md w-full text-center">
            {/* Icon */}
            <div className="w-16 h-16 mx-auto mb-6 bg-danger-100 rounded-2xl flex items-center justify-center">
              <ShieldAlert className="w-8 h-8 text-danger-600" />
            </div>

            {/* Content */}
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Denied</h2>
            <p className="text-slate-500 mb-8">
              You don't have permission to access this page. Please contact your administrator if you believe this is an error.
            </p>

            {/* Actions */}
            <div className="space-y-3">
              <a 
                href="/"
                className="btn-primary w-full justify-center"
              >
                <ArrowLeft className="w-4 h-4" />
                Go to Dashboard
              </a>
              <button
                onClick={() => window.history.back()}
                className="btn-ghost w-full justify-center"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )
    }
  }

  // Studio role check
  if (requiredStudioRole && !requiredStudioRole.some(r => user?.studioRoles?.includes(r))) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-6 bg-danger-100 rounded-2xl flex items-center justify-center">
            <ShieldAlert className="w-8 h-8 text-danger-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Studio Access Required</h2>
          <p className="text-slate-500 mb-8">
            Mudavym Studio is available to developers and certified contributors only.
            Contact a review admin to request access.
          </p>
          <a href="/" className="btn-primary w-full justify-center">
            <ArrowLeft className="w-4 h-4" />
            Go to Dashboard
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
