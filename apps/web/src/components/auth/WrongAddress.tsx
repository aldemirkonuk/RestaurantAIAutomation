import { useState } from 'react'
import { toast } from 'sonner'
import { apiClient, getErrorMessage } from '../../services/api/client'

type SessionPair = { accessToken: string; refreshToken: string }

/** The gateway's own words for the two refusals a person can act on. */
function refusalSentence(err: unknown): string {
  const response = (err as { response?: { status?: number; data?: { code?: string } } })?.response
  if (response?.data?.code === 'EMAIL_TAKEN')
    return 'That address already has an account. Sign in with it, or type a different one.'
  if (response?.status === 429 || response?.data?.code === 'ADDRESS_CHANGE_RATE_LIMITED')
    return 'Wait a minute before changing the address again.'
  if (response?.data?.code === 'EMAIL_ALREADY_VERIFIED')
    return 'This address is already verified, so it cannot be changed here.'
  return getErrorMessage(err)
}

/**
 * "Wrong address? Change it" (r104 onboarding gap 2). A typo at sign-up left
 * the person with a Resend to the wrong address and nothing else. This moves
 * the unverified account to the right one; the gateway mails it a fresh link
 * and ends the old one, and hands back a session that carries the new address.
 * No motion: the field opens in place.
 */
export function WrongAddress({
  signInWithSession,
  onChanged,
}: {
  signInWithSession: (pair: SessionPair) => Promise<void>
  onChanged: (email: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" className="mdv-link" onClick={() => setOpen(true)}>
        Wrong address? Change it
      </button>
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const next = email.trim()
    if (!next || busy) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await apiClient.post<SessionPair & { email: string }>(
        '/auth/change-unverified-email',
        { email: next },
      )
      await signInWithSession({ accessToken: data.accessToken, refreshToken: data.refreshToken })
      toast.success(`A new verification email is on its way to ${data.email}.`)
      setOpen(false)
      setEmail('')
      onChanged(data.email)
    } catch (err) {
      setError(refusalSentence(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mdv-pub__stack" aria-label="Change the address">
      <label className="mdv-label" htmlFor="wrong-address-email">
        The address you meant
      </label>
      <input
        id="wrong-address-email"
        className="mdv-input"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
      />
      {error && (
        <p className="mdv-alert" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="mdv-btn" disabled={busy || !email.trim()}>
        {busy ? 'Changing…' : 'Send it to this address'}
      </button>
      <button type="button" className="mdv-link" onClick={() => setOpen(false)} disabled={busy}>
        Keep the old address
      </button>
    </form>
  )
}
