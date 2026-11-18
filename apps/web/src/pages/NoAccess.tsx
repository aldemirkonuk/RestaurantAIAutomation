import { PublicShell } from '../components/mudavym/PublicShell'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { cachedHouseName, clearHouseEnded, readHouseEnded } from '../lib/houseMemory'

export function NoAccess() {
  const { user, logout } = useAuth()
  // Set when the person's access to the house they were in just ended and no
  // house is left (ADR 0164, R5): the same one sentence the chooser shows.
  const endedId = readHouseEnded()
  const ended = endedId ? (cachedHouseName(endedId) ?? 'that house') : null

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
