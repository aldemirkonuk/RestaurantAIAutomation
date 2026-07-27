import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { useAuth } from '../contexts/AuthContext'

export function NoAccess() {
  const { user, logout } = useAuth()

  return (
    <AuthShell title="No restaurant access" subtitle="You need an invite to join a workspace.">
      <AuthCard className="text-center">
        <p className="text-sm text-gray-500">
          {user?.email ? (
            <>
              You&apos;re signed in as <span className="font-medium text-gray-700">{user.email}</span>, but
              you don&apos;t have access to a restaurant workspace yet.
            </>
          ) : (
            <>You don&apos;t have access to a restaurant workspace.</>
          )}
        </p>
        <p className="text-sm text-gray-500 mt-2">Ask an owner to send you an invite link.</p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center justify-center gap-2 w-full bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(184,50,58,0.55)]"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
            Sign out
          </button>
          <Link
            to="/login"
            className="inline-block w-full text-center border border-gray-200 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50"
          >
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
