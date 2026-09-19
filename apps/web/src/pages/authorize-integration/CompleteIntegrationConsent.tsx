import { useEffect, useRef, useState } from 'react'
import { PublicShell } from '../../components/mudavym/PublicShell'
import { integrationsApi } from '../../services/api/integrations'
import { forgetConsentBrowser, readConsentBrowser } from './consent-browser'

export default function CompleteIntegrationConsent() {
  const [error, setError] = useState<string | null>(null)
  const work = useRef<Promise<string> | null>(null)
  useEffect(() => {
    let alive = true
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const state = fragment.get('state') ?? ''
    const request = fragment.get('request') ?? ''
    // Minted by the server only when the provider callback parked a result
    // (KL audit D1, round 2) — never known ahead of time by whoever sealed
    // the flow, so it travels only in this redirect's own fragment.
    const delivery = fragment.get('delivery') ?? ''
    const proof = readConsentBrowser(request)
    if (!proof || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[a-f0-9]{64}$/.test(delivery)) {
      setError('This tab does not hold the permission you sealed, or it has expired. Start again from your profile.')
      return
    }
    // StrictMode's effect replay attaches to the same request. No automatic
    // retry of a consumed OAuth code or one-use browser state.
    work.current ??= integrationsApi.completeConsent(state, proof, delivery)
    work.current.then(destination => {
      if (!alive) return
      const url = new URL(destination, window.location.origin)
      if (url.origin !== window.location.origin) throw new Error('The return address could not be verified.')
      forgetConsentBrowser(request)
      window.location.replace(url.toString())
    }).catch(e => {
      if (!alive) return
      forgetConsentBrowser(request)
      setError(e?.response?.data?.message || e?.message || 'The connection outcome could not be established. Check your profile before starting again.')
    })
    return () => { alive = false }
  }, [])
  // /connections is managers-only (KL audit J9/D9 residue): a staff person's
  // OWN grant lives on /profile, so the exit on a refusal goes there, same as
  // PublicShell's own homeHref just below — never to a page some of the
  // people who can land here are not allowed to open.
  return <PublicShell title={error ? 'The permission did not finish' : 'Finishing your connection'} eyebrow="Returning from the provider" seal={false} homeHref="/profile">
    {error ? <p role="alert" className="mdv-alert">{error}</p> : <p role="status">Checking this tab’s permission and recording the provider’s answer…</p>}
    {error && <a className="mdv-link" href="/profile">Open Profile</a>}
  </PublicShell>
}
