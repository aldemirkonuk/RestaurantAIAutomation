import { PublicShell } from '../components/mudavym/PublicShell'
import { usePublicDesign } from '../lib/mudavym/publicDesign'
import { Link } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { AuthShell, AuthCard } from '../components/brand/AuthShell'
import { useAuth } from '../contexts/AuthContext'
import { cachedHouseName, clearHouseEnded, readHouseEnded } from '../lib/houseMemory'

export function NoAccess() {
  const publicDesign = usePublicDesign()
  const { user, logout } = useAuth()
  // Set when the person's access to the house they were in just ended and no
  // house is left (ADR 0164, R5): the same one sentence the chooser shows.
  const endedId = readHouseEnded()
  const ended = endedId ? (cachedHouseName(endedId) ?? 'that house') : null

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
          {ended && <p role="status">Your access to {ended} has ended.</p>}
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
          {/* ADR 0213: any account can open its own first house. An
              account that never had a house no longer lands here: the chooser
              sends it straight to /get-started (ADR 0164, bracket 2026-09-25;
              the founder, round 4, item 16), and neither does one that ended
              its own (left, or deleted the house it owned; round 5, item 26).
              Who lands here is someone whose membership someone else ended,
              and opening a restaurant of their own is still theirs to choose,
              so the way on stays one link away. */}
          <p>
            <Link className="mdv-link" to="/get-started">
              Opening your own restaurant? Start here.
            </Link>
          </p>
          <button
            className="mdv-btn mdv-btn--seal"
            type="button"
            onClick={() => {
              clearHouseEnded()
              void logout()
            }}
          >
            Sign out
          </button>
        </div>
      </PublicShell>
    )
  }

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
        <p className="text-sm text-gray-500 mt-2">
          Ask an owner to send you an invite link.
        </p>
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
          <Link to="/get-started" className="text-sm text-gray-600 underline underline-offset-4">
            Opening your own restaurant? Start here.
          </Link>
        </div>
      </AuthCard>
    </AuthShell>
  )
}
