import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { useAuth } from '../contexts/AuthContext'
import { cachedHouseName, clearHouseEnded, readHouseEnded } from '../lib/houseMemory'

export function NoAccess() {
  const { user, logout } = useAuth()
  // Set when the person's access to the house they were in just ended and no
  // house is left (ADR 0164, R5): the same one sentence the chooser shows.
  const endedId = readHouseEnded()
  const ended = endedId ? (cachedHouseName(endedId) ?? 'that house') : null

  return (
    <AuthShell title="No house yet" subtitle="You need an invitation to join a house.">
      <AuthCard className="text-center">
        {ended && (
          <p role="status" className="text-sm text-gray-700 mb-3">
            Your access to {ended} has ended.
          </p>
        )}
        <p className="text-sm text-gray-500">
          {user?.email ? (
            <>
              You&apos;re signed in as <span className="font-medium text-gray-700">{user.email}</span>, but
              you&apos;re not a member of any house yet.
            </>
          ) : (
            <>You&apos;re not a member of any house.</>
          )}
        </p>
        <p className="text-sm text-gray-500 mt-2">Ask an owner to send you an invite link.</p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => {
              clearHouseEnded()
              void logout()
            }}
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
