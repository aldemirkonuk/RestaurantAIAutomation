import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { useAuth } from '../contexts/AuthContext'

export function NoAccess() {
  const publicDesign = usePublicDesign()
  const { user, logout } = useAuth()

  if (publicDesign) {
    return (
      <PublicShell
        title="No restaurant access"
        eyebrow="Workspace access"
        voice="Ask an owner for an invitation to their restaurant."
        homeHref="/login"
        footer={
          <Link className="mdv-link" to="/login">
            Back to sign in
          </Link>
        }
      >
        <div className="mdv-pub__plate mdv-pub__stack">
          <p>
            {user?.email ? (
              <>
                You are signed in as{' '}
                <strong>{user.email}</strong>,
                but this account has no restaurant access.
              </>
            ) : (
              'This account has no restaurant access.'
            )}
          </p>
          <p>
            Open the invitation link an owner sends you, or sign in with a
            different account.
          </p>
          <button
            className="mdv-btn mdv-btn--seal"
            type="button"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </PublicShell>
    )
  }

  return (
    <AuthShell
      title="No restaurant access"
      subtitle="You need an invite to join a workspace."
    >
      <AuthCard className="text-center">
        <p className="text-sm text-gray-500">
          {user?.email ? (
            <>
              You&apos;re signed in as{' '}
              <span className="font-medium text-gray-700">{user.email}</span>,
              but you don&apos;t have access to a restaurant workspace yet.
            </>
          ) : (
            <>You don&apos;t have access to a restaurant workspace.</>
          )}
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Ask an owner to send you an invite link.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex items-center justify-center gap-2 w-full bg-wine-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-wine-700 shadow-[0_10px_28px_-10px_rgba(26,94,107,0.55)]"
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
